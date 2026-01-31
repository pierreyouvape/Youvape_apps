const pool = require('../config/database');

const needsCalculationModel = {
  /**
   * Calculer les besoins pour un produit
   * Formule:
   *   Besoin_théorique = MAX(Ventes_moyennes × Mois_à_couvrir, Commande_max_12_mois + 15j_de_ventes)
   *   Besoin_supposé = même formule avec coefficient de tendance (régression linéaire)
   */
  calculateProductNeeds: async (productId, analysisPeriodMonths = 1, coverageMonths = 1) => {
    // 1. Récupérer les ventes des 12 derniers mois pour la commande max
    const salesDataQuery = `
      SELECT
        DATE_TRUNC('month', o.post_date) as month,
        SUM(oi.qty) as total_qty,
        MAX(oi.qty) as max_qty_per_order,
        COUNT(DISTINCT o.id) as order_count
      FROM order_items oi
      JOIN orders o ON oi.wp_order_id = o.wp_order_id
      WHERE oi.product_id = $1
        AND o.post_date >= NOW() - INTERVAL '12 months'
        AND o.post_status IN ('wc-completed', 'wc-processing', 'wc-delivered')
      GROUP BY DATE_TRUNC('month', o.post_date)
      ORDER BY month
    `;
    const salesDataResult = await pool.query(salesDataQuery, [productId]);
    const monthlySales = salesDataResult.rows;

    // 2. Récupérer la commande max sur 12 mois
    const maxOrderQuery = `
      SELECT COALESCE(MAX(oi.qty), 0) as max_order_qty
      FROM order_items oi
      JOIN orders o ON oi.wp_order_id = o.wp_order_id
      WHERE oi.product_id = $1
        AND o.post_date >= NOW() - INTERVAL '12 months'
        AND o.post_status IN ('wc-completed', 'wc-processing', 'wc-delivered')
    `;
    const maxOrderResult = await pool.query(maxOrderQuery, [productId]);
    const maxOrderQty = parseInt(maxOrderResult.rows[0].max_order_qty) || 0;

    // 3. Récupérer les ventes sur la période d'analyse
    const analysisSalesQuery = `
      SELECT COALESCE(SUM(oi.qty), 0) as total_qty
      FROM order_items oi
      JOIN orders o ON oi.wp_order_id = o.wp_order_id
      WHERE oi.product_id = $1
        AND o.post_date >= NOW() - INTERVAL '${analysisPeriodMonths} months'
        AND o.post_status IN ('wc-completed', 'wc-processing', 'wc-delivered')
    `;
    const analysisSalesResult = await pool.query(analysisSalesQuery, [productId]);
    const salesInPeriod = parseInt(analysisSalesResult.rows[0].total_qty) || 0;

    // 4. Calculer la moyenne mensuelle
    const avgMonthlySales = analysisPeriodMonths > 0 ? salesInPeriod / analysisPeriodMonths : 0;

    // 5. Calculer le coefficient de tendance (régression linéaire sur 12 mois)
    const trendCoefficient = needsCalculationModel.calculateTrendCoefficient(monthlySales);

    // 6. Calculer les besoins
    const fifteenDaysSales = avgMonthlySales / 2; // 15 jours = demi-mois
    const projectedMonthlySales = avgMonthlySales * trendCoefficient;
    const fifteenDaysProjected = projectedMonthlySales / 2;

    // Besoin théorique
    const theoreticalCoverage = avgMonthlySales * coverageMonths;
    const theoreticalSafety = maxOrderQty + fifteenDaysSales;
    const theoreticalNeed = Math.max(theoreticalCoverage, theoreticalSafety);

    // Besoin supposé (avec tendance)
    const supposedCoverage = projectedMonthlySales * coverageMonths;
    const supposedSafety = maxOrderQty + fifteenDaysProjected;
    const supposedNeed = Math.max(supposedCoverage, supposedSafety);

    return {
      product_id: productId,
      analysis_period_months: analysisPeriodMonths,
      coverage_months: coverageMonths,
      sales_in_period: salesInPeriod,
      avg_monthly_sales: Math.round(avgMonthlySales * 100) / 100,
      max_order_qty_12m: maxOrderQty,
      trend_coefficient: Math.round(trendCoefficient * 100) / 100,
      theoretical_need: Math.ceil(theoreticalNeed),
      supposed_need: Math.ceil(supposedNeed),
      trend_direction: trendCoefficient > 1.1 ? 'up' : trendCoefficient < 0.9 ? 'down' : 'stable'
    };
  },

  /**
   * Calculer le coefficient de tendance par régression linéaire
   * Retourne un coefficient :
   *   > 1 = croissance
   *   < 1 = décroissance
   *   = 1 = stable
   */
  calculateTrendCoefficient: (monthlySales) => {
    if (!monthlySales || monthlySales.length < 2) {
      return 1; // Pas assez de données, coefficient neutre
    }

    const n = monthlySales.length;
    const sales = monthlySales.map(m => parseInt(m.total_qty) || 0);

    // Régression linéaire : y = ax + b
    // x = index du mois (0, 1, 2, ...)
    // y = ventes du mois

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += sales[i];
      sumXY += i * sales[i];
      sumX2 += i * i;
    }

    const avgX = sumX / n;
    const avgY = sumY / n;

    // Pente de la régression
    const denominator = sumX2 - n * avgX * avgX;
    if (denominator === 0 || avgY === 0) {
      return 1; // Éviter division par zéro
    }

    const slope = (sumXY - n * avgX * avgY) / denominator;

    // Coefficient = (valeur projetée au mois suivant) / (moyenne actuelle)
    // Valeur projetée = avgY + slope * (n - avgX)
    const projectedValue = avgY + slope * (n - avgX);

    if (avgY === 0) {
      return projectedValue > 0 ? 2 : 1; // Si pas de ventes avant mais projection positive
    }

    const coefficient = projectedValue / avgY;

    // Limiter le coefficient entre 0.1 et 5 pour éviter les valeurs aberrantes
    return Math.max(0.1, Math.min(5, coefficient));
  },

  /**
   * Récupérer les besoins pour tous les produits (avec filtres)
   */
  getAllProductsNeeds: async (filters = {}) => {
    // Récupérer les paramètres du fournisseur si spécifié
    let analysisPeriodMonths = filters.analysis_period_months || 1;
    let coverageMonths = filters.coverage_months || 1;

    if (filters.supplier_id) {
      const supplierQuery = `
        SELECT analysis_period_months, coverage_months
        FROM suppliers WHERE id = $1
      `;
      const supplierResult = await pool.query(supplierQuery, [filters.supplier_id]);
      if (supplierResult.rows[0]) {
        analysisPeriodMonths = supplierResult.rows[0].analysis_period_months;
        coverageMonths = parseFloat(supplierResult.rows[0].coverage_months);
      }
    }

    // Construire la requête principale
    let productsQuery = `
      SELECT
        p.id,
        p.wp_product_id,
        p.post_title,
        p.sku,
        p.stock,
        p.stock_status,
        p.regular_price,
        p.wc_cog_cost as cost_price,
        pa.alert_threshold,
        COALESCE(ps_primary.supplier_id, ps_any.supplier_id) as supplier_id,
        COALESCE(s_primary.name, s_any.name) as supplier_name,
        ps_primary.supplier_sku,
        ps_primary.supplier_price
      FROM products p
      LEFT JOIN product_alerts pa ON p.id = pa.product_id
      LEFT JOIN product_suppliers ps_primary ON p.id = ps_primary.product_id AND ps_primary.is_primary = true
      LEFT JOIN suppliers s_primary ON ps_primary.supplier_id = s_primary.id
      LEFT JOIN LATERAL (
        SELECT supplier_id FROM product_suppliers WHERE product_id = p.id LIMIT 1
      ) ps_any ON ps_primary.id IS NULL
      LEFT JOIN suppliers s_any ON ps_any.supplier_id = s_any.id
      WHERE p.post_status = 'publish'
        AND p.product_type IN ('simple', 'variation')
    `;

    const values = [];
    let paramIndex = 1;

    // Filtre par fournisseur
    if (filters.supplier_id) {
      productsQuery += `
        AND EXISTS (
          SELECT 1 FROM product_suppliers ps
          WHERE ps.product_id = p.id AND ps.supplier_id = $${paramIndex++}
        )
      `;
      values.push(filters.supplier_id);
    }

    // Filtre stock nul ou négatif
    if (filters.zero_stock) {
      productsQuery += ` AND (p.stock IS NULL OR p.stock <= 0)`;
    }

    // Filtre par recherche
    if (filters.search) {
      productsQuery += ` AND (p.post_title ILIKE $${paramIndex} OR p.sku ILIKE $${paramIndex})`;
      values.push(`%${filters.search}%`);
      paramIndex++;
    }

    productsQuery += ' ORDER BY p.post_title';

    // Pagination
    if (filters.limit) {
      productsQuery += ` LIMIT $${paramIndex++}`;
      values.push(filters.limit);
    }

    if (filters.offset) {
      productsQuery += ` OFFSET $${paramIndex++}`;
      values.push(filters.offset);
    }

    const productsResult = await pool.query(productsQuery, values);
    const products = productsResult.rows;

    // Calculer les besoins pour chaque produit
    const productsWithNeeds = await Promise.all(
      products.map(async (product) => {
        const needs = await needsCalculationModel.calculateProductNeeds(
          product.id,
          analysisPeriodMonths,
          coverageMonths
        );

        // Calculer le "en arrivage"
        const incomingQuery = `
          SELECT COALESCE(SUM(poi.qty_ordered - poi.qty_received), 0) as incoming_qty
          FROM purchase_order_items poi
          JOIN purchase_orders po ON poi.purchase_order_id = po.id
          WHERE poi.product_id = $1
            AND po.status IN ('sent', 'confirmed', 'shipped', 'partial')
        `;
        const incomingResult = await pool.query(incomingQuery, [product.id]);
        const incomingQty = parseInt(incomingResult.rows[0].incoming_qty) || 0;

        // Calculer les propositions d'achat
        const currentStock = parseInt(product.stock) || 0;
        const alertThreshold = product.alert_threshold || 0;

        // Besoin effectif = max(besoin calculé, seuil alerte)
        const effectiveTheoreticalNeed = Math.max(needs.theoretical_need, alertThreshold);
        const effectiveSupposedNeed = Math.max(needs.supposed_need, alertThreshold);

        // Proposition = besoin - stock - en arrivage (minimum 0)
        const theoreticalProposal = Math.max(0, effectiveTheoreticalNeed - currentStock - incomingQty);
        const supposedProposal = Math.max(0, effectiveSupposedNeed - currentStock - incomingQty);

        return {
          ...product,
          stock: currentStock,
          incoming_qty: incomingQty,
          ...needs,
          effective_theoretical_need: effectiveTheoreticalNeed,
          effective_supposed_need: effectiveSupposedNeed,
          theoretical_proposal: theoreticalProposal,
          supposed_proposal: supposedProposal
        };
      })
    );

    return productsWithNeeds;
  },

  /**
   * Compter les produits (pour pagination)
   */
  countProducts: async (filters = {}) => {
    let query = `
      SELECT COUNT(*) as total
      FROM products p
      WHERE p.post_status = 'publish'
        AND p.product_type IN ('simple', 'variation')
    `;

    const values = [];
    let paramIndex = 1;

    if (filters.supplier_id) {
      query += `
        AND EXISTS (
          SELECT 1 FROM product_suppliers ps
          WHERE ps.product_id = p.id AND ps.supplier_id = $${paramIndex++}
        )
      `;
      values.push(filters.supplier_id);
    }

    if (filters.zero_stock) {
      query += ` AND (p.stock IS NULL OR p.stock <= 0)`;
    }

    if (filters.search) {
      query += ` AND (p.post_title ILIKE $${paramIndex} OR p.sku ILIKE $${paramIndex})`;
      values.push(`%${filters.search}%`);
      paramIndex++;
    }

    const result = await pool.query(query, values);
    return parseInt(result.rows[0].total);
  }
};

module.exports = needsCalculationModel;
