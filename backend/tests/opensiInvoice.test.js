/**
 * Lecture des factures OpenSi — LCA, LVP, GFC.
 *
 * Sans dépendance ni base : `node tests/opensiInvoice.test.js` (ou `npm test`).
 *
 * Trois factures réelles (LCA F2609412942, LVP F2511243065, GFC F2511358971),
 * avec tout ce qui casse
 * les parseurs : désignation qui passe à la ligne, chiffres seuls sur la leur,
 * colonne « Rist. % » qui n'existe que chez LCA, code-barres chez GFC, remise de
 * pied chez GFC, et pied de page bourré de nombres (IBAN, SIREN, taux de TVA)
 * qu'il ne faut surtout pas lire comme des articles.
 *
 * Leur total imprimé doit retomber sur la somme des lignes lues : c'est le seul
 * contrôle qui prouve qu'aucune ligne n'a été perdue.
 *
 * Les trois tournent sur le texte pdf-parse des vrais PDF, repris intégralement.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseInvoice } = require('../src/parsers/invoices/opensiInvoice');

// Copie de cleanPdfText (pdfImportModel), comme dans parsers.test.js : les
// parseurs tournent sur le texte NETTOYÉ, jamais sur le brut.
function cleanPdfText(text) {
  return text
    .replace(/[\u00a0\u2007\u202f\u2009\u200a\u2002\u2003\ufeff]/g, ' ')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, '-')
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
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}
const close = (a, b, eps = 0.005) => Math.abs(a - b) < eps;
const byRef = (res, ref) => res.lines.find((l) => l.ref === ref);

/* ─── LCA — F2609412942, facture entière (PDF réel) ──────────────────────── */

const lca = parseInvoice(fixture('lca-F2609412942.txt'));

console.log('\nLCA — facture F2609412942 (PDF réel, entière)');

test('en-tête : numéro, date, référence de commande, échéance, règlement', () => {
  assert.strictEqual(lca.number, 'F2609412942');
  assert.strictEqual(lca.date, '2026-09-25');
  assert.strictEqual(lca.orderRefOnDoc, '356948');     // = bms_reference
  assert.strictEqual(lca.dueDate, '2026-09-25');
  assert.strictEqual(lca.statedPaymentMethod, 'Virement bancaire');
});

test('totaux du pied, séparateur de milliers compris', () => {
  assert.ok(close(lca.totalHt, 4189.92));
  assert.ok(close(lca.totalTva, 837.98));
  assert.ok(close(lca.totalTtc, 5027.90));
});

test('une désignation à cheval sur deux lignes ne perd pas son article', () => {
  const l = byRef(lca, '#REF8398-27584');
  assert.strictEqual(l.qty, 5);
  assert.ok(close(l.lineTotalHt, 7.50));
  assert.ok(l.label.includes('Gold Digger'));
  assert.ok(l.label.includes('11mg'));       // la suite de la désignation est recollée
});

test('la colonne Rist. % est lue sans confondre la remise avec un prix', () => {
  const l = byRef(lca, '#REF18588-62291');
  assert.strictEqual(l.qty, 30);
  assert.ok(close(l.unitPriceNet, 5.43));
  assert.strictEqual(l.discountPercent, 16);
  assert.ok(close(l.lineTotalHt, 162.79));   // le montant imprimé, pas 30 × 5,43
});

test('un article tenant sur une seule ligne passe aussi', () => {
  const l = byRef(lca, '#REF11324-36716');
  assert.strictEqual(l.qty, 1);
  assert.ok(close(l.lineTotalHt, 60));
});

test('la PLV offerte est lue, à zéro euro', () => {
  const l = byRef(lca, '#REF25850-25849');
  assert.strictEqual(l.qty, 1);
  assert.strictEqual(l.lineTotalHt, 0);
});

test('ni l\'IBAN, ni le SIREN, ni le taux de TVA ne deviennent des articles', () => {
  assert.strictEqual(lca.lines.length, 51);
  const refs = lca.lines.map((l) => l.ref);
  assert.ok(refs.every((r) => r.startsWith('#REF')), `réf inattendue : ${refs.find((r) => !r.startsWith('#REF'))}`);
});

test('les 51 lignes retombent au centime sur le total imprimé', () => {
  const somme = lca.lines.reduce((s, l) => s + l.lineTotalHt, 0);
  assert.ok(close(somme, 4189.92, 0.02), `somme ${somme}`);
  assert.strictEqual(lca.warnings.length, 0);
});

