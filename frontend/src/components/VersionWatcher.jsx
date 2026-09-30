import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Prévient quand une nouvelle version de l'app est déployée.
 *
 * LE CACHE N'EST PAS EN CAUSE, et c'est pour ça que « vider le cache à chaque
 * page » ne réglerait rien. nginx sert déjà `index.html` en
 * `no-cache, no-store, must-revalidate`, et les fichiers de `/assets/` portent un
 * hash dans leur nom : un rechargement ramène toujours la dernière version, et
 * un fichier de code n'est jamais servi périmé.
 *
 * Le vrai problème est ailleurs : cette app est une SPA. Passer d'un écran à
 * l'autre ne déclenche AUCUN chargement de page — React Router change l'affichage
 * sans rien redemander au serveur. Un onglet ouvert le matin exécute donc le code
 * du matin jusqu'au soir, quels que soient les écrans visités entre-temps. C'est
 * exactement ce qui fait lire « Montant » à quelqu'un alors que la colonne
 * s'appelle « Montant TTC » depuis deux heures.
 *
 * Forcer un rechargement complet à chaque changement d'écran le corrigerait, au
 * prix fort : l'app deviendrait lente, et surtout on PERDRAIT LE TRAVAIL EN
 * COURS — un comptage de réception sur la tablette du dépôt, une commande à
 * moitié saisie. Inacceptable.
 *
 * On relit donc `index.html` — non mis en cache, donc toujours frais — et on y
 * lit le nom du bundle. S'il diffère de celui que cette page exécute, c'est qu'un
 * déploiement a eu lieu : on le DIT, et l'utilisateur recharge quand il n'a rien
 * en cours. Jamais de rechargement d'autorité.
 */

/** Le bundle que CETTE page exécute, lu dans sa propre balise script. */
function bundleCourant() {
  const el = document.querySelector('script[type="module"][src*="/assets/"]');
  return el?.getAttribute('src') || null;
}

/** Le bundle que le serveur sert MAINTENANT. `null` si la question n'aboutit pas. */
async function bundleServi() {
  try {
    const rep = await fetch(`/index.html?v=${Date.now()}`, { cache: 'no-store' });
    if (!rep.ok) return null;
    const html = await rep.text();
    return html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0] || null;
  } catch {
    // Hors ligne, ou serveur qui redémarre pendant un déploiement : on retentera.
    return null;
  }
}

// Toutes les cinq minutes. Assez souvent pour qu'un déploiement se voie dans la
// foulée, assez rare pour rester invisible — une requête de 1 Ko.
const INTERVALLE_MS = 5 * 60 * 1000;

export default function VersionWatcher() {
  const [nouvelleVersion, setNouvelleVersion] = useState(false);
  const { pathname } = useLocation();

  const verifier = useCallback(async () => {
    const courant = bundleCourant();
    if (!courant) return;                    // dev (pas de bundle) : rien à surveiller
    const servi = await bundleServi();
    if (servi && servi !== courant) setNouvelleVersion(true);
  }, []);

  // À chaque changement d'écran, et à intervalle régulier pour celui qui reste
  // une journée sur le même.
  useEffect(() => {
    verifier();
    const t = setInterval(verifier, INTERVALLE_MS);
    return () => clearInterval(t);
  }, [verifier, pathname]);

  if (!nouvelleVersion) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)',
      zIndex: 99999, display: 'flex', alignItems: 'center', gap: 14,
      background: '#135E84', color: '#fff', padding: '12px 18px',
      borderRadius: 10, boxShadow: '0 8px 26px rgba(0,0,0,0.28)',
      fontSize: 14, fontFamily: 'inherit', maxWidth: 'calc(100vw - 32px)',
    }}>
      <span>
        Une <strong>nouvelle version</strong> de l'app est disponible.
      </span>
      <button
        onClick={() => window.location.reload()}
        style={{
          background: '#E28F00', color: '#fff', border: 'none', borderRadius: 7,
          padding: '7px 14px', fontWeight: 700, fontSize: 13.5, cursor: 'pointer',
          fontFamily: 'inherit', whiteSpace: 'nowrap',
        }}
      >
        Recharger
      </button>
      {/* Refusable : on ne recharge pas la tablette d'un magasinier au milieu
          d'un comptage. Le rappel reviendra au prochain changement d'écran. */}
      <button
        onClick={() => setNouvelleVersion(false)}
        title="Plus tard"
        style={{
          background: 'transparent', color: 'rgba(255,255,255,0.75)', border: 'none',
          fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '0 2px',
        }}
      >
        ×
      </button>
    </div>
  );
}
