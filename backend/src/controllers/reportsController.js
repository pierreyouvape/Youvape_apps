const pool = require('../config/database');

/**
 * Rapport Chiffre d'affaires (Revenue)
 * POST /api/reports/revenue
 */
exports.getRevenueReport = async (req, res) => {
  try {
    const { dateFrom, dateTo, statuses } = req.body;

    // Conditions de base
    let conditions = [];
    let params = [];
    let paramIndex = 1;

    // Statuts: exclure cancelled, refunded, failed, on-hold, pending (commandes non payées)
    if (statuses && statuses.length > 0) {
      conditions.push(`o.post_status = ANY($${paramIndex})`);
      params.push(statuses);
      paramIndex++;
    } else {
      conditions.push(`o.post_status NOT IN ('wc-cancelled', 'wc-refunded', 'wc-failed', 'wc-on-hold', 'wc-pending')`);
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

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // 1. KPIs globaux de la période
    const kpisQuery = `
      SELECT
        COUNT(*)::int as orders_count,
        COALESCE(SUM(order_total), 0)::numeric as gross_sales,
        COALESCE(SUM(order_tax), 0)::numeric as taxes,
        COALESCE(SUM(order_shipping), 0)::numeric as shipping,
        COALESCE(SUM(cart_discount), 0)::numeric as discounts,
        0::numeric as refunds,
        0::numeric as fees
      FROM (
        SELECT DISTINCT o.wp_order_id, o.order_total, o.order_tax, o.order_shipping, o.cart_discount
        FROM orders o
        ${whereClause}
      ) unique_orders
    `;
    const kpisResult = await pool.query(kpisQuery, params);
    const kpis = kpisResult.rows[0];

    // 1b. Remboursements PARTIELS (à déduire du CA - commandes non-refunded)
    let partialRefundsConditions = [
      `o.post_status NOT IN ('wc-refunded', 'wc-cancelled', 'wc-failed')`
    ];
    let partialRefundsParams = [];
    let partialRefundsParamIndex = 1;

    if (dateFrom) {
      partialRefundsConditions.push(`r.refund_date >= $${partialRefundsParamIndex}`);
      partialRefundsParams.push(dateFrom);
      partialRefundsParamIndex++;
    }
    if (dateTo) {
      partialRefundsConditions.push(`r.refund_date <= $${partialRefundsParamIndex}`);
      partialRefundsParams.push(dateTo + ' 23:59:59');
      partialRefundsParamIndex++;
    }

    const partialRefundsQuery = `
      SELECT COALESCE(SUM(r.refund_amount), 0)::numeric as total_refunds
      FROM refunds r
      JOIN orders o ON r.wp_order_id = o.wp_order_id
      WHERE ${partialRefundsConditions.join(' AND ')}
    `;
    const partialRefundsResult = await pool.query(partialRefundsQuery, partialRefundsParams);
    const partialRefunds = parseFloat(partialRefundsResult.rows[0].total_refunds) || 0;

    // 1c. TOUS les remboursements (pour le KPI)
    let allRefundsConditions = [];
    let allRefundsParams = [];
    let allRefundsParamIndex = 1;

    if (dateFrom) {
      allRefundsConditions.push(`r.refund_date >= $${allRefundsParamIndex}`);
      allRefundsParams.push(dateFrom);
      allRefundsParamIndex++;
    }
    if (dateTo) {
      allRefundsConditions.push(`r.refund_date <= $${allRefundsParamIndex}`);
      allRefundsParams.push(dateTo + ' 23:59:59');
      allRefundsParamIndex++;
    }

    const allRefundsWhereClause = allRefundsConditions.length > 0 ? 'WHERE ' + allRefundsConditions.join(' AND ') : '';
    const allRefundsQuery = `
      SELECT COALESCE(SUM(r.refund_amount), 0)::numeric as total_refunds
      FROM refunds r
      ${allRefundsWhereClause}
    `;
    const allRefundsResult = await pool.query(allRefundsQuery, allRefundsParams);
    const totalRefunds = parseFloat(allRefundsResult.rows[0].total_refunds) || 0;

    // Calculer le CA
    const grossSales = parseFloat(kpis.gross_sales) || 0;
    const taxes = parseFloat(kpis.taxes) || 0;
    const shipping = parseFloat(kpis.shipping) || 0;
    const fees = parseFloat(kpis.fees) || 0;

    // 2. Breakdown jour par jour
    const breakdownQuery = `
      SELECT
        date,
        COUNT(*)::int as orders_count,
        COALESCE(SUM(order_total), 0)::numeric as gross_sales,
        COALESCE(SUM(order_tax), 0)::numeric as taxes,
        COALESCE(SUM(order_shipping), 0)::numeric as shipping,
        0::numeric as fees,
        0::numeric as refunds
      FROM (
        SELECT DISTINCT o.wp_order_id, o.order_total, o.order_tax, o.order_shipping, DATE_TRUNC('day', o.post_date)::date as date
        FROM orders o
        ${whereClause}
      ) unique_orders
      GROUP BY date
      ORDER BY date ASC
    `;
    const breakdownResult = await pool.query(breakdownQuery, params);

    // Calculer le net pour chaque jour
    const breakdown = breakdownResult.rows.map(row => {
      const dayGross = parseFloat(row.gross_sales) || 0;
      const dayTaxes = parseFloat(row.taxes) || 0;
      const dayShipping = parseFloat(row.shipping) || 0;
      const dayRefunds = parseFloat(row.refunds) || 0;
      const dayFees = parseFloat(row.fees) || 0;
      const dayNet = dayGross - dayTaxes - dayShipping - dayRefunds - dayFees;

      return {
        date: row.date,
        orders_count: row.orders_count,
        gross_sales: dayGross.toFixed(2),
        taxes: dayTaxes.toFixed(2),
        shipping: dayShipping.toFixed(2),
        fees: dayFees.toFixed(2),
        refunds: dayRefunds.toFixed(2),
        net: dayNet.toFixed(2)
      };
    });

    // CA TTC net = CA TTC brut - remboursements partiels (les complets sont déjà exclus via statut wc-refunded)
    const caTTCNet = grossSales - partialRefunds;
    // CA HT net = CA TTC net - TVA (proportionnelle)
    // On calcule le ratio TVA/TTC pour l'appliquer aux remboursements partiels
    const taxRatio = grossSales > 0 ? taxes / grossSales : 0;
    const partialRefundsTax = partialRefunds * taxRatio;
    const caHTNet = caTTCNet - (taxes - partialRefundsTax);
    // Panier moyen HT = CA HT net / Nb commandes
    const avgOrderHT = kpis.orders_count > 0 ? caHTNet / kpis.orders_count : 0;

    res.json({
      success: true,
      data: {
        kpis: {
          orders_count: kpis.orders_count,
          ca_ttc: caTTCNet.toFixed(2),
          ca_ht: caHTNet.toFixed(2),
          taxes: (taxes - partialRefundsTax).toFixed(2),
          refunds: totalRefunds.toFixed(2),
          avg_order_ht: avgOrderHT.toFixed(2)
        },
        breakdown
      }
    });
  } catch (error) {
    console.error('Error getting revenue report:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Rapport par Pays
 * POST /api/reports/by-country
 */
exports.getByCountryReport = async (req, res) => {
  try {
    const { dateFrom, dateTo, statuses, groupBy = 'billing_country' } = req.body;

    let conditions = [];
    let params = [];
    let paramIndex = 1;

    if (statuses && statuses.length > 0) {
      conditions.push(`o.post_status = ANY($${paramIndex})`);
      params.push(statuses);
      paramIndex++;
    } else {
      conditions.push(`o.post_status IN ('wc-completed', 'wc-delivered')`);
    }

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

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const countryField = groupBy === 'shipping_country' ? 'o.shipping_country' : 'o.billing_country';

    const query = `
      SELECT
        country_code,
        COUNT(*)::int as orders_count,
        COALESCE(SUM(order_total), 0)::numeric as gross_sales,
        COALESCE(SUM(order_tax), 0)::numeric as taxes,
        COALESCE(SUM(order_shipping), 0)::numeric as shipping
      FROM (
        SELECT DISTINCT o.wp_order_id, o.order_total, o.order_tax, o.order_shipping, ${countryField} as country_code
        FROM orders o
        ${whereClause}
      ) unique_orders
      WHERE country_code IS NOT NULL AND country_code != ''
      GROUP BY country_code
      ORDER BY orders_count DESC
    `;

    const result = await pool.query(query, params);

    const data = result.rows.map(row => {
      const gross = parseFloat(row.gross_sales) || 0;
      const tax = parseFloat(row.taxes) || 0;
      const ship = parseFloat(row.shipping) || 0;
      const net = gross - tax - ship;
      const avgNet = row.orders_count > 0 ? net / row.orders_count : 0;
      const avgGross = row.orders_count > 0 ? gross / row.orders_count : 0;

      return {
        country_code: row.country_code,
        orders_count: row.orders_count,
        net_revenue: net.toFixed(2),
        avg_net: avgNet.toFixed(2),
        gross_sales: gross.toFixed(2),
        avg_gross: avgGross.toFixed(2)
      };
    });

    res.json({ success: true, data });
  } catch (error) {
    console.error('Error getting by-country report:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Rapport par Taux de TVA
 * POST /api/reports/by-tax
 */
exports.getByTaxReport = async (req, res) => {
  try {
    const { dateFrom, dateTo, statuses } = req.body;

    let conditions = [];
    let params = [];
    let paramIndex = 1;

    if (statuses && statuses.length > 0) {
      conditions.push(`o.post_status = ANY($${paramIndex})`);
      params.push(statuses);
      paramIndex++;
    } else {
      conditions.push(`o.post_status IN ('wc-completed', 'wc-delivered')`);
    }

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

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // On groupe par pays car la TVA dépend du pays
    const query = `
      SELECT
        tax_code,
        COUNT(*)::int as orders_count,
        COALESCE(SUM(order_tax), 0)::numeric as net_tax,
        0::numeric as refunded_tax,
        COALESCE(SUM(order_tax), 0)::numeric as total_tax,
        COALESCE(SUM(order_shipping_tax), 0)::numeric as shipping_tax
      FROM (
        SELECT DISTINCT
          o.wp_order_id,
          o.order_tax,
          o.order_shipping_tax,
          CONCAT(o.billing_country, '-TVA 20%') as tax_code
        FROM orders o
        ${whereClause}
      ) unique_orders
      WHERE tax_code IS NOT NULL
      GROUP BY tax_code
      ORDER BY orders_count DESC
    `;

    const result = await pool.query(query, params);

    const data = result.rows.map(row => ({
      tax_code: row.tax_code,
      orders_count: row.orders_count,
      net_tax: parseFloat(row.net_tax).toFixed(2),
      refunded_tax: parseFloat(row.refunded_tax).toFixed(2),
      total_tax: parseFloat(row.total_tax).toFixed(2),
      shipping_tax: parseFloat(row.shipping_tax).toFixed(2)
    }));

    res.json({ success: true, data });
  } catch (error) {
    console.error('Error getting by-tax report:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Rapport Profit
 * POST /api/reports/profit
 */
exports.getProfitReport = async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.body;

    let conditions = [`o.post_status NOT IN ('wc-cancelled', 'wc-refunded', 'wc-failed', 'wc-on-hold', 'wc-pending')`];
    let params = [];
    let paramIndex = 1;

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

    const whereClause = 'WHERE ' + conditions.join(' AND ');

    // KPIs globaux avec coûts
    const kpisQuery = `
      SELECT
        COUNT(DISTINCT o.wp_order_id)::int as orders_count,
        COALESCE(SUM(o.order_total), 0)::numeric as gross_sales,
        COALESCE(SUM(o.order_tax), 0)::numeric as taxes,
        COALESCE(SUM(o.order_shipping), 0)::numeric as shipping_charged,
        COALESCE(SUM(o.shipping_cost_calculated), 0)::numeric as shipping_cost,
        COALESCE(SUM(o.order_total_cost), 0)::numeric as core_cost
      FROM orders o
      ${whereClause}
    `;
    const kpisResult = await pool.query(kpisQuery, params);
    const kpis = kpisResult.rows[0];

    // Calculer les coûts produits depuis order_items si order_total_cost est vide
    const productCostQuery = `
      SELECT COALESCE(SUM(oi.item_total_cost), 0)::numeric as product_cost
      FROM order_items oi
      JOIN orders o ON oi.wp_order_id = o.wp_order_id
      ${whereClause}
    `;
    const productCostResult = await pool.query(productCostQuery, params);
    const productCost = parseFloat(productCostResult.rows[0]?.product_cost) || parseFloat(kpis.core_cost) || 0;

    // Remboursements sur la période
    let refundsParams = [];
    let refundsConditions = [];
    let refundsParamIndex = 1;

    if (dateFrom) {
      refundsConditions.push(`r.refund_date >= $${refundsParamIndex}`);
      refundsParams.push(dateFrom);
      refundsParamIndex++;
    }
    if (dateTo) {
      refundsConditions.push(`r.refund_date <= $${refundsParamIndex}`);
      refundsParams.push(dateTo + ' 23:59:59');
      refundsParamIndex++;
    }

    const refundsWhereClause = refundsConditions.length > 0 ? 'WHERE ' + refundsConditions.join(' AND ') : '';
    const refundsQuery = `SELECT COALESCE(SUM(refund_amount), 0)::numeric as total FROM refunds r ${refundsWhereClause}`;
    const refundsResult = await pool.query(refundsQuery, refundsParams);
    const refunds = parseFloat(refundsResult.rows[0].total) || 0;

    // Récupérer les taux de frais depuis la table payment_methods
    const paymentMethodsResult = await pool.query(
      'SELECT wc_payment_method, fixed_fee, percent_fee FROM payment_methods WHERE is_active = true'
    );
    const paymentMethodsMap = {};
    paymentMethodsResult.rows.forEach(pm => {
      if (pm.wc_payment_method) {
        paymentMethodsMap[pm.wc_payment_method] = {
          fixed_fee: parseFloat(pm.fixed_fee) || 0,
          percent_fee: parseFloat(pm.percent_fee) || 0
        };
      }
    });

    // Calculer les transaction costs depuis la base
    const transactionCostQuery = `
      SELECT
        COALESCE(payment_method_title, 'default') as payment_method,
        COUNT(DISTINCT wp_order_id)::int as orders_count,
        COALESCE(SUM(order_total), 0)::numeric as total_amount
      FROM orders o
      ${whereClause}
      GROUP BY payment_method_title
    `;
    const transactionCostResult = await pool.query(transactionCostQuery, params);
    let transactionCost = 0;
    transactionCostResult.rows.forEach(row => {
      const amount = parseFloat(row.total_amount) || 0;
      const ordersCount = row.orders_count || 0;
      const pm = paymentMethodsMap[row.payment_method];
      if (pm) {
        // Frais = (montant * pourcentage/100) + (frais fixe * nombre de commandes)
        transactionCost += (amount * pm.percent_fee / 100) + (pm.fixed_fee * ordersCount);
      } else {
        // Fallback: 2% par défaut si méthode non configurée
        transactionCost += amount * 0.02;
      }
    });

    // Calculs
    const grossSales = parseFloat(kpis.gross_sales) || 0;
    const taxes = parseFloat(kpis.taxes) || 0;
    const shippingCharged = parseFloat(kpis.shipping_charged) || 0;
    const shippingCost = parseFloat(kpis.shipping_cost) || 0;
    const coreCost = productCost;

    // Net Revenue = Gross Sales - Taxes - Refunds
    const netRevenue = grossSales - taxes - refunds;
    // Total Cost = Core Cost + Shipping Cost + Transaction Cost
    const totalCost = coreCost + shippingCost + transactionCost;
    // Profit = Net Revenue - Total Cost
    const profit = netRevenue - totalCost;
    // Margin = Profit / Net Revenue * 100
    const margin = netRevenue > 0 ? (profit / netRevenue) * 100 : 0;
    // Avg Profit per order
    const avgProfit = kpis.orders_count > 0 ? profit / kpis.orders_count : 0;

    // Breakdown jour par jour
    const breakdownQuery = `
      SELECT
        DATE_TRUNC('day', o.post_date)::date as date,
        COUNT(DISTINCT o.wp_order_id)::int as orders_count,
        COALESCE(SUM(o.order_total), 0)::numeric as gross_sales,
        COALESCE(SUM(o.order_tax), 0)::numeric as taxes,
        COALESCE(SUM(o.order_total_cost), 0)::numeric as core_cost,
        COALESCE(SUM(o.shipping_cost_calculated), 0)::numeric as shipping_cost
      FROM orders o
      ${whereClause}
      GROUP BY DATE_TRUNC('day', o.post_date)::date
      ORDER BY date ASC
    `;
    const breakdownResult = await pool.query(breakdownQuery, params);

    // Calculer les refunds par jour
    const refundsByDayQuery = `
      SELECT
        DATE_TRUNC('day', r.refund_date)::date as date,
        COALESCE(SUM(r.refund_amount), 0)::numeric as refunds
      FROM refunds r
      ${refundsWhereClause}
      GROUP BY DATE_TRUNC('day', r.refund_date)::date
    `;
    const refundsByDayResult = await pool.query(refundsByDayQuery, refundsParams);
    const refundsByDay = {};
    refundsByDayResult.rows.forEach(r => {
      refundsByDay[r.date] = parseFloat(r.refunds) || 0;
    });

    const breakdown = breakdownResult.rows.map(row => {
      const dayGross = parseFloat(row.gross_sales) || 0;
      const dayTaxes = parseFloat(row.taxes) || 0;
      const dayRefunds = refundsByDay[row.date] || 0;
      const dayCoreCost = parseFloat(row.core_cost) || 0;
      const dayShippingCost = parseFloat(row.shipping_cost) || 0;

      const dayNetRevenue = dayGross - dayTaxes - dayRefunds;
      const dayTotalCost = dayCoreCost + dayShippingCost;
      const dayProfit = dayNetRevenue - dayTotalCost;
      const dayMargin = dayNetRevenue > 0 ? (dayProfit / dayNetRevenue) * 100 : 0;

      return {
        date: row.date,
        orders_count: row.orders_count,
        gross_sales: dayGross.toFixed(2),
        taxes: dayTaxes.toFixed(2),
        refunds: dayRefunds.toFixed(2),
        net_revenue: dayNetRevenue.toFixed(2),
        cost: dayTotalCost.toFixed(2),
        profit: dayProfit.toFixed(2),
        margin: dayMargin.toFixed(2)
      };
    });

    res.json({
      success: true,
      data: {
        kpis: {
          orders_count: kpis.orders_count,
          net_revenue: netRevenue.toFixed(2),
          total_cost: totalCost.toFixed(2),
          profit: profit.toFixed(2),
          margin: margin.toFixed(2),
          avg_profit: avgProfit.toFixed(2)
        },
        cost_breakdown: {
          net_revenue: netRevenue.toFixed(2),
          shipping_cost: shippingCost.toFixed(2),
          transaction_cost: transactionCost.toFixed(2),
          core_cost: coreCost.toFixed(2)
        },
        breakdown
      }
    });
  } catch (error) {
    console.error('Error getting profit report:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Coûts de transaction par méthode de paiement
 * POST /api/reports/profit/transaction-costs
 */
exports.getTransactionCosts = async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.body;

    let conditions = [`o.post_status NOT IN ('wc-cancelled', 'wc-refunded', 'wc-failed', 'wc-on-hold', 'wc-pending')`];
    let params = [];
    let paramIndex = 1;

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

    const whereClause = 'WHERE ' + conditions.join(' AND ');

    // Grouper par méthode de paiement
    // Pour l'instant, on n'a pas les frais de transaction stockés, on affiche juste les stats
    const query = `
      SELECT
        COALESCE(payment_method_title, 'Non défini') as payment_method,
        COUNT(DISTINCT wp_order_id)::int as orders_count,
        COALESCE(SUM(order_total), 0)::numeric as total_amount
      FROM orders o
      ${whereClause}
      GROUP BY payment_method_title
      ORDER BY orders_count DESC
    `;
    const result = await pool.query(query, params);

    // Récupérer les taux depuis la table payment_methods
    const paymentMethodsResult = await pool.query(
      'SELECT wc_payment_method, fixed_fee, percent_fee FROM payment_methods WHERE is_active = true'
    );
    const paymentMethodsMap = {};
    paymentMethodsResult.rows.forEach(pm => {
      if (pm.wc_payment_method) {
        paymentMethodsMap[pm.wc_payment_method] = {
          fixed_fee: parseFloat(pm.fixed_fee) || 0,
          percent_fee: parseFloat(pm.percent_fee) || 0
        };
      }
    });

    const data = result.rows.map(row => {
      const total = parseFloat(row.total_amount) || 0;
      const ordersCount = row.orders_count || 0;
      const pm = paymentMethodsMap[row.payment_method];
      let transactionCost, avgPercent;

      if (pm) {
        transactionCost = (total * pm.percent_fee / 100) + (pm.fixed_fee * ordersCount);
        // Pourcentage effectif = coût total / montant total * 100
        avgPercent = total > 0 ? (transactionCost / total) * 100 : 0;
      } else {
        // Fallback 2%
        transactionCost = total * 0.02;
        avgPercent = 2;
      }

      return {
        payment_method: row.payment_method,
        orders_count: row.orders_count,
        transaction_cost: transactionCost.toFixed(2),
        avg_percent: avgPercent.toFixed(2)
      };
    });

    res.json({ success: true, data });
  } catch (error) {
    console.error('Error getting transaction costs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Rapport Commandes (Orders)
 * POST /api/reports/orders
 */
exports.getOrdersReport = async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.body;

    let conditions = [];
    let params = [];
    let paramIndex = 1;

    // Toutes les commandes sauf failed
    conditions.push(`o.post_status NOT IN ('wc-failed', 'wc-trash')`);

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

    const whereClause = 'WHERE ' + conditions.join(' AND ');

    // 1. KPIs globaux
    const kpisQuery = `
      SELECT
        COUNT(DISTINCT o.wp_order_id)::int as orders_count,
        COUNT(DISTINCT o.wp_customer_id)::int as customers_count,
        COALESCE(SUM(o.order_total), 0)::numeric as gross_sales,
        COALESCE(SUM(o.order_tax), 0)::numeric as taxes,
        COALESCE(SUM(o.order_shipping), 0)::numeric as shipping,
        COALESCE(SUM(o.cart_discount), 0)::numeric as discounts,
        COALESCE(SUM(
          (SELECT COUNT(*) FROM order_items oi WHERE oi.wp_order_id = o.wp_order_id)
        ), 0)::int as total_items
      FROM orders o
      ${whereClause}
    `;
    const kpisResult = await pool.query(kpisQuery, params);
    const kpis = kpisResult.rows[0];

    // Calculer les métriques dérivées
    const grossSales = parseFloat(kpis.gross_sales) || 0;
    const taxes = parseFloat(kpis.taxes) || 0;
    const shipping = parseFloat(kpis.shipping) || 0;
    const discounts = parseFloat(kpis.discounts) || 0;
    const netSales = grossSales - taxes - shipping;
    const avgOrderNet = kpis.orders_count > 0 ? netSales / kpis.orders_count : 0;
    const avgOrderGross = kpis.orders_count > 0 ? grossSales / kpis.orders_count : 0;
    const avgItems = kpis.orders_count > 0 ? kpis.total_items / kpis.orders_count : 0;

    // 2. Remboursements sur la période
    let refundsParams = [];
    let refundsConditions = [];
    let refundsParamIndex = 1;
    if (dateFrom) {
      refundsConditions.push(`r.refund_date >= $${refundsParamIndex}`);
      refundsParams.push(dateFrom);
      refundsParamIndex++;
    }
    if (dateTo) {
      refundsConditions.push(`r.refund_date <= $${refundsParamIndex}`);
      refundsParams.push(dateTo + ' 23:59:59');
      refundsParamIndex++;
    }
    const refundsWhereClause = refundsConditions.length > 0 ? 'WHERE ' + refundsConditions.join(' AND ') : '';
    const refundsQuery = `SELECT COALESCE(SUM(refund_amount), 0)::numeric as total FROM refunds r ${refundsWhereClause}`;
    const refundsResult = await pool.query(refundsQuery, refundsParams);
    const refunds = parseFloat(refundsResult.rows[0].total) || 0;

    // 3. Breakdown jour par jour
    const breakdownQuery = `
      SELECT
        DATE_TRUNC('day', o.post_date)::date as date,
        COUNT(DISTINCT o.wp_order_id)::int as orders_count,
        COALESCE(SUM(o.order_total), 0)::numeric as gross_sales,
        COALESCE(SUM(o.order_tax), 0)::numeric as taxes,
        COALESCE(SUM(o.order_shipping), 0)::numeric as shipping
      FROM orders o
      ${whereClause}
      GROUP BY DATE_TRUNC('day', o.post_date)::date
      ORDER BY date ASC
    `;
    const breakdownResult = await pool.query(breakdownQuery, params);
    const breakdown = breakdownResult.rows.map(row => {
      const gross = parseFloat(row.gross_sales) || 0;
      const tax = parseFloat(row.taxes) || 0;
      const ship = parseFloat(row.shipping) || 0;
      const net = gross - tax - ship;
      return {
        date: row.date,
        orders_count: row.orders_count,
        gross_sales: gross.toFixed(2),
        net_sales: net.toFixed(2),
        avg_order: row.orders_count > 0 ? (gross / row.orders_count).toFixed(2) : '0.00'
      };
    });

    // 4. New vs Returning customers
    const newVsReturningQuery = `
      WITH customer_orders AS (
        SELECT
          o.wp_customer_id,
          MIN(o.post_date) as first_order_date,
          o.wp_order_id,
          o.order_total,
          o.order_tax,
          o.order_shipping,
          o.post_date
        FROM orders o
        ${whereClause}
        GROUP BY o.wp_customer_id, o.wp_order_id, o.order_total, o.order_tax, o.order_shipping, o.post_date
      ),
      customer_type AS (
        SELECT
          co.*,
          CASE
            WHEN co.post_date = (SELECT MIN(o2.post_date) FROM orders o2 WHERE o2.wp_customer_id = co.wp_customer_id)
            THEN 'new'
            ELSE 'returning'
          END as customer_type
        FROM customer_orders co
      )
      SELECT
        customer_type,
        COUNT(DISTINCT wp_customer_id)::int as customers,
        COUNT(*)::int as orders,
        COALESCE(SUM(order_total), 0)::numeric as gross_sales,
        COALESCE(SUM(order_total - order_tax - order_shipping), 0)::numeric as net_sales
      FROM customer_type
      GROUP BY customer_type
    `;
    const newVsReturningResult = await pool.query(newVsReturningQuery, params);
    const newVsReturning = newVsReturningResult.rows.map(row => ({
      type: row.customer_type === 'new' ? 'Nouveau' : 'Fidèle',
      customers: row.customers,
      orders: row.orders,
      net_sales: parseFloat(row.net_sales).toFixed(2),
      gross_sales: parseFloat(row.gross_sales).toFixed(2),
      avg_net: row.orders > 0 ? (parseFloat(row.net_sales) / row.orders).toFixed(2) : '0.00',
      avg_gross: row.orders > 0 ? (parseFloat(row.gross_sales) / row.orders).toFixed(2) : '0.00'
    }));

    // 5. Grouped by Status
    const byStatusQuery = `
      SELECT
        o.post_status as status,
        COUNT(DISTINCT o.wp_order_id)::int as orders,
        COALESCE(SUM(
          (SELECT COUNT(*) FROM order_items oi WHERE oi.wp_order_id = o.wp_order_id)
        ), 0)::int as items,
        COUNT(DISTINCT o.wp_customer_id)::int as customers,
        COALESCE(SUM(o.order_total - o.order_tax - o.order_shipping), 0)::numeric as net_sales,
        COALESCE(SUM(o.order_total), 0)::numeric as gross_sales
      FROM orders o
      ${whereClause}
      GROUP BY o.post_status
      ORDER BY orders DESC
    `;
    const byStatusResult = await pool.query(byStatusQuery, params);
    const statusLabels = {
      'wc-completed': 'Terminée',
      'wc-delivered': 'Livrée',
      'wc-processing': 'En cours',
      'wc-on-hold': 'En attente',
      'wc-pending': 'En attente paiement',
      'wc-cancelled': 'Annulée',
      'wc-refunded': 'Remboursée',
      'wc-failed': 'Échouée'
    };
    const byStatus = byStatusResult.rows.map(row => ({
      status: statusLabels[row.status] || row.status,
      status_code: row.status,
      orders: row.orders,
      items: row.items,
      customers: row.customers,
      net_sales: parseFloat(row.net_sales).toFixed(2),
      gross_sales: parseFloat(row.gross_sales).toFixed(2),
      avg_net: row.orders > 0 ? (parseFloat(row.net_sales) / row.orders).toFixed(2) : '0.00',
      avg_gross: row.orders > 0 ? (parseFloat(row.gross_sales) / row.orders).toFixed(2) : '0.00'
    }));

    // 6. Grouped by Payment Method
    const byPaymentQuery = `
      SELECT
        COALESCE(o.payment_method_title, 'Non défini') as payment_method,
        COUNT(DISTINCT o.wp_order_id)::int as orders,
        COALESCE(SUM(
          (SELECT COUNT(*) FROM order_items oi WHERE oi.wp_order_id = o.wp_order_id)
        ), 0)::int as items,
        COUNT(DISTINCT o.wp_customer_id)::int as customers,
        COALESCE(SUM(o.order_total - o.order_tax - o.order_shipping), 0)::numeric as net_sales,
        COALESCE(SUM(o.order_total), 0)::numeric as gross_sales
      FROM orders o
      ${whereClause}
      GROUP BY o.payment_method_title
      ORDER BY orders DESC
    `;
    const byPaymentResult = await pool.query(byPaymentQuery, params);
    const byPayment = byPaymentResult.rows.map(row => ({
      payment_method: row.payment_method,
      orders: row.orders,
      items: row.items,
      customers: row.customers,
      net_sales: parseFloat(row.net_sales).toFixed(2),
      gross_sales: parseFloat(row.gross_sales).toFixed(2),
      avg_net: row.orders > 0 ? (parseFloat(row.net_sales) / row.orders).toFixed(2) : '0.00',
      avg_gross: row.orders > 0 ? (parseFloat(row.gross_sales) / row.orders).toFixed(2) : '0.00'
    }));

    // 7. Grouped by Shipping Method
    const byShippingQuery = `
      SELECT
        COALESCE(o.shipping_method, 'Non défini') as shipping_method,
        COUNT(DISTINCT o.wp_order_id)::int as orders,
        COALESCE(SUM(
          (SELECT COUNT(*) FROM order_items oi WHERE oi.wp_order_id = o.wp_order_id)
        ), 0)::int as items,
        COUNT(DISTINCT o.wp_customer_id)::int as customers,
        COALESCE(SUM(o.order_total - o.order_tax - o.order_shipping), 0)::numeric as net_sales,
        COALESCE(SUM(o.order_total), 0)::numeric as gross_sales
      FROM orders o
      ${whereClause}
      GROUP BY o.shipping_method
      ORDER BY orders DESC
    `;
    const byShippingResult = await pool.query(byShippingQuery, params);
    const byShipping = byShippingResult.rows.map(row => ({
      shipping_method: row.shipping_method,
      orders: row.orders,
      items: row.items,
      customers: row.customers,
      net_sales: parseFloat(row.net_sales).toFixed(2),
      gross_sales: parseFloat(row.gross_sales).toFixed(2),
      avg_net: row.orders > 0 ? (parseFloat(row.net_sales) / row.orders).toFixed(2) : '0.00',
      avg_gross: row.orders > 0 ? (parseFloat(row.gross_sales) / row.orders).toFixed(2) : '0.00'
    }));

    // 8. Grouped by Country
    const byCountryQuery = `
      SELECT
        COALESCE(o.billing_country, 'N/A') as country,
        COUNT(DISTINCT o.wp_order_id)::int as orders,
        COALESCE(SUM(
          (SELECT COUNT(*) FROM order_items oi WHERE oi.wp_order_id = o.wp_order_id)
        ), 0)::int as items,
        COUNT(DISTINCT o.wp_customer_id)::int as customers,
        COALESCE(SUM(o.order_total - o.order_tax - o.order_shipping), 0)::numeric as net_sales,
        COALESCE(SUM(o.order_total), 0)::numeric as gross_sales
      FROM orders o
      ${whereClause}
      GROUP BY o.billing_country
      ORDER BY orders DESC
    `;
    const byCountryResult = await pool.query(byCountryQuery, params);
    const byCountry = byCountryResult.rows.map(row => ({
      country: row.country,
      orders: row.orders,
      items: row.items,
      customers: row.customers,
      net_sales: parseFloat(row.net_sales).toFixed(2),
      gross_sales: parseFloat(row.gross_sales).toFixed(2),
      avg_net: row.orders > 0 ? (parseFloat(row.net_sales) / row.orders).toFixed(2) : '0.00',
      avg_gross: row.orders > 0 ? (parseFloat(row.gross_sales) / row.orders).toFixed(2) : '0.00'
    }));

    // 9. Item count distribution
    const itemDistributionQuery = `
      SELECT
        item_count,
        COUNT(*)::int as orders_count
      FROM (
        SELECT
          o.wp_order_id,
          (SELECT COUNT(*) FROM order_items oi WHERE oi.wp_order_id = o.wp_order_id) as item_count
        FROM orders o
        ${whereClause}
      ) subq
      GROUP BY item_count
      ORDER BY item_count ASC
    `;
    const itemDistributionResult = await pool.query(itemDistributionQuery, params);
    const itemDistribution = itemDistributionResult.rows.map(row => ({
      item_count: row.item_count,
      orders_count: row.orders_count
    }));

    // 10. Order value distribution (par tranches de 40€)
    const valueDistributionQuery = `
      SELECT
        FLOOR(order_total / 40) * 40 as value_range_start,
        COUNT(*)::int as orders_count
      FROM orders o
      ${whereClause}
      GROUP BY FLOOR(order_total / 40) * 40
      ORDER BY value_range_start ASC
    `;
    const valueDistributionResult = await pool.query(valueDistributionQuery, params);
    const valueDistribution = valueDistributionResult.rows.map(row => ({
      range: `${row.value_range_start}€ - ${parseFloat(row.value_range_start) + 40}€`,
      orders_count: row.orders_count
    }));

    // 11. Average order gross by day
    const avgOrderByDayQuery = `
      SELECT
        DATE_TRUNC('day', o.post_date)::date as date,
        AVG(o.order_total)::numeric as avg_gross,
        AVG((SELECT COUNT(*) FROM order_items oi WHERE oi.wp_order_id = o.wp_order_id))::numeric as avg_items
      FROM orders o
      ${whereClause}
      GROUP BY DATE_TRUNC('day', o.post_date)::date
      ORDER BY date ASC
    `;
    const avgOrderByDayResult = await pool.query(avgOrderByDayQuery, params);
    const avgOrderByDay = avgOrderByDayResult.rows.map(row => ({
      date: row.date,
      avg_gross: parseFloat(row.avg_gross).toFixed(2),
      avg_items: parseFloat(row.avg_items).toFixed(1)
    }));

    // 12. Spend by day of week
    const spendByDayOfWeekQuery = `
      SELECT
        EXTRACT(DOW FROM o.post_date)::int as day_of_week,
        COALESCE(SUM(o.order_total), 0)::numeric as total_sales,
        COUNT(DISTINCT o.wp_order_id)::int as orders_count
      FROM orders o
      ${whereClause}
      GROUP BY EXTRACT(DOW FROM o.post_date)::int
      ORDER BY day_of_week ASC
    `;
    const spendByDayOfWeekResult = await pool.query(spendByDayOfWeekQuery, params);
    const dayNames = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
    const spendByDayOfWeek = spendByDayOfWeekResult.rows.map(row => ({
      day: dayNames[row.day_of_week],
      day_index: row.day_of_week,
      total_sales: parseFloat(row.total_sales).toFixed(2),
      orders_count: row.orders_count
    }));

    // 13. Spend by hour
    const spendByHourQuery = `
      SELECT
        EXTRACT(HOUR FROM o.post_date)::int as hour,
        COALESCE(SUM(o.order_total), 0)::numeric as total_sales,
        COUNT(DISTINCT o.wp_order_id)::int as orders_count
      FROM orders o
      ${whereClause}
      GROUP BY EXTRACT(HOUR FROM o.post_date)::int
      ORDER BY hour ASC
    `;
    const spendByHourResult = await pool.query(spendByHourQuery, params);
    const spendByHour = spendByHourResult.rows.map(row => ({
      hour: row.hour,
      hour_label: `${row.hour}h`,
      total_sales: parseFloat(row.total_sales).toFixed(2),
      orders_count: row.orders_count
    }));

    // 14. Orders by day and hour (heatmap)
    const ordersByDayHourQuery = `
      SELECT
        EXTRACT(DOW FROM o.post_date)::int as day_of_week,
        EXTRACT(HOUR FROM o.post_date)::int as hour,
        COUNT(DISTINCT o.wp_order_id)::int as orders_count
      FROM orders o
      ${whereClause}
      GROUP BY EXTRACT(DOW FROM o.post_date)::int, EXTRACT(HOUR FROM o.post_date)::int
      ORDER BY day_of_week, hour
    `;
    const ordersByDayHourResult = await pool.query(ordersByDayHourQuery, params);
    const ordersByDayHour = ordersByDayHourResult.rows.map(row => ({
      day_of_week: row.day_of_week,
      day: dayNames[row.day_of_week],
      hour: row.hour,
      orders_count: row.orders_count
    }));

    // 15. Days between created and completed (using post_modified for completed orders)
    const fulfillmentTimeQuery = `
      SELECT
        CASE
          WHEN o.post_status NOT IN ('wc-completed', 'wc-delivered') THEN 'Non terminé'
          WHEN EXTRACT(DAY FROM (o.post_modified - o.post_date)) < 1 THEN '0-1 jours'
          WHEN EXTRACT(DAY FROM (o.post_modified - o.post_date)) < 2 THEN '1-2 jours'
          WHEN EXTRACT(DAY FROM (o.post_modified - o.post_date)) < 3 THEN '2-3 jours'
          WHEN EXTRACT(DAY FROM (o.post_modified - o.post_date)) < 4 THEN '3-4 jours'
          ELSE '4+ jours'
        END as fulfillment_range,
        COUNT(*)::int as orders_count
      FROM orders o
      ${whereClause}
      GROUP BY 1
      ORDER BY
        CASE
          WHEN CASE
            WHEN o.post_status NOT IN ('wc-completed', 'wc-delivered') THEN 'Non terminé'
            WHEN EXTRACT(DAY FROM (o.post_modified - o.post_date)) < 1 THEN '0-1 jours'
            WHEN EXTRACT(DAY FROM (o.post_modified - o.post_date)) < 2 THEN '1-2 jours'
            WHEN EXTRACT(DAY FROM (o.post_modified - o.post_date)) < 3 THEN '2-3 jours'
            WHEN EXTRACT(DAY FROM (o.post_modified - o.post_date)) < 4 THEN '3-4 jours'
            ELSE '4+ jours'
          END = '0-1 jours' THEN 1
          WHEN CASE
            WHEN o.post_status NOT IN ('wc-completed', 'wc-delivered') THEN 'Non terminé'
            WHEN EXTRACT(DAY FROM (o.post_modified - o.post_date)) < 1 THEN '0-1 jours'
            WHEN EXTRACT(DAY FROM (o.post_modified - o.post_date)) < 2 THEN '1-2 jours'
            WHEN EXTRACT(DAY FROM (o.post_modified - o.post_date)) < 3 THEN '2-3 jours'
            WHEN EXTRACT(DAY FROM (o.post_modified - o.post_date)) < 4 THEN '3-4 jours'
            ELSE '4+ jours'
          END = '1-2 jours' THEN 2
          WHEN CASE
            WHEN o.post_status NOT IN ('wc-completed', 'wc-delivered') THEN 'Non terminé'
            WHEN EXTRACT(DAY FROM (o.post_modified - o.post_date)) < 1 THEN '0-1 jours'
            WHEN EXTRACT(DAY FROM (o.post_modified - o.post_date)) < 2 THEN '1-2 jours'
            WHEN EXTRACT(DAY FROM (o.post_modified - o.post_date)) < 3 THEN '2-3 jours'
            WHEN EXTRACT(DAY FROM (o.post_modified - o.post_date)) < 4 THEN '3-4 jours'
            ELSE '4+ jours'
          END = '2-3 jours' THEN 3
          WHEN CASE
            WHEN o.post_status NOT IN ('wc-completed', 'wc-delivered') THEN 'Non terminé'
            WHEN EXTRACT(DAY FROM (o.post_modified - o.post_date)) < 1 THEN '0-1 jours'
            WHEN EXTRACT(DAY FROM (o.post_modified - o.post_date)) < 2 THEN '1-2 jours'
            WHEN EXTRACT(DAY FROM (o.post_modified - o.post_date)) < 3 THEN '2-3 jours'
            WHEN EXTRACT(DAY FROM (o.post_modified - o.post_date)) < 4 THEN '3-4 jours'
            ELSE '4+ jours'
          END = '3-4 jours' THEN 4
          WHEN CASE
            WHEN o.post_status NOT IN ('wc-completed', 'wc-delivered') THEN 'Non terminé'
            WHEN EXTRACT(DAY FROM (o.post_modified - o.post_date)) < 1 THEN '0-1 jours'
            WHEN EXTRACT(DAY FROM (o.post_modified - o.post_date)) < 2 THEN '1-2 jours'
            WHEN EXTRACT(DAY FROM (o.post_modified - o.post_date)) < 3 THEN '2-3 jours'
            WHEN EXTRACT(DAY FROM (o.post_modified - o.post_date)) < 4 THEN '3-4 jours'
            ELSE '4+ jours'
          END = '4+ jours' THEN 5
          ELSE 6
        END
    `;
    const fulfillmentTimeResult = await pool.query(fulfillmentTimeQuery, params);
    const fulfillmentTime = fulfillmentTimeResult.rows.map(row => ({
      range: row.fulfillment_range,
      orders_count: row.orders_count
    }));

    // Calcul des jours
    const startDate = new Date(dateFrom);
    const endDate = new Date(dateTo);
    const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

    res.json({
      success: true,
      data: {
        kpis: {
          gross_sales: grossSales.toFixed(2),
          net_sales: netSales.toFixed(2),
          refunds: refunds.toFixed(2),
          discounts: discounts.toFixed(2),
          taxes: taxes.toFixed(2),
          shipping: shipping.toFixed(2),
          orders_count: kpis.orders_count,
          customers_count: kpis.customers_count,
          items_count: kpis.total_items,
          avg_order_net: avgOrderNet.toFixed(2),
          avg_order_gross: avgOrderGross.toFixed(2),
          avg_items: avgItems.toFixed(1),
          daily_net: (netSales / daysDiff).toFixed(2),
          daily_gross: (grossSales / daysDiff).toFixed(2),
          daily_orders: (kpis.orders_count / daysDiff).toFixed(1),
          daily_items: (kpis.total_items / daysDiff).toFixed(1)
        },
        breakdown,
        newVsReturning,
        byStatus,
        byPayment,
        byShipping,
        byCountry,
        itemDistribution,
        valueDistribution,
        avgOrderByDay,
        spendByDayOfWeek,
        spendByHour,
        ordersByDayHour,
        fulfillmentTime
      }
    });
  } catch (error) {
    console.error('Error getting orders report:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Rapport des remboursements
 * POST /api/reports/refunds
 */
exports.getRefundsReport = async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.body;

    // Conditions pour les remboursements
    let refundConditions = [];
    let params = [];
    let paramIndex = 1;

    if (dateFrom) {
      refundConditions.push(`r.refund_date >= $${paramIndex}`);
      params.push(dateFrom);
      paramIndex++;
    }
    if (dateTo) {
      refundConditions.push(`r.refund_date <= $${paramIndex}`);
      params.push(dateTo + ' 23:59:59');
      paramIndex++;
    }

    const refundWhereClause = refundConditions.length > 0 ? 'WHERE ' + refundConditions.join(' AND ') : '';

    // Conditions pour les commandes (même période, pour calculer les taux)
    let orderConditions = [`o.post_status NOT IN ('wc-cancelled', 'wc-failed')`];
    let orderParams = [];
    let orderParamIndex = 1;

    if (dateFrom) {
      orderConditions.push(`o.post_date >= $${orderParamIndex}`);
      orderParams.push(dateFrom);
      orderParamIndex++;
    }
    if (dateTo) {
      orderConditions.push(`o.post_date <= $${orderParamIndex}`);
      orderParams.push(dateTo + ' 23:59:59');
      orderParamIndex++;
    }

    const orderWhereClause = 'WHERE ' + orderConditions.join(' AND ');

    // 1. KPIs des remboursements
    const kpisQuery = `
      SELECT
        COALESCE(SUM(r.refund_amount), 0)::numeric as total_refunded,
        COUNT(*)::int as refunds_count,
        COALESCE(AVG(r.refund_amount), 0)::numeric as avg_refund
      FROM refunds r
      ${refundWhereClause}
    `;
    const kpisResult = await pool.query(kpisQuery, params);
    const refundKpis = kpisResult.rows[0];

    // 2. KPIs des commandes pour calculer les taux
    const orderKpisQuery = `
      SELECT
        COUNT(DISTINCT o.wp_order_id)::int as orders_count,
        COALESCE(SUM(o.order_total), 0)::numeric as total_sales
      FROM orders o
      ${orderWhereClause}
    `;
    const orderKpisResult = await pool.query(orderKpisQuery, orderParams);
    const orderKpis = orderKpisResult.rows[0];

    const totalRefunded = parseFloat(refundKpis.total_refunded) || 0;
    const refundsCount = parseInt(refundKpis.refunds_count) || 0;
    const avgRefund = parseFloat(refundKpis.avg_refund) || 0;
    const ordersCount = parseInt(orderKpis.orders_count) || 0;
    const totalSales = parseFloat(orderKpis.total_sales) || 0;

    const refundRate = ordersCount > 0 ? (refundsCount / ordersCount * 100) : 0;
    const percentOfSales = totalSales > 0 ? (totalRefunded / totalSales * 100) : 0;

    // 3. Breakdown par jour
    const breakdownQuery = `
      SELECT
        DATE(r.refund_date) as date,
        COUNT(*)::int as refunds_count,
        COALESCE(SUM(r.refund_amount), 0)::numeric as refund_amount
      FROM refunds r
      ${refundWhereClause}
      GROUP BY DATE(r.refund_date)
      ORDER BY date ASC
    `;
    const breakdownResult = await pool.query(breakdownQuery, params);
    const breakdown = breakdownResult.rows.map(row => ({
      date: row.date,
      refunds_count: row.refunds_count,
      refund_amount: parseFloat(row.refund_amount).toFixed(2)
    }));

    // 4. Délai entre commande et remboursement
    const delayQuery = `
      SELECT
        CASE
          WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 1 THEN '0-1 jours'
          WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 7 THEN '1-7 jours'
          WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 14 THEN '7-14 jours'
          WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 21 THEN '14-21 jours'
          WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 30 THEN '21-30 jours'
          ELSE '30+ jours'
        END as delay_range,
        COUNT(*)::int as refunds_count
      FROM refunds r
      JOIN orders o ON r.wp_order_id = o.wp_order_id
      ${refundWhereClause}
      GROUP BY 1
      ORDER BY
        CASE
          WHEN CASE
            WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 1 THEN '0-1 jours'
            WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 7 THEN '1-7 jours'
            WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 14 THEN '7-14 jours'
            WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 21 THEN '14-21 jours'
            WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 30 THEN '21-30 jours'
            ELSE '30+ jours'
          END = '0-1 jours' THEN 1
          WHEN CASE
            WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 1 THEN '0-1 jours'
            WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 7 THEN '1-7 jours'
            WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 14 THEN '7-14 jours'
            WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 21 THEN '14-21 jours'
            WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 30 THEN '21-30 jours'
            ELSE '30+ jours'
          END = '1-7 jours' THEN 2
          WHEN CASE
            WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 1 THEN '0-1 jours'
            WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 7 THEN '1-7 jours'
            WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 14 THEN '7-14 jours'
            WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 21 THEN '14-21 jours'
            WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 30 THEN '21-30 jours'
            ELSE '30+ jours'
          END = '7-14 jours' THEN 3
          WHEN CASE
            WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 1 THEN '0-1 jours'
            WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 7 THEN '1-7 jours'
            WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 14 THEN '7-14 jours'
            WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 21 THEN '14-21 jours'
            WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 30 THEN '21-30 jours'
            ELSE '30+ jours'
          END = '14-21 jours' THEN 4
          WHEN CASE
            WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 1 THEN '0-1 jours'
            WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 7 THEN '1-7 jours'
            WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 14 THEN '7-14 jours'
            WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 21 THEN '14-21 jours'
            WHEN EXTRACT(DAY FROM (r.refund_date - o.post_date)) < 30 THEN '21-30 jours'
            ELSE '30+ jours'
          END = '21-30 jours' THEN 5
          ELSE 6
        END
    `;
    const delayResult = await pool.query(delayQuery, params);
    const delayDistribution = delayResult.rows.map(row => ({
      range: row.delay_range,
      refunds_count: row.refunds_count
    }));

    // 5. Groupé par raison
    const byReasonQuery = `
      SELECT
        COALESCE(NULLIF(TRIM(r.refund_reason), ''), 'Non spécifié') as reason,
        COUNT(*)::int as refunds_count,
        COALESCE(SUM(r.refund_amount), 0)::numeric as refunded_amount,
        COALESCE(AVG(r.refund_amount), 0)::numeric as avg_refund
      FROM refunds r
      ${refundWhereClause}
      GROUP BY COALESCE(NULLIF(TRIM(r.refund_reason), ''), 'Non spécifié')
      ORDER BY refunds_count DESC
    `;
    const byReasonResult = await pool.query(byReasonQuery, params);
    const byReason = byReasonResult.rows.map(row => ({
      reason: row.reason,
      refunds_count: row.refunds_count,
      refunded_amount: parseFloat(row.refunded_amount).toFixed(2),
      avg_refund: parseFloat(row.avg_refund).toFixed(2)
    }));

    // 6. Groupé par pays de facturation
    const byBillingCountryQuery = `
      SELECT
        COALESCE(o.billing_country, 'N/A') as country,
        COUNT(*)::int as refunds_count,
        COALESCE(SUM(r.refund_amount), 0)::numeric as refunded_amount,
        COALESCE(AVG(r.refund_amount), 0)::numeric as avg_refund
      FROM refunds r
      JOIN orders o ON r.wp_order_id = o.wp_order_id
      ${refundWhereClause}
      GROUP BY o.billing_country
      ORDER BY refunds_count DESC
    `;
    const byBillingCountryResult = await pool.query(byBillingCountryQuery, params);
    const byBillingCountry = byBillingCountryResult.rows.map(row => ({
      country: row.country,
      refunds_count: row.refunds_count,
      refunded_amount: parseFloat(row.refunded_amount).toFixed(2),
      avg_refund: parseFloat(row.avg_refund).toFixed(2)
    }));

    // 7. Groupé par pays de livraison
    const byShippingCountryQuery = `
      SELECT
        COALESCE(o.shipping_country, 'N/A') as country,
        COUNT(*)::int as refunds_count,
        COALESCE(SUM(r.refund_amount), 0)::numeric as refunded_amount,
        COALESCE(AVG(r.refund_amount), 0)::numeric as avg_refund
      FROM refunds r
      JOIN orders o ON r.wp_order_id = o.wp_order_id
      ${refundWhereClause}
      GROUP BY o.shipping_country
      ORDER BY refunds_count DESC
    `;
    const byShippingCountryResult = await pool.query(byShippingCountryQuery, params);
    const byShippingCountry = byShippingCountryResult.rows.map(row => ({
      country: row.country,
      refunds_count: row.refunds_count,
      refunded_amount: parseFloat(row.refunded_amount).toFixed(2),
      avg_refund: parseFloat(row.avg_refund).toFixed(2)
    }));

    // Calcul des jours pour la période
    const startDate = new Date(dateFrom);
    const endDate = new Date(dateTo);
    const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

    res.json({
      success: true,
      data: {
        kpis: {
          total_refunded: totalRefunded.toFixed(2),
          refunds_count: refundsCount,
          avg_refund: avgRefund.toFixed(2),
          refund_rate: refundRate.toFixed(2),
          percent_of_sales: percentOfSales.toFixed(2),
          daily_refunds: (refundsCount / daysDiff).toFixed(1),
          daily_amount: (totalRefunded / daysDiff).toFixed(2)
        },
        breakdown,
        delayDistribution,
        byReason,
        byBillingCountry,
        byShippingCountry
      }
    });
  } catch (error) {
    console.error('Error getting refunds report:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Coûts d'expédition par méthode
 * POST /api/reports/profit/shipping-costs
 */
exports.getShippingCosts = async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.body;

    let conditions = [`o.post_status NOT IN ('wc-cancelled', 'wc-refunded', 'wc-failed', 'wc-on-hold', 'wc-pending')`];
    let params = [];
    let paramIndex = 1;

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

    const whereClause = 'WHERE ' + conditions.join(' AND ');

    // Grouper par méthode d'expédition
    const query = `
      SELECT
        COALESCE(shipping_method, 'Non défini') as shipping_method,
        COUNT(DISTINCT wp_order_id)::int as orders_count,
        COALESCE(SUM(shipping_cost_calculated), 0)::numeric as shipping_cost,
        COALESCE(SUM(order_shipping), 0)::numeric as shipping_charged
      FROM orders o
      ${whereClause}
      GROUP BY shipping_method
      ORDER BY orders_count DESC
    `;
    const result = await pool.query(query, params);

    const data = result.rows.map(row => {
      const cost = parseFloat(row.shipping_cost) || 0;
      const charged = parseFloat(row.shipping_charged) || 0;
      const avgCost = row.orders_count > 0 ? cost / row.orders_count : 0;
      const avgCharged = row.orders_count > 0 ? charged / row.orders_count : 0;

      return {
        shipping_method: row.shipping_method,
        orders_count: row.orders_count,
        shipping_cost: cost.toFixed(2),
        avg_cost: avgCost.toFixed(2),
        shipping_charged: charged.toFixed(2),
        avg_charged: avgCharged.toFixed(2)
      };
    });

    res.json({ success: true, data });
  } catch (error) {
    console.error('Error getting shipping costs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Rapport Par Pays
 * POST /api/reports/by-country
 */
exports.getByCountryReport = async (req, res) => {
  try {
    const { dateFrom, dateTo, country } = req.body;

    // Conditions de base pour les commandes valides
    let baseConditions = [`o.post_status NOT IN ('wc-cancelled', 'wc-failed', 'wc-pending')`];
    let params = [];
    let paramIndex = 1;

    if (dateFrom) {
      baseConditions.push(`o.post_date >= $${paramIndex}`);
      params.push(dateFrom);
      paramIndex++;
    }
    if (dateTo) {
      baseConditions.push(`o.post_date <= $${paramIndex}`);
      params.push(dateTo + ' 23:59:59');
      paramIndex++;
    }

    const baseWhereClause = 'WHERE ' + baseConditions.join(' AND ');

    // 1. KPIs par pays (tous les pays)
    const kpisByCountryQuery = `
      SELECT
        COALESCE(o.billing_country, 'N/A') as country,
        COUNT(DISTINCT o.wp_order_id)::int as orders_count,
        COALESCE(SUM(o.order_total), 0)::numeric as gross_sales,
        COALESCE(SUM(o.order_total - o.order_tax - o.order_shipping), 0)::numeric as net_sales,
        COALESCE(AVG(o.order_total), 0)::numeric as avg_order,
        COUNT(DISTINCT o.wp_customer_id)::int as customers_count
      FROM orders o
      ${baseWhereClause}
      GROUP BY o.billing_country
      ORDER BY orders_count DESC
    `;
    const kpisByCountryResult = await pool.query(kpisByCountryQuery, params);

    // Récupérer les remboursements par pays
    const refundsByCountryQuery = `
      SELECT
        COALESCE(o.billing_country, 'N/A') as country,
        COUNT(r.wp_refund_id)::int as refunds_count,
        COALESCE(SUM(r.refund_amount), 0)::numeric as refunds_amount
      FROM refunds r
      JOIN orders o ON r.wp_order_id = o.wp_order_id
      WHERE r.refund_date >= $1 AND r.refund_date <= $2
      GROUP BY o.billing_country
    `;
    const refundsByCountryResult = await pool.query(refundsByCountryQuery, [dateFrom, dateTo + ' 23:59:59']);

    // Mapper les remboursements par pays
    const refundsMap = {};
    refundsByCountryResult.rows.forEach(row => {
      refundsMap[row.country] = {
        refunds_count: row.refunds_count,
        refunds_amount: parseFloat(row.refunds_amount)
      };
    });

    const kpisByCountry = kpisByCountryResult.rows.map(row => {
      const refundData = refundsMap[row.country] || { refunds_count: 0, refunds_amount: 0 };
      return {
        country: row.country,
        orders_count: row.orders_count,
        gross_sales: parseFloat(row.gross_sales).toFixed(2),
        net_sales: parseFloat(row.net_sales).toFixed(2),
        avg_order: parseFloat(row.avg_order).toFixed(2),
        customers_count: row.customers_count,
        refunds_count: refundData.refunds_count,
        refunds_amount: refundData.refunds_amount.toFixed(2)
      };
    });

    // Si un pays est sélectionné, récupérer les détails
    let countryDetails = null;
    if (country) {
      const countryParamIndex = paramIndex;
      const countryConditions = [...baseConditions, `o.billing_country = $${countryParamIndex}`];
      const countryParams = [...params, country];
      const countryWhereClause = 'WHERE ' + countryConditions.join(' AND ');

      // Top 5 Produits (uniquement les line_item, pas les coupons/shipping/etc)
      // WooCommerce: line_total = HT, line_tax = TVA, donc TTC = line_total + line_tax
      const topProductsQuery = `
        SELECT
          COALESCE(p.post_title, oi.order_item_name) as product_name,
          oi.product_id,
          SUM(oi.qty)::int as quantity_sold,
          (COALESCE(SUM(oi.line_total), 0) + COALESCE(SUM(oi.line_tax), 0))::numeric as total_sales
        FROM order_items oi
        JOIN orders o ON oi.wp_order_id = o.wp_order_id
        LEFT JOIN products p ON oi.product_id = p.wp_product_id
        ${countryWhereClause} AND oi.order_item_type = 'line_item'
        GROUP BY oi.product_id, COALESCE(p.post_title, oi.order_item_name)
        ORDER BY quantity_sold DESC
        LIMIT 5
      `;
      const topProductsResult = await pool.query(topProductsQuery, countryParams);
      const topProducts = topProductsResult.rows.map(row => ({
        product_name: row.product_name,
        product_id: row.product_id,
        quantity_sold: row.quantity_sold,
        total_sales: parseFloat(row.total_sales).toFixed(2)
      }));

      // Top 3 Catégories (uniquement les line_item)
      // WooCommerce: line_total = HT, line_tax = TVA, donc TTC = line_total + line_tax
      const topCategoriesQuery = `
        SELECT
          COALESCE(p.category, 'Non catégorisé') as category,
          SUM(oi.qty)::int as quantity_sold,
          (COALESCE(SUM(oi.line_total), 0) + COALESCE(SUM(oi.line_tax), 0))::numeric as total_sales
        FROM order_items oi
        JOIN orders o ON oi.wp_order_id = o.wp_order_id
        LEFT JOIN products p ON oi.product_id = p.wp_product_id
        ${countryWhereClause} AND oi.order_item_type = 'line_item'
        GROUP BY COALESCE(p.category, 'Non catégorisé')
        ORDER BY quantity_sold DESC
        LIMIT 3
      `;
      const topCategoriesResult = await pool.query(topCategoriesQuery, countryParams);
      const topCategories = topCategoriesResult.rows.map(row => ({
        category: row.category,
        quantity_sold: row.quantity_sold,
        total_sales: parseFloat(row.total_sales).toFixed(2)
      }));

      // Top 3 Transporteurs (depuis order_items type shipping)
      const topShippingQuery = `
        SELECT
          oi.order_item_name as shipping_method,
          COUNT(DISTINCT o.wp_order_id)::int as orders_count,
          ROUND(COUNT(DISTINCT o.wp_order_id)::numeric * 100.0 / NULLIF(SUM(COUNT(DISTINCT o.wp_order_id)) OVER(), 0), 1) as percentage
        FROM order_items oi
        JOIN orders o ON oi.wp_order_id = o.wp_order_id
        ${countryWhereClause} AND oi.order_item_type = 'shipping'
        GROUP BY oi.order_item_name
        ORDER BY orders_count DESC
        LIMIT 3
      `;
      const topShippingResult = await pool.query(topShippingQuery, countryParams);
      const topShipping = topShippingResult.rows.map(row => ({
        shipping_method: row.shipping_method,
        orders_count: row.orders_count,
        percentage: parseFloat(row.percentage).toFixed(1)
      }));

      // Top 3 Moyens de paiement
      const topPaymentQuery = `
        SELECT
          COALESCE(o.payment_method_title, 'Non défini') as payment_method,
          COUNT(DISTINCT o.wp_order_id)::int as orders_count,
          ROUND(COUNT(DISTINCT o.wp_order_id)::numeric * 100.0 / NULLIF(SUM(COUNT(DISTINCT o.wp_order_id)) OVER(), 0), 1) as percentage
        FROM orders o
        ${countryWhereClause}
        GROUP BY o.payment_method_title
        ORDER BY orders_count DESC
        LIMIT 3
      `;
      const topPaymentResult = await pool.query(topPaymentQuery, countryParams);
      const topPayment = topPaymentResult.rows.map(row => ({
        payment_method: row.payment_method,
        orders_count: row.orders_count,
        percentage: parseFloat(row.percentage).toFixed(1)
      }));

      countryDetails = {
        country,
        topProducts,
        topCategories,
        topShipping,
        topPayment
      };
    }

    res.json({
      success: true,
      data: {
        kpisByCountry,
        countryDetails
      }
    });
  } catch (error) {
    console.error('Error getting by-country report:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
