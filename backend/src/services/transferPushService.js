/**
 * Transferts de stock — file des SORTIES de stock à l'origine (cron chaque minute
 * + dès qu'un transfert est envoyé). L'entrée, elle, se fait à la réception de la
 * commande créée par le transfert (Boutique › Commandes, ou app Réception).
 *
 *   site → boutique : sortie BMS (siteStock.removeFromSite, mouvement « miscellaneous »)
 *   boutique → site : sortie Nextore en DELTA (PUT /stocks), stock relu avant et,
 *                     en cas d'erreur, après — comme le mouvement du PDA boutique
 *
 * Même discipline que prelevementPushService : `sending` posé AVANT l'appel ; une
 * ligne restée là (serveur arrêté pendant l'appel) passe en erreur « VÉRIFIEZ »
 * au bout de STALE_MINUTES, jamais renvoyée seule. Quota BMS / 503 = retour en file.
 */

const pool = require('../config/database');
const siteStock = require('./siteStock');
const nextoreApi = require('./nextoreApiClient');
const { resolveWarehouse } = require('../config/nextore');

const STALE_MINUTES = 10;
const BATCH = 100;
const PAUSE_MS = 200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shop = (id) => resolveWarehouse(id)?.name || `boutique ${id}`;

/** Sortie Nextore : jugée sur le stock relu, jamais sur la seule réponse de l'appel. */
const shopOut = async (r) => {
  const nxId = String(r.nx_product_id);
  let before;
  try { before = await nextoreApi.getLiveStock(r.warehouse_id, nxId); } catch (e) { before = null; }
  if (!Number.isFinite(before)) throw Object.assign(new Error('Stock de la caisse illisible : rien n\'est envoyé.'), { retryLater: true });
  if (before < r.qty_shop) throw new Error(`Stock en boutique (${before}) inférieur à la sortie (${r.qty_shop}) : à vérifier.`);
  await pool.query('UPDATE stock_transfer_items SET out_stock_before = $2 WHERE id = $1', [r.id, before]);
  const delta = -Number(r.qty_shop);
  const ref = `Transfert n°${r.transfer_id} vers site`;
  let after = null;
  try {
    const res = await nextoreApi.putStock(nxId, r.warehouse_id, delta, ref);
    if (res === false) throw new Error('Nextore a répondu « false »');
    after = before + delta;
  } catch (error) {
    try { after = await nextoreApi.getLiveStock(r.warehouse_id, nxId); } catch (e) { after = null; }
    if (Number.isFinite(after) && after === before) throw new Error(`Nextore a refusé la sortie, stock inchangé : ${error.message}`);
    if (!(Number.isFinite(after) && after === before + delta)) {
      throw new Error(`Réponse Nextore incertaine, VÉRIFIEZ le stock dans la caisse avant de réessayer : ${error.message}`);
    }
  }
  try {
    await pool.query('UPDATE nextore_stock SET stock = $3 WHERE product_id = $1 AND warehouse_id = $2', [nxId, r.warehouse_id, after]);
  } catch (error) {
    console.error('[Transferts] Miroir du stock caisse non mis à jour :', error.message);
  }
  return { ref: null };
};

const sendOne = (r) => (r.direction === 'site_to_shop'
  ? siteStock.removeFromSite({
    sku: r.sku,
    qty: r.qty_site,
    comment: `Transfert n°${r.transfer_id} vers ${shop(r.warehouse_id)}${r.user_name ? ` · ${r.user_name}` : ''}`,
  })
  : shopOut(r));

let running = false;
const processQueue = async () => {
  if (running) return;
  running = true;
  try {
    await pool.query(
      `UPDATE stock_transfer_items
          SET out_status = 'error',
              out_error = 'Envoi interrompu (serveur redémarré pendant l''appel) : VÉRIFIEZ si la sortie est passée avant de réessayer.'
        WHERE out_status = 'sending' AND out_at < NOW() - make_interval(mins => $1)`,
      [STALE_MINUTES]
    );
    const { rows: ids } = await pool.query(
      `SELECT id FROM stock_transfer_items WHERE out_status = 'queued' ORDER BY id LIMIT $1`, [BATCH]
    );
    for (const { id } of ids) {
      const { rows: [r] } = await pool.query(
        `UPDATE stock_transfer_items i SET out_status = 'sending', out_at = NOW()
          FROM stock_transfers t
          WHERE i.id = $1 AND i.out_status = 'queued' AND t.id = i.transfer_id AND t.status = 'sent'
          RETURNING i.*, t.direction, t.warehouse_id, (SELECT name FROM users WHERE id = t.sent_by) AS user_name`,
        [id]
      );
      if (!r) continue;
      try {
        const out = await sendOne(r);
        await pool.query(
          "UPDATE stock_transfer_items SET out_status = 'sent', out_ref = $2, out_at = NOW(), out_error = NULL WHERE id = $1",
          [id, out?.ref ?? null]
        );
      } catch (error) {
        if (error.retryLater || /Too Many Attempts/i.test(error.message) || error.statusCode === 503) {
          await pool.query("UPDATE stock_transfer_items SET out_status = 'queued' WHERE id = $1", [id]);
          console.log('[Transferts] service saturé ou illisible, reprise à la minute suivante');
          break;
        }
        await pool.query(
          "UPDATE stock_transfer_items SET out_status = 'error', out_error = $2 WHERE id = $1",
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
  processQueue().catch((error) => console.error('[Transferts] File :', error.message));
};

module.exports = { processQueue, kick };
