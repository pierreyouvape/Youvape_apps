/**
 * Import d'une commande depuis l'API REST WooCommerce, au format YouSync.
 *
 * Pourquoi : yousync PERD des commandes. Sa file est un fichier `queue.json` que
 * WordPress (nouvelle commande) et le VPS (acquittement) lisent puis réécrivent
 * sans verrou commun : quand les deux se croisent, l'un écrase l'autre et
 * l'événement disparaît sans erreur ni nouvelle tentative. La 1267765
 * (09/10/2026, payée 11:02) n'est jamais arrivée : le Picking l'affichait
 * « Pas encore synchronisée » sans fin, faute d'adresse et de point relais.
 *
 * Le filet : toute commande que BMS donne à expédier et que notre base n'a pas
 * est relue dans WooCommerce (`importMissingBmsOrders`, appelé après chaque
 * photo du Picking, donc toutes les 2 min en journée).
 *
 * L'écriture passe par `wcSyncService.processOrder`, le MÊME code que la synchro
 * normale : la commande arrive complète (méthode de livraison, point relais,
 * date de paiement, taxes, coupons, attribution, Mollie). `toSyncPayload`
 * reproduit `Data_Fetcher::get_order` de yousync champ par champ.
 *
 * ⚠️ Ne pas passer par `ordersController.reimportOrderFromWc` : il ne remplit ni
 * `shipping_method`, ni `paid_date`, ni le point relais, et date la commande en
 * UTC (notre base est en heure de Paris).
 */

const axios = require('axios');
const https = require('https');
const pool = require('../config/database');
const appConfigModel = require('../models/appConfigModel');
const { sendAlert } = require('./alertService');
const wcSyncService = require('./wcSyncService');

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Délai laissé à yousync avant de prendre le relais (il interroge la file toutes les 60 s).
const GRACE_MINUTES = 5;
// Une commande en échec n'est retentée qu'après ce délai ; 404 = absente de WooCommerce.
const RETRY_AFTER_MS = 30 * 60 * 1000;
const RETRY_AFTER_404_MS = 6 * 60 * 60 * 1000;
const LAST_IMPORT_KEY = 'wc_missing_orders_last_import';

// order_number → { retryAt, alerted }. En mémoire : un redémarrage retente tout, c'est voulu.
const failures = new Map();

const num = (v) => parseFloat(v) || 0;
// WooCommerce REST rend les dates en heure du site (Paris) : « 2026-10-09T11:02:25 ».
const wcDate = (v) => (v ? String(v).replace('T', ' ') : null);

const metaOf = (metaData) => {
  const map = new Map((metaData || []).map(m => [m.key, m.value]));
  return (key) => {
    const v = map.get(key);
    return v === undefined || v === '' ? null : v;
  };
};

const parseJson = (v) => {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
};

/** Point relais — même règle que `Data_Fetcher::get_relay_point`. */
const relayPointOf = (meta) => {
  const wmsNetworks = {
    _wms_mondial_relay_pickup_info: 'mondial_relay',
    _wms_chronopost_pickup_info: 'chronopost',
  };
  for (const [key, network] of Object.entries(wmsNetworks)) {
    const info = parseJson(meta(key));
    if (!info || !info.pickup_id) continue;
    return {
      network,
      id: String(info.pickup_id),
      name: info.pickup_name ?? null,
      address: info.pickup_address ?? null,
      postcode: info.pickup_zipcode ?? null,
      city: info.pickup_city ?? null,
      country: info.pickup_country ?? null,
      type: null,
      service: info.shipping_method ?? null,
    };
  }

  const colissimoId = meta('_lpc_meta_pickUpLocationId');
  if (colissimoId) {
    const data = parseJson(meta('_lpc_meta_pickUpLocationData')) || {};
    return {
      network: 'colissimo',
      id: String(colissimoId),
      name: meta('_lpc_meta_pickUpLocationLabel') || data.nom || null,
      address: data.adresse1 ?? null,
      postcode: data.codePostal ?? null,
      city: data.localite ?? null,
      country: data.codePays ?? null,
      type: meta('_lpc_meta_pickUpProductCode') || data.typeDePoint || null,
      service: null,
    };
  }
  return null;
};

