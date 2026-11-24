/**
 * Banc de la règle « à expédier » (sortie de BMS, lot 1 : simulation à côté de BMS).
 *
 * Sans base : `node tests/toShip.test.js` (ou `npm test`).
 *
 * Ce qui est couvert, sur des commandes réelles :
 *   - articles : sans la ligne du pack woosb (Kit Essentiel 1276613 = 7 pièces,
 *     BMS en comptait 8 avec le pack), remboursé déduit (1272242), pack
 *     remboursé qui emporte ses composants (1239530), même SKU cumulé ;
 *   - décision : statut réglé, étiquette active, remboursement non lu, date de
 *     début, plus rien à expédier ;
 *   - photo BMS telle que le Picking l'affiche (processing seul, plafond WC) ;
 *   - écarts : les trois sortes, suivi d'une photo à l'autre, « qui dure » ;
 *   - à vérifier (3 jours) et les deux mails.
 */

const assert = require('assert');
const rules = require('../src/services/toShipRules');
const { buildDiffMail, buildCheckMail } = require('../src/services/toShipMail');

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

const total = (lines) => [...lines.values()].reduce((a, b) => a + b, 0);
const map = (obj) => new Map(Object.entries(obj));

// ── Commandes réelles (order_items + refund_items, relevées le 24/11/2026) ──

// Kit Essentiel : la ligne du pack (29,08 €) et ses 5 composants à 0 €.
const KIT_ESSENTIEL_1276613 = [
  { name: 'Kit Essentiel', qty: 1, line_total: 29.08, product_id: 1114323, sku: '1114323', type: 'woosb',
    woosb_ids: [{ id: '1183164', qty: '1' }, { id: '1170501', qty: '1' }, { id: '998898', qty: '1' }, { id: '687676', qty: '1' }, { id: '437031', qty: '1' }], refunded: 0 },
  { name: 'Pod Xros 5 Mini - Carbon Black', qty: 1, line_total: 0, product_id: 1183164, sku: '1183164-1183180', type: 'variation', refunded: 0 },
  { name: 'Pack 4 Cartouches 3ml Xros Corex 3.0 - 0.60 Ω', qty: 1, line_total: 0, product_id: 1170499, sku: '1170499-1170501', type: 'variation', refunded: 0 },
  { name: 'The Wolf - 6mg', qty: 1, line_total: 0, product_id: 998896, sku: '998896-998898', type: 'variation', refunded: 0 },
  { name: 'Blond Authentique - 6mg', qty: 1, line_total: 0, product_id: 687674, sku: '687674-687676', type: 'variation', refunded: 0 },
  { name: 'Pochette YouVape', qty: 1, line_total: 0, product_id: 437031, sku: '437031', type: 'simple', refunded: 0 },
  { name: "Boba's Vision Salt - 10mg", qty: 1, line_total: 3.93, product_id: 1275860, sku: '1275860-1275861', type: 'variation', refunded: 0 },
  { name: 'Cola Ice Salt - 10mg', qty: 1, line_total: 3.93, product_id: 1272536, sku: '1272536-1272537', type: 'variation', refunded: 0 }
];

// Lot 10 Boosters + 7 e-liquides dont un remboursé (Love Blond).
const LOT_BOOSTERS_1272242 = [
  { name: 'Lot 10 Boosters Sel de Nicotine Freaks', qty: 1, line_total: 8.25, product_id: 1255776, sku: '1255776', type: 'woosb', woosb_ids: [{ id: '828621', qty: '10' }], refunded: 0 },
  { name: 'Booster Sel de nicotine 50/50', qty: 10, line_total: 0, product_id: 828621, sku: '828621', type: 'simple', refunded: 0 },
  { name: 'Flocon Vanillé DLUO - 6mg', qty: 1, line_total: 0, product_id: 10935, sku: '10935-11074', type: 'variation', refunded: 0 },
  { name: 'Love Blond DLUO - 6mg', qty: 1, line_total: 1.67, product_id: 1196147, sku: '1196147-1196150', type: 'variation', refunded: 1 },
  { name: 'FR4 DLUO - 16mg', qty: 1, line_total: 1.67, product_id: 576681, sku: '576681-576686', type: 'variation', refunded: 0 },
  { name: 'Gold Digger DLUO - 6mg', qty: 1, line_total: 1.67, product_id: 1196138, sku: '1196138-1196141', type: 'variation', refunded: 0 },
  { name: 'Fruits des Bois DLUO - 6mg', qty: 1, line_total: 1.67, product_id: 1124971, sku: '1124971-1124974', type: 'variation', refunded: 0 },
  { name: 'Kansetsu Salt - 10mg', qty: 1, line_total: 3.27, product_id: 1185153, sku: '1185153-1185154', type: 'variation', refunded: 0 },
  { name: 'Blackberry Custard 100ml', qty: 1, line_total: 9.08, product_id: 1207647, sku: '1207647', type: 'simple', refunded: 0 }
];

