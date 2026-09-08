const pool = require('../config/database');

// Statuts considérés comme commandes actives (payées)
const ACTIVE_STATUSES = [
  'wc-completed', 'wc-processing', 'wc-shipped',
  'wc-delivered', 'wc-being-delivered', 'wc-awaiting-delivery'
];

/**
 * Date de référence financière = date de paiement réelle (paid_date), fallback sur
 * la date de création (post_date).
 * IMPORTANT : paid_date/post_date sont stockés en heure locale Paris (cf. CLAUDE.md),
 * PAS en UTC. On les compare donc bruts, sans conversion de fuseau. Toute conversion
 * « AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris' » décale de +1/+2h et fait fuiter
 * les commandes du soir vers le lendemain (cf. fix 621fa9d, régressé puis re-corrigé).
 */
/**
 * ─── TVA RÉELLEMENT COLLECTÉE SUR UNE COMMANDE ─────────────────────────────
 * TVA = TVA des lignes produit (line_item.line_tax) + TVA du port.
 *
 * La TVA du port est portée par la ligne de taxe (order_item_type = 'tax',
 * colonne line_tax) — mais cette ligne est ABSENTE d'une grande partie des
 * commandes antérieures à avril 2026 : la synchro ne la créait pas. La TVA du
 * port était alors purement et simplement perdue, alors que le client l'a payée
 * (elle est bien comprise dans order_total). Résultat : TVA sous-évaluée et, par
 * construction, CA HT surévalué d'autant — de l'ordre de 800 à 1 300 € par mois.
 *
 * Elle est donc reconstituée par le résidu :
 *     order_total − port − Σ(line_total + line_tax des lignes produit)
 * Ce résidu n'est retenu que s'il correspond au port multiplié par le taux
 * constaté sur les produits, à 2 centimes près. Garde-fou indispensable : sur les
 * commandes dont les lignes produit sont elles-mêmes incomplètes, le résidu
 * capterait n'importe quoi.
 *
 * Contrôlé sur les 9 399 commandes depuis 2025 où la TVA du port EST enregistrée :
 * le résidu la retrouve exactement (0 commande divergente, 2 centimes d'écart
 * cumulé au total). Aucun risque de double comptage, la valeur enregistrée restant
 * prioritaire quand elle existe.
 *
 * Produit une CTE `tva_reelle(wp_order_id, tva)`.
 */
function orderVatCTE(cmdSource, name = 'tva_reelle') {
  return `
  ${name} AS (
    SELECT b.wp_order_id,
      b.tva_prod + CASE
        WHEN b.tva_port <> 0 THEN b.tva_port
        WHEN b.residu > 0 AND b.ht_prod > 0
         AND ABS(b.residu - ROUND(b.port * b.tva_prod / b.ht_prod, 2)) <= 0.02
          THEN b.residu
        ELSE 0
      END AS tva
    FROM (
      SELECT o.wp_order_id,
        COALESCE(o.order_shipping, 0) AS port,
        SUM(CASE WHEN oi.order_item_type = 'line_item' THEN oi.line_total ELSE 0 END) AS ht_prod,
        SUM(CASE WHEN oi.order_item_type = 'line_item' THEN oi.line_tax   ELSE 0 END) AS tva_prod,
        SUM(CASE WHEN oi.order_item_type = 'tax'       THEN oi.line_tax   ELSE 0 END) AS tva_port,
        o.order_total - COALESCE(o.order_shipping, 0)
          - SUM(CASE WHEN oi.order_item_type = 'line_item' THEN oi.line_total + oi.line_tax ELSE 0 END) AS residu
      FROM orders o
      JOIN order_items oi ON oi.wp_order_id = o.wp_order_id
      WHERE o.wp_order_id IN (${cmdSource})
      GROUP BY o.wp_order_id, o.order_shipping, o.order_total
    ) b
  )`;
}

function refDateParis(alias = 'o') {
  return `(COALESCE(${alias}.paid_date, ${alias}.post_date))`;
}

/**
 * Borne haute d'une plage de dates. Si dateTo est une date nue ('YYYY-MM-DD'),
 * on prend la fin de journée. Si un horaire est déjà présent (ex. comparaison
 * « à la même heure » envoyée par /financier : 'YYYY-MM-DD HH:MM:SS'), on le
 * respecte tel quel — permet une comparaison pro rata temporis (journée en cours
 * vs période précédente coupée à la même heure).
 */
function upperBound(dateTo) {
  return dateTo.length > 10 ? dateTo : dateTo + ' 23:59:59';
}

/**
 * Construit les conditions WHERE et les paramètres pour une plage de dates.
 * Filtre sur la date de paiement (paid_date) en heure Paris brute — aligné sur Metorik.
 * Exclut les commandes à 0 € (SAV / remplacements) — Metorik ne les compte pas.
 * Retourne { conditions, params, nextIndex }
 */
function buildDateConditions(dateFrom, dateTo, startIndex = 1, alias = 'o') {
  const conditions = [
    `${alias}.post_status = ANY($${startIndex})`,
    `${alias}.order_total > 0`
  ];
  const params = [ACTIVE_STATUSES];
  let idx = startIndex + 1;

  if (dateFrom) {
    conditions.push(`${refDateParis(alias)} >= $${idx++}`);
    params.push(dateFrom);
  }
  if (dateTo) {
    conditions.push(`${refDateParis(alias)} <= $${idx++}`);
    params.push(upperBound(dateTo));
  }

  return { conditions, params, nextIndex: idx };
}

/**
 * ─── TVA CONTENUE DANS UN REMBOURSEMENT ────────────────────────────────────
 * Deux sources, par ordre de fiabilité :
 *  1) refunds.order_tax — la TVA que WooCommerce a réellement ventilée sur l'avoir
 *     (meta `_order_tax` du remboursement, stockée en négatif). Valeur EXACTE.
 *  2) À défaut, le taux de TVA réel de LA COMMANDE remboursée
 *     (TVA de la commande / total TTC de la commande) appliqué au montant de l'avoir.
 *     C'est une estimation, mais commande par commande : un avoir sur une commande
 *     export (0 %) ne retire plus de TVA à tort, contrairement à l'ancien calcul qui
 *     appliquait le taux MOYEN de la période à tous les remboursements.
 *
 * Le cas 2) est aujourd'hui majoritaire : depuis le 17/06/2026 les remboursements
 * arrivent par le webhook temps réel (webhookController.insertRefund), qui n'écrit
 * ni order_total ni order_tax → colonnes NULL. Corriger cette ingestion rendra le
 * cas 1) à nouveau dominant sans rien changer ici.
 *
 * Alias attendus : r = refunds, o = orders, tc = TVA de la commande remboursée.
 */
