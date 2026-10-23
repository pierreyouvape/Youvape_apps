/**
 * Purge du cache du site après une publication des stories.
 *
 * Le site (mu-plugin youvape-stories) relit index.json toutes les 5 min et sert
 * des pages mises en cache (WP Rocket + Cloudflare APO) : /videos, /videos/<slug>,
 * le sitemap vidéo, les fiches produit et les pages qui portent un widget. Sans
 * le prévenir, une publication peut rester invisible longtemps. Ce service
 * appelle POST <site>/wp-json/youvape-stories/v1/purge, sans corps : le site
 * relit index.json et calcule lui-même ce qu'il faut purger.
 *
 * Configuration (.env du VPS, jamais dans le code ni dans les journaux) :
 *   YVS_SITE_URL               https://www.youvape.fr (branché directement en production,
 *                              pas de staging : décision du 23/10/2026)
 *   YVS_STORIES_PURGE_SECRET   secret partagé, fourni par le site
 *
 * ⚠️ Le site n'est joignable proprement qu'en IPv4 depuis le VPS : en IPv6,
 * l'hébergeur répond une page anti-robot (« One moment, please… ») en HTTP 200.
 * Le backend (conteneur Docker) sort en IPv4 ; d'où la règle ci-dessous : un
 * 2xx ne vaut succès que si le site répond du JSON avec `ok: true`.
 *
 * Règles (demande du site, 22/10/2026) :
 *  - appel APRÈS l'écriture d'index.json sur R2, un seul par publication ;
 *  - délai 30 s ; erreur réseau, 502 (le site n'a pas pu lire index.json) ou
 *    5xx : nouvel essai après 5 s, 30 s puis 2 min ;
 *  - 401 (mauvais secret) ou 503 (purge non configurée côté site) : pas de
 *    nouvel essai, on journalise et on le signale ;
 *  - un échec n'annule JAMAIS la publication : le site la voit au plus tard
 *    5 min après, quand son propre cache expire.
 */
const axios = require('axios');

const TIMEOUT_MS = 30 * 1000;
let RETRY_DELAYS_MS = [5 * 1000, 30 * 1000, 2 * 60 * 1000];
/** Tests seulement : raccourcir l'attente entre deux essais. */
const setRetryDelaysForTests = (delays) => { RETRY_DELAYS_MS = delays; };

const config = () => ({
  baseUrl: String(process.env.YVS_SITE_URL || '').trim().replace(/\/+$/, ''),
  secret: String(process.env.YVS_STORIES_PURGE_SECRET || '').trim(),
});

const isConfigured = () => {
  const c = config();
  return Boolean(c.baseUrl && c.secret);
};

/** Ce qu'on garde de la réponse du site (jamais les en-têtes : ils portent le secret). */
const summarize = (body) => {
  if (!body || typeof body !== 'object') return { raw: String(body || '').slice(0, 500) };
  return {
    ok: body.ok,
    stories: body.stories,
    urls: Array.isArray(body.urls) ? body.urls : body.urls ?? null,
    wp_rocket: body.wp_rocket ?? null,
    cloudflare: body.cloudflare ?? null,
  };
};

