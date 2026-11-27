/**
 * Transferts de stock site ↔ boutiques — règles pures (testées :
 * tests/stockTransfer.test.js).
 */

const DIRECTIONS = ['site_to_shop', 'shop_to_site'];

/** Fournisseurs des commandes créées par un transfert (décision Pierre, 27/11/2026). */
// Site → boutique : commande boutique chez « SARL EMC » (Nextore), pour les deux boutiques.
const NEXTORE_SITE_SUPPLIER_ID = '33342';
// Boutique → site : commande d'achat BMS chez la boutique qui envoie (suppliers.id).
const SITE_SUPPLIER_BY_WAREHOUSE = { 1: 39, 2: 38 }; // YouVape Montpelliier, YouVape Castelnau

const round4 = (n) => Math.round(n * 10000) / 10000;
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Quantités d'une ligne. On saisit dans l'unité de l'ORIGINE : articles du site
 * pour site → boutique, pièces boutique pour boutique → site. `per` = pièces
 * boutique par article du site (5 pour une résistance vendue en « Pack 5 »).
 * → { qtySite, qtyShop } ou { error }.
 */
const lineQuantities = (direction, qty, per) => {
  const n = Number(qty);
  const p = Number(per) || 1;
  if (!Number.isInteger(n) || n < 1 || n > 9999) return { error: 'Quantité invalide : un nombre entier d\'au moins 1.' };
  if (direction === 'site_to_shop') return { qtySite: n, qtyShop: n * p };
  if (n % p !== 0) {
    return { error: `Le site vend ce produit par ${p} : envoyez un multiple de ${p} pièces (${n} ne tombe pas juste).` };
  }
  return { qtySite: n / p, qtyShop: n };
};

/** Coût HT d'une pièce boutique, depuis le coût d'un article du site. */
const shopUnitCost = (siteCost, qtySite, qtyShop) => round4((Number(siteCost) * qtySite) / qtyShop);

/** Montant HT d'une ligne (refacturation) : articles du site × coût du site. */
const lineTotal = (siteCost, qtySite) => (siteCost == null ? null : round2(Number(siteCost) * qtySite));

/**
 * Où en est la réception d'un transfert envoyé, lue sur sa commande.
 *   order = { kind: 'boutique'|'achat', status, remaining, received } (null si pas de commande)
 * → 'none' (commande pas créée) | 'waiting' | 'partial' | 'received' | 'cancelled'
 */
const receptionState = (order) => {
  if (!order) return 'none';
  if (order.status === 'cancelled') return 'cancelled';
  const received = Number(order.received) || 0;
  if (order.kind === 'boutique') {
    if (order.status === 'received') return 'received';
    return received > 0 ? 'partial' : 'waiting';
  }
  // Achat BMS : `completed` (ou `received`) = soldé ; sinon on regarde les pièces reçues
  if (order.status === 'completed' || order.status === 'received') return 'received';
  return received > 0 ? 'partial' : 'waiting';
};

/** Une ligne peut-elle encore être modifiée ? Seulement tant que le transfert est un brouillon. */
const isEditable = (transfer) => transfer && transfer.status === 'draft';

module.exports = {
  DIRECTIONS, NEXTORE_SITE_SUPPLIER_ID, SITE_SUPPLIER_BY_WAREHOUSE,
  lineQuantities, shopUnitCost, lineTotal, receptionState, isEditable, round2, round4,
};
