/**
 * Produit Nextore actif : ni désactivé chez nous (onglet Produits), ni supprimé
 * dans Nextore. Filtre commun à la liste, au comptage et aux besoins.
 */
const activeSql = (alias = 'p') =>
  `(${alias}.disabled_at IS NULL AND COALESCE(${alias}.status, '') <> 'deleted')`;

module.exports = { activeSql };
