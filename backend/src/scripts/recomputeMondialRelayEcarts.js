/**
 * Recalcule tarif dû, écart et motif des colis Mondial Relay déjà importés,
 * selon les CGV de la période de chaque facture (cf. classifyParcels).
 *
 * L'écran recalcule déjà à la lecture ; ce script réaligne le JSON enregistré,
 * que lit la colonne « Réclamable » de l'historique.
 *
 *   node src/scripts/recomputeMondialRelayEcarts.js           → simulation, rien n'est écrit
 *   node src/scripts/recomputeMondialRelayEcarts.js --apply   → met à jour parcels_detail.csv
 *
 * Seul parcels_detail->'csv' change : ni les montants des colis
 * (carrier_invoice_parcels), ni les coûts des commandes.
 */
const pool = require('../config/database');
const { classifyParcels, cgvForInvoice, CLAIMABLE_KINDS } = require('../parsers/mondialRelayCsvParser');

const APPLY = process.argv.includes('--apply');
const sumClaim = parcels => Math.round(parcels
  .filter(p => CLAIMABLE_KINDS.includes(p.kind))
  .reduce((s, p) => s + (p.ecart || 0), 0) * 100) / 100;

(async () => {
  const { rows } = await pool.query(`
    SELECT id, invoice_number, parcels_detail->>'periodStart' AS period_start,
           parcels_detail->>'invoiceDate' AS invoice_date, parcels_detail->'csv' AS csv
    FROM carrier_invoices
    WHERE carrier = 'mondial_relay' AND parcels_detail ? 'csv'
    ORDER BY id
  `);
  let changed = 0;
  for (const r of rows) {
    const csv = r.csv;
    const before = csv.parcels.map(p => `${p.kind}|${p.ecart}`).join(',');
    const claimBefore = sumClaim(csv.parcels);
    csv.cgv = cgvForInvoice({ periodStart: r.period_start, invoiceDate: r.invoice_date });
    classifyParcels(csv.parcels, { remiseRate: csv.remiseRate, cgv: csv.cgv });
    const after = csv.parcels.map(p => `${p.kind}|${p.ecart}`).join(',');
    if (before === after) continue;
    changed++;
    const diffs = csv.parcels.filter((p, i) => before.split(',')[i] !== `${p.kind}|${p.ecart}`);
    console.log(`${r.invoice_number} (CGV ${csv.cgv}) : réclamable ${claimBefore} € → ${sumClaim(csv.parcels)} € ; ${diffs.length} colis modifié(s)`);
    for (const p of diffs.filter(d => CLAIMABLE_KINDS.includes(d.kind))) {
      console.log(`   ${p.ref} ${p.kind} : facturé ${p.transport} €, dû ${p.due} €, écart ${p.ecart} €`);
    }
    if (APPLY) {
      await pool.query(
        `UPDATE carrier_invoices SET parcels_detail = jsonb_set(parcels_detail, '{csv}', $2::jsonb) WHERE id = $1`,
        [r.id, JSON.stringify(csv)]
      );
    }
  }
  console.log(`${rows.length} facture(s) lue(s), ${changed} à recalculer${APPLY ? ' — appliqué' : ' — simulation, rien n\'est écrit (--apply pour écrire)'}.`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
