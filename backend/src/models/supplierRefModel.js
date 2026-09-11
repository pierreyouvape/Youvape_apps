const pool = require('../config/database');

/**
 * Références fournisseur (table supplier_refs).
 *
 * Un produit peut avoir plusieurs réfs chez un même fournisseur (unité, pack de 50,
 * promo 4+1…) ; une réf d'un fournisseur ne désigne qu'UN produit. L'unicité est
 * garantie en base sur la réf normalisée (index supplier_refs_supplier_sku_key) ;
 * ce modèle la rend lisible : une réf déjà prise lève REF_TAKEN avec le produit
 * qui la porte, et ne se déplace que sur demande explicite (move = true).
 *
 * Les fonctions acceptent un client de transaction optionnel (import PDF).
 */

// Même normalisation que l'index unique et que normalizeSku() de l'import PDF.
const normalizeRef = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const normalizedSql = (col) => `lower(regexp_replace(btrim(${col}), '\\s+', ' ', 'g'))`;

class RefTakenError extends Error {
  constructor(ref, owner) {
    super(`La réf. ${ref} est déjà associée à ${owner.post_title}${owner.sku ? ` (${owner.sku})` : ''}`);
    this.code = 'REF_TAKEN';
    this.owner = owner;
  }
}

const parsePackQty = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
};

const parsePrice = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const supplierRefModel = {
  normalizeRef,
  normalizedSql,
  RefTakenError,

  /** Réf (normalisée) d'un fournisseur, avec le produit qui la porte. */
  findBySku: async (supplierId, supplierSku, db = pool) => {
    const result = await db.query(`
      SELECT r.*, p.post_title, p.sku, p.wp_product_id
      FROM supplier_refs r
      JOIN products p ON p.id = r.product_id
      WHERE r.supplier_id = $1 AND ${normalizedSql('r.supplier_sku')} = $2
    `, [supplierId, normalizeRef(supplierSku)]);
    return result.rows[0] || null;
  },

  /** Réfs d'un ensemble de produits (ids internes), triées par fournisseur puis réf. */
  listByProducts: async (productIds, db = pool) => {
    if (!productIds || productIds.length === 0) return [];
    const result = await db.query(`
      SELECT id, supplier_id, product_id, supplier_sku, label, pack_qty, pack_price
      FROM supplier_refs
      WHERE product_id = ANY($1::int[])
      ORDER BY supplier_id, pack_qty, supplier_sku
    `, [productIds]);
    return result.rows;
  },

  /**
   * Crée une réf, ou la met à jour si ce produit la porte déjà.
   * Si la réf est portée par un AUTRE produit : REF_TAKEN, sauf move = true,
   * auquel cas elle est déplacée sur ce produit (et retirée de l'autre).
   * Le lien produit × fournisseur est créé au besoin.
   */
  save: async ({ supplierId, productId, supplierSku, label, packQty, packPrice, move = false }, db = pool) => {
    supplierId = parseInt(supplierId, 10);
    productId = parseInt(productId, 10);
    const sku = (supplierSku || '').trim();
    if (!sku) throw new Error('Référence fournisseur vide');

    const existing = await supplierRefModel.findBySku(supplierId, sku, db);
    if (existing && existing.product_id !== productId && !move) {
      throw new RefTakenError(sku, existing);
    }

    await db.query(`
      INSERT INTO product_suppliers (supplier_id, product_id)
      VALUES ($1, $2)
      ON CONFLICT (product_id, supplier_id) DO NOTHING
    `, [supplierId, productId]);

    // Champs non fournis → on conserve les valeurs de la réf existante.
    const values = [
      sku,
      label !== undefined ? (label || '').trim() || null : (existing ? existing.label : null),
      packQty !== undefined ? parsePackQty(packQty) : (existing ? existing.pack_qty : 1),
      packPrice !== undefined ? parsePrice(packPrice) : (existing ? existing.pack_price : null),
    ];

    if (existing) {
      // Même produit (mise à jour) ou déplacement confirmé : la réf garde son id.
      const result = await db.query(`
        UPDATE supplier_refs SET
          product_id   = $1,
          supplier_sku = $2,
          label        = $3,
          pack_qty     = $4,
          pack_price   = $5,
          updated_at   = CURRENT_TIMESTAMP
        WHERE id = $6
        RETURNING *
      `, [productId, ...values, existing.id]);
      return { ref: result.rows[0], movedFrom: existing.product_id !== productId ? existing : null };
    }

    const result = await db.query(`
      INSERT INTO supplier_refs (supplier_id, product_id, supplier_sku, label, pack_qty, pack_price)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [supplierId, productId, ...values]);
    return { ref: result.rows[0], movedFrom: null };
  },

  /**
   * Modifie une réf existante (écran produit). Changer le texte de la réf passe par
   * le même contrôle d'unicité que la création.
   */
  update: async (refId, { supplierSku, label, packQty, packPrice, move = false }, db = pool) => {
    const current = (await db.query('SELECT * FROM supplier_refs WHERE id = $1', [refId])).rows[0];
    if (!current) return null;

    const sku = supplierSku !== undefined ? (supplierSku || '').trim() : current.supplier_sku;
    if (!sku) throw new Error('Référence fournisseur vide');

    if (normalizeRef(sku) !== normalizeRef(current.supplier_sku)) {
      const existing = await supplierRefModel.findBySku(current.supplier_id, sku, db);
      if (existing && existing.id !== current.id) {
        if (existing.product_id !== current.product_id && !move) throw new RefTakenError(sku, existing);
        // Déplacement confirmé, ou doublon sur ce même produit : l'ancienne ligne
        // disparaît au profit de celle qu'on édite.
        await db.query('DELETE FROM supplier_refs WHERE id = $1', [existing.id]);
      }
    }

    const result = await db.query(`
      UPDATE supplier_refs SET
        supplier_sku = $2,
        label        = $3,
        pack_qty     = $4,
        pack_price   = $5,
        updated_at   = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [
      refId,
      sku,
      label !== undefined ? (label || '').trim() || null : current.label,
      packQty !== undefined ? parsePackQty(packQty) : current.pack_qty,
      packPrice !== undefined ? parsePrice(packPrice) : current.pack_price,
    ]);
    return result.rows[0];
  },

  remove: async (refId, db = pool) => {
    const result = await db.query('DELETE FROM supplier_refs WHERE id = $1 RETURNING *', [refId]);
    return result.rows[0] || null;
  },
};

module.exports = supplierRefModel;
