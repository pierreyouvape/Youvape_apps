import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';

// Même adresse que pickingUi, sans l'importer : l'écran de connexion (socle)
// passe par ce module, et pickingUi y entraînerait transporteurs et pays.
const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

/**
 * Verrouillage du PDA après inactivité.
 *
 * Délai réglé dans /settings → Gestion utilisateurs (`pda_idle_minutes`,
 * 0 = jamais), relu à chaque ouverture de page PDA. Touchers, saisies et scans
 * comptent comme activité.
 *
 * Tout est gardé dans localStorage : un PDA rechargé, ou sorti de veille
 * 10 minutes plus tard, rouvre sur l'écran verrouillé et pas sur la page de
 * la personne précédente.
 */

const LAST = 'pdaLastActivity';
const LOCKED = 'pdaLocked';
const DELAY = 'pdaIdleMinutes';
const DEFAULT_MINUTES = 1;
const CHECK_MS = 5000;
const ACTIVITY = ['pointerdown', 'keydown', 'touchstart', 'wheel'];

const readMinutes = () => {
  const raw = localStorage.getItem(DELAY);
  const n = Number(raw);
  return raw !== null && Number.isInteger(n) && n >= 0 ? n : DEFAULT_MINUTES;
};

const isLate = (minutes, last, now = Date.now()) => minutes > 0 && now - last >= minutes * 60_000;

/** Session ouverte ou déverrouillée : on repart de zéro. */
export const markPdaActive = () => {
  localStorage.setItem(LAST, String(Date.now()));
  localStorage.removeItem(LOCKED);
};

/** @returns {[boolean, () => void]} verrouillé ?, déverrouiller */
export function usePdaIdleLock() {
  const minutesRef = useRef(readMinutes());
  const lastRef = useRef(Number(localStorage.getItem(LAST)) || Date.now());
  const [locked, setLocked] = useState(() =>
    localStorage.getItem(LOCKED) === '1' || isLate(minutesRef.current, lastRef.current));
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  const lock = useCallback(() => {
    localStorage.setItem(LOCKED, '1');
    // Un champ resté actif ferait remonter le clavier du téléphone sous le verrou.
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    setLocked(true);
  }, []);

  const unlock = useCallback(() => {
    markPdaActive();
    lastRef.current = Date.now();
    setLocked(false);
  }, []);

  // Délai à jour (réglage modifié depuis le bureau).
  useEffect(() => {
    axios.get(`${API_URL}/users/me/pda-settings`)
      .then(({ data }) => {
        minutesRef.current = data.idle_minutes;
        localStorage.setItem(DELAY, String(data.idle_minutes));
      })
      .catch(() => { /* hors ligne : on garde le dernier délai connu */ });
  }, []);

  useEffect(() => {
    if (locked) localStorage.setItem(LOCKED, '1');
    else if (!localStorage.getItem(LAST)) localStorage.setItem(LAST, String(lastRef.current));
  }, [locked]);

  // Activité : en mémoire à chaque fois, écrite au plus toutes les 2 s.
  useEffect(() => {
    let written = 0;
    const onActivity = () => {
      if (lockedRef.current) return;
      const now = Date.now();
      lastRef.current = now;
      if (now - written > 2000) {
        written = now;
        localStorage.setItem(LAST, String(now));
      }
    };
    ACTIVITY.forEach((t) => window.addEventListener(t, onActivity, { capture: true, passive: true }));
    return () => ACTIVITY.forEach((t) => window.removeEventListener(t, onActivity, { capture: true }));
  }, []);

  // Contrôle régulier, et au retour de veille (les minuteries y sont suspendues).
  useEffect(() => {
    const check = () => {
      if (!lockedRef.current && isLate(minutesRef.current, lastRef.current)) lock();
    };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    const t = setInterval(check, CHECK_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [lock]);

  return [locked, unlock];
}
