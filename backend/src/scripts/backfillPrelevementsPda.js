/**
 * Reprise des PDA « Vente boutique » passés dans les prélèvements (refacturation EMC → EMC2).
 *
 *   node src/scripts/backfillPrelevementsPda.js           → simulation (transaction annulée)
 *   node src/scripts/backfillPrelevementsPda.js --apply   → écrit
 *
 * Chaque mouvement PDA devient une ligne datée de SON jour, sortie du site déjà
 * faite (n° BMS repris), entrée en caisse `skipped` : la pièce est déjà vendue,
 * on ne touche pas au stock Nextore. Coût = PMP FIFO DU JOUR du mouvement
 * (services/costAtDate, même calcul que la valeur de stock aux dates passées).
 * Rejouable : une ligne PDA déjà reprise (pda_log_id) est sautée. Ne reprend que
 * ce qui précède le premier prélèvement PDA enregistré en direct, pour ne jamais
 * passer en « reprise » un mouvement fait après l'activation. À relancer juste
 * avant de poser `app_config.prelevements_pda = 'on'`.
 */

require('dotenv').config();
const pool = require('../config/database');
const { costsAtDates } = require('../services/costAtDate');

const apply = process.argv.includes('--apply');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [{ until }] } = await client.query(
      `SELECT COALESCE(min(created_at), NOW()) AS until FROM boutique_prelevements
        WHERE origin = 'pda' AND nx_status <> 'skipped'`
    );
    // pda_product_log.created_at est en UTC (fuseau de la base), sans fuseau.
    const { rows: logs } = await client.query(
      `SELECT l.id, l.product_id, COALESCE(p.sku, l.sku) AS sku, p.post_title AS name, -l.qty AS qty,
              l.user_id, l.bms_movement_id, l.created_at AT TIME ZONE 'UTC' AS at,
              to_char((l.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS day
         FROM pda_product_log l
         JOIN products p ON p.id = l.product_id
        WHERE l.action = 'movement' AND l.reason = 'vente_boutique' AND l.qty < 0
          AND (l.created_at AT TIME ZONE 'UTC') < $1
          AND NOT EXISTS (SELECT 1 FROM boutique_prelevements b WHERE b.pda_log_id = l.id)
        ORDER BY l.id`,
      [until]
    );
    const costs = await costsAtDates(logs.map((l) => ({ productId: l.product_id, date: l.day })));
    const ids = [];
    for (const l of logs) {
      const { rows: [r] } = await client.query(
        `INSERT INTO boutique_prelevements
           (warehouse_id, product_id, sku, name, qty, unit_cost_ht, origin, note, created_by, created_at,
            site_status, site_ref, site_at, nx_status, pda_log_id)
         VALUES (2, $1, $2, $3, $4, $5, 'pda', 'Reprise historique PDA « Vente boutique »', $6, $7,
                 'sent', $8, $7, 'skipped', $9)
         RETURNING id`,
        [l.product_id, l.sku, l.name, l.qty, costs.get(`${l.product_id}|${l.day}`), l.user_id, l.at,
          l.bms_movement_id == null ? null : String(l.bms_movement_id), l.id]
      );
      ids.push(r.id);
    }
    const { rows: months } = await client.query(
      `SELECT to_char(created_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM') AS mois, count(*)::int AS lignes,
              sum(qty)::int AS pieces, round(sum(qty * unit_cost_ht), 2) AS total_ht,
              count(*) FILTER (WHERE unit_cost_ht IS NULL)::int AS sans_cout
         FROM boutique_prelevements WHERE id = ANY($1::bigint[]) GROUP BY 1 ORDER BY 1`,
      [ids]
    );
    const { rows: [orphans] } = await client.query(
      `SELECT count(*)::int AS n FROM pda_product_log
        WHERE action = 'movement' AND reason = 'vente_boutique' AND product_id IS NULL`
    );
    console.table(months);
    console.log(`${ids.length} ligne(s) reprise(s) jusqu'au ${new Date(until).toISOString()}`
      + (orphans.n ? ` — ${orphans.n} mouvement(s) PDA sans produit (supprimé) ignoré(s)` : ''));
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    console.log(apply ? 'Écrit.' : 'Simulation : rien n\'est écrit (--apply pour écrire).');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
