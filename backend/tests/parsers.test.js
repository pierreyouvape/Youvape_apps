/**
 * Banc de non-régression des parseurs de documents fournisseurs.
 *
 * Sans dépendance ni base : `node tests/parsers.test.js` (ou `npm test`).
 * Les fixtures sont le texte BRUT extrait par pdf-parse des vraies factures,
 * figé une fois pour toutes → le test rejoue exactement ce que voit le parseur.
 *
 * Ce banc existe à cause d'un bug silencieux : sur une facture multi-page, le
 * mobilier de saut de page se collait devant le 1er article de la page suivante,
 * qui disparaissait sans le moindre message (Revolute FA020464, 60,00 € HT ;
 * e.tasty FA072725, 54,40 € HT). Toute régression de ce type doit désormais
 * casser ce test.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { findUnparsedRows } = require('../src/models/parseAudit');

// Copie de cleanPdfText (pdfImportModel) : le parseur tourne sur le texte nettoyé.
function cleanPdfText(text) {
  return text
    .replace(/[     ﻿]/g, ' ')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/([A-Za-z0-9])-\n([A-Za-z0-9])/g, '$1-$2')
    .replace(/[^\S\n]+/g, ' ');
}

const fixture = (name) =>
  cleanPdfText(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8'));

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

const sumLines = (items) =>
  Math.round(items.reduce((s, i) => s + (Number(i.total_ht) || 0), 0) * 100) / 100;

// ── Cas réels : facture multi-page, article en tête de page 2 ────────────────
const CASES = [
  {
    label: 'Revolute FA020464 (2 pages, REF2665 en tête de page 2)',
    parser: require('../src/parsers/revoluteParser'),
    text: fixture('revolute-FA020464.txt'),
    orderNumber: 'ZSCAPCUPG',
    expectedItems: 22,
    expectedTotal: 1899.60,
    mustContain: 'REF2665',
  },
  {
    label: 'CigAccess FA128317 (colonne « Prix de base » à "--")',
    parser: require('../src/parsers/cigaccessParser'),
    text: fixture('cigaccess-FA128317.txt'),
    orderNumber: 'GJONURSRU',
    expectedItems: 9,
    expectedTotal: 388.71,
    mustContain: '012959', // la réf. que l'article perdu s'appropriait
  },
  {
    label: 'e.tasty FA072725 (2 pages, NAT-VERT-10-6MG en tête de page 2)',
    parser: require('../src/parsers/etastyParser'),
    text: fixture('etasty-FA072725.txt'),
    orderNumber: 'HNIHRDZCR',
    expectedItems: 18,
    expectedTotal: 1365.36,
    mustContain: null, // réf. tronquée par la mise en page, recollée plus tard en BDD
  },
];

console.log('Parseurs — lignes qui disparaissaient en silence');
for (const c of CASES) {
  const parsed = c.parser.parse(c.text);

  test(`${c.label} : ${c.expectedItems} lignes`, () => {
    assert.strictEqual(parsed.items.length, c.expectedItems);
  });

  test(`${c.label} : somme des lignes = ${c.expectedTotal.toFixed(2)} €`, () => {
    assert.strictEqual(sumLines(parsed.items), c.expectedTotal);
  });

  test(`${c.label} : total imprimé lu et cohérent`, () => {
    assert.strictEqual(parsed.invoiceProductTotalHT, c.expectedTotal);
  });

  test(`${c.label} : n° de commande`, () => {
    assert.strictEqual(parsed.orderNumber, c.orderNumber);
  });

  if (c.mustContain) {
    test(`${c.label} : ${c.mustContain} présente`, () => {
      assert.ok(parsed.items.some((i) => i.supplier_sku === c.mustContain));
    });
  }
}

// ── Garde-fou universel : une ligne perdue doit être détectée ────────────────
console.log('Garde-fou findUnparsedRows');
for (const c of CASES) {
  const parsed = c.parser.parse(c.text);

  test(`${c.label} : aucune fausse alerte sur un parsing complet`, () => {
    const orphans = findUnparsedRows(c.text, parsed.items, parsed.discountItems);
    assert.deepStrictEqual(orphans, [], `alertes inattendues : ${JSON.stringify(orphans)}`);
  });

  test(`${c.label} : une ligne retirée est détectée`, () => {
    // On retire une ligne dont le couple (prix, quantité) est unique, comme
    // l'était la ligne réellement perdue.
    const keyOf = (i) => `${Number(i.unit_price_net).toFixed(2)}x${i.qty_ordered}`;
    const counts = new Map();
    for (const i of parsed.items) counts.set(keyOf(i), (counts.get(keyOf(i)) || 0) + 1);
    const victim = parsed.items.find((i) => counts.get(keyOf(i)) === 1);
    assert.ok(victim, 'fixture sans ligne au couple (prix, qté) unique');

    const amputated = parsed.items.filter((i) => i !== victim);
    const orphans = findUnparsedRows(c.text, amputated, parsed.discountItems);
    assert.strictEqual(orphans.length, 1, `attendu 1 orpheline, obtenu ${orphans.length}`);
    assert.strictEqual(orphans[0].qty, victim.qty_ordered);
    assert.strictEqual(orphans[0].unit_price, victim.unit_price_net);
  });
}

console.log(failures === 0 ? '\nTous les tests passent.' : `\n${failures} test(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
