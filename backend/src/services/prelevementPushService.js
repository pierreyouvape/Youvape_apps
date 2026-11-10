/**
 * Prélèvements boutique — file des écritures (cron chaque minute + dès qu'un
 * prélèvement est enregistré).
 *
 * Deux étapes indépendantes par ligne :
 *   site : sortie du stock du site (siteStock → BMS aujourd'hui)
 *   nx   : entrée dans le stock de la boutique (Nextore PUT /stocks, en DELTA)
 * Même discipline que inventoryPushService : « sending » posé AVANT l'appel ;
 * une ligne restée là (serveur arrêté pendant l'appel) passe en erreur
 * « VÉRIFIEZ » au bout de STALE_MINUTES, jamais renvoyée seule. Refus net (4xx)
 * = erreur simple ; quota BMS = retour en file.
 */

const pool = require('../config/database');
const siteStock = require('./siteStock');
const nextoreApi = require('./nextoreApiClient');

const STALE_MINUTES = 10;
const BATCH = 100;
const PAUSE_MS = 200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STEPS = {
  site: {
    send: async (r) => {
      const { ref } = await siteStock.removeFromSite({
        sku: r.sku, qty: r.qty, comment: `Prélèvement boutique n°${r.id}${r.user_name ? ` · ${r.user_name}` : ''}`,
      });
      return { ref };
    },
    done: (id, out) => pool.query(
      `UPDATE boutique_prelevements SET site_status = 'sent', site_ref = $2, site_at = NOW(), site_error = NULL WHERE id = $1`,
      [id, out.ref]
    ),
  },
  nx: {
    send: async (r) => {
      try {
        await nextoreApi.putStock(r.nx_product_id, r.warehouse_id, Number(r.nx_qty), `Prélèvement site n°${r.id}`);
      } catch (error) {
        if (/HTTP 4\d\d/.test(error.message)) throw error;
        throw Object.assign(new Error(`Réponse Nextore incertaine, VÉRIFIEZ le stock dans la caisse avant de réessayer : ${error.message}`), { uncertain: true });
      }
      // Miroir local, sans attendre la synchro des 10 minutes.
      await pool.query(
        `INSERT INTO nextore_stock (product_id, warehouse_id, stock) VALUES ($1, $2, $3)
         ON CONFLICT (product_id, warehouse_id) DO UPDATE SET stock = COALESCE(nextore_stock.stock, 0) + EXCLUDED.stock`,
        [r.nx_product_id, r.warehouse_id, Number(r.nx_qty)]
      );
      return {};
    },
    done: (id) => pool.query(
      `UPDATE boutique_prelevements SET nx_status = 'sent', nx_at = NOW(), nx_error = NULL WHERE id = $1`, [id]
    ),
  },
};

const runStep = async (step) => {
  const def = STEPS[step];
  await pool.query(
    `UPDATE boutique_prelevements
        SET ${step}_status = 'error',
            ${step}_error = 'Envoi interrompu (serveur redémarré pendant l''appel) : VÉRIFIEZ si l''écriture est passée avant de réessayer.'
      WHERE ${step}_status = 'sending' AND ${step}_at < NOW() - make_interval(mins => $1)`,
    [STALE_MINUTES]
  );
  const { rows: ids } = await pool.query(
    `SELECT id FROM boutique_prelevements WHERE ${step}_status = 'queued' ORDER BY id LIMIT $1`, [BATCH]
  );
  for (const { id } of ids) {
    const { rows: [r] } = await pool.query(
      `UPDATE boutique_prelevements b SET ${step}_status = 'sending', ${step}_at = NOW()
        WHERE b.id = $1 AND b.${step}_status = 'queued'
        RETURNING b.*, (SELECT name FROM users WHERE id = b.created_by) AS user_name`,
      [id]
    );
    if (!r) continue;
    try {
      await def.done(id, await def.send(r));
    } catch (error) {
      if (/Too Many Attempts/i.test(error.message) || error.statusCode === 503) {
        await pool.query(`UPDATE boutique_prelevements SET ${step}_status = 'queued' WHERE id = $1`, [id]);
        console.log(`[Prélèvements] ${step} : service saturé, reprise à la minute suivante`);
        break;
      }
      await pool.query(
        `UPDATE boutique_prelevements SET ${step}_status = 'error', ${step}_error = $2 WHERE id = $1`,
        [id, String(error.message || 'Erreur inconnue').slice(0, 500)]
      );
    }
    await sleep(PAUSE_MS);
  }
};

let running = false;
const processQueue = async () => {
  if (running) return;
  running = true;
  try {
    await runStep('site');
    await runStep('nx');
  } finally {
    running = false;
  }
};

const kick = () => {
  processQueue().catch((error) => console.error('[Prélèvements] File :', error.message));
};

module.exports = { processQueue, kick };
