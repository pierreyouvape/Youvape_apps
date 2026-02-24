#!/usr/bin/env node
/**
 * Import historique WordPress MySQL → PostgreSQL
 *
 * Ordre d'import :
 *   1. Produits (simple, variable, variation, woosb)
 *   2. Clients (wp_users + wp_usermeta)
 *   3. Commandes (wp_posts + wp_postmeta)
 *   4. Articles de commande (wp_woocommerce_order_items + wp_woocommerce_order_itemmeta)
 *
 * Stratégie : UPSERT complet (ON CONFLICT DO UPDATE) — tout est écrasable.
 * Le prefix WP est : hJvjTIOu
 * Prérequis réseau (deux docker compose séparés) :
 *   # Connecter le backend au réseau du site WordPress (avant l'import)
 *   docker network connect youvape-site_default youvape_backend
 *
 *   # Lancer le script
 *   docker exec youvape_backend node /app/migrations/import-wp-to-pg.js
 *
 *   # Déconnecter après l'import (optionnel mais propre)
 *   docker network disconnect youvape-site_default youvape_backend
 */

'use strict';

const mysql = require('mysql2/promise');
const { Pool } = require('pg');

// ─── Configuration ────────────────────────────────────────────────────────────

const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST || 'youvape-site-db-1',
  user: process.env.MYSQL_USER || 'youvape-vps',
  password: process.env.MYSQL_PASSWORD || 'd79Ru8FznQdK9MQ2',
  database: process.env.MYSQL_DB || 'youvape-vps',
  namedPlaceholders: true,
  dateStrings: true,      // On récupère les dates telles quelles (chaîne, heure Paris)
  charset: 'utf8mb4',
};

const PG_CONFIG = {
  user: process.env.DB_USER || 'youvape',
  host: process.env.DB_HOST || 'postgres',
  database: process.env.DB_NAME || 'youvape_db',
  password: process.env.DB_PASSWORD || 'Lucky0606@',
  port: parseInt(process.env.DB_PORT || '5432'),
};

const P = 'hJvjTIOu'; // Prefix WordPress

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convertit '0000-00-00 00:00:00' ou '' ou null en null */
function safeDate(val) {
  if (!val || val === '0000-00-00 00:00:00' || val === '0000-00-00') return null;
  return val;
}

/** Convertit '1' / 'yes' en true, le reste en false */
function safeBool(val) {
  return val === '1' || val === 'yes' || val === true;
}

/** parseInt sécurisé, retourne null si invalide ou 0 */
function safeInt(val, zeroAsNull = false) {
  const n = parseInt(val, 10);
  if (isNaN(n)) return null;
  if (zeroAsNull && n === 0) return null;
  return n;
}

/** parseFloat sécurisé, retourne 0 si invalide */
function safeFloat(val, defaultVal = 0) {
  const f = parseFloat(val);
  return isNaN(f) ? defaultVal : f;
}

/** Tente de parser du JSON, retourne null si échec */
function safeJson(val) {
  if (!val) return null;
  try { return JSON.parse(val); } catch { return null; }
}

