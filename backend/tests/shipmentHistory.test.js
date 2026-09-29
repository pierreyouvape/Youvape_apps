/**
 * Banc de l'Historique d'expédition : le parcours d'un colis et les filtres.
 *
 * Sans base : `node tests/shipmentHistory.test.js` (ou `npm test`).
 *
 * Ce qui est couvert :
 *   - le parcours complet, dans l'ordre du temps, qui a fait quoi ;
 *   - une étape sans date n'apparaît pas (pas de date inventée) ;
 *   - la recherche porte sur tout l'historique, sans bornes de dates ;
 *   - « pas encore déposé » ne vise que les transporteurs à bordereau.
 */

const assert = require('assert');
const { buildTimeline } = require('../src/controllers/shipmentHistoryController');
const { buildWhere } = require('../src/models/shipmentHistoryModel');

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

const label = {
  created_at: '2026-09-28T14:05:00.000Z', packer_name: 'Franck', tracking_number: 'CG037227215FR',
  weight_g: 334, bms_ship_status: 'confirmed', bms_confirmed_at: '2026-09-28T14:05:02.000Z', cancelled_at: null,
};

console.log('Parcours');

test('toutes les étapes, dans l\'ordre, avec leur auteur', () => {
  const ev = buildTimeline({
    label,
    order: { paid_at: '2026-09-27T20:00:00.000Z', created_at: '2026-09-27T19:58:00.000Z' },
    wave: {
      wave_number: 'MR-000004', created_at: '2026-09-28T08:00:00.000Z', created_by_name: 'Pierre',
      first_printed_at: '2026-09-28T08:01:00.000Z', printed_by_name: 'Pierre', print_count: 1,
      assigned_at: '2026-09-28T08:10:00.000Z', assigned_to_name: 'Celyne',
      picked_at: '2026-09-28T08:40:00.000Z', picked_by_name: 'Celyne', active: true,
    },
    incidents: [{
      action: 'incomplete', created_at: '2026-09-28T14:06:00.000Z', created_by_name: 'Franck',
      missing: [{ qty: 1, name: 'Booster', sku: '11152' }], ticket_id: 9901011,
    }],
    bordereau: { bordereau_number: '0123', created_at: '2026-09-28T16:00:00.000Z', created_by_name: 'elena' },
  });
  assert.deepStrictEqual(ev.map(e => e.title), [
    'Commande payée', 'Ajoutée à la vague MR-000004', 'Bons de préparation imprimés',
    'Picking commencé au PDA', 'Picking terminé', 'Étiquette générée',
    'Expédition confirmée dans BMS', 'Envoyée incomplète', 'Déposée — bordereau 0123',
  ]);
  assert.strictEqual(ev.find(e => e.title === 'Picking terminé').by, 'Celyne');
  assert.strictEqual(ev.find(e => e.kind === 'label').detail, 'CG037227215FR — 334 g');
  assert.strictEqual(ev.find(e => e.kind === 'incident').detail, 'Manquant : 1 × Booster (11152) — Ticket SAV #9901011');
});

test('étape sans date absente ; plusieurs impressions : pas d\'auteur unique', () => {
  const ev = buildTimeline({
    label: { ...label, bms_ship_status: 'pending', bms_confirmed_at: null },
    order: null,
    wave: {
      wave_number: 'MAN-000001', created_at: '2026-09-28T08:00:00.000Z', created_by_name: 'Pierre',
      first_printed_at: '2026-09-28T08:01:00.000Z', printed_by_name: 'Anthony', print_count: 3,
      assigned_at: null, picked_at: null, active: false,
      removed_at: '2026-09-28T09:00:00.000Z', removed_by_name: 'Franck', removed_reason: 'Mise de côté',
    },
    incidents: [],
    bordereau: null,
  });
  assert.deepStrictEqual(ev.map(e => e.title), [
    'Ajoutée à la vague MAN-000001', 'Bons de préparation imprimés', 'Retirée de la vague', 'Étiquette générée',
  ]);
  const print = ev.find(e => e.title === 'Bons de préparation imprimés');
  assert.strictEqual(print.by, null);
  assert.strictEqual(print.detail, '3 impressions, la dernière par Anthony');
});

console.log('Filtres');

test('la recherche ignore la période', () => {
  const { where, params } = buildWhere({ q: ' 1262491 ', from: '2026-09-22', to: '2026-09-29' }, []);
  assert.ok(!where.includes('created_at'));
  assert.deepStrictEqual(params, ['%1262491%']);
});

test('période en heure de Paris, dates mal formées ignorées', () => {
  const ok = buildWhere({ from: '2026-09-22', to: '2026-09-29' }, []);
  assert.strictEqual((ok.where.match(/Europe\/Paris/g) || []).length, 2);
  const ko = buildWhere({ from: '22/09/2026', to: "2026-09-29'; --" }, []);
  assert.strictEqual(ko.where, '');
});

test('« pas encore déposé » : transporteurs à bordereau seulement', () => {
  const { where, params } = buildWhere({ status: 'not_deposited' }, ['colissimo', 'mondial_relay']);
  assert.ok(where.includes('bordereau_id IS NULL'));
  assert.deepStrictEqual(params, [['colissimo', 'mondial_relay']]);
});

test('préparateur : au packing OU au picking, sauf pour les compteurs', () => {
  assert.ok(buildWhere({ user: '6' }, []).where.includes('packed_by = $1 OR picker_id = $1'));
  assert.strictEqual(buildWhere({ user: '6' }, [], { withUser: false }).where, '');
});

console.log(failures === 0 ? '\nTous les tests passent.' : `\n${failures} test(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
