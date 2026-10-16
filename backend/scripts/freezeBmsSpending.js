#!/usr/bin/env node
/**
 * Fige l'historique des dépenses fournisseur lu dans BMS (onglet Dépenses de
 * /purchases).
 *
 * Depuis octobre 2026, les factures fournisseur sont saisies dans l'app
 * (/factures-fournisseurs). L'onglet Dépenses n'appelle donc plus BMS : il lit
 *   - avant le 1er octobre 2026 : les bons BMS « complète » + « vérifiée »,
 *     recopiés UNE FOIS dans supplier_spending_bms_history par ce script ;
 *   - ensuite : les factures et avoirs de supplier_documents.
 *
 * Même règle que l'ancien écran : le mois est celui de la DATE DE COMMANDE
 * (created_at BMS, heure de Paris, jamais reconvertie).
 *
 * Relançable : la table est vidée puis réécrite dans une transaction.
 *
 * Usage : node scripts/freezeBmsSpending.js [--apply]
 *         (sans --apply : simulation, aucune écriture)
 */

const pool = require('../src/config/database');
const bmsApiModel = require('../src/models/bmsApiModel');

const CUTOFF = '2026-10-01';

async function main() {
  const apply = process.argv.includes('--apply');

  const all = await bmsApiModel.getPurchaseOrders();
  console.log(`BMS : ${all.length} bons de commande lus`);

  const kept = all
    .filter(o => o.status === 'complete' && Number(o.verified) === 1)
    .filter(o => o.created_at && o.created_at.slice(0, 10) < CUTOFF)
    .map(o => ({
      bms_po_id: o.id,
      reference: o.reference || null,
      bms_supplier_id: o.supplier_id || null,
      supplier_name: o.supplier_name || 'Inconnu',
      // « 2026-09-25T12:33:37.000000+02:00 » : on garde l'heure de Paris telle quelle.
      order_date: o.created_at.slice(0, 19).replace('T', ' '),
      eta: o.eta || null,
      ht: parseFloat(o.subtotal) || 0,
      ttc: parseFloat(o.grandtotal) || 0,
    }));

  const byMonth = {};
  for (const o of kept) {
    const m = o.order_date.slice(0, 7);
    byMonth[m] = (byMonth[m] || 0) + o.ht;
  }
  const ht = kept.reduce((a, o) => a + o.ht, 0);
  console.log(`À figer : ${kept.length} bons « complète + vérifiée » avant le ${CUTOFF}, ${ht.toFixed(2)} € HT`);
  for (const [m, v] of Object.entries(byMonth).sort().slice(-6)) console.log(`  ${m} : ${v.toFixed(2)} € HT`);

  if (!apply) {
    console.log('\nSimulation. Relancer avec --apply pour écrire.');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS supplier_spending_bms_history (
        bms_po_id       INTEGER PRIMARY KEY,
        reference       VARCHAR(80),
        bms_supplier_id INTEGER,
        supplier_name   VARCHAR(255) NOT NULL,
        order_date      TIMESTAMP NOT NULL,
        eta             DATE,
        ht              NUMERIC(12,4) NOT NULL,
        ttc             NUMERIC(12,4) NOT NULL,
        frozen_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
    await client.query('CREATE INDEX IF NOT EXISTS idx_supplier_spending_bms_history_date ON supplier_spending_bms_history (order_date)');
    await client.query('DELETE FROM supplier_spending_bms_history');
    for (const o of kept) {
      await client.query(
        `INSERT INTO supplier_spending_bms_history
           (bms_po_id, reference, bms_supplier_id, supplier_name, order_date, eta, ht, ttc)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [o.bms_po_id, o.reference, o.bms_supplier_id, o.supplier_name, o.order_date, o.eta, o.ht, o.ttc],
      );
    }
    await client.query('COMMIT');
    console.log(`✓ ${kept.length} bons figés dans supplier_spending_bms_history`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

main()
  .then(() => pool.end())
  .catch((e) => { console.error(e); pool.end(); process.exit(1); });
