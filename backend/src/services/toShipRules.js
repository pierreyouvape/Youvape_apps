/**
 * Commandes « à expédier » d'après NOTRE règle (sortie de BMS, lot 1 :
 * simulation). Fonctions pures, sans base : `tests/toShip.test.js`.
 *
 * Aujourd'hui le Picking lit la photo BMS (pickingSyncService). Après la
 * coupure, c'est cette règle qui dira quelles commandes partent, avec quels
 * articles. En attendant, elle tourne en parallèle (toShipShadowService) et
 * on compare à chaque photo : rien n'est écrit sur le site ni chez BMS.
 *
 * Une commande est à expédier si :
 *   - son statut est dans `app_config.wc_to_ship_statuses` (vide → processing) ;
 *   - elle n'a aucune étiquette active chez nous. `bms_shipments` est inutile :
 *     depuis le 01/10/2026 tout colis part de l'app (vérifié le 24/11/2026) ;
 *   - aucun remboursement n'attend la lecture de ses lignes (`lines_synced_at`
 *     NULL) : sans elles on ne sait pas ce qui reste, la commande attend ;
 *   - il lui reste au moins un article ;
 *   - payée depuis la date de début (`COALESCE(paid_date, post_date)`).
 *
 * Ses articles : lignes `line_item`, sans la ligne du pack woosb (ses
 * composants sont déjà des lignes à 0 €, Kit Essentiel compris), produits à
 * stock non suivi compris, quantité = commandée − remboursée (un pack
 * remboursé emporte ses composants), même SKU cumulé.
 */

const { withPackRefunds } = require('./pickingPdf');

const KINDS = Object.freeze({
  OURS_ONLY: 'ours_only',   // notre règle la sortirait, BMS non : le Picking l'aurait EN PLUS
  BMS_ONLY: 'bms_only',     // BMS la donne à expédier, pas nous : elle MANQUERAIT au Picking
  LINES: 'lines'            // des deux côtés, articles ou quantités différents
});

// Un écart ne compte que s'il dure : BMS prend une commande quelques minutes
// après le paiement, et notre base suit le site avec un peu de retard.
const MIN_PHOTOS = 2;
const MIN_DURATION_MS = 30 * 60 * 1000;

// À vérifier : encore à expédier plus de 3 jours après le paiement (sur 90 j,
// 3 commandes sur 10 273 au-delà, p99 = 2,4 j).
const CHECK_AFTER_MS = 3 * 24 * 3600 * 1000;

/** Statuts du réglage (`processing`, `wc-shipped`…) → statuts de `orders.post_status`. */
const wcStatuses = (statuses) => {
  const list = (Array.isArray(statuses) ? statuses : [])
    .map(s => String(s || '').trim())
    .filter(Boolean)
    .map(s => (s.startsWith('wc-') ? s : `wc-${s}`));
  return list.length ? [...new Set(list)] : ['wc-processing'];
};

/**
 * Date de début (`AAAA-MM-JJ`) → borne SQL en heure de Paris (WooCommerce
 * stocke en heure locale). Toute autre valeur : null, le service reste éteint.
 */
