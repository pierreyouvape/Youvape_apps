/**
 * Boutiques — PDA › Produit (26/11/2026) : la fiche d'un produit boutique sur le
 * PDA (stock, ventes, arrivages) et le mouvement de stock Nextore.
 *
 * Fiche = celle de l'onglet Produits (nextoreModel.getProductDetail), plus :
 *   - le stock LU EN DIRECT dans Nextore (la copie locale date de la synchro) ;
 *   - les ventes totales (toute la base de ventes, depuis le 01/12/2023) ;
 *   - les arrivages : nos commandes boutique ouvertes + les achats « en attente »
 *     saisis dans Nextore, comme la colonne « En commande » des Besoins ;
 *   - les derniers mouvements passés depuis le PDA.
 *
 * Mouvement : motifs du PDA du site (Ajustement entrée/sortie, Défectueux
 * sortie), plus « Pour site » et « DLUO » (sortie). Envoyé à Nextore en DELTA (PUT /stocks), une ligne
 * `boutique_stock_moves` par mouvement, posée en `sending` AVANT l'appel. Une
 * erreur ne se juge jamais sur l'appel seul : on relit le stock (inchangé =
 * rien n'est passé ; avant + mouvement = passé ; autre = « VÉRIFIEZ »).
 */

const pool = require('../config/database');
const api = require('../services/nextoreApiClient');
const nextoreModel = require('./nextoreModel');

// « Pour site » et « DLUO » ajoutés le 26/11/2026 (demande Pierre), en sortie seule.
// « Pour site » ne fait que SORTIR la pièce du stock boutique : il n'entre rien au site.
const REASONS = {
  ajustement: { label: 'Ajustement', directions: ['in', 'out'] },
  defectueux: { label: 'Défectueux', directions: ['out'] },
  pour_site: { label: 'Pour site', directions: ['out'] },
  dluo: { label: 'DLUO', directions: ['out'] },
};
const REASON_LIST = Object.entries(REASONS).map(([key, r]) => ({ key, ...r }));
const MAX_QTY = 9999;

const httpError = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

/** Arrivages d'un produit dans une boutique : ce qui reste attendu, ligne par ligne. */
async function incomingFor(warehouseId, productId) {
  const { rows } = await pool.query(
    `SELECT 'commande' AS source, o.id AS order_id, o.reference, s.company AS supplier_name,
            o.created_at::text AS ordered_at, i.qty_ordered::float AS qty_ordered, i.qty_received::float AS qty_received,
            (CASE WHEN i.closed_reason IS NOT NULL THEN 0 ELSE GREATEST(i.qty_ordered - i.qty_received, 0) END)::float AS remaining,
            EXISTS (SELECT 1 FROM boutique_reception_sessions rs
                    WHERE rs.order_id = o.id AND rs.status IN ('counting', 'sending')) AS reception_open
     FROM boutique_order_items i
     JOIN boutique_orders o ON o.id = i.order_id
     LEFT JOIN nextore_suppliers s ON s.id = o.supplier_id
     WHERE o.warehouse_id = $1 AND o.status = 'open' AND i.product_id = $2
     UNION ALL
     SELECT 'nextore', NULL, pi.purchase_reference, COALESCE(sup.company, pi.supplier_name),
            pi.purchased_at::text, pi.quantity_ordered::float, COALESCE(pi.quantity_received, 0)::float,
            GREATEST(pi.quantity_ordered - COALESCE(pi.quantity_received, 0), 0)::float, FALSE
     FROM nextore_purchase_items pi
     LEFT JOIN nextore_suppliers sup ON sup.id = pi.supplier_id
     WHERE pi.status = 'pending' AND pi.warehouse_id = $1 AND pi.product_id = $2
     ORDER BY 5`,
    [warehouseId, String(productId)]
  );
  return rows.filter((r) => r.remaining > 0);
}

/** Derniers mouvements PDA d'un produit dans une boutique. */
async function listMoves(warehouseId, productId, limit = 15) {
  const { rows } = await pool.query(
    `SELECT m.id, m.reason, m.delta, m.comment, m.stock_before::float AS stock_before,
            m.stock_after::float AS stock_after, m.status, m.error, m.created_at,
            COALESCE(u.name, split_part(m.created_by, '@', 1)) AS created_by_name
     FROM boutique_stock_moves m
     LEFT JOIN LATERAL (SELECT name FROM users WHERE email = m.created_by LIMIT 1) u ON TRUE
     WHERE m.warehouse_id = $1 AND m.product_id = $2
     ORDER BY m.created_at DESC LIMIT $3`,
    [warehouseId, String(productId), limit]
  );
  return rows;
}