// Pack Nexi Two × 4 : WooCommerce ne rembourse QUE la ligne du pack.
const packNexi = (packRefunded) => [
  { name: 'Pack Nexi Two + 3 Recharges Sans nicotine', qty: 4, line_total: 56.33, product_id: 1225160, sku: '1225160', type: 'woosb',
    woosb_ids: [{ id: '1223745', qty: '1' }, { id: '1017215', qty: '1' }, { id: '437031', qty: '1' }], refunded: packRefunded },
  { name: 'Kit Nexi Two - Black', qty: 4, line_total: 0, product_id: 1223745, sku: '1223745-1223760', type: 'variation', refunded: 0 },
  { name: 'Pack 3x Cartouches Nexi Sans Nicotine - Triple Mangue glacées', qty: 4, line_total: 0, product_id: 1017215, sku: '1017215-1128093', type: 'variation', refunded: 0 }
];

console.log('Articles');

test('Kit Essentiel 1276613 : sans la ligne du pack, 7 pièces (BMS : 8, pack compté)', () => {
  const lines = rules.orderLines(KIT_ESSENTIEL_1276613);
  assert.strictEqual(lines.has('1114323'), false);
  assert.strictEqual(lines.size, 7);
  assert.strictEqual(total(lines), 7);
});

test('1272242 : Lot 10 Boosters en 10 boosters, e-liquide remboursé déduit (16 pièces)', () => {
  const lines = rules.orderLines(LOT_BOOSTERS_1272242);
  assert.strictEqual(lines.get('828621'), 10);
  assert.strictEqual(lines.has('1196147-1196150'), false);
  assert.strictEqual(total(lines), 16);
});

test('remainingBySku garde le SKU remboursé à 0 (plafond de la photo BMS)', () => {
  assert.strictEqual(rules.remainingBySku(LOT_BOOSTERS_1272242).get('1196147-1196150'), 0);
});

test('Pack Nexi 1239530 : sans remboursement, 8 pièces (= BMS)', () => {
  assert.strictEqual(total(rules.orderLines(packNexi(0))), 8);
});

test('Pack Nexi remboursé 4/4 : ses composants partent avec lui, plus rien à expédier', () => {
  assert.strictEqual(rules.orderLines(packNexi(4)).size, 0);
});

test('Pack Nexi remboursé 1/4 : 3 kits et 3 recharges', () => {
  const lines = rules.orderLines(packNexi(1));
  assert.strictEqual(lines.get('1223745-1223760'), 3);
  assert.strictEqual(lines.get('1017215-1128093'), 3);
});

test('même SKU sur deux lignes : cumulé', () => {
  const lines = rules.orderLines([
    { sku: 'A', type: 'simple', qty: 2, line_total: 5, refunded: 0 },
    { sku: 'A', type: 'simple', qty: 1, line_total: 0, refunded: 0 }
  ]);
  assert.strictEqual(lines.get('A'), 3);
});

test('produit à stock non suivi : compté comme les autres (Kit Pod Kiwi 2)', () => {
  const lines = rules.orderLines([{ sku: 'KIWI2', type: 'simple', qty: 1, line_total: 39, refunded: 0, stock: null }]);
  assert.strictEqual(lines.get('KIWI2'), 1);
});

console.log('Décision');

const since = rules.sinceBound('2026-11-24');
const opts = { statuses: ['processing'], since };
const base = { status: 'wc-processing', hasActiveLabel: false, pendingRefund: false, paidAt: '2026-11-24 09:15:00' };
const someLines = map({ A: 1 });

test('date de début : AAAA-MM-JJ → minuit, sinon éteint', () => {
  assert.strictEqual(since, '2026-11-24 00:00:00');
  assert.strictEqual(rules.sinceBound(''), null);
  assert.strictEqual(rules.sinceBound(undefined), null);
  assert.strictEqual(rules.sinceBound('2026-02-30'), null);
  assert.strictEqual(rules.sinceBound('24/11/2026'), null);
});

test('statuts : réglage vide → wc-processing ; préfixe ajouté', () => {
  assert.deepStrictEqual(rules.wcStatuses([]), ['wc-processing']);
  assert.deepStrictEqual(rules.wcStatuses(null), ['wc-processing']);
  assert.deepStrictEqual(rules.wcStatuses(['processing', 'wc-being-delivered', 'processing']), ['wc-processing', 'wc-being-delivered']);
});

test('commande en cours, payée après la date, avec articles : à expédier', () => {
  assert.strictEqual(rules.isToShip(base, someLines, opts), true);
});

