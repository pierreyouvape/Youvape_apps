/**
 * Annexe CSV Mondial Relay : coût net par commande et écarts réclamables.
 *
 * CSV synthétique (aucun vrai client dans le dépôt) reprenant les cas réels :
 *   • 1260857 (facture LGYOUVAP2600000087) : 120 g déclarés, 4 400 g pesés pour
 *     un colis de 16,5 × 15,5 × 6,5 cm → 12,80 € au lieu de 3,59 € ;
 *   • une pesée à +250 g (carton plus lourd que la tare) : écart RÉEL, pas
 *     une erreur de MR, donc jamais classé réclamable ;
 *   • un retour 2025 « LG… » rattaché à sa commande par « Expedition liée » ;
 *   • un colis de fin de mois précédent à 0 € (déjà facturé, à ignorer) ;
 *   • la remise de 14 % portée par une ligne sans référence.
 */

const assert = require('assert');
const { parseMondialRelayCsv, analyzeMondialRelayCsv, classifyParcels, cgvForInvoice, bracketIndex } = require('../src/parsers/mondialRelayCsvParser');

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const HEAD = 'Nr de facture;Référence client;Référence expédition;Nom;Raison sociale;Marque du client;Code client chargeur;Nr expédition;Date;Mode de prise en charge;Mode de livraison;Type;Agence de livraison;Pays fact;Pays de livraison;Relais de livraison;Nom du relais;Code postal;Nbr colis;Poids en gr;Point de remise;Montant de CRT cent;Valeur vente;Indexation gasoil;Semi;Arrondi;Montant du transport;Poids annoncé;Poids mesuré;Mnt.Trans. Poids Mes;Complément;Total htva;Service;Avisage;Montant Kg supplémentaire;Autres;Expedition liée;Non facturé;Longueur;Largeur;Hauteur;Colis hors norme/hors contrat;Volumetric weight;Geo ID;billed size;declared size;actual size';

// Champs dans l'ordre de HEAD ; seuls ceux utilisés sont renseignés.
function row({ ref = '', tracking = '0', date = '20260915', pickup = '', mode = '', type = '', pays = 'BE', billed = '', index = '', transport = '0',
  declared = '0', measured = '0', complement = '0', total = '0', linked = '', dims = ['', '', ''], vol = '' }) {
  return ['LGYOUVAP2600000087', '?', ref, 'X', 'EMC', 'LG', 'YOUVAP', tracking, date, pickup, mode, type, '', 'FR', pays, '', '', '', '1',
    billed, '', '0', '0', index, '', '', transport, declared, measured, transport, complement, total, '', '', '', '', linked, '',
    dims[0], dims[1], dims[2], '', vol, '', '', '', ''].join(';');
}

const CSV = [
  HEAD,
  // Ligne de remise (sans référence) : 14 % de Σ transport = 0,14 × (12,80 + 3,59 + 4,69 + 2,00)
  row({ total: String(-0.14 * (12.80 + 3.59 + 4.69 + 2.00)) }),
  // 1260857 : pesée aberrante
  row({ ref: '1260857', tracking: '00657030', mode: '24RC', type: 'Livraison Consigne', billed: '4400', index: '0.743424',
    transport: '12.80', declared: '120', measured: '4400', complement: '0.13', total: '13.673424', dims: ['165', '155', '65'], vol: '332' }),
  // Commande normale, poids conforme
  row({ ref: '1263091', tracking: '72140473', mode: '24R', type: 'Livraison Relais', billed: '300', index: '0.208507',
    transport: '3.59', declared: '216', measured: '300', complement: '0.13', total: '3.928507', dims: ['165', '125', '120'], vol: '495' }),
  // Pesée +250 g qui franchit la tranche 500 g : écart réel, classé « pesée »
  row({ ref: '1259913', tracking: '00654383', mode: '24RC', type: 'Livraison Consigne', billed: '550', index: '0.272395',
    transport: '4.69', declared: '300', measured: '550', complement: '0.13', total: '5.092395', dims: ['160', '125', '120'], vol: '480' }),
  // Retour 2025 : référence LG…, rattaché par le suivi du colis aller
  row({ ref: 'LG479896', tracking: '98014691', mode: 'LCC', type: 'Retour', pays: 'FR', billed: '560', transport: '2',
    declared: '560', total: '2', linked: '00479896' }),
  // Colis déposé fin août : 0 €, déjà facturé le mois d'avant
  row({ ref: '1256123', tracking: '00639765', date: '20260827', declared: '500', total: '0', dims: ['165', '125', '120'] }),
].join('\n');

