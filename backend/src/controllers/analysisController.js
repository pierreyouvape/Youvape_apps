const pool = require('../config/database');

/**
 * Récupère les valeurs disponibles pour les filtres
 * GET /api/analysis/filters
 */
exports.getFilters = async (req, res) => {
  try {
    // Récupérer toutes les valeurs en parallèle
    const [categories, subCategories, countries, shippingMethods, paymentMethods, statuses] = await Promise.all([
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
        statuses: statuses.rows
      }
    });
  } catch (error) {
    console.error('Error getting filters:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Calcule les statistiques selon les filtres
 * POST /api/analysis/stats
 */
exports.getStats = async (req, res) => {
  try {
    const {
      dateFrom,
      dateTo,
      categories,
      subCategories,
      countries,
      shippingMethods,
      paymentMethods,
      statuses
    } = req.body;

    // Construction des conditions WHERE
    let conditions = [];
    let params = [];
    let paramIndex = 1;

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

    // Statuts (par défaut: completed et delivered)
    if (statuses && statuses.length > 0) {
      conditions.push(`o.post_status = ANY($${paramIndex})`);
      params.push(statuses);
      paramIndex++;
    } else {
      conditions.push(`o.post_status IN ('wc-completed', 'wc-delivered')`);
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

    // Méthodes de livraison (via order_items)
    let shippingJoin = '';
    if (shippingMethods && shippingMethods.length > 0) {
      shippingJoin = `
        INNER JOIN order_items oi_ship ON oi_ship.wp_order_id = o.wp_order_id
          AND oi_ship.order_item_type = 'shipping'
          AND oi_ship.order_item_name = ANY($${paramIndex})
      `;
      params.push(shippingMethods);
      paramIndex++;
    }

    // Catégories/sous-catégories (via order_items et products)
    let categoryJoin = '';
    let categoryConditions = [];
    if ((categories && categories.length > 0) || (subCategories && subCategories.length > 0)) {
      categoryJoin = `
        INNER JOIN order_items oi_cat ON oi_cat.wp_order_id = o.wp_order_id AND oi_cat.order_item_type = 'line_item'
        INNER JOIN products p_cat ON (p_cat.wp_product_id = oi_cat.product_id OR p_cat.wp_product_id = oi_cat.variation_id)
      `;

      if (categories && categories.length > 0) {
        categoryConditions.push(`p_cat.category = ANY($${paramIndex})`);
        params.push(categories);
        paramIndex++;
      }
      if (subCategories && subCategories.length > 0) {
        categoryConditions.push(`p_cat.sub_category = ANY($${paramIndex})`);
        params.push(subCategories);
        paramIndex++;
      }
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const categoryWhereClause = categoryConditions.length > 0 ? ' AND (' + categoryConditions.join(' OR ') + ')' : '';

    // Requête principale pour les métriques globales
    const statsQuery = `
      SELECT
        COUNT(DISTINCT o.wp_order_id)::int as orders_count,
        COALESCE(SUM(o.order_total), 0)::numeric as ca_ttc,
        COALESCE(SUM(o.order_total - o.order_tax - o.order_shipping_tax), 0)::numeric as ca_ht,
        COALESCE(SUM(o.order_total_cost), 0)::numeric as cost_ht,
        COALESCE(AVG(o.order_total), 0)::numeric as avg_basket
      FROM orders o
      ${shippingJoin}
      ${categoryJoin}
      ${whereClause}
      ${categoryWhereClause}
    `;

    const statsResult = await pool.query(statsQuery, params);
    const stats = statsResult.rows[0];

    // Calcul marge
    const margin_ht = parseFloat(stats.ca_ht) - parseFloat(stats.cost_ht);
    const margin_percent = parseFloat(stats.ca_ht) > 0 ? (margin_ht / parseFloat(stats.ca_ht)) * 100 : 0;

    // Répartition par transporteur
    const shippingBreakdownQuery = `
      SELECT
        oi.order_item_name as name,
        COUNT(DISTINCT o.wp_order_id)::int as count,
        COALESCE(SUM(o.order_total), 0)::numeric as ca_ttc
      FROM orders o
      INNER JOIN order_items oi ON oi.wp_order_id = o.wp_order_id AND oi.order_item_type = 'shipping'
      ${categoryJoin ? categoryJoin.replace('oi_cat', 'oi_cat2').replace('p_cat', 'p_cat2') : ''}
      ${whereClause}
      ${categoryWhereClause ? categoryWhereClause.replace('p_cat', 'p_cat2') : ''}
      GROUP BY oi.order_item_name
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
          ELSE o.shipping_country
        END as name,
        COUNT(DISTINCT o.wp_order_id)::int as count,
        COALESCE(SUM(o.order_total), 0)::numeric as ca_ttc
      FROM orders o
      ${shippingJoin}
      ${categoryJoin}
      ${whereClause}
      ${categoryWhereClause}
      GROUP BY o.shipping_country
      ORDER BY count DESC
      LIMIT 10
    `;
    const countryBreakdown = await pool.query(countryBreakdownQuery, params);

    // Répartition par catégorie
    const categoryBreakdownQuery = `
      SELECT
        p.category as name,
        COUNT(DISTINCT o.wp_order_id)::int as orders_count,
        COALESCE(SUM(oi.line_total), 0)::numeric as ca_ttc
      FROM orders o
      INNER JOIN order_items oi ON oi.wp_order_id = o.wp_order_id AND oi.order_item_type = 'line_item'
      INNER JOIN products p ON (p.wp_product_id = oi.product_id OR p.wp_product_id = oi.variation_id)
      ${shippingJoin}
      ${whereClause}
      AND p.category IS NOT NULL
      GROUP BY p.category
      ORDER BY ca_ttc DESC
      LIMIT 10
    `;
    const categoryBreakdown = await pool.query(categoryBreakdownQuery, params);

    // Evolution dans le temps (par jour ou mois selon la période)
    const timeBreakdownQuery = `
      SELECT
        DATE_TRUNC('day', o.post_date)::date as date,
        COUNT(DISTINCT o.wp_order_id)::int as count,
        COALESCE(SUM(o.order_total), 0)::numeric as ca_ttc
      FROM orders o
      ${shippingJoin}
      ${categoryJoin}
      ${whereClause}
      ${categoryWhereClause}
      GROUP BY DATE_TRUNC('day', o.post_date)
      ORDER BY date ASC
    `;
    const timeBreakdown = await pool.query(timeBreakdownQuery, params);

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
          avg_basket: parseFloat(stats.avg_basket).toFixed(2)
        },
        breakdowns: {
          byShipping: shippingBreakdown.rows,
          byCountry: countryBreakdown.rows,
          byCategory: categoryBreakdown.rows,
          byTime: timeBreakdown.rows
        }
      }
    });
  } catch (error) {
    console.error('Error getting analysis stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
