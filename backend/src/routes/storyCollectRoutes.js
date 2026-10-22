const express = require('express');
const pool = require('../config/database');

/*
 * Collecte PUBLIQUE des statistiques des stories (POST /api/stories-collect).
 *
 * Appelée par le lecteur du site (yv-stories.js) via navigator.sendBeacon, sans
 * session ni jeton : n'importe qui peut donc y écrire. D'où une surface réduite
 * au strict minimum — écriture seule, aucun retour de données — et des
 * contrôles serrés : types d'événements en liste blanche, champs tronqués,
 * 50 événements par envoi au plus, et un frein par adresse IP (gardée en
 * mémoire le temps de la fenêtre, jamais en base).
 *
 * sendBeacon envoie en text/plain (pas de requête préalable CORS) : le corps
 * est lu en texte puis parsé ici.
 */
const router = express.Router();

// Seul le vrai site compte comme « site ». Une copie locale ou la préproduction
// (staging.youvape.fr) passe en « preview » : le 21/10/2026, 153 événements de
// tests faits sur une copie locale étaient arrivés comme de vraies vues.
const PRODUCTION_HOSTS = new Set(['www.youvape.fr', 'youvape.fr']);
const hostOf = (url) => {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
};

const TYPES = new Set(['impression', 'open', 'view', 'progress', 'seek', 'cta_click', 'close']);
const SOURCES = new Set(['site', 'preview', 'email']);
const MAX_EVENTS = 50;
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 600; // événements par IP et par minute

const hits = new Map(); // ip → { start, count }
setInterval(() => {
  const now = Date.now();
  for (const [ip, h] of hits) if (now - h.start > WINDOW_MS) hits.delete(ip);
}, WINDOW_MS).unref();

const str = (v, max) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const int = (v, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

const device = (ua) => {
  const u = String(ua || '');
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(u)) return 'tablet';
  if (/Mobi|iPhone|Android/i.test(u)) return 'mobile';
  return 'desktop';
};

router.post('/', express.text({ type: '*/*', limit: '32kb' }), async (req, res) => {
  // Réponse immédiate et sans contenu : le navigateur n'attend rien.
  res.status(204).end();

  try {
    const ip = req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.ip || 'inconnue';
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    if (!body || !Array.isArray(body.events) || !body.events.length) return;

    const now = Date.now();
    const h = hits.get(ip) || { start: now, count: 0 };
    if (now - h.start > WINDOW_MS) { h.start = now; h.count = 0; }
    h.count += body.events.length;
    hits.set(ip, h);
    if (h.count > MAX_PER_WINDOW) return;

    let source = SOURCES.has(body.source) ? body.source : 'site';
    // sendBeacon envoie l'origine et la page appelante : on s'y fie plutôt qu'au corps.
    const from = hostOf(req.headers.origin) || hostOf(req.headers.referer);
    if (source !== 'preview' && !PRODUCTION_HOSTS.has(from)) source = 'preview';
    const session = str(body.session, 40);
    const page = str(body.page, 300);
    const dev = device(req.headers['user-agent']);

    const rows = body.events.slice(0, MAX_EVENTS)
      .filter((e) => e && TYPES.has(e.type))
      .map((e) => [
        e.type,
        str(e.story, 80),
        str(e.widget, 80),
        page,
        source,
        session,
        dev,
        e.type === 'progress' ? int(e.percent, 0, 100) : null,
        e.type === 'close' ? int(e.seconds, 0, 86400) : null,
      ]);
    if (!rows.length) return;

    const values = rows.map((_, i) => `($${i * 9 + 1}, $${i * 9 + 2}, $${i * 9 + 3}, $${i * 9 + 4}, $${i * 9 + 5}, $${i * 9 + 6}, $${i * 9 + 7}, $${i * 9 + 8}, $${i * 9 + 9})`);
    await pool.query(
      `INSERT INTO story_events (type, story_slug, widget_slug, page, source, session_id, device, percent, seconds)
       VALUES ${values.join(', ')}`,
      rows.flat(),
    );
  } catch (err) {
    // Un envoi illisible ou une panne de base ne doit jamais rien casser côté site.
    if (!(err instanceof SyntaxError)) console.error('[stories-collect]', err.message);
  }
});

module.exports = router;