const REFUND_TAX_EXPR = `
  CASE
    WHEN COALESCE(r.order_tax, 0) <> 0 THEN ABS(r.order_tax)
    WHEN COALESCE(o.order_total, 0) > 0 THEN r.refund_amount * (COALESCE(tc.tva, 0) / o.order_total)
    ELSE 0
  END`;

/**
 * TVA réelle (produits + livraison) des commandes ayant au moins un remboursement.
 * Volontairement NON filtré par date : un avoir de juillet peut porter sur une
 * commande de juin, il faut alors le taux de cette commande-là. La table refunds
 * est petite (~1 200 lignes), le coût est négligeable.
 */
const REFUND_ORDER_TAX_CTE = orderVatCTE(
  'SELECT DISTINCT wp_order_id FROM refunds', 'tva_cmd_remboursee'
);

const REFUND_TAX_JOIN = `LEFT JOIN tva_cmd_remboursee tc ON tc.wp_order_id = r.wp_order_id`;

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

    // ─── COÛT TRANSPORT RÉEL (factures transporteurs) ─────────────────────
    // Coût d'expédition « réel » d'une commande = somme des colis facturés par le
    // transporteur (carrier_invoice_parcels.amount_ht), réconciliés via order_id.
    // Tant qu'une commande n'a AUCUN colis facturé (> 0 €), on retombe sur le coût
    // ESTIMÉ configuré (orders.shipping_cost_calculated). La jointure est 1:1 par
    // commande (agrégation par order_id) → pas de fan-out sur les autres agrégats.
    // amount_ht > 0 : on ignore les colis sans tarif encore appliqué (NULL/0).
    const shipJoin = `
      LEFT JOIN (
        SELECT order_id, SUM(amount_ht) AS real_cost
        FROM carrier_invoice_parcels
        WHERE order_id IS NOT NULL AND amount_ht > 0
        GROUP BY order_id
      ) ship ON ship.order_id = o.wp_order_id`;
    const shipCostExpr = `COALESCE(ship.real_cost, o.shipping_cost_calculated)`;

    // ─── COÛT PRODUIT UNITAIRE — jamais 0 si un coût existe quelque part ────
    // Priorité : computed_cost (PMP FIFO achats) → wc_cog_cost du produit →
    // computed_cost/wc_cog_cost du PARENT variable (dans WooCommerce le COG est
    // souvent porté par le produit parent, pas par chaque variation) → 0 en
    // dernier recours. NULLIF(...,0) pour ignorer un wc_cog_cost à 0 littéral.
    // Bundles woosb : leur coût est déjà porté par les lignes composants (à 0 € de CA
    // mais qty × coût réels) présentes dans la commande → on met 0 sur la ligne PARENT
    // du bundle pour ne pas double-compter (le bundle a par ailleurs un computed_cost
    // renseigné = somme des composants, pour l'affichage catalogue).
    const parentJoin = `LEFT JOIN products par ON par.wp_product_id = p.wp_parent_id`;
    const prodCostExpr = `CASE WHEN p.product_type = 'woosb' THEN 0 ELSE COALESCE(p.computed_cost, NULLIF(p.wc_cog_cost,0), par.computed_cost, NULLIF(par.wc_cog_cost,0), 0) END`;

    // ─── 1. KPIs GLOBAUX — agrégats order-level ────────────────────────────
    // TVA réelle = line_item.line_tax (TVA produits) + tax_item.line_tax (TVA livraison)
    // order_shipping_tax est toujours NULL en BDD, il faut passer par order_items
    const orderKpisResult = await pool.query(`
      WITH ${orderVatCTE(`SELECT wp_order_id FROM orders o ${where}`)}
      SELECT
        COUNT(o.wp_order_id)::int                                          AS orders_count,
        COALESCE(SUM(o.order_total), 0)::numeric                          AS ca_ttc_brut,
        COALESCE(SUM(t.tva), 0)::numeric                                  AS tva,
        COALESCE(SUM(o.order_shipping), 0)::numeric                       AS frais_port_client,
        COALESCE(SUM(${shipCostExpr}), 0)::numeric                        AS frais_port_reel,
        COALESCE(SUM(o.payment_cost_calculated), 0)::numeric              AS frais_paiement
      FROM orders o
      LEFT JOIN tva_reelle t ON t.wp_order_id = o.wp_order_id
      ${shipJoin}
      ${where}
    `, params);

    // ─── 2. COÛT PRODUITS — agrégat item-level ─────────────────────────────
    const coutResult = await pool.query(`
      SELECT
        COALESCE(SUM(
          oi.qty * ${prodCostExpr}
        ), 0)::numeric AS cout_produits
      FROM orders o
      LEFT JOIN order_items oi ON o.wp_order_id = oi.wp_order_id
      LEFT JOIN products p ON (
        NULLIF(oi.variation_id, 0) = p.wp_product_id
        OR (COALESCE(oi.variation_id, 0) = 0 AND oi.product_id = p.wp_product_id)
      )
      ${parentJoin}
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
      refundsConds.push(`(r.refund_date) >= $${rIdx++}`);
      refundsParams.push(dateFrom);
    }
    if (dateTo) {
      refundsConds.push(`(r.refund_date) <= $${rIdx++}`);
      refundsParams.push(upperBound(dateTo));
    }

    const refundsResult = await pool.query(`
      WITH ${REFUND_ORDER_TAX_CTE}
      SELECT
        COALESCE(SUM(r.refund_amount), 0)::numeric        AS remboursements_ttc,
        COALESCE(SUM(${REFUND_TAX_EXPR}), 0)::numeric     AS remboursements_tva,
        COUNT(DISTINCT r.wp_order_id)::int                AS refunds_count
      FROM refunds r
      JOIN orders o ON r.wp_order_id = o.wp_order_id
      ${REFUND_TAX_JOIN}
      WHERE ${refundsConds.join(' AND ')}
    `, refundsParams);

    const remboursementsTTC = parseFloat(refundsResult.rows[0].remboursements_ttc) || 0;
    const remboursementsTVA = parseFloat(refundsResult.rows[0].remboursements_tva) || 0;
    const refundsCount      = refundsResult.rows[0].refunds_count || 0;

    // ─── 4. CALCULS DÉRIVÉS ─────────────────────────────────────────────────
    // TVA ajustée des remboursements — TVA réelle de chaque avoir (cf. REFUND_TAX_EXPR),
    // et non plus le taux moyen de la période appliqué au total remboursé.
    const tvaAjustee    = tva - remboursementsTVA;
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
        // Toujours raisonner sur la date nue : dateTo peut porter un horaire
        // (comparaison « à la même heure »), qui casserait le parsing et
        // désalignerait la granularité de la série précédente.
        const fromDay = (dateFrom || '2020-01-01').slice(0, 10);
        const toDay   = (dateTo || new Date().toISOString().slice(0, 10)).slice(0, 10);
        const from = new Date(fromDay);
        const to   = new Date(toDay + 'T23:59:59');
        const diffDays = (to - from) / (1000 * 60 * 60 * 24);
        if (fromDay === toDay)    gran = 'quarter';
        else if (diffDays <= 1)   gran = 'hour';
        else if (diffDays <= 35)  gran = 'day';
        else if (diffDays <= 120) gran = 'week';
        else                      gran = 'month';
      }
    }

    const ref = refDateParis('o');
    const truncMap = {
      quarter: `date_trunc('hour', ${ref}) + (floor(extract(minute FROM ${ref}) / 15) * interval '15 minutes')`,
      hour:    `date_trunc('hour', ${ref})`,
      day:     `date_trunc('day', ${ref})`,
      week:    `date_trunc('week', ${ref})`,
      month:   `date_trunc('month', ${ref})`,
    };
    const truncExpr = truncMap[gran] || truncMap.day;

    // Séries : order-level (pas de fan-out)
    // TVA via order_items (order_shipping_tax toujours NULL en BDD)
    const seriesOrdersResult = await pool.query(`
      WITH ${orderVatCTE(`SELECT wp_order_id FROM orders o ${where}`)}
      SELECT
        ${truncExpr}                                                           AS period,
        COUNT(o.wp_order_id)::int                                              AS orders_count,
        COALESCE(SUM(o.order_total), 0)::numeric                               AS ca_ttc_brut,
        COALESCE(SUM(t.tva), 0)::numeric                                       AS tva,
        COALESCE(SUM(${shipCostExpr}), 0)::numeric                            AS frais_port_reel,
        COALESCE(SUM(o.payment_cost_calculated), 0)::numeric                   AS frais_paiement
      FROM orders o
      LEFT JOIN tva_reelle t ON t.wp_order_id = o.wp_order_id
      ${shipJoin}
      ${where}
      GROUP BY ${truncExpr}
      ORDER BY ${truncExpr}
    `, params);

    // Séries : coût produits par période
    const seriesCoutResult = await pool.query(`
      SELECT
        ${truncExpr}                                                           AS period,
        COALESCE(SUM(
          oi.qty * ${prodCostExpr}
        ), 0)::numeric                                                         AS cout_produits
      FROM orders o
      LEFT JOIN order_items oi ON o.wp_order_id = oi.wp_order_id
      LEFT JOIN products p ON (
        NULLIF(oi.variation_id, 0) = p.wp_product_id
        OR (COALESCE(oi.variation_id, 0) = 0 AND oi.product_id = p.wp_product_id)
      )
      ${parentJoin}
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

    // ─── 6. NOUVEAUX CLIENTS ────────────────────────────────────────────────
    const newCustomers = await computeNewCustomers({ dateFrom, dateTo });

    // ─── 7. RÉSULTAT ────────────────────────────────────────────────────────
    return {
      granularity: gran,
      kpis: {
        orders_count:              ordersCount,
        ca_ttc_brut:               round2(caTTCBrut),
        ca_ttc_net:                round2(caTTCNet),
        ca_ht_net:                 round2(caHTNet),
        tva:                       round2(tvaAjustee),
        remboursements_ttc:        round2(remboursementsTTC),
        remboursements_tva:        round2(remboursementsTVA),
        refunds_count:             refundsCount,
        frais_port_client:         round2(fraisPortClient),
        frais_port_reel:           round2(fraisPortReel),
        frais_paiement:            round2(fraisPaiement),
        cout_produits:             round2(coutProduits),
        profit_ht:                 round2(profitHT),
        marge_ht:                  round2(margeHT),
        panier_moyen_ht:           round2(panierMoyenHT),
        nouveaux_clients:          newCustomers.nouveaux_clients,
        nouveaux_clients_commande: newCustomers.nouveaux_clients_commande,
      },
      series,
    };
}

