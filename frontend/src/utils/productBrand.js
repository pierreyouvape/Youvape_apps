/**
 * Libellé de marque d'un produit, pour départager les homonymes dans les listes
 * de choix : « Fruit du Dragon - 3mg » existe chez Pulp comme chez Liquideo, et
 * le titre seul ne permet pas de trancher.
 *
 * Marque et sous-marque quand les deux existent (« Liquideo · Wpuff ») : la
 * sous-marque seule ne dit pas chez quel fournisseur commander, la marque seule
 * ne distingue pas deux gammes d'une même maison.
 *
 * Les déclinaisons n'en portent pas — c'est le parent variable qui les porte :
 * l'API de recherche fait déjà le repli (`purchasesController.searchProducts`).
 */
export function brandLabel(product) {
  if (!product) return '';
  const brand = (product.brand || '').trim();
  const subBrand = (product.sub_brand || '').trim();
  if (brand && subBrand && brand !== subBrand) return `${brand} · ${subBrand}`;
  return brand || subBrand;
}
