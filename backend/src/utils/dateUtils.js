/**
 * Date utilities - Conversion des dates WooCommerce (Europe/Paris) vers UTC
 *
 * WooCommerce envoie les dates en heure locale du site WordPress (Europe/Paris).
 * Le serveur et PostgreSQL tournent en UTC.
 * Cette fonction convertit proprement en tenant compte de l'heure d'été/hiver.
 */

/**
 * Convertit une date WooCommerce (Europe/Paris) en UTC pour stockage en base.
 * Gère l'heure d'été (CEST = UTC+2) et l'heure d'hiver (CET = UTC+1) automatiquement.
 *
 * @param {string|null} value - Date string au format "YYYY-MM-DD HH:MM:SS" en heure Paris
 * @returns {Date|null} - Objet Date en UTC, ou null si valeur invalide
 */
function convertWCDate(value) {
  if (!value || value === '' || value === '0000-00-00 00:00:00') {
    return null;
  }

  // Interprète la chaîne comme heure Europe/Paris en la suffixant
  // avec l'info de timezone pour que le moteur JS calcule l'offset correct
  // On utilise le format ISO avec indicateur de timezone explicite via Intl
  const str = String(value).trim();

  // Remplace l'espace par T pour format ISO si nécessaire
  const isoStr = str.includes('T') ? str : str.replace(' ', 'T');

  // Crée une date en supposant que la chaîne est en Europe/Paris
  // en calculant l'offset via Intl.DateTimeFormat
  const naive = new Date(isoStr);
  if (isNaN(naive.getTime())) {
    return null;
  }

  // Calcule l'offset Europe/Paris pour cette date précise (gère l'heure d'été/hiver)
  const parisOffset = getParisTZOffset(naive);

  // Soustrait l'offset pour obtenir l'UTC réel
  return new Date(naive.getTime() - parisOffset * 60 * 1000);
}

/**
 * Retourne l'offset en minutes de Europe/Paris pour une date donnée.
 * Positif = en avance sur UTC (ex: UTC+1 → 60, UTC+2 → 120)
 */
function getParisTZOffset(date) {
  // Intl.DateTimeFormat permet d'obtenir l'heure dans un timezone donné
  const parisTime = new Date(date.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const utcTime = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  return (parisTime - utcTime) / 60000;
}

module.exports = { convertWCDate };
