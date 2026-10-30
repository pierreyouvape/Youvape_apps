/**
 * Renouvellement du jeton yousync, depuis l'app.
 *
 * Personne ne voit ni ne copie le jeton : il est généré ici, posé sur le site par
 * une route à clé WooCommerce (`wc-yousync/v1/token`), et n'est jamais renvoyé au
 * navigateur. Le site garde l'ancien quelques minutes, le temps de la bascule.
 *
 * L'ordre garantit qu'un échec à n'importe quelle étape ne coupe pas la synchro :
 *
 *   1. le nouveau jeton est noté en attente AVANT tout appel : si le site l'accepte
 *      et que la réponse se perd, on ne l'a pas perdu ;
 *   2. le site l'accepte, en gardant l'ancien (15 min) ;
 *   3. on vérifie que le site répond bien au nouveau ;
 *   4. il devient le jeton courant.
 *
 * Interrompu après 2, l'ancien finit par expirer : au premier 401, le polling essaie
 * le jeton en attente et l'adopte (`withTokenRecovery` dans wcSyncService). Refusé
 * par le site (4xx), rien n'a changé : le jeton en attente est oublié.
 */

const crypto = require('crypto');
const pool = require('../config/database');
const appConfigModel = require('../models/appConfigModel');
const yousyncClient = require('./yousyncClient');
const { wcRequest } = require('./wcOrderImportService');

const TOKEN_ROUTE_NAMESPACE = 'wc-yousync/v1';

// 502 et jamais 401 : un 401 de notre API déconnecterait l'admin.
const serviceError = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });

const interrupted = () => serviceError(
  'Renouvellement interrompu : la synchro continue, relancez dans quelques minutes.'
);

let rotating = false;

/** Le jeton part par les clés WooCommerce : elles doivent viser le site qu'on interroge. */
const assertSameSite = async (conn) => {
  const { rows: [cfg] } = await pool.query('SELECT woocommerce_url FROM rewards_config LIMIT 1');
  if (!cfg?.woocommerce_url) throw serviceError('Identifiants WooCommerce non configurés.', 503);
  if (new URL(cfg.woocommerce_url).host !== new URL(conn.baseUrl).host) {
    throw serviceError('Les clés WooCommerce visent un autre site que la synchro : jeton non envoyé.', 409);
  }
};

const rotate = async () => {
  if (rotating) throw serviceError('Un renouvellement est déjà en cours.', 409);
  rotating = true;

  try {
    const conn = await yousyncClient.connection();
    if (!conn) throw serviceError('La synchro n\'est pas configurée.', 503);
    await assertSameSite(conn);

    // Une tentative interrompue se reprend avec le même jeton : le site l'a peut-être déjà.
    const token = conn.pendingToken && conn.pendingToken !== conn.token
      ? conn.pendingToken
      : crypto.randomBytes(32).toString('hex');
    await appConfigModel.upsert(yousyncClient.PENDING_TOKEN_KEY, token);

    try {
      const answer = await wcRequest('post', '/token', { token }, TOKEN_ROUTE_NAMESPACE);
      if (answer?.success !== true) throw interrupted();
    } catch (err) {
      const status = err.response?.status;
      if (status >= 400 && status < 500) {
        await appConfigModel.delete(yousyncClient.PENDING_TOKEN_KEY);
        if (yousyncClient.isNoRoute(err)) throw serviceError('Le plugin yousync 2.0 n\'est pas encore en ligne.', 409);
        if (status === 409) throw serviceError('Un renouvellement vient d\'avoir lieu : réessayez dans 15 minutes.', 409);
        throw serviceError(`Le site a refusé le renouvellement (HTTP ${status}) : rien n'a changé.`);
      }
      throw err.statusCode ? err : interrupted();
    }

    try {
      await yousyncClient.health({ ...conn, token });
    } catch {
      throw interrupted();
    }

    await yousyncClient.promoteToken(token);
    console.log('🔑 Jeton yousync renouvelé');
    return { rotated: true };
  } finally {
    rotating = false;
  }
};

module.exports = { rotate };
