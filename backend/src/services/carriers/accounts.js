/**
 * Lecture des contrats transporteurs (table carrier_accounts).
 *
 * Un « compte » = un contrat chez un transporteur : les identifiants d'API et
 * les réglages d'expédition qui vont avec. La table remplace les clés
 * `laposte_*` d'app_config, qui ne savaient porter qu'un seul contrat par
 * transporteur — Chronopost en aura deux, à router sur le mode de livraison.
 *
 * Le cache mémoire évite une requête par étiquette au moment du rush du
 * packing. Il est court (60 s) : un réglage corrigé dans la base s'applique
 * dans la minute, sans redémarrage.
 */

const pool = require('../../config/database');

const CACHE_TTL_MS = 60000;

/** @type {Map<string, {account: object, expiresAt: number}>} */
const cache = new Map();

/**
 * Charge un contrat transporteur.
 *
 * @param {string} carrierCode - code transporteur (`shipping_carriers.code`)
 * @param {string} accountCode - code du contrat au sein du transporteur
 * @returns {Promise<{id: number, carrierCode: string, accountCode: string, label: string, credentials: object, settings: object}>}
 * @throws {Error & {statusCode: number}} 500 si le contrat est absent ou désactivé —
 *         c'est une erreur de configuration, pas une erreur du transporteur.
 */
const getAccount = async (carrierCode, accountCode) => {
  const key = `${carrierCode}/${accountCode}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.account;
  }

  const result = await pool.query(
    `SELECT id, carrier_code, account_code, label, credentials, settings
     FROM carrier_accounts
     WHERE carrier_code = $1 AND account_code = $2 AND active = true`,
    [carrierCode, accountCode]
  );

  if (result.rows.length === 0) {
    const err = new Error(
      `Contrat transporteur « ${key} » introuvable ou désactivé dans carrier_accounts`
    );
    err.statusCode = 500;
    throw err;
  }

  const row = result.rows[0];
  const account = {
    id: row.id,
    carrierCode: row.carrier_code,
    accountCode: row.account_code,
    label: row.label,
    credentials: row.credentials || {},
    settings: row.settings || {}
  };

  cache.set(key, { account, expiresAt: Date.now() + CACHE_TTL_MS });
  return account;
};

/**
 * Vide le cache. Utile aux tests et à toute future édition des réglages
 * depuis l'interface, qui doit reprendre effet sans attendre l'expiration.
 *
 * @param {string} [carrierCode] - limite la purge à un transporteur
 * @param {string} [accountCode]
 */
const invalidateAccountCache = (carrierCode, accountCode) => {
  if (carrierCode && accountCode) {
    cache.delete(`${carrierCode}/${accountCode}`);
    return;
  }
  cache.clear();
};

/**
 * Vérifie que les réglages indispensables sont présents avant d'appeler le
 * transporteur. Échouer ici plutôt que sur une 400 opaque de l'API : le message
 * dit quelle clé manque et dans quel contrat.
 *
 * @param {object} account - tel que renvoyé par getAccount
 * @param {{credentials?: string[], settings?: string[]}} required
 * @throws {Error & {statusCode: number}}
 */
const assertAccountComplete = (account, required = {}) => {
  const missing = [];

  for (const key of required.credentials || []) {
    if (!account.credentials[key]) missing.push(`credentials.${key}`);
  }
  for (const key of required.settings || []) {
    if (!account.settings[key]) missing.push(`settings.${key}`);
  }

  if (missing.length > 0) {
    const err = new Error(
      `Configuration ${account.carrierCode}/${account.accountCode} incomplète : ${missing.join(', ')}`
    );
    err.statusCode = 500;
    throw err;
  }
};

module.exports = { getAccount, invalidateAccountCache, assertAccountComplete };
