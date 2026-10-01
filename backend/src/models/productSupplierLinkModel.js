const pool = require('../config/database');

/**
 * Liens produit × fournisseur (table product_suppliers) : création, suppression
 * et mémoire des suppressions manuelles (product_supplier_exclusions).
 *
 * Deux règles, décidées le 01/10/2026 :
 *
 *   1. Un fournisseur est choisi pour un PRODUIT, pas pour un parfum. Acheter
 *      « Cartouche Dojo Blast 15K 20mg - Cerise » chez LVP rattache LVP à TOUTES
 *      les déclinaisons du parent (avant : Joshnoa 18 déclinaisons sur 22, LVP 13,
 *      LCA 8 — le filtre fournisseur de l'onglet Besoins en oubliait donc la
 *      moitié à chaque réassort).
 *
 *   2. Une suppression manuelle est définitive. BMS garde ses associations à vie
 *      et le cron de 5h10 est en INSERT seul : sans mémoire du refus, le lien
 *      revenait le lendemain matin.
 *
 * Toute source AUTOMATIQUE (cron BMS, propagation aux sœurs) doit filtrer par
 * `loadExclusions()`. Une action humaine explicite sur ce produit lève l'exclusion.
 */

/** Résout un id interne OU un wp_product_id vers l'id interne. */
const resolveProductId = async (productId, db = pool) => {
  const result = await db.query(`
    SELECT id FROM products
    WHERE id = $1 OR wp_product_id = $1
    ORDER BY CASE WHEN wp_product_id = $1 THEN 0 ELSE 1 END
    LIMIT 1
  `, [productId]);
  return result.rows[0]?.id ?? productId;
};

/**
 * Famille d'un produit = les produits qui portent le lien fournisseur.
 *   • parent variable  → ses déclinaisons (jamais le parent : un lien posé sur lui
 *                        est invisible, cf. supplierModel.getSuppliersByProduct)
 *   • déclinaison      → elle-même + ses sœurs
 *   • produit simple   → lui-même
 *
 * Les déclinaisons non publiées sont écartées (le calcul des besoins et le cron BMS
 * ne travaillent que sur `publish`), sauf si c'est la cible elle-même, et sauf si
 * AUCUNE n'est publiée : mieux vaut le comportement d'avant que zéro lien.
 */
const familyIds = async (productId, db = pool) => {
  const targetId = await resolveProductId(productId, db);
  const result = await db.query(`
    WITH cible AS (
      SELECT id, product_type, wp_product_id, wp_parent_id
      FROM products WHERE id = $1
    )
    SELECT p.id, p.post_status, (p.id = c.id) AS est_cible,
           COALESCE(c.product_type, 'simple') AS cible_type
    FROM products p, cible c
    WHERE (COALESCE(c.product_type, 'simple') = 'variable'  AND p.wp_parent_id = c.wp_product_id)
       OR (COALESCE(c.product_type, 'simple') = 'variation' AND p.wp_parent_id = c.wp_parent_id)
       OR (COALESCE(c.product_type, 'simple') NOT IN ('variable', 'variation') AND p.id = c.id)
    ORDER BY p.id
  `, [targetId]);

  if (result.rows.length === 0) return { targetId, ids: [targetId], isVariableParent: false };

  const isVariableParent = result.rows[0].cible_type === 'variable';
  const published = result.rows.filter(r => r.post_status === 'publish' || (r.est_cible && !isVariableParent));
  const kept = published.length > 0 ? published : result.rows;

  return { targetId, ids: kept.map(r => r.id), isVariableParent };
};

/** Ensemble 'supplierId:productId' des liens retirés à la main. */
const loadExclusions = async (db = pool) => {
  const result = await db.query('SELECT supplier_id, product_id FROM product_supplier_exclusions');
  return new Set(result.rows.map(r => `${r.supplier_id}:${r.product_id}`));
};

