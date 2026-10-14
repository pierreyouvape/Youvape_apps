/**
 * Banc des Retours client : `node tests/returns.test.js` (ou `npm test`).
 *
 * Ce qui est couvert :
 *   - le prix payé d'une pièce ;
 *   - le rattachement des composants d'un pack woosb (commande 1267852) ;
 *   - la sélection : pack → composants au prorata, plafonds ;
 *   - la répartition des pièces à la validation ;
 *   - le statut ;
 *   - le fournisseur proposé.
 */

const assert = require('assert');
const {
  unitPaid, bundleParents, expandSelection, checkDestination, returnStatus, suggestSupplier,
  suggestPoints, replacementShipping, pickRefund, pointsBreakdown, breakdownText,
} = require('../src/services/returnRules');

const throws = (fn, re) => assert.throws(fn, (e) => re.test(e.message) && e.statusCode === 400);

// ── Prix payé ───────────────────────────────────────────────────────────────
assert.strictEqual(unitPaid({ qty: 1, line_total: 12.60, line_tax: 2.52 }), 15.12);
assert.strictEqual(unitPaid({ qty: 3, line_total: 10, line_tax: 2 }), 4);
assert.strictEqual(unitPaid({ qty: 0, line_total: 10, line_tax: 2 }), 0);

// ── Packs : commande réelle 1267852 ─────────────────────────────────────────
// Pack e Cigare XO (1 batterie + 1 cartouche déclinée), puis un e-liquide seul.
const order = [
  { order_item_id: 1236655, name: 'e Cigare XO Havana 20mg', product_id: 1158163, variation_id: null, qty: 1, line_total: 12.60,
    product_type: 'woosb', woosb_ids: [{ id: '1158003', qty: '1' }, { id: '1158002', qty: '1' }], returnable: 1 },
  { order_item_id: 1236656, name: 'Batterie', product_id: 1158003, variation_id: null, qty: 1, line_total: 0, product_type: 'simple', returnable: 1, sku: 'B' },
  { order_item_id: 1236657, name: 'Cartouche', product_id: 1158002, variation_id: 1158150, qty: 1, line_total: 0, product_type: 'variation', returnable: 1, sku: 'C' },
  { order_item_id: 1236658, name: 'Don Cristo Cuba 50ml', product_id: 1158938, variation_id: null, qty: 1, line_total: 16.60, product_type: 'simple', returnable: 1, sku: 'D' },
];
const parents = bundleParents(order);
assert.strictEqual(parents.get(1236656), 1236655, 'batterie → pack');
assert.strictEqual(parents.get(1236657), 1236655, 'cartouche (parent listé) → pack');
assert.strictEqual(parents.has(1236658), false, 'e-liquide payant : hors pack');

// Un article gratuit hors pack (cadeau) juste après un pack n'y est pas rattaché.
assert.strictEqual(bundleParents([
  order[0],
  { order_item_id: 9, product_id: 777, qty: 1, line_total: 0, product_type: 'simple' },
]).has(9), false, 'cadeau non listé dans le pack');

// ── Sélection ───────────────────────────────────────────────────────────────
let sel = expandSelection(order, [{ orderItemId: 1236655, qty: 1 }]);
assert.deepStrictEqual(sel.map(s => [s.line.order_item_id, s.qty, s.bundleOf]),
  [[1236655, 1, null], [1236656, 1, 1236655], [1236657, 1, 1236655]], 'le pack emporte ses composants');

sel = expandSelection(order, [{ orderItemId: 1236655, qty: 1 }, { orderItemId: 1236657, qty: 1 }]);
assert.strictEqual(sel.length, 3, 'composant coché en plus du pack : pas en double');

sel = expandSelection(order, [{ orderItemId: 1236657, qty: 1 }]);
assert.deepStrictEqual(sel.map(s => [s.line.order_item_id, s.qty, s.bundleOf]), [[1236657, 1, null]], 'composant seul');

