/**
 * Attributs produits (WooCommerce) → Postgres
 *
 * Un attribut WooCommerce peut vivre à deux endroits :
 *   • sur la DÉCLINAISON quand il sert aux variations (« Saveur » d'une puff) —
 *     yousync le pousse déjà dans products.product_attributes ;
 *   • sur le PRODUIT quand il ne sert pas aux variations (« Taux de Nicotine :
 *     0mg » d'une puff sans nicotine, « Port de Recharge : USB-C »…) — celui-là
 *     n'arrivait nulle part, d'où des filtres qui ne trouvaient rien alors que
 *     l'information existe bien dans WordPress.
 *
 * Ce service comble le second cas depuis l'API REST WooCommerce, qui expose les
 * attributs d'un produit avec leurs valeurs (`attributes[].options`).
 */

const axios = require('axios');
const pool = require('../config/database');
const { normalizeAttrValue: normalize } = require('../utils/productFilters');

const PER_PAGE = 100;
const REQUEST_DELAY_MS = 300;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Normalisation partagée avec les filtres (utils/productFilters) et le SQL :
// « 0mg », « 0-mg » et « 0 MG » sont une seule et même valeur. Les accents sont
// conservés, comme le fait lower() + [:alnum:] côté Postgres.

const ensureTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wp_product_attributes (
      wp_product_id BIGINT       NOT NULL,
      attribute     VARCHAR(190) NOT NULL,
      value         VARCHAR(255) NOT NULL,
      value_norm    VARCHAR(255) NOT NULL,
      refreshed_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (wp_product_id, attribute, value_norm)
    )
  `);
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_wp_product_attributes_attr ON wp_product_attributes (attribute, value_norm)'
  );
};

const getWcCredentials = async () => {
  const result = await pool.query('SELECT consumer_key, consumer_secret, woocommerce_url FROM rewards_config LIMIT 1');
  if (result.rows.length === 0) throw new Error('Credentials WC non trouvées dans rewards_config');
  const row = result.rows[0];
  const urlResult = await pool.query("SELECT config_value FROM app_config WHERE config_key = 'wc_sync_wp_url'");
  const wcUrl = urlResult.rows[0]?.config_value || row.woocommerce_url;
  return {
    url: wcUrl.replace(/\/$/, ''),
    consumerKey: row.consumer_key,
    consumerSecret: row.consumer_secret,
  };
};

/** Liste des produits (sans les variations : les attributs cherchés sont au niveau produit). */
const fetchProducts = async (creds) => {
  const all = [];
  let page = 1;
  while (true) {
    const res = await axios.get(`${creds.url}/wp-json/wc/v3/products`, {
      params: {
        consumer_key: creds.consumerKey,
        consumer_secret: creds.consumerSecret,
        per_page: PER_PAGE,
        page,
        status: 'any',
        orderby: 'id',
        order: 'asc',
        _fields: 'id,attributes',
      },
      timeout: 60000,
    });
    all.push(...res.data);
    const totalPages = parseInt(res.headers['x-wp-totalpages']) || 1;
    if (page >= totalPages) break;
    page++;
    await sleep(REQUEST_DELAY_MS);
  }
  return all;
};

/**
 * Réécrit la table à partir d'une liste de produits WC déjà chargée.
 * Seuls les attributs de taxonomie globale (slug `pa_…`) sont retenus : ce sont
 * ceux qui portent le même nom que les métas de déclinaison, donc les deux
 * niveaux se comparent.
 */
const refreshFromProducts = async (products) => {
  await ensureTable();

  const rows = [];
  for (const p of products) {
    for (const a of p.attributes || []) {
      const slug = String(a.slug || '').trim();
      if (!slug.startsWith('pa_')) continue;
      // « Utilisé pour les variations » coché : la vérité est sur chaque
      // déclinaison (un e-liquide propose 0, 3, 6 mg — le produit n'est pas
      // « 0 mg »). On ne garde donc que les attributs de niveau produit.
      if (a.variation) continue;
      for (const option of a.options || []) {
        const value = String(option || '').trim();
        const valueNorm = normalize(value);
        if (!value || !valueNorm) continue;
        rows.push([p.id, slug, value.slice(0, 255), valueNorm.slice(0, 255)]);
      }
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE wp_product_attributes');
    // Insertion par paquets : une seule requête pour 500 lignes
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const values = chunk
        .map((_, j) => `($${j * 4 + 1}, $${j * 4 + 2}, $${j * 4 + 3}, $${j * 4 + 4})`)
        .join(', ');
      await client.query(
        `INSERT INTO wp_product_attributes (wp_product_id, attribute, value, value_norm)
         VALUES ${values} ON CONFLICT DO NOTHING`,
        chunk.flat()
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const attrs = new Set(rows.map((r) => r[1]));
  const prods = new Set(rows.map((r) => r[0]));
  return { products: prods.size, attributes: attrs.size, rows: rows.length };
};

/** Passe complète : va chercher les produits puis réécrit la table. */
const runProductAttributeSync = async () => {
  const startTime = Date.now();
  const creds = await getWcCredentials();
  const products = await fetchProducts(creds);
  const stats = await refreshFromProducts(products);
  console.log(
    `Attributs produits : ${stats.rows} valeurs sur ${stats.products} produits ` +
    `(${stats.attributes} attributs) en ${Math.round((Date.now() - startTime) / 1000)}s`
  );
  return stats;
};

module.exports = { ensureTable, refreshFromProducts, runProductAttributeSync };
