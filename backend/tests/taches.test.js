/**
 * App Tâches : déblocage de l'étape suivante, statut d'une tâche, message Slack.
 * Sans base : `node tests/taches.test.js` (ou `npm test`).
 *
 * Cas tirés du tableau Monday (Xlim 4 Pro : Rédaction texte → Stockage → Photos…).
 */

const assert = require('assert');
const { nextStepPlan, taskStatus } = require('../src/services/tachesRules');
const { buildDoneMessage, buildTaskDoneMessage } = require('../src/services/tachesSlack');

const MAXIME = 2;
const GAIA = 4;
const PIERRE = 1;

const xlim = () => [
  { id: 1, name: 'Rédaction texte', status: 'fait', owners: [PIERRE], notify: [MAXIME] },
  { id: 2, name: 'Stockage', status: 'fait', owners: [MAXIME], notify: [GAIA] },
  { id: 3, name: 'Photos produits', status: 'bloque', owners: [GAIA], notify: [PIERRE] },
  { id: 4, name: 'Relecture en front', status: 'bloque', owners: [PIERRE], notify: [] },
];

// Stockage fait : Photos débloquée, Gaïa (« Personnes » de Stockage) prévenue.
let plan = nextStepPlan(xlim(), 2);
assert.strictEqual(plan.unblock.id, 3);
assert.strictEqual(plan.next.id, 3);
assert.deepStrictEqual(plan.recipients, [GAIA]);
assert.strictEqual(plan.finished, false);

// Étape suivante déjà « à faire » : pas touchée, mais citée.
let steps = xlim();
steps[2].status = 'a_faire';
plan = nextStepPlan(steps, 2);
assert.strictEqual(plan.unblock, null);
assert.strictEqual(plan.next.id, 3);

// Étape suivante déjà faite : on saute à la première non faite.
steps = xlim();
steps[2].status = 'fait';
plan = nextStepPlan(steps, 2);
assert.strictEqual(plan.next.id, 4);
assert.strictEqual(plan.unblock.id, 4);

// Personne à notifier oubliée : on prévient les responsables de l'étape suivante.
steps = xlim();
steps[1].notify = [];
plan = nextStepPlan(steps, 2);
assert.deepStrictEqual(plan.recipients, [GAIA]);

// Dernière étape faite : tâche terminée, rien à débloquer.
steps = xlim().map((s) => ({ ...s, status: 'fait' }));
steps[3].notify = [MAXIME];
plan = nextStepPlan(steps, 4);
assert.strictEqual(plan.finished, true);
assert.strictEqual(plan.next, null);
assert.strictEqual(plan.unblock, null);
assert.deepStrictEqual(plan.recipients, [MAXIME]);

// Plusieurs personnes, doublon retiré.
steps = xlim();
steps[1].notify = [GAIA, PIERRE, GAIA];
assert.deepStrictEqual(nextStepPlan(steps, 2).recipients, [GAIA, PIERRE]);

// Statut de la tâche.
assert.strictEqual(taskStatus([], 'en_cours'), 'en_cours');
assert.strictEqual(taskStatus(xlim()), 'en_cours');
assert.strictEqual(taskStatus(xlim().map((s) => ({ ...s, status: 'fait' }))), 'fait');
assert.strictEqual(taskStatus([{ status: 'a_faire' }, { status: 'bloque' }]), 'a_faire');

// Message Slack : mention par ID de membre, sinon nom en gras ; texte échappé ; lien vers la tâche.
const names = new Map([[MAXIME, 'Maxime'], [GAIA, 'Gaïa'], [PIERRE, 'Pierre']]);
const msg = buildDoneMessage({
  task: { id: 42, title: 'Xlim <4> Pro & co' },
  doneStep: { name: 'Stockage' },
  nextStep: { name: 'Photos produits', owners: [GAIA] },
  unblocked: true,
  finished: false,
  doneBy: 'Maxime',
  recipients: [GAIA, PIERRE],
  members: { [GAIA]: 'U0GAIA123' },
  names,
});
const text = msg.blocks[0].text.text;
assert.ok(text.includes('<@U0GAIA123> *Pierre*'), text);
assert.ok(text.includes('Xlim &lt;4&gt; Pro &amp; co'), text);
assert.ok(text.includes('Débloquée, à faire maintenant :* Photos produits (Gaïa)'), text);
assert.ok(msg.blocks[1].elements[0].url.endsWith('/taches/tache/42'));

const last = buildDoneMessage({
  task: { id: 1, title: 'T' }, doneStep: { name: 'Join Story' }, nextStep: null,
  unblocked: false, finished: true, doneBy: null, recipients: [MAXIME], members: {}, names,
});
assert.ok(last.blocks[0].text.text.includes('Toutes les étapes sont faites'));

// Tâche sans étape terminée (suivi quotidien) : noms en gras, pas de mention.
const td = buildTaskDoneMessage({ task: { id: 7, title: 'MEP tickets GitLab', board_name: 'Suivi', people: [MAXIME] }, doneBy: 'Pierre', names });
assert.ok(td.blocks[0].text.text.includes('*Pierre* a terminé une tâche (de Maxime)'), td.blocks[0].text.text);
assert.ok(!td.blocks[0].text.text.includes('<@'));
assert.ok(td.blocks[1].elements[0].url.endsWith('/taches/tache/7'));

// Statuts Monday en plus : « Attente correction » compte comme en cours.
assert.strictEqual(taskStatus([{ status: 'attente_correction' }, { status: 'bloque' }]), 'en_cours');

console.log('✓ taches.test.js');