/** Ligne produit WC REST → ligne `items` de yousync. */
const toItem = (item) => {
  const meta = metaOf(item.meta_data);
  // `_line_tax_data` n'est pas exposé par l'API : on le reconstruit depuis `taxes`.
  const taxes = item.taxes || [];
  const lineTaxData = taxes.length
    ? {
      total: Object.fromEntries(taxes.map(t => [t.id, t.total])),
      subtotal: Object.fromEntries(taxes.map(t => [t.id, t.subtotal])),
    }
    : null;
  // Attributs d'une déclinaison : yousync les envoie au format get_variation_attributes().
  const attributes = item.variation_id
    ? Object.fromEntries((item.meta_data || [])
      .filter(m => String(m.key).startsWith('pa_'))
      .map(m => [`attribute_${m.key}`, m.value]))
    : {};

  return {
    item_id: item.id,
    product_id: item.product_id,
    variation_id: item.variation_id || 0,
    name: item.name,
    quantity: item.quantity,
    subtotal: num(item.subtotal),
    total: num(item.total),
    tax: num(item.total_tax),
    sku: item.sku || null,
    tax_class: item.tax_class || '',
    line_subtotal_tax: num(item.subtotal_tax),
    line_tax_data: lineTaxData,
    product_attributes: Object.keys(attributes).length ? attributes : null,
    advanced_discount: meta('_advanced_woo_discount_item_total_discount'),
    wdr_discounts: meta('_wdr_discounts'),
    item_cost: num(meta('_wc_cog_item_cost')) || null,
    item_total_cost: num(meta('_wc_cog_item_total_cost')) || null,
    reduced_stock: Boolean(meta('_reduced_stock')),
  };
};

/**
 * Commande WC REST (`/wc/v3/orders/{id}`) → payload `Data_Fetcher::get_order`,
 * tel que l'attend `wcSyncService.processOrder`.
 */
const toSyncPayload = (o) => {
  const meta = metaOf(o.meta_data);
  const billing = o.billing || {};
  const shipping = o.shipping || {};
  const shippingLines = o.shipping_lines || [];

  return {
    wp_order_id: o.id,
    order_number: o.number,
    status: o.status,
    currency: o.currency,
    total: num(o.total),
    total_tax: num(o.total_tax),
    shipping_total: num(o.shipping_total),
    discount_total: num(o.discount_total),
    payment_method: o.payment_method,
    payment_method_title: o.payment_method_title,
    customer_id: o.customer_id || null,
    customer_email: billing.email,
    billing_first_name: billing.first_name,
    billing_last_name: billing.last_name,
    billing_company: billing.company,
    billing_address_1: billing.address_1,
    billing_address_2: billing.address_2,
    billing_city: billing.city,
    billing_postcode: billing.postcode,
    billing_country: billing.country,
    billing_phone: billing.phone,
    shipping_first_name: shipping.first_name,
    shipping_last_name: shipping.last_name,
    shipping_address_1: shipping.address_1,
    shipping_address_2: shipping.address_2,
    shipping_city: shipping.city,
    shipping_postcode: shipping.postcode,
    shipping_country: shipping.country,
    customer_note: o.customer_note,
    date_created: wcDate(o.date_created),
    date_modified: wcDate(o.date_modified),
    date_completed: wcDate(o.date_completed),
    date_paid: wcDate(o.date_paid),
    items: (o.line_items || []).map(toItem),
    shipping: shippingLines.map(l => ({ method_id: l.method_id, method_title: l.method_title, total: num(l.total) })),
    shipping_method: shippingLines[0]?.method_title || null,
    shipping_carrier: meta('bms_carrier'),
    tracking_number: meta('bms_tracking_number'),
    relay_point: relayPointOf(meta),
    coupons: (o.coupon_lines || []).map(c => c.code),
    coupon_items: (o.coupon_lines || []).map(c => ({
      item_id: c.id,
      name: c.code,
      discount_amount: num(c.discount),
      discount_tax: num(c.discount_tax),
    })),
    fee_items: (o.fee_lines || []).map(f => ({
      item_id: f.id,
      name: f.name,
      total: num(f.total),
      total_tax: num(f.total_tax),
      tax_class: f.tax_class,
      tax_status: f.tax_status,
    })),
    tax_items: (o.tax_lines || []).map(t => ({
      item_id: t.id,
      rate_code: t.rate_code,
      rate_id: t.rate_id,
      label: t.label,
      compound: t.compound,
      tax_amount: num(t.tax_total),
      shipping_tax_amount: num(t.shipping_tax_total),
    })),
    attribution: {
      source_type: meta('_wc_order_attribution_source_type'),
      referrer: meta('_wc_order_attribution_referrer'),
      utm_source: meta('_wc_order_attribution_utm_source'),
      utm_medium: meta('_wc_order_attribution_utm_medium'),
      utm_campaign: meta('_wc_order_attribution_utm_campaign'),
      utm_content: meta('_wc_order_attribution_utm_content'),
      utm_term: meta('_wc_order_attribution_utm_term'),
      device_type: meta('_wc_order_attribution_device_type'),
      user_agent: meta('_wc_order_attribution_user_agent'),
      session_entry: meta('_wc_order_attribution_session_entry'),
      session_start_time: meta('_wc_order_attribution_session_start_time'),
      session_pages: parseInt(meta('_wc_order_attribution_session_pages'), 10) || null,
      session_count: parseInt(meta('_wc_order_attribution_session_count'), 10) || null,
    },
    payment_meta: {
      transaction_id: o.transaction_id || null,
      mollie_payment_id: meta('_mollie_payment_id'),
      mollie_order_id: meta('_mollie_order_id'),
      mollie_payment_mode: meta('_mollie_payment_mode'),
      mollie_customer_id: meta('_mollie_customer_id'),
      mollie_payment_instructions: meta('_mollie_payment_instructions'),
      mollie_paid_and_processed: Boolean(meta('_mollie_paid_and_processed')),
    },
  };
};

