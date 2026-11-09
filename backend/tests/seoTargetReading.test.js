/**
 * Banc de la lecture des pages cibles du Suivi SEO.
 * Sans réseau ni base : `node tests/seoTargetReading.test.js` (ou `npm test`).
 * Chiffres réels du rapport au 07/11/2026.
 */
const assert = require('assert');
const { currentWindow, windowDays, readTarget, verdictOf, renderTargetsHtml } = require('../src/utils/seoTargetReading');

const win = (from, impressions, target_share, target_impressions, target_position) => ({ from, to: '2026-11-07', impressions, target_share, target_impressions, target_position });
const stats = (baseline, since, last28) => ({ baseline, since, last28: last28 || win('2026-10-11', 1000, 50, 500, 10) });
const base = (impressions, share, targetImpr, position) => ({ from: '2026-07-27', to: '2026-10-22', impressions, target_share: share, target_impressions: targetImpr, target_position: position });

// Mesure : depuis la décision tant qu'elle a moins de 28 jours, jamais à cheval.
const grosFumeur = stats(base(2423, 86, 2084, 9.5), win('2026-10-29', 342, 72.8, 249, 9), win('2026-10-11', 800, 80.9, 632, 9.3));
assert.strictEqual(currentWindow(grosFumeur).target_share, 72.8);
assert.strictEqual(windowDays(currentWindow(grosFumeur)), 10);
assert.strictEqual(verdictOf(grosFumeur, true).code, 'perdue', '80,9 % sur 28 j ne doit plus la dire gagnée');

const ancienne = stats(base(1000, 50, 500, 10), win('2026-09-01', 5000, 60, 3000, 8), win('2026-10-11', 1000, 85, 850, 7));
assert.strictEqual(currentWindow(ancienne).target_share, 85, 'décision de plus de 28 jours : les 28 derniers jours');

assert.strictEqual(currentWindow(stats(base(100, 1, 1, 1), null)), null);
assert.strictEqual(verdictOf(stats(base(100, 1, 1, 1), null), true).code, 'attente');

// Verdicts : la part seule décide.
const aspire = stats(base(9128, 68.1, 6213, 10.4), win('2026-10-29', 555, 84.5, 469, 13.5));
assert.strictEqual(verdictOf(aspire, true).code, 'gagnee');
const vape = stats(base(42245, 87.5, 36972, 7.2), win('2026-10-29', 5203, 96.3, 5012, 6.8));
assert.strictEqual(verdictOf(vape, true).code, 'acquise');
const resistance = stats(base(4160, 44.9, 1866, 19.5), win('2026-10-29', 471, 16.6, 78, 24.3));
assert.strictEqual(verdictOf(resistance, true).code, 'attente');
assert.strictEqual(verdictOf(resistance, false).code, 'revoir');
const kiwi = stats(base(183, 0, 0, null), win('2026-10-31', 17, 17.6, 3, 36.7));
assert.strictEqual(verdictOf(kiwi, true).code, 'vide');

// Part et position se lisent séparément : aspire gagne en part et perd en position.
const a = readTarget(aspire);
assert.deepStrictEqual([a.share.status, a.share.delta], ['hausse', 16.4]);
assert.deepStrictEqual([a.position.status, a.position.delta, a.position.label], ['perdue', -3.1, '▼ 3,1 places perdues']);

const puff = readTarget(stats(base(14337, 3.7, 530, 21.8), win('2026-10-29', 2273, 6.8, 154, 15.1)));
assert.strictEqual(puff.position.label, '▲ 6,7 places gagnées');
assert.strictEqual(readTarget(stats(base(1000, 50, 500, 10), win('2026-10-29', 500, 50, 250, 8.5))).position.label, '▲ 1,5 place gagnée');
assert.strictEqual(readTarget(vape).position.status, 'stable');
assert.strictEqual(readTarget(vape).position.delta, 0.4);

// Trop peu d'impressions de la cible : aucune évolution annoncée (position 1 sur 3 impressions).
const magasin = readTarget(stats(base(7361, 0, 3, 1), win('2026-10-29', 439, 9.3, 41, 4.6)));
assert.strictEqual(magasin.position.status, 'peu');
assert.strictEqual(magasin.position.from, null);
assert.strictEqual(magasin.position.to, 4.6);
assert.strictEqual(readTarget(kiwi).share.status, 'peu');

// Rapport : les deux lectures, la légende et la vraie période.
const row = (label, path, s) => ({ label, target_path: path, reading: readTarget(s), verdict: verdictOf(s, true) });
const html = renderTargetsHtml([row('aspire', '/marque/aspire', aspire), row('a < b', '/x', vape)]);
for (const expected of ['Part de la page cible', 'Position de la page cible', 'Gagnée ou perdue', 'Comment lire', 'du 29/10 au 07/11 (10 jours)', '▼ 3,1 places perdues', 'a &lt; b', '1 gagnée, 1 déjà acquise']) {
  assert.ok(html.includes(expected), `rapport sans « ${expected} »`);
}
assert.ok(!html.includes('Part 28 j'));

console.log('seoTargetReading : OK');
