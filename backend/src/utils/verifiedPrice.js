const parserRegistry = require('../parsers');

/**
 * Normalise le prix d'une ligne de commande VÉRIFIÉE dans la convention attendue
 * par BMS pour ce fournisseur (cf. purchaseOrderModel.createInBMS) :
 *   - fournisseur « à l'unité » (skipPackQty : Highbuy, LCA…) → prix DU PACK.
 *     supplier_price (tarif catalogue) est prioritaire ; à défaut, prix de la
 *     pièce (unit_price ÷ units_per_qty) × pack_qty.
 *   - fournisseur normal (JoshNoa…) → prix PAR UNITÉ : unit_price ÷ units_per_qty,
 *     car une ligne comptée en lots porte le prix DU LOT (qty_ordered × unit_price
 *     = montant, qty_ordered × units_per_qty = pièces). Les anciennes lignes
 *     Levest (8 × 6,50 € par 5) donnaient sinon 6,50 € comme prix unitaire.
 *
 * Utilisé par le prefill d'import (getLastVerifiedPrices) ET par la colonne
 * « Tarif achat » de l'onglet Besoins, pour que les deux affichent la même valeur.
 *
 * @returns {number|null} prix arrondi au centime, ou null si unit_price inexploitable
 */
const normalizeVerifiedPrice = ({ supplierCode, unitPrice, packQty, supplierPrice, unitsPerQty }) => {
  const price = parseFloat(unitPrice);
  if (!Number.isFinite(price)) return null;

  const pack = parseInt(packQty) || 1;
  const catalogPrice = parseFloat(supplierPrice);

  // Toujours repartir du prix de LA PIÈCE. Une ligne comptée en packs
  // (units_per_qty > 1) porte déjà le prix du pack : la multiplier encore par le
  // pack donnait 87 € le pack de 10 Cupide (8,70 € × 10) quand le tarif
  // catalogue manquait. Import LCA 358982 et 359495 (01 et 05/10/2026) :
  // Nuance de Grey / Nuance de Rouge commandés 8,70 € LA PIÈCE, 174 € au lieu de
  // 17,40 € sur la première. Les vieilles lignes « ÷ pack_qty » (units_per_qty
  // = 1, prix déjà unitaire) retombent juste elles aussi.
  const piece = price / Math.max(parseInt(unitsPerQty) || 1, 1);
  const finalPrice = (parserRegistry.skipsPackQty(supplierCode) && pack > 1)
    ? (Number.isFinite(catalogPrice) && catalogPrice > 0 ? catalogPrice : piece * pack)
    : piece;

  return Math.round(finalPrice * 100) / 100;
};

module.exports = { normalizeVerifiedPrice };
