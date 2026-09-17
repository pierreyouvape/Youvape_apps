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
    label: 'Curieux FA072952 (colonne « Prix de base » ajoutée, réfs coupées hors tiret)',
    parser: require('../src/parsers/curieuxParser'),
    text: fixture('curieux-FA072952.txt'),
    orderNumber: 'JGOJKMMKJ',
    expectedItems: 24,
    expectedTotal: 962.71,
    // Curieux arrondit le prix unitaire à l'affichage mais totalise sur la valeur
    // exacte : la somme des lignes imprimées dépasse leur total de 1 centime.
    // Écart réel du document, sous le seuil de réconciliation (0,02 €).
    expectedSum: 962.72,
    mustContain: 'AST-LICO-10-10SDN', // réf. coupée au milieu ("AST-LICO-1" + "0-10SDN")
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
  {
    label: 'e.tasty confirmation UOPZIWQDN (email Gmail, HOMAN05000 à cheval sur 2 pages)',
    parser: require('../src/parsers/etastyParser'),
    text: fixture('etasty-UOPZIWQDN.txt'),
    orderNumber: 'UOPZIWQDN',
    expectedItems: 23,
    expectedTotal: 1817.50,
    mustContain: 'HOMAN05000', // lue "HOMAN0" avant correction
    // 23 lignes pour 3 couples (prix, qté) seulement : le garde-fou arithmétique
    // est aveugle aux lignes identiques par construction. Ce document est protégé
    // par la réconciliation avec « Produits » (voir tests e.tasty plus bas).
    noUniqueRow: true,
  },
  {
    label: 'LIPS FAC/2026/04162 (facture Odoo, totaux en tete de page 2)',
    parser: require('../src/parsers/lipsParser'),
    text: fixture('lips-FAC-2026-04162.txt'),
    orderNumber: 'FAC/2026/04162',
    expectedItems: 16,
    expectedTotal: 443.25,
    mustContain: 'SEV-POLAR-BER-10-10', // 1er article de la page 2, sous le bloc des totaux
    // Le tableau Odoo n'imprime pas la signature « prix € qte total € » du garde-fou
    // arithmetique (le montant seul porte l'euro) : ce document est protege par la
    // reconciliation avec « Montant hors taxes ».
    noUniqueRow: true,
  },
];

