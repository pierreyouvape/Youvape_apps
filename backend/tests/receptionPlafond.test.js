/**
 * Le plafonnement de réception — ce qui entre en stock quand BMS refuse.
 *
 * BMS accepte une sur-réception tant que la ligne n'a rien reçu, et rejette
 * TOUT LE LOT dès qu'une réception a déjà eu lieu (500, « Unique constraint
 * violation found »). On replie alors sur ce qu'il peut encore prendre.
 *
 * L'invariant qui compte : ce qui est déclaré ENVOYÉ doit être exactement ce
 * qui part chez BMS. C'est cette valeur qui incrémente `units_received`, donc
 * le stock et le coût de revient — la déclarer trop haute invente de la
 * marchandise, trop basse la fait disparaître.
 */
const assert = require('node:assert');
const { plafonnerEnvoi } = require('../src/models/receptionSessionModel');

let echecs = 0;
function test(nom, fn) {
  try { fn(); console.log(`  ok   ${nom}`); }
  catch (e) { echecs += 1; console.error(`  ÉCHEC ${nom}\n       ${e.message}`); }
}

const ligne = (o) => ({
  purchase_order_item_id: o.id,
  bms_line_id: 1000 + o.id,
  supplier_sku: o.ref || `REF${o.id}`,
  product_name: o.nom || `Produit ${o.id}`,
  units_counted: o.compte,
  units_expected: o.attendu,
  units_received: o.recu || 0,
});

console.log('\nRéception — plafonnement quand BMS refuse le dépassement');

// Note : sur une PREMIÈRE réception, BMS accepte le surplus et cette fonction
// n'est jamais appelée — le premier envoi passe. Elle ne sert qu'après un refus,
// et là il ramène tout au commandé, même si rien n'avait encore été reçu.
test('après un refus, le repli ramène au commandé même sans rien de reçu', () => {
  const r = plafonnerEnvoi([ligne({ id: 1, compte: 45, attendu: 40, recu: 0 })]);
  assert.deepStrictEqual(r.items, [{ id: 1001, qty: 40 }]);
  assert.strictEqual(r.nonEnvoyes.length, 1);
  assert.strictEqual(r.nonEnvoyes[0].refusees, 5);
});

test('reliquat : on n\'envoie que ce qu\'il restait à recevoir', () => {
  // 40 commandées, 13 déjà reçues, le magasinier en compte 30 : 27 peuvent passer.
  const r = plafonnerEnvoi([ligne({ id: 2, compte: 30, attendu: 40, recu: 13 })]);
  assert.deepStrictEqual(r.items, [{ id: 1002, qty: 27 }]);
  assert.strictEqual(r.envoye.get(2), 27);
  assert.deepStrictEqual(
    { c: r.nonEnvoyes[0].comptees, e: r.nonEnvoyes[0].envoyees, ref: r.nonEnvoyes[0].refusees },
    { c: 30, e: 27, ref: 3 },
  );
});

test('ligne déjà soldée : elle ne part pas du tout', () => {
  const r = plafonnerEnvoi([ligne({ id: 3, compte: 5, attendu: 40, recu: 40 })]);
  assert.deepStrictEqual(r.items, []);
  assert.strictEqual(r.envoye.get(3), 0);
  assert.strictEqual(r.nonEnvoyes[0].refusees, 5);
});

test('déjà reçu PLUS que commandé : jamais de quantité négative', () => {
  const r = plafonnerEnvoi([ligne({ id: 4, compte: 3, attendu: 10, recu: 14 })]);
  assert.deepStrictEqual(r.items, []);
  assert.strictEqual(r.envoye.get(4), 0);
});

test('une ligne juste n\'est pas pénalisée par une ligne en trop', () => {
  const r = plafonnerEnvoi([
    ligne({ id: 5, compte: 10, attendu: 10, recu: 0 }),   // juste
    ligne({ id: 6, compte: 30, attendu: 40, recu: 13 }),  // dépasse
  ]);
  assert.deepStrictEqual(r.items, [{ id: 1005, qty: 10 }, { id: 1006, qty: 27 }]);
  assert.strictEqual(r.nonEnvoyes.length, 1, 'seule la ligne qui dépasse est signalée');
});

test('aucun écart : rien à signaler', () => {
  const r = plafonnerEnvoi([ligne({ id: 7, compte: 12, attendu: 40, recu: 20 })]);
  assert.deepStrictEqual(r.items, [{ id: 1007, qty: 12 }]);
  assert.strictEqual(r.nonEnvoyes.length, 0);
});

test('INVARIANT : ce qui est déclaré envoyé est exactement ce qui part', () => {
  const lignes = [
    ligne({ id: 10, compte: 45, attendu: 40, recu: 0 }),
    ligne({ id: 11, compte: 30, attendu: 40, recu: 13 }),
    ligne({ id: 12, compte: 5, attendu: 40, recu: 40 }),
    ligne({ id: 13, compte: 8, attendu: 8, recu: 0 }),
  ];
  const r = plafonnerEnvoi(lignes);
  const partiChezBms = r.items.reduce((n, i) => n + i.qty, 0);
  const declareEnvoye = [...r.envoye.values()].reduce((n, q) => n + q, 0);
  assert.strictEqual(declareEnvoye, partiChezBms,
    'le stock serait faux : units_received s\'incrémente de la valeur déclarée');

  // Et rien ne se perd : compté = envoyé + refusé, ligne à ligne.
  for (const l of lignes) {
    const envoye = r.envoye.get(l.purchase_order_item_id);
    const refuse = (r.nonEnvoyes.find((n) => n.ref === l.supplier_sku) || {}).refusees || 0;
    assert.strictEqual(envoye + refuse, l.units_counted,
      `${l.supplier_sku} : ${envoye} + ${refuse} ≠ ${l.units_counted}`);
  }
});

if (echecs > 0) { console.error(`\n${echecs} test(s) en échec.`); process.exit(1); }
console.log('\nTous les tests passent.');