/** Log avec timestamp */
function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${msg}`);
}

// ─── Collecteur de meta en pivot ──────────────────────────────────────────────

/**
 * Charge tous les postmeta d'un ensemble de post IDs depuis MySQL.
 * Retourne une Map<post_id, Map<meta_key, meta_value>>.
 */
async function fetchPostMeta(mysql, ids) {
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await mysql.execute(
    `SELECT post_id, meta_key, meta_value FROM ${P}postmeta WHERE post_id IN (${placeholders})`,
    ids
  );
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.post_id)) map.set(row.post_id, new Map());
    map.get(row.post_id).set(row.meta_key, row.meta_value);
  }
  return map;
}

/**
 * Charge tous les usermeta d'un ensemble de user IDs depuis MySQL.
 * Retourne une Map<user_id, Map<meta_key, meta_value>>.
 */
async function fetchUserMeta(mysql, ids) {
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await mysql.execute(
    `SELECT user_id, meta_key, meta_value FROM ${P}usermeta WHERE user_id IN (${placeholders})`,
    ids
  );
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.user_id)) map.set(row.user_id, new Map());
    map.get(row.user_id).set(row.meta_key, row.meta_value);
  }
  return map;
}

// ─── 1. PRODUITS ──────────────────────────────────────────────────────────────

async function importProducts(mysqlConn, pg) {
  log('━━━ Import Produits ━━━');

  // Récupérer le type de chaque produit via term_relationships
  const [termRows] = await mysqlConn.execute(`
    SELECT tr.object_id, t.name AS product_type
    FROM ${P}term_relationships tr
    JOIN ${P}term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
    JOIN ${P}terms t ON tt.term_id = t.term_id
    WHERE tt.taxonomy = 'product_type'
  `);
  const productTypeMap = new Map();
  for (const row of termRows) {
    productTypeMap.set(Number(row.object_id), row.product_type);
  }

  // Produits (simple, variable, woosb) + variations
  const [products] = await mysqlConn.execute(`
    SELECT ID, post_author, post_date, post_title, post_excerpt, post_status,
           post_modified, guid, post_parent, post_type
    FROM ${P}posts
    WHERE post_type IN ('product', 'product_variation')
      AND post_status != 'auto-draft'
    ORDER BY ID
  `);

  log(`  → ${products.length} produits/variations trouvés`);

  const BATCH = 200;
  let done = 0;
  let errors = 0;

  for (let i = 0; i < products.length; i += BATCH) {
    const batch = products.slice(i, i + BATCH);
    const batchIds = batch.map(p => p.ID);
    const metaMap = await fetchPostMeta(mysqlConn, batchIds);

    for (const p of batch) {
      const m = metaMap.get(p.ID) || new Map();
      const isVariation = p.post_type === 'product_variation';
      const productType = isVariation ? 'variation' : (productTypeMap.get(Number(p.ID)) || 'simple');
      const parentId = p.post_parent > 0 ? p.post_parent : null;

      // Attributs variation (pa_*)
      let productAttributes = null;
      if (isVariation) {
        const attrs = {};
        for (const [k, v] of m) {
          if (k.startsWith('attribute_pa_') || k.startsWith('attribute_')) {
            attrs[k.replace(/^attribute_/, '')] = v;
          }
        }
        if (Object.keys(attrs).length) productAttributes = attrs;
      } else {
        productAttributes = safeJson(m.get('_product_attributes'));
      }

      // woosb_ids : parse la chaîne "id1,id2" ou JSON
      let woosb_ids = null;
      if (productType === 'woosb') {
        const raw = m.get('woosb_ids');
        if (raw) {
          if (raw.startsWith('[')) {
            woosb_ids = safeJson(raw);
          } else {
            // Format "31088/1,15699/1,..."
            woosb_ids = raw.split(',').map(s => {
              const [id] = s.split('/');
              return parseInt(id, 10);
            }).filter(n => !isNaN(n));
          }
        }
      }

      try {
        await pg.query(`
          INSERT INTO products (
            wp_product_id, product_type, wp_parent_id, post_author,
            post_date, post_title, post_excerpt, post_status, post_modified, guid,
            sku, total_sales, sold_individually, weight, stock, stock_status,
            product_attributes, wc_productdata_options, wc_cog_cost,
            product_join_stories, thumbnail_id, regular_price, price,
            product_version, woovr_show_image, woovr_show_price, woovr_show_description,
            yoast_wpseo_linkdex, yoast_wpseo_estimated_reading_time_minutes,
            product_with_nicotine, product_excerpt_custom, yoast_indexnow_last_ping,
            faq_title, accodion_list, product_tip,
            variation_description, manage_stock, global_unique_id,
            woosb_ids, updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
            $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
            $24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,
            $36,$37,$38,$39,NOW()
          )
          ON CONFLICT (wp_product_id) DO UPDATE SET
            product_type = EXCLUDED.product_type,
            wp_parent_id = EXCLUDED.wp_parent_id,
            post_title = EXCLUDED.post_title,
            post_excerpt = EXCLUDED.post_excerpt,
            post_status = EXCLUDED.post_status,
            post_modified = EXCLUDED.post_modified,
            sku = EXCLUDED.sku,
            total_sales = EXCLUDED.total_sales,
            sold_individually = EXCLUDED.sold_individually,
            weight = EXCLUDED.weight,
            stock = EXCLUDED.stock,
            stock_status = EXCLUDED.stock_status,
            product_attributes = EXCLUDED.product_attributes,
            wc_productdata_options = EXCLUDED.wc_productdata_options,
            wc_cog_cost = EXCLUDED.wc_cog_cost,
            thumbnail_id = EXCLUDED.thumbnail_id,
            regular_price = EXCLUDED.regular_price,
            price = EXCLUDED.price,
            product_with_nicotine = EXCLUDED.product_with_nicotine,
            manage_stock = EXCLUDED.manage_stock,
            global_unique_id = EXCLUDED.global_unique_id,
            woosb_ids = EXCLUDED.woosb_ids,
            variation_description = EXCLUDED.variation_description,
            post_modified = EXCLUDED.post_modified,
            updated_at = NOW()
        `, [
          p.ID,                                                   // $1
          productType,                                            // $2
          parentId,                                               // $3
          p.post_author || null,                                  // $4
          safeDate(p.post_date),                                  // $5
          p.post_title || null,                                   // $6
          p.post_excerpt || null,                                 // $7
          p.post_status || null,                                  // $8
          safeDate(p.post_modified),                              // $9
          p.guid || null,                                         // $10
          m.get('_sku') || null,                                  // $11
          safeInt(m.get('total_sales')),                          // $12
          safeBool(m.get('_sold_individually')),                  // $13
          m.get('_weight') || null,                               // $14
          safeInt(m.get('_stock')),                               // $15
          m.get('_stock_status') || null,                         // $16
          productAttributes ? JSON.stringify(productAttributes) : null, // $17
          safeJson(m.get('wc_productdata_options')) ? JSON.stringify(safeJson(m.get('wc_productdata_options'))) : null, // $18
          safeFloat(m.get('_wc_cog_cost'), null),                 // $19
          m.get('product_join_stories') || null,                  // $20
          safeInt(m.get('_thumbnail_id')),                        // $21
          safeFloat(m.get('_regular_price'), null),               // $22
          safeFloat(m.get('_price'), null),                       // $23
          m.get('_product_version') || null,                      // $24
          m.get('_woovr_show_image') || null,                     // $25
          m.get('_woovr_show_price') || null,                     // $26
          m.get('_woovr_show_description') || null,               // $27
          m.get('_yoast_wpseo_linkdex') || null,                  // $28
          safeInt(m.get('_yoast_wpseo_estimated-reading-time-minutes')), // $29
          safeBool(m.get('product_with_nicotine') || m.get('_product_with_nicotine')), // $30
          m.get('product_excerpt_custom') || null,                // $31
          m.get('_yoast_indexnow_last_ping') || null,             // $32
          m.get('faq_title') || null,                             // $33
          safeInt(m.get('accodion_list')),                        // $34
          m.get('product_tip') || null,                           // $35
          m.get('_variation_description') || null,                // $36
          safeBool(m.get('_manage_stock')),                       // $37
          m.get('_global_unique_id') || null,                     // $38
          woosb_ids ? JSON.stringify(woosb_ids) : null,           // $39
        ]);
        done++;
      } catch (err) {
        errors++;
        if (errors <= 5) log(`  ✗ Product #${p.ID}: ${err.message}`);
      }
    }

    log(`  Produits : ${Math.min(i + BATCH, products.length)}/${products.length}`);
  }

  log(`  ✓ Produits importés : ${done} OK, ${errors} erreurs`);
}

