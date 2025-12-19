const pool = require('../config/database');

/**
 * Récupère les valeurs disponibles pour les filtres
 * GET /api/analysis/filters
 */
exports.getFilters = async (req, res) => {
  try {
    // Récupérer toutes les valeurs en parallèle
    const [categories, subCategories, countries, shippingMethods, paymentMethods, statuses, coupons] = await Promise.all([
      // Catégories produits
      pool.query(`
        SELECT DISTINCT category as value, category as label, COUNT(*)::int as count
        FROM products
        WHERE category IS NOT NULL AND category != ''
        GROUP BY category
        ORDER BY count DESC
      `),

      // Sous-catégories produits
      pool.query(`
        SELECT DISTINCT sub_category as value, sub_category as label, COUNT(*)::int as count
        FROM products
        WHERE sub_category IS NOT NULL AND sub_category != ''
        GROUP BY sub_category
        ORDER BY count DESC
      `),

      // Pays de livraison
      pool.query(`
        SELECT DISTINCT shipping_country as value,
          CASE shipping_country
            WHEN 'FR' THEN 'France'
            WHEN 'BE' THEN 'Belgique'
            WHEN 'CH' THEN 'Suisse'
            WHEN 'LU' THEN 'Luxembourg'
            WHEN 'DE' THEN 'Allemagne'
            WHEN 'IT' THEN 'Italie'
            WHEN 'ES' THEN 'Espagne'
            WHEN 'NL' THEN 'Pays-Bas'
            WHEN 'GB' THEN 'Royaume-Uni'
            WHEN 'DK' THEN 'Danemark'
            WHEN 'AT' THEN 'Autriche'
            WHEN 'PT' THEN 'Portugal'
            WHEN 'DZ' THEN 'Algérie'
            WHEN 'MA' THEN 'Maroc'
            WHEN 'CA' THEN 'Canada'
            ELSE shipping_country
          END as label,
          COUNT(*)::int as count
        FROM orders
        WHERE shipping_country IS NOT NULL AND shipping_country != ''
        GROUP BY shipping_country
        ORDER BY count DESC
      `),

      // Méthodes de livraison
      pool.query(`
        SELECT DISTINCT order_item_name as value, order_item_name as label, COUNT(*)::int as count
        FROM order_items
        WHERE order_item_type = 'shipping' AND order_item_name IS NOT NULL AND order_item_name != ''
        GROUP BY order_item_name
        ORDER BY count DESC
      `),

      // Méthodes de paiement
      pool.query(`
        SELECT DISTINCT payment_method_title as value, payment_method_title as label, COUNT(*)::int as count
        FROM orders
        WHERE payment_method_title IS NOT NULL AND payment_method_title != ''
        GROUP BY payment_method_title
        ORDER BY count DESC
      `),

      // Statuts de commande
      pool.query(`
        SELECT DISTINCT post_status as value,
          CASE post_status
            WHEN 'wc-completed' THEN 'Terminée'
            WHEN 'wc-delivered' THEN 'Livrée'
            WHEN 'wc-processing' THEN 'En cours'
            WHEN 'wc-on-hold' THEN 'En attente'
            WHEN 'wc-pending' THEN 'En attente paiement'
            WHEN 'wc-cancelled' THEN 'Annulée'
            WHEN 'wc-refunded' THEN 'Remboursée'
            WHEN 'wc-failed' THEN 'Échouée'
            WHEN 'wc-being-delivered' THEN 'En livraison'
            ELSE post_status
          END as label,
          COUNT(*)::int as count
        FROM orders
        WHERE post_status IS NOT NULL
        GROUP BY post_status
        ORDER BY count DESC
      `),

      // Coupons de réduction
      pool.query(`
        SELECT DISTINCT LOWER(order_item_name) as value, order_item_name as label, COUNT(*)::int as count
        FROM order_items
        WHERE order_item_type = 'coupon' AND order_item_name IS NOT NULL AND order_item_name != ''
        GROUP BY LOWER(order_item_name), order_item_name
        ORDER BY count DESC
        LIMIT 50
      `)
    ]);

    res.json({
      success: true,
      data: {
        categories: categories.rows,
        subCategories: subCategories.rows,
        countries: countries.rows,
        shippingMethods: shippingMethods.rows,
        paymentMethods: paymentMethods.rows,
        statuses: statuses.rows,
        coupons: coupons.rows
      }
    });
  } catch (error) {
    console.error('Error getting filters:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Construit une sous-requête pour filtrer les commandes selon les critères
 */
function buildFilteredOrdersCTE(filters) {
  const {
    dateFrom,
    dateTo,
    categories,
    subCategories,
    countries,
    shippingMethods,
    paymentMethods,
    statuses,
    coupons
  } = filters;

  let conditions = [];
  let params = [];
  let paramIndex = 1;

  // Statuts (par défaut: completed et delivered)
  if (statuses && statuses.length > 0) {
    conditions.push(`o.post_status = ANY($${paramIndex})`);
    params.push(statuses);
    paramIndex++;
  } else {
    conditions.push(`o.post_status IN ('wc-completed', 'wc-delivered')`);
  }

  // Période
  if (dateFrom) {
    conditions.push(`o.post_date >= $${paramIndex}`);
    params.push(dateFrom);
    paramIndex++;
  }
  if (dateTo) {
    conditions.push(`o.post_date <= $${paramIndex}`);
    params.push(dateTo + ' 23:59:59');
    paramIndex++;
  }

  // Pays
  if (countries && countries.length > 0) {
    conditions.push(`o.shipping_country = ANY($${paramIndex})`);
    params.push(countries);
    paramIndex++;
  }

  // Méthodes de paiement
  if (paymentMethods && paymentMethods.length > 0) {
    conditions.push(`o.payment_method_title = ANY($${paramIndex})`);
    params.push(paymentMethods);
    paramIndex++;
  }

  // Méthodes de livraison
  if (shippingMethods && shippingMethods.length > 0) {
    conditions.push(`EXISTS (
      SELECT 1 FROM order_items oi_ship
      WHERE oi_ship.wp_order_id = o.wp_order_id
        AND oi_ship.order_item_type = 'shipping'
        AND oi_ship.order_item_name = ANY($${paramIndex})
    )`);
    params.push(shippingMethods);
    paramIndex++;
  }

  // Catégories/sous-catégories
  if ((categories && categories.length > 0) || (subCategories && subCategories.length > 0)) {
    let catConditions = [];

    if (categories && categories.length > 0) {
      catConditions.push(`p_filter.category = ANY($${paramIndex})`);
      params.push(categories);
      paramIndex++;
    }
    if (subCategories && subCategories.length > 0) {
      catConditions.push(`p_filter.sub_category = ANY($${paramIndex})`);
      params.push(subCategories);
      paramIndex++;
    }

    conditions.push(`EXISTS (
      SELECT 1 FROM order_items oi_filter
      INNER JOIN products p_filter ON (
        p_filter.wp_product_id = oi_filter.product_id
        OR p_filter.wp_product_id = oi_filter.variation_id
        OR p_filter.wp_product_id = (
          SELECT wp_parent_id FROM products WHERE wp_product_id = oi_filter.variation_id
        )
      )
      WHERE oi_filter.wp_order_id = o.wp_order_id
        AND oi_filter.order_item_type = 'line_item'
        AND (${catConditions.join(' OR ')})
    )`);
  }

  // Coupons
  if (coupons && coupons.length > 0) {
    conditions.push(`EXISTS (
      SELECT 1 FROM order_items oi_coupon
      WHERE oi_coupon.wp_order_id = o.wp_order_id
        AND oi_coupon.order_item_type = 'coupon'
        AND LOWER(oi_coupon.order_item_name) = ANY($${paramIndex})
    )`);
    params.push(coupons.map(c => c.toLowerCase()));
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  return { whereClause, params, paramIndex };
}

/**
 * Calcule les statistiques selon les filtres
 * POST /api/analysis/stats
 */
exports.getStats = async (req, res) => {
  try {
    const filters = req.body;
    const { whereClause, params } = buildFilteredOrdersCTE(filters);

    // Requête principale pour les métriques globales
    const statsQuery = `
      SELECT
        COUNT(DISTINCT o.wp_order_id)::int as orders_count,
        COALESCE(SUM(DISTINCT o.order_total), 0)::numeric as ca_ttc,
        COALESCE(SUM(DISTINCT o.order_total) - SUM(DISTINCT o.order_tax) - SUM(DISTINCT COALESCE(o.order_shipping_tax, 0)), 0)::numeric as ca_ht,
        COALESCE(SUM(DISTINCT o.order_total_cost), 0)::numeric as cost_ht
      FROM orders o
      ${whereClause}
    `;

    const statsResult = await pool.query(statsQuery, params);
    const stats = statsResult.rows[0];

    // Panier moyen calculé séparément pour éviter problèmes avec DISTINCT
    const avgBasket = stats.orders_count > 0 ? parseFloat(stats.ca_ttc) / stats.orders_count : 0;

    // Calcul marge
    const margin_ht = parseFloat(stats.ca_ht) - parseFloat(stats.cost_ht);
    const margin_percent = parseFloat(stats.ca_ht) > 0 ? (margin_ht / parseFloat(stats.ca_ht)) * 100 : 0;

    // Répartition par transporteur
    const shippingBreakdownQuery = `
      SELECT
        oi_ship.order_item_name as name,
        COUNT(DISTINCT o.wp_order_id)::int as count,
        COALESCE(SUM(DISTINCT o.order_total), 0)::numeric as ca_ttc
      FROM orders o
      INNER JOIN order_items oi_ship ON oi_ship.wp_order_id = o.wp_order_id AND oi_ship.order_item_type = 'shipping'
      ${whereClause}
      GROUP BY oi_ship.order_item_name
      ORDER BY count DESC
      LIMIT 10
    `;
    const shippingBreakdown = await pool.query(shippingBreakdownQuery, params);

    // Répartition par pays
    const countryBreakdownQuery = `
      SELECT
        o.shipping_country as code,
        CASE o.shipping_country
          WHEN 'FR' THEN 'France'
          WHEN 'BE' THEN 'Belgique'
          WHEN 'CH' THEN 'Suisse'
          WHEN 'LU' THEN 'Luxembourg'
          WHEN 'DE' THEN 'Allemagne'
          WHEN 'IT' THEN 'Italie'
          WHEN 'NL' THEN 'Pays-Bas'
          WHEN 'ES' THEN 'Espagne'
          WHEN 'DK' THEN 'Danemark'
          WHEN 'AT' THEN 'Autriche'
          ELSE o.shipping_country
        END as name,
        COUNT(DISTINCT o.wp_order_id)::int as count,
        COALESCE(SUM(DISTINCT o.order_total), 0)::numeric as ca_ttc
      FROM orders o
      ${whereClause}
      GROUP BY o.shipping_country
      ORDER BY count DESC
      LIMIT 10
    `;
    const countryBreakdown = await pool.query(countryBreakdownQuery, params);

    // Répartition par catégorie (toutes les catégories des commandes filtrées)
    const categoryBreakdownQuery = `
      SELECT
        p.category as name,
        COUNT(DISTINCT o.wp_order_id)::int as orders_count,
        COALESCE(SUM(oi.line_total), 0)::numeric as ca_ttc
      FROM orders o
      INNER JOIN order_items oi ON oi.wp_order_id = o.wp_order_id AND oi.order_item_type = 'line_item'
      INNER JOIN products p ON (p.wp_product_id = oi.product_id OR p.wp_product_id = oi.variation_id)
      ${whereClause}
      AND p.category IS NOT NULL
      GROUP BY p.category
      ORDER BY ca_ttc DESC
      LIMIT 10
    `;
    const categoryBreakdown = await pool.query(categoryBreakdownQuery, params);

    // Evolution dans le temps
    const timeBreakdownQuery = `
      SELECT
        DATE_TRUNC('day', o.post_date)::date as date,
        COUNT(DISTINCT o.wp_order_id)::int as count,
        COALESCE(SUM(DISTINCT o.order_total), 0)::numeric as ca_ttc
      FROM orders o
      ${whereClause}
      GROUP BY DATE_TRUNC('day', o.post_date)
      ORDER BY date ASC
    `;
    const timeBreakdown = await pool.query(timeBreakdownQuery, params);

    // Répartition par coupon
    const couponBreakdownQuery = `
      SELECT
        oi_coupon.order_item_name as name,
        COUNT(DISTINCT o.wp_order_id)::int as count,
        COALESCE(SUM(DISTINCT o.order_total), 0)::numeric as ca_ttc
      FROM orders o
      INNER JOIN order_items oi_coupon ON oi_coupon.wp_order_id = o.wp_order_id AND oi_coupon.order_item_type = 'coupon'
      ${whereClause}
      GROUP BY oi_coupon.order_item_name
      ORDER BY count DESC
      LIMIT 15
    `;
    const couponBreakdown = await pool.query(couponBreakdownQuery, params);

    // Calcul des commandes avec et sans coupon
    const withCouponQuery = `
      SELECT COUNT(DISTINCT o.wp_order_id)::int as count
      FROM orders o
      ${whereClause}
      AND EXISTS (
        SELECT 1 FROM order_items oi_c
        WHERE oi_c.wp_order_id = o.wp_order_id AND oi_c.order_item_type = 'coupon'
      )
    `;
    const withCouponResult = await pool.query(withCouponQuery, params);
    const ordersWithCoupon = withCouponResult.rows[0]?.count || 0;
    const ordersWithoutCoupon = parseInt(stats.orders_count) - ordersWithCoupon;

    res.json({
      success: true,
      data: {
        metrics: {
          orders_count: parseInt(stats.orders_count),
          ca_ttc: parseFloat(stats.ca_ttc).toFixed(2),
          ca_ht: parseFloat(stats.ca_ht).toFixed(2),
          cost_ht: parseFloat(stats.cost_ht).toFixed(2),
          margin_ht: margin_ht.toFixed(2),
          margin_percent: margin_percent.toFixed(1),
          avg_basket: avgBasket.toFixed(2),
          orders_with_coupon: ordersWithCoupon,
          orders_without_coupon: ordersWithoutCoupon
        },
        breakdowns: {
          byShipping: shippingBreakdown.rows,
          byCountry: countryBreakdown.rows,
          byCategory: categoryBreakdown.rows,
          byTime: timeBreakdown.rows,
          byCoupon: couponBreakdown.rows
        }
      }
    });
  } catch (error) {
    console.error('Error getting analysis stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