exports.computeDashboard = computeDashboard;

/**
 * Exécute `fn` sur chaque élément de `items` avec une concurrence limitée à `limit`.
 * Évite de saturer le pool PG (BDD PROD partagée) quand on calcule un lot de mois.
 */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return results;
}

/**
 * Série mensuelle des KPIs sur les `months` derniers mois (mois courant inclus).
 * Réutilise computeDashboard mois par mois → garantit des chiffres strictement
 * identiques à ceux des cartes (mêmes formules TVA/remboursements/coûts).
 * Retourne [{ month: 'YYYY-MM', dateFrom, dateTo, kpis }] du plus ancien au plus récent.
 */
async function computeMonthlySeries({ months = 12 } = {}) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');

  const ranges = [];
  for (let i = months - 1; i >= 0; i--) {
    const first = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const last  = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    const y  = first.getFullYear();
    const mo = pad(first.getMonth() + 1);
    ranges.push({
      month:    `${y}-${mo}`,
      dateFrom: `${y}-${mo}-01`,
      dateTo:   `${y}-${mo}-${pad(last.getDate())}`,
    });
  }

  // Concurrence limitée : BDD PROD partagée, on ne lance pas 12 dashboards d'un coup.
  return mapLimit(ranges, 4, async (r) => {
    const { kpis } = await computeDashboard({
      dateFrom: r.dateFrom,
      dateTo: r.dateTo,
      granularity: 'month',
    });
    return { month: r.month, dateFrom: r.dateFrom, dateTo: r.dateTo, kpis };
  });
}

exports.computeMonthlySeries = computeMonthlySeries;

/**
 * POST /api/financier/monthly
 * Série mensuelle de tous les KPIs → alimente les graphiques d'évolution
 * ouverts au clic sur une carte du dashboard.
 */
