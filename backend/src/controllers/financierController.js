const pool = require('../config/database');

// Statuts considérés comme commandes actives (payées)
const ACTIVE_STATUSES = [
  'wc-completed', 'wc-processing', 'wc-shipped',
  'wc-delivered', 'wc-being-delivered', 'wc-awaiting-delivery'
];

/**
 * Construit les conditions WHERE et les paramètres pour une plage de dates.
 * Filtre sur post_date (date de création), converti en Europe/Paris — aligné sur Metorik.
 * Retourne { conditions, params, nextIndex }
 */
function buildDateConditions(dateFrom, dateTo, startIndex = 1, alias = 'o') {
  const conditions = [
    `${alias}.post_status = ANY($${startIndex})`
  ];
  const params = [ACTIVE_STATUSES];
  let idx = startIndex + 1;

  if (dateFrom) {
    conditions.push(`(${alias}.post_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris') >= $${idx++}`);
    params.push(dateFrom);
  }
  if (dateTo) {
    conditions.push(`(${alias}.post_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris') <= $${idx++}`);
    params.push(dateTo + ' 23:59:59');
  }

  return { conditions, params, nextIndex: idx };
}

/**
 * Calcule tous les KPIs + séries temporelles pour une période donnée.
 * Source de vérité unique : utilisée par l'endpoint HTTP /dashboard ET par
 * le service d'envoi de rapports par email (reportEmailService) → garantit
 * des métriques identiques entre l'app et l'email.
 * Retourne { granularity, kpis, series }.
 */
