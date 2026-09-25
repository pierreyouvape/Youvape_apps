/**
 * Lecture des factures OpenSi — LCA, LVP, GFC.
 *
 * Sans dépendance ni base : `node tests/opensiInvoice.test.js` (ou `npm test`).
 *
 * Les textes ci-dessous reprennent la couche texte des PDF reçus le 25/09/2026
 * (LCA F2609412942, LVP F2511243065, GFC F2511358971), y compris ce qui casse
 * les parseurs : désignation qui passe à la ligne, chiffres seuls sur la leur,
 * colonne « Rist. % » qui n'existe que chez LCA, code-barres chez GFC, remise de
 * pied chez GFC, et pied de page bourré de nombres (IBAN, SIREN, taux de TVA)
 * qu'il ne faut surtout pas lire comme des articles.
 *
 * LVP et GFC sont repris intégralement : leur total imprimé doit retomber sur la
 * somme des lignes lues, ce qui prouve qu'aucune ligne n'a été perdue.
 */

const assert = require('assert');
const { parseInvoice } = require('../src/parsers/invoices/opensiInvoice');

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

/* ─── LCA — extrait de F2609412942 ───────────────────────────────────────── */

const LCA = `IJkH OpenSi v10.0.0 | 25/09/2026 - 14:38:31
LCA DISTRIBUTION
205 avenue du Chateau de Jouques
13420 GEMENOS
Tél : 0491754009
E-Mail : contact@lca-distribution.com
Facture N° F2609412942 Date : 25/09/2026
Client N° 1-002445 - SAS EMC
Interlocuteur : YOUVAPE Site WEB
Page 1 / 3
SAS EMC
580 avenue de l'Aube Rouge
YOUVAPE
34170 CASTELNAU LE LEZ
FRANCE
F A C T U R E
Réf. Affaire : AC26094060
N° Commande : CC26094080
Réf. Commande : 356948
Réf. BL : BL26094426
Référence Désignation Quantité PU HT Rist. % PU Net HT Montant HT
#REF8398-27584 Gold Digger 10ML à l'unité - Ben Northon (Dosage
Nicotine : 11mg)
5 1.50 1.50 7.50
#REF15320-49707 Cartouches pour Nexi par 3 - 20mg - Aspire (Saveur :
Classic Blond)
240 2.89 2.89 693.60
#REF11324-36716 Sac de 200 boosters - Salt Freaks (Contenance : 10ml) 1 60.00 60.00 60.00
#REF18588-62291 Résistances Z Series / Z series XM Boost par 5 -
GeekVape (Valeur : 0.4?)
30 6.46 16.00 5.43 162.79
#REF25850-25849 OFFERT - PLV Elfbar-A4 Display Sheet 1 0.00 0.00 0.00
Sous-total HT : 3 222.58
Lca Distribution - SARL au capital de 20 000 Euros - immatriculée au RCS MARSEILLE 791 016 181 - N° TVA : FR09791016181 - Code NAF : 6190Z
Aucun escompte ne sera accordé pour paiement
anticipé.
IBAN (International Bank Account Number) FR76 4097
8000 2315 1095 9000 180
BIC (Bank Identifier Code) BSPFFRPPXXX
Base HT Taux TVA Montant TVA
4 189.92 20.00 % 837.98
Option pour le paiement de la taxe d'après les débits
Date d'échéance : 25/09/2026
Mode de règlement : Virement bancaire
N° SIREN Client : 789 508 439
N° TVA Client : FR87789508439
Total HT : 4 189.92 €
Total TVA : 837.98 €
Total TTC : 5 027.90 €`;

const lca = parseInvoice(LCA);

console.log('\nLCA — facture F2609412942');

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
  assert.strictEqual(lca.lines.length, 5);
  const refs = lca.lines.map((l) => l.ref);
  assert.ok(refs.every((r) => r.startsWith('#REF')));
});

test('un extrait ne retombant pas sur le total imprimé est signalé', () => {
  // 5 lignes sur 51 : le garde-fou DOIT crier. C'est exactement son rôle.
  const w = lca.warnings.find((x) => x.type === 'total_mismatch');
  assert.ok(w, 'aucun avertissement de réconciliation');
  assert.ok(w.message.includes('4189.92'));
});

/* ─── LVP — F2511243065, facture entière ─────────────────────────────────── */

