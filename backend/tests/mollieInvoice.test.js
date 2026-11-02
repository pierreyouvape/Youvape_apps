/**
 * Factures Mollie : lecture du PDF et contrôle contre le contrat.
 *
 * Sans base : `node tests/mollieInvoice.test.js`. Fixtures = texte brut
 * pdf-parse des factures de sept. et oct. 2026, toutes deux conformes.
 * Les commandes sont passées à la main (le contrôle ne lit alors pas la base).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseMollieInvoice } = require('../src/parsers/mollieInvoiceParser');
const { auditInvoice, classifyLine, allocateInvoiceToOrders } = require('../src/services/mollieAuditService');

const fixture = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', `mollie-${n}.txt`), 'utf8');
const r2 = (n) => Math.round(n * 100) / 100;
const clone = (o) => JSON.parse(JSON.stringify(o));

// Commandes d'octobre telles qu'en base, résumées.
const ORDERS_OCT = [
  { title: 'Carte Bancaire', country: 'FR', n: 2050, volume: 102443.08, estimated: 0, method: 'cards', zone: 'FR' },
  { title: 'Carte Bancaire', country: 'BE', n: 282, volume: 19450.21, estimated: 0, method: 'cards', zone: 'EEA' },
  { title: 'Bancontact', country: 'BE', n: 1016, volume: 60507.11, estimated: 0, method: 'bancontact', zone: 'EEA' },
  { title: 'En 3 ou 4x sans frais', country: 'BE', n: 45, volume: 4635.19, estimated: 0, method: 'alma', zone: 'EEA' },
  { title: 'En 3 ou 4x sans frais', country: 'FR', n: 55, volume: 4878.32, estimated: 0, method: 'alma', zone: 'FR' },
  { title: 'Virement saisie automatique', country: 'FR', n: 33, volume: 1184.61, estimated: 0, method: 'paybybank', zone: 'FR' },
];

(async () => {
  // 1. Lecture : en-tête, 30 lignes de détail, somme = total HT.
  const oct = parseMollieInvoice(fixture('MOL-NL-R2026.0001543251'));
  assert.strictEqual(oct.invoiceNumber, 'MOL-NL-R2026.0001543251');
  assert.strictEqual(oct.invoiceDate, '2026-10-31');
  assert.strictEqual(oct.periodStart, '2026-10-01');
  assert.strictEqual(oct.periodEnd, '2026-10-31');
  assert.strictEqual(oct.totalHT, 2719.25);
  assert.strictEqual(oct.prepaid, -2736.61);
  assert.strictEqual(oct.credited, 17.36);
  assert.strictEqual(oct.lines.length, 30);
  assert.strictEqual(oct.summary.length, 9);
  assert.deepStrictEqual(oct.warnings, []);
  assert.strictEqual(r2(oct.lines.reduce((s, l) => s + l.amount, 0)), 2719.25);
  const bc = oct.lines.find((l) => l.label === 'Bancontact (frais fixes)');
  assert.deepStrictEqual([bc.base, bc.rate, bc.rateUnit, bc.amount], [1016, 0.228, 'fixed', 231.64]);

  const sep = parseMollieInvoice(fixture('MOL-NL-R2026.0001371033'));
  assert.strictEqual(sep.totalHT, 2593.4);
  assert.strictEqual(r2(sep.lines.reduce((s, l) => s + l.amount, 0)), 2593.4);

  // 2. Chaque ligne réelle est reconnue.
  for (const l of [...oct.lines, ...sep.lines]) assert.ok(classifyLine(l.label), `ligne non classée : ${l.label}`);

  // 3. Facture réelle : conforme, rapprochement juste.
  const a = await auditInvoice(oct, ORDERS_OCT);
  assert.deepStrictEqual(a.checks.map((c) => c.level), ['ok'], JSON.stringify(a.checks));
  assert.strictEqual(a.totals.overcharge, 0);
  assert.strictEqual(r2(Object.values(a.byCountry).reduce((s, v) => s + v, 0)), 2719.25);
  assert.strictEqual(a.reconciliation.find((r) => r.key === 'alma_be').diffVolume, 0);

  // 4. Hausse Bancontact non prévue : anomalie chiffrée.
  const up = clone(oct);
  const v = up.lines.find((l) => l.label === 'Bancontact (frais variables)');
  v.rate = 1.4; v.unrounded = v.base * 0.014; v.amount = Math.floor(v.unrounded * 100) / 100;
  up.totalHT = r2(up.lines.reduce((s, l) => s + l.amount, 0));
  const b = await auditInvoice(up, ORDERS_OCT);
  const err = b.checks.find((c) => c.title === 'Taux supérieur au contrat');
  assert.ok(err && err.level === 'error');
  assert.strictEqual(err.amount, r2(60488.08 * 0.0007));

  // 5. Pay by Bank à 0,80 % après le 01/12/2026 : le tarif annoncé est opposable.
  const dec = { ...clone(oct), periodStart: '2026-12-01', periodEnd: '2026-12-31' };
  const c = await auditInvoice(dec, []);
  const pbb = c.checks.find((x) => x.title === 'Taux supérieur au tarif annoncé par Mollie');
  assert.ok(pbb && pbb.level === 'error');
  assert.strictEqual(pbb.amount, r2(1184.61 * 0.0035));

  // 6. Ligne inconnue : signalée, jamais ignorée.
  const unk = clone(oct);
  unk.lines.push({ label: 'Klarna (frais fixes)', base: 2, rate: 0.5, rateUnit: 'fixed', unrounded: 1, amount: 1 });
  const d = await auditInvoice(unk, ORDERS_OCT);
  assert.ok(d.checks.some((x) => x.title === 'Ligne inconnue du contrat'));
  assert.ok(d.checks.some((x) => x.title === 'Détail ≠ total facturé'));

  // 7. Frais des commandes : la facture se répartit au centime sur les commandes,
  //    chaque ligne seulement sur son moyen et sa zone.
  const rows = [];
  let id = 1;
  for (const o of ORDERS_OCT) {
    const n = Math.min(o.n, 40);
    for (let i = 0; i < n; i++) rows.push({ id: String(id++), title: o.title, country: o.country, volume: r2(o.volume / o.n), n: 1, method: o.method, zone: o.zone });
  }
  const alloc = allocateInvoiceToOrders(oct, rows, '2026-11-02');
  assert.deepStrictEqual(alloc.unallocated, []);
  assert.strictEqual(alloc.allocated, 2719.25);
  assert.strictEqual(r2(Object.values(alloc.costs).reduce((s, v) => s + v, 0)), 2719.25);
  assert.ok(Object.values(alloc.costs).every((v) => Math.round(v * 100) === v * 100 || Math.abs(Math.round(v * 100) - v * 100) < 1e-6), 'coût au centime');
  const almaBE = rows.filter((r) => r.method === 'alma' && r.country === 'BE').reduce((s, r) => s + alloc.costs[r.id], 0);
  // Alma Belgique = ses deux lignes (214,59 €) + sa part des remboursements Alma (0,50 € sans pays),
  // jamais rien des lignes Alma France.
  assert.ok(almaBE >= 214.59 && almaBE <= 215.09, `Alma BE ${almaBE}`);
  // Tarif recalé : Pay by Bank suit la baisse annoncée au 01/12/2026.
  assert.ok(Math.abs(allocateInvoiceToOrders(oct, rows, '2026-12-05').rates['paybybank|ALL'].pct - 0.45) < 0.01);

  console.log('✓ mollieInvoice : 7 scénarios OK');
})().catch((e) => { console.error(e); process.exit(1); });
