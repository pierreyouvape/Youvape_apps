// Construit le lien de suivi du transporteur à partir du nom du transporteur
// (ou, à défaut, de la méthode de livraison) et du n° de suivi.
export function getTrackingUrl(carrier, trackingNumber) {
  if (!carrier || !trackingNumber) return null;
  const c = carrier.toLowerCase();
  const code = encodeURIComponent(trackingNumber);
  // Chronopost (inclut Chrono Relais, Chrono 2 Shop / Shop2Shop, Chrono 13, Chrono Express…)
  if (c.includes('chrono')) {
    return `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${code}`;
  }
  if (c.includes('mondial relay') || c.includes('mondialrelay')) {
    return `https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition=${code}`;
  }
  if (c.includes('colissimo') || c.includes('la poste') || c.includes('lettre suivie') || c.includes('bpost')) {
    return `https://www.laposte.fr/outils/suivre-vos-envois?code=${code}`;
  }
  return null;
}
