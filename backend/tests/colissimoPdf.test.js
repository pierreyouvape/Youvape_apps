/**
 * Facture Colissimo PDF au « format cible » (réforme facturation électronique).
 *
 * Depuis août 2026 le PDF n'a plus aucun n° de suivi : le parseur historique,
 * amorcé par le tracking, rendait 0 colis et la facture n'était pas reconnue.
 * Fixtures = texte brut figé de pdf-parse des deux factures réelles :
 *   • CO01428174 (août 2026), réconciliée au centime sur son ZIP CSV ;
 *   • CO01485180 (septembre 2026).
 * Les totaux attendus sont ceux imprimés en page 1.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { _parsePdf, _parseCsv, _totalHt } = require('../src/controllers/colissimoController');

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8');
const round = v => Math.round(v * 100) / 100;
const sum = (arr, k) => round(arr.reduce((s, x) => s + x[k], 0));

console.log('Colissimo — PDF format cible');

const CASES = [
  {
    file: 'colissimo-CO01485180.txt', invoice: 'CO01485180', start: '01/09/2026', end: '30/09/2026',
    parcels: 1278, portBrut: 10713.58, remise: -3353.17, portNet: 7360.41, cae: 1030.02, smic: 73.52,
    supplements: 182.70, indemnizations: -130.07, totalHt: 8516.58, supplLines: 8, indemLines: 29,
  },
  {
    file: 'colissimo-CO01428174.txt', invoice: 'CO01428174', start: '01/08/2026', end: '31/08/2026',
    parcels: 1178, portBrut: 9859.85, remise: -3000.43, portNet: 6859.42, cae: 901.24, smic: 68.44,
    supplements: 151.50, indemnizations: -67.27, totalHt: 7913.33,
  },
];

for (const c of CASES) {
  const r = _parsePdf(fixture(c.file));

  test(`${c.invoice} : facture reconnue au format cible`, () => {
    assert.strictEqual(r.format, 'cible');
    assert.strictEqual(r.invoiceNumber, c.invoice);
    assert.strictEqual(r.periodStart, c.start);
    assert.strictEqual(r.periodEnd, c.end);
    assert.strictEqual(r.parcels.length, 0);
    assert.strictEqual(r.parcelCount, c.parcels);
  });

  test(`${c.invoice} : récapitulatif HT au centime`, () => {
    const g = r.globalSummary;
    for (const k of ['portBrut', 'remise', 'portNet', 'cae', 'smic', 'supplements', 'indemnizations', 'totalHt']) {
      assert.strictEqual(g[k], c[k], `${k} : ${g[k]} ≠ ${c[k]}`);
    }
    assert.strictEqual(round(g.portNet + g.cae + g.smic + g.supplements + g.indemnizations), c.totalHt);
  });

  test(`${c.invoice} : chaque ligne de suppléments et d'indemnisations est lue`, () => {
    // la somme des lignes doit retomber sur le total imprimé : une ligne perdue se voit
    assert.strictEqual(sum(r.supplements, 'amount'), c.supplements);
    assert.strictEqual(sum(r.indemnizations, 'amount'), c.indemnizations);
    if (c.supplLines) assert.strictEqual(r.supplements.length, c.supplLines);
    if (c.indemLines) assert.strictEqual(r.indemnizations.length, c.indemLines);
    assert.strictEqual(r.globalSummary.decarbonationUnit, 0.05);
  });
}

test('libellé coupé sur deux lignes recollé', () => {
  const r = _parsePdf(fixture('colissimo-CO01485180.txt'));
  const labels = r.supplements.map(s => s.label);
  assert.ok(labels.includes("qualité d'annonce (Problème CP / Commune) (France métropolitaine) × 5"), labels.join(' | '));
  assert.ok(labels.includes('Participation à la décarbonation (France métropolitaine) × 791'), labels.join(' | '));
});

console.log('Colissimo — ZIP CSV : suppléments comptés une seule fois');

test('le total d\'un colis CSV exclut ses suppléments, le total facture les compte une fois', () => {
  // CSV synthétique au format Colissimo Box (aucun vrai client)
  const H = 'N facture;Date;Compte deposant;Description;Produit;N colis;Pays Destination;Poids Kg;Pourcentage de remise;Total HT;Rubrique de la facture;Code charge;Référence externe colis client';
  const rows = [
    'CO0TEST;02/09/2026;906524;Port;6A;6A00000000001;FRANCE;0,250;;7,71;FRAIS DE PORT;;100001',
    'CO0TEST;02/09/2026;906524;Remise Charge 6A;6A;6A00000000001;FRANCE;;25;-1,93;FRAIS DE PORT;;100001',
    'CO0TEST;02/09/2026;906524;CAE;6A;6A00000000001;FRANCE;;;0,81;COEFFICIENT AJUSTEMENT ENERGIE;;100001',
    'CO0TEST;02/09/2026;906524;SMIC;6A;6A00000000001;FRANCE;;;0,06;AJUSTEMENT SMIC;;100001',
    'CO0TEST;02/09/2026;906524;Article Supplément Participation à la décarbonation;6A;6A00000000001;FRANCE;;;0,05;SUPPLEMENTS;DECARBONATION;100001',
    "CO0TEST;02/09/2026;906524;Supplément : qualité d'annonce;6A;6A00000000001;FRANCE;;;3,00;SUPPLEMENTS;QA;100001",
  ];
  const r = _parseCsv([H, ...rows].join('\n'), '');
  assert.strictEqual(r.parcels.length, 1);
  assert.strictEqual(r.parcels[0].total_ht, 6.70); // 5,78 port net + 0,81 + 0,06 + 0,05
  assert.strictEqual(sum(r.supplements, 'amount'), 3.00);
  assert.strictEqual(_totalHt(r.parcels, 3.00, r.globalSummary), 9.70);
});

test('format cible : total HT enregistré = récap hors indemnisations', () => {
  const r = _parsePdf(fixture('colissimo-CO01485180.txt'));
  assert.strictEqual(_totalHt(r.parcels, sum(r.supplements, 'amount'), r.globalSummary), 8646.65);
});

if (failed) { console.log(`\n${failed} échec(s)`); process.exit(1); }
console.log('\nOK');
