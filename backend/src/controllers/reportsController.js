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
