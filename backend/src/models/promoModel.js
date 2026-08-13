/**
 * Accès BDD pour l'app « Actions Promos » (préparation d'opérations promotionnelles).
 *
 * Conventions respectées (voir CLAUDE.md) :
 *  - Statuts payés : liste blanche des 6 statuts, jamais de liste noire.
 *  - products.price / regular_price / discounted_price sont TTC ; les coûts
 *    (computed_cost / wc_cog_cost) sont HT → toute marge repasse le prix en HT.
 *  - Bundles woosb : les composants génèrent des lignes à line_total = 0, on les
 *    neutralise (CA et coût) pour ne pas fausser les marges.
 */
const pool = require('../config/database');
const { buildSearchCondition } = require('../utils/searchUtils');
const { buildVariationLabel } = require('../utils/variationLabel');

const PAID_STATUSES = [
  'wc-completed', 'wc-delivered', 'wc-processing',
  'wc-awaiting-delivery', 'wc-shipped', 'wc-being-delivered',
];

/**
 * Colonnes produit « live » exposées à l'app (prix TTC, coût HT, stock).
 * Marque, sous-marque et catégories sont retombées sur le PARENT : en base,
 * aucune variation ne les porte (elles ne sont renseignées que sur les
 * `simple` / `variable`), d'où des filtres et une recherche muets sans ce COALESCE.
 * `post_title` / `sku` sont ajoutés à part : sur les lignes d'opération ils
 * retombent sur la valeur figée si le produit a disparu du catalogue.
 */
const PRODUCT_FIELDS = `
  p.product_type,
  p.stock::int                                   AS stock,
  p.stock_status,
  p.price                                        AS price,
  p.regular_price                                AS regular_price,
  p.discounted_price                             AS discounted_price,
  COALESCE(p.computed_cost, p.wc_cog_cost)       AS cost_price,
  COALESCE(p.brand, parent.brand)               AS brand,
  COALESCE(p.sub_brand, parent.sub_brand)       AS sub_brand,
  COALESCE(p.category, parent.category)         AS category,
  COALESCE(p.sub_category, parent.sub_category) AS sub_category,
  p.image_url,
  p.product_attributes,
  p.wp_parent_id,
  parent.post_title                              AS parent_title
`;

/**
 * Ventes du produit : unités des 30 derniers jours (rotation) et date de la
 * dernière vente (dormance). `last_sold` NULL = jamais vendu.
 *
 * ⚠️ Corrélé : réservé aux petits volumes (lignes d'une opération). Sur le
 * catalogue entier (~4 900 unités vendables), même indexé, il coûte plus cher
 * que l'agrégat unique `SALES_CTE` utilisé par la recherche.
 */
const SALES_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(SUM(CASE WHEN o.post_date >= NOW() - INTERVAL '30 days' THEN oi.qty ELSE 0 END), 0)::int AS qty,
      MAX(o.post_date) AS last_sold
    FROM order_items oi
    JOIN orders o ON o.wp_order_id = oi.wp_order_id
    -- Forme OR volontaire : un CASE comparé a p.wp_product_id n'utilise aucun
    -- index et declenche un parcours complet d'order_items par produit (20 s
    -- pour 16 lignes). Ici, BitmapOr sur les index product_id / variation_id.
    WHERE (oi.product_id = p.wp_product_id OR oi.variation_id = p.wp_product_id)
      AND o.post_status = ANY($SALES_STATUS_PARAM)
  ) s30 ON TRUE
`;

/**
 * Même information que `SALES_LATERAL`, mais en UN SEUL passage groupé sur
 * l'historique (~630 ms sur 884 k lignes) au lieu d'un parcours par produit.
 * Utilisé par la recherche, qui balaye tout le catalogue.
 */
const SALES_CTE = `
  sales AS (
    SELECT
      (CASE WHEN oi.variation_id > 0 THEN oi.variation_id ELSE oi.product_id END) AS wp_id,
      COALESCE(SUM(CASE WHEN o.post_date >= NOW() - INTERVAL '30 days' THEN oi.qty ELSE 0 END), 0)::int AS qty,
      MAX(o.post_date) AS last_sold
    FROM order_items oi
    JOIN orders o ON o.wp_order_id = oi.wp_order_id
    WHERE o.post_status = ANY($SALES_STATUS_PARAM)
    GROUP BY 1
  )
