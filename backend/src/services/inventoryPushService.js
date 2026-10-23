/**
 * Inventaire (lot 2) — envoi des écarts validés à BMS.
 *
 * Un écart part en mouvement d'ajustement (catégorie `adjustment`) du MONTANT
 * DE L'ÉCART, jamais en quantité absolue : les ventes et réceptions survenues
 * depuis le comptage restent justes dans BMS. Même écriture que PDA › Produit,
 * validée en réel le 06/10/2026.
 *
 * File `inventory_items.push_status` : queued → sending → sent | error.
 * « sending » est posé AVANT l'appel : une ligne restée là (serveur arrêté au
 * mauvais moment) n'est jamais renvoyée seule — le mouvement est peut-être
 * parti, il faut regarder BMS. Au bout de STALE_MINUTES, elle passe en erreur
 * « VÉRIFIEZ » : sinon aucun bouton ne la reprenait et elle bloquait la clôture. Quota BMS (« Too Many Attempts ») : la ligne
 * revient en file et le cron de la minute suivante reprend.
 */

const pool = require('../config/database');
const bmsApiModel = require('../models/bmsApiModel');
const pdaProductModel = require('../models/pdaProductModel');
const { gapOf, movementFor } = require('./inventoryRules');

const PAUSE_MS = 200;
// Un envoi prend quelques secondes : au-delà, le serveur s'est arrêté pendant l'appel.
const STALE_MINUTES = 10;
const BATCH = 200;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const COUNTED_SQL = `(SELECT COALESCE(sum(c.qty), 0)::int FROM inventory_counts c
                       WHERE c.inventory_id = i.inventory_id AND c.product_id = i.product_id)`;

/** Envoie UN écart. Renvoie { movementId, qty } ; lève en cas d'échec. */
const pushOne = async (r) => {
  const { gap } = gapOf(r);
  const mv = movementFor(gap);
  if (!mv) return { movementId: null, qty: 0 };

  if (mv.direction === 'out') {
    const stock = await pdaProductModel.readBmsStock(r.sku);
    if (mv.qty > stock.physical) {
      throw new Error(`Stock physique BMS (${stock.physical}) inférieur à la sortie (${mv.qty}) : il a bougé depuis le comptage, faites recompter.`);
    }
  }
  const comments = ['Inventaire', r.inventory_name, r.user_name].filter(Boolean).join(' · ').slice(0, 100);
  const bmsProductId = await pdaProductModel.findBmsProductId(r.sku);
  let created;
  try {
    created = await bmsApiModel.apiCall('/v2/stock-movements', 'POST', {
      product_id: bmsProductId,
      ...(mv.direction === 'in'
        ? { to_warehouse_id: pdaProductModel.BMS_WAREHOUSE_ID }
        : { from_warehouse_id: pdaProductModel.BMS_WAREHOUSE_ID }),
      qty: mv.qty,
      category: 'adjustment',
      comments,
    });
  } catch (error) {
    // Un refus net (4xx) n'a rien écrit ; tout autre échec a pu passer.
    if (/BMS API error: 4\d\d/.test(error.message) || /Too Many Attempts/i.test(error.message)) throw error;
    throw new Error(`Réponse BMS incertaine, VÉRIFIEZ le mouvement dans BMS avant de réessayer : ${error.message}`);
  }
  const movementId = await pdaProductModel.findMovementId(created, bmsProductId, comments, mv.qty);
  return { movementId, qty: gap };
};

let running = false;

/** Vide la file (cron chaque minute, et dès qu'un responsable envoie). */
const processQueue = async () => {
  if (running) return;
  running = true;
  try {
    await pool.query(
      `UPDATE inventory_items
          SET push_status = 'error',
              push_error = 'Envoi interrompu (serveur redémarré pendant l''appel) : VÉRIFIEZ dans BMS si le mouvement est passé avant de réessayer.'
        WHERE push_status = 'sending' AND push_at < NOW() - make_interval(mins => $1)`,
      [STALE_MINUTES]
    );
    const { rows: ids } = await pool.query(
      `SELECT i.id FROM inventory_items i JOIN inventories v ON v.id = i.inventory_id AND v.status = 'open'
        WHERE i.push_status = 'queued' ORDER BY i.id LIMIT $1`,
      [BATCH]
    );
    for (const { id } of ids) {
      // Le verrou : seule la ligne passée de queued à sending part.
      const { rows: [r] } = await pool.query(
        `UPDATE inventory_items i SET push_status = 'sending', push_at = NOW()
          WHERE i.id = $1 AND i.push_status = 'queued'
          RETURNING i.id, i.sku, i.status, i.recount_qty, i.ref_physical, i.ref_picked, i.decided_by,
                    ${COUNTED_SQL} AS counted,
                    (SELECT name FROM inventories WHERE id = i.inventory_id) AS inventory_name,
                    (SELECT name FROM users WHERE id = i.decided_by) AS user_name`,
        [id]
      );
      if (!r) continue;
      try {
        const { movementId, qty } = await pushOne(r);
        await pool.query(
          `UPDATE inventory_items SET push_status = 'sent', push_qty = $2, push_at = NOW(), push_error = NULL,
                  bms_movement_id = $3
            WHERE id = $1`,
          [id, qty, movementId === null ? null : String(movementId)]
        );
      } catch (error) {
        if (/Too Many Attempts/i.test(error.message)) {
          await pool.query(`UPDATE inventory_items SET push_status = 'queued' WHERE id = $1`, [id]);
          console.log('[Inventaire] Quota BMS atteint : envois repris à la minute suivante');
          break;
        }
        await pool.query(
          `UPDATE inventory_items SET push_status = 'error', push_error = $2 WHERE id = $1`,
          [id, String(error.message || 'Erreur inconnue').slice(0, 500)]
        );
      }
      await sleep(PAUSE_MS);
    }
  } finally {
    running = false;
  }
};

const kick = () => {
  processQueue().catch(error => console.error('[Inventaire] File des envois BMS :', error.message));
};

module.exports = { processQueue, kick, COUNTED_SQL };
