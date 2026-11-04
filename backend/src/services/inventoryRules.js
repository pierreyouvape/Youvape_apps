/**
 * Règles de l'Inventaire, sans base ni BMS (testées dans tests/inventory.test.js).
 */

const { aggregateWaveLines } = require('./pickingPlanner');

// Décision Pierre (06/10/2026) : on recompte si l'écart atteint 5 pièces ET
// dépasse 15 % du théorique. Théorique à 0 : moins de 5 trouvés, c'est bon.
const RECOUNT_MIN_PIECES = 5;
const RECOUNT_MIN_RATIO = 0.15;

const needsRecount = (counted, theoretical) => {
  const gap = Math.abs(counted - theoretical);
  return gap >= RECOUNT_MIN_PIECES && gap > RECOUNT_MIN_RATIO * Math.max(theoretical, 0);
};

/** « E 2-2-13 » → « E » ; « Sans emplacement » ('') → ''. */
const aisleOf = (location) => String(location || '').trim().split(/[\s-]/)[0].toUpperCase();

/** Tri naturel des emplacements, « Sans emplacement » en dernier. */
const compareLocations = (a, b) => {
  if (!a !== !b) return a ? -1 : 1;
  return String(a).localeCompare(String(b), 'fr', { numeric: true });
};

/**
 * Prélevé dans une vague et pas encore expédié, par produit : ce qui n'est
 * plus en rayon mais compte encore dans le physique BMS (décrémenté à
 * l'expédition seulement).
 *
 * Le picking est global : on sait combien de pièces la vague a prises, pas
 * pour quelle commande. On retient donc le plus petit de « pris » et de « dû
 * aux commandes pas encore parties ».
 *
 * @param {{orderNumber, lines}[]} unshippedOrders - commandes actives non expédiées de la vague
 * @param {{line_key, product_id, picked}[]} waveLines - lignes figées de la vague
 * @returns {Map<number, number>} product_id → pièces
 */
const pickedNotShipped = (unshippedOrders, waveLines) => {
  const due = new Map(aggregateWaveLines(unshippedOrders).map(l => [l.lineKey, l.qtyNeeded]));
  const result = new Map();
  for (const l of waveLines) {
    if (!l.product_id) continue;
    const qty = Math.min(l.picked, due.get(l.line_key) || 0);
    if (qty > 0) result.set(l.product_id, (result.get(l.product_id) || 0) + qty);
  }
  return result;
};

/**
 * Écart d'une référence (lot 2). La quantité retenue est celle du recomptage
 * s'il y en a eu un (il fait foi), sinon la somme de ses emplacements ; le
 * théorique est le physique BMS relevé moins le prélevé non expédié.
 *
 * @param {{status, recount_qty, counted, ref_physical, ref_picked}} item
 * @returns {{counted: number, theoretical: number, gap: number}}
 */
const gapOf = (item) => {
  const counted = item.status === 'recounted' ? Number(item.recount_qty) || 0 : Number(item.counted) || 0;
  const theoretical = Math.max(0, (Number(item.ref_physical) || 0) - (Number(item.ref_picked) || 0));
  return { counted, theoretical, gap: counted - theoretical };
};

/** Mouvement BMS qui corrige un écart : entrée si on a trouvé plus, sortie sinon. */
const movementFor = (gap) => {
  if (!gap) return null;
  return { direction: gap > 0 ? 'in' : 'out', qty: Math.abs(gap) };
};

// ── Inventaire par emplacement (04/11/2026) ─────────────────────────────────

/** Ce qui doit être en rayon : physique BMS − prélevé non expédié, jamais négatif. */
const theoreticalOf = (physical, picked) => Math.max(0, (Number(physical) || 0) - (Number(picked) || 0));

/**
 * Une ligne attendue qu'il faut avoir vue avant de valider l'emplacement :
 * elle avait du stock (les produits à 0 restent à 0 si on n'y touche pas),
 * n'est pas engagée dans un inventaire classique, et BMS la connaît.
 */
const mustBeSeen = (line) => !line.added && !line.locked_by_inventory && !line.ref_error
  && Number(line.shown_qty) > 0 && line.qty == null && line.outcome !== 'moved';

/**
 * Le mail de l'emplacement ne retient que deux cas (décision Pierre du
 * 04/11/2026) : tombé à 0, ou trouvé alors qu'il était à 0.
 * @returns {'to_zero'|'from_zero'|null}
 */
const zeroChange = (theoretical, qty) => {
  if (theoretical == null || qty == null) return null;
  if (theoretical > 0 && qty === 0) return 'to_zero';
  if (theoretical === 0 && qty > 0) return 'from_zero';
  return null;
};

module.exports = {
  RECOUNT_MIN_PIECES, RECOUNT_MIN_RATIO, needsRecount, aisleOf, compareLocations, pickedNotShipped, gapOf, movementFor,
  theoreticalOf, mustBeSeen, zeroChange,
};