module.exports = {
  resolveProductId,
  familyIds,
  loadExclusions,

  /**
   * Rattache un fournisseur à un produit ET à ses déclinaisons sœurs (règle 1),
   * et lève l'exclusion éventuelle (règle 2 : geste humain explicite).
   *
   * La cible reçoit `data` (upsert : l'écran fait foi). Les sœurs ne sont que
   * CRÉÉES (`DO NOTHING`) : écraser un lien existant remettrait son pack_qty à 1,
   * ce qui multiplie ou divise les prix par le conditionnement à l'import
   * (bug prix ×10 des fournisseurs « à l'unité »). Elles héritent du pack_qty et
   * du mini de commande de la cible, jamais de son prix : il varie d'un parfum
   * à l'autre (7,20 € / 7,70 € chez LVP sur un même parent).
   */
  link: async ({ supplierId, productId, data = {}, db = pool }) => {
    const { targetId, ids, isVariableParent } = await familyIds(productId, db);
    if (ids.length === 0) return null;

    await db.query(
      `DELETE FROM product_supplier_exclusions WHERE supplier_id = $1 AND product_id = ANY($2::int[])`,
      [supplierId, ids]
    );

    // Un parent variable n'est jamais lui-même porteur du lien : la première
    // déclinaison sert de « cible » pour les valeurs saisies à l'écran.
    const mainId = isVariableParent ? ids[0] : targetId;

    const upsert = await db.query(`
      INSERT INTO product_suppliers (
        supplier_id, product_id, is_primary, supplier_price, min_order_qty, pack_qty
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (product_id, supplier_id) DO UPDATE SET
        is_primary = EXCLUDED.is_primary,
        supplier_price = EXCLUDED.supplier_price,
        min_order_qty = EXCLUDED.min_order_qty,
        pack_qty = EXCLUDED.pack_qty,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [
      supplierId,
      mainId,
      data.is_primary || false,
      data.supplier_price ?? null,
      data.min_order_qty || 1,
      data.pack_qty || 1,
    ]);
    const main = upsert.rows[0];

    const others = ids.filter(id => id !== mainId);
    let propagated = 0;
    if (others.length > 0) {
      const inserted = await db.query(`
        INSERT INTO product_suppliers (supplier_id, product_id, is_primary, min_order_qty, pack_qty)
        SELECT $1, id, false, $3, $4 FROM unnest($2::int[]) AS id
        ON CONFLICT (product_id, supplier_id) DO NOTHING
      `, [supplierId, others, main.min_order_qty || 1, main.pack_qty || 1]);
      propagated = inserted.rowCount;
    }

    return { ...main, propagated, family_size: ids.length };
  },

  /**
   * Retire un fournisseur d'un produit ET de ses déclinaisons sœurs, puis
   * enregistre le refus pour que rien ne le recrée (règle 2). L'exclusion est
   * posée sur toute la famille, y compris les déclinaisons qui n'avaient pas
   * encore de lien : sinon le cron BMS les rattacherait le lendemain.
   */
  unlink: async ({ supplierId, productId, db = pool }) => {
    const { ids } = await familyIds(productId, db);
    if (ids.length === 0) return null;

    const deleted = await db.query(
      `DELETE FROM product_suppliers
       WHERE supplier_id = $1 AND product_id = ANY($2::int[])
       RETURNING *`,
      [supplierId, ids]
    );

    await db.query(`
      INSERT INTO product_supplier_exclusions (supplier_id, product_id)
      SELECT $1, id FROM unnest($2::int[]) AS id
      ON CONFLICT (product_id, supplier_id) DO NOTHING
    `, [supplierId, ids]);

    return { removed: deleted.rowCount, excluded: ids.length, row: deleted.rows[0] || null };
  },

  /** Lève l'exclusion d'un seul produit (édition explicite d'un lien existant). */
  clearExclusion: async (supplierId, productId, db = pool) => {
    await db.query(
      'DELETE FROM product_supplier_exclusions WHERE supplier_id = $1 AND product_id = $2',
      [supplierId, productId]
    );
  },
};
