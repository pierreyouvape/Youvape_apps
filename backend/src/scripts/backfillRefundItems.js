/**
 * Rattrapage des lignes de remboursement (refund_items) pour les remboursements
 * arrivés avant la table : une lecture de l'API WC par commande.
 *
 * Seuls les remboursements dont les lignes n'ont jamais été lues
 * (refunds.lines_synced_at IS NULL) sont repris. Les plus anciens n'ont pas
 * besoin d'y passer : la fiche commande les relit d'elle-même à l'affichage.
 *
 * Usage (sur le VPS, depuis le container backend) :
 *   docker exec youvape_backend node src/scripts/backfillRefundItems.js            # compte seulement
 *   docker exec youvape_backend node src/scripts/backfillRefundItems.js --apply    # 60 derniers jours
 *   docker exec youvape_backend node src/scripts/backfillRefundItems.js --days 365 --apply
 */

'use strict';

const pool = require('../config/database');
const refundLinesService = require('../services/refundLinesService');

async function main() {
  const apply = process.argv.includes('--apply');
  const daysArg = process.argv.indexOf('--days');
  const days = daysArg > -1 ? parseInt(process.argv[daysArg + 1], 10) : 60;
  if (!Number.isFinite(days) || days <= 0) throw new Error('--days attend un nombre de jours positif');

  const { rows } = await pool.query(
    `SELECT wp_order_id FROM refunds
      WHERE lines_synced_at IS NULL
        AND COALESCE(refund_date, created_at) >= NOW() - ($1 || ' days')::interval
      GROUP BY wp_order_id
      ORDER BY max(COALESCE(refund_date, created_at)) DESC`,
    [days]
  );
  console.log(`${rows.length} commande(s) avec un remboursement non détaillé sur ${days} jours.`);
  if (!apply) {
    console.log('Rien d\'écrit. Relancer avec --apply.');
    return;
  }

  let ok = 0;
  const failed = [];
  for (const { wp_order_id: id } of rows) {
    try {
      await refundLinesService.syncOrder(id);
      ok++;
    } catch (error) {
      failed.push(`#${id} : ${error.message}`);
    }
  }
  console.log(`${ok} commande(s) détaillée(s), ${failed.length} échec(s).`);
  for (const f of failed) console.log(`  ${f}`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => pool.end());
