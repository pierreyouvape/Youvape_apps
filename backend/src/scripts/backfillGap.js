/**
 * Script de rattrapage : comble le trou août 2025 → janvier 2026
 *
 * Lit la BDD WooCommerce MySQL (préprod, container youvape-site-db-1)
 * et insère dans notre Postgres les données manquantes dans cet ordre :
 *   1. Produits manquants (parents d'abord, puis variations)
 *   2. Clients manquants
 *   3. Commandes manquantes + order_items
 *
 * Usage (sur le VPS depuis le container backend) :
 *   node src/scripts/backfillGap.js [--dry-run] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 *
 * Par défaut : --from 2025-08-01 --to 2026-02-01
 */

'use strict';

const mysql = require('mysql2/promise');
const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '../../../.env') });

// ─── Paramètres CLI ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const fromIdx = args.indexOf('--from');
const toIdx   = args.indexOf('--to');
const DATE_FROM = fromIdx !== -1 ? args[fromIdx + 1] : '2025-08-01';
const DATE_TO   = toIdx   !== -1 ? args[toIdx   + 1] : '2026-02-01';

// ─── Connexion MySQL (WC préprod) ──────────────────────────────────────────────
const mysqlConfig = {
  host: '127.0.0.1',
  port: 3306,
  user: 'youvape-vps',
  password: 'd79Ru8FznQdK9MQ2',
  database: 'youvape-vps',
  charset: 'utf8mb4',
};
const P = 'hJvjTIOu'; // préfixe des tables WC

// ─── Connexion Postgres ────────────────────────────────────────────────────────
const pg = new Pool({
  user:     process.env.DB_USER,
  host:     process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port:     process.env.DB_PORT || 5432,
});

// ─── Helpers ───────────────────────────────────────────────────────────────────
const log  = (...a) => console.log('[backfill]', ...a);
const warn = (...a) => console.warn('[backfill][WARN]', ...a);

let stats = { products: 0, customers: 0, orders: 0, items: 0, skipped: 0 };

async function pgRun(sql, params) {
  if (DRY_RUN) return { rowCount: 0, rows: [] };
  return pg.query(sql, params);
}

// ─── 1. PRODUITS ───────────────────────────────────────────────────────────────
async function backfillProducts(wc) {
  log('=== Étape 1 : Produits ===');

  // Tous les produits (product_id + variation_id) référencés dans la période
  const [rows] = await wc.execute(`
    SELECT DISTINCT CAST(im.meta_value AS UNSIGNED) AS wp_id
    FROM ${P}woocommerce_order_items oi
    JOIN ${P}wc_order_stats os ON os.order_id = oi.order_id
    JOIN ${P}woocommerce_order_itemmeta im
         ON im.order_item_id = oi.order_item_id
        AND im.meta_key IN ('_product_id', '_variation_id')
    WHERE os.date_created >= ? AND os.date_created < ?
      AND os.status NOT IN ('trash', 'wc-trash')
      AND oi.order_item_type = 'line_item'
      AND CAST(im.meta_value AS UNSIGNED) > 0
  `, [DATE_FROM, DATE_TO]);

  const wcIds = rows.map(r => r.wp_id);
  log(`  ${wcIds.length} wp_product_id distincts dans la période`);

  if (wcIds.length === 0) return;

  // Lesquels manquent dans notre Postgres ?
  const { rows: pgRows } = await pg.query(
    'SELECT wp_product_id FROM products WHERE wp_product_id = ANY($1)',
    [wcIds]
  );
  const existingSet = new Set(pgRows.map(r => Number(r.wp_product_id)));
  const missing = wcIds.filter(id => !existingSet.has(id));
  log(`  ${missing.length} produits absents de Postgres`);

  if (missing.length === 0) return;

  // Récupérer les données WC de ces produits
  const placeholders = missing.map((_, i) => `?`).join(',');
  const [products] = await wc.execute(`
    SELECT
      p.ID,
      p.post_type,
      p.post_status,
      p.post_title,
      p.post_parent,
      p.post_date,
      p.post_modified,
      pm_sku.meta_value  AS sku,
      pm_type.meta_value AS product_type
    FROM ${P}posts p
    LEFT JOIN ${P}postmeta pm_sku  ON pm_sku.post_id  = p.ID AND pm_sku.meta_key  = '_sku'
    LEFT JOIN ${P}postmeta pm_type ON pm_type.post_id = p.ID AND pm_type.meta_key = 'product_type'
    WHERE p.ID IN (${placeholders})
    ORDER BY p.post_parent ASC, p.ID ASC
  `, missing);

  // Insérer parents d'abord (post_parent = 0), puis variations
  const parents    = products.filter(p => p.post_parent === 0);
  const variations = products.filter(p => p.post_parent  >  0);

  for (const p of [...parents, ...variations]) {
    const productType = p.product_type || (p.post_type === 'product_variation' ? 'variation' : 'simple');

    try {
      await pgRun(`
        INSERT INTO products (
          wp_product_id, wp_parent_id, product_type,
          post_title, sku, post_status,
          post_date, post_modified,
          stock_status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'outofstock')
        ON CONFLICT (wp_product_id) DO NOTHING
      `, [
        p.ID,
        p.post_parent || null,
        productType,
        p.post_title,
        p.sku || null,
        p.post_status,
        p.post_date,
        p.post_modified,
      ]);
      stats.products++;
    } catch (err) {
      warn(`Produit #${p.ID} : ${err.message}`);
    }
  }

  log(`  → ${DRY_RUN ? '[DRY] ' : ''}${stats.products} produits insérés`);
}