// ─── 2. CLIENTS ───────────────────────────────────────────────────────────────

async function importCustomers(mysqlConn, pg) {
  log('━━━ Import Clients ━━━');

  const [users] = await mysqlConn.execute(`
    SELECT ID, user_email, user_registered
    FROM ${P}users
    ORDER BY ID
  `);

  log(`  → ${users.length} utilisateurs trouvés`);

  const BATCH = 500;
  let done = 0;
  let errors = 0;

  for (let i = 0; i < users.length; i += BATCH) {
    const batch = users.slice(i, i + BATCH);
    const batchIds = batch.map(u => u.ID);
    const metaMap = await fetchUserMeta(mysqlConn, batchIds);

    for (const u of batch) {
      const m = metaMap.get(u.ID) || new Map();

      const sessionStartRaw = m.get('_wc_order_attribution_session_start_time');
      const dobRaw = m.get('wlr_dob');

      try {
        await pg.query(`
          INSERT INTO customers (
            wp_user_id, email, user_registered,
            first_name, last_name,
            session_start_time, session_pages, session_count, device_type,
            date_of_birth, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
          ON CONFLICT (wp_user_id) DO UPDATE SET
            email = EXCLUDED.email,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            session_start_time = EXCLUDED.session_start_time,
            session_pages = EXCLUDED.session_pages,
            session_count = EXCLUDED.session_count,
            device_type = EXCLUDED.device_type,
            date_of_birth = EXCLUDED.date_of_birth,
            updated_at = NOW()
        `, [
          u.ID,
          u.user_email || '',
          safeDate(u.user_registered),
          m.get('first_name') || null,
          m.get('last_name') || null,
          safeDate(sessionStartRaw),
          safeInt(m.get('_wc_order_attribution_session_pages')),
          safeInt(m.get('_wc_order_attribution_session_count')),
          m.get('_wc_order_attribution_device_type') || null,
          safeDate(dobRaw),
        ]);
        done++;
      } catch (err) {
        errors++;
        if (errors <= 5) log(`  ✗ Customer #${u.ID}: ${err.message}`);
      }
    }

    log(`  Clients : ${Math.min(i + BATCH, users.length)}/${users.length}`);
  }

  log(`  ✓ Clients importés : ${done} OK, ${errors} erreurs`);
}