/** Un appel. → { kind: 'ok' | 'retry' | 'fatal', status, result?, error? } */
const callOnce = async () => {
  const c = config();
  const headers = { 'User-Agent': 'YouvapeApps-Stories/1.0', Authorization: `Bearer ${c.secret}` };
  try {
    const res = await axios.post(`${c.baseUrl}/wp-json/youvape-stories/v1/purge`, null, {
      headers,
      timeout: TIMEOUT_MS,
      validateStatus: () => true,
      maxRedirects: 0,
    });
    const status = res.status;
    if (status >= 200 && status < 300) {
      // Seul un JSON avec ok: true prouve la purge. Une page HTML en 200 (page
      // anti-robot de l'hébergeur, page d'erreur mise en cache) n'en est pas une.
      if (!res.data || typeof res.data !== 'object') {
        return { kind: 'retry', status, error: `Réponse du site illisible (HTTP ${status}, pas du JSON : page anti-robot ?)` };
      }
      const result = summarize(res.data);
      if (result.ok !== true) {
        return { kind: 'fatal', status, result, error: 'Le site a répondu sans confirmer la purge (ok ≠ true)' };
      }
      return { kind: 'ok', status, result };
    }
    const detail = typeof res.data === 'object' ? (res.data.message || res.data.code || '') : '';
    if (status === 401) return { kind: 'fatal', status, error: `Secret refusé par le site (401)${detail ? ` : ${detail}` : ''}` };
    if (status === 404) return { kind: 'fatal', status, error: "Adresse de purge absente du site (404) : l'endpoint n'est pas déployé" };
    if (status === 503) return { kind: 'fatal', status, error: `Purge non configurée côté site (503)${detail ? ` : ${detail}` : ''}` };
    if (status === 502) return { kind: 'retry', status, error: `Le site n'a pas pu lire index.json (502)${detail ? ` : ${detail}` : ''}` };
    if (status >= 500) return { kind: 'retry', status, error: `Erreur du site (${status})${detail ? ` : ${detail}` : ''}` };
    return { kind: 'fatal', status, error: `Réponse inattendue du site (${status})${detail ? ` : ${detail}` : ''}` };
  } catch (err) {
    // Erreur réseau ou délai dépassé : le message d'axios ne contient pas les en-têtes.
    return { kind: 'retry', status: null, error: err.code === 'ECONNABORTED' ? 'Délai de 30 s dépassé' : `Erreur réseau : ${err.code || err.message}` };
  }
};

const log = (attempt, outcome) => {
  const where = config().baseUrl;
  if (outcome.kind === 'ok') {
    const r = outcome.result;
    console.log(`[stories/purge] ${where} essai ${attempt} OK :`, JSON.stringify({
      ok: r.ok, stories: r.stories, urls: r.urls, wp_rocket: r.wp_rocket, cloudflare: r.cloudflare,
    }).slice(0, 4000));
  } else {
    console.error(`[stories/purge] ${where} essai ${attempt} ${outcome.kind === 'retry' ? 'échoué, nouvel essai prévu' : 'ÉCHEC'} : ${outcome.error}`);
  }
};

/**
 * Purge après une publication. Le premier essai est attendu (≤ 30 s), pour que
 * l'écran dise tout de suite si le cache a été vidé ; les nouveaux essais
 * éventuels tournent en arrière-plan et rapportent leur issue à `onFinal`.
 *
 * Renvoie { status: 'ok' | 'retrying' | 'failed' | 'skipped', attempts, error?, result? }.
 */
const purgeAfterPublish = async ({ onFinal } = {}) => {
  if (!isConfigured()) {
    return { status: 'skipped', attempts: 0, error: 'Purge du site non configurée sur le serveur de l’app' };
  }
  const first = await callOnce();
  log(1, first);
  if (first.kind === 'ok') return { status: 'ok', attempts: 1, http: first.status, result: first.result };
  if (first.kind === 'fatal') return { status: 'failed', attempts: 1, http: first.status, error: first.error, result: first.result };

  // Nouvel essai en arrière-plan : la réponse à l'écran n'attend pas 2 min et demie.
  (async () => {
    let last = first;
    let attempt = 1;
    for (const delay of RETRY_DELAYS_MS) {
      await new Promise((resolve) => { setTimeout(resolve, delay).unref?.(); });
      attempt += 1;
      last = await callOnce();
      log(attempt, last);
      if (last.kind !== 'retry') break;
    }
    const final = last.kind === 'ok'
      ? { status: 'ok', attempts: attempt, http: last.status, result: last.result }
      : { status: 'failed', attempts: attempt, http: last.status, error: last.error, result: last.result };
    if (final.status === 'failed') {
      console.error(`[stories/purge] abandon après ${attempt} essais : ${final.error}`);
    }
    try { await onFinal?.(final); } catch (err) { console.error('[stories/purge] enregistrement du résultat :', err.message); }
  })();

  return { status: 'retrying', attempts: 1, http: first.status, error: first.error };
};

module.exports = { purgeAfterPublish, isConfigured, callOnce, setRetryDelaysForTests };
