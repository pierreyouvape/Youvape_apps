const parserRegistry = require('../parsers');

/**
 * Normalise le prix d'une ligne de commande VÉRIFIÉE dans la convention attendue
 * par BMS pour ce fournisseur (cf. purchaseOrderModel.createInBMS) :
 *   - fournisseur « à l'unité » (skipPackQty : Highbuy, LCA…) → prix DU PACK.
 *     supplier_price (tarif catalogue) est prioritaire car poi.unit_price de ces
 *     commandes a pu être divisé par pack_qty par d'anciennes syncs ; à défaut
 *     unit_price × pack_qty.
 *   - fournisseur normal (JoshNoa…) → prix PAR UNITÉ (unit_price tel quel).
 *
 * Utilisé par le prefill d'import (getLastVerifiedPrices) ET par la colonne
 * « Tarif achat » de l'onglet Besoins, pour que les deux affichent la même valeur.
 *
 * @returns {number|null} prix arrondi au centime, ou null si unit_price inexploitable
 */
const normalizeVerifiedPrice = ({ supplierCode, unitPrice, packQty, supplierPrice }) => {
  const price = parseFloat(unitPrice);
  if (!Number.isFinite(price)) return null;

  const pack = parseInt(packQty) || 1;
  const catalogPrice = parseFloat(supplierPrice);

  const finalPrice = (parserRegistry.skipsPackQty(supplierCode) && pack > 1)
    ? (Number.isFinite(catalogPrice) && catalogPrice > 0 ? catalogPrice : price * pack)
    : price;

  return Math.round(finalPrice * 100) / 100;
};

module.exports = { normalizeVerifiedPrice };