// ─── 2. CLIENTS ────────────────────────────────────────────────────────────────
async function backfillCustomers(wc) {
  log('=== Étape 2 : Clients ===');

  // user_id WC distincts dans la période (via wc_customer_lookup)
  const [rows] = await wc.execute(`
    SELECT DISTINCT cl.user_id
    FROM ${P}wc_order_stats os
    JOIN ${P}wc_customer_lookup cl ON cl.customer_id = os.customer_id
    WHERE os.date_created >= ? AND os.date_created < ?
      AND os.status NOT IN ('trash', 'wc-trash')
      AND cl.user_id > 0
  `, [DATE_FROM, DATE_TO]);

  const wcUserIds = rows.map(r => r.user_id);
  log(`  ${wcUserIds.length} user_id distincts dans la période`);

  if (wcUserIds.length === 0) return;

  // Lesquels manquent dans notre Postgres ?
  const { rows: pgRows } = await pg.query(
    'SELECT wp_user_id FROM customers WHERE wp_user_id = ANY($1)',
    [wcUserIds]
  );
  const existingSet = new Set(pgRows.map(r => Number(r.wp_user_id)));
  const missing = wcUserIds.filter(id => !existingSet.has(id));
  log(`  ${missing.length} clients absents de Postgres`);

  if (missing.length === 0) return;

  const placeholders = missing.map(() => '?').join(',');
  const [users] = await wc.execute(`
    SELECT
      u.ID,
      u.user_email,
      u.user_registered,
      MAX(CASE WHEN um.meta_key = 'first_name'     THEN um.meta_value END) AS first_name,
      MAX(CASE WHEN um.meta_key = 'last_name'      THEN um.meta_value END) AS last_name,
      MAX(CASE WHEN um.meta_key = 'billing_phone'  THEN um.meta_value END) AS phone
    FROM ${P}users u
    LEFT JOIN ${P}usermeta um ON um.user_id = u.ID
      AND um.meta_key IN ('first_name','last_name','billing_phone')
    WHERE u.ID IN (${placeholders})
    GROUP BY u.ID, u.user_email, u.user_registered
  `, missing);

  for (const u of users) {
    try {
      await pgRun(`
        INSERT INTO customers (wp_user_id, email, first_name, last_name, user_registered)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (wp_user_id) DO NOTHING
      `, [
        u.ID,
        u.user_email,
        u.first_name || null,
        u.last_name  || null,
        u.user_registered,
      ]);
      stats.customers++;
    } catch (err) {
      warn(`Client #${u.ID} : ${err.message}`);
    }
  }

  log(`  → ${DRY_RUN ? '[DRY] ' : ''}${stats.customers} clients insérés`);
}

