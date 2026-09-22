/**
 * Banc de non-régression de la reprise des confirmations d'expédition BMS.
 *
 * Sans dépendance ni base ni réseau : `node tests/bmsShipmentConfirm.test.js`
 * (ou `npm test`). Les deux frontières d'entrée-sortie — l'API BMS et la table
 * des étiquettes — sont remplacées par des doublures.
 *
 * Ce banc existe pour UNE règle, et il casse si on y touche :
 *
 *   une reprise n'envoie un POST /ship QUE si BMS déclare encore des unités à
 *   expédier sur la commande.
 *
 * Rejouer en aveugle créerait une seconde expédition dans BMS et sortirait le
 * stock une seconde fois. Les deux cas où il ne faut rien envoyer ne sont pas
 * théoriques, ils ont été mesurés en prod le 22/09/2026 :
 *   - notre numéro de suivi est déjà sur une expédition BMS (confirmation qui
 *     avait en fait abouti, réponse perdue) ;
 *   - la commande est soldée sans aucune expédition enregistrée — c'est la
 *     trace que laisse une régularisation faite à la main dans BMS
 *     (commandes 1262418 et 1262427).
 */

const assert = require('assert');

const bmsApiModel = require('../src/models/bmsApiModel');
const shipmentLabelModel = require('../src/models/shipmentLabelModel');
const service = require('../src/services/bmsShipmentConfirmService');

let failures = 0;

// EN SÉRIE, impérativement : tous les tests partagent les mêmes doublures et le
// même journal d'appels. Lancés de front, ils se réinstallent les uns sur les
// autres et le banc raconte n'importe quoi (constaté à l'écriture : 9 échecs
// pour du code sain). Chaque test s'exécute donc seul, du début à la fin.
let serie = Promise.resolve();
function test(name, fn) {
  serie = serie.then(async () => {
    try {
      await fn();
      console.log(`  ok   ${name}`);
    } catch (err) {
      failures++;
      console.error(`  FAIL ${name}\n       ${err.message}`);
    }
  });
}

// ── Doublures ───────────────────────────────────────────────────────────────
// Le service ne touche BMS que par apiCall, et la base que par ces trois
// fonctions : les remplacer suffit à le faire tourner à sec.

const ETIQUETTE = {
  id: 42,
  order_number: '1262418',
  tracking_number: '87001440135575',
  carrier_code: 'laposte',
  status: 'active',
  bms_ship_status: 'pending',
  bms_ship_title: 'La poste - Courrier suivi (port payé)',
  bms_attempts: 1,
  created_at: new Date()
};

/** Réponse BMS d'une commande, dans la forme rendue par l'API réelle. */
const commande = ({ status = 'processing', shipments = [], toShip = [] }) => ({
  data: { status, shipments, items: toShip.map((q) => ({ qty_to_ship: q })) }
});

let appels;   // tout ce qui est parti vers BMS
let ecrits;   // tout ce qui a été écrit sur l'étiquette

const monter = ({ lecture, envoi, etiquette = ETIQUETTE }) => {
  appels = [];
  ecrits = [];

  bmsApiModel.apiCall = async (endpoint, method = 'GET', body = null) => {
    appels.push({ endpoint, method, body });
    if (method === 'GET') {
      if (lecture instanceof Error) throw lecture;
      return lecture;
    }
    if (envoi instanceof Error) throw envoi;
    return { success: true };
  };

  shipmentLabelModel.hasBmsColumns = async () => true;
  shipmentLabelModel.findBmsConfirmationById = async () => ({ ...etiquette });
  shipmentLabelModel.markBmsConfirmed = async (id, opts = {}) =>
    ecrits.push({ quoi: 'confirme', id, status: opts.status || 'confirmed' });
  shipmentLabelModel.recordBmsFailure = async (id, message) =>
    ecrits.push({ quoi: 'echec', id, message });
};

/** Les POST /ship réellement partis. */
const expeditionsEnvoyees = () => appels.filter((a) => a.method === 'POST');

console.log('\nReprise de confirmation BMS — aucun appel réseau, aucune base');

// ── La règle ────────────────────────────────────────────────────────────────

test('notre suivi est déjà sur une expédition BMS : rien n\'est renvoyé', async () => {
  monter({
    lecture: commande({
      status: 'complete',
      shipments: [{ id: 1, trackings: ['87001440135575'] }],
      toShip: [0, 0]
    })
  });

  const r = await service.confirmLabelById(42);

  assert.strictEqual(expeditionsEnvoyees().length, 0, 'un POST /ship est parti alors que BMS avait déjà l\'expédition');
  assert.strictEqual(r.status, 'confirmed');
  assert.deepStrictEqual(ecrits, [{ quoi: 'confirme', id: 42, status: 'confirmed' }]);
});

