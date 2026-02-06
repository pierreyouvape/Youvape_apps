const pool = require('../config/database');

// Statuts de commande considérés comme "ventes valides"
const VALID_ORDER_STATUSES = ['wc-completed', 'wc-delivered', 'wc-being-delivered', 'wc-wms_cp_delivered', 'wc-processing'];

/**
 * Récupère toutes les marques avec stats agrégées
 * GET /api/brands
 */
exports.getAll = async (req, res) => {
  try {
    const query = `
      WITH brand_products AS (
        SELECT DISTINCT
          p.brand,
          p.wp_product_id,
          p.product_type
        FROM products p
        WHERE p.brand IS NOT NULL
          AND p.product_type IN ('simple', 'variable', 'woosb')
          AND p.post_status = 'publish'
      ),
      product_family AS (
        SELECT
          bp.brand,
          bp.wp_product_id as parent_id,
          COALESCE(v.wp_product_id, bp.wp_product_id) as product_id
        FROM brand_products bp
        LEFT JOIN products v ON v.wp_parent_id = bp.wp_product_id AND v.product_type = 'variation'
      ),
      brand_stats AS (
        -- WooCommerce: line_total = HT, line_tax = TVA, donc TTC = line_total + line_tax
        SELECT
          pf.brand,
          SUM(oi.qty)::int as qty_sold,
          COALESCE(SUM(oi.line_total), 0) + COALESCE(SUM(oi.line_tax), 0) as ca_ttc,
          COALESCE(SUM(oi.line_total), 0) as ca_ht,
          COALESCE(SUM(oi.qty * COALESCE(oi.item_cost, 0)), 0) as cost_ht
        FROM product_family pf
        LEFT JOIN order_items oi ON (oi.product_id = pf.product_id OR oi.variation_id = pf.product_id)
        LEFT JOIN orders o ON o.wp_order_id = oi.wp_order_id
          AND o.post_status = ANY($1)
        GROUP BY pf.brand
      )
      SELECT
        b.brand,
        COUNT(DISTINCT bp.wp_product_id)::int as product_count,
        (SELECT COUNT(DISTINCT p2.sub_brand) FROM products p2 WHERE p2.brand = b.brand AND p2.sub_brand IS NOT NULL)::int as sub_brand_count,
        COALESCE(bs.qty_sold, 0) as qty_sold,
        COALESCE(bs.ca_ttc, 0) as ca_ttc,
        COALESCE(bs.ca_ht, 0) as ca_ht,
        COALESCE(bs.cost_ht, 0) as cost_ht,
        COALESCE(bs.ca_ht, 0) - COALESCE(bs.cost_ht, 0) as margin_ht,
        CASE WHEN COALESCE(bs.ca_ht, 0) > 0
          THEN ((COALESCE(bs.ca_ht, 0) - COALESCE(bs.cost_ht, 0)) / COALESCE(bs.ca_ht, 0) * 100)
          ELSE 0
        END as margin_percent
      FROM (SELECT DISTINCT brand FROM products WHERE brand IS NOT NULL) b
      LEFT JOIN brand_products bp ON bp.brand = b.brand
      LEFT JOIN brand_stats bs ON bs.brand = b.brand
      GROUP BY b.brand, bs.qty_sold, bs.ca_ttc, bs.ca_ht, bs.cost_ht
      ORDER BY ca_ttc DESC NULLS LAST
    `;

    const result = await pool.query(query, [VALID_ORDER_STATUSES]);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error getting brands:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère toutes les sous-marques avec stats
 * GET /api/brands/sub-brands
 */
exports.getAllSubBrands = async (req, res) => {
  try {
    const query = `
      WITH sub_brand_products AS (
        SELECT DISTINCT
          p.sub_brand,
          p.brand,
          p.wp_product_id,
          p.product_type
        FROM products p
        WHERE p.sub_brand IS NOT NULL
          AND p.product_type IN ('simple', 'variable', 'woosb')
          AND p.post_status = 'publish'
      ),
      product_family AS (
        SELECT
          sbp.sub_brand,
          sbp.brand,
          sbp.wp_product_id as parent_id,
          COALESCE(v.wp_product_id, sbp.wp_product_id) as product_id
        FROM sub_brand_products sbp
        LEFT JOIN products v ON v.wp_parent_id = sbp.wp_product_id AND v.product_type = 'variation'
      ),
      sub_brand_stats AS (
        -- WooCommerce: line_total = HT, line_tax = TVA, donc TTC = line_total + line_tax
        SELECT
          pf.sub_brand,
          SUM(oi.qty)::int as qty_sold,
          COALESCE(SUM(oi.line_total), 0) + COALESCE(SUM(oi.line_tax), 0) as ca_ttc,
          COALESCE(SUM(oi.line_total), 0) as ca_ht,
          COALESCE(SUM(oi.qty * COALESCE(oi.item_cost, 0)), 0) as cost_ht
        FROM product_family pf
        LEFT JOIN order_items oi ON (oi.product_id = pf.product_id OR oi.variation_id = pf.product_id)
        LEFT JOIN orders o ON o.wp_order_id = oi.wp_order_id
          AND o.post_status = ANY($1)
        GROUP BY pf.sub_brand
      )
      SELECT
        sb.sub_brand,
        sb.brand,
        COUNT(DISTINCT sbp.wp_product_id)::int as product_count,
        COALESCE(sbs.qty_sold, 0) as qty_sold,
        COALESCE(sbs.ca_ttc, 0) as ca_ttc,
        COALESCE(sbs.ca_ht, 0) as ca_ht,
        COALESCE(sbs.cost_ht, 0) as cost_ht,
        COALESCE(sbs.ca_ht, 0) - COALESCE(sbs.cost_ht, 0) as margin_ht,
        CASE WHEN COALESCE(sbs.ca_ht, 0) > 0
          THEN ((COALESCE(sbs.ca_ht, 0) - COALESCE(sbs.cost_ht, 0)) / COALESCE(sbs.ca_ht, 0) * 100)
          ELSE 0
        END as margin_percent
      FROM (SELECT DISTINCT sub_brand, brand FROM products WHERE sub_brand IS NOT NULL) sb
      LEFT JOIN sub_brand_products sbp ON sbp.sub_brand = sb.sub_brand
      LEFT JOIN sub_brand_stats sbs ON sbs.sub_brand = sb.sub_brand
      GROUP BY sb.sub_brand, sb.brand, sbs.qty_sold, sbs.ca_ttc, sbs.ca_ht, sbs.cost_ht
      ORDER BY ca_ttc DESC NULLS LAST
    `;

    const result = await pool.query(query, [VALID_ORDER_STATUSES]);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error getting sub-brands:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère une marque par son nom avec sous-marques et produits
 * GET /api/brands/:brandName
 */
exports.getByName = async (req, res) => {
  try {
    const brandName = decodeURIComponent(req.params.brandName);

    // Récupérer les sous-marques de cette marque avec leurs stats
    const subBrandsQuery = `
      WITH sub_brand_products AS (
        SELECT DISTINCT
          p.sub_brand,
          p.wp_product_id,
          p.product_type
        FROM products p
        WHERE p.brand = $1
          AND p.sub_brand IS NOT NULL
          AND p.product_type IN ('simple', 'variable', 'woosb')
          AND p.post_status = 'publish'
      ),
      product_family AS (
        SELECT
          sbp.sub_brand,
          sbp.wp_product_id as parent_id,
          COALESCE(v.wp_product_id, sbp.wp_product_id) as product_id
        FROM sub_brand_products sbp
        LEFT JOIN products v ON v.wp_parent_id = sbp.wp_product_id AND v.product_type = 'variation'
      ),
      sub_brand_stats AS (
        -- WooCommerce: line_total = HT, line_tax = TVA, donc TTC = line_total + line_tax
        SELECT
          pf.sub_brand,
          SUM(oi.qty)::int as qty_sold,
          COALESCE(SUM(oi.line_total), 0) + COALESCE(SUM(oi.line_tax), 0) as ca_ttc,
          COALESCE(SUM(oi.line_total), 0) as ca_ht,
          COALESCE(SUM(oi.qty * COALESCE(oi.item_cost, 0)), 0) as cost_ht
        FROM product_family pf
        LEFT JOIN order_items oi ON (oi.product_id = pf.product_id OR oi.variation_id = pf.product_id)
        LEFT JOIN orders o ON o.wp_order_id = oi.wp_order_id
          AND o.post_status = ANY($2)
        GROUP BY pf.sub_brand
      )
      SELECT
        sb.sub_brand,
        COUNT(DISTINCT sbp.wp_product_id)::int as product_count,
        COALESCE(sbs.qty_sold, 0) as qty_sold,
        COALESCE(sbs.ca_ttc, 0) as ca_ttc,
        COALESCE(sbs.ca_ht, 0) as ca_ht,
        COALESCE(sbs.cost_ht, 0) as cost_ht,
        COALESCE(sbs.ca_ht, 0) - COALESCE(sbs.cost_ht, 0) as margin_ht,
        CASE WHEN COALESCE(sbs.ca_ht, 0) > 0
          THEN ((COALESCE(sbs.ca_ht, 0) - COALESCE(sbs.cost_ht, 0)) / COALESCE(sbs.ca_ht, 0) * 100)
          ELSE 0
        END as margin_percent
      FROM (SELECT DISTINCT sub_brand FROM products WHERE brand = $1 AND sub_brand IS NOT NULL) sb
      LEFT JOIN sub_brand_products sbp ON sbp.sub_brand = sb.sub_brand
      LEFT JOIN sub_brand_stats sbs ON sbs.sub_brand = sb.sub_brand
      GROUP BY sb.sub_brand, sbs.qty_sold, sbs.ca_ttc, sbs.ca_ht, sbs.cost_ht
      ORDER BY ca_ttc DESC NULLS LAST
    `;

    const subBrandsResult = await pool.query(subBrandsQuery, [brandName, VALID_ORDER_STATUSES]);

    // Récupérer les produits de cette marque SANS sous-marque (produits "directs")
    const productsWithoutSubBrandQuery = `
      WITH brand_products AS (
        SELECT
          p.wp_product_id,
          p.post_title,
          p.sku,
          p.product_type,
          p.image_url,
          p.price
        FROM products p
        WHERE p.brand = $1
          AND p.sub_brand IS NULL
          AND p.product_type IN ('simple', 'variable', 'woosb')
          AND p.post_status = 'publish'
      ),
      product_family AS (
        SELECT
          bp.wp_product_id as parent_id,
          COALESCE(v.wp_product_id, bp.wp_product_id) as product_id
        FROM brand_products bp
        LEFT JOIN products v ON v.wp_parent_id = bp.wp_product_id AND v.product_type = 'variation'
      ),
      product_stats AS (
        -- WooCommerce: line_total = HT, line_tax = TVA, donc TTC = line_total + line_tax
        SELECT
          pf.parent_id,
          SUM(oi.qty)::int as qty_sold,
          COALESCE(SUM(oi.line_total), 0) + COALESCE(SUM(oi.line_tax), 0) as ca_ttc,
          COALESCE(SUM(oi.line_total), 0) as ca_ht,
          COALESCE(SUM(oi.qty * COALESCE(oi.item_cost, 0)), 0) as cost_ht
        FROM product_family pf
        LEFT JOIN order_items oi ON (oi.product_id = pf.product_id OR oi.variation_id = pf.product_id)
        LEFT JOIN orders o ON o.wp_order_id = oi.wp_order_id
          AND o.post_status = ANY($2)
        GROUP BY pf.parent_id
      )
      SELECT
        bp.wp_product_id,
        bp.post_title,
        bp.sku,
        bp.product_type,
        bp.image_url,
        bp.price,
        CASE
          WHEN bp.product_type = 'variable' THEN (
            SELECT COALESCE(SUM(v.stock::int), 0)
            FROM products v
            WHERE v.wp_parent_id = bp.wp_product_id AND v.product_type = 'variation'
          )
          ELSE COALESCE((SELECT stock::int FROM products WHERE wp_product_id = bp.wp_product_id), 0)
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
        (SELECT COUNT(*) FROM products WHERE wp_parent_id = bp.wp_product_id)::int as variations_count
      FROM brand_products bp
      LEFT JOIN product_stats ps ON ps.parent_id = bp.wp_product_id
      ORDER BY ca_ttc DESC NULLS LAST
    `;

    const productsResult = await pool.query(productsWithoutSubBrandQuery, [brandName, VALID_ORDER_STATUSES]);

    // Récupérer les stats globales de la marque
    const globalStatsQuery = `
      WITH brand_products AS (
        SELECT DISTINCT
          p.wp_product_id,
          p.product_type
        FROM products p
        WHERE p.brand = $1
          AND p.product_type IN ('simple', 'variable', 'woosb')
          AND p.post_status = 'publish'
      ),
      product_family AS (
        SELECT
          bp.wp_product_id as parent_id,
          COALESCE(v.wp_product_id, bp.wp_product_id) as product_id
        FROM brand_products bp
        LEFT JOIN products v ON v.wp_parent_id = bp.wp_product_id AND v.product_type = 'variation'
      )
      -- WooCommerce: line_total = HT, line_tax = TVA, donc TTC = line_total + line_tax
      SELECT
        COUNT(DISTINCT bp.wp_product_id)::int as product_count,
        (SELECT COUNT(DISTINCT sub_brand) FROM products WHERE brand = $1 AND sub_brand IS NOT NULL)::int as sub_brand_count,
        COALESCE(SUM(oi.qty), 0)::int as qty_sold,
        COALESCE(SUM(oi.line_total), 0) + COALESCE(SUM(oi.line_tax), 0) as ca_ttc,
        COALESCE(SUM(oi.line_total), 0) as ca_ht,
        COALESCE(SUM(oi.qty * COALESCE(oi.item_cost, 0)), 0) as cost_ht
      FROM brand_products bp
      LEFT JOIN product_family pf ON pf.parent_id = bp.wp_product_id
      LEFT JOIN order_items oi ON (oi.product_id = pf.product_id OR oi.variation_id = pf.product_id)
      LEFT JOIN orders o ON o.wp_order_id = oi.wp_order_id
        AND o.post_status = ANY($2)
    `;

    const globalStatsResult = await pool.query(globalStatsQuery, [brandName, VALID_ORDER_STATUSES]);
    const globalStats = globalStatsResult.rows[0];

    res.json({
      success: true,
      data: {
        brand: brandName,
        stats: {
          product_count: globalStats.product_count,
          sub_brand_count: globalStats.sub_brand_count,
          qty_sold: globalStats.qty_sold,
          ca_ttc: parseFloat(globalStats.ca_ttc),
          ca_ht: parseFloat(globalStats.ca_ht),
          cost_ht: parseFloat(globalStats.cost_ht),
          margin_ht: parseFloat(globalStats.ca_ht) - parseFloat(globalStats.cost_ht),
          margin_percent: parseFloat(globalStats.ca_ht) > 0
            ? ((parseFloat(globalStats.ca_ht) - parseFloat(globalStats.cost_ht)) / parseFloat(globalStats.ca_ht) * 100)
            : 0
        },
        sub_brands: subBrandsResult.rows,
        products_without_sub_brand: productsResult.rows
      }
    });
  } catch (error) {
    console.error('Error getting brand by name:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère une sous-marque par son nom avec ses produits
 * GET /api/brands/sub-brands/:subBrandName
 */
exports.getSubBrandByName = async (req, res) => {
  try {
    const subBrandName = decodeURIComponent(req.params.subBrandName);

    // Récupérer les infos de base et la marque parente
    const infoQuery = `
      SELECT DISTINCT brand, sub_brand
      FROM products
      WHERE sub_brand = $1
      LIMIT 1
    `;
    const infoResult = await pool.query(infoQuery, [subBrandName]);

    if (infoResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Sub-brand not found' });
    }

    const parentBrand = infoResult.rows[0].brand;

    // Récupérer les produits de cette sous-marque avec leurs stats
    const productsQuery = `
      WITH sub_brand_products AS (
        SELECT
          p.wp_product_id,
          p.post_title,
          p.sku,
          p.product_type,
          p.image_url,
          p.price
        FROM products p
        WHERE p.sub_brand = $1
          AND p.product_type IN ('simple', 'variable', 'woosb')
          AND p.post_status = 'publish'
      ),
      product_family AS (
        SELECT
          sbp.wp_product_id as parent_id,
          COALESCE(v.wp_product_id, sbp.wp_product_id) as product_id
        FROM sub_brand_products sbp
        LEFT JOIN products v ON v.wp_parent_id = sbp.wp_product_id AND v.product_type = 'variation'
      ),
      product_stats AS (
        -- WooCommerce: line_total = HT, line_tax = TVA, donc TTC = line_total + line_tax
        SELECT
          pf.parent_id,
          SUM(oi.qty)::int as qty_sold,
          COALESCE(SUM(oi.line_total), 0) + COALESCE(SUM(oi.line_tax), 0) as ca_ttc,
          COALESCE(SUM(oi.line_total), 0) as ca_ht,
          COALESCE(SUM(oi.qty * COALESCE(oi.item_cost, 0)), 0) as cost_ht
        FROM product_family pf
        LEFT JOIN order_items oi ON (oi.product_id = pf.product_id OR oi.variation_id = pf.product_id)
        LEFT JOIN orders o ON o.wp_order_id = oi.wp_order_id
          AND o.post_status = ANY($2)
        GROUP BY pf.parent_id
      )
      SELECT
        sbp.wp_product_id,
        sbp.post_title,
        sbp.sku,
        sbp.product_type,
        sbp.image_url,
        sbp.price,
        CASE
          WHEN sbp.product_type = 'variable' THEN (
            SELECT COALESCE(SUM(v.stock::int), 0)
            FROM products v
            WHERE v.wp_parent_id = sbp.wp_product_id AND v.product_type = 'variation'
          )
          ELSE COALESCE((SELECT stock::int FROM products WHERE wp_product_id = sbp.wp_product_id), 0)
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
        (SELECT COUNT(*) FROM products WHERE wp_parent_id = sbp.wp_product_id)::int as variations_count
      FROM sub_brand_products sbp
      LEFT JOIN product_stats ps ON ps.parent_id = sbp.wp_product_id
      ORDER BY ca_ttc DESC NULLS LAST
    `;

    const productsResult = await pool.query(productsQuery, [subBrandName, VALID_ORDER_STATUSES]);

    // Calculer les stats globales
    const globalStatsQuery = `
      WITH sub_brand_products AS (
        SELECT DISTINCT
          p.wp_product_id,
          p.product_type
        FROM products p
        WHERE p.sub_brand = $1
          AND p.product_type IN ('simple', 'variable', 'woosb')
          AND p.post_status = 'publish'
      ),
      product_family AS (
        SELECT
          sbp.wp_product_id as parent_id,
          COALESCE(v.wp_product_id, sbp.wp_product_id) as product_id
        FROM sub_brand_products sbp
        LEFT JOIN products v ON v.wp_parent_id = sbp.wp_product_id AND v.product_type = 'variation'
      )
      -- WooCommerce: line_total = HT, line_tax = TVA, donc TTC = line_total + line_tax
      SELECT
        COUNT(DISTINCT sbp.wp_product_id)::int as product_count,
        COALESCE(SUM(oi.qty), 0)::int as qty_sold,
        COALESCE(SUM(oi.line_total), 0) + COALESCE(SUM(oi.line_tax), 0) as ca_ttc,
        COALESCE(SUM(oi.line_total), 0) as ca_ht,
        COALESCE(SUM(oi.qty * COALESCE(oi.item_cost, 0)), 0) as cost_ht
      FROM sub_brand_products sbp
      LEFT JOIN product_family pf ON pf.parent_id = sbp.wp_product_id
      LEFT JOIN order_items oi ON (oi.product_id = pf.product_id OR oi.variation_id = pf.product_id)
      LEFT JOIN orders o ON o.wp_order_id = oi.wp_order_id
        AND o.post_status = ANY($2)
    `;

    const globalStatsResult = await pool.query(globalStatsQuery, [subBrandName, VALID_ORDER_STATUSES]);
    const globalStats = globalStatsResult.rows[0];

    res.json({
      success: true,
      data: {
        sub_brand: subBrandName,
        brand: parentBrand,
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
    console.error('Error getting sub-brand by name:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
