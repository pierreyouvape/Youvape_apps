/**
 * Lignes des remboursements WooCommerce : quels articles, combien, port, frais.
 *
 * yousync n'envoie que le total d'un remboursement. Les lignes se lisent chez WC
 * (`/wc/v3/orders/{id}/refunds`) UNE fois par commande, à l'arrivée du
 * remboursement, et se rangent dans `refund_items`. Fiche commande, picking et
 * packing lisent ensuite la base — la même information partout, sans appel au
 * moment de préparer un colis.
 *
 * Un échec de lecture laisse `refunds.lines_synced_at` à NULL : le cron
 * `setupRefundLinesCron` reprend ces remboursements.
 */

const axios = require('axios');
const pool = require('../config/database');

// Remboursements repris par le cron : au-delà, la commande est partie depuis
// longtemps et la fiche commande relit à la demande.
const RETRY_DAYS = 30;

const wcConfig = async () => {
  const { rows: [config] } = await pool.query(
    'SELECT woocommerce_url, consumer_key, consumer_secret, htaccess_user, htaccess_password FROM rewards_config LIMIT 1'
  );
  if (!config?.consumer_key) return null;
  const { rows: [url] } = await pool.query("SELECT config_value FROM app_config WHERE config_key = 'wc_sync_wp_url'");
  const headers = {};
  if (config.htaccess_user && config.htaccess_password) {
    headers.Authorization = `Basic ${Buffer.from(`${config.htaccess_user}:${config.htaccess_password}`).toString('base64')}`;
  }
  return {
    baseUrl: (url?.config_value || config.woocommerce_url).replace(/\/$/, ''),
    params: { consumer_key: config.consumer_key, consumer_secret: config.consumer_secret },
    headers
  };
};

const abs = (v) => Math.abs(parseFloat(v) || 0);

// Ligne de la commande d'origine visée par le remboursement : WC la note dans
// la meta `_refunded_item_id`.
const refundedItemId = (li) => {
  const meta = (li.meta_data || []).find((m) => m.key === '_refunded_item_id');
  const id = parseInt(meta?.value, 10);
  return Number.isFinite(id) ? id : null;
};

/** Remboursement WC → lignes à ranger dans refund_items. */
const toRows = (wpOrderId, r) => [
  ...(r.line_items || []).map((li) => ({
    wpRefundId: r.id, wpOrderId, type: 'line_item',
    refundedItemId: refundedItemId(li),
    productId: li.product_id || null,
    variationId: li.variation_id || null,
    sku: li.sku || null,
    name: li.name,
    quantity: Math.abs(li.quantity || 0),
    total: abs(li.total),
    totalTax: abs(li.total_tax)
  })),
  ...(r.shipping_lines || []).map((s) => ({
    wpRefundId: r.id, wpOrderId, type: 'shipping',
    name: s.method_title || 'Frais de port', quantity: 0, total: abs(s.total), totalTax: abs(s.total_tax)
  })),
  ...(r.fee_lines || []).map((f) => ({
    wpRefundId: r.id, wpOrderId, type: 'fee',
    name: f.name || 'Frais', quantity: 0, total: abs(f.total), totalTax: abs(f.total_tax)
  }))
];

/**
 * Relit chez WC tous les remboursements d'une commande et remplace leurs lignes.
 * La liste de WC fait foi : un remboursement supprimé là-bas perd ses lignes ici.
 *
 * @returns {Promise<boolean>} false si l'API WC n'est pas configurée
 */
