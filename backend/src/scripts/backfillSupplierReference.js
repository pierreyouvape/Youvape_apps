/**
 * Rattrape la « Réf Fournisseur » de BMS sur les commandes déjà en base.
 *
 * `syncFromBMS` ne reprend que les bons dont BMS a changé depuis la dernière
 * synchro : les commandes anciennes garderaient `bms_supplier_reference` à NULL
 * pour toujours, et ce sont justement les précommandes — « Précommande JNr
 * 50ml », « Précommande Gorilla X 43K 0mg » — qui attendent depuis des semaines
 * et que cette colonne doit rendre lisibles.
 *
 * La liste BMS porte le champ (vérifié le 30/09/2026), donc un seul appel suffit
 * : pas de requête par commande.
 *
 * Écrit UNIQUEMENT là où nous n'avons rien et où BMS a quelque chose. Une réf
 * déjà posée n'est jamais écrasée, une réf vide côté BMS n'efface rien.
 *
 *   node src/scripts/backfillSupplierReference.js           → simulation
 *   node src/scripts/backfillSupplierReference.js --apply   → écrit
 */
const pool = require('../config/database');
const bmsApiModel = require('../models/bmsApiModel');

const APPLIQUER = process.argv.includes('--apply');

(async () => {
  console.log(APPLIQUER ? 'Mode ÉCRITURE' : 'Mode SIMULATION (ajouter --apply pour écrire)');

  const bons = await bmsApiModel.getPurchaseOrders();
  const refs = new Map();
  for (const o of bons) {
    const ref = String(o.supplier_reference || '').trim();
    if (ref) refs.set(parseInt(o.id, 10), ref);
  }
  console.log(`${bons.length} bons lus dans BMS, ${refs.size} portent une réf fournisseur.`);

  const { rows: locales } = await pool.query(
    `SELECT id, bms_po_id, order_number, bms_supplier_reference
       FROM purchase_orders
      WHERE bms_po_id IS NOT NULL`,
  );

  const aEcrire = locales.filter(l => refs.has(l.bms_po_id) && !l.bms_supplier_reference);
  const dejaPosees = locales.filter(l => l.bms_supplier_reference).length;

  console.log(`${locales.length} commandes locales liées à BMS, ${dejaPosees} ont déjà une réf.`);
  console.log(`${aEcrire.length} à compléter :`);
  for (const l of aEcrire.slice(0, 20)) {
    console.log(`   ${String(l.order_number).padEnd(28)} → ${refs.get(l.bms_po_id)}`);
  }
  if (aEcrire.length > 20) console.log(`   … et ${aEcrire.length - 20} autres.`);

  if (!APPLIQUER || aEcrire.length === 0) {
    console.log(APPLIQUER ? 'Rien à écrire.' : 'Simulation terminée, rien écrit.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const l of aEcrire) {
      await client.query(
        'UPDATE purchase_orders SET bms_supplier_reference = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [l.id, refs.get(l.bms_po_id)],
      );
    }
    await client.query('COMMIT');
    console.log(`${aEcrire.length} commandes complétées.`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Échec, rien écrit :', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})().catch(e => { console.error('Échec :', e.message); process.exit(1); });
