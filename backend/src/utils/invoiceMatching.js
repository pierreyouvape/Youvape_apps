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

  const invoice = invoiceLines.map((l) => keyed(l, refProducts.get(norm(l.ref))));
  // Côté commande, la référence peut être celle du fournisseur OU, faute de
  // mieux, le SKU interne : on tente les deux pistes vers le produit.
  const order = orderLines.map((l) =>
    keyed(l, refProducts.get(norm(l.ref)) || skuProducts.get(norm(l.sku || l.ref))));

  pairLeftoversByAmount(invoice, order);
  return { invoiceLines: invoice, orderLines: order };
}

/**
 * Dernier recours : apparier sur la QUANTITÉ et le MONTANT.
 *
 * Certaines références sont illisibles quoi qu'on fasse. Sur une facture
 * Curieux de deux pages, le saut de page coupe « SPE-MACA-50-00MG » en deux et
 * place la seconde moitié APRÈS la désignation : aucune reconstitution
 * textuelle ne peut la retrouver. La ligne ressortait alors en « facturé non
 * commandé », face à son jumeau « commandé non facturé » — deux fausses
 * anomalies pour un article parfaitement conforme.
 *
 * Quand une ligne de facture et une seule ligne de commande, toutes deux encore
 * orphelines, portent la MÊME quantité et le MÊME montant, il s'agit du même
 * article. L'unicité est la condition : deux candidats, on ne devine pas.
 */
function pairLeftoversByAmount(invoiceLines, orderLines) {
  const usedKeys = new Set(invoiceLines.map((l) => norm(l.matchKey || l.ref)));
  const orderByKey = new Map(orderLines.map((l) => [norm(l.matchKey || l.ref), l]));

  const orphanInvoices = invoiceLines.filter((l) => !orderByKey.has(norm(l.matchKey || l.ref)));
  const orphanOrders = orderLines.filter((l) => !usedKeys.has(norm(l.matchKey || l.ref)));
  if (orphanInvoices.length === 0 || orphanOrders.length === 0) return;

  const amountOf = (l) => (l.lineTotalHt != null
    ? Number(l.lineTotalHt)
    : (Number(l.qty) || 0) * (Number(l.price) || 0));

  for (const inv of orphanInvoices) {
    const montant = amountOf(inv);
    if (!Number.isFinite(montant) || montant === 0) continue;

    const candidats = orphanOrders.filter((o) => !o.pairedByAmount
      && Number(o.qty) === Number(inv.qty)
      && Math.abs(amountOf(o) - montant) <= Math.max(0.02, Math.abs(montant) * 0.01));

    if (candidats.length !== 1) continue;   // ambigu : on ne devine pas
    const cible = candidats[0];
    const cle = `#montant-${cible.ref}-${cible.qty}-${montant.toFixed(2)}`;
    inv.matchKey = cle;
    cible.matchKey = cle;
    cible.pairedByAmount = true;
    inv.pairedByAmount = true;
  }
}

module.exports = { attachMatchKeys };
