/**
 * Picking — la logique pure : disponibilité des commandes et découpage en vagues.
 *
 * Aucune base, aucun réseau : tout ce qui décide d'un onglet ou d'une vague est
 * ici, pour être testé à part (tests/picking.test.js).
 *
 * ── Disponibilité (même logique que la réservation BMS) ────────────────────
 * On part du STOCK PHYSIQUE (ce qui est en rayon, qui ne baisse qu'à
 * l'expédition) et on le répartit entre les commandes, la plus anciennement
 * payée d'abord. Chaque ligne prend ce qui reste, dans la limite de son besoin :
 * une commande partielle garde ce qu'elle a obtenu.
 *
 * D'où vient le physique est l'affaire de l'appelant (pickingSyncService) :
 * pendant la transition, « disponible BMS + réservé BMS » ; après BMS, notre
 * propre stock. Cette fonction n'en sait rien.
 */

const BUCKETS = Object.freeze({
  READY: 'en_cours',
  PARTIAL: 'partielle',
  OUT: 'hors_stock'
});

const byPaidDate = (a, b) => {
  const ta = a.paidAt ? new Date(a.paidAt).getTime() : Infinity;
  const tb = b.paidAt ? new Date(b.paidAt).getTime() : Infinity;
  if (ta !== tb) return ta - tb;
  return String(a.orderNumber).localeCompare(String(b.orderNumber), 'fr', { numeric: true });
};

/**
 * Répartit le stock physique entre les commandes et classe chacune.
 *
 * @param {{orderNumber: string, paidAt: ?(Date|string), lines: {sku: string, qty: number}[]}[]} orders
 * @param {Map<string, number>|Object<string, number>} physicalBySku - stock physique par SKU ;
 *        un SKU absent = inconnu de notre catalogue, donc rien à répartir
 * @returns {Map<string, {bucket: string, lines: {sku: string, qty: number, allocated: number}[]}>}
 */
const allocateStock = (orders, physicalBySku) => {
  const remaining = new Map(physicalBySku instanceof Map
    ? physicalBySku
    : Object.entries(physicalBySku || {}));

  const result = new Map();
  for (const order of [...orders].sort(byPaidDate)) {
    let needed = 0;
    let got = 0;
    const lines = order.lines.map((line) => {
      const stock = Math.max(0, Number(remaining.get(line.sku)) || 0);
      const allocated = Math.min(stock, line.qty);
      if (allocated > 0) remaining.set(line.sku, stock - allocated);
      needed += line.qty;
      got += allocated;
      return { ...line, allocated };
    });

    let bucket = BUCKETS.PARTIAL;
    if (got >= needed) bucket = BUCKETS.READY;
    else if (got === 0) bucket = BUCKETS.OUT;
    result.set(order.orderNumber, { bucket, lines });
  }
  return result;
};

/**
 * Stock physique pendant la transition : ce que BMS publie comme disponible
 * (`products.stock`) plus ce qu'il a déjà réservé aux commandes. BMS calcule
 * disponible = physique − réservé ; on remonte l'équation.
 *
 * Surtout PAS « disponible + commandé » : BMS ne réserve jamais plus qu'il n'a,
 * un manque disparaîtrait (3 en rayon, 5 commandés → 0 disponible, 3 réservés).
 *
 * @param {Map<string, number>} availableBySku - `products.stock` par SKU
 * @param {{sku: string, reserved: number}[]} reservedLines - toutes les lignes BMS réservées
 * @returns {Map<string, number>}
 */
const physicalFromBms = (availableBySku, reservedLines) => {
  const physical = new Map();
  for (const [sku, stock] of availableBySku) physical.set(sku, Number(stock) || 0);
  for (const { sku, reserved } of reservedLines) {
    if (!physical.has(sku)) continue;
    physical.set(sku, physical.get(sku) + (Number(reserved) || 0));
  }
  return physical;
};

/** Découpe une liste en paquets de `size` au plus : 58 par 10 → 10×5 + 8. */
const chunk = (items, size) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const normalize = (s) => String(s ?? '').trim().toLowerCase();

/**
 * Applique les règles, dans leur ordre de passage, aux commandes candidates.
 *
 * Les candidates sont déjà filtrées par l'appelant (onglet « En cours », sans
 * tag à corriger, non bloquées, hors vague BMS ou app). Une commande prise par
 * une règle ne l'est plus par les suivantes.
 *
 * @param {{id: number, name: string, prefix: string, maxOrders: number, priority: number,
 *          active: boolean, denominations: string[]}[]} rules
 * @param {{orderNumber: string, paidAt: ?(Date|string), shippingMethod: ?string}[]} candidates
 * @returns {{rule: object, waves: string[][]}[]} une entrée par règle ayant produit au moins une vague
 */
const planWaves = (rules, candidates) => {
  const taken = new Set();
  const plan = [];

  const ordered = rules
    .filter(r => r.active && r.maxOrders > 0)
    .sort((a, b) => (a.priority - b.priority) || (a.id - b.id));

  for (const rule of ordered) {
    const wanted = new Set((rule.denominations || []).map(normalize));
    const matching = candidates
      .filter(c => !taken.has(c.orderNumber) && wanted.has(normalize(c.shippingMethod)))
      .sort(byPaidDate);
    if (matching.length === 0) continue;

    matching.forEach(c => taken.add(c.orderNumber));
    plan.push({ rule, waves: chunk(matching.map(c => c.orderNumber), rule.maxOrders) });
  }
  return plan;
};

/** Numéro affiché d'une vague : préfixe + compteur sur 6 chiffres. */
const waveNumber = (prefix, seq) => `${String(prefix).trim().toUpperCase()}-${String(seq).padStart(6, '0')}`;

module.exports = { BUCKETS, allocateStock, physicalFromBms, planWaves, chunk, waveNumber };
