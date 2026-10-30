/**
 * Contrôle de forme de ce qui arrive du site, avant toute écriture.
 *
 * Le site est une source extérieure : ce qu'il envoie n'est pas digne de
 * confiance par principe. Une ligne dont la forme ne va pas est refusée entière
 * et signalée dans l'acquittement (`INVALID_PAYLOAD`), jamais écrite à moitié.
 *
 * Renvoie `null` si l'événement est valide, sinon le nom du premier champ en
 * cause. Jamais sa valeur : le motif part dans les logs et les alertes, qui ne
 * doivent contenir aucune donnée client.
 */

const TYPES = ['order', 'product', 'customer', 'refund'];
const ACTIONS = ['create', 'update', 'delete'];

const isId = (v) => Number.isSafeInteger(v) && v > 0;
const isNumber = (v) => (typeof v === 'number' && Number.isFinite(v))
  || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
const isText = (v) => typeof v === 'string';
const isTextOrNull = (v) => v === null || v === undefined || typeof v === 'string';
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isDate = (v) => v === null || v === undefined || (typeof v === 'string' && !Number.isNaN(Date.parse(v.replace(' ', 'T'))));
const isListOrAbsent = (v) => v === undefined || v === null || Array.isArray(v);

const checkLines = (lines, name, check) => {
  if (!isListOrAbsent(lines)) return name;
  for (const line of lines || []) {
    if (!isObject(line)) return name;
    const reason = check(line);
    if (reason) return `${name}.${reason}`;
  }
  return null;
};

const checkOrderItem = (item) => {
  if (!Number.isSafeInteger(item.product_id) || item.product_id < 0) return 'product_id';
  if (!isNumber(item.quantity)) return 'quantity';
  if (!isNumber(item.subtotal)) return 'subtotal';
  if (!isNumber(item.total)) return 'total';
  if (!isNumber(item.tax)) return 'tax';
  if (!isText(item.name)) return 'name';
  return null;
};

const checkOrder = (wpId, d) => {
  if (d.wp_order_id !== wpId) return 'wp_order_id';
  if (!isText(d.status) || !/^[a-z0-9_-]{1,40}$/.test(d.status)) return 'status';
  if (d.customer_id !== null && d.customer_id !== undefined && !isId(d.customer_id)) return 'customer_id';
  for (const field of ['total', 'total_tax', 'shipping_total', 'discount_total']) {
    if (!isNumber(d[field])) return field;
  }
  for (const field of ['date_created', 'date_modified', 'date_paid']) {
    if (!isDate(d[field])) return field;
  }
  return checkLines(d.items, 'items', checkOrderItem)
    || checkLines(d.coupon_items, 'coupon_items', (l) => (isText(l.name) ? null : 'name'))
    || checkLines(d.fee_items, 'fee_items', (l) => (isText(l.name) ? null : 'name'))
    || checkLines(d.tax_items, 'tax_items', (l) => (isNumber(l.tax_amount) ? null : 'tax_amount'));
};

const checkProduct = (wpId, d) => {
  if (d.wp_product_id !== wpId) return 'wp_product_id';
  if (!isText(d.type) || !isText(d.name) || !isText(d.status)) return 'type';
  if (d.parent_id !== null && d.parent_id !== undefined && !Number.isSafeInteger(d.parent_id)) return 'parent_id';
  if (!isTextOrNull(d.sku)) return 'sku';
  if (!isDate(d.date_created) || !isDate(d.date_modified)) return 'date';
  if (!isListOrAbsent(d.variations)) return 'variations';
  for (const variation of d.variations || []) {
    if (!isObject(variation)) return 'variations';
    const reason = checkProduct(variation.wp_product_id, variation);
    if (reason || !isId(variation.wp_product_id)) return `variations.${reason || 'wp_product_id'}`;
  }
  return null;
};

const checkCustomer = (wpId, d) => {
  if (d.wp_customer_id !== wpId) return 'wp_customer_id';
  if (!isText(d.email) || !isTextOrNull(d.first_name) || !isTextOrNull(d.last_name)) return 'identity';
  return isDate(d.date_created) ? null : 'date_created';
};

const checkRefund = (wpId, d) => {
  if (d.wp_refund_id !== wpId) return 'wp_refund_id';
  if (!isId(d.wp_order_id)) return 'wp_order_id';
  if (!isNumber(d.refund_amount)) return 'refund_amount';
  return isDate(d.refund_date) ? null : 'refund_date';
};

const CHECKS = { order: checkOrder, product: checkProduct, customer: checkCustomer, refund: checkRefund };

/**
 * @param {object} event événement de la file
 * @param {string} protocol 'v1' | 'v2'
 * @returns {string|null} champ en cause, ou null
 */
const validateEvent = (event, protocol = 'v2') => {
  if (!isObject(event)) return 'event';
  const { type, action, wp_id: wpId, data, gone } = event;
  if (!TYPES.includes(type)) return 'type';
  if (!ACTIONS.includes(action)) return 'action';
  if (!isId(wpId)) return 'wp_id';

  if (protocol === 'v2') {
    if (!Array.isArray(event.ids) || event.ids.length === 0 || !event.ids.every(isId)) return 'ids';
    if (gone === true) return null;
    if (action === 'delete') return 'action';
  }

  // Notre base est une archive : aucune suppression de commande ni de client ne
  // se propage. Produits et remboursements ont leur traitement propre.
  if (action === 'delete') return type === 'order' || type === 'customer' ? 'action' : null;

  if (!isObject(data)) return 'data';
  // Mise à jour de stock seule, format v1 : pas de fiche complète.
  if (protocol === 'v1' && type === 'product' && !data.name && !data.type) {
    return data.stock_quantity === undefined ? 'data' : null;
  }
  return CHECKS[type](wpId, data);
};

module.exports = { validateEvent };