test('la hausse de tarif à 33 € est bien lue telle que facturée', () => {
  // La ligne qui a motivé toute l'app : 2,89 € commandés, 3,99 € facturés.
  const l = byRef(lca, '#REF16155-52579');
  assert.strictEqual(l.qty, 30);
  assert.ok(close(l.unitPriceNet, 3.99));
  assert.ok(close(l.lineTotalHt, 119.70));
});

/* ─── LVP — F2511243065, facture entière ─────────────────────────────────── */

const lvp = parseInvoice(fixture('lvp-F2511243065.txt'));

console.log('\nLVP — facture F2511243065 (PDF réel, entière)');

test('les 17 lignes sont lues et retombent sur le total imprimé', () => {
  assert.strictEqual(lvp.lines.length, 17);
  const somme = lvp.lines.reduce((s, l) => s + l.lineTotalHt, 0);
  assert.ok(close(somme, 446.29, 0.02), `somme ${somme}`);
  assert.strictEqual(lvp.warnings.filter((w) => w.type === 'total_mismatch').length, 0);
});

test('gabarit sans colonne de remise : trois nombres suffisent', () => {
  const l = byRef(lvp, 'ADDSWEETY10');
  assert.strictEqual(l.qty, 20);
  assert.ok(close(l.unitPriceNet, 1.33));
  assert.ok(close(l.lineTotalHt, 26.60));
});

test('une réf seule sur sa ligne reste rattachée à son article', () => {
  const l = byRef(lvp, 'S30467-TJCSFSDENSWE100FRRB');
  assert.ok(l, 'réf TJuice non trouvée');
  assert.strictEqual(l.qty, 6);
  assert.ok(close(l.lineTotalHt, 29.40));
});

test('le mode de règlement est repris tel qu\'imprimé, même tronqué', () => {
  assert.strictEqual(lvp.orderRefOnDoc, '244904');
  assert.strictEqual(lvp.statedPaymentMethod, 'Paiement par carte bancai');
});

/* ─── GFC — F2511358971, facture entière avec code-barres et remise ──────── */

const gfc = parseInvoice(fixture('gfc-F2511358971.txt'));

console.log('\nGFC — facture F2511358971 (PDF réel, entière)');

test('le code-barres n\'est jamais pris pour une quantité', () => {
  const l = byRef(gfc, 'GFC29577');
  assert.strictEqual(l.qty, 10);            // pas 3010000877974
  assert.ok(close(l.unitPriceNet, 4.43));
  assert.ok(close(l.lineTotalHt, 44.30));
});

test('les 14 articles sont lus', () => {
  const produits = gfc.lines.filter((l) => l.kind === 'product');
  assert.strictEqual(produits.length, 14);
  const somme = produits.reduce((s, l) => s + l.lineTotalHt, 0);
  assert.ok(close(somme, 538.19, 0.02), `somme ${somme}`);
});

test('la remise de pied devient une ligne négative, et le total retombe', () => {
  const remise = gfc.lines.find((l) => l.kind === 'discount');
  assert.ok(close(remise.lineTotalHt, -42));
  const somme = gfc.lines.reduce((s, l) => s + l.lineTotalHt, 0);
  assert.ok(close(somme, 496.19, 0.02), `somme ${somme}`);
  assert.strictEqual(gfc.warnings.filter((w) => w.type === 'total_mismatch').length, 0);
});

test('une référence courte suivie d\'un code-barres court reste lisible', () => {
  // GFC317-6397 … 3176397 5 1.75 8.75 : le « code-barres » ne fait que 7 chiffres.
  const l = byRef(gfc, 'GFC317-6397');
  assert.strictEqual(l.qty, 5);
  assert.ok(close(l.lineTotalHt, 8.75));
});

test('la référence de commande imprimée est remontée même si elle ne matche pas', () => {
  // Chez GFC, « Réf. Commande » est le numéro interne du FOURNISSEUR : aucune
  // commande ne porte 530456 en base. On le remonte quand même, l'écran tranche.
  assert.strictEqual(gfc.orderRefOnDoc, '530456');
});

const gfc2 = parseInvoice(fixture('gfc-F2610429600.txt'));

