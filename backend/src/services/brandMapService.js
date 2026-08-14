/**
 * Brand Map Service
 *
 * Reconstruit la correspondance produit -> marque / sous-marque directement
 * depuis la taxonomie `pwb-brand` de WordPress (API REST publique), sans
 * dependre du plugin yousync.
 *
 * Pourquoi : yousync deduit la marque avec `$brands[0]`. Un produit qui porte
 * a la fois le terme parent (« Eliquid France ») et le terme enfant
 * (« Fruizee Max ») renvoie le parent en premier -> le plugin envoie
 * `sub_brand` vide, ce qui ecrase la sous-marque en base a chaque edition du
 * produit. Le correctif plugin (v1.4.1) est efface a chaque deploiement
 * Deployer du site (releases/N), on ne peut donc pas s'appuyer dessus.
 *
 * Ce service fait autorite sur `products.sub_brand` :
 *   - il rafraichit la table `wp_product_brand_map` depuis WordPress ;
 *   - il repare `products` (remplit ET vide selon la verite WordPress) ;
 *   - `applySubBrandFallback()` restaure la sous-marque a l'ingestion, pour
 *     que l'ecrasement par yousync ne soit jamais visible.
 *
 * Perimetre : produits PUBLIES uniquement (l'API REST publique n'expose
 * qu'eux). Un produit en brouillon garde sa valeur en base, il n'est ni
 * corrige ni vide.
 */

const axios = require('axios');
const pool = require('../config/database');

const PER_PAGE = 100;
const REQUEST_DELAY_MS = 200;
const REQUEST_TIMEOUT_MS = 60000;
// Le WAF de la prod rejette les User-Agent d'outils (403), on s'annonce.
const USER_AGENT = 'YouvapeApps/1.0 (+https://apps.youvape.fr)';
// Garde-fou : en dessous, on considere que la prod a repondu de facon
// incomplete et on refuse de vider quoi que ce soit.
const MIN_PRODUCTS_EXPECTED = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#039;': "'", '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
  '&#8217;': '’', '&#8216;': '‘', '&#8211;': '–', '&#8212;': '—',
};

// Les noms de termes arrivent encodes par l'API REST ; yousync, lui, envoie
// le nom brut. On decode pour que les deux sources produisent la meme chaine.
const decodeEntities = (value) => {
  if (!value) return null;
  return value
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#0?39|#8217|#8216|#8211|#8212);/g, (m) => ENTITIES[m] || m)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .trim();
};

const getWpUrl = async () => {
  const configResult = await pool.query(
    "SELECT config_value FROM app_config WHERE config_key = 'wc_sync_wp_url'"
  );
  if (configResult.rows[0]?.config_value) {
    return configResult.rows[0].config_value.replace(/\/$/, '');
  }
  const fallback = await pool.query('SELECT woocommerce_url FROM rewards_config LIMIT 1');
  if (!fallback.rows[0]?.woocommerce_url) {
    throw new Error('URL WordPress introuvable (app_config.wc_sync_wp_url / rewards_config)');
  }
  return fallback.rows[0].woocommerce_url.replace(/\/$/, '');
};

/**
 * Recupere toutes les pages d'un endpoint WP REST.
 * Toute page en erreur fait echouer l'appel : un resultat partiel conduirait
 * a vider des sous-marques a tort.
 */
const fetchAllPages = async (url, params) => {
  const items = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const response = await axios.get(url, {
      params: { ...params, per_page: PER_PAGE, page },
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'User-Agent': USER_AGENT },
    });

    const header = response.headers['x-wp-totalpages'];
    if (page === 1 && header) totalPages = Number(header) || 1;

    items.push(...(Array.isArray(response.data) ? response.data : []));
    page++;
    if (page <= totalPages) await sleep(REQUEST_DELAY_MS);
  }

  return items;
};

/**
 * Associe chaque produit publie a son terme enfant `pwb-brand`.
 * Independant de l'ordre des termes : on cherche celui qui a un parent.
 */
const buildMap = (terms, products) => {
  const termsById = new Map(terms.map((t) => [t.id, t]));
  const withSubBrand = [];
  const withoutSubBrand = [];

  for (const product of products) {
    const termIds = product['pwb-brand'] || [];
    const child = termIds
      .map((id) => termsById.get(id))
      .find((term) => term && term.parent);

    if (!child) {
      withoutSubBrand.push(product.id);
      continue;
    }

    const parent = termsById.get(child.parent);
    withSubBrand.push({
      wp_product_id: product.id,
      brand: decodeEntities(parent ? parent.name : child.name),
      sub_brand: decodeEntities(child.name),
    });
  }

  return { withSubBrand, withoutSubBrand };
};

