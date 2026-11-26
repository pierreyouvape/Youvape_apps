const cron = require('node-cron');
const pool = require('../config/database');

/**
 * App Tâches — l'étape « Stockage » passe en « Fait » toute seule dès que le
 * produit lié à la tâche a du stock (décision Maxime, 26/11/2026).
 *
 * Produit lié : `taches_tasks.wp_product_id`, retrouvé depuis le lien de la
 * fiche (…/produit/…/<slug>/) par WooCommerce (tachesModel.resolveProduct).
 * 0 = lien sans produit trouvé : on ne le recherche plus tant que le lien ne
 * change pas.
 *
 * Stock : notre table `products` (synchronisée avec le site), produit simple
 * ou somme de ses déclinaisons, pièces > 0. Le passage à « Fait » suit le
 * chemin normal (tachesModel.updateStep) : étape suivante débloquée, Slack,
 * cloche, journal — avec « l'app (stock reçu) » comme auteur.
 */

const MAX_RESOLVE_PER_RUN = 20;

async function run() {
  const tachesModel = require('../models/tachesModel');
  const { rows: open } = await pool.query(
    `SELECT t.id AS task_id, t.title, t.wp_product_id, s.id AS step_id, s.note
       FROM taches_tasks t
       JOIN taches_steps s ON s.task_id = t.id
      WHERE t.archived_at IS NULL AND lower(s.name) = 'stockage' AND s.status <> 'fait'
        AND t.link_url ~* 'youvape\\.fr/produit/'`,
  );
  let resolved = 0;
  let done = 0;
  for (const r of open) {
    let productId = r.wp_product_id;
    if (productId === null || productId === undefined) {
      if (resolved >= MAX_RESOLVE_PER_RUN) continue;
      resolved += 1;
      try {
        productId = await tachesModel.resolveProduct(r.task_id);
      } catch (e) {
        console.error(`[Tâches stock] produit de la tâche #${r.task_id} :`, e.message);
        continue;
      }
    }
    if (!productId) continue;
    const { rows: [st] } = await pool.query(
      `SELECT COALESCE(SUM(GREATEST(stock, 0)), 0)::int AS pieces
         FROM products
        WHERE (wp_product_id = $1 OR wp_parent_id = $1) AND wc_deleted_at IS NULL`,
      [productId],
    );
    if (st.pieces > 0) {
      const day = new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short' });
      const note = `${r.note ? `${r.note} · ` : ''}Fait automatiquement le ${day} : ${st.pieces} pièce${st.pieces > 1 ? 's' : ''} en stock`;
      try {
        await tachesModel.updateStep(null, r.step_id, { status: 'fait', note }, { auto: 'l\'app (stock reçu)' });
        done += 1;
      } catch (e) {
        console.error(`[Tâches stock] tâche #${r.task_id} :`, e.message);
      }
    }
  }
  if (done || resolved) console.log(`[Tâches stock] ${done} « Stockage » cochés, ${resolved} produits recherchés`);
  return { done, resolved };
}

let job = null;
/** Toutes les 10 minutes, de 7 h à 21 h (heure de Paris). */
function setup() {
  if (job) job.stop();
  job = cron.schedule('*/10 7-21 * * *', () => {
    run().catch((e) => console.error('[Tâches stock]', e.message));
  }, { timezone: 'Europe/Paris' });
  console.log('Cron Tâches « Stockage » automatique : toutes les 10 min, 7h-21h (Europe/Paris)');
}

module.exports = { run, setup };