console.log('\nAnnexe CSV Mondial Relay');

const csv = parseMondialRelayCsv(Buffer.from(CSV, 'latin1'));
const ctx = {
  remiseRate: 14,
  knownOrderIds: new Set([1260857, 1263091, 1259913, 1256123]),
  orderByTracking: { '00479896': 1184944 },
  bddWeights: { 1260857: 131, 1263091: 216, 1259913: 311 },
};
const a = analyzeMondialRelayCsv(csv, { ...ctx, pdfTotalHT: 0 });
const byRef = Object.fromEntries(a.parcels.map(p => [p.ref, p]));

test('lit le numéro de facture et sépare colis / lignes de facture', () => {
  assert.strictEqual(csv.invoiceNumber, 'LGYOUVAP2600000087');
  assert.strictEqual(csv.parcels.length, 5);
  assert.strictEqual(csv.invoiceRows.length, 1);
});

test('les colis à 0 € (facturés le mois d\'avant) sont ignorés', () => {
  assert.strictEqual(a.unbilledCount, 1);
  assert.strictEqual(byRef['1256123'], undefined);
  assert.strictEqual(a.billedCount, 4);
});

test('la remise est répartie au prorata du transport : Σ net = total facture', () => {
  assert.ok(Math.abs(a.netAllocated - a.sumTotal) < 0.01, `${a.netAllocated} ≠ ${a.sumTotal}`);
  // 1263091 : 3,928507 − 3,59 × 14 % = 3,4259
  assert.strictEqual(byRef['1263091'].net, 3.4259);
});

test('le retour est rattaché à la commande d\'origine par « Expedition liée »', () => {
  assert.strictEqual(byRef['LG479896'].is_return, true);
  assert.strictEqual(byRef['LG479896'].order_id, 1184944);
  assert.strictEqual(byRef['LG479896'].kind, null);
});

test('1260857 : pesée aberrante, 12,80 € au lieu de 3,59 € → 8,46 € HT réclamables', () => {
  const p = byRef['1260857'];
  assert.strictEqual(p.kind, 'aberrant');
  assert.strictEqual(p.due, 3.59);
  // (12,80 − 3,59) × (1 − 14 % + 5,808 % d'indexation)
  assert.strictEqual(p.ecart, 8.46);
});

test('une pesée plus lourde de 250 g n\'est PAS réclamable (carton > tare)', () => {
  const p = byRef['1259913'];
  assert.strictEqual(p.kind, 'pesee');
  assert.ok(p.ecart > 0);
});

test('un colis au bon tarif n\'a pas d\'écart', () => {
  assert.strictEqual(byRef['1263091'].ecart, null);
  assert.strictEqual(byRef['1263091'].kind, null);
});

test('on ne réclame jamais sous notre propre poids déclaré', () => {
  // Déclaré 2 000 g, calcul en base 900 g, pesé 2 100 g : le tarif dû est
  // celui de 2 000 g (6,49 €), pas celui de 900 g (4,69 €).
  const one = parseMondialRelayCsv(Buffer.from([HEAD,
    row({ ref: '1', mode: '24R', billed: '2100', transport: '6.99', declared: '2000', measured: '2100', total: '6.99' }),
    row({ ref: '2', mode: '24R', billed: '1500', transport: '6.49', declared: '1500', measured: '1500', total: '6.49' }),
  ].join('\n'), 'latin1'));
  const r = analyzeMondialRelayCsv(one, { remiseRate: 14, knownOrderIds: new Set([1, 2]), bddWeights: { 1: 900 } });
  assert.strictEqual(r.parcels[0].due, 6.49);
  assert.strictEqual(r.parcels[0].kind, 'pesee');
});

test('1258648 : produit mal pesé en base, pesée cohérente avec le carton → PAS réclamable', () => {
  // Concentré 30 ml à 40 g en base, parti dans un carton de 46,5 × 33,5 × 16 cm :
  // 950 g pesés, soit 0,04 g/cm³. Un rapport pesé/déclaré (×19) l'aurait réclamé.
  const one = parseMondialRelayCsv(Buffer.from([HEAD,
    row({ ref: '1258648', mode: '24R', billed: '950', index: '0.272395', transport: '4.69', declared: '40', measured: '950',
      complement: '0.13', total: '5.092395', dims: ['465', '335', '160'], vol: '4984' }),
  ].join('\n'), 'latin1'));
  const p = analyzeMondialRelayCsv(one, { remiseRate: 14, knownOrderIds: new Set([1258648]), bddWeights: { 1258648: 51 } }).parcels[0];
  assert.strictEqual(p.density, 0.038);
  // CGV 2026 : ses 4 984 g volumétriques justifieraient même 12,80 €. Rien à réclamer.
  assert.strictEqual(p.kind, null);
});