test('une désignation finissant par un nombre isolé garde sa ligne (F2610429600)', () => {
  // « Ciseaux multi-usages 1433 80000000121 3 1.10 3.30 » : cinq nombres, la
  // ligne se collait au Coton Doctor Coil suivant et 3,30 € manquaient.
  const ciseaux = byRef(gfc2, 'GFC15774');
  assert.strictEqual(ciseaux.qty, 3);
  assert.ok(close(ciseaux.lineTotalHt, 3.30));
  const coton = byRef(gfc2, 'GFC6604');
  assert.strictEqual(coton.qty, 5);
  assert.ok(close(coton.lineTotalHt, 17.50));
  assert.ok(close(gfc2.lines.reduce((a, l) => a + l.lineTotalHt, 0), 1210.50, 0.02));
  assert.strictEqual(gfc2.warnings.length, 0);
});

/* ─── Proforma GFC — P26111102, à contrôler AVANT de payer ──────────────── */

const proforma = parseInvoice(fixture('gfc-proforma-P26111102.txt'));

test('une proforma GFC se lit comme une facture, typée proforma (P26111102)', () => {
  assert.strictEqual(proforma.docType, 'proforma');
  assert.strictEqual(proforma.isProforma, true);
  assert.strictEqual(proforma.number, 'P26111102');
  assert.strictEqual(proforma.date, '2026-11-05');
  assert.strictEqual(proforma.orderRefOnDoc, null);
  assert.strictEqual(proforma.statedPaymentMethod, 'Virement bancaire');
  assert.ok(close(proforma.totalHt, 1231.95));
  assert.strictEqual(proforma.lines.length, 35);
  assert.ok(close(proforma.lines.reduce((a, l) => a + l.lineTotalHt, 0), 1231.95, 0.02));
  assert.strictEqual(proforma.warnings.length, 0);
  // Un numéro de facture ne passe pas pour une proforma.
  assert.strictEqual(gfc.docType, 'invoice');
  assert.strictEqual(gfc.isProforma, false);
});

test("l'attribut imprimé sous les montants reste à son article (P26111102)", () => {
  // « Valeur : 0.23 ohm » suit la ligne de montants des Coils Bonza Pro : il
  // devenait la référence du Vape Band Rouge suivant.
  assert.ok(!proforma.lines.some((l) => /^Valeur/.test(l.ref)));
  const coils = byRef(proforma, 'GFC33907-61796');
  assert.ok(/Valeur : 0\.23 ohm$/.test(coils.label));
  const band = byRef(proforma, 'GFC22120');
  assert.strictEqual(band.qty, 5);
  assert.ok(close(band.lineTotalHt, 4.25));
  assert.ok(/^Vape Band Rouge/.test(band.label));
});

/* ─── Avoirs OpenSi — LCA A2609409187 et GFC A2607412564 ─────────────────── */

const lcaAvoir = parseInvoice(fixture('lca-avoir-A2609409187.txt'));
const gfcAvoir = parseInvoice(fixture('gfc-avoir-A2607412564.txt'));

console.log('\nAvoirs OpenSi (PDF réels)');

test('un avoir est reconnu comme tel', () => {
  assert.strictEqual(lcaAvoir.docType, 'credit_note');
  assert.strictEqual(lcaAvoir.number, 'A2609409187');
  assert.strictEqual(gfcAvoir.docType, 'credit_note');
});

test('les montants d\'un avoir sont stockés en négatif', () => {
  // Le document imprime « Total HT : 278,88 € », bien positif. Un avoir vient
  // en déduction : on le range en négatif pour que son imputation sur un
  // règlement groupé reste une simple addition.
  assert.ok(close(lcaAvoir.totalHt, -278.88));
  assert.ok(close(lcaAvoir.totalTtc, -334.66));
  assert.strictEqual(lcaAvoir.lines.length, 1);
  assert.ok(close(lcaAvoir.lines[0].lineTotalHt, -278.88));
});

test('un avoir peut n\'être rattaché à aucune commande', () => {
  // L'avoir LCA ne porte aucune « Réf. Commande » : c'est une régularisation.
  assert.strictEqual(lcaAvoir.orderRefOnDoc, null);
  assert.strictEqual(lcaAvoir.lines[0].ref, 'regul');
});

