/**
 * Réclamation de facturation : demande cochée comparée aux avoirs et rectificatives.
 * Sans base ni réseau. Montants réels : réclamation d'octobre 2026.
 */
const assert = require('assert');
const { matchBillingClaim } = require('../src/services/claims/billingClaimMatch');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.error(`  FAIL ${name}\n       ${e.message}`); }
}
const supp = (tracking, description, claimed_ht) => ({ kind: 'supplement', tracking, description, claimed_ht });
const weight = (tracking, claimed_ht) => ({ kind: 'weight', tracking, claimed_ht, description: null });
const cSupp = (tracking, description, base_ht, credit_date = '2026-11-04') =>
  ({ tracking, description, base_ht, has_weight: false, credit_number: '40984106', credit_date });
const cWeight = (tracking, base_ht) =>
  ({ tracking, description: null, base_ht, has_weight: true, credit_number: '40984082', credit_date: '2026-11-04' });
const rectif = (tracking, amount_ht) => ({ tracking, amount_ht, invoice_number: '40984081' });
const sentOn = '2026-11-03';

console.log('billingClaimMatch');

test('supplément remboursé : accepté, même à 0 €', () => {
  const r = matchBillingClaim({ sentOn,
    lines: [supp('XN461831039FR', "Zone difficile d'accès", 5), supp('XS489966107FR', 'Retour expéditeur', 0)],
    credits: [cSupp('XN461831039FR', "Zone difficile d'accès", -5), cSupp('XS489966107FR', 'Retour expéditeur', 0)] });
  assert.deepStrictEqual(r.lines.map(l => l.status), ['accepted', 'accepted']);
  assert.strictEqual(r.summary.status, 'accepted');
  assert.strictEqual(r.summary.obtained_ht, 5);
});

test('poids : obtenu = avoir − rectificative, un tarif révisé peut dépasser la demande', () => {
  const r = matchBillingClaim({ sentOn,
    lines: [weight('XR710677285TS', 1.68)],
    credits: [cWeight('XR710677285TS', -4.96)], rectifs: [rectif('XR710677285TS', 3.2)] });
  assert.strictEqual(r.lines[0].status, 'accepted');
  assert.strictEqual(r.lines[0].obtained_ht, 1.76);
  assert.strictEqual(r.lines[0].rebilled_ht, 3.2);
});

test('poids : rectificative trop haute = accepté en partie', () => {
  const r = matchBillingClaim({ sentOn, lines: [weight('XR1', 2)], credits: [cWeight('XR1', -5)], rectifs: [rectif('XR1', 4)] });
  assert.strictEqual(r.lines[0].status, 'partial');
  assert.strictEqual(r.lines[0].obtained_ht, 1);
});

test('poids : tarif non calculable, accepté dès que quelque chose est rendu', () => {
  const r = matchBillingClaim({ sentOn, lines: [weight('XF1', null)], credits: [cWeight('XF1', -12.99)], rectifs: [rectif('XF1', 8.47)] });
  assert.strictEqual(r.lines[0].status, 'accepted');
});

test('aucun avoir : en attente', () => {
  const r = matchBillingClaim({ sentOn, lines: [supp('XA', 'Supplément Corse', 5)], credits: [] });
  assert.strictEqual(r.lines[0].status, 'pending');
  assert.strictEqual(r.summary.status, 'pending');
});

test('avoir reçu après la demande sans cette ligne : non accepté', () => {
  const r = matchBillingClaim({ sentOn, lines: [supp('XA', 'Supplément Corse', 5), supp('XB', 'Supplément Corse', 5)], credits: [cSupp('XA', 'Supplément Corse', -5)] });
  assert.deepStrictEqual(r.lines.map(l => l.status), ['accepted', 'not_accepted']);
  assert.strictEqual(r.summary.status, 'partial');
});

test('seul un avoir antérieur à la demande : encore en attente', () => {
  const r = matchBillingClaim({ sentOn, lines: [supp('XB', 'Supplément Corse', 5)], credits: [cSupp('XA', 'Supplément Corse', -5, '2026-10-01')] });
  assert.strictEqual(r.lines[0].status, 'pending');
  assert.strictEqual(r.extras.length, 1);
});

test('même colis, deux suppléments : chacun son avoir, le type compte', () => {
  const r = matchBillingClaim({ sentOn,
    lines: [supp('XV911418595JB', 'Réacheminement', 8), supp('XV911418595JB', 'Retour expéditeur', 2)],
    credits: [cSupp('XV911418595JB', 'Retour expéditeur', -2), cSupp('XV911418595JB', 'Réacheminement', -8)] });
  assert.deepStrictEqual(r.lines.map(l => l.obtained_ht), [8, 2]);
});

test('une ligne décochée, puis remboursée quand même : hors demande', () => {
  const r = matchBillingClaim({ sentOn, lines: [supp('XA', 'Supplément Corse', 5)],
    credits: [cSupp('XA', 'Supplément Corse', -5), { tracking: 'XS498360103FR', base_ht: -2.14, has_weight: true, is_indemnity: true, credit_date: '2026-11-05' }] });
  assert.strictEqual(r.extras.length, 1);
  assert.strictEqual(r.extras[0].tracking, 'XS498360103FR');
});

test('avoir ancien sans détail de ligne : ignoré, pas pris pour un refus', () => {
  const r = matchBillingClaim({ sentOn, lines: [supp('XA', 'Supplément Corse', 5)], credits: [{ tracking: 'XA', base_ht: null, credit_date: '2026-11-04' }] });
  assert.strictEqual(r.lines[0].status, 'pending');
});

if (failures) { console.error(`\n${failures} échec(s)`); process.exit(1); }