console.log('Parseurs — lignes qui disparaissaient en silence');
for (const c of CASES) {
  const parsed = c.parser.parse(c.text);

  test(`${c.label} : ${c.expectedItems} lignes`, () => {
    assert.strictEqual(parsed.items.length, c.expectedItems);
  });

  const expectedSum = c.expectedSum ?? c.expectedTotal;
  test(`${c.label} : somme des lignes = ${expectedSum.toFixed(2)} €`, () => {
    assert.strictEqual(sumLines(parsed.items), expectedSum);
  });

  test(`${c.label} : total imprimé et somme des lignes réconciliés`, () => {
    // Le contrôle de pdfImportModel n'alerte qu'au-delà de 0,02 € : une fixture
    // qui dépasserait ce seuil ferait crier au loup à chaque import.
    assert.ok(Math.abs(parsed.invoiceProductTotalHT - expectedSum) <= 0.02);
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

  if (c.noUniqueRow) continue;

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

// ── e.tasty, confirmation de commande (email Gmail) ──────────────────────────
console.log('e.tasty — confirmation de commande');
{
  const etasty = require('../src/parsers/etastyParser');
  const text = fixture('etasty-UOPZIWQDN.txt');
  const parsed = etasty.parse(text);

  // Relevé ligne à ligne sur le PDF, réfs recoupées avec le bon de commande
  // « House of Magic » d'e.tasty (qui imprime les réfs entières).
  const EXPECTED = {
    HOBOI05000: [40, 5.20], HOBOIS01010: [50, 1.35], HOBOIS01020: [50, 1.35],
    HOBOI01006: [30, 1.35], HOBOI01012: [30, 1.35], HOBOI01003: [30, 1.35],
    HODRA01006: [30, 1.35], HODRA01012: [30, 1.35], HODRA01003: [30, 1.35],
    HODRAS01010: [50, 1.35], HODRAS01020: [50, 1.35], HODRA05000: [40, 5.20],
    HOMAN05000: [40, 5.20], HOMANS01010: [50, 1.35], HOMANS01020: [50, 1.35],
    HOMAN01003: [30, 1.35], HOMAN01006: [30, 1.35], HOMAN01012: [30, 1.35],
    HOSER01006: [30, 1.35], HOSER01003: [30, 1.35], HOSERS01010: [50, 1.35],
    HOSERS01020: [50, 1.35], HOSER05000: [40, 5.20],
  };

  test('UOPZIWQDN : chaque réf. avec sa quantité et son prix, rien en trop', () => {
    const got = Object.fromEntries(parsed.items.map((i) => [i.supplier_sku, [i.qty_ordered, i.unit_price_net]]));
    assert.strictEqual(Object.keys(got).length, parsed.items.length, 'réf. en double');
    assert.deepStrictEqual(got, EXPECTED);
  });

  test('UOPZIWQDN : date de commande', () => {
    assert.strictEqual(parsed.orderDate, '2026-09-11');
  });

  test('UOPZIWQDN : goodies à 0,00 € non repris comme produits', () => {
    assert.ok(!parsed.items.some((i) => /HOM-26|ETASTY|Goodies/i.test(i.supplier_sku + i.designation)));
  });

  test('UOPZIWQDN : désignation recollée sur le saut de page', () => {
    const it = parsed.items.find((i) => i.supplier_sku === 'HOMAN05000');
    assert.strictEqual(it.designation, 'MANGPOUFFLE 50ML - Taux de nicotine : 0- Etiquettes : Multilingue');
  });

  test('UOPZIWQDN : 2 remises, total = « Réductions » 652,20 €', () => {
    assert.deepStrictEqual(
      parsed.discountItems.map((d) => [d.product_name, d.unit_price]),
      [
        ['PACK IMP 80 PRDS 50ML - HOUSE OF MAGIC 2026', -345.60],
        ['PACK IMP 1€ 10ML - HOUSE OF MAGIC 2026', -306.60],
      ]
    );
  });

  test('UOPZIWQDN : aucune alerte sur un parsing complet', () => {
    assert.deepStrictEqual(parsed.warnings, []);
  });

  // Mutations du document : chaque défaillance de lecture doit se voir.
  const mutate = (from, to) => {
    assert.ok(text.includes(from), `fixture modifiée ? motif introuvable : ${JSON.stringify(from)}`);
    return etasty.parse(text.replace(from, to));
  };
  const suspectContexts = (p) =>
    (p.warnings.find((w) => w.type === 'suspect_rows')?.rows || []).map((r) => r.context);

  test('UOPZIWQDN : fin de réf. perdue au saut de page → ligne signalée', () => {
    const p = mutate('\n5000 de nicotine', '\nde nicotine');
    assert.ok(suspectContexts(p).some((c) => c.startsWith('HOMAN0 ')), JSON.stringify(p.warnings));
  });

  test('UOPZIWQDN : réf. qui ne colle pas au taux de nicotine → ligne signalée', () => {
    const p = mutate('HODRA0\n1012\n', 'HODRA0\n1013\n');
    assert.ok(suspectContexts(p).some((c) => c.startsWith('HODRA01013 ')), JSON.stringify(p.warnings));
  });

  test('UOPZIWQDN : fin de ligne basculée APRÈS le prix sur la page suivante', () => {
    const p = mutate(
      'HODRA0\n1012\nDragondor 10ml - Taux de\nnicotine : 12- Etiquettes :\nFrançais\n1,35 € 30 40,50 €\n',
      'HODRA0\nDragondor 10ml - Taux de\n1,35 € 30 40,50 €\n\n-- 1 of 6 --\n\n1012 nicotine : 12- Etiquettes :\nFrançais\n'
    );
    const skus = p.items.map((i) => i.supplier_sku);
    assert.ok(skus.includes('HODRA01012') && skus.includes('HODRA01003'), skus.join(' '));
    assert.deepStrictEqual(p.warnings, []);
  });

  test('UOPZIWQDN : remise perdue → écart avec « Réductions » signalé', () => {
    const p = mutate('PACK IMP 1€ 10ML - HOUSE OF MAGIC 2026 -306,60 €', 'PACK IMP 1€ 10ML - HOUSE OF MAGIC 2026');
    assert.ok(p.warnings.some((w) => w.type === 'discount_mismatch'), JSON.stringify(p.warnings));
  });

  test('UOPZIWQDN : ligne produit illisible → écart avec « Produits »', () => {
    const p = mutate('5,20 € 40 208,00 €\nHOMANS', '5,20 € 40 208,00\nHOMANS');
    assert.notStrictEqual(sumLines(p.items), p.invoiceProductTotalHT);
  });

  // Ancien gabarit (BIBAIERBM, juillet 2026) : réf. sur 2 lignes, prix collé à la désignation.
  test('confirmation juillet 2026 : ancien gabarit toujours lu', () => {
    const p = etasty.parse([
      'Numéro de commande : BIBAIERBM',
      'Date de la commande : 23/07/2026 14:33:58',
      'Détail de votre commande :',
      'Référence Produit Prix unitaire Quantité Prix total',
      'INAZU01', '006', 'Azura 10ml - Taux de', 'nicotine : 6- Etiquettes : Français 1,35 € 10 13,50 €',
      'INAZU05', '000', 'AZURA 50ML - Taux de nicotine : 0- Etiquettes :', 'Multilingue', '5,20 € 4 20,80 €',
      'Livraison gratuite', 'Produits 34,30 €',
    ].join('\n'));
    assert.deepStrictEqual(
      p.items.map((i) => [i.supplier_sku, i.qty_ordered, i.unit_price_net]),
      [['INAZU01006', 10, 1.35], ['INAZU05000', 4, 5.20]]
    );
    assert.strictEqual(p.invoiceProductTotalHT, 34.30);
    assert.deepStrictEqual(p.warnings, []);
  });
}

console.log(failures === 0 ? '\nTous les tests passent.' : `\n${failures} test(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
