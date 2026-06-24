import { useState, useEffect } from 'react';

// Breakpoint mobile partagé par toute l'app Tickets.
// ≤ 768px = téléphone / petite tablette → bascule sur les layouts mobiles
// (tiroirs, cartes…). Au-delà, le rendu desktop reste strictement inchangé.
export const MOBILE_BREAKPOINT = 768;
const QUERY = `(max-width: ${MOBILE_BREAKPOINT}px)`;

/**
 * Renvoie true quand la fenêtre est en mode mobile (≤ 768px de large).
 * Réagit au redimensionnement à chaud (rotation, ouverture des devtools…).
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mql = window.matchMedia(QUERY);
    const onChange = (e) => setIsMobile(e.matches);
    // Synchronise l'état immédiatement (au cas où il aurait changé avant le montage)
    setIsMobile(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}

export default useIsMobile;
