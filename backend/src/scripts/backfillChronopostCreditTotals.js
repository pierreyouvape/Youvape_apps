/**
 * Relit le récapitulatif « TOTAL AVOIR HT TVA TTC » des avoirs Chronopost déjà
 * enregistrés (colonnes ajoutées par add_chronopost_invoice_corrections.sql).
 *
 * L'historique s'en sert pour afficher l'avoir sous sa facture d'origine et
 * déduire son TTC du total ; sans lui, la ligne affiche « — ».
 *
 *   node src/scripts/backfillChronopostCreditTotals.js           → simulation, rien n'est écrit
 *   node src/scripts/backfillChronopostCreditTotals.js --apply   → écrit total_ht / total_ttc
 */
const { PDFParse } = require('pdf-parse');
const pool = require('../config/database');
const { _parsePdf } = require('../controllers/chronopostController');

const APPLY = process.argv.includes('--apply');

(async () => {
  const { rows } = await pool.query(`
    SELECT credit_number, pdf_data FROM carrier_credit_documents
    WHERE carrier = 'chronopost' AND total_ttc IS NULL AND pdf_data IS NOT NULL
    ORDER BY credit_number
  `);
  let found = 0;
  for (const r of rows) {
    const parser = new PDFParse(new Uint8Array(r.pdf_data));
    await parser.load();
    const { text } = await parser.getText();
    const { creditTotalHt, creditTotalTtc } = _parsePdf(text);
    if (creditTotalTtc == null) { console.log(`${r.credit_number} : récapitulatif introuvable`); continue; }
    found++;
    console.log(`${r.credit_number} : HT ${creditTotalHt} € / TTC ${creditTotalTtc} €`);
    if (APPLY) {
      await pool.query(
        `UPDATE carrier_credit_documents SET total_ht = $2, total_ttc = $3 WHERE carrier = 'chronopost' AND credit_number = $1`,
        [r.credit_number, creditTotalHt, creditTotalTtc]
      );
    }
  }
  console.log(`${rows.length} avoir(s) lu(s), ${found} total(aux) trouvé(s)${APPLY ? ' — appliqué' : ' — simulation, rien n\'est écrit (--apply pour écrire)'}.`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