// 2 packs sur 3 → 2/3 des composants (3 cartouches par pack).
const big = [
  { order_item_id: 1, name: 'Pack', product_id: 50, qty: 3, line_total: 30, product_type: 'woosb', woosb_ids: [{ id: '51', qty: '3' }], returnable: 3 },
  { order_item_id: 2, name: 'Cartouche', product_id: 51, qty: 9, line_total: 0, product_type: 'simple', returnable: 9 },
];
sel = expandSelection(big, [{ orderItemId: 1, qty: 2 }]);
assert.strictEqual(sel[1].qty, 6, '2 packs de 3 cartouches');

throws(() => expandSelection(order, [{ orderItemId: 1236658, qty: 2 }]), /1 au plus/);
throws(() => expandSelection(order, [{ orderItemId: 1236658, qty: 1.5 }]), /Quantité invalide/);
throws(() => expandSelection(order, [{ orderItemId: 42, qty: 1 }]), /absente/);
throws(() => expandSelection(order, []), /Aucun article/);
throws(() => expandSelection([{ ...order[3], returnable: 0 }], [{ orderItemId: 1236658, qty: 1 }]), /0 au plus/);

// ── Répartition ─────────────────────────────────────────────────────────────
const line = { name: 'Pod', sku: 'P1', product_id: 7, qty: 3 };
assert.deepStrictEqual(checkDestination(line, { restock: 2, supplier: 1, supplierId: 4, problem: 'Ne charge pas' }, true),
  { restock: 2, supplier: 1, noRestock: 0 });
throws(() => checkDestination(line, { restock: 2 }, true), /3 pièce\(s\) à répartir, 2/);
throws(() => checkDestination(line, { supplier: 3, problem: 'x' }, true), /choisir le fournisseur/);
throws(() => checkDestination(line, { supplier: 3, supplierId: 4, problem: '  ' }, true), /décrire le problème/);
throws(() => checkDestination(line, { restock: 3 }, false), /pas de retour exigé/);
throws(() => checkDestination({ ...line, sku: null }, { restock: 3 }, true), /sans SKU/);
assert.deepStrictEqual(checkDestination(line, { noRestock: 3 }, false), { restock: 0, supplier: 0, noRestock: 3 },
  'sans retour exigé : le client garde le produit');

// ── Statut ──────────────────────────────────────────────────────────────────
assert.strictEqual(returnStatus({}), 'attente');
assert.strictEqual(returnStatus({ treated_at: 'x' }), 'attente', 'renvoi anticipé : on attend toujours le colis');
assert.strictEqual(returnStatus({ received_at: 'x' }), 'recu');
assert.strictEqual(returnStatus({ received_at: 'x', treated_at: 'y' }), 'traite');
assert.strictEqual(returnStatus({ received_at: 'x', cancelled_at: 'z' }), 'annule');

// ── Fournisseur proposé ─────────────────────────────────────────────────────
const lots = [
  { supplier_id: 1, last_received: '2026-06-01' },
  { supplier_id: 2, last_received: '2026-08-15' },
  { supplier_id: 3, last_received: '2026-09-20' },
];
assert.strictEqual(suggestSupplier(lots, '2026-09-01'), 2, 'dernier lot reçu avant le paiement');
assert.strictEqual(suggestSupplier(lots, '2026-10-01'), 3);
assert.strictEqual(suggestSupplier(lots, '2026-01-01'), 3, 'aucun lot avant : le plus récent');
assert.strictEqual(suggestSupplier([], '2026-01-01'), null);

// ── Points ──────────────────────────────────────────────────────────────────
// Pack (15,12 €) et ses deux composants à 0 €, e-liquide à 19,92 € : 3 504 points.
const retLines = [
  { qty: 1, unit_paid: 15.12 }, { qty: 1, unit_paid: 0 }, { qty: 1, unit_paid: 0 }, { qty: 1, unit_paid: 19.92 },
];
assert.strictEqual(suggestPoints(retLines), 3504);
assert.strictEqual(suggestPoints(retLines, { shippingPaid: 4.9, withShipping: true }), 3994, '+ frais de port');
assert.strictEqual(suggestPoints(retLines, { shippingPaid: 4.9 }), 3504, 'port non coché');
assert.strictEqual(suggestPoints([{ qty: 3, unit_paid: 4.33 }]), 1299, 'arrondi au point');

