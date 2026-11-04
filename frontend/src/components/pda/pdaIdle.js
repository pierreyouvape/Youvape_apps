import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';

// Même adresse que pickingUi, sans l'importer : l'écran de connexion (socle)
// passe par ce module, et pickingUi y entraînerait transporteurs et pays.
const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

/**
 * Verrouillage après inactivité, pour deux sortes d'appareils :
 *   - `pda`     : les pages /pda (PdaLayout), 1 min par défaut ;
 *   - `station` : les postes de préparation, ordinateurs marqués comme tels
 *                 dans leur navigateur depuis /settings (StationLock), 10 min.
 *
 * Délais réglés dans /settings → Gestion utilisateurs (0 = jamais), relus à
 * chaque ouverture de page. Touchers, saisies et scans comptent comme activité.
 *
 * Tout est gardé dans localStorage, et c'est ce qui fait marcher les onglets
 * ensemble : une activité dans l'un compte pour tous, ils se verrouillent et se
 * déverrouillent d'un bloc (événement `storage`). Un appareil rechargé, ou sorti
 * de veille, rouvre sur l'écran verrouillé et pas sur la page de la personne
 * précédente.
 */

const KINDS = {
  pda: { prefix: 'pda', field: 'idle_minutes', fallback: 1 },
  station: { prefix: 'station', field: 'station_idle_minutes', fallback: 10 },
};
const keys = (kind) => {
  const { prefix } = KINDS[kind];
  return { last: `${prefix}LastActivity`, locked: `${prefix}Locked`, delay: `${prefix}IdleMinutes` };
};
const CHECK_MS = 5000;
const ACTIVITY = ['pointerdown', 'keydown', 'touchstart', 'wheel'];

// ── Poste de préparation : marquage propre à ce navigateur ───────────────────
const STATION_KEY = 'yv.station';
export const isStation = () => localStorage.getItem(STATION_KEY) === '1';
export const setStation = (on) => {
  if (on) localStorage.setItem(STATION_KEY, '1');
  else {
    localStorage.removeItem(STATION_KEY);
    localStorage.removeItem(keys('station').locked);
  }
};

// ── Fermeture du soir (19h30, heure de Paris), PDA comme postes ─────────────
const CUTOFF = { hour: 19, minute: 30 };

/** Millisecondes jusqu'à la prochaine 19h30 à Paris. */
export const msUntilCutoff = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map(p => [p.type, p.value]));
  const now = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  const diff = CUTOFF.hour * 3600 + CUTOFF.minute * 60 - now;
  return (diff > 0 ? diff : diff + 24 * 3600) * 1000;
};

const readMinutes = (kind) => {
  const raw = localStorage.getItem(keys(kind).delay);
  const n = Number(raw);
  return raw !== null && Number.isInteger(n) && n >= 0 ? n : KINDS[kind].fallback;
};

const isLate = (minutes, last, now = Date.now()) => minutes > 0 && now - last >= minutes * 60_000;

/** Session ouverte ou déverrouillée : on repart de zéro (dans tous les onglets). */
export const markActive = (kind) => {
  const k = keys(kind);
  localStorage.setItem(k.last, String(Date.now()));
  localStorage.removeItem(k.locked);
};

const blurActive = () => {
  // Un champ resté actif ferait remonter le clavier du téléphone sous le verrou.
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
};

/**
 * @param {'pda'|'station'} kind
 * @returns {[boolean, () => void]} verrouillé ?, déverrouiller
 */
export function useIdleLock(kind) {
  const k = keys(kind);
  const minutesRef = useRef(readMinutes(kind));
  const lastRef = useRef(Number(localStorage.getItem(k.last)) || Date.now());
  const [locked, setLocked] = useState(() =>
    localStorage.getItem(k.locked) === '1' || isLate(minutesRef.current, lastRef.current));
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  const lock = useCallback(() => {
    localStorage.setItem(k.locked, '1');
    blurActive();
    setLocked(true);
  }, [k.locked]);

  const unlock = useCallback(() => {
    markActive(kind);
    lastRef.current = Date.now();
    setLocked(false);
  }, [kind]);

  // Délai à jour (réglage modifié depuis le bureau).
  useEffect(() => {
    axios.get(`${API_URL}/users/me/pda-settings`)
      .then(({ data }) => {
        const minutes = data[KINDS[kind].field];
        if (!Number.isInteger(minutes)) return;
        minutesRef.current = minutes;
        localStorage.setItem(k.delay, String(minutes));
      })
      .catch(() => { /* hors ligne : on garde le dernier délai connu */ });
  }, [kind, k.delay]);

  useEffect(() => {
    if (locked) localStorage.setItem(k.locked, '1');
    else if (!localStorage.getItem(k.last)) localStorage.setItem(k.last, String(lastRef.current));
  }, [locked, k.locked, k.last]);

  // Activité : en mémoire à chaque fois, écrite au plus toutes les 2 s (c'est
  // cette écriture que les autres onglets reçoivent).
  useEffect(() => {
    let written = 0;
    const onActivity = () => {
      if (lockedRef.current) return;
      const now = Date.now();
      lastRef.current = now;
      if (now - written > 2000) {
        written = now;
        localStorage.setItem(k.last, String(now));
      }
    };
    ACTIVITY.forEach((t) => window.addEventListener(t, onActivity, { capture: true, passive: true }));
    return () => ACTIVITY.forEach((t) => window.removeEventListener(t, onActivity, { capture: true }));
  }, [k.last]);

  // Les autres onglets : leur activité, leur verrou, leur déverrouillage.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === k.last && e.newValue) {
        lastRef.current = Math.max(lastRef.current, Number(e.newValue) || 0);
      } else if (e.key === k.locked) {
        if (e.newValue === '1') {
          blurActive();
          setLocked(true);
        } else {
          lastRef.current = Date.now();
          setLocked(false);
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [k.last, k.locked]);

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
