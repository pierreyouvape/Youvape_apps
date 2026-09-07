/**
 * Traduction des erreurs d'API transporteur en message pour le packing.
 *
 * Deux publics, deux textes, et c'est volontaire : la personne au comptoir a
 * besoin de savoir s'il faut réessayer ou appeler la technique, pas de lire un
 * corps JSON. Le message technique reste transmis à part, en `details`.
 *
 * Extrait de `controllers/laposteController` (lot 0). Le nom du transporteur
 * devient un paramètre, le reste des cas est commun : un timeout, une 5xx, une
 * réponse HTML ou un jeton expiré se présentent partout de la même façon.
 */

/**
 * @param {Error & {statusCode?: number, nonJson?: boolean}} error
 * @param {string} [carrierLabel] - nom du transporteur tel qu'affiché à l'écran
 * @returns {string|null} message destiné au packing, ou null si aucun cas connu
 *          ne s'applique — l'appelant retombe alors sur le message générique.
 */
const buildUserMessage = (error, carrierLabel = 'Le transporteur') => {
  const code = error.statusCode;
  if (error.message && error.message.includes('Timeout')) {
    return carrierLabel + ' ne répond pas (délai dépassé). Réessayez dans quelques instants.';
  }
  if (code === 503 || code === 502 || code === 504) {
    return carrierLabel + ' est temporairement indisponible (erreur ' + code + '). Réessayez dans quelques instants — si ça persiste, prévenez le service technique.';
  }
  if (error.nonJson) {
    return carrierLabel + ' a renvoyé une réponse inattendue (erreur ' + (code || '?') + '). Réessayez dans quelques instants.';
  }
  if (code === 401) {
    return 'Authentification ' + carrierLabel + ' expirée. Réessayez — le jeton va être renouvelé automatiquement.';
  }
  return null;
};

module.exports = { buildUserMessage };
