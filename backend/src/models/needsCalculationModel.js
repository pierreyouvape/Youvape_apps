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

    // 5. Calculer le coefficient de tendance (régression linéaire si R² >= 0.7, sinon moyenne mobile pondérée)
    const trendResult = needsCalculationModel.calculateTrendCoefficient(monthlySales);
    const trendCoefficient = trendResult.coefficient;

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
      trend_r_squared: trendResult.rSquared,
      trend_method: trendResult.method,
      theoretical_need: Math.ceil(theoreticalNeed),
      supposed_need: Math.ceil(supposedNeed),
      trend_direction: trendCoefficient > 1.1 ? 'up' : trendCoefficient < 0.9 ? 'down' : 'stable'
    };
  },

  /**
   * Calculer le coefficient de tendance
   * Utilise la régression linéaire si R² >= 0.7 (tendance fiable)
   * Sinon utilise une moyenne mobile pondérée (mois récents pèsent plus)
   *
   * Retourne un objet :
   *   coefficient: > 1 = croissance, < 1 = décroissance, = 1 = stable
   *   rSquared: coefficient de détermination (null si moyenne mobile)
   *   method: 'linear_regression' ou 'weighted_moving_average'
   */
  calculateTrendCoefficient: (monthlySales) => {
    if (!monthlySales || monthlySales.length < 2) {
      return { coefficient: 1, rSquared: null, method: 'insufficient_data' };
    }

    const n = monthlySales.length;
    const sales = monthlySales.map(m => parseInt(m.total_qty) || 0);

    // Calculer la régression linéaire et le R²
    const regressionResult = needsCalculationModel.calculateLinearRegression(sales);

    // Si R² >= 0.7, utiliser la régression linéaire
    if (regressionResult.rSquared >= 0.7) {
      return {
        coefficient: regressionResult.coefficient,
        rSquared: Math.round(regressionResult.rSquared * 100) / 100,
        method: 'linear_regression'
      };
    }

    // Sinon, utiliser la moyenne mobile pondérée
    const wmaCoefficient = needsCalculationModel.calculateWeightedMovingAverage(sales);
    return {
      coefficient: wmaCoefficient,
      rSquared: Math.round(regressionResult.rSquared * 100) / 100,
      method: 'weighted_moving_average'
    };
  },

  /**
   * Régression linéaire avec calcul du R²
   */
  calculateLinearRegression: (sales) => {
    const n = sales.length;

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += sales[i];
      sumXY += i * sales[i];
      sumX2 += i * i;
      sumY2 += sales[i] * sales[i];
    }

    const avgX = sumX / n;
    const avgY = sumY / n;

    // Pente et ordonnée à l'origine
    const denominator = sumX2 - n * avgX * avgX;
    if (denominator === 0 || avgY === 0) {
      return { coefficient: 1, rSquared: 0 };
    }

    const slope = (sumXY - n * avgX * avgY) / denominator;
    const intercept = avgY - slope * avgX;

    // Calcul du R² (coefficient de détermination)
    // R² = 1 - (SS_res / SS_tot)
    // SS_res = somme des carrés des résidus
    // SS_tot = somme des carrés totaux
    let ssRes = 0, ssTot = 0;
    for (let i = 0; i < n; i++) {
      const predicted = slope * i + intercept;
      ssRes += Math.pow(sales[i] - predicted, 2);
      ssTot += Math.pow(sales[i] - avgY, 2);
    }

    const rSquared = ssTot === 0 ? 0 : 1 - (ssRes / ssTot);

    // Coefficient de tendance = valeur projetée / moyenne
    const projectedValue = avgY + slope * (n - avgX);
    let coefficient = avgY === 0 ? (projectedValue > 0 ? 2 : 1) : projectedValue / avgY;

    // Limiter entre 0.1 et 5
    coefficient = Math.max(0.1, Math.min(5, coefficient));

    return { coefficient, rSquared: Math.max(0, rSquared) };
  },

  /**
   * Moyenne mobile pondérée (les mois récents pèsent plus)
   * Poids : mois le plus récent = n, avant-dernier = n-1, etc.
   * Compare la moyenne pondérée récente vs ancienne
   */
  calculateWeightedMovingAverage: (sales) => {
    const n = sales.length;

    if (n < 2) return 1;

    // Calculer la moyenne pondérée totale
    // Poids croissants : 1, 2, 3, ..., n (plus récent = plus de poids)
    let weightedSum = 0;
    let totalWeight = 0;

    for (let i = 0; i < n; i++) {
      const weight = i + 1; // Poids croissant
      weightedSum += sales[i] * weight;
      totalWeight += weight;
    }

    const weightedAvg = weightedSum / totalWeight;

    // Moyenne simple (non pondérée)
    const simpleAvg = sales.reduce((a, b) => a + b, 0) / n;

    if (simpleAvg === 0) {
      return weightedAvg > 0 ? 1.5 : 1;
    }

    // Coefficient = moyenne pondérée / moyenne simple
    // Si pondérée > simple = tendance haussière (récent plus fort)
    // Si pondérée < simple = tendance baissière (récent plus faible)
    let coefficient = weightedAvg / simpleAvg;

    // Limiter entre 0.1 et 5
    return Math.max(0.1, Math.min(5, coefficient));
  },

  /**
   * Récupérer les besoins pour tous les produits (avec filtres)
   */
  getAllProductsNeeds: async (filters = {}) => {
    // Les paramètres passés par l'utilisateur ont la priorité
    // Sinon on utilise ceux du fournisseur si spécifié, sinon les défauts
    let analysisPeriodMonths = filters.analysis_period_months || 1;
    let coverageMonths = filters.coverage_months || 1;

    // Si un fournisseur est sélectionné et qu'on n'a pas de paramètres explicites,
    // utiliser les paramètres du fournisseur
    if (filters.supplier_id && !filters.analysis_period_months && !filters.coverage_months) {
      const supplierQuery = `
        SELECT analysis_period_months, coverage_months
        FROM suppliers WHERE id = $1
      `;
      const supplierResult = await pool.query(supplierQuery, [filters.supplier_id]);
      if (supplierResult.rows[0]) {
        analysisPeriodMonths = supplierResult.rows[0].analysis_period_months || 1;
        coverageMonths = parseFloat(supplierResult.rows[0].coverage_months) || 1;
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

    // Filtre stock nul ou négatif (3 états)
    if (filters.zero_stock === true) {
      productsQuery += ` AND (p.stock IS NULL OR p.stock <= 0)`;
    } else if (filters.zero_stock === false) {
      productsQuery += ` AND (p.stock IS NOT NULL AND p.stock > 0)`;
    }

    // Filtre par recherche
    if (filters.search) {
      productsQuery += ` AND (p.post_title ILIKE $${paramIndex} OR p.sku ILIKE $${paramIndex})`;
      values.push(`%${filters.search}%`);
      paramIndex++;
    }

    // Filtre avec ventes (3 états)
    if (filters.with_sales_only === true) {
      productsQuery += `
        AND EXISTS (
          SELECT 1 FROM order_items oi
          JOIN orders o ON oi.wp_order_id = o.wp_order_id
          WHERE oi.product_id = p.id
            AND o.post_date >= NOW() - INTERVAL '${analysisPeriodMonths} months'
            AND o.post_status IN ('wc-completed', 'wc-processing', 'wc-delivered')
        )
      `;
    } else if (filters.with_sales_only === false) {
      productsQuery += `
        AND NOT EXISTS (
          SELECT 1 FROM order_items oi
          JOIN orders o ON oi.wp_order_id = o.wp_order_id
          WHERE oi.product_id = p.id
            AND o.post_date >= NOW() - INTERVAL '${analysisPeriodMonths} months'
            AND o.post_status IN ('wc-completed', 'wc-processing', 'wc-delivered')
        )
      `;
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

    if (filters.zero_stock === true) {
      query += ` AND (p.stock IS NULL OR p.stock <= 0)`;
    } else if (filters.zero_stock === false) {
      query += ` AND (p.stock IS NOT NULL AND p.stock > 0)`;
    }

    if (filters.search) {
      query += ` AND (p.post_title ILIKE $${paramIndex} OR p.sku ILIKE $${paramIndex})`;
      values.push(`%${filters.search}%`);
      paramIndex++;
    }

    // Filtre avec ventes (3 états)
    if (filters.with_sales_only === true || filters.with_sales_only === false) {
      const analysisPeriodMonths = filters.analysis_period_months || 1;
      const existsClause = `
        EXISTS (
          SELECT 1 FROM order_items oi
          JOIN orders o ON oi.wp_order_id = o.wp_order_id
          WHERE oi.product_id = p.id
            AND o.post_date >= NOW() - INTERVAL '${analysisPeriodMonths} months'
            AND o.post_status IN ('wc-completed', 'wc-processing', 'wc-delivered')
        )
      `;
      query += filters.with_sales_only === true ? ` AND ${existsClause}` : ` AND NOT ${existsClause}`;
    }

    const result = await pool.query(query, values);
    return parseInt(result.rows[0].total);
  }
};

module.exports = needsCalculationModel;