/** Lit une commande dans l'API REST WooCommerce (identifiants de `rewards_config`). */
const fetchWcOrder = async (wpOrderId) => {
  const { rows } = await pool.query(
    'SELECT woocommerce_url, consumer_key, consumer_secret, htaccess_user, htaccess_password FROM rewards_config LIMIT 1'
  );
  const cfg = rows[0];
  if (!cfg || !cfg.consumer_key) throw new Error('WooCommerce credentials not configured');

  const headers = {};
  if (cfg.htaccess_user && cfg.htaccess_password) {
    headers.Authorization = `Basic ${Buffer.from(`${cfg.htaccess_user}:${cfg.htaccess_password}`).toString('base64')}`;
  }
  const { data } = await axios.get(`${cfg.woocommerce_url.replace(/\/$/, '')}/wp-json/wc/v3/orders/${wpOrderId}`, {
    params: { consumer_key: cfg.consumer_key, consumer_secret: cfg.consumer_secret },
    headers,
    httpsAgent,
    timeout: 15000
  });
  return data;
};

/**
 * Importe (ou met à jour) une commande depuis WooCommerce, par le chemin de la synchro.
 * @returns {Promise<{imported: boolean, status: string}>}
 */
const importOrder = async (wpOrderId) => {
  const wcOrder = await fetchWcOrder(wpOrderId);
  if (wcOrder.status === 'auto-draft' || wcOrder.status === 'checkout-draft') {
    return { imported: false, status: wcOrder.status };
  }
  await wcSyncService.processOrder('update', wcOrder.id, toSyncPayload(wcOrder));
  return { imported: true, status: wcOrder.status };
};

/**
 * Filet de sécurité du Picking : importe les commandes que BMS donne à expédier
 * et que notre base n'a pas, passé un délai de grâce laissé à yousync.
 * Ne lève jamais : un échec ne doit pas empêcher la photo du Picking.
 * @returns {Promise<string[]>} numéros importés
 */
const importMissingBmsOrders = async () => {
  const { rows } = await pool.query(`
    SELECT b.order_number
    FROM picking_bms_orders b
    LEFT JOIN orders o ON o.wp_order_id::text = b.order_number
    WHERE o.wp_order_id IS NULL
      AND b.order_number ~ '^[0-9]+$'
      AND b.bms_created_at < (NOW() AT TIME ZONE 'Europe/Paris') - make_interval(mins => $1)
    ORDER BY b.order_number
  `, [GRACE_MINUTES]);

  const imported = [];
  for (const { order_number: orderNumber } of rows) {
    const failure = failures.get(orderNumber);
    if (failure && Date.now() < failure.retryAt) continue;

    try {
      const result = await importOrder(Number(orderNumber));
      if (!result.imported) {
        failures.set(orderNumber, { retryAt: Date.now() + RETRY_AFTER_MS, alerted: true });
        console.log(`[Picking] Commande ${orderNumber} absente de notre base, encore en brouillon dans WooCommerce (${result.status})`);
        continue;
      }
      failures.delete(orderNumber);
      imported.push(orderNumber);
      console.log(`[Picking] Commande ${orderNumber} absente de notre base (perdue par yousync) : importée depuis WooCommerce (${result.status})`);
    } catch (err) {
      const status = err.response?.status;
      const message = err.response?.data?.message || err.message;
      failures.set(orderNumber, {
        retryAt: Date.now() + (status === 404 ? RETRY_AFTER_404_MS : RETRY_AFTER_MS),
        alerted: true
      });
      console.error(`[Picking] Import de la commande ${orderNumber} depuis WooCommerce échoué :`, message);
      if (!failure?.alerted) {
        sendAlert(
          `Picking : commande ${orderNumber} introuvable dans notre base`,
          `BMS donne la commande ${orderNumber} à expédier, mais elle n'est pas dans notre base et son import depuis WooCommerce a échoué.\n\nErreur${status ? ` (HTTP ${status})` : ''} : ${message}\n\nElle reste « Pas encore synchronisée » dans le Picking. Nouvelle tentative dans ${status === 404 ? '6 h' : '30 min'}.`
        ).catch(() => {});
      }
    }
  }

  if (imported.length) {
    // Trace durable (les logs du conteneur partent à chaque rebuild) : combien yousync en perd.
    try {
      await appConfigModel.upsert(LAST_IMPORT_KEY, JSON.stringify({ at: new Date().toISOString(), orders: imported }));
    } catch (err) {
      console.error(`[Picking] Trace ${LAST_IMPORT_KEY} non enregistrée :`, err.message);
    }
  }
  return imported;
};

module.exports = { toSyncPayload, fetchWcOrder, importOrder, importMissingBmsOrders };
