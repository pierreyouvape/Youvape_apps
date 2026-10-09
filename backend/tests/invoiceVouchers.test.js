/**
 * Bons de réduction à valoir — rejoués sur les deux factures réelles qui les
 * déduisent (09/10/2026).
 *
 * Sans dépendance ni base : `node tests/invoiceVouchers.test.js` (ou `npm test`).
 *
 *   • LVP F2607279320  — « Code(s) promo : V687392C8282O278763 », « Remise : 110.78 € »
 *   • GFC F2606406741  — « Code(s) promo : Youvape SITE (…) (721UVYSR), Carte fidélité () »,
 *                        « Remise : 27.90 € »
 *
 * Les deux remises sont ENTIÈREMENT des bons (confirmé par l'acheteur) : elles
 * remboursent des factures précédentes et ne doivent rien changer au coût des
 * lignes de ces commandes-ci.
 */

const assert = require('assert');
const { detachVouchers } = require('../src/utils/invoiceVouchers');
const { compareInvoiceToOrder, listDifferences } = require('../src/utils/invoiceCompare');

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}
const close = (a, b, eps = 0.005) => Math.abs(a - b) < eps;
const somme = (lines) => Math.round(lines.reduce((s, l) => s + l.lineTotalHt, 0) * 100) / 100;

/* ─── LVP F2607279320 du 29/07/2026, commande 280248 ───────────────────────── */

// [réf, quantité, prix] — tous au prix commandé (4,60 € la puff, 2,90 € la cartouche)
const LVP = [
  ['DO-P15K-MENTG', 10, 4.60], ['DO-P15K-STBU', 10, 4.60], ['DO-P15K-LIFRB', 10, 4.60],
  ['DO-P15K-LOV66', 10, 4.60], ['DO-P15K-COLAG', 10, 4.60], ['DO-P15K-PEMAA', 10, 4.60],
  ['DO-P15K-FRURO', 10, 4.60], ['DO-P15K-PEGLA', 10, 4.60], ['DO-P15K-CERIS', 10, 4.60],
  ['DO-P15K-FRAGL', 10, 4.60], ['DO-CBLA-LIFRB', 20, 2.90], ['DO-CBLA-JUCAS', 20, 2.90],
  ['DO-CBLA-CERIS', 1, 2.90], ['DO-CBLA-FRURO', 20, 2.90], ['DO-CBL10M-STB', 20, 2.90],
  ['DO-CBLA-COLAG', 20, 2.90], ['DO-CBLA-MENTG', 20, 2.90], ['DO-CBLA-FRAGL', 1, 2.90],
  ['DO-CBLA-PEMAA', 20, 2.90], ['DO-CBLA-LOV66', 20, 2.90],
];
const LVP_TEXT = `Facture N° F2607279320 Date : 29/07/2026
Réf. Commande : 280248
Code(s) promo : V687392C8282O278763 (V687392C8282O278763)
INCOTERM DAP
Montant HT : 929.80 €
Remise : 110.78 €
Total HT : 819.02 €`;

const lvpLines = () => [
  ...LVP.map(([ref, qty, prix]) => ({
    ref, label: 'Dojo Blast', qty, lineTotalHt: Math.round(qty * prix * 100) / 100, kind: 'product',
  })),
  { ref: null, label: 'Remise', qty: 1, lineTotalHt: -110.78, kind: 'discount' },
];
const lvpOrder = () => ({ lines: LVP.map(([ref, qty, price]) => ({ ref, productName: 'Dojo Blast', qty, price })) });

const BON_LVP = { id: 1, code: 'V687392C8282O278763', amount_ht: '110.78', source_number: 'F2607000001' };

test('LVP : la remise reconnue par son code devient un bon, au centime', () => {
  const lignes = lvpLines();
  assert.ok(close(somme(lignes), 819.02), `les lignes lues font ${somme(lignes)}`);

  const { lines, used } = detachVouchers({ lines: lignes, text: LVP_TEXT, vouchers: [BON_LVP] });
  assert.strictEqual(used.length, 1);
  assert.strictEqual(used[0].matchedBy, 'code');
  assert.ok(close(used[0].amount, 110.78));
  assert.strictEqual(used[0].partial, false);
  // La remise a disparu : ce n'en était pas une.
  assert.strictEqual(lines.filter((l) => l.kind === 'discount').length, 0);
  const bon = lines.find((l) => l.kind === 'voucher');
  assert.ok(bon && close(bon.lineTotalHt, -110.78));
  assert.ok(/F2607000001/.test(bon.label), bon.label);
  // Et la somme des lignes retombe toujours sur le total imprimé.
  assert.ok(close(somme(lines), 819.02));
});