// ─── 3. COMMANDES ──────────────────────────────────────────────────────────────
async function backfillOrders(wc) {
  log('=== Étape 3 : Commandes ===');

  // Toutes les commandes WC de la période, avec leurs données essentielles
  const [orders] = await wc.execute(`
    SELECT
      wo.id                    AS wp_order_id,
      wo.status,
      wo.customer_id           AS wc_customer_id,
      wo.billing_email,
      wo.date_created_gmt      AS date_created,
      wo.date_updated_gmt      AS date_modified,
      wo.transaction_id,
      wo.payment_method_title,
      wo.total_amount          AS order_total,
      wo.tax_amount            AS order_tax,
      ood.shipping_total_amount  AS order_shipping,
      ood.discount_total_amount  AS cart_discount,
      ood.date_paid_gmt        AS paid_date,
      ood.prices_include_tax,
      ood.created_via,
      -- Adresse facturation
      ba.first_name  AS billing_first_name,
      ba.last_name   AS billing_last_name,
      ba.address_1   AS billing_address_1,
      ba.address_2   AS billing_address_2,
      ba.city        AS billing_city,
      ba.postcode    AS billing_postcode,
      ba.country     AS billing_country,
      ba.phone       AS billing_phone,
      -- Adresse livraison
      sa.first_name  AS shipping_first_name,
      sa.last_name   AS shipping_last_name,
      sa.address_1   AS shipping_address_1,
      sa.address_2   AS shipping_address_2,
      sa.city        AS shipping_city,
      sa.postcode    AS shipping_postcode,
      sa.country     AS shipping_country,
      -- customer lookup → user_id réel
      cl.user_id     AS wp_customer_id
    FROM ${P}wc_orders wo
    LEFT JOIN ${P}wc_order_operational_data ood ON ood.order_id = wo.id
    LEFT JOIN ${P}wc_order_addresses ba ON ba.order_id = wo.id AND ba.address_type = 'billing'
    LEFT JOIN ${P}wc_order_addresses sa ON sa.order_id = wo.id AND sa.address_type = 'shipping'
    LEFT JOIN ${P}wc_customer_lookup cl ON cl.customer_id = wo.customer_id
    WHERE wo.date_created_gmt >= ? AND wo.date_created_gmt < ?
      AND wo.status NOT IN ('trash', 'wc-trash')
      AND wo.type = 'shop_order'
    ORDER BY wo.id ASC
  `, [DATE_FROM, DATE_TO]);

  log(`  ${orders.length} commandes WC dans la période`);

  // Lesquelles existent déjà ?
  const wcOrderIds = orders.map(o => o.wp_order_id);
  const { rows: pgRows } = await pg.query(
    'SELECT wp_order_id FROM orders WHERE wp_order_id = ANY($1)',
    [wcOrderIds]
  );
  const existingSet = new Set(pgRows.map(r => Number(r.wp_order_id)));
  const toInsert = orders.filter(o => !existingSet.has(Number(o.wp_order_id)));
  log(`  ${existingSet.size} déjà en Postgres, ${toInsert.length} à importer`);

  if (toInsert.length === 0) return;

  // Récupérer les métadonnées utiles en une seule requête groupée
  const orderIds = toInsert.map(o => o.wp_order_id);
  const metaPlaceholders = orderIds.map(() => '?').join(',');
  const [metaRows] = await wc.execute(`
    SELECT order_id, meta_key, meta_value
    FROM ${P}wc_orders_meta
    WHERE order_id IN (${metaPlaceholders})
      AND meta_key IN (
        '_mollie_payment_id', '_mollie_order_id', '_mollie_payment_mode',
        '_mollie_customer_id', '_mollie_payment_instructions', '_mollie_paid_and_processed',
        '_wc_order_attribution_source_type', '_wc_order_attribution_referrer',
        '_wc_order_attribution_utm_source', '_wc_order_attribution_utm_medium',
        '_wc_order_attribution_utm_campaign', '_wc_order_attribution_utm_content',
        '_wc_order_attribution_utm_term', '_wc_order_attribution_session_entry',
        '_wc_order_attribution_session_start_time', '_wc_order_attribution_session_pages',
        '_wc_order_attribution_session_count', '_wc_order_attribution_user_agent',
        '_wc_order_attribution_device_type',
        'sendcloud_tracking_number', '_wc_shipping_method',
        '_billing_tax', 'is_vat_exempt', '_wdr_discounts'
      )
  `, orderIds);

  // Indexer par order_id → { meta_key: meta_value }
  const metaByOrder = {};
  for (const m of metaRows) {
    if (!metaByOrder[m.order_id]) metaByOrder[m.order_id] = {};
    metaByOrder[m.order_id][m.meta_key] = m.meta_value;
  }

  // Récupérer les order_items de toutes ces commandes
  const [itemRows] = await wc.execute(`
    SELECT
      oi.order_id,
      oi.order_item_id,
      oi.order_item_name,
      oi.order_item_type,
      MAX(CASE WHEN im.meta_key = '_product_id'    THEN im.meta_value END) AS product_id,
      MAX(CASE WHEN im.meta_key = '_variation_id'  THEN im.meta_value END) AS variation_id,
      MAX(CASE WHEN im.meta_key = '_qty'           THEN im.meta_value END) AS qty,
      MAX(CASE WHEN im.meta_key = '_line_subtotal' THEN im.meta_value END) AS line_subtotal,
      MAX(CASE WHEN im.meta_key = '_line_subtotal_tax' THEN im.meta_value END) AS line_subtotal_tax,
      MAX(CASE WHEN im.meta_key = '_line_total'    THEN im.meta_value END) AS line_total,
      MAX(CASE WHEN im.meta_key = '_line_tax'      THEN im.meta_value END) AS line_tax,
      MAX(CASE WHEN im.meta_key = '_line_tax_data' THEN im.meta_value END) AS line_tax_data,
      MAX(CASE WHEN im.meta_key = '_tax_class'     THEN im.meta_value END) AS tax_class,
      MAX(CASE WHEN im.meta_key = '_reduced_stock' THEN im.meta_value END) AS reduced_stock,
      MAX(CASE WHEN im.meta_key = '_wc_cog_item_cost'       THEN im.meta_value END) AS item_cost,
      MAX(CASE WHEN im.meta_key = '_wc_cog_item_total_cost' THEN im.meta_value END) AS item_total_cost,
      MAX(CASE WHEN im.meta_key = '_wdr_discounts' THEN im.meta_value END) AS wdr_discounts,
      MAX(CASE WHEN im.meta_key = '_advanced_woo_discount_item_total_discount' THEN im.meta_value END) AS advanced_discount,
      MAX(CASE WHEN im.meta_key = 'cost'           THEN im.meta_value END) AS shipping_cost,
      MAX(CASE WHEN im.meta_key = 'method_id'      THEN im.meta_value END) AS shipping_method_id,
      MAX(CASE WHEN im.meta_key = 'discount_amount' THEN im.meta_value END) AS coupon_discount,
      MAX(CASE WHEN im.meta_key = 'discount_amount_tax' THEN im.meta_value END) AS coupon_discount_tax,
      MAX(CASE WHEN im.meta_key = 'coupon_info'    THEN im.meta_value END) AS coupon_info
    FROM ${P}woocommerce_order_items oi
    LEFT JOIN ${P}woocommerce_order_itemmeta im ON im.order_item_id = oi.order_item_id
    WHERE oi.order_id IN (${metaPlaceholders})
      AND oi.order_item_type IN ('line_item','shipping','coupon','fee','tax')
    GROUP BY oi.order_id, oi.order_item_id, oi.order_item_name, oi.order_item_type
    ORDER BY oi.order_id, oi.order_item_id
  `, orderIds);

  // Indexer items par order_id
  const itemsByOrder = {};
  for (const item of itemRows) {
    if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
    itemsByOrder[item.order_id].push(item);
  }

  // Détecter la shipping_method depuis les items de type 'shipping'
  // (méthode de livraison = order_item_name de l'item shipping)
  // et conserver sendcloud_tracking_number depuis les meta

  const { applyPaymentCostToOrder } = require('../controllers/paymentController');
  const { applyShippingCostToOrder } = require('../controllers/shippingController');

  let batchDone = 0;
  for (const order of toInsert) {
    const meta    = metaByOrder[order.wp_order_id] || {};
    const items   = itemsByOrder[order.wp_order_id] || [];

    // Déduire shipping_method depuis l'item shipping
    const shippingItem = items.find(i => i.order_item_type === 'shipping');
    const shippingMethod = shippingItem ? shippingItem.order_item_name : (meta['_wc_shipping_method'] || null);
    const trackingNumber = meta['sendcloud_tracking_number'] || null;

    const postStatus = order.status.startsWith('wc-') ? order.status : 'wc-' + order.status;

    try {
      await pgRun(`
        INSERT INTO orders (
          wp_order_id, wp_customer_id, post_status,
          order_total, order_tax, order_shipping, cart_discount,
          payment_method_title,
          billing_first_name, billing_last_name,
          billing_address_1, billing_address_2,
          billing_city, billing_postcode, billing_country,
          billing_email, billing_phone,
          shipping_first_name, shipping_last_name,
          shipping_address_1, shipping_address_2,
          shipping_city, shipping_postcode, shipping_country,
          shipping_method, tracking_number,
          post_date, post_modified, paid_date,
          transaction_id,
          mollie_payment_id, mollie_order_id,
          mollie_payment_mode, mollie_customer_id,
          mollie_payment_instructions, mollie_paid_and_processed,
          attribution_source_type, attribution_referrer,
          attribution_utm_source, attribution_utm_medium,
          attribution_utm_campaign, attribution_utm_content, attribution_utm_term,
          attribution_session_entry, attribution_session_start_time,
          attribution_session_pages, attribution_session_count,
          attribution_user_agent, attribution_device_type,
          billing_tax, is_vat_exempt,
          wdr_discounts, created_via, prices_include_tax
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
          $31,$32,$33,$34,$35,$36,$37,$38,$39,$40,
          $41,$42,$43,$44,$45,$46,$47,$48,$49,$50,
          $51,$52,$53,$54
        )
        ON CONFLICT (wp_order_id) DO NOTHING
      `, [
        order.wp_order_id,
        order.wp_customer_id || null,
        postStatus,
        order.order_total  || 0,
        order.order_tax    || 0,
        order.order_shipping || 0,
        order.cart_discount  || 0,
        order.payment_method_title || null,
        order.billing_first_name || null,
        order.billing_last_name  || null,
        order.billing_address_1  || null,
        order.billing_address_2  || null,
        order.billing_city       || null,
        order.billing_postcode   || null,
        order.billing_country    || null,
        order.billing_email      || null,
        order.billing_phone      || null,
        order.shipping_first_name || null,
        order.shipping_last_name  || null,
        order.shipping_address_1  || null,
        order.shipping_address_2  || null,
        order.shipping_city       || null,
        order.shipping_postcode   || null,
        order.shipping_country    || null,
        shippingMethod,
        trackingNumber,
        order.date_created,
        order.date_modified,
        order.paid_date || null,
        order.transaction_id || null,
        meta['_mollie_payment_id']            || null,
        meta['_mollie_order_id']              || null,
        meta['_mollie_payment_mode']          || null,
        meta['_mollie_customer_id']           || null,
        meta['_mollie_payment_instructions']  || null,
        meta['_mollie_paid_and_processed'] === '1' ? true : false,
        meta['_wc_order_attribution_source_type']         || null,
        meta['_wc_order_attribution_referrer']             || null,
        meta['_wc_order_attribution_utm_source']           || null,
        meta['_wc_order_attribution_utm_medium']           || null,
        meta['_wc_order_attribution_utm_campaign']         || null,
        meta['_wc_order_attribution_utm_content']          || null,
        meta['_wc_order_attribution_utm_term']             || null,
        meta['_wc_order_attribution_session_entry']        || null,
        meta['_wc_order_attribution_session_start_time']   || null,
        meta['_wc_order_attribution_session_pages']  ? parseInt(meta['_wc_order_attribution_session_pages'])  : null,
        meta['_wc_order_attribution_session_count']  ? parseInt(meta['_wc_order_attribution_session_count'])  : null,
        meta['_wc_order_attribution_user_agent']           || null,
        meta['_wc_order_attribution_device_type']          || null,
        meta['_billing_tax']   || null,
        meta['is_vat_exempt'] === 'yes' ? true : false,
        meta['_wdr_discounts'] ? (() => { try { return JSON.parse(meta['_wdr_discounts']); } catch { return null; } })() : null,
        order.created_via || null,
        order.prices_include_tax ? true : false,
      ]);

      // Order items
      for (const item of items) {
        if (item.order_item_type === 'line_item') {
          await pgRun(`
            INSERT INTO order_items (
              wp_order_id, order_item_id, order_item_name, order_item_type,
              product_id, variation_id, qty,
              line_subtotal, line_subtotal_tax, line_total, line_tax,
              tax_class, line_tax_data, reduced_stock,
              item_cost, item_total_cost, wdr_discounts, advanced_discount
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
          `, [
            order.wp_order_id,
            item.order_item_id,
            item.order_item_name,
            'line_item',
            item.product_id   ? parseInt(item.product_id)   : null,
            item.variation_id ? parseInt(item.variation_id) : null,
            item.qty          ? parseInt(item.qty)          : 0,
            parseFloat(item.line_subtotal)     || 0,
            parseFloat(item.line_subtotal_tax) || 0,
            parseFloat(item.line_total)        || 0,
            parseFloat(item.line_tax)          || 0,
            item.tax_class || null,
            item.line_tax_data ? (() => { try { return JSON.parse(item.line_tax_data); } catch { return null; } })() : null,
            item.reduced_stock ? parseInt(item.reduced_stock) > 0 : false,
            item.item_cost       ? parseFloat(item.item_cost)       : null,
            item.item_total_cost ? parseFloat(item.item_total_cost) : null,
            item.wdr_discounts   ? (() => { try { return JSON.parse(item.wdr_discounts); } catch { return null; } })() : null,
            item.advanced_discount ? parseFloat(item.advanced_discount) : null,
          ]);
          stats.items++;

        } else if (item.order_item_type === 'coupon') {
          await pgRun(`
            INSERT INTO order_items (
              wp_order_id, order_item_id, order_item_name, order_item_type,
              line_total, line_tax
            ) VALUES ($1,$2,$3,$4,$5,$6)
          `, [
            order.wp_order_id, item.order_item_id,
            item.order_item_name, 'coupon',
            parseFloat(item.coupon_discount)     || 0,
            parseFloat(item.coupon_discount_tax) || 0,
          ]);
          stats.items++;

        } else if (item.order_item_type === 'fee') {
          await pgRun(`
            INSERT INTO order_items (
              wp_order_id, order_item_id, order_item_name, order_item_type,
              line_total, line_tax, tax_class
            ) VALUES ($1,$2,$3,$4,$5,$6,$7)
          `, [
            order.wp_order_id, item.order_item_id,
            item.order_item_name, 'fee',
            parseFloat(item.line_total) || 0,
            parseFloat(item.line_tax)   || 0,
            item.tax_class || null,
          ]);
          stats.items++;
        }
        // Les items 'shipping' et 'tax' ne sont pas stockés dans order_items chez nous
      }

      // Calcul frais de port et paiement (même logique que wcSyncService)
      if (!DRY_RUN) {
        await applyPaymentCostToOrder(
          order.wp_order_id,
          order.payment_method_title,
          order.shipping_country,
          order.order_total
        );
        await applyShippingCostToOrder(order.wp_order_id);
      }

      stats.orders++;
      batchDone++;
      if (batchDone % 500 === 0) {
        log(`  ... ${batchDone}/${toInsert.length} commandes traitées`);
      }

    } catch (err) {
      warn(`Commande #${order.wp_order_id} : ${err.message}`);
      stats.skipped++;
    }
  }

  log(`  → ${DRY_RUN ? '[DRY] ' : ''}${stats.orders} commandes insérées, ${stats.items} items, ${stats.skipped} erreurs`);
}

// ─── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  log(`Démarrage du rattrapage ${DATE_FROM} → ${DATE_TO}${DRY_RUN ? ' (DRY RUN)' : ''}`);

  const wc = await mysql.createConnection(mysqlConfig);
  log('Connexion MySQL OK');

  try {
    await backfillProducts(wc);
    await backfillCustomers(wc);
    await backfillOrders(wc);
  } finally {
    await wc.end();
    await pg.end();
  }

  log('=== Terminé ===');
  log(`Produits  : ${stats.products}`);
  log(`Clients   : ${stats.customers}`);
  log(`Commandes : ${stats.orders}`);
  log(`Items     : ${stats.items}`);
  log(`Erreurs   : ${stats.skipped}`);
}

main().catch(err => {
  console.error('[backfill][FATAL]', err.message);
  process.exit(1);
});
