/**
 * Inventaire — le stock théorique d'une référence, relevé au moment du comptage.
 *
 * théorique = physique BMS (entrepôt 270) − prélevé dans nos vagues et pas
 * encore expédié (le physique BMS ne baisse qu'à l'expédition). Les vagues
 * encore faites dans BMS ne se voient pas : règle convenue avec Pierre, on ne
 * compte pas un rayon pendant une vague BMS.
 *
 * Le relevé se fait en fin d'emplacement (et en fin de recomptage), PAS à la
 * validation du soir : l'écart compté − relevé absorbe ainsi les ventes et
 * réceptions qui suivent le comptage. Il passe par une file
 * (`inventory_items.ref_needed`) : BMS limite à une centaine d'appels par
 * minute (« Too Many Attempts » en HTTP 400) ; quand il sature, on s'arrête
 * et le cron de la minute suivante reprend.
 *
 * Une fois le relevé fait ET tous les emplacements où la référence a été
 * comptée validés, on décide du recomptage (inventoryRules.needsRecount).
 */

const pool = require('../config/database');
const bmsApiModel = require('../models/bmsApiModel');
const pickingModel = require('../models/pickingModel');
const { needsRecount, pickedNotShipped } = require('./inventoryRules');

const BMS_WAREHOUSE_ID = 270;
const CONCURRENCY = 3;
const PAUSE_MS = 150;
const BATCH = 300;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class RateLimitedError extends Error {}

/** Physique BMS de l'entrepôt ; null si BMS ne connaît pas le SKU. */
const readPhysical = async (sku) => {
  let stocks;
  try {
    stocks = await bmsApiModel.apiCall(`/advanced-stock/product/${encodeURIComponent(sku)}/stocks`);
  } catch (error) {
    if (/Too Many Attempts/i.test(error.message)) throw new RateLimitedError(error.message);
    if (/BMS API error: 404/.test(error.message) || /non trouv/i.test(error.message)) return null;
    throw error;
  }
  const w = (Array.isArray(stocks) ? stocks : []).find(s => s.w_id === BMS_WAREHOUSE_ID);
  return w ? Number(w.wi_physical_quantity) || 0 : null;
};

/** Prélevé non expédié, par produit, sur toutes nos vagues en cours. */
const pickedOutByProduct = async () => {
  const total = new Map();
  const { rows: waves } = await pool.query(`SELECT id FROM picking_waves WHERE status IN ('picking', 'picked')`);
  for (const { id } of waves) {
    const data = await pickingModel.getWavePrintData(id);
    const { rows: pending } = await pool.query(
      `SELECT wo.order_number FROM picking_wave_orders wo
        WHERE wo.wave_id = $1 AND wo.active AND NOT ${pickingModel.SHIPPED_SQL}`,
      [id]
    );
    const unshipped = new Set(pending.map(r => r.order_number));
    const { rows: lines } = await pool.query(
      'SELECT line_key, product_id, qty_scanned + qty_manual AS picked FROM picking_wave_lines WHERE wave_id = $1',
      [id]
    );
    const wave = pickedNotShipped(data.orders.filter(o => unshipped.has(o.orderNumber)), lines);
    for (const [productId, qty] of wave) total.set(productId, (total.get(productId) || 0) + qty);
  }
  return total;
};

/**
 * Décide du sort des références d'un inventaire une fois leur relevé fait et
 * leurs emplacements validés : comptée, ou à recompter. Une référence déjà
 * recomptée n'y repasse jamais (le recomptage fait foi).
 */
const evaluate = async (inventoryId, productIds) => {
  if (!productIds.length) return;
  const { rows } = await pool.query(
    `SELECT i.id, i.ref_physical, i.ref_picked, i.ref_error,
            (SELECT COALESCE(sum(c.qty), 0)::int FROM inventory_counts c
              WHERE c.inventory_id = i.inventory_id AND c.product_id = i.product_id) AS counted
       FROM inventory_items i
      WHERE i.inventory_id = $1 AND i.product_id = ANY($2::int[])
        AND i.status IN ('pending', 'counted')
        AND NOT i.ref_needed
        AND (i.ref_at IS NOT NULL OR i.ref_error IS NOT NULL)
        AND EXISTS (SELECT 1 FROM inventory_locations l
                     WHERE l.inventory_id = i.inventory_id AND l.location = i.expected_location AND l.status = 'validated')
        AND NOT EXISTS (SELECT 1 FROM inventory_counts c JOIN inventory_locations l ON l.id = c.location_id
                         WHERE c.inventory_id = i.inventory_id AND c.product_id = i.product_id AND l.status <> 'validated')`,
    [inventoryId, productIds]
  );
  for (const r of rows) {
    if (r.ref_error) {
      await pool.query(`UPDATE inventory_items SET status = 'counted' WHERE id = $1`, [r.id]);
      continue;
    }
    const theoretical = Math.max(0, r.ref_physical - r.ref_picked);
    if (needsRecount(r.counted, theoretical)) {
      await pool.query(
        `UPDATE inventory_items SET status = 'recount', first_counted = $2, first_theoretical = $3 WHERE id = $1`,
        [r.id, r.counted, theoretical]
      );
    } else {
      await pool.query(`UPDATE inventory_items SET status = 'counted' WHERE id = $1`, [r.id]);
    }
  }
};

let running = false;

/** Vide la file des relevés (cron chaque minute, et à chaque fin d'emplacement). */
const processPending = async () => {
  if (running) return;
  running = true;
  try {
    const { rows } = await pool.query(
      `SELECT i.id, i.inventory_id, i.product_id, i.sku
         FROM inventory_items i JOIN inventories v ON v.id = i.inventory_id AND v.status = 'open'
        WHERE i.ref_needed
        ORDER BY i.id
        LIMIT $1`,
      [BATCH]
    );
    if (rows.length === 0) return;

    const pickedOut = await pickedOutByProduct();
    const done = new Map();
    let limited = false;
    for (let i = 0; i < rows.length && !limited; i += CONCURRENCY) {
      await Promise.all(rows.slice(i, i + CONCURRENCY).map(async (r) => {
        let physical;
        try {
          physical = r.sku ? await readPhysical(r.sku) : null;
        } catch (error) {
          if (error instanceof RateLimitedError) limited = true;
          else console.error(`[Inventaire] Relevé BMS ${r.sku} :`, error.message);
          return;
        }
        await pool.query(
          `UPDATE inventory_items
              SET ref_needed = false, ref_physical = $2, ref_picked = $3, ref_at = NOW(), ref_error = $4
            WHERE id = $1`,
          [r.id, physical, physical === null ? null : (pickedOut.get(r.product_id) || 0),
            physical === null ? 'Inconnu de BMS' : null]
        );
        if (!done.has(r.inventory_id)) done.set(r.inventory_id, []);
        done.get(r.inventory_id).push(r.product_id);
      }));
      if (!limited) await sleep(PAUSE_MS);
    }
    for (const [inventoryId, productIds] of done) await evaluate(inventoryId, productIds);
    if (limited) console.log('[Inventaire] Quota BMS atteint : relevés repris à la minute suivante');
  } finally {
    running = false;
  }
};

/** Lance la file sans attendre (le PDA n'a pas à patienter pour BMS). */
const kick = () => {
  processPending().catch(error => console.error('[Inventaire] File des relevés :', error.message));
};

module.exports = { processPending, kick, evaluate };
