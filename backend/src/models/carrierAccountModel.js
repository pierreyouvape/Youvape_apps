/**
 * Écriture des contrats transporteurs (`carrier_accounts`).
 *
 * La lecture pour l'étiquetage vit dans `services/carriers/accounts` ; ici,
 * c'est l'écriture depuis l'écran de réglages. Les deux sont séparées parce
 * qu'elles n'ont pas les mêmes règles : l'étiquetage a besoin des secrets en
 * clair, l'écran de réglages ne doit jamais les voir.
 *
 * Deux garanties tiennent tout le fichier :
 *
 *   1. **Un secret ne redescend jamais vers le navigateur.** Les champs marqués
 *      `secret` par l'adaptateur sont retirés à la lecture, remplacés par un
 *      simple booléen « renseigné ou non ».
 *   2. **Un secret non saisi n'est pas effacé.** Le formulaire affiche les
 *      champs secrets vides ; sans cette règle, ouvrir l'écran et enregistrer
 *      suffirait à vider le mot de passe d'API et à arrêter l'expédition.
 */

const pool = require('../config/database');
const { getAdapter } = require('../services/carriers');
const { invalidateAccountCache } = require('../services/carriers/accounts');

/** Lit une valeur par chemin pointé (`sender.city`). */
const lire = (obj, chemin) =>
  chemin.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);

/** Écrit une valeur par chemin pointé, en créant les niveaux manquants. */
const ecrire = (obj, chemin, valeur) => {
  const parts = chemin.split('.');
  const dernier = parts.pop();
  const cible = parts.reduce((o, k) => {
    if (!o[k] || typeof o[k] !== 'object') o[k] = {};
    return o[k];
  }, obj);
  cible[dernier] = valeur;
};

/** Champs déclarés par l'adaptateur, ou une description vide. */
const champsDe = (carrierCode) => {
  try {
    return getAdapter(carrierCode).accountFields || { credentials: [], settings: [] };
  } catch (e) {
    return { credentials: [], settings: [] };
  }
};

/**
 * Les contrats, expurgés de leurs secrets.
 *
 * Chaque champ secret est remplacé par `null` dans les valeurs, et son nom
 * apparaît dans `secretsRenseignes` — de quoi afficher « ●●●● (enregistré) »
 * sans jamais transmettre la valeur.
 *
 * @returns {Promise<object[]>}
 */
const listForSettings = async () => {
  const { rows } = await pool.query(
    `SELECT id, carrier_code, account_code, label, credentials, settings, active, updated_at
     FROM carrier_accounts ORDER BY carrier_code, account_code`
  );

  return rows.map((row) => {
    const champs = champsDe(row.carrier_code);
    const credentials = { ...(row.credentials || {}) };
    const secretsRenseignes = [];

    for (const f of champs.credentials) {
      if (!f.secret) continue;
      if (credentials[f.key]) secretsRenseignes.push(f.key);
      delete credentials[f.key];
    }

    return {
      id: row.id,
      carrier_code: row.carrier_code,
      account_code: row.account_code,
      label: row.label,
      active: row.active,
      updated_at: row.updated_at,
      credentials,
      settings: row.settings || {},
      secretsRenseignes
    };
  });
};

/**
 * Crée ou met à jour un contrat.
 *
 * Les valeurs arrivent à plat, par chemin pointé (`sender.city`), telles que
 * l'adaptateur les a décrites. Une clé absente de l'envoi n'est pas touchée :
 * l'écran peut n'envoyer que ce qui a changé.
 *
 * @param {object} entree
 * @param {string} entree.carrierCode
 * @param {string} entree.accountCode
 * @param {string} [entree.label]
 * @param {object} [entree.credentials] - valeurs à plat ; une chaîne vide sur un
 *        champ secret veut dire « ne pas toucher », pas « effacer »
 * @param {object} [entree.settings]
 * @param {boolean} [entree.active]
 * @returns {Promise<object>}
 */
const upsert = async ({ carrierCode, accountCode, label, credentials = {}, settings = {}, active }) => {
  const refus = (message) => {
    const err = new Error(message);
    err.statusCode = 400;
    throw err;
  };

  if (!carrierCode || !accountCode) refus('Transporteur et code de contrat sont obligatoires');
  // Un transporteur inconnu du registre donnerait un contrat que personne ne
  // sait utiliser.
  getAdapter(carrierCode);

  const champs = champsDe(carrierCode);
  const secrets = new Set(champs.credentials.filter(f => f.secret).map(f => f.key));

  const { rows: existant } = await pool.query(
    'SELECT credentials, settings, label FROM carrier_accounts WHERE carrier_code = $1 AND account_code = $2',
    [carrierCode, accountCode]
  );
  const actuel = existant[0] || { credentials: {}, settings: {}, label: null };

  const nouveauxCred = { ...(actuel.credentials || {}) };
  for (const [cle, valeur] of Object.entries(credentials)) {
    const v = typeof valeur === 'string' ? valeur.trim() : valeur;
    // Un secret laissé vide au formulaire garde sa valeur : sans ça, ouvrir
    // l'écran et enregistrer viderait le mot de passe et arrêterait l'expédition.
    if (secrets.has(cle) && (v === '' || v == null)) continue;
    ecrire(nouveauxCred, cle, v);
  }

  const nouveauxSettings = { ...(actuel.settings || {}) };
  for (const [cle, valeur] of Object.entries(settings)) {
    ecrire(nouveauxSettings, cle, typeof valeur === 'string' ? valeur.trim() : valeur);
  }

  const { rows } = await pool.query(
    `INSERT INTO carrier_accounts (carrier_code, account_code, label, credentials, settings, active)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
     ON CONFLICT (carrier_code, account_code) DO UPDATE
       SET label       = EXCLUDED.label,
           credentials = EXCLUDED.credentials,
           settings    = EXCLUDED.settings,
           active      = EXCLUDED.active,
           updated_at  = NOW()
     RETURNING id`,
    [carrierCode, accountCode,
     label || actuel.label || `${carrierCode} — ${accountCode}`,
     JSON.stringify(nouveauxCred), JSON.stringify(nouveauxSettings),
     active !== false]
  );

  invalidateAccountCache(carrierCode, accountCode);
  return rows[0];
};

/**
 * Supprime un contrat.
 *
 * Refusé s'il est encore désigné par une correspondance : supprimer le contrat
 * sous les pieds d'un mode de livraison actif ferait échouer l'expédition avec
 * un message obscur, au moment où quelqu'un scanne un colis.
 */
const remove = async (id) => {
  const { rows } = await pool.query(
    'SELECT carrier_code, account_code FROM carrier_accounts WHERE id = $1', [id]
  );
  if (!rows[0]) return null;

  const { rows: usages } = await pool.query(
    `SELECT denomination FROM shipping_method_carrier_map
     WHERE carrier_code = $1 AND account_code = $2`,
    [rows[0].carrier_code, rows[0].account_code]
  );

  if (usages.length > 0) {
    const err = new Error(
      `Ce contrat est utilisé par ${usages.length} mode(s) de livraison : `
      + `${usages.map(u => `« ${u.denomination} »`).join(', ')}. `
      + `Changez-les de contrat avant de le supprimer.`
    );
    err.statusCode = 409;
    throw err;
  }

  await pool.query('DELETE FROM carrier_accounts WHERE id = $1', [id]);
  invalidateAccountCache(rows[0].carrier_code, rows[0].account_code);
  return rows[0];
};

module.exports = { listForSettings, upsert, remove };