const syncOrder = async (wpOrderId) => {
  const config = await wcConfig();
  if (!config) return false;

  let refunds;
  try {
    const res = await axios.get(`${config.baseUrl}/wp-json/wc/v3/orders/${wpOrderId}/refunds`, {
      params: config.params, headers: config.headers, timeout: 15000
    });
    refunds = res.data || [];
  } catch (error) {
    // Commande disparue de WC : rien à relire, inutile de réessayer indéfiniment.
    if (error.response?.status !== 404) throw error;
    refunds = [];
  }

  const rows = refunds.flatMap((r) => toRows(wpOrderId, r));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM refund_items WHERE wp_order_id = $1', [wpOrderId]);
    if (rows.length > 0) {
      await client.query(
        `INSERT INTO refund_items
           (wp_refund_id, wp_order_id, item_type, refunded_item_id, product_id, variation_id,
            sku, name, quantity, total, total_tax)
         SELECT * FROM unnest($1::int[], $2::int[], $3::text[], $4::int[], $5::int[], $6::int[],
                              $7::text[], $8::text[], $9::int[], $10::numeric[], $11::numeric[])`,
        [
          rows.map(r => r.wpRefundId), rows.map(r => r.wpOrderId), rows.map(r => r.type),
          rows.map(r => r.refundedItemId ?? null), rows.map(r => r.productId ?? null),
          rows.map(r => r.variationId ?? null), rows.map(r => r.sku ?? null), rows.map(r => r.name ?? null),
          rows.map(r => r.quantity), rows.map(r => r.total), rows.map(r => r.totalTax)
        ]
      );
    }
    await client.query('UPDATE refunds SET lines_synced_at = NOW() WHERE wp_order_id = $1', [wpOrderId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return true;
};

/**
 * À l'arrivée d'un remboursement (webhook yousync / synchro WC) : sans attendre
 * et sans jamais faire échouer l'ingestion. Un échec est repris par le cron.
 */
const syncOrderInBackground = (wpOrderId) => {
  if (!wpOrderId) return;
  syncOrder(wpOrderId).catch((error) =>
    console.warn(`[Remboursements] Lignes de la commande #${wpOrderId} non lues (reprise par le cron) :`, error.message));
};

/** Remboursements récents dont les lignes n'ont pas encore été lues chez WC. */
const syncPending = async () => {
  const { rows } = await pool.query(
    `SELECT DISTINCT wp_order_id FROM refunds
      WHERE lines_synced_at IS NULL
        AND COALESCE(refund_date, created_at) >= NOW() - ($1 || ' days')::interval`,
    [RETRY_DAYS]
  );
  let done = 0;
  for (const { wp_order_id: id } of rows) {
    try {
      if (await syncOrder(id)) done++;
    } catch (error) {
      console.warn(`[Remboursements] Commande #${id} : ${error.message}`);
    }
  }
  return done;
};

/**
 * Détail des remboursements d'une commande, au format de la fiche commande
 * (`GET /api/orders/:id/refunds-detail`). Lit la base ; ne relit WC que si des
 * lignes n'ont jamais été lues (remboursement antérieur à refund_items).
 */
const getOrderDetail = async (wpOrderId) => {
  const { rows: [pending] } = await pool.query(
    'SELECT 1 FROM refunds WHERE wp_order_id = $1 AND lines_synced_at IS NULL LIMIT 1',
    [wpOrderId]
  );
  if (pending) await syncOrder(wpOrderId);

  const [{ rows: refunds }, { rows: items }] = await Promise.all([
    pool.query(
      `SELECT wp_refund_id, refund_amount, refund_reason, refund_date
         FROM refunds WHERE wp_order_id = $1
        ORDER BY refund_date DESC NULLS LAST, wp_refund_id DESC`,
      [wpOrderId]
    ),
    pool.query('SELECT * FROM refund_items WHERE wp_order_id = $1 ORDER BY id', [wpOrderId])
  ]);

  const num = (v) => parseFloat(v) || 0;
  return refunds.map((r) => {
    const own = items.filter(i => i.wp_refund_id === r.wp_refund_id);
    return {
      id: r.wp_refund_id,
      date: r.refund_date,
      amount: num(r.refund_amount),
      reason: r.refund_reason || '',
      line_items: own.filter(i => i.item_type === 'line_item').map(i => ({
        name: i.name,
        sku: i.sku,
        quantity: i.quantity,
        total: num(i.total),
        total_tax: num(i.total_tax),
        refunded_item_id: i.refunded_item_id,
        product_id: i.product_id,
        variation_id: i.variation_id
      })),
      shipping_lines: own.filter(i => i.item_type === 'shipping').map(i => ({
        method_title: i.name, total: num(i.total), total_tax: num(i.total_tax)
      })),
      fee_lines: own.filter(i => i.item_type === 'fee').map(i => ({
        name: i.name, total: num(i.total), total_tax: num(i.total_tax)
      }))
    };
  });
};

/**
 * Sous-requête SQL : quantité remboursée d'une ligne `order_items` (alias `oi`).
 * Partagée par le picking et le packing pour qu'ils déduisent la même chose.
 */
const REFUNDED_QTY_SQL = `(
  SELECT COALESCE(SUM(ri.quantity), 0)::int FROM refund_items ri
   WHERE ri.wp_order_id = oi.wp_order_id
     AND ri.item_type = 'line_item'
     AND ri.refunded_item_id = oi.order_item_id
)`;

module.exports = {
  syncOrder,
  syncOrderInBackground,
  syncPending,
  getOrderDetail,
  REFUNDED_QTY_SQL
};