test('statut hors réglage (Terminée, Retrait boutique) : non', () => {
  assert.strictEqual(rules.isToShip({ ...base, status: 'wc-completed' }, someLines, opts), false);
  assert.strictEqual(rules.isToShip({ ...base, status: 'wc-awaiting-delivery' }, someLines, opts), false);
});

test('statut ajouté au réglage : oui', () => {
  assert.strictEqual(rules.isToShip({ ...base, status: 'wc-being-delivered' }, someLines,
    { ...opts, statuses: ['processing', 'being-delivered'] }), true);
});

test('étiquette active : déjà partie', () => {
  assert.strictEqual(rules.isToShip({ ...base, hasActiveLabel: true }, someLines, opts), false);
});

test('remboursement pas encore lu : la commande attend', () => {
  assert.strictEqual(rules.isToShip({ ...base, pendingRefund: true }, someLines, opts), false);
});

test('payée la veille de la date de début : ni comparée ni signalée', () => {
  assert.strictEqual(rules.isToShip({ ...base, paidAt: '2026-11-23 23:59:59' }, someLines, opts), false);
  assert.strictEqual(rules.isToShip({ ...base, paidAt: '2026-11-24 00:00:00' }, someLines, opts), true);
});

test('plus aucun article (tout remboursé) : non', () => {
  assert.strictEqual(rules.isToShip(base, rules.orderLines(packNexi(4)), opts), false);
});

test('service éteint (pas de date de début) : jamais', () => {
  assert.strictEqual(rules.isToShip(base, someLines, { ...opts, since: null }), false);
});

console.log('Photo BMS vue par le Picking');

test('holded écartée, processing gardée', () => {
  const view = rules.bmsView(
    [{ orderNumber: '1', status: 'processing' }, { orderNumber: '2', status: 'holded' }],
    [{ order_number: '1', sku: 'A', qty_to_ship: 1 }, { order_number: '2', sku: 'B', qty_to_ship: 1 }]
  );
  assert.deepStrictEqual([...view.keys()], ['1']);
});

test('1272242 : BMS garde l\'e-liquide remboursé, le Picking le retire', () => {
  const view = rules.bmsView(
    [{ orderNumber: '1272242', status: 'processing' }],
    [{ order_number: '1272242', sku: '1196147-1196150', qty_to_ship: 1 }, { order_number: '1272242', sku: '828621', qty_to_ship: 10 }],
    new Map([['1272242', rules.remainingBySku(LOT_BOOSTERS_1272242)]])
  );
  assert.deepStrictEqual([...view.get('1272242')], [['828621', 10]]);
});

test('tout remboursé dans WC : la commande sort de la photo', () => {
  const view = rules.bmsView(
    [{ orderNumber: '1239530', status: 'processing' }],
    [{ order_number: '1239530', sku: '1223745-1223760', qty_to_ship: 4 }],
    new Map([['1239530', rules.remainingBySku(packNexi(4))]])
  );
  assert.strictEqual(view.size, 0);
});

test('SKU que WC ne porte pas : pas de plafond', () => {
  const view = rules.bmsView(
    [{ orderNumber: '1', status: 'processing' }],
    [{ order_number: '1', sku: 'X', qty_to_ship: 2 }],
    new Map([['1', map({ A: 0 })]])
  );
  assert.strictEqual(view.get('1').get('X'), 2);
});

console.log('Écarts');

test('photo du 20/11 : listes identiques → aucun écart', () => {
  const ours = new Map([['1276613', rules.orderLines(KIT_ESSENTIEL_1276613)]]);
  const bms = new Map([['1276613', rules.orderLines(KIT_ESSENTIEL_1276613)]]);
  assert.deepStrictEqual(rules.compare(ours, bms), []);
});

test('les trois sortes d\'écart', () => {
  const ours = new Map([['1', map({ A: 1 })], ['3', map({ A: 2, B: 1 })], ['4', map({ A: 1 })]]);
  const bms = new Map([['2', map({ C: 1 })], ['3', map({ A: 1, B: 1 })], ['4', map({ A: 1 })]]);
  const diffs = rules.compare(ours, bms);
  assert.deepStrictEqual(diffs.map(d => [d.orderNumber, d.kind]), [
    ['1', rules.KINDS.OURS_ONLY], ['2', rules.KINDS.BMS_ONLY], ['3', rules.KINDS.LINES]
  ]);
  assert.deepStrictEqual(diffs[2].lines, [{ sku: 'A', ours: 2, bms: 1 }]);
});

test('un SKU d\'un seul côté : écart de lignes', () => {
  const diffs = rules.compare(new Map([['1', map({ A: 1, B: 1 })]]), new Map([['1', map({ A: 1 })]]));
  assert.deepStrictEqual(diffs[0].lines, [{ sku: 'B', ours: 1, bms: 0 }]);
});

