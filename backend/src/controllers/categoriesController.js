const pool = require('../config/database');

// Statuts de commande considérés comme "ventes valides"
const VALID_ORDER_STATUSES = ['wc-completed', 'wc-delivered', 'wc-being-delivered', 'wc-wms_cp_delivered', 'wc-processing'];

/**
 * Récupère toutes les catégories avec stats agrégées
 * GET /api/categories
 */
exports.getAll = async (req, res) => {
  try {
    const query = `
      WITH category_products AS (
        SELECT DISTINCT
          p.category,
          p.wp_product_id,
          p.product_type
        FROM products p
        WHERE p.category IS NOT NULL
          AND p.product_type IN ('simple', 'variable', 'woosb')
          AND p.post_status = 'publish'
      ),
      product_family AS (
        SELECT
          cp.category,
          cp.wp_product_id as parent_id,
          COALESCE(v.wp_product_id, cp.wp_product_id) as product_id
        FROM category_products cp
        LEFT JOIN products v ON v.wp_parent_id = cp.wp_product_id AND v.product_type = 'variation'
      ),
      category_stats AS (
        SELECT
          pf.category,
          SUM(oi.qty)::int as qty_sold,
          COALESCE(SUM(oi.line_total), 0) as ca_ttc,
          COALESCE(SUM(oi.line_subtotal), 0) as ca_ht,
          COALESCE(SUM(oi.qty * COALESCE(oi.item_cost, 0)), 0) as cost_ht
        FROM product_family pf
        LEFT JOIN order_items oi ON (oi.product_id = pf.product_id OR oi.variation_id = pf.product_id)
        LEFT JOIN orders o ON o.wp_order_id = oi.wp_order_id
          AND o.post_status = ANY($1)
        GROUP BY pf.category
      )
      SELECT
        c.category,
        COUNT(DISTINCT cp.wp_product_id)::int as product_count,
        (SELECT COUNT(DISTINCT p2.sub_category) FROM products p2 WHERE p2.category = c.category AND p2.sub_category IS NOT NULL)::int as sub_category_count,
        COALESCE(cs.qty_sold, 0) as qty_sold,
        COALESCE(cs.ca_ttc, 0) as ca_ttc,
        COALESCE(cs.ca_ht, 0) as ca_ht,
        COALESCE(cs.cost_ht, 0) as cost_ht,
        COALESCE(cs.ca_ht, 0) - COALESCE(cs.cost_ht, 0) as margin_ht,
        CASE WHEN COALESCE(cs.ca_ht, 0) > 0
          THEN ((COALESCE(cs.ca_ht, 0) - COALESCE(cs.cost_ht, 0)) / COALESCE(cs.ca_ht, 0) * 100)
          ELSE 0
        END as margin_percent
      FROM (SELECT DISTINCT category FROM products WHERE category IS NOT NULL) c
      LEFT JOIN category_products cp ON cp.category = c.category
      LEFT JOIN category_stats cs ON cs.category = c.category
      GROUP BY c.category, cs.qty_sold, cs.ca_ttc, cs.ca_ht, cs.cost_ht
      ORDER BY ca_ttc DESC NULLS LAST
    `;

    const result = await pool.query(query, [VALID_ORDER_STATUSES]);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error getting categories:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère toutes les sous-catégories avec stats
 * GET /api/categories/sub-categories
 */
exports.getAllSubCategories = async (req, res) => {
  try {
    const query = `
      WITH sub_category_products AS (
        SELECT DISTINCT
          p.sub_category,
          p.category,
          p.wp_product_id,
          p.product_type
        FROM products p
        WHERE p.sub_category IS NOT NULL
          AND p.product_type IN ('simple', 'variable', 'woosb')
          AND p.post_status = 'publish'
      ),
      product_family AS (
        SELECT
          scp.sub_category,
          scp.category,
          scp.wp_product_id as parent_id,
          COALESCE(v.wp_product_id, scp.wp_product_id) as product_id
        FROM sub_category_products scp
        LEFT JOIN products v ON v.wp_parent_id = scp.wp_product_id AND v.product_type = 'variation'
      ),
      sub_category_stats AS (
        SELECT
          pf.sub_category,
          SUM(oi.qty)::int as qty_sold,
          COALESCE(SUM(oi.line_total), 0) as ca_ttc,
          COALESCE(SUM(oi.line_subtotal), 0) as ca_ht,
          COALESCE(SUM(oi.qty * COALESCE(oi.item_cost, 0)), 0) as cost_ht
        FROM product_family pf
        LEFT JOIN order_items oi ON (oi.product_id = pf.product_id OR oi.variation_id = pf.product_id)
        LEFT JOIN orders o ON o.wp_order_id = oi.wp_order_id
          AND o.post_status = ANY($1)
        GROUP BY pf.sub_category
      )
      SELECT
        sc.sub_category,
        sc.category,
        COUNT(DISTINCT scp.wp_product_id)::int as product_count,
        COALESCE(scs.qty_sold, 0) as qty_sold,
        COALESCE(scs.ca_ttc, 0) as ca_ttc,
        COALESCE(scs.ca_ht, 0) as ca_ht,
        COALESCE(scs.cost_ht, 0) as cost_ht,
        COALESCE(scs.ca_ht, 0) - COALESCE(scs.cost_ht, 0) as margin_ht,
        CASE WHEN COALESCE(scs.ca_ht, 0) > 0
          THEN ((COALESCE(scs.ca_ht, 0) - COALESCE(scs.cost_ht, 0)) / COALESCE(scs.ca_ht, 0) * 100)
          ELSE 0
        END as margin_percent
      FROM (SELECT DISTINCT sub_category, category FROM products WHERE sub_category IS NOT NULL) sc
      LEFT JOIN sub_category_products scp ON scp.sub_category = sc.sub_category
      LEFT JOIN sub_category_stats scs ON scs.sub_category = sc.sub_category
      GROUP BY sc.sub_category, sc.category, scs.qty_sold, scs.ca_ttc, scs.ca_ht, scs.cost_ht
      ORDER BY ca_ttc DESC NULLS LAST
    `;

    const result = await pool.query(query, [VALID_ORDER_STATUSES]);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error getting sub-categories:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère une catégorie par son nom avec sous-catégories et produits
 * GET /api/categories/:categoryName
 */
exports.getByName = async (req, res) => {
  try {
    const categoryName = decodeURIComponent(req.params.categoryName);

    // Récupérer les sous-catégories de cette catégorie avec leurs stats
    const subCategoriesQuery = `
      WITH sub_category_products AS (
        SELECT DISTINCT
          p.sub_category,
          p.wp_product_id,
          p.product_type
        FROM products p
        WHERE p.category = $1
          AND p.sub_category IS NOT NULL
          AND p.product_type IN ('simple', 'variable', 'woosb')
          AND p.post_status = 'publish'
      ),
      product_family AS (
        SELECT
          scp.sub_category,
          scp.wp_product_id as parent_id,
          COALESCE(v.wp_product_id, scp.wp_product_id) as product_id
        FROM sub_category_products scp
        LEFT JOIN products v ON v.wp_parent_id = scp.wp_product_id AND v.product_type = 'variation'
      ),
      sub_category_stats AS (
        SELECT
          pf.sub_category,
          SUM(oi.qty)::int as qty_sold,
          COALESCE(SUM(oi.line_total), 0) as ca_ttc,
          COALESCE(SUM(oi.line_subtotal), 0) as ca_ht,
          COALESCE(SUM(oi.qty * COALESCE(oi.item_cost, 0)), 0) as cost_ht
        FROM product_family pf
        LEFT JOIN order_items oi ON (oi.product_id = pf.product_id OR oi.variation_id = pf.product_id)
        LEFT JOIN orders o ON o.wp_order_id = oi.wp_order_id
          AND o.post_status = ANY($2)
        GROUP BY pf.sub_category
      )
      SELECT
        sc.sub_category,
        COUNT(DISTINCT scp.wp_product_id)::int as product_count,
        COALESCE(scs.qty_sold, 0) as qty_sold,
        COALESCE(scs.ca_ttc, 0) as ca_ttc,
        COALESCE(scs.ca_ht, 0) as ca_ht,
        COALESCE(scs.cost_ht, 0) as cost_ht,
        COALESCE(scs.ca_ht, 0) - COALESCE(scs.cost_ht, 0) as margin_ht,
        CASE WHEN COALESCE(scs.ca_ht, 0) > 0
          THEN ((COALESCE(scs.ca_ht, 0) - COALESCE(scs.cost_ht, 0)) / COALESCE(scs.ca_ht, 0) * 100)
          ELSE 0
        END as margin_percent
      FROM (SELECT DISTINCT sub_category FROM products WHERE category = $1 AND sub_category IS NOT NULL) sc
      LEFT JOIN sub_category_products scp ON scp.sub_category = sc.sub_category
      LEFT JOIN sub_category_stats scs ON scs.sub_category = sc.sub_category
      GROUP BY sc.sub_category, scs.qty_sold, scs.ca_ttc, scs.ca_ht, scs.cost_ht
      ORDER BY ca_ttc DESC NULLS LAST
    `;

    const subCategoriesResult = await pool.query(subCategoriesQuery, [categoryName, VALID_ORDER_STATUSES]);

    // Récupérer les produits de cette catégorie SANS sous-catégorie (produits "directs")
    const productsWithoutSubCategoryQuery = `
      WITH category_products AS (
        SELECT
          p.wp_product_id,
          p.post_title,
          p.sku,
          p.product_type,
          p.image_url,
          p.price
        FROM products p
        WHERE p.category = $1
          AND p.sub_category IS NULL
          AND p.product_type IN ('simple', 'variable', 'woosb')
          AND p.post_status = 'publish'
      ),
      product_family AS (
        SELECT
          cp.wp_product_id as parent_id,
          COALESCE(v.wp_product_id, cp.wp_product_id) as product_id
        FROM category_products cp
        LEFT JOIN products v ON v.wp_parent_id = cp.wp_product_id AND v.product_type = 'variation'
      ),
      product_stats AS (
        SELECT
          pf.parent_id,
          SUM(oi.qty)::int as qty_sold,
          COALESCE(SUM(oi.line_total), 0) as ca_ttc,
          COALESCE(SUM(oi.line_subtotal), 0) as ca_ht,
          COALESCE(SUM(oi.qty * COALESCE(oi.item_cost, 0)), 0) as cost_ht
        FROM product_family pf
        LEFT JOIN order_items oi ON (oi.product_id = pf.product_id OR oi.variation_id = pf.product_id)
        LEFT JOIN orders o ON o.wp_order_id = oi.wp_order_id
          AND o.post_status = ANY($2)
        GROUP BY pf.parent_id
      )
      SELECT
        cp.wp_product_id,
        cp.post_title,
        cp.sku,
        cp.product_type,
        cp.image_url,
        cp.price,
        CASE
          WHEN cp.product_type = 'variable' THEN (
            SELECT COALESCE(SUM(v.stock::int), 0)
            FROM products v
            WHERE v.wp_parent_id = cp.wp_product_id AND v.product_type = 'variation'
          )
          ELSE COALESCE((SELECT stock::int FROM products WHERE wp_product_id = cp.wp_product_id), 0)
        END as stock,
        COALESCE(ps.qty_sold, 0) as qty_sold,
        COALESCE(ps.ca_ttc, 0) as ca_ttc,
        COALESCE(ps.ca_ht, 0) as ca_ht,
        COALESCE(ps.cost_ht, 0) as cost_ht,
        COALESCE(ps.ca_ht, 0) - COALESCE(ps.cost_ht, 0) as margin_ht,
        CASE WHEN COALESCE(ps.ca_ht, 0) > 0
          THEN ((COALESCE(ps.ca_ht, 0) - COALESCE(ps.cost_ht, 0)) / COALESCE(ps.ca_ht, 0) * 100)
          ELSE 0
        END as margin_percent,
        (SELECT COUNT(*) FROM products WHERE wp_parent_id = cp.wp_product_id)::int as variations_count
      FROM category_products cp
      LEFT JOIN product_stats ps ON ps.parent_id = cp.wp_product_id
      ORDER BY ca_ttc DESC NULLS LAST
    `;

    const productsResult = await pool.query(productsWithoutSubCategoryQuery, [categoryName, VALID_ORDER_STATUSES]);

    // Récupérer les stats globales de la catégorie
    const globalStatsQuery = `
      WITH category_products AS (
        SELECT DISTINCT
          p.wp_product_id,
          p.product_type
        FROM products p
        WHERE p.category = $1
          AND p.product_type IN ('simple', 'variable', 'woosb')
          AND p.post_status = 'publish'
      ),
      product_family AS (
        SELECT
          cp.wp_product_id as parent_id,
          COALESCE(v.wp_product_id, cp.wp_product_id) as product_id
        FROM category_products cp
        LEFT JOIN products v ON v.wp_parent_id = cp.wp_product_id AND v.product_type = 'variation'
      )
      SELECT
        COUNT(DISTINCT cp.wp_product_id)::int as product_count,
        (SELECT COUNT(DISTINCT sub_category) FROM products WHERE category = $1 AND sub_category IS NOT NULL)::int as sub_category_count,
        COALESCE(SUM(oi.qty), 0)::int as qty_sold,
        COALESCE(SUM(oi.line_total), 0) as ca_ttc,
        COALESCE(SUM(oi.line_subtotal), 0) as ca_ht,
        COALESCE(SUM(oi.qty * COALESCE(oi.item_cost, 0)), 0) as cost_ht
      FROM category_products cp
      LEFT JOIN product_family pf ON pf.parent_id = cp.wp_product_id
      LEFT JOIN order_items oi ON (oi.product_id = pf.product_id OR oi.variation_id = pf.product_id)
      LEFT JOIN orders o ON o.wp_order_id = oi.wp_order_id
        AND o.post_status = ANY($2)
    `;

    const globalStatsResult = await pool.query(globalStatsQuery, [categoryName, VALID_ORDER_STATUSES]);
    const globalStats = globalStatsResult.rows[0];

    res.json({
      success: true,
      data: {
        category: categoryName,
        stats: {
          product_count: globalStats.product_count,
          sub_category_count: globalStats.sub_category_count,
          qty_sold: globalStats.qty_sold,
          ca_ttc: parseFloat(globalStats.ca_ttc),
          ca_ht: parseFloat(globalStats.ca_ht),
          cost_ht: parseFloat(globalStats.cost_ht),
          margin_ht: parseFloat(globalStats.ca_ht) - parseFloat(globalStats.cost_ht),
          margin_percent: parseFloat(globalStats.ca_ht) > 0
            ? ((parseFloat(globalStats.ca_ht) - parseFloat(globalStats.cost_ht)) / parseFloat(globalStats.ca_ht) * 100)
            : 0
        },
        sub_categories: subCategoriesResult.rows,
        products_without_sub_category: productsResult.rows
      }
    });
  } catch (error) {
    console.error('Error getting category by name:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère une sous-catégorie par son nom avec ses produits
 * GET /api/categories/sub-categories/:subCategoryName
 */
exports.getSubCategoryByName = async (req, res) => {
  try {
    const subCategoryName = decodeURIComponent(req.params.subCategoryName);

    // Récupérer les infos de base et la catégorie parente
    const infoQuery = `
      SELECT DISTINCT category, sub_category
      FROM products
      WHERE sub_category = $1
      LIMIT 1
    `;
    const infoResult = await pool.query(infoQuery, [subCategoryName]);

    if (infoResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Sub-category not found' });
    }

    const parentCategory = infoResult.rows[0].category;

    // Récupérer les produits de cette sous-catégorie avec leurs stats
    const productsQuery = `
      WITH sub_category_products AS (
        SELECT
          p.wp_product_id,
          p.post_title,
          p.sku,
          p.product_type,
          p.image_url,
          p.price
        FROM products p
        WHERE p.sub_category = $1
          AND p.product_type IN ('simple', 'variable', 'woosb')
          AND p.post_status = 'publish'
      ),
      product_family AS (
        SELECT
          scp.wp_product_id as parent_id,
          COALESCE(v.wp_product_id, scp.wp_product_id) as product_id
        FROM sub_category_products scp
        LEFT JOIN products v ON v.wp_parent_id = scp.wp_product_id AND v.product_type = 'variation'
      ),
      product_stats AS (
        SELECT
          pf.parent_id,
          SUM(oi.qty)::int as qty_sold,
          COALESCE(SUM(oi.line_total), 0) as ca_ttc,
          COALESCE(SUM(oi.line_subtotal), 0) as ca_ht,
          COALESCE(SUM(oi.qty * COALESCE(oi.item_cost, 0)), 0) as cost_ht
        FROM product_family pf
        LEFT JOIN order_items oi ON (oi.product_id = pf.product_id OR oi.variation_id = pf.product_id)
        LEFT JOIN orders o ON o.wp_order_id = oi.wp_order_id
          AND o.post_status = ANY($2)
        GROUP BY pf.parent_id
      )
      SELECT
        scp.wp_product_id,
        scp.post_title,
        scp.sku,
        scp.product_type,
        scp.image_url,
        scp.price,
        CASE
          WHEN scp.product_type = 'variable' THEN (
            SELECT COALESCE(SUM(v.stock::int), 0)
            FROM products v
            WHERE v.wp_parent_id = scp.wp_product_id AND v.product_type = 'variation'
          )
          ELSE COALESCE((SELECT stock::int FROM products WHERE wp_product_id = scp.wp_product_id), 0)
        END as stock,
        COALESCE(ps.qty_sold, 0) as qty_sold,
        COALESCE(ps.ca_ttc, 0) as ca_ttc,
        COALESCE(ps.ca_ht, 0) as ca_ht,
        COALESCE(ps.cost_ht, 0) as cost_ht,
        COALESCE(ps.ca_ht, 0) - COALESCE(ps.cost_ht, 0) as margin_ht,
        CASE WHEN COALESCE(ps.ca_ht, 0) > 0
          THEN ((COALESCE(ps.ca_ht, 0) - COALESCE(ps.cost_ht, 0)) / COALESCE(ps.ca_ht, 0) * 100)
          ELSE 0
        END as margin_percent,
        (SELECT COUNT(*) FROM products WHERE wp_parent_id = scp.wp_product_id)::int as variations_count
      FROM sub_category_products scp
      LEFT JOIN product_stats ps ON ps.parent_id = scp.wp_product_id
      ORDER BY ca_ttc DESC NULLS LAST
    `;

    const productsResult = await pool.query(productsQuery, [subCategoryName, VALID_ORDER_STATUSES]);

    // Calculer les stats globales
    const globalStatsQuery = `
      WITH sub_category_products AS (
        SELECT DISTINCT
          p.wp_product_id,
          p.product_type
        FROM products p
        WHERE p.sub_category = $1
          AND p.product_type IN ('simple', 'variable', 'woosb')
          AND p.post_status = 'publish'
      ),
      product_family AS (
        SELECT
          scp.wp_product_id as parent_id,
          COALESCE(v.wp_product_id, scp.wp_product_id) as product_id
        FROM sub_category_products scp
        LEFT JOIN products v ON v.wp_parent_id = scp.wp_product_id AND v.product_type = 'variation'
      )
      SELECT
        COUNT(DISTINCT scp.wp_product_id)::int as product_count,
        COALESCE(SUM(oi.qty), 0)::int as qty_sold,
        COALESCE(SUM(oi.line_total), 0) as ca_ttc,
        COALESCE(SUM(oi.line_subtotal), 0) as ca_ht,
        COALESCE(SUM(oi.qty * COALESCE(oi.item_cost, 0)), 0) as cost_ht
      FROM sub_category_products scp
      LEFT JOIN product_family pf ON pf.parent_id = scp.wp_product_id
      LEFT JOIN order_items oi ON (oi.product_id = pf.product_id OR oi.variation_id = pf.product_id)
      LEFT JOIN orders o ON o.wp_order_id = oi.wp_order_id
        AND o.post_status = ANY($2)
    `;

    const globalStatsResult = await pool.query(globalStatsQuery, [subCategoryName, VALID_ORDER_STATUSES]);
    const globalStats = globalStatsResult.rows[0];

    res.json({
      success: true,
      data: {
        sub_category: subCategoryName,
        category: parentCategory,
        stats: {
          product_count: globalStats.product_count,
          qty_sold: globalStats.qty_sold,
          ca_ttc: parseFloat(globalStats.ca_ttc),
          ca_ht: parseFloat(globalStats.ca_ht),
          cost_ht: parseFloat(globalStats.cost_ht),
          margin_ht: parseFloat(globalStats.ca_ht) - parseFloat(globalStats.cost_ht),
          margin_percent: parseFloat(globalStats.ca_ht) > 0
            ? ((parseFloat(globalStats.ca_ht) - parseFloat(globalStats.cost_ht)) / parseFloat(globalStats.ca_ht) * 100)
            : 0
        },
        products: productsResult.rows
      }
    });
  } catch (error) {
    console.error('Error getting sub-category by name:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