const LVP = `LVP DISTRIBUTION
9 rue du noyer à la malice
95380 LOUVRES
Facture N° F2511243065 Date : 04/11/2025
Client N° 1-003030 - YouVape
Interlocuteur : M. COGLITORE Maxime
Page 1 / 2
YouVape
580 avenue de l'aube rouge
34170 Castelnau le Lez
FRANCE
F A C T U R E
Réf. Affaire : AC25110380
N° Commande : CC25110380
Réf. Commande : 244904
Référence Désignation Quantité PU HT Montant HT
ADDSWEETY10 Additif Sweety 10ml - Swoke (Nicotine : 0mg) 20 1.33 26.60
NV cartouche feelin 2 3ml Cartouches vides Feelin 2 (2pcs) - Nevoks (Contenance : 3ml)
3ml
5 2.00 10.00
FR10-SUBZ-PG06-01 PG Subzero 10ml - Halo (Nicotine : 6mg)
6mg 10ml Menthe France
24 1.95 46.80
FR10-TRIB-PG12-01 PG Tribeca 10ml - Halo (Nicotine : 12mg)
12mg 10ml Classique France
12 1.95 23.40
FR10-TRIB-PG18-01 PG Tribeca 10ml - Halo (Nicotine : 18mg)
18mg 10ml Classique France
12 1.95 23.40
FR10-TRIB-EX00-01 Concentré Tribeca 10ml - Halo (Nicotine : 0mg)
10ml Classique
24 2.49 59.76
FR50-TRIB-SV00-01 Tribeca 50ml - Halo (Nicotine : 0mg)
0mg 50ml Classique France
5 7.70 38.50
S30467-TJCSFSDENSWE100FRRB
Sakura Dream 100ml - TJuice New collection (Nicotine : 0mg) 6 4.90 29.40
S30466-TJCSFSSENSWE100FRRB
Sunset Sorbet 100ml - TJuice New collection (Nicotine : 0mg) 6 4.90 29.40
S30465-TJCSFPPENSWE100FRRB
Pinky Pop 100ml - TJuice New collection (Nicotine : 0mg) 6 4.90 29.40
AV-KATE-50 Katelyn 50ml - Arcvape (Nicotine : 0mg) 6 1.49 8.94
AV-VAI-50 Vaï 50ml - Arcvape (Nicotine : 0mg) 6 1.49 8.94
AGS02921001761 Kit Soul 1500mAh - GeekVape (Couleur : Black)
Black
3 7.45 22.35
AGS02920101765 Kit Soul 1500mAh - GeekVape (Couleur : Gunmetal)
Gunmetal
3 7.45 22.35
AGS02920101762 Kit Soul 1500mAh - GeekVape (Couleur : Pink)
Pink
3 7.45 22.35
AGS02920101761 Kit Soul 1500mAh - GeekVape (Couleur : White)
White
3 7.45 22.35
AGS02920101763 Kit Soul 1500mAh - GeekVape (Couleur : Violet)
Violet
3 7.45 22.35
Sous-total HT : 446.29
INCOTERM DAP
Base HT Taux TVA Montant TVA
446.29 20.00 % 89.26
Date d'échéance : 04/11/2025
Mode de règlement : Paiement par carte bancai
N° TVA Client : fr87789508439
Total HT : 446.29 €
Total TVA : 89.26 €
Total TTC : 535.55 €`;

const lvp = parseInvoice(LVP);

console.log('\nLVP — facture F2511243065 (entière)');

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

const GFC = `GFC Provap
2 route de l'Ouest
94380 Bonneuil Sur Marne
Facture N° F2511358971 Date : 01/11/2025
Client N° 1-008518 - YOUVAPE SITE
Interlocuteur : M. COGLITORE Maxime
Page 1 / 1
YOUVAPE SITE
580 avenue de l'aube rouge
34170 castelnau le lez
FRANCE
F A C T U R E
Réf. Affaire : AC25107231
N° Commande : CC25107229
Réf. Commande : 530456
Réf. BL : BL25110009
Référence Désignation Code barre Quantité PU HT Montant HT
GFC29577 Batterie E-cigare 500mAh (1pc) - XO Havana 3010000877974 10 4.43 44.30
GFC31669-58345 Cartouche Pré-remplie 20mg (1pc) - XO Havana - Saveur :
Andres
3010000877899 10 3.40 34.00
GFC31669-58347 Cartouche Pré-remplie 20mg (1pc) - XO Havana - Saveur :
Cubana
3010000877905 30 3.40 102.00
GFC31669-58348 Cartouche Pré-remplie 20mg (1pc) - XO Havana - Saveur :
Venecia
3010000877912 20 3.40 68.00
GFC32255-59160 Résistances PnP X V2 0.15/0.2/0.3/0.45/0.6? (5pcs) -
Voopoo - valeur : 0.45 ohm
6941291573344 10 6.00 60.00
GFC32255-59157 Résistances PnP X V2 0.15/0.2/0.3/0.45/0.6? (5pcs) -
Voopoo - valeur : 0.15 ohm
6941291575928 10 6.00 60.00
GFC25003-51936 L'intense 10ml - Roykin - Nicotine : 6mg 3700809000221 20 1.10 22.00
GFC25003-51937 L'intense 10ml - Roykin - Nicotine : 11mg 3700809000238 20 1.10 22.00
GFC25003-51938 L'intense 10ml - Roykin - Nicotine : 16mg 3700809000245 20 1.10 22.00
GFC21786 Triple Fused Clapton DL Ni80 0.30? New Version (10pcs) -
Fumytech
642613944434 10 1.75 17.50
GFC317-6397 T2 V1 1.8? 2.4ml 15mm - Kangertech - Couleur : Black 3176397 5 1.75 8.75
GFC19330-45651 Pyrex Dead Rabbit V3 RTA 3.5ml/5.5ml - Hellvape - Taille :
Bubble 5.5ml
6973727423978 5 1.23 6.15
GFC32953-60198 Drip Tip 510 Whistle Long - DotMod - Couleur : Clear 857918006347 3 2.76 8.28
GFC31197-57761 Dead Rabbit 3 RTA J Edition - Hellvape - Couleur : Shiny
Gun Purple
6976849462689 3 21.07 63.21
Code(s) promo : Carte fidélité ()
Base HT Taux TVA Montant TVA
496.19 20.00 % 99.24
Date d'échéance : 01/11/2025
Mode de règlement : Paiement 100% Sécurisé pa
Montant HT : 538.19 €
Remise : 42.00 €
Total HT : 496.19 €
Total TVA : 99.24 €
Total TTC : 595.43 €
Facture acquittée`;

const gfc = parseInvoice(GFC);

console.log('\nGFC — facture F2511358971 (entière)');

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

if (failures > 0) {
  console.log(`\n${failures} test(s) en échec.`);
  process.exit(1);
}
console.log('\nTous les tests passent.');