// ─── 3. COMMANDES ─────────────────────────────────────────────────────────────

async function importOrders(mysqlConn, pg) {
  log('━━━ Import Commandes ━━━');

  const [orders] = await mysqlConn.execute(`
    SELECT ID, post_author, post_date, post_status, post_modified, guid
    FROM ${P}posts
    WHERE post_type = 'shop_order'
      AND post_status != 'auto-draft'
    ORDER BY ID
  `);

  log(`  → ${orders.length} commandes trouvées`);

  const BATCH = 200;
  let done = 0;
  let errors = 0;

  for (let i = 0; i < orders.length; i += BATCH) {
    const batch = orders.slice(i, i + BATCH);
    const batchIds = batch.map(o => o.ID);
    const metaMap = await fetchPostMeta(mysqlConn, batchIds);

    for (const o of batch) {
      const m = metaMap.get(o.ID) || new Map();

      const customerId = safeInt(m.get('_customer_user'), true); // 0 → null (invité)

      // Attribution
      const sessionStartRaw = m.get('_wc_order_attribution_session_start_time');
      const sessionPages = safeInt(m.get('_wc_order_attribution_session_pages'));
      const sessionCount = safeInt(m.get('_wc_order_attribution_session_count'));

      // Mollie
      const datePaid = safeInt(m.get('_date_paid'));
      const paidDateRaw = m.get('_paid_date');

      // Mondial Relay
      const mrRaw = m.get('_wms_mondial_relay_pickup_info');
      const mrJson = mrRaw ? safeJson(mrRaw) : null;

      // WDR discounts
      const wdrRaw = m.get('_wdr_discounts');
      const wdrJson = wdrRaw ? safeJson(wdrRaw) : null;

      try {
        await pg.query(`
          INSERT INTO orders (
            wp_order_id, wp_customer_id, guid, post_date, post_status, post_modified,
            payment_method_title, created_via,
            billing_first_name, billing_last_name,
            billing_address_1, billing_address_2,
            billing_city, billing_postcode, billing_country,
            billing_email, billing_phone,
            shipping_first_name, shipping_last_name,
            shipping_address_1, shipping_city, shipping_postcode, shipping_country,
            shipping_phone, shipping_company,
            cart_discount, cart_discount_tax,
            order_shipping, order_shipping_tax,
            order_tax, order_total,
            prices_include_tax, billing_tax, is_vat_exempt, order_language,
            wdr_discounts, order_total_cost,
            attribution_source_type, attribution_referrer,
            attribution_utm_source, attribution_utm_medium,
            attribution_session_entry,
            attribution_session_start_time, attribution_session_pages, attribution_session_count,
            attribution_user_agent, attribution_device_type,
            mondial_relay_pickup_info,
            mollie_payment_id, transaction_id, mollie_order_id,
            mollie_payment_mode, mollie_customer_id,
            date_paid, paid_date,
            mollie_payment_instructions, mollie_paid_and_processed,
            updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
            $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
            $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
            $31,$32,$33,$34,$35,$36,$37,$38,$39,$40,
            $41,$42,$43,$44,$45,$46,$47,$48,$49,$50,
            $51,$52,$53,$54,$55,$56,$57,NOW()
          )
          ON CONFLICT (wp_order_id) DO UPDATE SET
            wp_customer_id = EXCLUDED.wp_customer_id,
            post_status = EXCLUDED.post_status,
            post_modified = EXCLUDED.post_modified,
            payment_method_title = EXCLUDED.payment_method_title,
            created_via = EXCLUDED.created_via,
            billing_first_name = EXCLUDED.billing_first_name,
            billing_last_name = EXCLUDED.billing_last_name,
            billing_address_1 = EXCLUDED.billing_address_1,
            billing_address_2 = EXCLUDED.billing_address_2,
            billing_city = EXCLUDED.billing_city,
            billing_postcode = EXCLUDED.billing_postcode,
            billing_country = EXCLUDED.billing_country,
            billing_email = EXCLUDED.billing_email,
            billing_phone = EXCLUDED.billing_phone,
            shipping_first_name = EXCLUDED.shipping_first_name,
            shipping_last_name = EXCLUDED.shipping_last_name,
            shipping_address_1 = EXCLUDED.shipping_address_1,
            shipping_city = EXCLUDED.shipping_city,
            shipping_postcode = EXCLUDED.shipping_postcode,
            shipping_country = EXCLUDED.shipping_country,
            shipping_phone = EXCLUDED.shipping_phone,
            shipping_company = EXCLUDED.shipping_company,
            cart_discount = EXCLUDED.cart_discount,
            cart_discount_tax = EXCLUDED.cart_discount_tax,
            order_shipping = EXCLUDED.order_shipping,
            order_shipping_tax = EXCLUDED.order_shipping_tax,
            order_tax = EXCLUDED.order_tax,
            order_total = EXCLUDED.order_total,
            prices_include_tax = EXCLUDED.prices_include_tax,
            billing_tax = EXCLUDED.billing_tax,
            is_vat_exempt = EXCLUDED.is_vat_exempt,
            order_language = EXCLUDED.order_language,
            wdr_discounts = EXCLUDED.wdr_discounts,
            order_total_cost = EXCLUDED.order_total_cost,
            attribution_source_type = EXCLUDED.attribution_source_type,
            attribution_referrer = EXCLUDED.attribution_referrer,
            attribution_utm_source = EXCLUDED.attribution_utm_source,
            attribution_utm_medium = EXCLUDED.attribution_utm_medium,
            attribution_session_entry = EXCLUDED.attribution_session_entry,
            attribution_session_start_time = EXCLUDED.attribution_session_start_time,
            attribution_session_pages = EXCLUDED.attribution_session_pages,
            attribution_session_count = EXCLUDED.attribution_session_count,
            attribution_user_agent = EXCLUDED.attribution_user_agent,
            attribution_device_type = EXCLUDED.attribution_device_type,
            mondial_relay_pickup_info = EXCLUDED.mondial_relay_pickup_info,
            mollie_payment_id = EXCLUDED.mollie_payment_id,
            transaction_id = EXCLUDED.transaction_id,
            mollie_order_id = EXCLUDED.mollie_order_id,
            mollie_payment_mode = EXCLUDED.mollie_payment_mode,
            mollie_customer_id = EXCLUDED.mollie_customer_id,
            date_paid = EXCLUDED.date_paid,
            paid_date = EXCLUDED.paid_date,
            mollie_payment_instructions = EXCLUDED.mollie_payment_instructions,
            mollie_paid_and_processed = EXCLUDED.mollie_paid_and_processed,
            updated_at = NOW()
        `, [
          o.ID,                                                         // $1
          customerId,                                                   // $2
          o.guid || null,                                               // $3
          safeDate(o.post_date),                                        // $4
          o.post_status || null,                                        // $5
          safeDate(o.post_modified),                                    // $6
          m.get('_payment_method_title') || null,                       // $7
          m.get('_created_via') || null,                                // $8
          m.get('_billing_first_name') || null,                         // $9
          m.get('_billing_last_name') || null,                          // $10
          m.get('_billing_address_1') || null,                          // $11
          m.get('_billing_address_2') || null,                          // $12
          m.get('_billing_city') || null,                               // $13
          m.get('_billing_postcode') || null,                           // $14
          m.get('_billing_country') || null,                            // $15
          m.get('_billing_email') || null,                              // $16
          m.get('_billing_phone') || null,                              // $17
          m.get('_shipping_first_name') || null,                        // $18
          m.get('_shipping_last_name') || null,                         // $19
          m.get('_shipping_address_1') || null,                         // $20
          m.get('_shipping_city') || null,                              // $21
          m.get('_shipping_postcode') || null,                          // $22
          m.get('_shipping_country') || null,                           // $23
          m.get('_shipping_phone') || null,                             // $24
          m.get('_shipping_company') || null,                           // $25
          safeFloat(m.get('_cart_discount')),                           // $26
          safeFloat(m.get('_cart_discount_tax')),                       // $27
          safeFloat(m.get('_order_shipping')),                          // $28
          safeFloat(m.get('_order_shipping_tax')),                      // $29
          safeFloat(m.get('_order_tax')),                               // $30
          safeFloat(m.get('_order_total')),                             // $31
          safeBool(m.get('_prices_include_tax')),                       // $32
          m.get('_billing_tax') || null,                                // $33
          safeBool(m.get('is_vat_exempt')),                             // $34
          m.get('_wlr_order_language') || null,                         // $35
          wdrJson ? JSON.stringify(wdrJson) : null,                     // $36
          safeFloat(m.get('_wc_cog_order_total_cost'), null),           // $37
          m.get('_wc_order_attribution_source_type') || null,           // $38
          m.get('_wc_order_attribution_referrer') || null,              // $39
          m.get('_wc_order_attribution_utm_source') || null,            // $40
          m.get('_wc_order_attribution_utm_medium') || null,            // $41
          m.get('_wc_order_attribution_session_entry') || null,         // $42
          safeDate(sessionStartRaw),                                    // $43
          sessionPages,                                                 // $44
          sessionCount,                                                 // $45
          m.get('_wc_order_attribution_user_agent') || null,            // $46
          m.get('_wc_order_attribution_device_type') || null,           // $47
          mrJson ? JSON.stringify(mrJson) : null,                       // $48
          m.get('_mollie_payment_id') || null,                          // $49
          m.get('_transaction_id') || null,                             // $50
          m.get('_mollie_order_id') || null,                            // $51
          m.get('_mollie_payment_mode') || null,                        // $52
          m.get('_mollie_customer_id') || null,                         // $53
          datePaid,                                                     // $54
          safeDate(paidDateRaw),                                        // $55
          m.get('_mollie_payment_instructions') || null,                // $56
          safeBool(m.get('_mollie_paid_and_processed')),                // $57
        ]);
        done++;
      } catch (err) {
        errors++;
        if (errors <= 5) log(`  ✗ Order #${o.ID}: ${err.message}`);
      }
    }

    log(`  Commandes : ${Math.min(i + BATCH, orders.length)}/${orders.length}`);
  }

  log(`  ✓ Commandes importées : ${done} OK, ${errors} erreurs`);
}