const persistMap = async (client, rows) => {
  await client.query('TRUNCATE wp_product_brand_map');
  if (rows.length === 0) return;

  // Un seul INSERT multi-lignes : la table tient dans le millier de lignes.
  const values = [];
  const placeholders = rows.map((row, i) => {
    const base = i * 3;
    values.push(row.wp_product_id, row.brand, row.sub_brand);
    return `($${base + 1}, $${base + 2}, $${base + 3})`;
  });

  await client.query(
    `INSERT INTO wp_product_brand_map (wp_product_id, brand, sub_brand)
     VALUES ${placeholders.join(', ')}`,
    values
  );
};

// Les migrations .sql ne sont pas versionnees dans ce repo (.gitignore *.sql),
// le service cree donc sa table lui-meme : un deploiement suffit.
const ensureTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wp_product_brand_map (
      wp_product_id BIGINT PRIMARY KEY,
      brand         VARCHAR(255),
      sub_brand     VARCHAR(255) NOT NULL,
      refreshed_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
};

/**
 * Rafraichit la table de correspondance depuis WordPress et realigne
 * `products` dessus.
 * @returns {Object} compteurs { products, mapped, filled, cleared }
 */
const refreshBrandMap = async () => {
  await ensureTable();
  const wpUrl = await getWpUrl();

  const terms = await fetchAllPages(`${wpUrl}/wp-json/wp/v2/pwb-brand`, {
    _fields: 'id,name,parent',
  });
  await sleep(REQUEST_DELAY_MS);
  // orderby=id : pagination stable meme si un produit est modifie pendant le run.
  const products = await fetchAllPages(`${wpUrl}/wp-json/wp/v2/product`, {
    _fields: 'id,pwb-brand',
    orderby: 'id',
    order: 'asc',
  });

  if (products.length < MIN_PRODUCTS_EXPECTED) {
    throw new Error(
      `Reponse WordPress incomplete: ${products.length} produits recuperes (< ${MIN_PRODUCTS_EXPECTED}), rafraichissement annule`
    );
  }

  const { withSubBrand, withoutSubBrand } = buildMap(terms, products);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await persistMap(client, withSubBrand);

    // Remplit / corrige les produits qui ont une sous-marque cote WordPress.
    const filled = await client.query(
      `UPDATE products p
          SET sub_brand = m.sub_brand,
              brand     = COALESCE(m.brand, p.brand),
              updated_at = NOW()
         FROM wp_product_brand_map m
        WHERE p.wp_product_id = m.wp_product_id
          AND p.product_type <> 'variation'
          AND (p.sub_brand IS DISTINCT FROM m.sub_brand
               OR p.brand IS DISTINCT FROM COALESCE(m.brand, p.brand))`
    );

    // Vide ceux dont la sous-marque a ete retiree cote WordPress.
    let cleared = { rowCount: 0 };
    if (withoutSubBrand.length > 0) {
      cleared = await client.query(
        `UPDATE products
            SET sub_brand = NULL,
                updated_at = NOW()
          WHERE wp_product_id = ANY($1::bigint[])
            AND product_type <> 'variation'
            AND sub_brand IS NOT NULL`,
        [withoutSubBrand]
      );
    }

    await client.query('COMMIT');

    return {
      products: products.length,
      mapped: withSubBrand.length,
      filled: filled.rowCount,
      cleared: cleared.rowCount,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Restaure la sous-marque a l'ingestion quand yousync l'envoie vide.
 * Appele avant chaque upsert produit : sans ca, la sous-marque disparaitrait
 * a chaque edition du produit dans WordPress jusqu'au prochain cron.
 *
 * Ne remonte jamais d'erreur : une correspondance manquante ne doit pas
 * faire echouer une synchronisation.
 */
const applySubBrandFallback = async (dbPool, productData) => {
  if (productData.sub_brand || !productData.wp_product_id) return productData;
  if (productData.product_type === 'variation') return productData;

  try {
    const result = await dbPool.query(
      'SELECT brand, sub_brand FROM wp_product_brand_map WHERE wp_product_id = $1',
      [productData.wp_product_id]
    );
    if (result.rows.length > 0) {
      productData.sub_brand = result.rows[0].sub_brand;
      if (!productData.brand) productData.brand = result.rows[0].brand;
    }
  } catch (error) {
    console.error(`applySubBrandFallback (${productData.wp_product_id}): ${error.message}`);
  }

  return productData;
};

module.exports = {
  refreshBrandMap,
  applySubBrandFallback,
};