// Déduction des frais de retour (étiquette fournie) : 17,91 € − 4,90 € = 1 301 points.
let b = pointsBreakdown([{ qty: 1, unit_paid: 17.91 }], { deductEuros: 4.9 });
assert.deepStrictEqual(b, { paid: 17.91, shipping: 0, deduct: 4.9, euros: 13.01, points: 1301 });
assert.strictEqual(breakdownText(b), '17,91 € − 4,90 € déduits');
b = pointsBreakdown([{ qty: 2, unit_paid: 10 }], { shippingPaid: 4.9, withShipping: true, deductEuros: 4.9 });
assert.strictEqual(b.points, 2000, 'port remboursé, étiquette déduite');
assert.strictEqual(breakdownText(b), '20,00 € + 4,90 € de port − 4,90 € déduits');
assert.strictEqual(pointsBreakdown([{ qty: 1, unit_paid: 3 }], { deductEuros: 4.9 }).points, -190, 'négatif : refusé par le serveur');

// ── Méthode du renvoi ───────────────────────────────────────────────────────
assert.deepStrictEqual(replacementShipping('Chronopost Relais 24h'), { method: '2Shop' }, 'même point relais : même réseau');
assert.deepStrictEqual(replacementShipping('Chronopost Domicile 24h'), { method: 'Colissimo Domicile' });
assert.deepStrictEqual(replacementShipping('Chronopost Express'), { method: 'Colissimo Domicile' });
assert.deepStrictEqual(replacementShipping('Mondial Relay - Lockers'), { method: 'Mondial Relay - Lockers' });
assert.deepStrictEqual(replacementShipping('2Shop'), { method: '2Shop' });

// ── Remboursement à rattacher ───────────────────────────────────────────────
const refunds = [
  { wp_refund_id: 10, refund_date: '2026-10-01 10:00:00' },
  { wp_refund_id: 11, refund_date: '2026-10-12 15:00:00' },
  { wp_refund_id: 12, refund_date: '2026-10-11 09:00:00' },
];
assert.strictEqual(pickRefund(refunds, new Set(), '2026-10-09T08:00:00Z').wp_refund_id, 12, 'le premier après le retour');
assert.strictEqual(pickRefund(refunds, new Set([12]), '2026-10-09T08:00:00Z').wp_refund_id, 11, 'déjà pris par un autre retour');
assert.strictEqual(pickRefund(refunds, new Set([11, 12]), '2026-10-09T08:00:00Z'), null, 'celui d\'avant le retour ne compte pas');

// ── Téléphone de l'étiquette retour Mondial Relay (erreur 10051) ────────────
const { telephoneInternational } = require('../src/services/carriers/mondialRelayAdapter');
assert.strictEqual(telephoneInternational('+330675012023', 'FR'), '+33675012023', 'commande 1212967 : 0 après +33');
assert.strictEqual(telephoneInternational('06 75 01 20 23', 'FR'), '+33675012023', 'format national');
assert.strictEqual(telephoneInternational('0033675012023', 'FR'), '+33675012023', '00 → +');
assert.strictEqual(telephoneInternational('+33675012023', 'FR'), '+33675012023', 'déjà bon');
assert.strictEqual(telephoneInternational('0470123456', 'BE'), '+32470123456', 'mobile belge');
assert.strictEqual(telephoneInternational('+320470123456', 'BE'), '+32470123456');
assert.strictEqual(telephoneInternational('+352621123456', 'LU'), '+352621123456', 'Luxembourg intact');
assert.strictEqual(telephoneInternational('+390612345678', 'IT'), '+390612345678', 'Italie : le 0 reste');
assert.strictEqual(telephoneInternational('', 'FR'), '');
assert.strictEqual(telephoneInternational('123', 'FR'), '', 'illisible : vide');

console.log('✓ returns.test.js');
