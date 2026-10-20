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
function attributeValues(productAttributes) {
  let attrs = productAttributes;
  if (typeof attrs === 'string') {
    try {
      attrs = JSON.parse(attrs);
    } catch {
      return [];
    }
  }
  if (!attrs || typeof attrs !== 'object') {
    return [];
  }

  return Object.entries(attrs)
    .filter(([key]) => key.startsWith('attribute_'))
    .map(([, value]) => decodeSlug(String(value))
      .replace(/-/g, ' ')
      .replace(/ω/g, 'Ω')                          // le slug a mis Ω en minuscule
      .replace(/(\d) (\d+) (Ω|ohm)/gi, '$1.$2 $3') // « 0 30 Ω » → « 0.30 Ω »
      .trim())
    .filter(Boolean);
}

// Un slug WooCommerce encode ses caractères non-ASCII pour les URL
// (« Ω » → « %cf%89 », mis en minuscule) : on le décode avant affichage.
function decodeSlug(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function buildVariationLabel(postTitle, parentTitle, productAttributes) {
  if (!postTitle || !parentTitle || postTitle.trim() !== parentTitle.trim()) {
    return postTitle;
  }

  const values = attributeValues(productAttributes);
  if (values.length === 0) {
    return postTitle;
  }

  return `${postTitle} - ${values.join(', ')}`;
}

/**
 * Declinaison seule, pour la preparation (PDA, bon de vague, packing) : le nom
 * d'une ligne de commande est souvent celui du parent (« Cartouches CLK One »),
 * et deux declinaisons rangees au meme emplacement ne se distinguaient plus
 * (commande 1267607 : 10 mg pris pour 20 mg). Ex. "Ice tea peche · 20mg".
 *
 * @param {object|string|null} productAttributes - product_attributes de la variation
 * @returns {string|null}
 */
function variantText(productAttributes) {
  const values = attributeValues(productAttributes)
    .map(v => v.charAt(0).toUpperCase() + v.slice(1));
  return values.length ? values.join(' · ') : null;
}

module.exports = { buildVariationLabel, variantText };
