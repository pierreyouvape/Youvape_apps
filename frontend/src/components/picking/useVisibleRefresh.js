import { useEffect, useRef } from 'react';

/**
 * Recharge tant que la page est AFFICHÉE.
 *
 * Le critère est la visibilité de l'onglet, pas le focus : un écran posé à côté
 * du poste de préparation doit rester à jour même si on clique dans une autre
 * fenêtre. Trois déclencheurs :
 *   - toutes les `intervalMs` tant que l'onglet est visible ;
 *   - au retour sur l'onglet (il était masqué, il redevient visible) ;
 *   - au retour sur la fenêtre (focus) — couvre le réveil d'un poste en veille.
 *
 * Onglet masqué : rien ne tourne, inutile d'interroger le serveur pour personne.
 *
 * @param {() => void} reload
 * @param {number} intervalMs
 */
export function useVisibleRefresh(reload, intervalMs) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const last = useRef(Date.now());

  useEffect(() => {
    const run = () => {
      last.current = Date.now();
      reloadRef.current();
    };
    const tick = () => { if (document.visibilityState === 'visible') run(); };
    // Retour sur l'onglet ou la fenêtre : on recharge, sauf si on vient de le
    // faire (les deux événements arrivent souvent ensemble).
    const onReturn = () => {
      if (document.visibilityState === 'visible' && Date.now() - last.current > 5000) run();
    };
    const id = setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
    };
  }, [intervalMs]);
}
