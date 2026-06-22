/**
 * Construit un libelle de variation distinguable quand le post_title WooCommerce
 * de la variation est identique a celui du produit parent (cas frequent : WC ne
 * suffixe pas toujours le nom de variation avec l'attribut). On complete alors
 * avec les valeurs d'attribut presentes dans product_attributes (ex: "10-mg").
 *
 * @param {string} postTitle - post_title de la variation
 * @param {string} parentTitle - post_title du produit parent
 * @param {object|string|null} productAttributes - colonne product_attributes (jsonb) de la variation
 * @returns {string}
 */
function buildVariationLabel(postTitle, parentTitle, productAttributes) {
  if (!postTitle || !parentTitle || postTitle.trim() !== parentTitle.trim()) {
    return postTitle;
  }

  let attrs = productAttributes;
  if (typeof attrs === 'string') {
    try {
      attrs = JSON.parse(attrs);
    } catch {
      return postTitle;
    }
  }
  if (!attrs || typeof attrs !== 'object') {
    return postTitle;
  }

  const values = Object.entries(attrs)
    .filter(([key]) => key.startsWith('attribute_'))
    .map(([, value]) => String(value).replace(/-/g, ' ').trim())
    .filter(Boolean);

  if (values.length === 0) {
    return postTitle;
  }

  return `${postTitle} - ${values.join(', ')}`;
}

module.exports = { buildVariationLabel };
