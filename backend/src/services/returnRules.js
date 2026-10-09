/**
 * Retours client — règles pures (sans base ni BMS), testées par tests/returns.test.js.
 *
 * Cadrage validé avec Pierre le 09/10/2026 : un retour porte sur des lignes de
 * commande ; à la validation, chaque pièce reçoit une destination (remise en
 * stock, SAV fournisseur, ou rien) choisie par l'opérateur SAV.
 */

const REASONS = {
  defaut: 'Défaut',
  erreur_expedition: "Erreur d'expédition",
  retractation: 'Rétractation',
  non_recupere: 'Commande non récupérée',
};

const OUTCOMES = {
  renvoi: 'Renvoi',
  points: 'Points fidélité',
  remboursement: 'Remboursement',
  aucune: 'Aucune',
};

const httpError = (status, message) => Object.assign(new Error(message), { statusCode: status });

const round2 = (n) => Math.round(n * 100) / 100;

/** Prix payé TTC d'une pièce de la ligne (remises comprises). */
const unitPaid = (line) => {
  const qty = Number(line.qty) || 0;
  if (!qty) return 0;
  return round2((Number(line.line_total || 0) + Number(line.line_tax || 0)) / qty);
};

/**
 * Rattache les composants d'un pack woosb à leur pack.
 *
 * WooCommerce écrit le pack (avec le prix), puis chacun de ses composants à
 * 0 €, juste derrière. Un composant se reconnaît donc à sa position, à son prix
 * nul et à son produit (ou sa déclinaison) listé dans `woosb_ids` du pack.
 *
 * @param {Array<{order_item_id, product_id, variation_id, line_total, product_type, woosb_ids}>} lines
 *   triées par order_item_id
 * @returns {Map<order_item_id, order_item_id du pack>}
 */
const bundleParents = (lines) => {
  const parents = new Map();
  let current = null;
  for (const l of lines) {
    if (l.product_type === 'woosb') {
      const ids = (Array.isArray(l.woosb_ids) ? l.woosb_ids : []).map(c => String(c.id));
      current = { id: l.order_item_id, ids: new Set(ids) };
      continue;
    }
    const free = Number(l.line_total || 0) === 0;
    const listed = current && (current.ids.has(String(l.product_id)) || current.ids.has(String(l.variation_id)));
    if (current && free && listed) parents.set(l.order_item_id, current.id);
    else current = null;
  }
  return parents;
};

/**
 * Lignes à créer pour une sélection. Cocher un pack emporte ses composants au
 * prorata (2 packs sur 3 → les 2/3 de chaque composant) : c'est sur eux que
 * se fait la remise en stock. Un composant peut aussi être retourné seul.
 *
 * @param {Array} lines  lignes de la commande, avec `returnable` (quantité encore retournable)
 * @param {Array<{orderItemId, qty}>} selection
 * @returns {Array<{line, qty, bundleOf: ?order_item_id}>}
 */
const expandSelection = (lines, selection) => {
  const byId = new Map(lines.map(l => [String(l.order_item_id), l]));
  const parents = bundleParents(lines);
  const chosen = new Map();

  for (const s of selection || []) {
    const qty = Number(s.qty);
    if (!qty) continue;
    const line = byId.get(String(s.orderItemId));
    if (!line) throw httpError(400, `Ligne ${s.orderItemId} absente de la commande.`);
    if (!Number.isInteger(qty) || qty < 0) throw httpError(400, `Quantité invalide pour « ${line.name} ».`);
    chosen.set(String(line.order_item_id), qty);
  }

  const out = [];
  for (const line of lines) {
    const key = String(line.order_item_id);
    if (line.product_type === 'woosb') {
      const qty = chosen.get(key);
      if (!qty) continue;
      if (qty > line.returnable) throw httpError(400, `« ${line.name} » : ${line.returnable} au plus.`);
      out.push({ line, qty, bundleOf: null });
      for (const comp of lines.filter(c => parents.get(c.order_item_id) === line.order_item_id)) {
        const compQty = Math.min(comp.returnable, Math.round((comp.qty * qty) / line.qty));
        if (compQty > 0) out.push({ line: comp, qty: compQty, bundleOf: line.order_item_id });
      }
      continue;
    }
    const parent = parents.get(line.order_item_id);
    // Composant d'un pack coché : déjà pris avec lui.
    if (parent && chosen.get(String(parent))) continue;
    const qty = chosen.get(key);
    if (!qty) continue;
    if (qty > line.returnable) throw httpError(400, `« ${line.name} » : ${line.returnable} au plus.`);
    out.push({ line, qty, bundleOf: null });
  }

  if (!out.length) throw httpError(400, 'Aucun article sélectionné.');
  return out;
};

/**
 * Contrôle la destination des pièces d'une ligne à la validation.
 * Toutes les pièces doivent en avoir une ; sans retour exigé, rien ne
 * revient : on ne peut rien remettre en stock.
 */
const checkDestination = (line, d, returnRequired) => {
  const restock = Number(d?.restock) || 0;
  const supplier = Number(d?.supplier) || 0;
  const noRestock = Number(d?.noRestock) || 0;
  const name = line.name || line.sku;
  for (const n of [restock, supplier, noRestock]) {
    if (!Number.isInteger(n) || n < 0) throw httpError(400, `« ${name} » : quantité invalide.`);
  }
  if (restock + supplier + noRestock !== line.qty) {
    throw httpError(400, `« ${name} » : ${line.qty} pièce(s) à répartir, ${restock + supplier + noRestock} réparties.`);
  }
  if (restock && !returnRequired) throw httpError(400, `« ${name} » : pas de retour exigé, rien à remettre en stock.`);
  if (restock && !line.sku) throw httpError(400, `« ${name} » : produit sans SKU, BMS ne le connaît pas.`);
  if (supplier && !d.supplierId) throw httpError(400, `« ${name} » : choisir le fournisseur.`);
  if (supplier && !String(d.problem || '').trim()) throw httpError(400, `« ${name} » : décrire le problème.`);
  if (supplier && !line.product_id) throw httpError(400, `« ${name} » : produit inconnu du catalogue.`);
  return { restock, supplier, noRestock };
};

/**
 * Statut d'un retour, déduit de ce qui a été fait. La validation (colis reçu)
 * et l'issue client sont indépendantes : on peut renvoyer avant d'avoir reçu.
 * Le retour n'est « traité » qu'une fois les deux faites.
 */
const returnStatus = ({ cancelled_at, received_at, treated_at }) => {
  if (cancelled_at) return 'annule';
  if (received_at && treated_at) return 'traite';
  if (received_at) return 'recu';
  return 'attente';
};

/**
 * Fournisseur le plus probable d'une pièce : celui du dernier lot reçu AVANT
 * le paiement de la commande client (le stock part dans l'ordre d'arrivée).
 * À défaut, le dernier lot reçu tout court.
 *
 * @param {Array<{supplier_id, last_received}>} receipts  un lot reçu par ligne
 * @param {string|Date} paidAt
 */
const suggestSupplier = (receipts, paidAt) => {
  if (!receipts?.length) return null;
  const t = (d) => (d ? new Date(d).getTime() : 0);
  const sorted = [...receipts].sort((a, b) => t(b.last_received) - t(a.last_received));
  const before = paidAt ? sorted.find(r => t(r.last_received) <= t(paidAt)) : null;
  return (before || sorted[0]).supplier_id;
};

module.exports = {
  REASONS,
  OUTCOMES,
  unitPaid,
  bundleParents,
  expandSelection,
  checkDestination,
  returnStatus,
  suggestSupplier,
};
