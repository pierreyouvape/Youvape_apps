/**
 * Product DB Sync Service
 * Resynchronise post_status / stock_status / stock / track_stock (ATUM)
 * depuis la base MySQL WordPress (wp_posts, wp_postmeta, atum_product_data)
 * vers la table Postgres `products`.
 *
 * Les webhooks YouSync couvrent la plupart des changements en temps reel,
 * mais certaines operations (edition groupee WC, ATUM bulk edit) ne
 * declenchent pas toujours de webhook par produit. Ce job de rattrapage
 * tourne chaque nuit pour combler les ecarts residuels.
 */

const mysql = require('mysql2/promise');
const pool = require('../config/database');

const MYSQL_CONFIG = {
  host: 'youvape-site-db-1',
  port: 3306,
  user: 'youvape-vps',
  password: 'd79Ru8FznQdK9MQ2',
  database: 'youvape-vps',
  charset: 'utf8mb4',
};
const P = 'hJvjTIOu'; // prefixe des tables WordPress/WooCommerce

const runProductDbSync = async () => {
  const startTime = Date.now();
  const wc = await mysql.createConnection(MYSQL_CONFIG);

  let rows;
  try {
    [rows] = await wc.query(`
      SELECT p.ID as wp_product_id, p.post_status,
        MAX(CASE WHEN pm.meta_key = '_stock_status' THEN pm.meta_value END) as stock_status,
        MAX(CASE WHEN pm.meta_key = '_stock' THEN pm.meta_value END) as stock,
        a.atum_controlled
      FROM ${P}posts p
      LEFT JOIN ${P}postmeta pm ON pm.post_id = p.ID AND pm.meta_key IN ('_stock_status', '_stock')
      LEFT JOIN ${P}atum_product_data a ON a.product_id = p.ID
      WHERE p.post_type IN ('product', 'product_variation')
      GROUP BY p.ID, p.post_status, a.atum_controlled
    `);
  } finally {
    await wc.end();
  }

  const client = await pool.connect();
  let result = { statusUpdated: 0, variableUpdated: 0, trackStockUpdated: 0 };
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE live_wc_products (
        wp_product_id bigint PRIMARY KEY,
        live_post_status text,
        live_stock_status text,
        live_stock numeric,
        atum_controlled boolean
      ) ON COMMIT DROP
    `);

    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const values = [];
      const params = [];
      chunk.forEach((r, idx) => {
        const base = idx * 5;
        values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5})`);
        params.push(
          r.wp_product_id,
          r.post_status,
          r.stock_status || 'outofstock',
          r.stock === null ? 0 : Number(r.stock),
          r.atum_controlled === null ? null : r.atum_controlled === 1
        );
      });
      await client.query(
        `INSERT INTO live_wc_products (wp_product_id, live_post_status, live_stock_status, live_stock, atum_controlled) VALUES ${values.join(',')}`,
        params
      );
    }

    // 1) post_status / stock_status / stock pour simples et variations
    const r1 = await client.query(`
      UPDATE products p
      SET post_status = l.live_post_status,
          stock_status = l.live_stock_status,
          stock = l.live_stock,
          updated_at = NOW()
      FROM live_wc_products l
      WHERE l.wp_product_id = p.wp_product_id
        AND p.product_type IN ('simple', 'variation')
        AND (p.post_status IS DISTINCT FROM l.live_post_status
             OR p.stock_status IS DISTINCT FROM l.live_stock_status
             OR p.stock IS DISTINCT FROM l.live_stock)
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

    // 3) track_stock depuis le switch ATUM "Suivi de stock" (simples, variations, woosb)
    const r3 = await client.query(`
      UPDATE products p
      SET track_stock = l.atum_controlled, updated_at = NOW()
      FROM live_wc_products l
      WHERE l.wp_product_id = p.wp_product_id
        AND p.product_type IN ('simple', 'variation', 'woosb')
        AND l.atum_controlled IS NOT NULL
        AND p.track_stock IS DISTINCT FROM l.atum_controlled
    `);

    await client.query('COMMIT');

    result = { statusUpdated: r1.rowCount, variableUpdated: r2.rowCount, trackStockUpdated: r3.rowCount };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const elapsed = Date.now() - startTime;
  return { ...result, totalRows: rows.length, elapsed };
};

module.exports = { runProductDbSync };
