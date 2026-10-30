/**
 * Client du plugin yousync, côté site.
 *
 * Tout passe par ici pour que les règles sur le jeton tiennent en un seul endroit :
 *   - il voyage uniquement dans l'en-tête `X-YouSync-Token` ;
 *   - jamais vers une adresse qui n'est pas en https : le refus du plugin
 *     arriverait trop tard, le jeton aurait déjà circulé en clair ;
 *   - aucune redirection suivie : axios garde les en-têtes personnalisés, il
 *     porterait le jeton à l'adresse indiquée par la redirection ;
 *   - jamais dans un log ni un message d'erreur.
 *
 * ⚠️ Cloudflare est devant le site : un 200 n'est pas une preuve. Une page HTML de
 * pare-feu ou de maintenance répond 200, et l'ancien code la prenait pour une file
 * vide, sans alerte (constaté le 30/10/2026). Toute réponse est contrôlée.
 */

const axios = require('axios');
const appConfigModel = require('../models/appConfigModel');

const URL_KEY = 'wc_sync_wp_url';
const TOKEN_KEY = 'wc_sync_wp_token';
const PENDING_TOKEN_KEY = 'wc_sync_wp_token_pending';

const V1 = 'yousync/v1';
const V2 = 'yousync/v2';

const READ_TIMEOUT_MS = 30000;
const ACK_TIMEOUT_MS = 20000;

const yousyncError = (code, message) => Object.assign(new Error(message), { code });

const badResponse = () => yousyncError(
  'BAD_RESPONSE',
  'Réponse inattendue du site : ce n\'est pas le JSON de yousync (pare-feu, maintenance ?)'
);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Route absente : plugin dans une version sans cette route, ou plugin inactif. */
const isNoRoute = (err) => err?.response?.status === 404 && err.response.data?.code === 'rest_no_route';

const readSetting = async (key) => (await appConfigModel.get(key))?.config_value || null;

/**
 * Adresse et jetons du site. `null` si la synchro n'est pas configurée.
 * @throws si l'adresse n'est pas en https
 */
const connection = async () => {
  const [url, token, pendingToken] = await Promise.all([
    readSetting(URL_KEY), readSetting(TOKEN_KEY), readSetting(PENDING_TOKEN_KEY),
  ]);
  if (!url || !token) return null;

  const baseUrl = url.replace(/\/$/, '');
  if (!/^https:\/\//i.test(baseUrl)) {
    throw yousyncError('URL_NOT_HTTPS', 'L\'adresse de synchro n\'est pas en https : jeton non envoyé.');
  }
  return { baseUrl, token, pendingToken };
};

const request = async (conn, method, route, { params, body, timeout = READ_TIMEOUT_MS } = {}) => {
  const { data } = await axios({
    method,
    url: `${conn.baseUrl}/wp-json/${route}`,
    params,
    data: body,
    headers: {
      'X-YouSync-Token': conn.token,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    timeout,
    maxRedirects: 0,
  });
  if (!isObject(data)) throw badResponse();
  return data;
};

const readQueueV2 = async (conn) => {
  const data = await request(conn, 'get', `${V2}/queue`);
  if (data.success !== true || !Array.isArray(data.events)) throw badResponse();
  return {
    protocol: 'v2',
    events: data.events,
    paused: data.paused === true,
    stats: isObject(data.stats) ? data.stats : {},
  };
};

const readQueueV1 = async (conn) => {
  const data = await request(conn, 'get', `${V1}/queue`);
  if (data.success !== true || !Array.isArray(data.events)) throw badResponse();
  return { protocol: 'v1', events: data.events, paused: false, stats: {} };
};

/**
 * Acquitte par identifiants de lignes, et seulement ceux lus : une ligne arrivée
 * après la lecture n'est jamais couverte.
 * @param {number[]} acked identifiants traités
 * @param {{ids: number[], code: string}[]} failed échecs, avec un CODE seulement
 */
const ackV2 = async (conn, acked, failed) => {
  const data = await request(conn, 'post', `${V2}/queue/ack`, {
    body: { acked, failed },
    timeout: ACK_TIMEOUT_MS,
  });
  if (data.success !== true) throw badResponse();
  return data;
};

const ackV1 = (conn, events) => request(conn, 'post', `${V1}/queue/ack`, {
  body: { events: events.map(({ type, wp_id: wpId }) => ({ type, wp_id: wpId })) },
  timeout: ACK_TIMEOUT_MS,
});

const health = async (conn) => {
  const data = await request(conn, 'get', `${V2}/health`);
  if (data.success !== true || typeof data.version !== 'string') throw badResponse();
  return data;
};

/** Index léger des commandes modifiées : identifiant, statut, date, aucune donnée client. */
const ordersIndex = async (conn, { since, page, perPage }) => {
  const data = await request(conn, 'get', `${V2}/orders/index`, {
    params: { since, page, per_page: perPage },
  });
  if (data.success !== true || !Array.isArray(data.orders)) throw badResponse();
  return data;
};

/** Passe au jeton en attente, une fois prouvé que le site l'accepte. */
const promoteToken = async (token) => {
  await appConfigModel.upsert(TOKEN_KEY, token);
  await appConfigModel.delete(PENDING_TOKEN_KEY);
};

module.exports = {
  PENDING_TOKEN_KEY,
  TOKEN_KEY,
  isNoRoute,
  readSetting,
  connection,
  readQueueV2,
  readQueueV1,
  ackV2,
  ackV1,
  health,
  ordersIndex,
  promoteToken,
};