`;

/**
 * Quantité en arrivage : reliquat des commandes fournisseur parties mais pas
 * encore reçues. `units_per_qty` est indispensable — pour les fournisseurs qui
 * vendent au pack, `qty_ordered` compte des PACKS, pas des unités de stock
 * (voir CLAUDE.md, correctif du 2026-08-11). Mêmes statuts que le catalogue.
 */
const INCOMING_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM((poi.qty_ordered - poi.qty_received) * COALESCE(poi.units_per_qty, 1)), 0)::int AS qty
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.purchase_order_id
    WHERE poi.product_id = COALESCE(p.id, i.product_id)
      AND po.status IN ('sent', 'confirmed', 'shipped', 'partial')
  ) inc ON TRUE
`;

/** Nom lisible : les variations WC reprennent souvent le titre du parent. */
function decorate(row) {
  if (!row) return row;
  const label = row.parent_title
    ? buildVariationLabel(row.post_title, row.parent_title, row.product_attributes)
    : row.post_title;
  const { product_attributes, ...rest } = row;
  return {
    ...rest,
    display_name: label || row.post_title,
    // Regroupement des déclinaisons : clé du parent, ou le produit lui-même
    // quand il n'est pas décliné (il forme alors un groupe d'un seul élément).
    group_key: String(row.wp_parent_id || row.wp_product_id),
    group_name: row.parent_title || row.post_title,
  };
}