test('1231593 (CGV 2026) : le volumétrique entre dans le tarif dû → 7,46 € et non 8,48 €', () => {
  // LGYOUVAP2600000065 : déclaré 420 g, calculé 431 g, volumétrique 536 g, pesé 4 600 g.
  const one = parseMondialRelayCsv(Buffer.from([HEAD,
    row({ ref: '1231593', mode: '24RC', billed: '4600', index: '0.772864', transport: '12.80', declared: '420', measured: '4600',
      complement: '0.13', total: '13.702864', dims: ['165', '130', '125'], vol: '536' }),
    row({ ref: '2', mode: '24RC', billed: '700', transport: '4.69', declared: '700', measured: '700', total: '4.69' }),
  ].join('\n'), 'latin1'));
  const p = analyzeMondialRelayCsv(one, {
    remiseRate: 14, periodStart: '01/05/2026', knownOrderIds: new Set([1231593, 2]), bddWeights: { 1231593: 431 },
  }).parcels[0];
  assert.strictEqual(p.due, 4.69);
  assert.strictEqual(p.ecart, 7.46);
  assert.strictEqual(p.kind, 'aberrant');
});

test('CGV 2025 : un colis facturé au volumétrique est réclamable', () => {
  const parcels = [
    { pays: 'BE', mode: '24R', transport: 6.49, billed_g: 1758, declared_g: 1280, bdd_g: 1280, measured_g: 1500, volumetric_g: 1758 },
    { pays: 'BE', mode: '24R', transport: 6.49, billed_g: 1500, declared_g: 1500, measured_g: 1500, volumetric_g: 0 },
    { pays: 'BE', mode: '24R', transport: 4.69, billed_g: 900, declared_g: 900, measured_g: 900, volumetric_g: 0 },
    { pays: 'BE', mode: '24R', transport: 12.80, billed_g: 6003, declared_g: 810, bdd_g: 816, measured_g: 2050, volumetric_g: 6003 },
    { pays: 'BE', mode: '24R', transport: 6.99, billed_g: 2050, declared_g: 2050, measured_g: 2050, volumetric_g: 0 },
  ];
  classifyParcels(parcels, { remiseRate: 13, cgv: '2025' });
  // Même tranche 1-2 kg : facturé au volumétrique sans surcoût, rien à réclamer.
  assert.strictEqual(parcels[0].kind, null);
  // 6 kg volumétriques contre 2,05 kg pesés : dû au tarif 2-3 kg.
  assert.strictEqual(parcels[3].kind, 'volumetrique_hors_cgv');
  assert.strictEqual(parcels[3].due, 6.99);
  // Le même colis sous les CGV 2026 : surcoût carton, non réclamable.
  classifyParcels(parcels, { remiseRate: 14, cgv: '2026' });
  assert.strictEqual(parcels[3].kind, 'volumetrique');
});

test('CGV applicables selon la période facturée', () => {
  assert.strictEqual(cgvForInvoice({ periodStart: '01/12/2025', invoiceDate: '31/12/2025' }), '2025');
  assert.strictEqual(cgvForInvoice({ periodStart: '01/01/2026' }), '2026');
  assert.strictEqual(cgvForInvoice({}), '2026');
});

test('sans dimensions (annexes 2025), aucune pesée n\'est déclarée aberrante', () => {
  const one = parseMondialRelayCsv(Buffer.from([HEAD,
    row({ ref: '1', mode: '24R', billed: '4400', transport: '12.80', declared: '120', measured: '4400', total: '12.80' }),
  ].join('\n'), 'latin1'));
  const p = analyzeMondialRelayCsv(one, { remiseRate: 14, knownOrderIds: new Set([1]) }).parcels[0];
  assert.strictEqual(p.density, null);
  // Sans dimensions : pas « aberrant », mais 4,4 kg pour 120 g = sans rapport avec le contenu.
  assert.strictEqual(p.kind, 'incoherent');
});