test('un avoir LCA désigne sa facture d\'origine', () => {
  // A2611421302 et A2611421306 : pas de « Réf. Commande », seulement « Facture
  // d'origine : F… ». C'est par elle que l'avoir retrouve sa commande.
  const a1302 = parseInvoice(fixture('lca-avoir-A2611421302.txt'));
  const a1306 = parseInvoice(fixture('lca-avoir-A2611421306.txt'));
  assert.strictEqual(a1302.orderRefOnDoc, null);
  assert.strictEqual(a1302.correctsInvoice, 'F2610418127');
  assert.strictEqual(a1306.correctsInvoice, 'F2605388291');
  // Lignes intactes : la ligne « Facture d'origine » n'entre pas dans un article.
  assert.strictEqual(a1302.lines.length, 1);
  assert.strictEqual(a1302.lines[0].ref, '#REF16088-52411');
  assert.ok(close(a1302.lines[0].lineTotalHt, -3.90));
  assert.strictEqual(a1306.lines[0].ref, '#REF16455-53900');
  assert.ok(close(a1306.lines[0].lineTotalHt, -2.09));
  assert.strictEqual(a1302.warnings.length + a1306.warnings.length, 0);
  // Une facture n'a pas de facture d'origine.
  assert.strictEqual(lcaAvoir.correctsInvoice, null);
});

test('une désignation finissant par un chiffre collé ne mange pas sa ligne', () => {
  // « … Melo EC2 0,30 3 0.03 0.09 » : le « 2 » de EC2 passait pour une colonne.
  // Trois lignes, et le total qui retombe — c'est tout le contrôle.
  assert.strictEqual(gfcAvoir.lines.length, 3);
  assert.ok(close(gfcAvoir.lines.reduce((a, l) => a + l.lineTotalHt, 0), -23.19, 0.02));
  assert.strictEqual(gfcAvoir.warnings.length, 0);
  const melo = gfcAvoir.lines[2];
  assert.strictEqual(melo.qty, 3);
  assert.ok(close(melo.lineTotalHt, -0.09));
});

test('une désignation qui déborde après ses montants ne vole pas la réf suivante', () => {
  // Facture LVP F2609287455 : la désignation du Puff Zpluse continue APRÈS sa
  // ligne de montants, et son dernier fragment « Fruit + Watermelon Mango
  // Peach) » se collait en tête de l'article suivant, devenant sa référence.
  // Résultat : « Fruit » au lieu de « VP Pod luxe xr DTL », un article qui ne
  // retrouvait plus sa commande, et 26,60 € de Vaporesso hors de l'assiette de
  // la remise RSPV20.
  const r = parseInvoice([
    'Référence Désignation Quantité PU HT Montant HT',
    'JNR-42K0-MPWM Puff Zpluse 42K - 0mg - sans nicotine - Zpluse by JNR (Nicotine :',
    '0mg - Saveurs : Mango Passion 5 7.70 38.50',
    'Fruit + Watermelon Mango Peach)',
    'VP Pod luxe xr DTL Cartouches Luxe X/ XR / XR Max 5ml (2pcs) - Vaporesso (Couleur :',
    'Black - Version : DTL)',
    'Black DTL',
    '10 2.66 26.60',
  ].join('\n'));

  assert.strictEqual(r.lines.length, 2);

  const puff = r.lines[0];
  assert.strictEqual(puff.ref, 'JNR-42K0-MPWM');
  assert.strictEqual(puff.qty, 5);
  assert.ok(close(puff.lineTotalHt, 38.50));
  // Le fragment débordé revient à SA désignation.
  assert.ok(/Watermelon Mango Peach\)/.test(puff.label), puff.label);

  // Le parseur rend « VP » : une référence LVP contient des espaces, et lui seul
  // ne peut pas deviner où elle s'arrête — c'est resolveCompleteRefs qui la
  // complète en « VP Pod luxe xr DTL » à partir des réfs connues du fournisseur.
  // Ce qui se joue ici, c'est que la référence parte du BON article.
  const pod = r.lines[1];
  assert.strictEqual(pod.qty, 10);
  assert.ok(close(pod.lineTotalHt, 26.60));
  assert.notStrictEqual(pod.ref, 'Fruit');
  assert.ok(
    `${pod.ref} ${pod.label}`.startsWith('VP Pod luxe xr DTL Cartouches'),
    `${pod.ref} | ${pod.label}`,
  );
});

if (failures > 0) {
  console.log(`\n${failures} test(s) en échec.`);
  process.exit(1);
}
console.log('\nTous les tests passent.');
