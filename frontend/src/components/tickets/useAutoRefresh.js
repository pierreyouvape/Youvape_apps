import { useState, useEffect, useRef, useCallback } from 'react';

const STORAGE_KEY = 'sav_autorefresh_enabled';

/**
 * Autorefresh intelligent pour la liste des tickets.
 *
 * - **Temps réel (SSE)** : s'abonne à `/api/sav/stream` ; à chaque changement
 *   de ticket côté serveur, la liste se rafraîchit immédiatement (push).
 * - **Polling de secours** : poll toutes les `intervalMs` (défaut 5 min) au cas
 *   où le flux SSE saute (proxy, mise en veille). C'est un filet, pas le moteur.
 * - **Pause en arrière-plan** : ne rafraîchit pas si l'onglet navigateur est
 *   caché, et déclenche un refresh immédiat au retour sur l'onglet.
 * - **Pause conditionnelle** : si `paused` est vrai (ex. tickets sélectionnés,
 *   menu ouvert), le tick est sauté pour ne pas bouger la liste sous les doigts.
 * - **Persistance** : l'état activé/désactivé est mémorisé en localStorage.
 * - Expose `lastRefresh` (timestamp) pour afficher la fraîcheur, et `refreshNow`.
 *
 * @param {() => void} onTick      callback de refresh (ex. incrémente refreshTick)
 * @param {object} opts
 * @param {number}  opts.intervalMs  période du polling de secours en ms (défaut 5 min)
 * @param {boolean} opts.paused      suspend l'autorefresh tant que vrai
 */
export function useAutoRefresh(onTick, { intervalMs = 300000, paused = false } = {}) {
  const [enabled, setEnabled] = useState(() => {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v === 'true';
  });
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  // onTick peut changer de référence à chaque render → on le garde dans un ref
  // pour que l'intervalle n'ait pas à être recréé en permanence.
  const onTickRef = useRef(onTick);
  useEffect(() => { onTickRef.current = onTick; }, [onTick]);

  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  }, [enabled]);

  const doRefresh = useCallback(() => {
    onTickRef.current?.();
    setLastRefresh(Date.now());
  }, []);

  // Boucle de polling
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      // Sauter si onglet caché ou action en cours
      if (document.visibilityState === 'hidden') return;
      if (pausedRef.current) return;
      doRefresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs, doRefresh]);

  // Refresh immédiat au retour sur l'onglet (si activé et pas en pause)
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !pausedRef.current) {
        doRefresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled, doRefresh]);

  // Temps réel : flux SSE poussé par le serveur à chaque changement de ticket.
  // À réception d'un event `change`, on rafraîchit immédiatement (sauf si en
  // pause ou onglet caché — mêmes gardes que le polling). EventSource gère seul
  // la reconnexion automatique en cas de coupure réseau.
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource('/api/sav/stream');
    const onChange = () => {
      if (document.visibilityState === 'hidden') return;
      if (pausedRef.current) return;
      doRefresh();
    };
    es.addEventListener('change', onChange);
    return () => {
      es.removeEventListener('change', onChange);
      es.close();
    };
  }, [enabled, doRefresh]);

  return {
    enabled,
    setEnabled,
    lastRefresh,
    refreshNow: doRefresh,
    markRefreshed: () => setLastRefresh(Date.now()),
  };
}
