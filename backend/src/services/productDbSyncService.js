/**
 * Product DB Sync Service
 * Resynchronise post_status / stock_status / stock / manage_stock depuis
 * l'API REST WooCommerce de production (www.youvape.fr) vers la table
 * Postgres `products`.
 *
 * Les webhooks YouSync couvrent la plupart des changements en temps reel,
 * mais certaines operations (edition groupee WC, ATUM bulk edit) ne
 * declenchent pas toujours de webhook par produit. Ce job de rattrapage
 * tourne chaque nuit pour combler les ecarts residuels.
 *
 * NB: le switch ATUM "Suivi de stock" (atum_controlled) n'est pas expose
 * par l'API REST WooCommerce et n'est donc pas resynchronise ici.
 */

const axios = require('axios');
const pool = require('../config/database');

const PER_PAGE = 100;
const REQUEST_DELAY_MS = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Le prix remise (Woo Discount Rules) n'est pas expose par l'API REST WC standard.
// Un mu-plugin cote prod ajoute le champ `wdr_discounted_price` a la reponse produit/variation.
// Tant qu'il n'est pas deploye, le champ est absent -> discounted_price reste NULL (colonne vide).
const parseDiscounted = (raw) => {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const getWcCredentials = async () => {
  const result = await pool.query('SELECT consumer_key, consumer_secret, woocommerce_url FROM rewards_config LIMIT 1');
  if (result.rows.length === 0) throw new Error('Credentials WC non trouvees dans rewards_config');
  const row = result.rows[0];
  const urlResult = await pool.query("SELECT config_value FROM app_config WHERE config_key = 'wc_sync_wp_url'");
  const wcUrl = urlResult.rows[0]?.config_value || row.woocommerce_url;
  return {
    url: wcUrl.replace(/\/$/, ''),
    consumerKey: row.consumer_key,
    consumerSecret: row.consumer_secret,
  };
};

const fetchAllProducts = async (creds) => {
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

const fetchVariations = async (creds, productId) => {
  const all = [];
  let page = 1;
  while (true) {
    const res = await axios.get(`${creds.url}/wp-json/wc/v3/products/${productId}/variations`, {
      params: {
        consumer_key: creds.consumerKey,
        consumer_secret: creds.consumerSecret,
        per_page: PER_PAGE,
        page,
        status: 'any',
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

const runProductDbSync = async () => {
  const startTime = Date.now();
  const creds = await getWcCredentials();

  const products = await fetchAllProducts(creds);

  const liveRows = [];
  const errors = [];

  for (const p of products) {
    liveRows.push({
      wp_product_id: p.id,
      post_status: p.status,
      stock_status: p.stock_status || 'outofstock',
      stock: p.stock_quantity === null || p.stock_quantity === undefined ? 0 : Number(p.stock_quantity),
      manage_stock: !!p.manage_stock,
      discounted_price: parseDiscounted(p.wdr_discounted_price),
    });

    if (p.type === 'variable') {
      try {
        const variations = await fetchVariations(creds, p.id);
        for (const v of variations) {
          liveRows.push({
            wp_product_id: v.id,
            post_status: v.status,
            stock_status: v.stock_status || 'outofstock',
            stock: v.stock_quantity === null || v.stock_quantity === undefined ? 0 : Number(v.stock_quantity),
            manage_stock: !!v.manage_stock,
            discounted_price: parseDiscounted(v.wdr_discounted_price),
          });
        }
      } catch (err) {
        errors.push({ wp_product_id: p.id, error: err.message });
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }

  const client = await pool.connect();
  let result = { statusUpdated: 0, variableUpdated: 0 };
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE live_wc_products (
        wp_product_id bigint PRIMARY KEY,
        live_post_status text,
        live_stock_status text,
        live_stock numeric,
        live_manage_stock boolean,
        live_discounted_price numeric
      ) ON COMMIT DROP
    `);

    const CHUNK = 500;
    for (let i = 0; i < liveRows.length; i += CHUNK) {
      const chunk = liveRows.slice(i, i + CHUNK);
      const values = [];
      const params = [];
      chunk.forEach((r, idx) => {
        const base = idx * 6;
        values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6})`);
        params.push(r.wp_product_id, r.post_status, r.stock_status, r.stock, r.manage_stock, r.discounted_price);
      });
      await client.query(
        `INSERT INTO live_wc_products (wp_product_id, live_post_status, live_stock_status, live_stock, live_manage_stock, live_discounted_price) VALUES ${values.join(',')}`,
        params
      );
    }

    // 1) post_status / stock_status / stock / manage_stock / discounted_price pour simples, variations et woosb
    const r1 = await client.query(`
      UPDATE products p
      SET post_status = l.live_post_status,
          stock_status = l.live_stock_status,
          stock = l.live_stock,
          manage_stock = l.live_manage_stock,
          discounted_price = l.live_discounted_price,
          updated_at = NOW()
      FROM live_wc_products l
      WHERE l.wp_product_id = p.wp_product_id
        AND p.product_type IN ('simple', 'variation', 'woosb')
        AND (p.post_status IS DISTINCT FROM l.live_post_status
             OR p.stock_status IS DISTINCT FROM l.live_stock_status
             OR p.stock IS DISTINCT FROM l.live_stock
             OR p.manage_stock IS DISTINCT FROM l.live_manage_stock
             OR p.discounted_price IS DISTINCT FROM l.live_discounted_price)
    `);

    // 2) post_status pour les parents variable
    const r2 = await client.query(`
      UPDATE products p
      SET post_status = l.live_post_status, updated_at = NOW()
      FROM live_wc_products l
      WHERE l.wp_product_id = p.wp_product_id
        AND p.product_type = 'variable'
        AND p.post_status IS DISTINCT FROM l.live_post_status
    `);

    await client.query('COMMIT');

    result = { statusUpdated: r1.rowCount, variableUpdated: r2.rowCount };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const elapsed = Date.now() - startTime;
  return { ...result, totalRows: liveRows.length, errors, elapsed };
};

module.exports = { runProductDbSync };
