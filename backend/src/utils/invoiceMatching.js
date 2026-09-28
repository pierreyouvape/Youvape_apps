/**
 * Sur quoi une ligne de facture et une ligne de commande se reconnaissent.
 *
 * La référence imprimée ne suffit pas. 611 lignes de commande (3 % du total)
 * portent le SKU interne du produit faute de référence fournisseur dans BMS :
 * confrontées à une facture qui, elle, utilise la référence du fournisseur,
 * elles fabriquent une fausse paire « commandé non facturé » +
 * « facturé non commandé » qui se compensent presque — et le vrai écart se perd
 * au milieu.
 *
 * On passe donc par le PRODUIT quand on sait le résoudre : `supplier_refs`
 * traduit une référence fournisseur en produit, `products.sku` fait de même
 * pour le SKU interne. Les deux côtés retombent alors sur la même clé.
 *
 * La référence AFFICHÉE reste celle du document : la clé ne sert qu'à apparier.
 */

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * @param {Array} invoiceLines  lignes lues sur la facture
 * @param {Array} orderLines    lignes de la commande (BMS), avec `ref` et `sku`
 * @param {Map}   refProducts   référence fournisseur normalisée → id produit
 * @param {Map}   skuProducts   SKU interne normalisé → id produit
 */
function attachMatchKeys({ invoiceLines = [], orderLines = [], refProducts = new Map(), skuProducts = new Map() }) {
  const keyed = (line, productId) =>
    productId ? { ...line, productId, matchKey: `#produit-${productId}` } : { ...line };

  return {
    invoiceLines: invoiceLines.map((l) => keyed(l, refProducts.get(norm(l.ref)))),
    // Côté commande, la référence peut être celle du fournisseur OU, faute de
    // mieux, le SKU interne : on tente les deux pistes vers le produit.
    orderLines: orderLines.map((l) =>
      keyed(l, refProducts.get(norm(l.ref)) || skuProducts.get(norm(l.sku || l.ref)))),
  };
}

module.exports = { attachMatchKeys };