test('LVP : le bon ne baisse pas le coût réel des lignes de cette commande', () => {
  const { lines } = detachVouchers({ lines: lvpLines(), text: LVP_TEXT, vouchers: [BON_LVP] });
  const r = compareInvoiceToOrder({ invoice: { lines, totalHt: 819.02 }, order: lvpOrder() });

  const puff = r.lines.find((l) => l.ref === 'DO-P15K-MENTG');
  assert.strictEqual(puff.discountShare, 0);
  assert.ok(close(puff.effectiveUnitCost, 4.60), `coût réel ${puff.effectiveUnitCost}`);
  assert.strictEqual(puff.verdict, 'ok');

  const bon = r.lines.find((l) => l.verdict === 'voucher');
  assert.ok(bon, 'aucune ligne « bon à valoir »');
  assert.ok(close(bon.netGap, -110.78));
  assert.strictEqual(r.summary.claimable, 0);
  assert.strictEqual(r.summary.hasFooterDiscount, false);
  assert.ok(r.totals.reconciles);
  // Visible dans les différences, avec son explication.
  const diff = listDifferences(r).find((l) => l.verdict === 'voucher');
  assert.ok(diff && /facture précédente/.test(diff.action));
});

test('sans le bon, la même remise aurait été répartie sur le coût des lignes', () => {
  // La raison d'être du module : c'est exactement ce que faisait l'écran avant.
  const r = compareInvoiceToOrder({ invoice: { lines: lvpLines(), totalHt: 819.02 }, order: lvpOrder() });
  const puff = r.lines.find((l) => l.ref === 'DO-P15K-MENTG');
  assert.ok(puff.discountShare > 0);
  assert.ok(puff.effectiveUnitCost < 4.10, `coût réel ${puff.effectiveUnitCost}`);
});

test('un bon déduit ne masque pas une vraie surfacturation de la nouvelle commande', () => {
  // Même facture, mais une puff facturée 4,95 € au lieu de 4,60 € : 3,50 € de
  // trop. Répartie au pied, la remise de 110,78 € « expliquait » l'écart et le
  // réclamable tombait à zéro. Détachée en bon, elle n'explique plus rien.
  const avecHausse = () => lvpLines().map((l) => (l.ref === 'DO-P15K-MENTG'
    ? { ...l, lineTotalHt: 49.50 }
    : (l.kind === 'discount' ? { ...l } : l)));
  const texte = LVP_TEXT;

  const avant = compareInvoiceToOrder({ invoice: { lines: avecHausse() }, order: lvpOrder() });
  assert.strictEqual(avant.summary.claimable, 0, 'la remise masquait déjà l\'écart ?');

  const { lines } = detachVouchers({ lines: avecHausse(), text: texte, vouchers: [BON_LVP] });
  const apres = compareInvoiceToOrder({ invoice: { lines }, order: lvpOrder() });
  assert.ok(close(apres.summary.claimable, 3.50), `réclamable ${apres.summary.claimable}`);
});

/* ─── GFC F2606406741 du 16/06/2026 ─────────────────────────────────────────── */

const GFC_TEXT = `Facture N° F2606406741 Date : 16/06/2026
Sous-total HT 599.55
Code(s) promo : Youvape SITE (site.youvape@gmail.com)
(721UVYSR), Carte fidélité ()
Montant HT : 599.55 €
Remise : 27.90 €
Total HT : 571.65 €`;
const gfcLines = () => [
  { ref: 'GFC29184', label: 'Crypt Legend 0mg 50ml', qty: 6, lineTotalHt: 39.00, kind: 'product' },
  { ref: 'GFC34692', label: 'Cartouche Vide XO Eminence', qty: 20, lineTotalHt: 109.40, kind: 'product' },
  { ref: 'GFC15915', label: 'Bouteille graduée 250ml', qty: 100, lineTotalHt: 73.00, kind: 'product' },
  { ref: 'GFC33667', label: 'Mod Meca Hyperion V2', qty: 1, lineTotalHt: 47.90, kind: 'product' },
  { ref: null, label: 'Remise', qty: 1, lineTotalHt: -27.90, kind: 'discount' },
];

test('GFC : le code imprimé entre parenthèses est retrouvé', () => {
  const { lines, used } = detachVouchers({
    lines: gfcLines(), text: GFC_TEXT,
    vouchers: [{ id: 7, code: '721uvysr', amount_ht: 27.90, source_number: 'F2605000000' }],
  });
  assert.strictEqual(used.length, 1);
  assert.strictEqual(used[0].matchedBy, 'code');
  assert.strictEqual(lines.filter((l) => l.kind === 'discount').length, 0);
});