const sinceBound = (value) => {
  const s = String(value ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return `${s} 00:00:00`;
};

/**
 * Reste à expédier par SKU, d'après les lignes WooCommerce. Les SKU à 0 sont
 * gardés : le Picking s'en sert pour plafonner la photo BMS.
 * @param {{sku, type, qty, refunded, line_total, product_id, name, woosb_ids}[]} items
 * @returns {Map<string, number>}
 */
const remainingBySku = (items) => {
  const left = new Map();
  for (const i of withPackRefunds(items || [])) {
    if (i.type === 'woosb' || !i.sku) continue;
    const qty = Math.max(0, (Number(i.qty) || 0) - (Number(i.refunded) || 0));
    left.set(i.sku, (left.get(i.sku) || 0) + qty);
  }
  return left;
};

/** Articles à préparer : le reste à expédier, sans les SKU à 0. */
const orderLines = (items) => {
  const lines = new Map();
  for (const [sku, qty] of remainingBySku(items)) if (qty > 0) lines.set(sku, qty);
  return lines;
};

/**
 * La décision. `o` : {status, hasActiveLabel, pendingRefund, paidAt} avec
 * `paidAt` en texte `AAAA-MM-JJ HH:MM:SS` (heure de Paris, comme la base) ;
 * `since` : sinceBound() ; `lines` : orderLines().
 * @returns {boolean}
 */
const isToShip = (o, lines, { statuses, since }) => {
  if (!o || !since) return false;
  if (!wcStatuses(statuses).includes(o.status)) return false;
  if (o.hasActiveLabel) return false;
  if (o.pendingRefund) return false;
  if (!o.paidAt || String(o.paidAt) < since) return false;
  return !!lines && lines.size > 0;
};

/**
 * La photo BMS telle que le Picking l'affiche : commandes `processing`
 * seulement (`holded` est écartée de la liste), chaque ligne plafonnée par ce
 * qui reste dans WooCommerce quand la commande a un article remboursé (BMS
 * ignore les remboursements du site), lignes à 0 retirées, commande sans
 * ligne retirée. Même calcul que pickingModel.getOrdersView.
 *
 * @param {{orderNumber, status}[]} orders
 * @param {{order_number, sku, qty_to_ship}[]} lines
 * @param {Map<string, Map<string, number>>} refundedLeft - commandes à article remboursé seulement
 * @returns {Map<string, Map<string, number>>}
 */
const bmsView = (orders, lines, refundedLeft = new Map()) => {
  const keep = new Set(orders.filter(o => o.status === 'processing').map(o => String(o.orderNumber)));
  const view = new Map();
  for (const l of lines) {
    const n = String(l.order_number);
    if (!keep.has(n)) continue;
    const left = refundedLeft.get(n)?.get(l.sku);
    const qty = left === undefined ? Number(l.qty_to_ship) || 0 : Math.min(Number(l.qty_to_ship) || 0, left);
    if (qty <= 0) continue;
    if (!view.has(n)) view.set(n, new Map());
    view.get(n).set(l.sku, (view.get(n).get(l.sku) || 0) + qty);
  }
  return view;
};

/** Identité d'un écart : le même écart vu d'une photo à l'autre. */
const signatureOf = (kind, lines) =>
  `${kind}|${lines.map(l => `${l.sku}:${l.ours}/${l.bms}`).join(',')}`;

/**
 * Écarts entre notre liste et celle de BMS.
 * @param {Map<string, Map<string, number>>} ours
 * @param {Map<string, Map<string, number>>} bms
 * @returns {{orderNumber, kind, lines: {sku, ours, bms}[], signature}[]}
 */
const compare = (ours, bms) => {
  const diffs = [];
  const all = [...new Set([...ours.keys(), ...bms.keys()])].sort();
  for (const n of all) {
    const a = ours.get(n);
    const b = bms.get(n);
    const skus = [...new Set([...(a?.keys() || []), ...(b?.keys() || [])])].sort();
    const lines = skus.map(sku => ({ sku, ours: a?.get(sku) || 0, bms: b?.get(sku) || 0 }));
    let kind;
    if (a && !b) kind = KINDS.OURS_ONLY;
    else if (b && !a) kind = KINDS.BMS_ONLY;
    else if (lines.some(l => l.ours !== l.bms)) kind = KINDS.LINES;
    else continue;
    const shown = kind === KINDS.LINES ? lines.filter(l => l.ours !== l.bms) : lines;
    diffs.push({ orderNumber: n, kind, lines: shown, signature: signatureOf(kind, shown) });
  }
  return diffs;
};

/**
 * Suivi des écarts d'une photo à l'autre.
 * @param {{id, order_number, signature}[]} open - écarts ouverts en base
 * @param {object[]} current - compare() de la photo
 * @returns {{seen: number[], resolved: number[], fresh: object[]}}
 *   seen = écarts encore là, resolved = disparus, fresh = nouveaux à créer
 */
const track = (open, current) => {
  const byKey = new Map(open.map(r => [`${r.order_number}#${r.signature}`, r]));
  const seen = [];
  const fresh = [];
  for (const d of current) {
    const row = byKey.get(`${d.orderNumber}#${d.signature}`);
    if (row) {
      seen.push(row.id);
      byKey.delete(`${d.orderNumber}#${d.signature}`);
    } else {
      fresh.push(d);
    }
  }
  return { seen, resolved: [...byKey.values()].map(r => r.id), fresh };
};

/** Un écart qui dure : vu sur deux photos au moins ET pendant 30 min au moins. */
const isLasting = (row) => {
  if (!row) return false;
  const span = new Date(row.last_seen_at) - new Date(row.first_seen_at);
  return Number(row.photos_seen) >= MIN_PHOTOS && span >= MIN_DURATION_MS;
};

/**
 * À vérifier : à expédier ET payée depuis plus de 3 jours. `paidAt` et
 * `nowParis` sur la même base (heure de Paris, sans fuseau, comme la base).
 */
const needsCheck = (paidAt, nowParis) => {
  if (!paidAt || !nowParis) return false;
  return new Date(nowParis) - new Date(paidAt) > CHECK_AFTER_MS;
};

/**
 * Ce que BMS dit d'une commande que nous donnons à expédier (mail « à vérifier »).
 * @returns {'same'|'different'|'absent'}
 */
const bmsState = (ours, bms) => {
  if (!bms || bms.size === 0) return 'absent';
  const skus = new Set([...(ours?.keys() || []), ...bms.keys()]);
  for (const sku of skus) if ((ours?.get(sku) || 0) !== (bms.get(sku) || 0)) return 'different';
  return 'same';
};

module.exports = {
  KINDS, MIN_PHOTOS, MIN_DURATION_MS, CHECK_AFTER_MS,
  wcStatuses, sinceBound, remainingBySku, orderLines, isToShip, bmsView,
  compare, signatureOf, track, isLasting, needsCheck, bmsState
};
