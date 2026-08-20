/**
 * Recalcule les snapshots de valeur de stock déjà enregistrés.
 *
 * Les snapshots pris avant l'alignement sur le catalogue ont été calculés avec un
 * périmètre et un coût faux (prix du PACK appliqué à chaque unité, liste noire de
 * statuts). Les laisser tels quels ferait une marche dans la courbe le jour du correctif.
 *
 * Le recalcul repart du stock actuel rembobiné : la quantité redevient approximative
 * (comme un point "reconstruit"), d'où method = 'recomputed' — la page les affichera
 * donc en "Reconstruit" et non plus en "Exact", ce qui est honnête.
 *
 * Usage (sur le VPS, depuis le container backend) :
 *   docker exec youvape_backend node src/scripts/recomputeStockValuationSnapshots.js            # simulation
 *   docker exec youvape_backend node src/scripts/recomputeStockValuationSnapshots.js --apply    # écriture
 */

'use strict';

const pool = require('../config/database');
const stockValuationModel = require('../models/stockValuationModel');

const APPLY = process.argv.slice(2).includes('--apply');
const eur = (n) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const { rows } = await pool.query(`
    SELECT to_char(snapshot_date, 'YYYY-MM-DD') AS date, total_value_ht, method
    FROM stock_valuation_snapshots
    ORDER BY snapshot_date ASC
  `);

  if (rows.length === 0) {
    console.log('Aucun snapshot a recalculer.');
    await pool.end();
    return;
  }

  console.log(`${rows.length} snapshots — mode ${APPLY ? 'ECRITURE' : 'SIMULATION (ajouter --apply pour ecrire)'}`);
  console.log('date         ancien          nouveau         ecart');

  const base = await stockValuationModel.loadBase();
  const today = new Date().toISOString().slice(0, 10);

  for (const row of rows) {
    // Le jour même est recalculé a la volee par le rapport (et reecrit par le cron du soir).
    if (row.date >= today) continue;

    const before = parseFloat(row.total_value_ht);
    const point = await stockValuationModel.computeAt(row.date, base);
    const after = point.total_value_ht;

    console.log(
      `${row.date}  ${eur(before).padStart(13)}  ${eur(after).padStart(13)}  ${eur(after - before).padStart(13)}`
    );

    if (APPLY) {
      await pool.query(`
        UPDATE stock_valuation_snapshots
        SET total_value_ht = $2,
            value_with_po_history = $3,
            value_without_po_history = $4,
            products_count = $5,
            total_units = $6,
            method = 'recomputed',
            created_at = CURRENT_TIMESTAMP
        WHERE snapshot_date = $1
      `, [row.date, after, point.value_with_po_history, point.value_without_po_history,
          point.products_count, point.total_units]);
    }
  }

  console.log(APPLY ? '=== Snapshots mis a jour ===' : '=== Simulation terminee (rien ecrit) ===');
  await pool.end();
}

main().catch((err) => {
  console.error('[recomputeStockValuationSnapshots][FATAL]', err.message);
  process.exit(1);
});
