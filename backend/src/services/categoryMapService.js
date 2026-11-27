/**
 * Category Map Service — fait autorité sur `products.category` / `sub_category`.
 *
 * Deux défauts de yousync, qu'on ne corrige pas dans le plugin (l'agence l'écrase
 * à chaque déploiement, cf. brandMapService) :
 *   - il retient `$categories[0]`, la 1re catégorie PAR NOM : un produit rangé aussi
 *     en DLUO ou en 10 ml en plus des sels changeait de catégorie dans toutes les stats ;
 *   - il n'envoie la catégorie qu'à l'édition du produit : une catégorie renommée
 *     laissait l'ancien nom aux produits non retouchés (1 324 lignes rattrapées le
 *     27/11/2026, sauvegarde products_category_backup_20261127).
 *
 * Ce service :
 *   - lit tous les produits du site (wc/v3, brouillons compris) et les termes product_cat,
 *     choisit la catégorie par `categoryRules.pickCategory` (principale Yoast d'abord) ;
 *   - garde le résultat dans `wp_product_category_map` et réaligne `products` (cron horaire) ;
 *   - `applyCategoryMap()` remplace la catégorie envoyée par yousync à l'ingestion.
 *     Un changement de catégorie fait sur le site apparaît donc au plus tard au passage
 *     suivant du cron (1 h), jamais remplacé par le choix « par nom » de yousync.
 *
 * Noms BRUTS des termes (« Box &amp; Mods »), comme yousync : décoder ferait deux libellés.
 */

const axios = require('axios');
const pool = require('../config/database');
const { pickCategory } = require('./categoryRules');

const PER_PAGE = 100;
const REQUEST_DELAY_MS = 300;
const REQUEST_TIMEOUT_MS = 60000;
const MIN_PRODUCTS_EXPECTED = 1000;
const USER_AGENT = 'YouvapeApps/1.0 (+https://apps.youvape.fr)';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getCredentials = async () => {
  const { rows: [wc] } = await pool.query('SELECT woocommerce_url, consumer_key, consumer_secret FROM rewards_config LIMIT 1');
  const { rows: [cfg] } = await pool.query("SELECT config_value FROM app_config WHERE config_key = 'wc_sync_wp_url'");
  const url = (cfg?.config_value || wc?.woocommerce_url || '').replace(/\/$/, '');
  if (!url.startsWith('https://') || !wc?.consumer_key || !wc?.consumer_secret) {
    throw new Error('Accès WooCommerce incomplet (rewards_config / wc_sync_wp_url)');
  }
  return { url, ck: wc.consumer_key, cs: wc.consumer_secret };
};