async function computeDashboard({ dateFrom, dateTo, granularity } = {}) {
    // granularity: 'hour' | 'day' | 'week' | 'month' (auto si non fourni)

    const { conditions, params, nextIndex } = buildDateConditions(dateFrom, dateTo);
    const where = 'WHERE ' + conditions.join(' AND ');

    // ─── 1. KPIs GLOBAUX — agrégats order-level ────────────────────────────
    // TVA réelle = line_item.line_tax (TVA produits) + tax_item.line_tax (TVA livraison)
    // order_shipping_tax est toujours NULL en BDD, il faut passer par order_items
    const orderKpisResult = await pool.query(`
      WITH tva_reelle AS (
        SELECT oi.wp_order_id,
          SUM(CASE WHEN oi.order_item_type = 'line_item' THEN oi.line_tax ELSE 0 END)
          + SUM(CASE WHEN oi.order_item_type = 'tax'      THEN oi.line_tax ELSE 0 END) AS tva
        FROM order_items oi
        WHERE oi.wp_order_id IN (SELECT wp_order_id FROM orders o ${where})
        GROUP BY oi.wp_order_id
      )
      SELECT
        COUNT(o.wp_order_id)::int                                          AS orders_count,
        COALESCE(SUM(o.order_total), 0)::numeric                          AS ca_ttc_brut,
        COALESCE(SUM(t.tva), 0)::numeric                                  AS tva,
        COALESCE(SUM(o.order_shipping), 0)::numeric                       AS frais_port_client,
        COALESCE(SUM(o.shipping_cost_calculated), 0)::numeric             AS frais_port_reel,
        COALESCE(SUM(o.payment_cost_calculated), 0)::numeric              AS frais_paiement
      FROM orders o
      LEFT JOIN tva_reelle t ON t.wp_order_id = o.wp_order_id
      ${where}
    `, params);

    // ─── 2. COÛT PRODUITS — agrégat item-level ─────────────────────────────
    const coutResult = await pool.query(`
      SELECT
        COALESCE(SUM(
          oi.qty * COALESCE(p.computed_cost, p.wc_cog_cost, 0)
        ), 0)::numeric AS cout_produits
      FROM orders o
      LEFT JOIN order_items oi ON o.wp_order_id = oi.wp_order_id
      LEFT JOIN products p ON (
        oi.variation_id = p.wp_product_id
        OR (oi.variation_id IS NULL AND oi.product_id = p.wp_product_id)
      )
      ${where}
    `, params);

    const kRow = orderKpisResult.rows[0];
    const caTTCBrut       = parseFloat(kRow.ca_ttc_brut)        || 0;
    const tva             = parseFloat(kRow.tva)                 || 0;
    const fraisPortClient = parseFloat(kRow.frais_port_client)   || 0;
    const fraisPortReel   = parseFloat(kRow.frais_port_reel)     || 0;
    const fraisPaiement   = parseFloat(kRow.frais_paiement)      || 0;
    const ordersCount     = kRow.orders_count                    || 0;
    const coutProduits    = parseFloat(coutResult.rows[0].cout_produits) || 0;

    // ─── 3. REMBOURSEMENTS ──────────────────────────────────────────────────
    // Construction correcte des params (pas de concaténation avant vérification)
    const refundsParams = [];
    // On exclut les remboursements sur commandes annulées/échouées (jamais comptées
    // comme ventes) pour ne pas réduire le CA à tort — aligné sur Metorik.
    const refundsConds  = [
      `o.post_status NOT IN ('wc-cancelled', 'wc-failed', 'wc-checkout-draft', 'wc-trash', 'wc-pending', 'wc-auto-draft')`
    ];
    let rIdx = 1;
    if (dateFrom) {
      refundsConds.push(`(r.refund_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris') >= $${rIdx++}`);
      refundsParams.push(dateFrom);
    }
    if (dateTo) {
      refundsConds.push(`(r.refund_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris') <= $${rIdx++}`);
      refundsParams.push(dateTo + ' 23:59:59');
    }

    const refundsResult = await pool.query(`
      SELECT
        COALESCE(SUM(r.refund_amount), 0)::numeric AS remboursements_ttc,
        COUNT(DISTINCT r.wp_order_id)::int          AS refunds_count
      FROM refunds r
      JOIN orders o ON r.wp_order_id = o.wp_order_id
      WHERE ${refundsConds.join(' AND ')}
    `, refundsParams);

    const remboursementsTTC = parseFloat(refundsResult.rows[0].remboursements_ttc) || 0;
    const refundsCount      = refundsResult.rows[0].refunds_count || 0;

    // ─── 4. CALCULS DÉRIVÉS ─────────────────────────────────────────────────
    // TVA ajustée des remboursements (proportionnelle)
    const taxRatio      = caTTCBrut > 0 ? tva / caTTCBrut : 0;
    const tvaAjustee    = tva - (remboursementsTTC * taxRatio);
    const caTTCNet      = caTTCBrut - remboursementsTTC;
    const caHTNet       = caTTCNet - tvaAjustee;
    const profitHT      = caHTNet - fraisPortReel - coutProduits - fraisPaiement;
    const margeHT       = caHTNet > 0 ? (profitHT / caHTNet * 100) : 0;
    const panierMoyenHT = ordersCount > 0 ? caHTNet / ordersCount : 0;

    // ─── 5. SÉRIES TEMPORELLES ──────────────────────────────────────────────
    // Granularité automatique selon la période
    let gran = granularity;
    if (!gran) {
      if (!dateFrom && !dateTo) {
        gran = 'day';
      } else {
        const from = new Date(dateFrom || '2020-01-01');
        const to   = new Date((dateTo || new Date().toISOString().slice(0, 10)) + 'T23:59:59');
        const diffDays = (to - from) / (1000 * 60 * 60 * 24);
        if (dateFrom === dateTo)   gran = 'quarter';
        else if (diffDays <= 1)   gran = 'hour';
        else if (diffDays <= 35)  gran = 'day';
        else if (diffDays <= 120) gran = 'week';
        else                      gran = 'month';
      }
    }

    const truncMap = {
      quarter: "date_trunc('hour', (o.post_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris')) + (floor(extract(minute FROM (o.post_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris')) / 15) * interval '15 minutes')",
      hour:    "date_trunc('hour', (o.post_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris'))",
      day:     "date_trunc('day', (o.post_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris'))",
      week:    "date_trunc('week', (o.post_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris'))",
      month:   "date_trunc('month', (o.post_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris'))",
    };
    const truncExpr = truncMap[gran] || truncMap.day;

    // Séries : order-level (pas de fan-out)
    // TVA via order_items (order_shipping_tax toujours NULL en BDD)
    const seriesOrdersResult = await pool.query(`
      WITH tva_reelle AS (
        SELECT oi.wp_order_id,
          SUM(CASE WHEN oi.order_item_type = 'line_item' THEN oi.line_tax ELSE 0 END)
          + SUM(CASE WHEN oi.order_item_type = 'tax'      THEN oi.line_tax ELSE 0 END) AS tva
        FROM order_items oi
        WHERE oi.wp_order_id IN (SELECT wp_order_id FROM orders o ${where})
        GROUP BY oi.wp_order_id
      )
      SELECT
        ${truncExpr}                                                           AS period,
        COUNT(o.wp_order_id)::int                                              AS orders_count,
        COALESCE(SUM(o.order_total), 0)::numeric                               AS ca_ttc_brut,
        COALESCE(SUM(t.tva), 0)::numeric                                       AS tva,
        COALESCE(SUM(o.shipping_cost_calculated), 0)::numeric                  AS frais_port_reel,
        COALESCE(SUM(o.payment_cost_calculated), 0)::numeric                   AS frais_paiement
      FROM orders o
      LEFT JOIN tva_reelle t ON t.wp_order_id = o.wp_order_id
      ${where}
      GROUP BY ${truncExpr}
      ORDER BY ${truncExpr}
    `, params);

    // Séries : coût produits par période
    const seriesCoutResult = await pool.query(`
      SELECT
        ${truncExpr}                                                           AS period,
        COALESCE(SUM(
          oi.qty * COALESCE(p.computed_cost, p.wc_cog_cost, 0)
        ), 0)::numeric                                                         AS cout_produits
      FROM orders o
      LEFT JOIN order_items oi ON o.wp_order_id = oi.wp_order_id
      LEFT JOIN products p ON (
        oi.variation_id = p.wp_product_id
        OR (oi.variation_id IS NULL AND oi.product_id = p.wp_product_id)
      )
      ${where}
      GROUP BY ${truncExpr}
      ORDER BY ${truncExpr}
    `, params);

    // Normalise un timestamp PG (avec ou sans offset) en clé ISO UTC stable
    const normKey = (dt) => {
      if (!dt) return '';
      if (typeof dt === 'string') return new Date(dt).toISOString();
      return dt.toISOString();
    };

    // Fusionner les deux résultats par period
    const coutByPeriod = {};
    for (const row of seriesCoutResult.rows) {
      coutByPeriod[normKey(row.period)] = parseFloat(row.cout_produits) || 0;
    }

    const dataByPeriod = {};
    for (const row of seriesOrdersResult.rows) {
      dataByPeriod[normKey(row.period)] = row;
    }

    // Pour granularité quarter : générer tous les créneaux 00:00→23:45 de la journée
    // afin que l'axe X couvre toujours 24h même si peu de commandes.
    // On normalise les clés en string ISO via toISOString() côté DB rows,
    // et on génère les slots avec le même format (Date locale → toISOString).
    let periodSlots = null;
    if (gran === 'quarter' && dateFrom) {
      periodSlots = [];
      const pad = (n) => String(n).padStart(2, '0');
      for (let h = 0; h < 24; h++) {
        for (let m = 0; m < 60; m += 15) {
          // Construire en tant que date UTC pour avoir un ISO stable
          const [y, mo, d] = dateFrom.split('-').map(Number);
          const dt = new Date(Date.UTC(y, mo - 1, d, h, m, 0));
          periodSlots.push(dt.toISOString());
        }
      }
    }

    const buildPoint = (periodISO, row) => {
      const rowCATTCBrut    = row ? parseFloat(row.ca_ttc_brut)    || 0 : 0;
      const rowTVA          = row ? parseFloat(row.tva)             || 0 : 0;
      const rowFPReel       = row ? parseFloat(row.frais_port_reel) || 0 : 0;
      const rowFPaiement    = row ? parseFloat(row.frais_paiement)  || 0 : 0;
      const rowCoutProduits = coutByPeriod[periodISO] || coutByPeriod[normKey(periodISO)] || 0;
      const rowCAHT   = rowCATTCBrut - rowTVA;
      const rowProfit = rowCAHT - rowFPReel - rowCoutProduits - rowFPaiement;
      return {
        period:          periodISO,
        orders_count:    row ? row.orders_count : 0,
        ca_ttc_brut:     round2(rowCATTCBrut),
        ca_ht:           round2(rowCAHT),
        profit_ht:       round2(rowProfit),
        cout_produits:   round2(rowCoutProduits),
        frais_port_reel: round2(rowFPReel),
        frais_paiement:  round2(rowFPaiement),
      };
    };

    const series = periodSlots
      ? periodSlots.map(iso => buildPoint(iso, dataByPeriod[iso] || null))
      : seriesOrdersResult.rows.map(row => buildPoint(normKey(row.period), row));

    // ─── 6. RÉSULTAT ────────────────────────────────────────────────────────
    return {
      granularity: gran,
      kpis: {
        orders_count:       ordersCount,
        ca_ttc_brut:        round2(caTTCBrut),
        ca_ttc_net:         round2(caTTCNet),
        ca_ht_net:          round2(caHTNet),
        tva:                round2(tvaAjustee),
        remboursements_ttc: round2(remboursementsTTC),
        refunds_count:      refundsCount,
        frais_port_client:  round2(fraisPortClient),
        frais_port_reel:    round2(fraisPortReel),
        frais_paiement:     round2(fraisPaiement),
        cout_produits:      round2(coutProduits),
        profit_ht:          round2(profitHT),
        marge_ht:           round2(margeHT),
        panier_moyen_ht:    round2(panierMoyenHT),
      },
      series,
    };
}

