/**
 * Produit Nextore actif DANS UNE BOUTIQUE : ni désactivé dans cette boutique
 * (nextore_stock.disabled_at, onglet Produits), ni supprimé dans Nextore (global).
 * Filtre commun à la liste, au comptage et aux besoins. Les deux boutiques n'ont
 * pas le même catalogue : la désactivation se fait boutique par boutique.
 */
const activeSql = (product = 'p', stock = 'st') =>
  `(${stock}.disabled_at IS NULL AND COALESCE(${product}.status, '') <> 'deleted')`;

module.exports = { activeSql };
