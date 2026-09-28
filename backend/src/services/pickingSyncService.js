/**
 * Picking — photo des commandes à expédier, lue dans BMS.
 *
 * Pourquoi BMS et pas le statut WooCommerce : WC est en retard sur BMS, de
 * quelques minutes à jamais (les Bpost expédiées dans BMS restent
 * `wc-processing`, ex. 1263515). Et « processing » côté BMS ne suffit pas non
 * plus : une commande déjà expédiée y reste un moment (14 sur 42 le 28/09/2026),
 * seules comptent les lignes avec `qty_to_ship > 0`.
 *
 * Lecture seule : rien n'est écrit dans BMS.
 *
 * La photo est écrasée à chaque actualisation (cron 5 min + bouton + ouverture
 * de la page si elle est trop vieille). Deux actualisations simultanées n'en
 * font qu'une.
 */

const pool = require('../config/database');
const bmsApiModel = require('../models/bmsApiModel');

const PAGE = 100;
const SYNC_KEY = 'picking_last_sync_at';
// Statuts BMS photographiés : `processing` est listé ; `holded` (en attente
// dans BMS) ne l'est pas, mais sa réservation pèse sur le stock physique.
const BMS_STATUSES = ['processing', 'holded'];

/** Toutes les pages d'un endpoint v2 `{data, meta:{total}}`. */
const fetchAll = async (path) => {
  const sep = path.includes('?') ? '&' : '?';
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await bmsApiModel.apiCall(`${path}${sep}limit=${PAGE}&offset=${offset}`);
    const data = res?.data || [];
    rows.push(...data);
    const total = Number(res?.meta?.total);
    if (data.length < PAGE || (Number.isFinite(total) && rows.length >= total)) break;
  }
  return rows;
};

/**
 * Commande BMS → ligne de photo, ou null si plus rien n'est à expédier.
 * Les packs woosb arrivent en `virtual`, toujours à 0 à expédier : seuls leurs
 * composants restent. Un même SKU sur deux lignes (pack + unité) est cumulé.
 */
const toSnapshot = (order, bmsWaves) => {
  const lines = new Map();
  for (const item of order.items || []) {
    if (item.type === 'virtual') continue;
    const toShip = Number(item.qty_to_ship) || 0;
    if (toShip <= 0 || !item.sku) continue;
    const prev = lines.get(item.sku) || { sku: item.sku, name: item.name, toShip: 0, reserved: 0 };
    prev.toShip += toShip;
    prev.reserved += Math.min(Number(item.qty_reserved) || 0, toShip);
    lines.set(item.sku, prev);
  }
  if (lines.size === 0) return null;

  const ship = order.shipping_address || {};
  return {
    orderNumber: String(order.reference),
    bmsOrderId: order.id,
    status: order.status,
    createdAt: order.created_at,
    bmsWaveId: bmsWaves.get(String(order.reference)) ?? null,
    shippingMethod: order.shipping?.description || null,
    shipName: [ship.firstname, ship.lastname].filter(Boolean).join(' ').trim() || null,
    shipCountry: ship.country_id || null,
    lines: [...lines.values()]
  };
};

const writeSnapshot = async (snapshots) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM picking_bms_orders');

    if (snapshots.length > 0) {
      await client.query(
        `INSERT INTO picking_bms_orders
           (order_number, bms_order_id, bms_status, bms_created_at, bms_wave_id,
            shipping_method, ship_name, ship_country)
         SELECT o.n, o.id, o.st, (o.created::timestamptz AT TIME ZONE 'Europe/Paris'), o.wave,
                o.method, o.name, o.country
         FROM unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::int[],
                     $6::text[], $7::text[], $8::text[])
           AS o(n, id, st, created, wave, method, name, country)`,
        [
          snapshots.map(s => s.orderNumber),
          snapshots.map(s => s.bmsOrderId),
          snapshots.map(s => s.status),
          snapshots.map(s => s.createdAt),
          snapshots.map(s => s.bmsWaveId),
          snapshots.map(s => s.shippingMethod),
          snapshots.map(s => s.shipName),
          snapshots.map(s => s.shipCountry)
        ]
      );

      const lines = snapshots.flatMap(s => s.lines.map(l => ({ ...l, orderNumber: s.orderNumber })));
      await client.query(
        `INSERT INTO picking_bms_lines (order_number, sku, product_name, qty_to_ship, qty_reserved)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::int[])`,
        [
          lines.map(l => l.orderNumber),
          lines.map(l => l.sku),
          lines.map(l => l.name),
          lines.map(l => l.toShip),
          lines.map(l => l.reserved)
        ]
      );
    }

    await client.query(
      `INSERT INTO app_config (config_key, config_value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()`,
      [SYNC_KEY, new Date().toISOString()]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const doRefresh = async () => {
  const waves = await fetchAll('/v2/in-progress?filters[status]=new');
  const bmsWaves = new Map(waves.map(w => [String(w.reference), w.batch_id]));

  const orders = [];
  for (const status of BMS_STATUSES) {
    orders.push(...await fetchAll(`/v2/sales/orders?filters[status]=${status}`));
  }

  const snapshots = orders.map(o => toSnapshot(o, bmsWaves)).filter(Boolean);
  await writeSnapshot(snapshots);
  return { orders: snapshots.length, syncedAt: new Date() };
};

let running = null;

/** Actualise la photo. Un appel pendant une actualisation en cours l'attend. */
const refresh = () => {
  if (!running) {
    running = doRefresh().finally(() => { running = null; });
  }
  return running;
};

/** @returns {Promise<?Date>} heure de la dernière photo */
const lastSyncAt = async () => {
  const { rows } = await pool.query('SELECT config_value FROM app_config WHERE config_key = $1', [SYNC_KEY]);
  return rows[0] ? new Date(rows[0].config_value) : null;
};

/** Actualise si la photo a plus de `maxAgeMs` (soirs et week-ends, hors cron). */
const ensureFresh = async (maxAgeMs = 5 * 60 * 1000) => {
  const last = await lastSyncAt();
  if (!last || Date.now() - last.getTime() > maxAgeMs) await refresh();
};

module.exports = { refresh, ensureFresh, lastSyncAt, toSnapshot };