const promoModel = {
  /* ─── Opérations ───────────────────────────────────────────── */

  listOperations: async () => {
    const { rows } = await pool.query(
      `SELECT o.*,
              u.email AS created_by_email,
              COALESCE(i.nb, 0)::int AS items_count,
              i.avg_discount
       FROM promo_operations o
       LEFT JOIN users u ON u.id = o.created_by
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS nb, ROUND(AVG(discount_percent), 1) AS avg_discount
         FROM promo_operation_items WHERE operation_id = o.id
       ) i ON TRUE
       ORDER BY COALESCE(o.start_date, o.created_at::date) DESC, o.id DESC`
    );
    return rows;
  },

  getOperation: async (id) => {
    const { rows } = await pool.query(
      `SELECT o.*, u.email AS created_by_email
       FROM promo_operations o
       LEFT JOIN users u ON u.id = o.created_by
       WHERE o.id = $1`,
      [id]
    );
    return rows[0] || null;
  },

  createOperation: async ({ name, description, status, start_date, end_date, vat_rate, base_price_mode, created_by }) => {
    const { rows } = await pool.query(
      `INSERT INTO promo_operations
         (name, description, status, start_date, end_date, vat_rate, base_price_mode, created_by)
       VALUES ($1, $2, COALESCE($3, 'draft'), $4, $5, COALESCE($6, 20.00), COALESCE($7, 'discounted'), $8)
       RETURNING *`,
      [name, description || null, status || null, start_date || null, end_date || null,
       vat_rate ?? null, base_price_mode || null, created_by || null]
    );
    return rows[0];
  },

  updateOperation: async (id, fields) => {
    const allowed = ['name', 'description', 'status', 'start_date', 'end_date', 'vat_rate', 'base_price_mode'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        params.push(fields[key] === '' ? null : fields[key]);
        sets.push(`${key} = $${params.length}`);
      }
    }
    if (sets.length === 0) return promoModel.getOperation(id);
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE promo_operations SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length} RETURNING *`,
      params
    );
    return rows[0] || null;
  },

  deleteOperation: async (id) => {
    const { rowCount } = await pool.query('DELETE FROM promo_operations WHERE id = $1', [id]);
    return rowCount > 0;
  },

  /** Duplique une opération (produits + remises), en brouillon. */
  duplicateOperation: async (id, { name, created_by }) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: src } = await client.query('SELECT * FROM promo_operations WHERE id = $1', [id]);
      if (src.length === 0) { await client.query('ROLLBACK'); return null; }
      const o = src[0];
      const { rows: created } = await client.query(
        `INSERT INTO promo_operations
           (name, description, status, vat_rate, base_price_mode, created_by)
         VALUES ($1, $2, 'draft', $3, $4, $5) RETURNING *`,
        [name || `${o.name} (copie)`, o.description, o.vat_rate, o.base_price_mode, created_by || null]
      );
      await client.query(
        `INSERT INTO promo_operation_items
           (operation_id, wp_product_id, product_id, sku, product_name, discount_percent,
            promo_price, note, position, snap_price, snap_regular_price, snap_discounted_price,
            snap_cost, snap_stock, snapshot_at)
         SELECT $1, wp_product_id, product_id, sku, product_name, discount_percent,
                promo_price, note, position, snap_price, snap_regular_price, snap_discounted_price,
                snap_cost, snap_stock, snapshot_at
         FROM promo_operation_items WHERE operation_id = $2`,
        [created[0].id, id]
      );
      await client.query('COMMIT');
      return created[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  /* ─── Lignes produits ──────────────────────────────────────── */

  listItems: async (operationId) => {
    const sql = `
      SELECT i.id, i.operation_id, i.wp_product_id, i.product_id, i.discount_percent,
             i.promo_price, i.note, i.position,
             i.snap_price, i.snap_discounted_price, i.snap_cost, i.snap_stock, i.snapshot_at,
             COALESCE(p.sku, i.sku)                 AS sku,
             COALESCE(p.post_title, i.product_name)  AS post_title,
             ${PRODUCT_FIELDS},
             COALESCE(s30.qty, 0)                    AS sales_30d,
             s30.last_sold,
             COALESCE(inc.qty, 0)                    AS incoming_qty
      FROM promo_operation_items i
      LEFT JOIN products p ON p.wp_product_id = i.wp_product_id
      LEFT JOIN products parent ON parent.wp_product_id = p.wp_parent_id
      ${SALES_LATERAL.replace('$SALES_STATUS_PARAM', '$2')}
      ${INCOMING_LATERAL}
      WHERE i.operation_id = $1
      ORDER BY i.position, i.id
    `;
    const { rows } = await pool.query(sql, [operationId, PAID_STATUSES]);
    return rows.map(decorate);
  },

  /**
   * Ajoute des produits à une opération (idempotent : ON CONFLICT DO NOTHING).
   * Prend une photo des valeurs courantes (prix, coût, stock) pour traçabilité.
   */
  addItems: async (operationId, wpProductIds, { discount_percent = 0 } = {}) => {
    if (!Array.isArray(wpProductIds) || wpProductIds.length === 0) return 0;
    const { rows } = await pool.query(
      `INSERT INTO promo_operation_items
         (operation_id, wp_product_id, product_id, sku, product_name, discount_percent,
          position, snap_price, snap_regular_price, snap_discounted_price, snap_cost,
          snap_stock, snapshot_at)
       SELECT $1, p.wp_product_id, p.id, p.sku, p.post_title, $3,
              COALESCE((SELECT MAX(position) FROM promo_operation_items WHERE operation_id = $1), 0)
                + ROW_NUMBER() OVER (ORDER BY p.post_title),
              p.price, p.regular_price, p.discounted_price,
              COALESCE(p.computed_cost, p.wc_cog_cost), p.stock::int, NOW()
       FROM products p
       WHERE p.wp_product_id = ANY($2::bigint[])
       ON CONFLICT (operation_id, wp_product_id) DO NOTHING
       RETURNING id`,
      [operationId, wpProductIds, discount_percent]
    );
    await pool.query('UPDATE promo_operations SET updated_at = NOW() WHERE id = $1', [operationId]);
    return rows.length;
  },

  updateItem: async (operationId, itemId, fields) => {
    const allowed = ['discount_percent', 'promo_price', 'note', 'position'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        params.push(fields[key] === '' ? null : fields[key]);
        sets.push(`${key} = $${params.length}`);
      }
    }
    if (sets.length === 0) return null;
    params.push(itemId, operationId);
    const { rows } = await pool.query(
      `UPDATE promo_operation_items SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length - 1} AND operation_id = $${params.length}
       RETURNING *`,
      params
    );
    return rows[0] || null;
  },

  /**
   * Applique une remise à toutes les lignes de l'opération, ou seulement à
   * celles passées en `itemIds` (remise appliquée à un groupe de déclinaisons).
   */
  bulkDiscount: async (operationId, discountPercent, itemIds = null) => {
    const scoped = Array.isArray(itemIds) && itemIds.length > 0;
    const { rowCount } = await pool.query(
      `UPDATE promo_operation_items
       SET discount_percent = $2, promo_price = NULL, updated_at = NOW()
       WHERE operation_id = $1${scoped ? ' AND id = ANY($3::int[])' : ''}`,
      scoped ? [operationId, discountPercent, itemIds] : [operationId, discountPercent]
    );
    return rowCount;
  },

  deleteItem: async (operationId, itemId) => {
    const { rowCount } = await pool.query(
      'DELETE FROM promo_operation_items WHERE id = $1 AND operation_id = $2',
      [itemId, operationId]
    );
    return rowCount > 0;
  },

  /* ─── Recherche produits (sélecteur) ───────────────────────── */

  /**
   * Unités vendables uniquement (simple / variation / woosb) : ce sont elles qui
   * portent un prix. Les parents `variable` sont exclus (pas de prix propre).
   */
  searchProducts: async ({
    q = '', brand, subBrand, category, subCategory,
    noSaleDays = null, inStockOnly = false, limit = 60, excludeOperationId = null,
  }) => {
    const params = [];
    const where = [`p.product_type IN ('simple', 'variation', 'woosb')`, `p.post_status = 'publish'`];

    if (q && q.trim()) {
      const { clause, params: sp, nextIndex } = buildSearchCondition(
        q,
        ['p.post_title', 'p.sku', 'parent.post_title',
         'COALESCE(p.brand, parent.brand)', 'COALESCE(p.sub_brand, parent.sub_brand)'],
        params.length + 1
      );
      where.push(clause);
      params.push(...sp);
      void nextIndex;
    }
    if (brand) { params.push(brand); where.push(`COALESCE(p.brand, parent.brand) = $${params.length}`); }
    if (subBrand) { params.push(subBrand); where.push(`COALESCE(p.sub_brand, parent.sub_brand) = $${params.length}`); }
    if (category) { params.push(category); where.push(`COALESCE(p.category, parent.category) = $${params.length}`); }
    if (subCategory) { params.push(subCategory); where.push(`COALESCE(p.sub_category, parent.sub_category) = $${params.length}`); }
    if (inStockOnly) where.push('COALESCE(p.stock, 0) > 0');
    if (excludeOperationId) {
      params.push(excludeOperationId);
      where.push(`NOT EXISTS (SELECT 1 FROM promo_operation_items x
                              WHERE x.operation_id = $${params.length} AND x.wp_product_id = p.wp_product_id)`);
    }

    params.push(PAID_STATUSES);
    const statusParam = `$${params.length}`;
    params.push(Math.min(parseInt(limit, 10) || 60, 300));

    // Dormance : « non vendu depuis X jours » inclut les produits jamais vendus
    // (last_sold NULL). 'never' isole ceux qui n'ont jamais été vendus du tout.
    const dormancy = [];
    if (noSaleDays === 'never') {
      dormancy.push('s30.last_sold IS NULL');
    } else if (noSaleDays) {
      const days = parseInt(noSaleDays, 10);
      if (Number.isFinite(days) && days > 0) {
        dormancy.push(`(s30.last_sold IS NULL OR s30.last_sold < NOW() - INTERVAL '${days} days')`);
      }
    }

    const sql = `
      WITH ${SALES_CTE.replace('$SALES_STATUS_PARAM', statusParam)}
      SELECT p.wp_product_id, p.post_title, p.sku, ${PRODUCT_FIELDS},
             COALESCE(s30.qty, 0) AS sales_30d,
             s30.last_sold
      FROM products p
      LEFT JOIN products parent ON parent.wp_product_id = p.wp_parent_id
      LEFT JOIN sales s30 ON s30.wp_id = p.wp_product_id
      WHERE ${[...where, ...dormancy].join(' AND ')}
      -- Toujours le plus gros stock en tête : c'est lui qu'on cherche à écouler
      -- en promo. Les ventes 30 j départagent à stock égal.
      ORDER BY COALESCE(p.stock, 0) DESC, s30.qty DESC NULLS LAST, p.post_title
      LIMIT $${params.length}
    `;
    const { rows } = await pool.query(sql, params);
    return rows.map(decorate);
  },

  /**
   * Marques ET sous-marques, dans la forme utilisée par le catalogue
   * (`{ type, value, parent }`) : les sous-marques suivent leur marque parente,
   * ce qui permet un menu unique hiérarchisé. Lues sur les `simple` / `variable`,
   * seuls types qui portent l'information.
   */
  listBrands: async () => {
    const { rows } = await pool.query(
      `SELECT type, value, parent, nb FROM (
         SELECT 'brand' AS type, brand AS value, NULL::text AS parent, COUNT(*)::int AS nb
         FROM products
         WHERE brand IS NOT NULL AND brand <> ''
           AND product_type IN ('simple', 'variable', 'woosb') AND post_status = 'publish'
         GROUP BY brand

         UNION ALL

         SELECT 'sub_brand' AS type, sub_brand AS value, brand AS parent, COUNT(*)::int AS nb
         FROM products
         WHERE sub_brand IS NOT NULL AND sub_brand <> ''
           AND product_type IN ('simple', 'variable', 'woosb') AND post_status = 'publish'
         GROUP BY sub_brand, brand
       ) t
       ORDER BY CASE WHEN type = 'brand' THEN value ELSE parent END, type, value`
    );
    return rows;
  },

  /**
   * Catégories ET sous-catégories, même forme que les marques
   * (`{ type, value, parent }`). Contrairement aux marques, les variations les
   * portent le plus souvent : on retombe quand même sur le parent pour les ~500
   * variations qui ne les ont pas.
   */
  listCategories: async () => {
    const { rows } = await pool.query(
      `WITH sellable AS (
         SELECT COALESCE(p.category, parent.category)         AS category,
                COALESCE(p.sub_category, parent.sub_category) AS sub_category
         FROM products p
         LEFT JOIN products parent ON parent.wp_product_id = p.wp_parent_id
         WHERE p.post_status = 'publish'
           AND p.product_type IN ('simple', 'variation', 'woosb')
       )
       SELECT type, value, parent, nb FROM (
         SELECT 'category' AS type, category AS value, NULL::text AS parent, COUNT(*)::int AS nb
         FROM sellable WHERE category IS NOT NULL AND category <> ''
         GROUP BY category

         UNION ALL

         SELECT 'sub_category' AS type, sub_category AS value, category AS parent, COUNT(*)::int AS nb
         FROM sellable WHERE sub_category IS NOT NULL AND sub_category <> ''
         GROUP BY sub_category, category
       ) t
       ORDER BY CASE WHEN type = 'category' THEN value ELSE parent END, type, value`
    );
    return rows;
  },

  /* ─── Analyse avant / pendant ──────────────────────────────── */

  /**
   * Agrégats de ventes par produit sur une période [from, to[.
   *
   *  - Date de référence : `post_date` (date de commande) — c'est elle qui
   *    détermine le tarif appliqué au client, donc la période promo.
   *  - Coût : coût COURANT (computed_cost / wc_cog_cost) sur les deux périodes,
   *    pour que l'écart de marge reflète le prix et le volume, pas la dérive du PMP.
   *  - Bundles woosb : les lignes composants (line_total = 0) sont neutralisées
   *    en CA et en coût, mais comptées en unités (`qty_bundle`).
   */
  periodStats: async (wpIds, from, to) => {
    if (!Array.isArray(wpIds) || wpIds.length === 0) return [];
    const sql = `
      WITH scope AS (
        SELECT oi.id, oi.wp_order_id, oi.qty, oi.line_total, oi.line_tax,
               (CASE WHEN oi.variation_id > 0 THEN oi.variation_id ELSE oi.product_id END) AS wp_id,
               oi.product_id
        FROM order_items oi
        JOIN orders o ON o.wp_order_id = oi.wp_order_id
        WHERE o.post_status = ANY($4)
          AND o.post_date >= $2 AND o.post_date < $3
          AND (CASE WHEN oi.variation_id > 0 THEN oi.variation_id ELSE oi.product_id END) = ANY($1::bigint[])
      ),
      bundle_sub_items AS (
        -- Lignes composants d'un bundle woosb (CA porté par la ligne du pack)
        SELECT DISTINCT s.id
        FROM scope s
        JOIN order_items oib ON oib.wp_order_id = s.wp_order_id
        JOIN products pb ON pb.wp_product_id = oib.product_id
                        AND pb.product_type = 'woosb' AND pb.woosb_ids IS NOT NULL
        WHERE s.line_total = 0
          AND s.product_id::text = ANY(
            SELECT jsonb_array_elements_text(jsonb_path_query_array(pb.woosb_ids, '$[*].id'))
          )
      )
      SELECT
        s.wp_id,
        SUM(s.qty)::int                                                          AS qty_total,
        SUM(CASE WHEN b.id IS NULL THEN s.qty ELSE 0 END)::int                   AS qty_direct,
        SUM(CASE WHEN b.id IS NULL THEN COALESCE(s.line_total, 0) ELSE 0 END)    AS ca_ht,
        SUM(CASE WHEN b.id IS NULL
                 THEN COALESCE(s.line_total, 0) + COALESCE(s.line_tax, 0)
                 ELSE 0 END)                                                     AS ca_ttc,
        SUM(CASE WHEN b.id IS NULL
                 THEN s.qty * COALESCE(p.computed_cost, p.wc_cog_cost, 0)
                 ELSE 0 END)                                                     AS cost_ht,
        COUNT(DISTINCT s.wp_order_id)::int                                       AS orders_count
      FROM scope s
      LEFT JOIN bundle_sub_items b ON b.id = s.id
      LEFT JOIN products p ON p.wp_product_id = s.wp_id
      GROUP BY s.wp_id
    `;
    const { rows } = await pool.query(sql, [wpIds, from, to, PAID_STATUSES]);
    return rows;
  },

  /**
   * Vue « commande » : combien de commandes contiennent au moins un produit de
   * l'opération, et quel panier moyen — mesure l'effet d'entraînement.
   */
  periodOrderStats: async (wpIds, from, to) => {
    if (!Array.isArray(wpIds) || wpIds.length === 0) {
      return { orders_count: 0, orders_total_ttc: 0, avg_basket_ttc: 0, all_orders_count: 0, all_orders_total_ttc: 0 };
    }
    const { rows } = await pool.query(
      `WITH promo_orders AS (
         SELECT DISTINCT o.wp_order_id, o.order_total
         FROM orders o
         JOIN order_items oi ON oi.wp_order_id = o.wp_order_id
         WHERE o.post_status = ANY($4)
           AND o.post_date >= $2 AND o.post_date < $3
           AND (CASE WHEN oi.variation_id > 0 THEN oi.variation_id ELSE oi.product_id END) = ANY($1::bigint[])
       ),
       all_orders AS (
         SELECT o.wp_order_id, o.order_total
         FROM orders o
         WHERE o.post_status = ANY($4)
           AND o.post_date >= $2 AND o.post_date < $3
       )
       SELECT
         (SELECT COUNT(*) FROM promo_orders)::int                        AS orders_count,
         (SELECT COALESCE(SUM(order_total), 0) FROM promo_orders)        AS orders_total_ttc,
         (SELECT COALESCE(AVG(order_total), 0) FROM promo_orders)        AS avg_basket_ttc,
         (SELECT COUNT(*) FROM all_orders)::int                          AS all_orders_count,
         (SELECT COALESCE(SUM(order_total), 0) FROM all_orders)          AS all_orders_total_ttc`,
      [wpIds, from, to, PAID_STATUSES]
    );
    return rows[0];
  },

  /** Ventes quotidiennes (unités + CA HT) des produits de l'opération, pour la courbe. */
  dailySeries: async (wpIds, from, to) => {
    if (!Array.isArray(wpIds) || wpIds.length === 0) return [];
    const { rows } = await pool.query(
      `SELECT to_char(o.post_date::date, 'YYYY-MM-DD') AS day,
              SUM(oi.qty)::int                          AS qty,
              SUM(COALESCE(oi.line_total, 0))           AS ca_ht
       FROM order_items oi
       JOIN orders o ON o.wp_order_id = oi.wp_order_id
       WHERE o.post_status = ANY($4)
         AND o.post_date >= $2 AND o.post_date < $3
         AND (CASE WHEN oi.variation_id > 0 THEN oi.variation_id ELSE oi.product_id END) = ANY($1::bigint[])
       GROUP BY 1 ORDER BY 1`,
      [wpIds, from, to, PAID_STATUSES]
    );
    return rows;
  },
};

module.exports = promoModel;