exports.computeDashboard = computeDashboard;

/**
 * Total par pays (CA TTC brut + CA HT + nb commandes) pour une période.
 * Mêmes filtres que computeDashboard : 6 statuts payés, post_date en heure de Paris.
 * Regroupe sur billing_country, trié par CA décroissant.
 */
async function computeByCountry({ dateFrom, dateTo } = {}) {
  const { conditions, params } = buildDateConditions(dateFrom, dateTo);
  const where = 'WHERE ' + conditions.join(' AND ');

  const result = await pool.query(`
    SELECT
      COALESCE(NULLIF(o.billing_country, ''), '??') AS country_code,
      COUNT(o.wp_order_id)::int                      AS orders_count,
      COALESCE(SUM(o.order_total), 0)::numeric        AS ca_ttc_brut,
      COALESCE(SUM(o.order_tax), 0)::numeric          AS tva
    FROM orders o
    ${where}
    GROUP BY COALESCE(NULLIF(o.billing_country, ''), '??')
    ORDER BY ca_ttc_brut DESC
  `, params);

  return result.rows.map((r) => {
    const ttc = parseFloat(r.ca_ttc_brut) || 0;
    const tva = parseFloat(r.tva) || 0;
    return {
      country_code: r.country_code,
      orders_count: r.orders_count,
      ca_ttc_brut: round2(ttc),
      ca_ht: round2(ttc - tva),
    };
  });
}

exports.computeByCountry = computeByCountry;

/**
 * POST /api/financier/dashboard
 * Source de vérité unique pour tous les onglets.
 */
exports.getDashboard = async (req, res) => {
  try {
    const { dateFrom, dateTo, granularity } = req.body;
    const result = await computeDashboard({ dateFrom, dateTo, granularity });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error in financier dashboard:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

function round2(n) {
  return Math.round((n || 0) * 100) / 100;
}
