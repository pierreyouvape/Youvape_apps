/**
 * Facture La Poste « Lettre Suivie » au format électronique (depuis octobre 2026).
 * Fixture = texte brut figé de pdf-parse de PF20260001712891 (consommations de septembre 2026).
 * Les totaux attendus sont ceux imprimés sur la facture.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseLettreSuiviePdf } = require('../src/parsers/lettreSuivieParser');

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

console.log('Lettre Suivie — facture électronique');
const r = parseLettreSuiviePdf(fs.readFileSync(path.join(__dirname, 'fixtures', 'lettresuivie-PF20260001712891.txt'), 'utf-8'));

test('facture reconnue', () => {
  assert.strictEqual(r.invoiceNumber, 'PF20260001712891');
  assert.strictEqual(r.invoiceDate, '08/10/2026');
  assert.strictEqual(r.periodStart, '01/09/2026');
  assert.strictEqual(r.periodEnd, '30/09/2026');
  assert.strictEqual(r.contractNumber, 'D-1153498-1');
  assert.strictEqual(r.contractType, 'API AFF ENTREPRISE');
  assert.strictEqual(r.format, 'B');
});

test('totaux imprimés et lignes au centime', () => {
  assert.strictEqual(r.totalHT, 419.40);
  assert.strictEqual(r.totalTVA, 0);
  assert.strictEqual(r.totalTTC, 419.40);
  assert.strictEqual(r.stats.nb_lines, 25);
  assert.strictEqual(r.stats.nb_lettres, 233);
  assert.strictEqual(r.stats.lines_total, 419.40);
  assert.ok(r.stats.reconcile_ok);
  assert.deepStrictEqual(r.tierSummary.map(t => [t.tier, t.pu, t.qty]), [['0–20 g', 1.8, 233]]);
});

if (failed) { console.log(`\n${failed} échec(s)`); process.exit(1); }
console.log('\nOK');