test('commande soldée sans expédition (régularisée à la main) : rien n\'est renvoyé', async () => {
  // L'état réel des commandes 1262418 et 1262427 après reprise manuelle :
  // BMS les donne « complete », sans aucune expédition, et plus rien à sortir.
  monter({ lecture: commande({ status: 'complete', shipments: [], toShip: [0, 0, 0] }) });

  const r = await service.confirmLabelById(42);

  assert.strictEqual(expeditionsEnvoyees().length, 0, 'un POST /ship est parti sur une commande qui n\'a plus rien à expédier');
  assert.strictEqual(r.status, 'manual');
  assert.deepStrictEqual(ecrits, [{ quoi: 'confirme', id: 42, status: 'manual' }]);
});

test('BMS a encore des unités à expédier : le POST part, une seule fois', async () => {
  monter({ lecture: commande({ shipments: [], toShip: [1, 1, 1] }) });

  const r = await service.confirmLabelById(42);
  const envois = expeditionsEnvoyees();

  assert.strictEqual(envois.length, 1);
  assert.strictEqual(envois[0].endpoint, '/sales/order/1262418/ship?ref=true');
  assert.strictEqual(r.status, 'confirmed');
});

test('le libellé renvoyé est celui de l\'étiquette, pas le défaut du transporteur', async () => {
  // Un point de retrait Colissimo confirmé en « Domicile sans signature »
  // étiquetterait faux dans BMS.
  monter({
    lecture: commande({ shipments: [], toShip: [1] }),
    etiquette: {
      ...ETIQUETTE,
      carrier_code: 'colissimo',
      bms_ship_title: 'La Poste : Colissimo - Point de retrait'
    }
  });

  await service.confirmLabelById(42);

  assert.strictEqual(
    expeditionsEnvoyees()[0].body.tracking.title,
    'La Poste : Colissimo - Point de retrait'
  );
});

test('sans numéro de suivi (retrait magasin), le champ n\'est pas inventé', async () => {
  monter({
    lecture: commande({ shipments: [], toShip: [1] }),
    etiquette: { ...ETIQUETTE, tracking_number: null }
  });

  await service.confirmLabelById(42);
  const envoye = expeditionsEnvoyees()[0].body.tracking;

  assert.ok(!('tracking_number' in envoye), 'un numéro de suivi vide a été envoyé à BMS');
  assert.ok(envoye.title);
});

// ── Ce qui doit rester rattrapable ──────────────────────────────────────────

test('BMS illisible : aucun envoi, l\'étiquette reste en attente', async () => {
  // Commande pas encore importée dans BMS, ou API en panne : on ne sait pas,
  // donc on n'écrit pas. Le prochain passage réessaiera.
  monter({ lecture: new Error('BMS API error: 400 - Order not found') });

  await assert.rejects(() => service.confirmLabelById(42));

  assert.strictEqual(expeditionsEnvoyees().length, 0);
  assert.strictEqual(ecrits.length, 1);
  assert.strictEqual(ecrits[0].quoi, 'echec');
  assert.match(ecrits[0].message, /Lecture BMS impossible/);
});

test('POST refusé : l\'échec est écrit, pas avalé', async () => {
  monter({
    lecture: commande({ shipments: [], toShip: [2] }),
    envoi: new Error('BMS API error: 400 - La commande ne peut pas être expédiée')
  });

  await assert.rejects(() => service.confirmLabelById(42));

  assert.strictEqual(ecrits.length, 1);
  assert.strictEqual(ecrits[0].quoi, 'echec');
  assert.match(ecrits[0].message, /ne peut pas/);
});

test('une étiquette déjà confirmée ne repart jamais', async () => {
  for (const statut of ['confirmed', 'manual']) {
    monter({
      lecture: commande({ shipments: [], toShip: [5] }), // BMS accepterait !
      etiquette: { ...ETIQUETTE, bms_ship_status: statut }
    });

    const r = await service.confirmLabelById(42);

    assert.strictEqual(appels.length, 0, `statut ${statut} : BMS a été appelé`);
    assert.strictEqual(r.status, statut);
  }
});

test('une étiquette qui n\'attend aucune confirmation est refusée', async () => {
  monter({
    lecture: commande({ shipments: [], toShip: [5] }),
    etiquette: { ...ETIQUETTE, bms_ship_status: 'skipped' }
  });

  await assert.rejects(() => service.confirmLabelById(42), /aucune confirmation/);
  assert.strictEqual(appels.length, 0);
});

serie.then(() => {
  console.log(failures === 0 ? '\nTous les tests passent.' : `\n${failures} test(s) en échec.`);
  process.exit(failures === 0 ? 0 : 1);
});