test('un code coupé par la mise en page est retrouvé quand même', () => {
  const texte = LVP_TEXT.replace('V687392C8282O278763 (', 'V687392C8282\nO278763 (');
  const { used } = detachVouchers({ lines: lvpLines(), text: texte, vouchers: [{ ...BON_LVP }] });
  assert.strictEqual(used.length, 1);
});

/* ─── Sans code : au montant, et seulement sans ambiguïté ─────────────────── */

test('un bon sans code est rapproché quand son montant retombe sur la remise', () => {
  const { used } = detachVouchers({
    lines: gfcLines(), text: GFC_TEXT,
    vouchers: [{ id: 3, code: null, amount_ht: '27.90', source_number: 'F1' }],
  });
  assert.strictEqual(used.length, 1);
  assert.strictEqual(used[0].matchedBy, 'amount');
});

test('deux bons sans code du même montant : le document ne tranche pas', () => {
  const { used, lines } = detachVouchers({
    lines: gfcLines(), text: GFC_TEXT,
    vouchers: [
      { id: 3, code: null, amount_ht: 27.90, source_number: 'F1' },
      { id: 4, code: '', amount_ht: 27.90, source_number: 'F2' },
    ],
  });
  assert.strictEqual(used.length, 0);
  assert.strictEqual(lines.filter((l) => l.kind === 'discount').length, 1);
});

test('un bon dont le code est absent du document n\'est jamais rapproché au montant', () => {
  const { used } = detachVouchers({
    lines: gfcLines(), text: GFC_TEXT,
    vouchers: [{ id: 3, code: 'AUTRECODE', amount_ht: 27.90, source_number: 'F1' }],
  });
  assert.strictEqual(used.length, 0);
});

test('une facture sans remise ne consomme aucun bon', () => {
  const lignes = gfcLines().filter((l) => l.kind !== 'discount');
  const { used, lines } = detachVouchers({ lines: lignes, text: GFC_TEXT, vouchers: [{ id: 7, code: '721UVYSR', amount_ht: 27.90 }] });
  assert.strictEqual(used.length, 0);
  assert.strictEqual(lines, lignes);
});

/* ─── Remise mixte : RSPV20 + bon chez LVP ────────────────────────────────── */

test('LVP : remise RSPV20 + bon → seul le bon sort de la remise', () => {
  // 100 € de Vaporesso à −20 % (20,00 €) et un bon de 6,25 € : « Remise : 26.25 € ».
  const lignes = [
    { ref: 'VP-XROS', label: 'Kit XROS 5 - Vaporesso', qty: 10, lineTotalHt: 100, kind: 'product' },
    { ref: null, label: 'Remise', qty: 1, lineTotalHt: -26.25, kind: 'discount' },
  ];
  const texte = 'Code(s) promo : RSPV20 (RSPV20), BONLVP625 (BONLVP625)\nRemise : 26.25 €';
  const { lines, used } = detachVouchers({
    lines: lignes, text: texte,
    vouchers: [{ id: 9, code: 'BONLVP625', amount_ht: 6.25, source_number: 'F2610289037' }],
  });
  assert.strictEqual(used.length, 1);
  const remise = lines.find((l) => l.kind === 'discount');
  assert.ok(remise && close(remise.lineTotalHt, -20.00), `remise restante ${remise && remise.lineTotalHt}`);
  assert.ok(close(lines.find((l) => l.kind === 'voucher').lineTotalHt, -6.25));

  // Le coût réel ne retient que les −20 % : 8,00 € l'unité, pas 7,375 €.
  const r = compareInvoiceToOrder({
    invoice: { lines },
    order: { lines: [{ ref: 'VP-XROS', productName: 'Kit XROS 5 - Vaporesso', qty: 10, price: 8 }] },
    options: { supplierCode: 'LVP Distribution' },
  });
  assert.ok(close(r.lines.find((l) => l.ref === 'VP-XROS').effectiveUnitCost, 8.00), 'coût réel');
});

test('un bon plus gros que la remise imprimée n\'est consommé qu\'en partie', () => {
  const { used, lines } = detachVouchers({
    lines: gfcLines(), text: GFC_TEXT,
    vouchers: [{ id: 7, code: '721UVYSR', amount_ht: 40, source_number: 'F1' }],
  });
  assert.ok(close(used[0].amount, 27.90));
  assert.strictEqual(used[0].partial, true);
  assert.ok(close(somme(lines), somme(gfcLines())), 'la somme des lignes a bougé');
});

if (failures > 0) {
  console.log(`\n${failures} test(s) en échec.`);
  process.exit(1);
}
console.log('\nTous les tests passent.');
