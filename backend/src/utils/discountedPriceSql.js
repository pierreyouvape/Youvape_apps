/**
 * Tarif remisé TTC d'un produit, en SQL.
 *
 * `products.discounted_price` ne contient que la remise Woo Discount Rules
 * (calculée sur le prix courant, donc promo WooCommerce déjà incluse). À défaut,
 * on prend le prix promo WooCommerce : prix courant < prix normal.
 * NULL = aucune remise active.
 *
 * @param {string} alias  alias de la table products dans la requête (p, v…)
 */
const discountedPriceSql = (alias = 'p') => `COALESCE(${alias}.discounted_price,
  CASE WHEN ${alias}.price > 0 AND ${alias}.price < ${alias}.regular_price THEN ${alias}.price END)`;

module.exports = { discountedPriceSql };
