// Flux temps réel (SSE) du SAV, authentifié.
//
// EventSource ne sait pas poser d'en-tête Authorization : on demande d'abord au
// serveur, avec la session, un jeton de flux valable 2 minutes
// (POST /api/sav/stream-token), passé dans l'URL. Il ne sert qu'à OUVRIR le flux.
//
// Après une coupure, EventSource se reconnecte seul avec la même URL ; si le
// jeton a expiré entre-temps, le serveur répond 401 et EventSource abandonne
// (readyState CLOSED). On rouvre alors avec un jeton neuf.
//
// Même interface qu'un EventSource pour ce qu'on en utilise :
// addEventListener / removeEventListener / close. Les écouteurs posés avant
// l'ouverture effective sont rattachés dès que la connexion existe.
export function openSavStream(url, { reconnect = true } = {}) {
  const listeners = [];
  let es = null;
  let closed = false;
  let retry = null;

  // Échec avant toute connexion (jeton refusé…) sans reconnexion : on prévient
  // les écouteurs `error`, comme le ferait un EventSource qui échoue.
  const failNow = () => {
    listeners.filter(([type]) => type === 'error').forEach(([, fn]) => fn(new Event('error')));
  };

  const schedule = (ms) => {
    if (closed) return;
    clearTimeout(retry);
    retry = setTimeout(connect, ms);
  };

  async function connect() {
    try {
      const res = await fetch('/api/sav/stream-token', { method: 'POST' });
      const data = await res.json();
      if (closed) return;
      if (!data.success) throw new Error(data.error || 'Jeton de flux refusé');

      es = new EventSource(`${url}${url.includes('?') ? '&' : '?'}st=${encodeURIComponent(data.token)}`);
      listeners.forEach(([type, fn]) => es.addEventListener(type, fn));
      es.addEventListener('error', () => {
        if (reconnect && !closed && es.readyState === EventSource.CLOSED) schedule(5000);
      });
    } catch {
      if (closed) return;
      if (reconnect) schedule(15000);
      else failNow();
    }
  }

  connect();

  return {
    addEventListener(type, fn) {
      listeners.push([type, fn]);
      es?.addEventListener(type, fn);
    },
    removeEventListener(type, fn) {
      const i = listeners.findIndex(([t, f]) => t === type && f === fn);
      if (i >= 0) listeners.splice(i, 1);
      es?.removeEventListener(type, fn);
    },
    close() {
      closed = true;
      clearTimeout(retry);
      es?.close();
    },
  };
}
