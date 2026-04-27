const pool = require('../config/database');

// Statuts considérés comme commandes actives (payées)
const ACTIVE_STATUSES = [
  'wc-completed', 'wc-processing', 'wc-shipped',
  'wc-delivered', 'wc-being-delivered', 'wc-awaiting-delivery'
];

/**
 * Construit les conditions WHERE et les paramètres pour une plage de dates.
 * Retourne { conditions, params, nextIndex }
 */
function buildDateConditions(dateFrom, dateTo, startIndex = 1, alias = 'o') {
  const conditions = [
    `${alias}.post_status = ANY($${startIndex})`
  ];
  const params = [ACTIVE_STATUSES];
  let idx = startIndex + 1;

  if (dateFrom) {
    conditions.push(`${alias}.post_date >= $${idx++}`);
    params.push(dateFrom);
  }
  if (dateTo) {
    conditions.push(`${alias}.post_date <= $${idx++}`);
    params.push(dateTo + ' 23:59:59');
  }

  return { conditions, params, nextIndex: idx };
}

/**
 * POST /api/financier/dashboard
 * Retourne tous les KPIs + séries temporelles + breakdown des coûts
 * pour une période donnée. Source de vérité unique pour tous les onglets.
 */
exports.getDashboard = async (req, res) => {
  try {
    const { dateFrom, dateTo, granularity } = req.body;
    // granularity: 'hour' | 'day' | 'week' | 'month' (auto si non fourni)

    const { conditions, params, nextIndex } = buildDateConditions(dateFrom, dateTo);
    const where = 'WHERE ' + conditions.join(' AND ');

    // ─── 1. KPIs GLOBAUX ────────────────────────────────────────────────────
    const kpisResult = await pool.query(`
      SELECT
        COUNT(DISTINCT o.wp_order_id)::int                                AS orders_count,
        COALESCE(SUM(o.order_total), 0)::numeric                          AS ca_ttc_brut,
        COALESCE(SUM(o.order_tax), 0)::numeric                            AS tva,
        COALESCE(SUM(o.order_shipping), 0)::numeric                       AS frais_port_client,
        COALESCE(SUM(o.shipping_cost_calculated), 0)::numeric             AS frais_port_reel,
        COALESCE(SUM(o.payment_cost_calculated), 0)::numeric              AS frais_paiement,
        COALESCE(SUM(
          oi.qty * COALESCE(p.computed_cost, p.wc_cog_cost, 0)
        ), 0)::numeric                                                     AS cout_produits
      FROM orders o
      LEFT JOIN order_items oi ON o.wp_order_id = oi.wp_order_id
      LEFT JOIN products p ON (oi.variation_id = p.wp_product_id OR (oi.variation_id IS NULL AND oi.product_id = p.wp_product_id))
      ${where}
    `, params);

    const kRow = kpisResult.rows[0];
    const caTTCBrut     = parseFloat(kRow.ca_ttc_brut)      || 0;
    const tva           = parseFloat(kRow.tva)               || 0;
    const fraisPortClient = parseFloat(kRow.frais_port_client) || 0;
    const fraisPortReel = parseFloat(kRow.frais_port_reel)   || 0;
    const fraisPaiement = parseFloat(kRow.frais_paiement)    || 0;
    const coutProduits  = parseFloat(kRow.cout_produits)     || 0;
    const ordersCount   = kRow.orders_count || 0;

    // ─── 2. REMBOURSEMENTS ──────────────────────────────────────────────────
    // Remboursements à la date du remboursement, sur la période
    const refundsParams = [dateFrom, dateTo + ' 23:59:59'].filter(Boolean);
    let refundsConds = [];
    let rIdx = 1;
    if (dateFrom) { refundsConds.push(`r.refund_date >= $${rIdx++}`); }
    if (dateTo)   { refundsConds.push(`r.refund_date <= $${rIdx++}`); }

    const refundsResult = await pool.query(`
      SELECT COALESCE(SUM(r.refund_amount), 0)::numeric AS remboursements_ttc
      FROM refunds r
      ${refundsConds.length ? 'WHERE ' + refundsConds.join(' AND ') : ''}
    `, refundsParams);

    const remboursementsTTC = parseFloat(refundsResult.rows[0].remboursements_ttc) || 0;

    // ─── 3. CALCULS DÉRIVÉS ─────────────────────────────────────────────────
    // TVA ajustée des remboursements (proportionnelle)
    const taxRatio     = caTTCBrut > 0 ? tva / caTTCBrut : 0;
    const tvaAjustee   = tva - (remboursementsTTC * taxRatio);
    const caTTCNet     = caTTCBrut - remboursementsTTC;
    const caHTNet      = caTTCNet - tvaAjustee;
    const profitHT     = caHTNet - fraisPortReel - coutProduits - fraisPaiement;
    const margeHT      = caHTNet > 0 ? (profitHT / caHTNet * 100) : 0;
    const panierMoyenHT = ordersCount > 0 ? caHTNet / ordersCount : 0;

    // ─── 4. SÉRIES TEMPORELLES ──────────────────────────────────────────────
    // Granularité automatique selon la période
    let gran = granularity;
    if (!gran) {
      if (!dateFrom && !dateTo) {
        gran = 'day';
      } else {
        const from = new Date(dateFrom || '2020-01-01');
        const to   = new Date((dateTo || new Date().toISOString().slice(0, 10)) + 'T23:59:59');
        const diffDays = (to - from) / (1000 * 60 * 60 * 24);
        if (diffDays <= 1)   gran = 'hour';
        else if (diffDays <= 35)  gran = 'day';
        else if (diffDays <= 120) gran = 'week';
        else gran = 'month';
      }
    }

    const truncMap = {
      hour:  "date_trunc('hour', o.post_date)",
      day:   "date_trunc('day', o.post_date)",
      week:  "date_trunc('week', o.post_date)",
      month: "date_trunc('month', o.post_date)",
    };
    const truncExpr = truncMap[gran] || truncMap.day;

    const seriesResult = await pool.query(`
      SELECT
        ${truncExpr}                                                         AS period,
        COUNT(DISTINCT o.wp_order_id)::int                                   AS orders_count,
        COALESCE(SUM(o.order_total), 0)::numeric                             AS ca_ttc_brut,
        COALESCE(SUM(o.order_tax), 0)::numeric                               AS tva,
        COALESCE(SUM(o.order_shipping), 0)::numeric                          AS frais_port_client,
        COALESCE(SUM(o.shipping_cost_calculated), 0)::numeric                AS frais_port_reel,
        COALESCE(SUM(o.payment_cost_calculated), 0)::numeric                 AS frais_paiement,
        COALESCE(SUM(
          oi.qty * COALESCE(p.computed_cost, p.wc_cog_cost, 0)
        ), 0)::numeric                                                        AS cout_produits
      FROM orders o
      LEFT JOIN order_items oi ON o.wp_order_id = oi.wp_order_id
      LEFT JOIN products p ON (oi.variation_id = p.wp_product_id OR (oi.variation_id IS NULL AND oi.product_id = p.wp_product_id))
      ${where}
      GROUP BY ${truncExpr}
      ORDER BY ${truncExpr}
    `, params);

    const series = seriesResult.rows.map(row => {
      const rowCATTCBrut    = parseFloat(row.ca_ttc_brut)   || 0;
      const rowTVA          = parseFloat(row.tva)            || 0;
      const rowFPReel       = parseFloat(row.frais_port_reel)|| 0;
      const rowFPaiement    = parseFloat(row.frais_paiement) || 0;
      const rowCoutProduits = parseFloat(row.cout_produits)  || 0;
      // Pas de remboursements par période (trop complexe à aligner) — on utilise la TVA brute
      const rowCAHT   = rowCATTCBrut - rowTVA;
      const rowProfit = rowCAHT - rowFPReel - rowCoutProduits - rowFPaiement;
      return {
        period:        row.period,
        orders_count:  row.orders_count,
        ca_ttc_brut:   round2(rowCATTCBrut),
        ca_ht:         round2(rowCAHT),
        profit_ht:     round2(rowProfit),
        cout_produits: round2(rowCoutProduits),
        frais_port_reel: round2(rowFPReel),
        frais_paiement:  round2(rowFPaiement),
      };
    });

    // ─── 5. RÉPONSE ─────────────────────────────────────────────────────────
    res.json({
      success: true,
      granularity: gran,
      kpis: {
        orders_count:       ordersCount,
        ca_ttc_brut:        round2(caTTCBrut),
        ca_ttc_net:         round2(caTTCNet),
        ca_ht_net:          round2(caHTNet),
        tva:                round2(tvaAjustee),
        remboursements_ttc: round2(remboursementsTTC),
        frais_port_client:  round2(fraisPortClient),
        frais_port_reel:    round2(fraisPortReel),
        frais_paiement:     round2(fraisPaiement),
        cout_produits:      round2(coutProduits),
        profit_ht:          round2(profitHT),
        marge_ht:           round2(margeHT),
        panier_moyen_ht:    round2(panierMoyenHT),
      },
      series,
    });

  } catch (error) {
    console.error('Error in financier dashboard:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

function round2(n) {
  return Math.round((n || 0) * 100) / 100;
}