test('pesée sans rapport avec le contenu : 3 fois le poids ET 500 g de plus', () => {
  const parcels = [
    // 1259840 : un atomiseur de 81 g pesé 1,44 kg (FR, 3,29 € → 5,14 €)
    { pays: 'FR', mode: '24R', transport: 5.14, billed_g: 1440, declared_g: 81, bdd_g: 81, measured_g: 1440, volumetric_g: 495, density: 0.582 },
    // 650 g pesés pour 200 g : 3,25 fois mais seulement 450 g de plus → simple pesée
    { pays: 'FR', mode: '24R', transport: 3.63, billed_g: 650, declared_g: 200, bdd_g: 200, measured_g: 650, volumetric_g: 0 },
    // 1,10 kg pour 800 g : emballage, pas une erreur
    { pays: 'FR', mode: '24R', transport: 5.14, billed_g: 1100, declared_g: 800, bdd_g: 800, measured_g: 1100, volumetric_g: 0 },
    { pays: 'FR', mode: '24R', transport: 3.29, billed_g: 200, declared_g: 200, measured_g: 200, volumetric_g: 0 },
    { pays: 'FR', mode: '24R', transport: 3.63, billed_g: 700, declared_g: 700, measured_g: 700, volumetric_g: 0 },
  ];
  classifyParcels(parcels, { remiseRate: 14, cgv: '2026' });
  assert.strictEqual(parcels[0].kind, 'incoherent');
  assert.strictEqual(parcels[1].kind, 'pesee');
  assert.strictEqual(parcels[2].kind, 'pesee');
});

test('référence « ? » (étiquette saisie à la main) : livraison retrouvée par le suivi, pas un retour', () => {
  // LGYOUVAP2600000086 : ref « ? », suivi 72159319.
  const one = parseMondialRelayCsv(Buffer.from([HEAD,
    row({ ref: '?', tracking: '72159319', mode: '24R', pays: 'ES', billed: '2300', transport: '9.79', declared: '2300', total: '10.49' }),
  ].join('\n'), 'latin1'));
  const p = analyzeMondialRelayCsv(one, { remiseRate: 14, orderByTracking: { 72159319: 1264000 } }).parcels[0];
  assert.strictEqual(p.is_return, false);
  assert.strictEqual(p.order_id, 1264000);
});

test('retour 2026 (PCI) et retour client (REL) : rattachés, jamais dans les écarts', () => {
  const one = parseMondialRelayCsv(Buffer.from([HEAD,
    // Colis non retiré renvoyé : 3 € + 1,50 € de ré-étiquetage (LGYOUVAP2600000085)
    row({ ref: 'LG618470', tracking: '98036266', pickup: 'PCI', mode: 'LCC', type: 'Retour', pays: 'FR', billed: '200',
      transport: '3', declared: '160', measured: '200', complement: '1.5', total: '4.5', linked: '00618470' }),
    // Retour client déposé en relais, livré chez EMC
    row({ ref: '1261699', tracking: '72132740', pickup: 'REL', mode: 'LCC', type: 'Livraison ', pays: 'FR', billed: '400',
      index: '0.208507', transport: '3.59', declared: '100', measured: '400', complement: '0.13', total: '3.928507' }),
  ].join('\n'), 'latin1'));
  const [pci, rel] = analyzeMondialRelayCsv(one, {
    remiseRate: 14, knownOrderIds: new Set([1261699]), orderByTracking: { '00618470': 1255000 }, bddWeights: { 1261699: 100 },
  }).parcels;
  assert.strictEqual(pci.return_kind, 'non_retire');
  assert.strictEqual(pci.order_id, 1255000);
  assert.strictEqual(rel.return_kind, 'client');
  assert.strictEqual(rel.order_id, 1261699);
  assert.strictEqual(rel.kind, null);
});

test('tranches de poids', () => {
  assert.strictEqual(bracketIndex(250), 0);
  assert.strictEqual(bracketIndex(251), 1);
  assert.strictEqual(bracketIndex(4400), 6);
});

test('sans PDF, le taux de remise se déduit du CSV', () => {
  const r = analyzeMondialRelayCsv(csv, { ...ctx, remiseRate: null });
  assert.strictEqual(r.remiseSource, 'csv');
  assert.strictEqual(r.remiseRate, 14);
});

if (failed) { console.log(`\n${failed} échec(s)`); process.exit(1); }
console.log('\nTous les tests passent.');