// Toute page en erreur ou de forme inattendue (pare-feu Cloudflare en 200) fait échouer
// le passage : un résultat partiel reclasserait des produits à tort.
const fetchAllPages = async (url, params) => {
  const items = [];
  for (let page = 1, total = 1; page <= total; page++) {
    const res = await axios.get(url, {
      params: { ...params, per_page: PER_PAGE, page },
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!Array.isArray(res.data)) throw new Error(`Réponse inattendue (${url}, page ${page})`);
    if (page === 1) total = Number(res.headers['x-wp-totalpages']) || 1;
    items.push(...res.data);
    if (page < total) await sleep(REQUEST_DELAY_MS);
  }
  return items;
};

const ensureTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wp_product_category_map (
      wp_product_id BIGINT PRIMARY KEY,
      category      VARCHAR(255) NOT NULL,
      sub_category  VARCHAR(255),
      refreshed_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
};

/** Catégorie retenue pour chaque produit du site : Map(wp_product_id → {category, sub_category}). */
const buildMap = async () => {
  const c = await getCredentials();
  const terms = await fetchAllPages(`${c.url}/wp-json/wp/v2/product_cat`, { _fields: 'id,name,slug,parent', hide_empty: false });
  if (!terms.length) throw new Error('Aucune catégorie lue sur le site');
  await sleep(REQUEST_DELAY_MS);
  const products = await fetchAllPages(`${c.url}/wp-json/wc/v3/products`, {
    status: 'any', orderby: 'id', order: 'asc',
    _fields: 'id,categories,permalink',
    consumer_key: c.ck, consumer_secret: c.cs,
  });
  if (products.length < MIN_PRODUCTS_EXPECTED) {
    throw new Error(`Réponse incomplète : ${products.length} produits (< ${MIN_PRODUCTS_EXPECTED}), passage annulé`);
  }

  const byId = new Map(terms.map((t) => [t.id, t]));
  const map = new Map();
  for (const p of products) {
    const pick = pickCategory(p, byId);
    if (pick) map.set(Number(p.id), pick);
  }
  return { map, products: products.length };
};

/**
 * Rafraîchit la table depuis le site et réaligne `products`.
 * Parents et produits simples d'après la table ; déclinaisons d'après leur parent,
 * seulement celles qui portent déjà une catégorie (les autres lisent celle du parent).
 * @param {{dryRun?: boolean}} options  dryRun : transaction annulée, compteurs + exemples rendus
 */
const refreshCategoryMap = async ({ dryRun = false } = {}) => {
  await ensureTable();
  const { map, products } = await buildMap();

  const ids = [...map.keys()];
  const cats = ids.map((id) => map.get(id).category);
  const subs = ids.map((id) => map.get(id).sub_category);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE wp_product_category_map');
    await client.query(
      `INSERT INTO wp_product_category_map (wp_product_id, category, sub_category)
       SELECT * FROM UNNEST($1::bigint[], $2::varchar[], $3::varchar[])`,
      [ids, cats, subs]
    );

    const changes = await client.query(`
      SELECT p.product_type, p.category AS old_cat, p.sub_category AS old_sub,
             m.category AS new_cat, m.sub_category AS new_sub, count(*)::int AS n
        FROM products p
        JOIN wp_product_category_map m
          ON m.wp_product_id = CASE WHEN p.product_type = 'variation' THEN p.wp_parent_id ELSE p.wp_product_id END
       WHERE (p.product_type <> 'variation' OR COALESCE(p.category, '') <> '')
         AND (p.category IS DISTINCT FROM m.category OR p.sub_category IS DISTINCT FROM m.sub_category)
       GROUP BY 1, 2, 3, 4, 5 ORDER BY n DESC`);

    const parents = await client.query(`
      UPDATE products p
         SET category = m.category, sub_category = m.sub_category, updated_at = NOW()
        FROM wp_product_category_map m
       WHERE p.wp_product_id = m.wp_product_id
         AND p.product_type <> 'variation'
         AND (p.category IS DISTINCT FROM m.category OR p.sub_category IS DISTINCT FROM m.sub_category)`);

    const variations = await client.query(`
      UPDATE products p
         SET category = m.category, sub_category = m.sub_category, updated_at = NOW()
        FROM wp_product_category_map m
       WHERE p.wp_parent_id = m.wp_product_id
         AND p.product_type = 'variation'
         AND COALESCE(p.category, '') <> ''
         AND (p.category IS DISTINCT FROM m.category OR p.sub_category IS DISTINCT FROM m.sub_category)`);

    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    return {
      dryRun,
      products,
      mapped: map.size,
      updated: parents.rowCount,
      variations: variations.rowCount,
      changes: changes.rows,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * À l'ingestion yousync : remplace la catégorie envoyée (1re par nom) par celle de la table.
 * Déclinaison : celle de son parent, si elle en porte une. Produit absent de la table
 * (créé depuis le dernier passage) : la valeur de yousync est gardée jusqu'au cron.
 * Ne remonte jamais d'erreur : une table manquante ne doit pas bloquer la synchro.
 */
const applyCategoryMap = async (db, data) => {
  if (!data || !data.wp_product_id) return data;
  const isVariation = data.type === 'variation';
  if (isVariation && !data.category) return data;
  const key = isVariation ? data.parent_id : data.wp_product_id;
  if (!key) return data;

  try {
    const { rows } = await db.query(
      'SELECT category, sub_category FROM wp_product_category_map WHERE wp_product_id = $1',
      [key]
    );
    if (rows && rows[0] && rows[0].category) {
      data.category = rows[0].category;
      data.sub_category = rows[0].sub_category;
    }
  } catch (error) {
    if (error.code !== '42P01') console.error(`applyCategoryMap (${data.wp_product_id}): ${error.message}`);
  }
  return data;
};

module.exports = { ensureTable, refreshCategoryMap, applyCategoryMap };
