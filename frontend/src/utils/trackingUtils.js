// Construit le lien de suivi du transporteur à partir du nom du transporteur
// (ou, à défaut, de la méthode de livraison), du n° de suivi et du pays de
// livraison (utile seulement pour Mondial Relay).

// Code enseigne Mondial Relay de Youvape (= MONDIAL_RELAY_BRAND_ID côté backend).
// Indispensable dans le lien : un n° d'expédition MR à 8 chiffres n'est unique
// QUE par enseigne. Sans `ens`, la page de suivi ne peut pas identifier le colis
// et réclame le code postal du destinataire (« Erreur à la validation de la
// requête »). Le format `ens` + `exp` + `pays` est celui vers lequel MR redirige
// ses propres liens permanents (tracking.aspx / notification.aspx).
const MR_BRAND = 'LGYOUVAP';

export function getTrackingUrl(carrier, trackingNumber, country) {
  if (!carrier || !trackingNumber) return null;
  const c = carrier.toLowerCase();
  const code = encodeURIComponent(trackingNumber);
  // Chronopost (inclut Chrono Relais, Chrono 2 Shop / Shop2Shop, Chrono 13, Chrono Express…)
  if (c.includes('chrono')) {
    return `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${code}`;
  }
  if (c.includes('mondial relay') || c.includes('mondialrelay')) {
    const pays = encodeURIComponent((country || 'FR').toUpperCase());
    return `https://www.mondialrelay.fr/suivi-de-colis/?ens=${MR_BRAND}&exp=${code}&pays=${pays}&language=fr`;
  }
  if (c.includes('colissimo') || c.includes('la poste') || c.includes('lettre suivie') || c.includes('bpost')) {
    return `https://www.laposte.fr/outils/suivre-vos-envois?code=${code}`;
  }
  return null;
}
