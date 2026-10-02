#!/usr/bin/env node
/**
 * Rattrapage de purchase_orders.received_date : la date RÉELLE de réception.
 *
 * Jusqu'au 02/10/2026, la synchro BMS y recopiait `updated_at` du bon terminé —
 * sa dernière MODIFICATION, pas sa réception. Un tarif corrigé au contrôle de
 * facture repoussait la date de plusieurs heures (S313016 : reçue à 12h34,
 * affichée 16h11), une retouche des semaines plus tard la déplaçait d'autant.
 *
 * Règle, identique à syncFromBMS :
 *   - commande terminée (completed / received) → date de sa DERNIÈRE réception
 *     dans le journal BMS (/supplier/receptions) ;
 *   - terminée sans aucune réception au journal → pas de date ;
 *   - toute autre commande → pas de date (« reçue » ne se dit qu'une fois reçue).
 *
 * Les commandes absentes de BMS (bms_po_id NULL) ne sont pas touchées.
 *
 * ⚠️ received_date date aussi les lots FIFO (computedCostModel,
 * stockValuationModel) : quelques lots peuvent changer d'ordre.
 *
 * Usage : node scripts/backfillReceivedDates.js [--apply]
 *         (sans --apply : simulation, aucune écriture)
 */

const pool = require('../src/config/database');
const bmsApiModel = require('../src/models/bmsApiModel');

const fmt = (d) => {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())} ${p(x.getHours())}:${p(x.getMinutes())}:${p(x.getSeconds())}`;
};

async function main() {
  const apply = process.argv.includes('--apply');

  const dates = await bmsApiModel.getReceptionDatesByReference();
  console.log(`Journal BMS : ${dates.size} clés de réception lues`);

  const { rows } = await pool.query(`
    SELECT po.id, po.bms_reference, po.status, po.received_date, lower(trim(s.name)) AS supplier
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
     WHERE po.bms_po_id IS NOT NULL
  `);

  const changes = [];
  const stats = { unchanged: 0, corrected: 0, cleared: 0, filled: 0, completedWithoutReception: 0 };
  for (const o of rows) {
    const ref = String(o.bms_reference || '').trim().toLowerCase();
    let target = null;
    if (['completed', 'received'].includes(o.status)) {
      target = dates.get(`${ref}|${o.supplier}`) || dates.get(ref) || null;
      if (!target) stats.completedWithoutReception++;
    }
    const current = fmt(o.received_date);
    if (current === target) { stats.unchanged++; continue; }
    if (!current) stats.filled++;
    else if (!target) stats.cleared++;
    else stats.corrected++;
    changes.push({ id: o.id, ref: o.bms_reference, status: o.status, from: current, to: target });
  }

  console.log(stats);
  console.log('Exemples :');
  for (const c of changes.slice(0, 15)) {
    console.log(`  #${c.id} ${c.ref} [${c.status}] ${c.from || '—'} → ${c.to || '—'}`);
  }

  if (!apply) {
    console.log(`\nSimulation : ${changes.length} commande(s) à corriger. Relancer avec --apply pour écrire.`);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const c of changes) {
      await client.query('UPDATE purchase_orders SET received_date = $1 WHERE id = $2', [c.to, c.id]);
    }
    await client.query('COMMIT');
    console.log(`\n${changes.length} commande(s) corrigée(s).`);
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