test('suivi : revu, disparu, nouveau', () => {
  const current = rules.compare(new Map([['1', map({ A: 1 })], ['5', map({ A: 1 })]]), new Map());
  const open = [
    { id: 10, order_number: '1', signature: current[0].signature },
    { id: 11, order_number: '9', signature: 'bms_only|Z:0/1' }
  ];
  const { seen, resolved, fresh } = rules.track(open, current);
  assert.deepStrictEqual(seen, [10]);
  assert.deepStrictEqual(resolved, [11]);
  assert.deepStrictEqual(fresh.map(d => d.orderNumber), ['5']);
});

test('quantité changée : l\'ancien écart disparaît, un nouveau s\'ouvre', () => {
  const before = rules.compare(new Map([['1', map({ A: 2 })]]), new Map([['1', map({ A: 1 })]]));
  const after = rules.compare(new Map([['1', map({ A: 3 })]]), new Map([['1', map({ A: 1 })]]));
  const { seen, resolved, fresh } = rules.track([{ id: 1, order_number: '1', signature: before[0].signature }], after);
  assert.deepStrictEqual([seen, resolved, fresh.length], [[], [1], 1]);
});

test('qui dure : 2 photos ET 30 min', () => {
  const t0 = '2026-11-24T09:00:00Z';
  assert.strictEqual(rules.isLasting({ photos_seen: 2, first_seen_at: t0, last_seen_at: '2026-11-24T09:02:00Z' }), false);
  assert.strictEqual(rules.isLasting({ photos_seen: 1, first_seen_at: t0, last_seen_at: t0 }), false);
  assert.strictEqual(rules.isLasting({ photos_seen: 15, first_seen_at: t0, last_seen_at: '2026-11-24T09:30:00Z' }), true);
  // Nuit : une photo à 19h, la suivante à 9h.
  assert.strictEqual(rules.isLasting({ photos_seen: 2, first_seen_at: '2026-11-24T18:00:00Z', last_seen_at: '2026-11-25T08:00:00Z' }), true);
});

console.log('À vérifier');

test('plus de 3 jours après le paiement', () => {
  assert.strictEqual(rules.needsCheck('2026-11-21 09:00:00', '2026-11-24 09:00:00'), false);
  assert.strictEqual(rules.needsCheck('2026-11-21 08:59:00', '2026-11-24 09:00:00'), true);
});

test('état BMS d\'une commande à vérifier', () => {
  assert.strictEqual(rules.bmsState(map({ A: 1 }), undefined), 'absent');
  assert.strictEqual(rules.bmsState(map({ A: 1 }), map({ A: 1 })), 'same');
  assert.strictEqual(rules.bmsState(map({ A: 1 }), map({ A: 2 })), 'different');
});

console.log('Mails');

test('mail des écarts : groupes, lien, quantités, HTML échappé', () => {
  const mail = buildDiffMail([
    { order_number: '1279001', kind: 'bms_only', lines: [{ sku: 'A', name: '<Pod>', ours: 0, bms: 1 }],
      status: 'wc-completed', paid_label: '24/11/2026 10:00', shipping_method: 'Colissimo',
      first_seen_label: '24/11 10:05', resolved_label: null },
    { order_number: '1279002', kind: 'lines', lines: [{ sku: 'B', ours: 2, bms: 1 }],
      status: 'wc-processing', paid_label: '24/11/2026 11:00', shipping_method: 'Mondial Relay',
      first_seen_label: '24/11 11:05', resolved_label: '24/11 12:00' }
  ], 'https://apps.example');
  assert.match(mail.subject, /2 écarts/);
  assert.match(mail.html, /href="https:\/\/apps\.example\/orders\/1279001"/);
  assert.match(mail.html, /Chez BMS seulement/);
  assert.match(mail.html, /&lt;Pod&gt;/);
  assert.match(mail.html, /Terminée/);
  assert.match(mail.text, /1279002 .*B 2\/1 — disparu/);
});

test('mail à vérifier : une ligne par commande, état BMS', () => {
  const mail = buildCheckMail([
    { order_number: '1279003', paid_label: '20/11/2026 09:00', status: 'wc-processing', shipping_method: 'Chronopost',
      lines: [{ sku: 'A', name: 'Pod', qty: 2 }], bms: 'absent' }
  ], 'https://apps.example', '24/11 08:00');
  assert.match(mail.subject, /1 commande à vérifier/);
  assert.match(mail.html, /2 × Pod \(A\)/);
  assert.match(mail.html, /absente de la liste BMS/);
  assert.match(mail.html, /Photo BMS de 24\/11 08:00/);
});

if (failures) {
  console.error(`\n${failures} échec(s)`);
  process.exit(1);
}
console.log('\nTout est bon.');
