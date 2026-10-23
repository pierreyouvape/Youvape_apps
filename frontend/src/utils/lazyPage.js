import { lazy } from 'react';

/**
 * Un écran chargé à la demande, rangé dans son BLOC.
 *
 * Le bloc est le premier segment de l'adresse (`/pda/picking` → `pda`). Il ne
 * sert pas à l'exécution : le plugin `vite-plugin-app-versions.js` le relit dans
 * App.jsx pour calculer l'empreinte de chaque bloc, et `VersionWatcher` ne
 * prévient d'une nouvelle version que si le bloc affiché (ou le socle commun) a
 * changé. Une mise à jour de Tableau ne dérange donc plus le PDA.
 *
 * ⚠️ Toujours écrire `page('<bloc>', () => import('./pages/…'))` d'un seul
 * tenant dans App.jsx : le plugin lit cette forme exacte, et fait échouer le
 * build si un import dynamique d'App.jsx lui échappe.
 *
 * Après un déploiement, les fichiers des écrans modifiés changent de nom et les
 * anciens n'existent plus sur le serveur. Un onglet resté ouvert qui ouvre un tel
 * écran pour la première fois tombe donc sur une 404 : on recharge la page, une
 * seule fois. Sans risque pour le travail en cours — on est en train de QUITTER
 * l'écran précédent, que la navigation aurait démonté de toute façon.
 */

const CLE_RECHARGEMENT = 'youvape:rechargement-ecran';
// Une seconde 404 dans ce délai n'est plus un déploiement : on cesse de
// recharger et l'erreur remonte (EcranIndisponible propose alors le bouton).
const DELAI_ANTI_BOUCLE_MS = 30 * 1000;

function rechargerUneFois() {
  try {
    const dernier = Number(sessionStorage.getItem(CLE_RECHARGEMENT));
    if (dernier && Date.now() - dernier < DELAI_ANTI_BOUCLE_MS) return false;
    sessionStorage.setItem(CLE_RECHARGEMENT, String(Date.now()));
  } catch {
    return false; // sessionStorage bloqué : pas de garde-fou, donc pas de rechargement automatique
  }
  window.location.reload();
  return true;
}

// `bloc` n'est lu qu'au build (cf. ci-dessus), pas à l'exécution.
export function page(bloc, charger) {
  return lazy(() => charger().catch((err) => {
    // Promesse jamais résolue : la page se recharge, rien à afficher d'ici là.
    if (rechargerUneFois()) return new Promise(() => {});
    throw err;
  }));
}