// ─── 4. ARTICLES DE COMMANDE ──────────────────────────────────────────────────

async function importOrderItems(mysqlConn, pg) {
  log('━━━ Import Articles de commande ━━━');

  // Récupérer tous les items (line_item + shipping uniquement)
  const [items] = await mysqlConn.execute(`
    SELECT oi.order_item_id, oi.order_item_name, oi.order_item_type, oi.order_id
    FROM ${P}woocommerce_order_items oi
    WHERE oi.order_item_type IN ('line_item', 'shipping', 'fee', 'coupon')
    ORDER BY oi.order_id, oi.order_item_id
  `);

  log(`  → ${items.length} articles trouvés`);

  const BATCH = 500;
  let done = 0;
  let errors = 0;

  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const batchItemIds = batch.map(it => it.order_item_id);

    // Charger toute l'itemmeta de ce batch
    const placeholders = batchItemIds.map(() => '?').join(',');
    const [metaRows] = await mysqlConn.execute(
      `SELECT order_item_id, meta_key, meta_value
       FROM ${P}woocommerce_order_itemmeta
       WHERE order_item_id IN (${placeholders})`,
      batchItemIds
    );

    const metaMap = new Map();
    for (const row of metaRows) {
      if (!metaMap.has(row.order_item_id)) metaMap.set(row.order_item_id, new Map());
      metaMap.get(row.order_item_id).set(row.meta_key, row.meta_value);
    }

    // Vider les items existants pour ces commandes (par batch de order_ids)
    const orderIds = [...new Set(batch.map(it => it.order_id))];
    if (orderIds.length > 0) {
      const delPlaceholders = orderIds.map((_, idx) => `$${idx + 1}`).join(',');
      await pg.query(
        `DELETE FROM order_items WHERE wp_order_id IN (${delPlaceholders})`,
        orderIds
      );
    }

    for (const it of batch) {
      const m = metaMap.get(it.order_item_id) || new Map();

      // Attributs (pa_*)
      let productAttributes = null;
      const paAttrs = {};
      for (const [k, v] of m) {
        if (k.startsWith('pa_')) paAttrs[k] = v;
      }
      if (Object.keys(paAttrs).length) productAttributes = paAttrs;

      const advDiscountRaw = m.get('_advanced_woo_discount_item_total_discount');
      const wdrRaw = m.get('_wdr_discounts');
      const lineTaxDataRaw = m.get('_line_tax_data');

      try {
        await pg.query(`
          INSERT INTO order_items (
            wp_order_id, order_item_id, order_item_name, order_item_type,
            product_id, variation_id, qty, tax_class,
            line_subtotal, line_subtotal_tax, line_total, line_tax,
            line_tax_data, product_attributes, advanced_discount, wdr_discounts,
            item_cost, item_total_cost, reduced_stock
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
          )
          ON CONFLICT DO NOTHING
        `, [
          it.order_id,                                                          // $1
          it.order_item_id,                                                     // $2
          it.order_item_name || null,                                           // $3
          it.order_item_type || 'line_item',                                    // $4
          safeInt(m.get('_product_id')),                                        // $5
          safeInt(m.get('_variation_id'), true),                                // $6
          safeInt(m.get('_qty')),                                               // $7
          m.get('_tax_class') || null,                                          // $8
          safeFloat(m.get('_line_subtotal')),                                   // $9
          safeFloat(m.get('_line_subtotal_tax')),                               // $10
          safeFloat(m.get('_line_total')),                                      // $11
          safeFloat(m.get('_line_tax')),                                        // $12
          lineTaxDataRaw ? (safeJson(lineTaxDataRaw) ? JSON.stringify(safeJson(lineTaxDataRaw)) : null) : null, // $13
          productAttributes ? JSON.stringify(productAttributes) : null,         // $14
          advDiscountRaw ? (safeJson(advDiscountRaw) ? JSON.stringify(safeJson(advDiscountRaw)) : null) : null, // $15
          wdrRaw ? (safeJson(wdrRaw) ? JSON.stringify(safeJson(wdrRaw)) : null) : null, // $16
          safeFloat(m.get('_wc_cog_item_cost'), null),                         // $17
          safeFloat(m.get('_wc_cog_item_total_cost'), null),                   // $18
          safeBool(m.get('_reduced_stock')),                                    // $19
        ]);
        done++;
      } catch (err) {
        errors++;
        if (errors <= 5) log(`  ✗ OrderItem #${it.order_item_id}: ${err.message}`);
      }
    }

    log(`  Articles : ${Math.min(i + BATCH, items.length)}/${items.length}`);
  }

  log(`  ✓ Articles importés : ${done} OK, ${errors} erreurs`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log('╔══════════════════════════════════════════╗');
  log('║   Import WordPress MySQL → PostgreSQL    ║');
  log('╚══════════════════════════════════════════╝');

  let mysqlConn;
  const pg = new Pool(PG_CONFIG);

  try {
    // Connexion MySQL
    log('Connexion MySQL...');
    mysqlConn = await mysql.createConnection(MYSQL_CONFIG);
    log('  ✓ MySQL connecté');

    // Test PG
    await pg.query('SELECT 1');
    log('  ✓ PostgreSQL connecté');

    const t0 = Date.now();

    await importProducts(mysqlConn, pg);
    await importCustomers(mysqlConn, pg);
    await importOrders(mysqlConn, pg);
    await importOrderItems(mysqlConn, pg);

    const elapsed = Math.round((Date.now() - t0) / 1000);
    log(`╔══════════════════════════════════════════╗`);
    log(`║   Import terminé en ${String(elapsed).padStart(5)}s             ║`);
    log(`╚══════════════════════════════════════════╝`);

  } catch (err) {
    log(`ERREUR FATALE : ${err.message}`);
    console.error(err);
    process.exit(1);
  } finally {
    if (mysqlConn) await mysqlConn.end();
    await pg.end();
  }
}

main();