exports.getMonthlySeries = async (req, res) => {
  try {
    const raw = parseInt(req.body?.months, 10);
    const months = Math.min(Math.max(Number.isNaN(raw) ? 12 : raw, 1), 36);
    const series = await computeMonthlySeries({ months });
    res.json({ success: true, months: series });
  } catch (error) {
    console.error('Error in financier monthly series:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Nouveaux clients inscrits sur la période (customers.user_registered, heure
 * Paris brute — même logique que refDateParis) + parmi eux, combien ont déjà
 * passé au moins une commande active (à ce jour, pas uniquement sur la période :
 * on mesure une conversion, pas juste une coïncidence de dates).
 */
async function computeNewCustomers({ dateFrom, dateTo } = {}) {
  const conditions = [];
  const params = [ACTIVE_STATUSES];
  let idx = 2;

  if (dateFrom) {
    conditions.push(`c.user_registered >= $${idx++}`);
    params.push(dateFrom);
  }
  if (dateTo) {
    conditions.push(`c.user_registered <= $${idx++}`);
    params.push(upperBound(dateTo));
  }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const result = await pool.query(`
    SELECT
      COUNT(*)::int AS new_customers,
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM orders o
          WHERE o.wp_customer_id = c.wp_user_id
            AND o.post_status = ANY($1)
            AND o.order_total > 0
        )
      )::int AS new_customers_with_order
    FROM customers c
    ${where}
  `, params);

  const row = result.rows[0];
  return {
    nouveaux_clients:          row.new_customers || 0,
    nouveaux_clients_commande: row.new_customers_with_order || 0,
  };
}

exports.computeNewCustomers = computeNewCustomers;

/**
 * Total par pays (CA TTC brut + CA HT + nb commandes + panier moyen HT) pour une
 * période. Mêmes filtres que computeDashboard : 6 statuts payés, date de paiement
 * (paid_date) en heure de Paris. Regroupe sur billing_country, trié par CA décroissant.
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
    const ht = ttc - tva;
    return {
      country_code: r.country_code,
      orders_count: r.orders_count,
      ca_ttc_brut: round2(ttc),
      ca_ht: round2(ht),
      panier_moyen_ht: round2(r.orders_count > 0 ? ht / r.orders_count : 0),
    };
  });
}

exports.computeByCountry = computeByCountry;

/**
 * Déclaration comptable : par pays de facturation, CA TTC / CA HT / TVA collectée,
 * en version BRUTE (ventes de la période) ET NETTE (après remboursements de la période).
 *
 * - TVA calculée via la formule exacte order_items (produits + livraison), identique
 *   au KPI « TVA » du dashboard → les totaux réconcilient avec les cartes.
 * - CA HT = CA TTC − TVA.
 * - Remboursements agrégés par pays sur `refund_date` (comme le KPI remboursements).
 *   TVA nette = TVA brute − TVA réellement contenue dans les avoirs, calculée avoir
 *   par avoir (cf. REFUND_TAX_EXPR) et non par une règle de trois sur le total.
 *
 * Regroupement par PAYS DE FACTURATION (billing_country). La TVA affichée reste
 * celle réellement collectée sur la commande : une commande facturée à l'étranger
 * mais livrée en France porte la TVA française et la conserve sous son pays de
 * facturation (choix métier assumé, cf. commandes CH livrées en FR).
 *
 * Retourne { rows: [...], totals: {...} } trié par CA TTC brut décroissant.
 */
async function computeComptable({ dateFrom, dateTo } = {}) {
  const { conditions, params } = buildDateConditions(dateFrom, dateTo);
  const where = 'WHERE ' + conditions.join(' AND ');
  const countryExpr = `COALESCE(NULLIF(o.billing_country, ''), '??')`;

  // Ventes par pays + TVA exacte (produits + livraison) via order_items.
  const salesResult = await pool.query(`
    WITH ${orderVatCTE(`SELECT wp_order_id FROM orders o ${where}`)}
    SELECT
      ${countryExpr}                                 AS country_code,
      COUNT(o.wp_order_id)::int                      AS orders_count,
      COALESCE(SUM(o.order_total), 0)::numeric        AS ca_ttc_brut,
      COALESCE(SUM(t.tva), 0)::numeric                AS tva_brut
    FROM orders o
    LEFT JOIN tva_reelle t ON t.wp_order_id = o.wp_order_id
    ${where}
    GROUP BY ${countryExpr}
  `, params);

  // Remboursements par pays, filtrés sur refund_date (même périmètre que le KPI remboursements).
  const refundsParams = [];
  const refundsConds  = [
    `o.post_status NOT IN ('wc-cancelled', 'wc-failed', 'wc-checkout-draft', 'wc-trash', 'wc-pending', 'wc-auto-draft')`
  ];
  let rIdx = 1;
  if (dateFrom) { refundsConds.push(`(r.refund_date) >= $${rIdx++}`); refundsParams.push(dateFrom); }
  if (dateTo)   { refundsConds.push(`(r.refund_date) <= $${rIdx++}`); refundsParams.push(upperBound(dateTo)); }

  const refundsResult = await pool.query(`
    WITH ${REFUND_ORDER_TAX_CTE}
    SELECT
      ${countryExpr}                                 AS country_code,
      COALESCE(SUM(r.refund_amount), 0)::numeric      AS remboursements_ttc,
      COALESCE(SUM(${REFUND_TAX_EXPR}), 0)::numeric   AS remboursements_tva
    FROM refunds r
    JOIN orders o ON r.wp_order_id = o.wp_order_id
    ${REFUND_TAX_JOIN}
    WHERE ${refundsConds.join(' AND ')}
    GROUP BY ${countryExpr}
  `, refundsParams);

  const refundsByCountry = {};
  for (const row of refundsResult.rows) {
    refundsByCountry[row.country_code] = {
      ttc: parseFloat(row.remboursements_ttc) || 0,
      tva: parseFloat(row.remboursements_tva) || 0,
    };
  }

  const rows = salesResult.rows.map((r) => {
    const ttcBrut  = parseFloat(r.ca_ttc_brut) || 0;
    const tvaBrut  = parseFloat(r.tva_brut) || 0;
    const htBrut   = ttcBrut - tvaBrut;
    const refund   = refundsByCountry[r.country_code] || { ttc: 0, tva: 0 };
    const remb     = refund.ttc;
    const rembTVA  = refund.tva;
    const tvaNet   = tvaBrut - rembTVA;
    const ttcNet   = ttcBrut - remb;
    const htNet    = ttcNet - tvaNet;
    return {
      country_code: r.country_code,
      orders_count: r.orders_count,
      ca_ttc_brut: round2(ttcBrut),
      ca_ht_brut:  round2(htBrut),
      tva_brut:    round2(tvaBrut),
      remboursements_ttc: round2(remb),
      remboursements_ht:  round2(remb - rembTVA),
      remboursements_tva: round2(rembTVA),
      ca_ttc_net:  round2(ttcNet),
      ca_ht_net:   round2(htNet),
      tva_net:     round2(tvaNet),
      // Valeurs non arrondies, réservées au calcul des totaux (cf. plus bas).
      _brut: { ttcBrut, htBrut, tvaBrut, remb, rembTVA, ttcNet, htNet, tvaNet },
    };
  });

  // Remboursements rattachés à un pays sans vente dans la période → lignes purement négatives.
  for (const [cc, refund] of Object.entries(refundsByCountry)) {
    if (refund.ttc > 0 && !rows.some((r) => r.country_code === cc)) {
      rows.push({
        country_code: cc, orders_count: 0,
        ca_ttc_brut: 0, ca_ht_brut: 0, tva_brut: 0,
        remboursements_ttc: round2(refund.ttc),
        remboursements_ht:  round2(refund.ttc - refund.tva),
        remboursements_tva: round2(refund.tva),
        ca_ttc_net: round2(-refund.ttc),
        ca_ht_net:  round2(-(refund.ttc - refund.tva)),
        tva_net:    round2(-refund.tva),
        _brut: {
          ttcBrut: 0, htBrut: 0, tvaBrut: 0,
          remb: refund.ttc, rembTVA: refund.tva,
          ttcNet: -refund.ttc, htNet: -(refund.ttc - refund.tva), tvaNet: -refund.tva,
        },
      });
    }
  }

  rows.sort((a, b) => b.ca_ttc_brut - a.ca_ttc_brut);

  // Les totaux cumulent les valeurs EXACTES puis sont arrondis une seule fois.
  // Sommer des lignes déjà arrondies faisait dériver le total d'un centime et
  // désaccordait l'onglet comptable et la CA3 sur une même période.
  const totals = rows.reduce((t, r) => ({
    orders_count:       t.orders_count + r.orders_count,
    ca_ttc_brut:        t.ca_ttc_brut + r._brut.ttcBrut,
    ca_ht_brut:         t.ca_ht_brut + r._brut.htBrut,
    tva_brut:           t.tva_brut + r._brut.tvaBrut,
    remboursements_ttc: t.remboursements_ttc + r._brut.remb,
    remboursements_ht:  t.remboursements_ht + (r._brut.remb - r._brut.rembTVA),
    remboursements_tva: t.remboursements_tva + r._brut.rembTVA,
    ca_ttc_net:         t.ca_ttc_net + r._brut.ttcNet,
    ca_ht_net:          t.ca_ht_net + r._brut.htNet,
    tva_net:            t.tva_net + r._brut.tvaNet,
  }), { orders_count: 0, ca_ttc_brut: 0, ca_ht_brut: 0, tva_brut: 0, remboursements_ttc: 0, remboursements_ht: 0, remboursements_tva: 0, ca_ttc_net: 0, ca_ht_net: 0, tva_net: 0 });

  for (const k of Object.keys(totals)) totals[k] = round2(totals[k]);
  totals.orders_count = Math.round(totals.orders_count);

  for (const r of rows) delete r._brut;

  return { rows, totals };
}

exports.computeComptable = computeComptable;

/* ═══════════════════════════════════════════════════════════════════════════
 * CA3 — formulaire 3310-CA3 (déclaration de TVA au régime réel normal)
 * ═══════════════════════════════════════════════════════════════════════════
 * Ce bloc ne couvre que la TVA COLLECTÉE : cadre A (montant des opérations) et
 * la TVA brute du cadre B (lignes 08 à 16). La TVA DÉDUCTIBLE (lignes 19 à 23)
 * vient des factures d'achat et n'est pas dans le périmètre de cette app.
 *
 * Territorialité : la TVA suit le lieu de LIVRAISON, donc shipping_country
 * (repli sur billing_country s'il est vide — 0 cas constaté). C'est la seule
 * différence de fond avec le détail par pays de la déclaration comptable, qui
 * regroupe lui par pays de FACTURATION : une commande facturée en Suisse mais
 * livrée en France est une vente française pour la CA3.
 *
 * Les codes postaux ne sont PAS utilisés pour détecter l'outre-mer : des
 * adresses étrangères commencent aussi par 97/98 (constaté : BE 970xx, NL
 * 974xx, LU 976xx). Seul shipping_country fait foi. Exception assumée : Monaco,
 * que WooCommerce enregistre tantôt en 'MC', tantôt en 'FR' + CP 980xx.
 */

// UE-27 hors France (la France est traitée à part, avec Monaco).
const CA3_UE = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'DE', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI',
  'ES', 'SE'
];
// Départements et régions d'outre-mer : territoires d'exportation au sens de
// la TVA (art. 294 CGI). Guyane et Mayotte : TVA provisoirement non applicable.
const CA3_DOM = ['GP', 'MQ', 'GF', 'RE', 'YT'];
// Collectivités d'outre-mer et Nouvelle-Calédonie : hors territoire TVA.
const CA3_TOM = ['PF', 'NC', 'WF', 'PM', 'BL', 'MF', 'TF'];

const CA3_ZONE_LABELS = {
  FR:      'France métropolitaine + Monaco',
  DOM:     "Départements d'outre-mer",
  TOM:     "Collectivités d'outre-mer",
  UE:      'Union européenne (hors France)',
  HORS_UE: 'Pays tiers (hors UE)',
};

/** Zone de territorialité TVA, à partir du pays de livraison. */
function ca3ZoneExpr(alias = 'o') {
  const dest = `COALESCE(NULLIF(${alias}.shipping_country, ''), ${alias}.billing_country)`;
  const list = (arr) => arr.map((c) => `'${c}'`).join(', ');
  return `CASE
      WHEN ${dest} IN ('FR', 'MC')        THEN 'FR'
      WHEN ${dest} IN (${list(CA3_DOM)})  THEN 'DOM'
      WHEN ${dest} IN (${list(CA3_TOM)})  THEN 'TOM'
      WHEN ${dest} IN (${list(CA3_UE)})   THEN 'UE'
      ELSE 'HORS_UE'
    END`;
}

/** Monaco : identifié par le pays 'MC' ou par un CP 980xx en France. */
function ca3MonacoExpr(alias = 'o') {
  const dest = `COALESCE(NULLIF(${alias}.shipping_country, ''), ${alias}.billing_country)`;
  return `(${dest} = 'MC' OR (${dest} = 'FR' AND ${alias}.shipping_postcode LIKE '980%'))`;
}

/**
 * Taux de TVA d'une commande, lu sur ses lignes de taxe QUAND ELLES EXISTENT.
 * Le taux n'est stocké nulle part en clair : il est porté par le libellé du taux
 * (line_tax_data->>'rate_code', ex. « FR-TVA 20%-1 », sinon order_item_name).
 *
 * ATTENTION — ce libellé ne peut pas servir de source unique : une grande partie
 * des commandes n'a AUCUNE ligne de taxe synchronisée alors qu'elle porte bien de
 * la TVA sur ses lignes produit (2 019 commandes sur 4 038 en mars 2026, soit
 * 16 540 € de TVA). S'en remettre au seul libellé revenait à les traiter comme non
 * taxées et à sortir leur TVA du cadre B. Le taux est donc systématiquement
 * recalculé à partir des montants (cf. ca3EffRate) et le libellé n'est qu'une
 * source prioritaire quand il est disponible.
 */
const CA3_RATE_CTE = (cmdSource) => `
  taux_cmd AS (
    SELECT oi.wp_order_id,
      array_agg(DISTINCT (regexp_match(
        COALESCE(oi.line_tax_data->>'rate_code', oi.order_item_name),
        '([0-9]+([.,][0-9]+)?)\\s*%'
      ))[1]) AS taux
    FROM order_items oi
    WHERE oi.order_item_type = 'tax'
      AND oi.wp_order_id IN (${cmdSource})
      AND COALESCE(oi.line_total, 0) + COALESCE(oi.line_tax, 0) <> 0
    GROUP BY oi.wp_order_id
  )`;

/**
 * Taux effectif d'une opération, recalculé depuis les montants : TVA / HT.
 * Source de vérité de repli, indépendante de la présence des lignes de taxe.
 */
function ca3EffRate(tvaExpr, ttcExpr) {
  return `CASE
      WHEN COALESCE(${tvaExpr}, 0) = 0 THEN NULL
      WHEN (${ttcExpr}) - COALESCE(${tvaExpr}, 0) > 0
        THEN COALESCE(${tvaExpr}, 0) / ((${ttcExpr}) - COALESCE(${tvaExpr}, 0)) * 100
      ELSE NULL
    END`;
}

/**
 * Aligne un taux effectif sur le taux légal le plus proche. Une commande à 20 %
 * peut tomber à 19,98 % ou 20,02 % à cause des arrondis au centime ligne à ligne ;
 * sans cet alignement le cadre B se fragmenterait en dizaines de faux taux.
 * La fenêtre (±0,3 point) est très inférieure à l'écart entre deux taux légaux.
 *
 * Un taux hors de toute fenêtre n'est PAS inventé : il retourne NULL et l'opération
 * bascule en ligne 14 (« taux indéterminé »), où son montant de TVA — lui, bien réel —
 * est conservé. Sans cela le cadre B se remplissait de pseudo-taux (jusqu'à 218 lignes
 * à 18,97 %, 19,22 %…) issus de commandes aux lignes produit incomplètes, ce qui donnait
 * un formulaire illisible et un faux air de précision.
 */
function ca3SnapRate(effExpr) {
  return `CASE
      WHEN (${effExpr}) IS NULL THEN NULL
      WHEN (${effExpr}) BETWEEN 19.7 AND 20.3 THEN 20
      WHEN (${effExpr}) BETWEEN  9.7 AND 10.3 THEN 10
      WHEN (${effExpr}) BETWEEN  5.2 AND  5.8 THEN 5.5
      WHEN (${effExpr}) BETWEEN  1.8 AND  2.4 THEN 2.1
      ELSE NULL
    END`;
}

/** Ligne du cadre B (TVA brute) correspondant à un taux. */
function ca3RateLine(taux) {
  // Taux introuvable alors que de la TVA a bien été collectée : l'opération reste
  // dans le cadre B (sinon la TVA brute ne serait plus égale à la TVA encaissée).
  if (taux === null) return { code: '14', libelle: 'Opérations imposables — taux indéterminé' };
  if (taux === 20)  return { code: '08', libelle: 'Taux normal 20 %' };
  if (taux === 5.5) return { code: '09', libelle: 'Taux réduit 5,5 %' };
  if (taux === 10)  return { code: '9B', libelle: 'Taux réduit 10 %' };
  if (taux === 2.1) return { code: '10', libelle: 'Taux particulier 2,1 %' };
  return { code: '14', libelle: `Opérations imposables à un autre taux (${taux} %)` };
}

/**
 * Construit la CA3 d'une période.
 * Retourne { cadreA, cadreB, tva_brute, territorialite, controles, meta }.
 */
async function computeCA3({ dateFrom, dateTo } = {}) {
  const { conditions, params } = buildDateConditions(dateFrom, dateTo);
  const where = 'WHERE ' + conditions.join(' AND ');

  // ─── VENTES : par zone × taux ────────────────────────────────────────────
  const ventesResult = await pool.query(`
    WITH cmd AS (
      SELECT o.wp_order_id, o.order_total,
             ${ca3ZoneExpr('o')} AS zone,
             ${ca3MonacoExpr('o')} AS monaco
      FROM orders o
      ${where}
    ),
    ${orderVatCTE('SELECT wp_order_id FROM cmd', 'tva_cmd')},
    ${CA3_RATE_CTE('SELECT wp_order_id FROM cmd')}
    SELECT
      c.zone,
      c.monaco,
      COALESCE(array_length(tx.taux, 1), 0)::int    AS nb_taux,
      COALESCE(
        replace(tx.taux[1], ',', '.')::numeric,
        ${ca3SnapRate(ca3EffRate('t.tva', 'c.order_total'))}
      )                                             AS taux,
      CASE WHEN tx.taux[1] IS NOT NULL THEN 'libelle' ELSE 'calcule' END AS taux_source,
      COUNT(*)::int                                 AS cmd,
      COALESCE(SUM(c.order_total), 0)::numeric      AS ttc,
      COALESCE(SUM(COALESCE(t.tva, 0)), 0)::numeric AS tva
    FROM cmd c
    LEFT JOIN tva_cmd t  ON t.wp_order_id  = c.wp_order_id
    LEFT JOIN taux_cmd tx ON tx.wp_order_id = c.wp_order_id
    GROUP BY 1, 2, 3, 4, 5
  `, params);

  // ─── AVOIRS : par zone × taux, rattachés au mois de leur émission ────────
  const refundsParams = [];
  const refundsConds  = [
    `o.post_status NOT IN ('wc-cancelled', 'wc-failed', 'wc-checkout-draft', 'wc-trash', 'wc-pending', 'wc-auto-draft')`
  ];
  let rIdx = 1;
  if (dateFrom) { refundsConds.push(`(r.refund_date) >= $${rIdx++}`); refundsParams.push(dateFrom); }
  if (dateTo)   { refundsConds.push(`(r.refund_date) <= $${rIdx++}`); refundsParams.push(upperBound(dateTo)); }

  const avoirsResult = await pool.query(`
    WITH ${REFUND_ORDER_TAX_CTE},
    ${CA3_RATE_CTE('SELECT DISTINCT wp_order_id FROM refunds')}
    SELECT
      ${ca3ZoneExpr('o')}                              AS zone,
      COALESCE(
        replace(tx.taux[1], ',', '.')::numeric,
        ${ca3SnapRate(ca3EffRate('tc.tva', 'o.order_total'))}
      )                                                AS taux,
      COALESCE(SUM(r.refund_amount), 0)::numeric       AS ttc,
      COALESCE(SUM(${REFUND_TAX_EXPR}), 0)::numeric    AS tva
    FROM refunds r
    JOIN orders o ON r.wp_order_id = o.wp_order_id
    ${REFUND_TAX_JOIN}
    LEFT JOIN taux_cmd tx ON tx.wp_order_id = r.wp_order_id
    WHERE ${refundsConds.join(' AND ')}
    GROUP BY 1, 2
  `, refundsParams);

  // ─── AGRÉGATION ──────────────────────────────────────────────────────────
  // Une « opération » = un couple (zone, taux). taux null = aucune TVA facturée.
  const ops = new Map();
  const key = (zone, taux) => `${zone}|${taux === null ? '' : taux}`;
  const getOp = (zone, taux) => {
    const k = key(zone, taux);
    if (!ops.has(k)) ops.set(k, { zone, taux, cmd: 0, ht: 0, tva: 0, ht_avoirs: 0, tva_avoirs: 0 });
    return ops.get(k);
  };

  const parseTaux = (v) => (v === null || v === undefined ? null : parseFloat(String(v).replace(',', '.')));

  let monacoHT = 0, monacoTVA = 0;
  let mixtes = 0;
  let tauxCalcule = 0;      // TVA dont le taux a dû être recalculé faute de ligne de taxe
  let tauxIndetermine = 0;  // TVA collectée sans taux identifiable

  for (const row of ventesResult.rows) {
    const ttc  = parseFloat(row.ttc) || 0;
    const tva  = parseFloat(row.tva) || 0;
    const taux = parseTaux(row.taux);
    if (row.nb_taux > 1) mixtes += row.cmd;
    if (tva !== 0 && row.taux_source === 'calcule') tauxCalcule += tva;
    if (tva !== 0 && taux === null) tauxIndetermine += tva;
    const op = getOp(row.zone, taux);
    op.cmd += row.cmd;
    op.ht  += ttc - tva;
    op.tva += tva;
    if (row.monaco) { monacoHT += ttc - tva; monacoTVA += tva; }
  }

  for (const row of avoirsResult.rows) {
    const ttc  = parseFloat(row.ttc) || 0;
    const tva  = parseFloat(row.tva) || 0;
    const taux = parseTaux(row.taux);
    // Un avoir sur une commande dont on ne retrouve pas le taux et qui ne porte
    // pas de TVA est rattaché à l'opération non taxée de sa zone.
    const op = getOp(row.zone, taux);
    op.ht_avoirs  += ttc - tva;
    op.tva_avoirs += tva;
  }

  // ─── CADRE A — montant des opérations réalisées ──────────────────────────
  // Chaque opération est rangée sur une ligne CA3 selon sa zone et le fait
  // qu'elle porte ou non de la TVA française.
  const cadreA = {
    '01': { code: '01', libelle: 'Ventes, prestations de services', base: 0, detail: [] },
    '04': { code: '04', libelle: 'Exportations hors UE', base: 0, detail: [] },
    '05': { code: '05', libelle: 'Autres opérations non imposables', base: 0, detail: [] },
    '06': { code: '06', libelle: 'Livraisons intracommunautaires', base: 0, detail: [] },
  };

  const controles = [];
  const territorialite = [];

  for (const op of ops.values()) {
    const htNet  = op.ht - op.ht_avoirs;
    const tvaNet = op.tva - op.tva_avoirs;
    // Le seul critère est la TVA effectivement collectée : une commande taxée
    // dont on n'a pas su nommer le taux reste une opération imposable.
    // Les avoirs comptent aussi : un avoir sur une vente taxée d'un mois antérieur
    // peut arriver sur une période sans vente de même zone et de même taux.
    const taxee  = op.tva !== 0 || op.tva_avoirs !== 0;

    let ligne;
    if (taxee) {
      // Toute opération soumise à la TVA française va en ligne 01, quelle que
      // soit la destination : c'est la TVA effectivement collectée qui est due.
      ligne = '01';
    } else if (op.zone === 'HORS_UE' || op.zone === 'DOM' || op.zone === 'TOM') {
      ligne = '04';
    } else {
      // UE sans TVA : ce serait une livraison intracommunautaire (ligne 06),
      // mais elle exige le n° de TVA de l'acquéreur, qui n'est pas collecté.
      // France sans TVA : anomalie. Les deux atterrissent en ligne 05, signalées.
      ligne = '05';
    }

    cadreA[ligne].base += htNet;
    cadreA[ligne].detail.push({
      zone: op.zone, zone_libelle: CA3_ZONE_LABELS[op.zone],
      taux: op.taux, cmd: op.cmd,
      ht: round2(htNet), tva: round2(tvaNet),
    });

    territorialite.push({
      zone: op.zone, zone_libelle: CA3_ZONE_LABELS[op.zone],
      taux: op.taux, ligne_ca3: ligne, cmd: op.cmd,
      ht_brut: round2(op.ht), tva_brute: round2(op.tva),
      ht_avoirs: round2(op.ht_avoirs), tva_avoirs: round2(op.tva_avoirs),
      ht_net: round2(htNet), tva_net: round2(tvaNet),
    });
  }

  // ─── CADRE B — TVA brute, par taux ───────────────────────────────────────
  const parTaux = new Map();
  for (const op of ops.values()) {
    // Écarter une opération sans TVA de vente ferait disparaître la TVA d'un avoir
    // isolé (avoir du mois portant sur une vente d'un mois précédent).
    if (op.tva === 0 && op.tva_avoirs === 0) continue;
    if (!parTaux.has(op.taux)) parTaux.set(op.taux, { base: 0, tva: 0 });
    const b = parTaux.get(op.taux);
    b.base += op.ht - op.ht_avoirs;
    b.tva  += op.tva - op.tva_avoirs;
  }

  // Total calculé sur les valeurs exactes, avant arrondi des lignes : un total
  // reconstitué à partir de lignes arrondies dérive d'un centime.
  const tvaBrute = [...parTaux.values()].reduce((s, v) => s + v.tva, 0);

  const cadreB = [...parTaux.entries()]
    .sort((a, b) => (b[0] === null ? -1 : b[0]) - (a[0] === null ? -1 : a[0]))
    .map(([taux, v]) => ({ ...ca3RateLine(taux), taux, base: round2(v.base), tva: round2(v.tva) }));

  // ─── CONTRÔLES ───────────────────────────────────────────────────────────
  const zoneAgg = (zone, taxee) => [...ops.values()]
    .filter((o) => o.zone === zone && ((o.tva !== 0 || o.tva_avoirs !== 0) === taxee))
    .reduce((s, o) => s + (o.ht - o.ht_avoirs), 0);

  // Les contrôles ci-dessous portent sur la FIABILITÉ DES MONTANTS. Le traitement
  // fiscal des ventes hors de France (guichet unique, taux de destination) est un
  // arbitrage qui n'appartient pas à cet outil : la CA3 restitue la TVA française
  // réellement collectée, telle qu'encaissée.

  const ueExoneree = zoneAgg('UE', false);
  if (ueExoneree > 0) {
    controles.push({
      niveau: 'alerte',
      titre: 'Ligne 06 — livraisons intracommunautaires non déterminables',
      montant: round2(ueExoneree),
      message: "Le numéro de TVA intracommunautaire de l'acquéreur n'est enregistré sur aucune "
        + "commande (colonne billing_tax vide à 100 %). Impossible de distinguer une livraison "
        + "intracommunautaire exonérée (ligne 06) d'une vente à distance. Le montant ci-dessus "
        + "est donc rangé en ligne 05 par défaut.",
    });
  }

  const frNonTaxee = zoneAgg('FR', false);
  if (frNonTaxee > 0) {
    controles.push({
      niveau: 'alerte',
      titre: 'Ventes France sans TVA',
      montant: round2(frNonTaxee),
      message: 'Livraisons en France métropolitaine ou à Monaco sans TVA collectée. '
        + 'À vérifier commande par commande : soit une exonération justifiée, soit un défaut de taxation.',
    });
  }

  const domTomTaxee = zoneAgg('DOM', true) + zoneAgg('TOM', true);
  if (domTomTaxee > 0) {
    controles.push({
      niveau: 'alerte',
      titre: "TVA facturée sur une livraison outre-mer",
      montant: round2(domTomTaxee),
      message: "Les livraisons vers les DOM et les COM sont exonérées de TVA métropolitaine "
        + "(art. 294 CGI). De la TVA a pourtant été collectée sur ces commandes.",
    });
  }

  const domTomExo = zoneAgg('DOM', false) + zoneAgg('TOM', false);
  if (domTomExo > 0) {
    controles.push({
      niveau: 'info',
      titre: 'Outre-mer rangé en ligne 04',
      montant: round2(domTomExo),
      message: "Les livraisons vers les DOM et COM sont assimilées à des exportations et "
        + "portées en ligne 04. Certains cabinets les déclarent en ligne 05 : à confirmer avec le comptable.",
    });
  }

  if (monacoHT > 0) {
    controles.push({
      niveau: 'info',
      titre: 'Opérations à destination de Monaco',
      montant: round2(monacoHT),
      message: `Monaco est un territoire français pour la TVA : ces ventes sont taxables (ligne 01). `
        + `La CA3 demande de les isoler en ligne 18 — TVA correspondante : ${round2(monacoTVA)} €.`,
    });
  }

  if (tauxIndetermine !== 0) {
    controles.push({
      niveau: 'alerte',
      titre: 'TVA collectée sans taux identifiable',
      montant: null,
      message: `${round2(tauxIndetermine)} € de TVA n'ont pas pu être rattachés à un taux légal : `
        + `le rapport TVA / HT de ces commandes ne tombe sur aucun taux français, signe de lignes `
        + `de commande incomplètes en base (surtout entre août 2025 et janvier 2026). Le montant `
        + `est porté en ligne 14 pour que la TVA brute reste égale à la TVA encaissée, mais sa `
        + `ventilation par taux est à reprendre à la main.`,
    });
  }

  if (tauxCalcule > 0) {
    controles.push({
      niveau: 'info',
      titre: 'Taux reconstitué depuis les montants',
      montant: null,
      message: `${round2(tauxCalcule)} € de TVA proviennent de commandes sans ligne de taxe `
        + `synchronisée : leur taux a été recalculé (TVA / HT) puis aligné sur le taux légal le `
        + `plus proche. Le montant de TVA, lui, est celui réellement collecté et n'est pas estimé.`,
    });
  }

  if (mixtes > 0) {
    controles.push({
      niveau: 'alerte',
      titre: 'Commandes à plusieurs taux de TVA',
      montant: null,
      message: `${mixtes} commande(s) portent plusieurs taux. Elles sont rattachées au premier taux `
        + `rencontré, ce qui fausse la ventilation du cadre B. À traiter manuellement.`,
    });
  }

  controles.push({
    niveau: 'info',
    titre: 'TVA déductible non couverte',
    montant: null,
    message: "Ce document ne porte que la TVA collectée (cadre A et lignes 08 à 16). La TVA "
      + "déductible sur achats et immobilisations (lignes 19 à 23) provient des factures "
      + "fournisseurs et reste à la charge du comptable.",
  });

  // Rapprochement ventes → avoirs → bases déclarées. La CA3 n'a pas de ligne
  // « remboursements » (le formulaire demande le net), mais sans ces totaux le
  // document n'est pas vérifiable : impossible de le rapprocher de l'onglet
  // comptable, qui lui affiche la cascade.
  const brut = [...ops.values()].reduce(
    (t, o) => ({ ht: t.ht + o.ht, tva: t.tva + o.tva }), { ht: 0, tva: 0 }
  );
  const avoirs = [...ops.values()].reduce(
    (t, o) => ({ ht: t.ht + o.ht_avoirs, tva: t.tva + o.tva_avoirs }), { ht: 0, tva: 0 }
  );

  const totalOperations = Object.values(cadreA).reduce((s, l) => s + l.base, 0);
  for (const l of Object.values(cadreA)) l.base = round2(l.base);
  territorialite.sort((a, b) => b.ht_net - a.ht_net);

  return {
    cadreA: ['01', '04', '05', '06'].map((c) => cadreA[c]),
    cadreB,
    tva_brute: round2(tvaBrute),
    total_operations: round2(totalOperations),
    brut:   { ht: round2(brut.ht),   tva: round2(brut.tva) },
    avoirs: { ht: round2(avoirs.ht), tva: round2(avoirs.tva) },
    territorialite,
    controles,
    monaco: { ht: round2(monacoHT), tva: round2(monacoTVA) },
  };
}

exports.computeCA3 = computeCA3;

/**
 * POST /api/financier/comptable
 * Données de la déclaration comptable (CA TTC/HT/TVA brut & net, par pays).
 */
exports.getComptable = async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.body;
    // La CA3 est calculée dans le même appel : l'onglet comptable en a toujours
    // besoin, et cela garantit que les deux vues portent sur la même période.
    const [result, ca3] = await Promise.all([
      computeComptable({ dateFrom, dateTo }),
      computeCA3({ dateFrom, dateTo }),
    ]);
    res.json({ success: true, ...result, ca3, dateFrom, dateTo });
  } catch (error) {
    console.error('Error in financier comptable:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/financier/dashboard
 * Source de vérité unique pour tous les onglets.
 */
exports.getDashboard = async (req, res) => {
  try {
    const { dateFrom, dateTo, granularity } = req.body;
    const [result, byCountry] = await Promise.all([
      computeDashboard({ dateFrom, dateTo, granularity }),
      computeByCountry({ dateFrom, dateTo }),
    ]);
    res.json({ success: true, ...result, byCountry });
  } catch (error) {
    console.error('Error in financier dashboard:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

function round2(n) {
  return Math.round((n || 0) * 100) / 100;
}
