/**
 * Récurrence des tâches de l'app Tableau : `node tests/tableauRecurrence.test.js` (ou `npm test`).
 */

const assert = require('assert');
const { normalizeRule, nextOccurrence, addDays } = require('../src/services/tableauRecurrence');

const first = (rule) => nextOccurrence(rule, addDays(rule.start_date, -1));

// ── Tous les jours / tous les 3 jours ───────────────────────────────────────
const daily = normalizeRule({ unit: 'day', every: 1, start_date: '2026-10-22' });
assert.strictEqual(first(daily), '2026-10-22');
assert.strictEqual(nextOccurrence(daily, '2026-10-22'), '2026-10-23');
const every3 = normalizeRule({ unit: 'day', every: 3, start_date: '2026-10-22' });
assert.strictEqual(nextOccurrence(every3, '2026-10-22'), '2026-10-25');
assert.strictEqual(nextOccurrence(every3, '2026-10-26'), '2026-10-28');

// ── Semaine : lundi et jeudi (le 22/10/2026 est un jeudi) ───────────────────
const monThu = normalizeRule({ unit: 'week', every: 1, weekdays: [4, 1], start_date: '2026-10-22' });
assert.deepStrictEqual(monThu.weekdays, [1, 4]);
assert.strictEqual(first(monThu), '2026-10-22');
assert.strictEqual(nextOccurrence(monThu, '2026-10-22'), '2026-10-26');
assert.strictEqual(nextOccurrence(monThu, '2026-10-26'), '2026-10-29');

// Une semaine sur deux, le lundi : départ un jeudi → semaine du départ ratée,
// la suivante n'est pas éligible, donc le lundi d'après.
const biweekly = normalizeRule({ unit: 'week', every: 2, weekdays: [1], start_date: '2026-10-22' });
assert.strictEqual(first(biweekly), '2026-11-02');
assert.strictEqual(nextOccurrence(biweekly, '2026-11-02'), '2026-11-16');

// Aucun jour coché → jour de la date de début
assert.deepStrictEqual(normalizeRule({ unit: 'week', every: 1, start_date: '2026-10-22' }).weekdays, [4]);

// ── Mois : le 31 = dernier jour du mois ─────────────────────────────────────
const eom = normalizeRule({ unit: 'month', every: 1, month_day: 31, start_date: '2026-01-31' });
assert.strictEqual(nextOccurrence(eom, '2026-01-31'), '2026-02-28');
assert.strictEqual(nextOccurrence(eom, '2026-02-28'), '2026-03-31');
assert.strictEqual(nextOccurrence(eom, '2026-03-31'), '2026-04-30');

// Tous les 3 mois le 5, départ le 22/10 → le 5 janvier (octobre déjà passé)
const quarterly = normalizeRule({ unit: 'month', every: 3, month_day: 5, start_date: '2026-10-22' });
assert.strictEqual(first(quarterly), '2027-01-05');
assert.strictEqual(nextOccurrence(quarterly, '2027-01-05'), '2027-04-05');

// Tous les ans (12 mois)
const yearly = normalizeRule({ unit: 'month', every: 12, month_day: 29, start_date: '2028-02-29' });
assert.strictEqual(nextOccurrence(yearly, '2028-02-29'), '2029-02-28');

// ── Validation ──────────────────────────────────────────────────────────────
assert.throws(() => normalizeRule({ unit: 'year', every: 1, start_date: '2026-10-22' }), /Récurrence/);
assert.throws(() => normalizeRule({ unit: 'day', every: 0, start_date: '2026-10-22' }), /Intervalle/);
assert.throws(() => normalizeRule({ unit: 'day', every: 1, start_date: '22/10/2026' }), /début/);

console.log('✓ tableauRecurrence : tous les cas passent');
