const pool = require('../config/database');

const needsCalculationModel = {
  /**
   * Retourne tous les produits publiés avec leurs données brutes pour calcul frontend :
   * - Ventes par mois sur la période demandée (une seule requête groupée)
   * - Max qty par commande sur la période (une seule requête groupée)
   * - Arrivages en cours (une seule requête groupée)
   * - Données produit + fournisseur + alert_threshold
   *
   * options.startDate / options.endDate : plage de dates (défaut: 12 derniers mois)
   * Le calcul de besoin/proposition est fait côté frontend.
   */
  getAllProductsRaw: async (supplierIdFilter = null, options = {}) => {
    // 1. Produits de base
    let productsQuery = `
      SELECT
        p.id,
        p.wp_product_id,
        p.post_title,
        p.sku,
        COALESCE(p.stock, 0) as stock,
        p.stock_status,
        p.regular_price,
        p.wc_cog_cost as cost_price,
        pa.alert_threshold,
        COALESCE(ps_primary.supplier_id, ps_any.supplier_id) as supplier_id,
        COALESCE(s_primary.name, s_any.name) as supplier_name,
        COALESCE(s_primary.analysis_period_months, s_any.analysis_period_months, 1) as supplier_analysis_period,
        COALESCE(s_primary.coverage_months, s_any.coverage_months, 1) as supplier_coverage_months,
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
    if (supplierIdFilter) {
      productsQuery += `
        AND EXISTS (
          SELECT 1 FROM product_suppliers ps
          WHERE ps.product_id = p.id AND ps.supplier_id = $1
        )
      `;
      values.push(supplierIdFilter);
    }

    productsQuery += ' ORDER BY p.post_title';

    const productsResult = await pool.query(productsQuery, values);
    const products = productsResult.rows;

    if (products.length === 0) return [];

    const productIds = products.map(p => p.id);
    const placeholders = productIds.map((_, i) => `$${i + 1}`).join(',');

    // Plage de dates pour les ventes
    const { startDate, endDate } = options;
    let dateFilter;
    let dateParams;
    if (startDate && endDate) {
      dateFilter = `AND o.post_date >= $${productIds.length + 1} AND o.post_date < $${productIds.length + 2} + INTERVAL '1 day'`;
      dateParams = [...productIds, startDate, endDate];
    } else {
      dateFilter = `AND o.post_date >= NOW() - INTERVAL '12 months'`;
      dateParams = productIds;
    }

    // 2. Ventes par mois sur la période demandée (une seule requête)
    const monthlySalesResult = await pool.query(`
      SELECT
        oi.product_id,
        DATE_TRUNC('month', o.post_date) as month,
        SUM(oi.qty) as total_qty
      FROM order_items oi
      JOIN orders o ON oi.wp_order_id = o.wp_order_id
      WHERE oi.product_id IN (${placeholders})
        ${dateFilter}
        AND o.post_status IN ('wc-completed', 'wc-processing', 'wc-delivered')
      GROUP BY oi.product_id, DATE_TRUNC('month', o.post_date)
      ORDER BY oi.product_id, month
    `, dateParams);

    // 3. Max qty par commande sur la période (pour le calcul de sécurité)
    const maxOrderResult = await pool.query(`
      SELECT
        oi.product_id,
        MAX(oi.qty) as max_order_qty
      FROM order_items oi
      JOIN orders o ON oi.wp_order_id = o.wp_order_id
      WHERE oi.product_id IN (${placeholders})
        ${dateFilter}
        AND o.post_status IN ('wc-completed', 'wc-processing', 'wc-delivered')
      GROUP BY oi.product_id
    `, dateParams);

    // 4. Arrivages en cours (une seule requête)
    const incomingResult = await pool.query(`
      SELECT
        poi.product_id,
        COALESCE(SUM(poi.qty_ordered - poi.qty_received), 0) as incoming_qty
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.purchase_order_id = po.id
      WHERE poi.product_id IN (${placeholders})
        AND po.status IN ('sent', 'confirmed', 'shipped', 'partial')
      GROUP BY poi.product_id
    `, productIds);

    // Indexer par product_id
    const monthlySalesMap = new Map(); // product_id → [{month, total_qty}]
    for (const row of monthlySalesResult.rows) {
      if (!monthlySalesMap.has(row.product_id)) monthlySalesMap.set(row.product_id, []);
      monthlySalesMap.get(row.product_id).push({
        month: row.month,
        total_qty: parseInt(row.total_qty) || 0
      });
    }

    const maxOrderMap = new Map(); // product_id → max_order_qty
    for (const row of maxOrderResult.rows) {
      maxOrderMap.set(row.product_id, parseInt(row.max_order_qty) || 0);
    }

    const incomingMap = new Map(); // product_id → incoming_qty
    for (const row of incomingResult.rows) {
      incomingMap.set(row.product_id, parseInt(row.incoming_qty) || 0);
    }

    // Assembler la réponse
    return products.map(p => ({
      id: p.id,
      wp_product_id: p.wp_product_id,
      post_title: p.post_title,
      sku: p.sku,
      stock: parseInt(p.stock) || 0,
      stock_status: p.stock_status,
      regular_price: p.regular_price,
      cost_price: p.cost_price,
      alert_threshold: parseInt(p.alert_threshold) || 0,
      supplier_id: p.supplier_id,
      supplier_name: p.supplier_name,
      supplier_analysis_period: parseFloat(p.supplier_analysis_period) || 1,
      supplier_coverage_months: parseFloat(p.supplier_coverage_months) || 1,
      supplier_sku: p.supplier_sku,
      supplier_price: p.supplier_price,
      incoming_qty: incomingMap.get(p.id) || 0,
      max_order_qty_12m: maxOrderMap.get(p.id) || 0,
      monthly_sales: monthlySalesMap.get(p.id) || [] // [{month, total_qty}]
    }));
  },

  // Gardé pour compatibilité (utilisé par getProductNeed individuel)
  calculateProductNeeds: async (productId, analysisPeriodMonths = 1, coverageMonths = 1) => {
    const salesDataQuery = `
      SELECT
        DATE_TRUNC('month', o.post_date) as month,
        SUM(oi.qty) as total_qty
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

    const avgMonthlySales = analysisPeriodMonths > 0 ? salesInPeriod / analysisPeriodMonths : 0;
    const trendResult = needsCalculationModel.calculateTrendCoefficient(monthlySales);
    const trendCoefficient = trendResult.coefficient;

    const fifteenDaysSales = avgMonthlySales / 2;
    const projectedMonthlySales = avgMonthlySales * trendCoefficient;
    const fifteenDaysProjected = projectedMonthlySales / 2;

    const theoreticalCoverage = avgMonthlySales * coverageMonths;
    const theoreticalSafety = maxOrderQty + fifteenDaysSales;
    const theoreticalNeed = Math.max(theoreticalCoverage, theoreticalSafety);

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
      trend_r_squared: trendResult.rSquared,
      trend_method: trendResult.method,
      theoretical_need: Math.ceil(theoreticalNeed),
      supposed_need: Math.ceil(supposedNeed),
      trend_direction: trendCoefficient > 1.1 ? 'up' : trendCoefficient < 0.9 ? 'down' : 'stable'
    };
  },

  calculateTrendCoefficient: (monthlySales) => {
    if (!monthlySales || monthlySales.length < 2) {
      return { coefficient: 1, rSquared: null, method: 'insufficient_data' };
    }
    const sales = monthlySales.map(m => parseInt(m.total_qty) || 0);
    const regressionResult = needsCalculationModel.calculateLinearRegression(sales);
    if (regressionResult.rSquared >= 0.7) {
      return {
        coefficient: regressionResult.coefficient,
        rSquared: Math.round(regressionResult.rSquared * 100) / 100,
        method: 'linear_regression'
      };
    }
    const wmaCoefficient = needsCalculationModel.calculateWeightedMovingAverage(sales);
    return {
      coefficient: wmaCoefficient,
      rSquared: Math.round(regressionResult.rSquared * 100) / 100,
      method: 'weighted_moving_average'
    };
  },

  calculateLinearRegression: (sales) => {
    const n = sales.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += i; sumY += sales[i];
      sumXY += i * sales[i]; sumX2 += i * i;
    }
    const avgX = sumX / n;
    const avgY = sumY / n;
    const denominator = sumX2 - n * avgX * avgX;
    if (denominator === 0 || avgY === 0) return { coefficient: 1, rSquared: 0 };
    const slope = (sumXY - n * avgX * avgY) / denominator;
    const intercept = avgY - slope * avgX;
    let ssRes = 0, ssTot = 0;
    for (let i = 0; i < n; i++) {
      ssRes += Math.pow(sales[i] - (slope * i + intercept), 2);
      ssTot += Math.pow(sales[i] - avgY, 2);
    }
    const rSquared = ssTot === 0 ? 0 : 1 - (ssRes / ssTot);
    const projectedValue = avgY + slope * (n - avgX);
    let coefficient = avgY === 0 ? (projectedValue > 0 ? 2 : 1) : projectedValue / avgY;
    coefficient = Math.max(0.1, Math.min(5, coefficient));
    return { coefficient, rSquared: Math.max(0, rSquared) };
  },

  calculateWeightedMovingAverage: (sales) => {
    const n = sales.length;
    if (n < 2) return 1;
    let weightedSum = 0, totalWeight = 0;
    for (let i = 0; i < n; i++) {
      const weight = i + 1;
      weightedSum += sales[i] * weight;
      totalWeight += weight;
    }
    const weightedAvg = weightedSum / totalWeight;
    const simpleAvg = sales.reduce((a, b) => a + b, 0) / n;
    if (simpleAvg === 0) return weightedAvg > 0 ? 1.5 : 1;
    return Math.max(0.1, Math.min(5, weightedAvg / simpleAvg));
  }
};

module.exports = needsCalculationModel;