/** Fiche PDA d'un produit boutique. null si le produit n'existe pas. */
async function getPdaProduct(warehouseId, productId) {
  const product = await nextoreModel.getProductDetail(warehouseId, productId);
  if (!product) return null;
  const id = String(productId);
  const [live, totals, incoming, moves] = await Promise.all([
    api.getLiveStock(warehouseId, id).catch(() => null), // illisible : l'écran montre la copie locale
    pool.query(
      `SELECT COALESCE(SUM(quantity), 0)::float AS qty, MIN(sold_at)::text AS first_sale_at, MAX(sold_at)::text AS last_sale_at
       FROM nextore_sales WHERE warehouse_id = $1 AND product_id = $2`,
      [warehouseId, id]
    ),
    incomingFor(warehouseId, id),
    listMoves(warehouseId, id),
  ]);
  const { rows: [since] } = await pool.query('SELECT MIN(sold_at)::text AS since FROM nextore_sales');
  return {
    ...product,
    history: (product.history || []).slice(0, 30),
    live_stock: Number.isFinite(live) ? live : null,
    sales_total: { ...totals.rows[0], since: since?.since || null },
    incoming,
    incoming_total: incoming.reduce((a, r) => a + r.remaining, 0),
    moves,
    reasons: REASON_LIST,
  };
}

/**
 * Passe un mouvement de stock Nextore depuis le PDA. Renvoie la ligne de
 * mouvement. Refuse une sortie au-delà du stock (comme le PDA du site).
 */
async function recordMove(warehouse, productId, { reason, direction, qty, comment }, userEmail) {
  const def = REASONS[reason];
  if (!def) throw httpError(400, 'Motif inconnu');
  if (!def.directions.includes(direction)) throw httpError(400, `« ${def.label} » ne se passe qu'en sortie`);
  const n = Number(qty);
  if (!Number.isInteger(n) || n < 1 || n > MAX_QTY) throw httpError(400, 'Quantité invalide');
  const id = String(productId);
  const note = String(comment || '').trim().slice(0, 60) || null;

  const { rows: prod } = await pool.query(
    `SELECT p.name FROM nextore_products p
     JOIN nextore_stock st ON st.product_id = p.product_id AND st.warehouse_id = $2
     WHERE p.product_id = $1`,
    [id, warehouse.id]
  );
  if (!prod.length) throw httpError(404, 'Produit absent de cette boutique');

  // Stock relu EN DIRECT : c'est lui que le mouvement modifie, et lui qui tranche un échec
  let before;
  try { before = await api.getLiveStock(warehouse.id, id); } catch (e) { before = null; }
  if (!Number.isFinite(before)) throw httpError(502, 'Stock Nextore illisible : rien n\'est envoyé, réessayez');
  const delta = direction === 'in' ? n : -n;
  if (delta < 0 && before + delta < 0) {
    throw httpError(409, `Pas assez de stock : ${before} en boutique, sortie de ${n} refusée`, 'NOT_ENOUGH');
  }

  const { rows: [move] } = await pool.query(
    `INSERT INTO boutique_stock_moves (warehouse_id, product_id, reason, delta, comment, stock_before, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [warehouse.id, id, reason, delta, note, before, userEmail || null]
  );
  const reference = `PDA #${move.id} ${def.label}${note ? ` - ${note}` : ''}`.slice(0, 100);

  const finish = async (status, after, error = null) => {
    const { rows } = await pool.query(
      `UPDATE boutique_stock_moves SET status = $2, stock_after = $3, error = $4,
              sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END
       WHERE id = $1 RETURNING *`,
      [move.id, status, after, error]
    );
    // Copie locale alignée tout de suite (sinon elle attend la prochaine synchro)
    if (status === 'sent') {
      await pool.query('UPDATE nextore_stock SET stock = $3 WHERE product_id = $1 AND warehouse_id = $2', [id, warehouse.id, after]);
    }
    return rows[0];
  };

  try {
    const res = await api.putStock(id, warehouse.id, delta, reference);
    if (res === false) throw new Error('Nextore a répondu « false »');
    return finish('sent', before + delta);
  } catch (err) {
    let after = null;
    try { after = await api.getLiveStock(warehouse.id, id); } catch (e) { after = null; }
    if (Number.isFinite(after) && after === before + delta) return finish('sent', after);
    if (Number.isFinite(after) && after === before) {
      await finish('error', after, err.message);
      throw httpError(502, `Nextore a refusé le mouvement, le stock n'a pas changé : ${err.message}`);
    }
    await finish('uncertain', Number.isFinite(after) ? after : null, err.message);
    throw httpError(502, 'Réponse incertaine de Nextore : VÉRIFIEZ le stock dans Nextore avant de refaire le mouvement', 'UNCERTAIN');
  }
}

module.exports = { REASONS, getPdaProduct, recordMove, incomingFor, listMoves };
