const pool = require('../config/database');

/**
 * Récupérer les paramètres généraux de livraison
 */
const getSettings = async (req, res) => {
  try {
    const result = await pool.query('SELECT config_key, config_value FROM shipping_settings');

    const settings = {};
    result.rows.forEach(row => {
      settings[row.config_key] = row.config_value;
    });

    res.json({ success: true, settings });
  } catch (error) {
    console.error('Error getting shipping settings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Mettre à jour les paramètres généraux
 */
const updateSettings = async (req, res) => {
  try {
    const { packaging_weight } = req.body;

    if (packaging_weight !== undefined) {
      await pool.query(`
        INSERT INTO shipping_settings (config_key, config_value, updated_at)
        VALUES ('packaging_weight', $1, NOW())
        ON CONFLICT (config_key)
        DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()
      `, [packaging_weight.toString()]);
    }

    res.json({ success: true, message: 'Settings updated' });
  } catch (error) {
    console.error('Error updating shipping settings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupérer tous les transporteurs avec leurs méthodes
 */
const getCarriers = async (req, res) => {
  try {
    const carriersResult = await pool.query(`
      SELECT id, code, name, fuel_surcharge, active
      FROM shipping_carriers
      ORDER BY name
    `);

    // Pour chaque transporteur, récupérer ses méthodes
    const carriers = [];
    for (const carrier of carriersResult.rows) {
      const methodsResult = await pool.query(`
        SELECT id, code, name, wc_method_title, active
        FROM shipping_methods
        WHERE carrier_id = $1
        ORDER BY name
      `, [carrier.id]);

      carriers.push({
        ...carrier,
        fuel_surcharge: parseFloat(carrier.fuel_surcharge),
        methods: methodsResult.rows
      });
    }

    res.json({ success: true, carriers });
  } catch (error) {
    console.error('Error getting carriers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Mettre à jour un transporteur (surcharge carburant)
 */
const updateCarrier = async (req, res) => {
  try {
    const { id } = req.params;
    const { fuel_surcharge, active } = req.body;

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (fuel_surcharge !== undefined) {
      updates.push(`fuel_surcharge = $${paramIndex++}`);
      values.push(fuel_surcharge);
    }
    if (active !== undefined) {
      updates.push(`active = $${paramIndex++}`);
      values.push(active);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    await pool.query(`
      UPDATE shipping_carriers
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
    `, values);

    res.json({ success: true, message: 'Carrier updated' });
  } catch (error) {
    console.error('Error updating carrier:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupérer les méthodes d'un transporteur
 */
const getMethods = async (req, res) => {
  try {
    const { carrierId } = req.params;

    const result = await pool.query(`
      SELECT id, code, name, wc_method_title, active
      FROM shipping_methods
      WHERE carrier_id = $1
      ORDER BY name
    `, [carrierId]);

    res.json({ success: true, methods: result.rows });
  } catch (error) {
    console.error('Error getting methods:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Créer une méthode de livraison
 */
const createMethod = async (req, res) => {
  try {
    const { carrierId } = req.params;
    const { code, name, wc_method_title } = req.body;

    const result = await pool.query(`
      INSERT INTO shipping_methods (carrier_id, code, name, wc_method_title)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `, [carrierId, code, name, wc_method_title]);

    res.json({ success: true, id: result.rows[0].id });
  } catch (error) {
    console.error('Error creating method:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Mettre à jour une méthode
 */
const updateMethod = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, wc_method_title, active } = req.body;

    await pool.query(`
      UPDATE shipping_methods
      SET name = COALESCE($1, name),
          wc_method_title = COALESCE($2, wc_method_title),
          active = COALESCE($3, active),
          updated_at = NOW()
      WHERE id = $4
    `, [name, wc_method_title, active, id]);

    res.json({ success: true, message: 'Method updated' });
  } catch (error) {
    console.error('Error updating method:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Supprimer une méthode
 */
const deleteMethod = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM shipping_methods WHERE id = $1', [id]);
    res.json({ success: true, message: 'Method deleted' });
  } catch (error) {
    console.error('Error deleting method:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupérer les tranches de prix d'une méthode
 */
const getRates = async (req, res) => {
  try {
    const { methodId } = req.params;

    const result = await pool.query(`
      SELECT id, weight_from, weight_to, price_ht
      FROM shipping_rates
      WHERE method_id = $1
      ORDER BY weight_from
    `, [methodId]);

    res.json({
      success: true,
      rates: result.rows.map(r => ({
        ...r,
        weight_from: parseFloat(r.weight_from),
        weight_to: parseFloat(r.weight_to),
        price_ht: parseFloat(r.price_ht)
      }))
    });
  } catch (error) {
    console.error('Error getting rates:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Créer une tranche de prix
 */
const createRate = async (req, res) => {
  try {
    const { methodId } = req.params;
    const { weight_from, weight_to, price_ht } = req.body;

    const result = await pool.query(`
      INSERT INTO shipping_rates (method_id, weight_from, weight_to, price_ht)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `, [methodId, weight_from, weight_to, price_ht]);

    res.json({ success: true, id: result.rows[0].id });
  } catch (error) {
    console.error('Error creating rate:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Mettre à jour une tranche
 */
const updateRate = async (req, res) => {
  try {
    const { id } = req.params;
    const { weight_from, weight_to, price_ht } = req.body;

    await pool.query(`
      UPDATE shipping_rates
      SET weight_from = COALESCE($1, weight_from),
          weight_to = COALESCE($2, weight_to),
          price_ht = COALESCE($3, price_ht),
          updated_at = NOW()
      WHERE id = $4
    `, [weight_from, weight_to, price_ht, id]);

    res.json({ success: true, message: 'Rate updated' });
  } catch (error) {
    console.error('Error updating rate:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Supprimer une tranche
 */
const deleteRate = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM shipping_rates WHERE id = $1', [id]);
    res.json({ success: true, message: 'Rate deleted' });
  } catch (error) {
    console.error('Error deleting rate:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Mapping shipping_method WooCommerce -> { carrier, method }
// null = pas de frais de port à calculer (retrait magasin, méthode inconnue bénigne)
const METHOD_MAPPING = [
  // Chronopost
  { pattern: /chronopost.*relais/i,             carrier: 'chronopost',    method: 'relais' },
  { pattern: /chronopost.*domicile/i,           carrier: 'chronopost',    method: 'domicile' },
  { pattern: /chronopost.*express/i,            carrier: 'chronopost',    method: 'domicile' },
  { pattern: /2shop/i,                          carrier: 'chronopost',    method: '2shop' },
  // Colissimo
  { pattern: /colissimo.*relais/i,              carrier: 'colissimo',     method: 'point_relais' },
  { pattern: /colissimo.*signature/i,           carrier: 'colissimo',     method: 'domicile_avec_signature' },
  { pattern: /colissimo/i,                      carrier: 'colissimo',     method: 'domicile_sans_signature' },
  // Bpost → traité comme Colissimo (même réseau La Poste)
  { pattern: /bpost.*relais/i,                  carrier: 'colissimo',     method: 'point_relais' },
  { pattern: /bpost/i,                          carrier: 'colissimo',     method: 'domicile_sans_signature' },
  // Swiss Post → Colissimo international
  { pattern: /swiss post/i,                     carrier: 'colissimo',     method: 'domicile_sans_signature' },
  // Deutsche Post → Colissimo international
  { pattern: /deutsche post.*signature/i,       carrier: 'colissimo',     method: 'domicile_avec_signature' },
  { pattern: /deutsche post/i,                  carrier: 'colissimo',     method: 'domicile_sans_signature' },
  // SDA Poste Italiane → Colissimo international
  { pattern: /sda.*signature/i,                 carrier: 'colissimo',     method: 'domicile_avec_signature' },
  { pattern: /sda/i,                            carrier: 'colissimo',     method: 'domicile_sans_signature' },
  // La Poste
  { pattern: /lettre suivie/i,                  carrier: 'laposte',       method: 'lettre_suivie' },
  // Mondial Relay
  { pattern: /mondial relay/i,                  carrier: 'mondial_relay', method: 'point_relais' },
  // Retrait magasin → pas de frais transport
  { pattern: /retrait magasin/i,                carrier: null,            method: null },
  // "Shipping" générique → pas de frais transport
  { pattern: /^shipping$/i,                     carrier: null,            method: null },
];

function resolveCarrierMethod(shippingMethod) {
  if (!shippingMethod) return null;
  for (const m of METHOD_MAPPING) {
    if (m.pattern.test(shippingMethod)) {
      if (m.carrier === null) return { carrier: null, method: null, skip: true };
      return { carrier: m.carrier, method: m.method };
    }
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Paramètres de surcharge lus SUR LA FACTURE de la période
 *
 * Le taux de carburant change tous les mois (16,9 % à 23,2 % chez Chronopost,
 * 11,0 % à 14,3 % de CAE chez Colissimo) : une valeur moyenne figée sur la zone
 * serait fausse onze mois sur douze. On lit donc les paramètres réels dans la
 * facture qui couvre la date de la commande, et on ne retombe sur les valeurs
 * de zone que si aucune facture ne couvre encore la période — typiquement le
 * mois en cours, pas encore facturé.
 *
 * Chronopost émet deux factures par mois, sur deux comptes aux structures
 * différentes : le compte France (domicile + relais) porte une redevance sûreté,
 * le compte 2Shop / international n'en a pas. C'est ce qui les distingue.
 *
 * Colissimo n'a pas de charges globales : son CAE est réparti dans le prix de
 * chaque colis, et le récapitulatif de facture en donne le montant — d'où le
 * taux déduit de cae / port_net.
 * ───────────────────────────────────────────────────────────────────────────── */
function periodKey(dateValue) {
  if (!dateValue) return null;
  const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (isNaN(d)) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function getPeriodParams(pool, carrier, method, period, cache) {
  if (!period) return null;
  const key = `${carrier}|${method}|${period}`;
  if (cache.has(key)) return cache.get(key);

  let params = null;

  if (carrier === 'chronopost') {
    // Le compte 2Shop n'a pas de redevance sûreté : c'est le discriminant.
    const wantsSurete = method !== '2shop';
    const { rows } = await pool.query(`
      SELECT
        MAX(CASE WHEN e->>'description' ~* 'carburant'
            THEN NULLIF(substring(e->>'detail' from '([0-9.]+)\\s*%'), '')::numeric END) AS fuel,
        MAX(CASE WHEN e->>'description' ~* 'redevance'
            THEN (e->>'amount_ht')::numeric
                 / NULLIF(NULLIF(substring(e->>'detail' from '([0-9]+)\\s*colis'), '')::int, 0) END) AS surete,
        MAX(CASE WHEN e->>'description' ~* 'eco'
            THEN (e->>'amount_ht')::numeric
                 / NULLIF(NULLIF(substring(e->>'detail' from '([0-9]+)\\s*colis'), '')::int, 0) END) AS eco,
        MAX(CASE WHEN e->>'description' ~* 'frais de gestion'
            THEN (e->>'amount_ht')::numeric / NULLIF(ci.total_parcels, 0) END) AS gestion,
        bool_or(e->>'description' ~* 'redevance') AS has_surete
      FROM carrier_invoices ci, LATERAL jsonb_array_elements(ci.global_charges) e
      WHERE ci.carrier = 'chronopost'
        AND jsonb_typeof(ci.global_charges) = 'array'
        AND to_char(to_date(NULLIF(ci.invoice_date, ''), 'DD/MM/YYYY'), 'YYYY-MM') = $1
      GROUP BY ci.id
      HAVING bool_or(e->>'description' ~* 'redevance') = $2
      ORDER BY MAX(ci.total_parcels) DESC
      LIMIT 1
    `, [period, wantsSurete]);
    if (rows.length) {
      params = {
        fuel: parseFloat(rows[0].fuel) || 0,
        feeInFuelBase: parseFloat(rows[0].surete) || 0,
        feeAfterFuel: (parseFloat(rows[0].eco) || 0) + (parseFloat(rows[0].gestion) || 0),
        source: 'facture',
      };
    }
  } else if (carrier === 'colissimo') {
    const { rows } = await pool.query(`
      SELECT 100.0 * cae / NULLIF(port_net, 0) AS fuel
      FROM carrier_invoices
      WHERE carrier = 'colissimo' AND port_net > 0 AND cae IS NOT NULL
        AND to_char(to_date(NULLIF(period_start, ''), 'DD/MM/YYYY'), 'YYYY-MM') = $1
      ORDER BY total_parcels DESC
      LIMIT 1
    `, [period]);
    if (rows.length && rows[0].fuel != null) {
      // Le CAE remplace le taux de zone ; les forfaits fixes restent ceux de la zone.
      params = { fuel: parseFloat(rows[0].fuel), source: 'facture' };
    }
  }

  cache.set(key, params);
  return params;
}

async function computeOrderCost(pool, order, packagingWeight, periodCache) {
  const weight = parseFloat(order.total_weight);
  const resolved = resolveCarrierMethod(order.shipping_method);

  if (!resolved) {
    return { error: 'Méthode non reconnue' };
  }

  if (resolved.skip) {
    return { skip: true };
  }

  const { carrier, method } = resolved;

  // Trouver la zone du pays pour ce carrier
  const countryCode = order.shipping_country || 'FR';
  const zoneResult = await pool.query(`
    SELECT zone_name FROM shipping_country_mapping
    WHERE carrier = $1
      AND (method = $3 OR method IS NULL)
      AND (country_code = $2 OR (is_postal_prefix = true AND $2 LIKE country_code || '%'))
    ORDER BY
      CASE WHEN method = $3 THEN 0 ELSE 1 END,
      is_postal_prefix DESC
    LIMIT 1
  `, [carrier, countryCode, method]);

  if (zoneResult.rows.length === 0) {
    return { error: `Zone non trouvée pour ${countryCode} (${carrier})` };
  }

  const zoneName = zoneResult.rows[0].zone_name;

  // Trouver le tarif dans shipping_tariff_zones/rates
  const rateResult = await pool.query(`
    SELECT str.price_ht, stz.fuel_surcharge, COALESCE(stz.discount_percent, 0) AS discount_percent,
           COALESCE(stz.fee_in_fuel_base, 0) AS fee_in_fuel_base,
           COALESCE(stz.fee_after_fuel, 0)   AS fee_after_fuel
    FROM shipping_tariff_zones stz
    JOIN shipping_tariff_rates str ON str.zone_id = stz.id
    WHERE stz.carrier = $1 AND stz.method = $2 AND stz.zone_name = $3
      AND str.weight_from <= $4 AND str.weight_to >= $4
    ORDER BY str.weight_from DESC
    LIMIT 1
  `, [carrier, method, zoneName, weight]);

  if (rateResult.rows.length === 0) {
    return { error: `Tarif non trouvé (${carrier}/${method}/${zoneName} ${weight}g)` };
  }

  const basePrice = parseFloat(rateResult.rows[0].price_ht);
  const discount = parseFloat(rateResult.rows[0].discount_percent) || 0;
  let fuelSurcharge = parseFloat(rateResult.rows[0].fuel_surcharge) || 0;
  let feeInFuelBase = parseFloat(rateResult.rows[0].fee_in_fuel_base) || 0;
  let feeAfterFuel = parseFloat(rateResult.rows[0].fee_after_fuel) || 0;
  let paramsSource = 'zone';

  // Les surcharges de la facture du mois priment sur les valeurs de zone.
  const period = periodKey(order.order_date);
  const invoiceParams = periodCache
    ? await getPeriodParams(pool, carrier, method, period, periodCache)
    : null;
  if (invoiceParams) {
    paramsSource = invoiceParams.source;
    if (invoiceParams.fuel != null) fuelSurcharge = invoiceParams.fuel;
    if (invoiceParams.feeInFuelBase != null) feeInFuelBase = invoiceParams.feeInFuelBase;
    // Les forfaits périodiques amortis (collecte Mondial Relay, abonnement La
    // Poste) restent portés par la zone : ils s'ajoutent à ceux de la facture.
    if (invoiceParams.feeAfterFuel != null) feeAfterFuel += invoiceParams.feeAfterFuel;
  }

  // Le port remisé et les frais soumis au carburant (redevance sûreté Chronopost)
  // forment la base ; l'éco-participation, les frais de gestion et les forfaits
  // périodiques amortis s'ajoutent après. Voir add_shipping_zone_fixed_fees.sql.
  const netPrice = basePrice * (1 - discount / 100);
  const calculatedCost = Math.round(
    ((netPrice + feeInFuelBase) * (1 + fuelSurcharge / 100) + feeAfterFuel) * 100
  ) / 100;

  return {
    carrier, method, zone: zoneName,
    base_price: basePrice, discount_percent: discount, fuel_surcharge: fuelSurcharge,
    fee_in_fuel_base: feeInFuelBase, fee_after_fuel: feeAfterFuel,
    params_source: paramsSource,
    calculated_cost: calculatedCost,
  };
}

/**
 * Calculer les frais de port pour une plage de dates (prévisualisation)
 */
const calculateShippingCosts = async (req, res) => {
  try {
    const { date_from, date_to } = req.body;

    const settingsResult = await pool.query(
      "SELECT config_value FROM shipping_settings WHERE config_key = 'packaging_weight'"
    );
    const packagingWeight = settingsResult.rows[0] ? parseFloat(settingsResult.rows[0].config_value) : 0;

    const ordersResult = await pool.query(`
      SELECT
        o.wp_order_id,
        o.shipping_method,
        o.shipping_country,
        COALESCE(o.paid_date, o.post_date) AS order_date,
        o.shipping_cost_calculated,
        COALESCE((SUM(oi.qty * COALESCE(p.weight, parent.weight, 0)) FILTER (WHERE p.product_type IS DISTINCT FROM 'woosb') + CASE WHEN bool_or(oi.line_total = 0 AND COALESCE(p.weight, parent.weight, 0) > 0 AND p.product_type IS DISTINCT FROM 'woosb') THEN 0 ELSE COALESCE(SUM(oi.qty * COALESCE(p.weight, parent.weight, 0)) FILTER (WHERE p.product_type = 'woosb'), 0) END) * 1000, 0) + $3 as total_weight
      FROM orders o
      LEFT JOIN order_items oi ON o.wp_order_id = oi.wp_order_id
      LEFT JOIN products p ON p.wp_product_id = COALESCE(NULLIF(oi.variation_id::int, 0), oi.product_id::int)
      LEFT JOIN products parent ON p.wp_parent_id = parent.wp_product_id
      WHERE o.post_date >= $1 AND o.post_date < $2
        AND o.post_status IN ('wc-completed', 'wc-processing', 'wc-shipped', 'wc-delivered', 'wc-being-delivered', 'wc-awaiting-delivery')
        AND o.shipping_method <> ''
      GROUP BY o.wp_order_id, o.shipping_method, o.shipping_country, o.paid_date, o.post_date, o.shipping_cost_calculated
    `, [date_from, date_to, packagingWeight]);

    const periodCache = new Map();
    const results = [];
    let totalCalculated = 0;
    let ordersMatched = 0;
    let ordersUnmatched = 0;

    for (const order of ordersResult.rows) {
      const computed = await computeOrderCost(pool, order, packagingWeight, periodCache);

      if (computed.skip) {
        // Retrait magasin ou méthode sans frais → coût = 0, pas une erreur
        ordersMatched++;
        results.push({
          wp_order_id: order.wp_order_id,
          shipping_method: order.shipping_method,
          shipping_country: order.shipping_country,
          weight: parseFloat(order.total_weight),
          carrier: 'N/A',
          zone: 'N/A',
          base_price: 0,
          fuel_surcharge: 0,
          calculated_cost: 0,
          current_cost: order.shipping_cost_calculated ? parseFloat(order.shipping_cost_calculated) : null
        });
      } else if (computed.error) {
        ordersUnmatched++;
        results.push({
          wp_order_id: order.wp_order_id,
          shipping_method: order.shipping_method,
          shipping_country: order.shipping_country,
          weight: parseFloat(order.total_weight),
          calculated_cost: null,
          error: computed.error
        });
      } else {
        ordersMatched++;
        totalCalculated += computed.calculated_cost;
        results.push({
          wp_order_id: order.wp_order_id,
          shipping_method: order.shipping_method,
          shipping_country: order.shipping_country,
          weight: parseFloat(order.total_weight),
          carrier: computed.carrier,
          zone: computed.zone,
          base_price: computed.base_price,
          fuel_surcharge: computed.fuel_surcharge,
          fee_in_fuel_base: computed.fee_in_fuel_base,
          fee_after_fuel: computed.fee_after_fuel,
          params_source: computed.params_source,
          calculated_cost: computed.calculated_cost,
          current_cost: order.shipping_cost_calculated ? parseFloat(order.shipping_cost_calculated) : null
        });
      }
    }

    res.json({
      success: true,
      summary: {
        total_orders: ordersResult.rows.length,
        orders_matched: ordersMatched,
        orders_unmatched: ordersUnmatched,
        total_calculated: Math.round(totalCalculated * 100) / 100
      },
      orders: results
    });
  } catch (error) {
    console.error('Error calculating shipping costs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Appliquer les frais de port calculés aux commandes
 */
const applyShippingCosts = async (req, res) => {
  try {
    const { date_from, date_to } = req.body;

    const settingsResult = await pool.query(
      "SELECT config_value FROM shipping_settings WHERE config_key = 'packaging_weight'"
    );
    const packagingWeight = settingsResult.rows[0] ? parseFloat(settingsResult.rows[0].config_value) : 0;

    const ordersResult = await pool.query(`
      SELECT
        o.wp_order_id,
        o.shipping_method,
        o.shipping_country,
        COALESCE(o.paid_date, o.post_date) AS order_date,
        COALESCE((SUM(oi.qty * COALESCE(p.weight, parent.weight, 0)) FILTER (WHERE p.product_type IS DISTINCT FROM 'woosb') + CASE WHEN bool_or(oi.line_total = 0 AND COALESCE(p.weight, parent.weight, 0) > 0 AND p.product_type IS DISTINCT FROM 'woosb') THEN 0 ELSE COALESCE(SUM(oi.qty * COALESCE(p.weight, parent.weight, 0)) FILTER (WHERE p.product_type = 'woosb'), 0) END) * 1000, 0) + $3 as total_weight
      FROM orders o
      LEFT JOIN order_items oi ON o.wp_order_id = oi.wp_order_id
      LEFT JOIN products p ON p.wp_product_id = COALESCE(NULLIF(oi.variation_id::int, 0), oi.product_id::int)
      LEFT JOIN products parent ON p.wp_parent_id = parent.wp_product_id
      WHERE o.post_date >= $1 AND o.post_date < $2
        AND o.post_status IN ('wc-completed', 'wc-processing', 'wc-shipped', 'wc-delivered', 'wc-being-delivered', 'wc-awaiting-delivery')
        AND o.shipping_method <> ''
      GROUP BY o.wp_order_id, o.shipping_method, o.shipping_country, o.paid_date, o.post_date
    `, [date_from, date_to, packagingWeight]);

    const periodCache = new Map();
    let updated = 0;
    let skipped = 0;

    for (const order of ordersResult.rows) {
      const computed = await computeOrderCost(pool, order, packagingWeight, periodCache);

      if (computed.error) {
        skipped++;
        continue;
      }

      // skip = retrait magasin ou méthode sans frais → coût = 0
      const cost = computed.skip ? 0 : computed.calculated_cost;

      await pool.query(`
        UPDATE orders
        SET shipping_cost_calculated = $1, updated_at = NOW()
        WHERE wp_order_id = $2
      `, [cost, order.wp_order_id]);

      updated++;
    }

    res.json({
      success: true,
      message: `${updated} commandes mises à jour, ${skipped} ignorées`,
      updated,
      skipped
    });
  } catch (error) {
    console.error('Error applying shipping costs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupérer toutes les zones de livraison avec leurs méthodes
 */
const getZones = async (req, res) => {
  try {
    const zonesResult = await pool.query(`
      SELECT id, wc_zone_id, name, zone_order, is_active
      FROM shipping_zones
      ORDER BY zone_order
    `);

    const zones = [];
    for (const zone of zonesResult.rows) {
      const methodsResult = await pool.query(`
        SELECT szm.id, szm.wc_instance_id, szm.wc_method_id, szm.title,
               szm.carrier_id, szm.method_order, szm.is_active,
               sc.name as carrier_name, sc.code as carrier_code
        FROM shipping_zone_methods szm
        LEFT JOIN shipping_carriers sc ON szm.carrier_id = sc.id
        WHERE szm.zone_id = $1
        ORDER BY szm.method_order
      `, [zone.id]);

      zones.push({
        ...zone,
        methods: methodsResult.rows
      });
    }

    res.json({ success: true, zones });
  } catch (error) {
    console.error('Error getting zones:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Mettre à jour une zone
 */
const updateZone = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, is_active } = req.body;

    await pool.query(`
      UPDATE shipping_zones
      SET name = COALESCE($1, name),
          is_active = COALESCE($2, is_active)
      WHERE id = $3
    `, [name, is_active, id]);

    res.json({ success: true, message: 'Zone updated' });
  } catch (error) {
    console.error('Error updating zone:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Mettre à jour une méthode de zone (mapping transporteur)
 */
const updateZoneMethod = async (req, res) => {
  try {
    const { id } = req.params;
    const { carrier_id, title, is_active } = req.body;

    await pool.query(`
      UPDATE shipping_zone_methods
      SET carrier_id = COALESCE($1, carrier_id),
          title = COALESCE($2, title),
          is_active = COALESCE($3, is_active)
      WHERE id = $4
    `, [carrier_id, title, is_active, id]);

    res.json({ success: true, message: 'Zone method updated' });
  } catch (error) {
    console.error('Error updating zone method:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupérer les méthodes groupées par transporteur avec leurs zones et tarifs
 * Structure: { carrier: { methods: [{ title, zones: [{ zone, rates: [] }] }] } }
 */
const getMethodsByCarrier = async (req, res) => {
  try {
    const { carrier } = req.params;

    // Mapping carrier code -> patterns de titres
    const carrierPatterns = {
      'laposte': ['Lettre Suivie%'],
      'colissimo': ['Colissimo%'],
      'chronopost': ['Chronopost%', '2Shop%'],
      'mondial_relay': ['Mondial Relay%'],
      'retrait': ['Retrait%']
    };

    const patterns = carrierPatterns[carrier];
    if (!patterns) {
      return res.status(400).json({ success: false, error: 'Transporteur inconnu' });
    }

    // Construire la clause WHERE avec les patterns
    const whereClauses = patterns.map((_, i) => `szm.title LIKE $${i + 1}`).join(' OR ');

    // Récupérer toutes les méthodes correspondant au transporteur
    const methodsResult = await pool.query(`
      SELECT DISTINCT szm.title
      FROM shipping_zone_methods szm
      WHERE ${whereClauses}
      ORDER BY szm.title
    `, patterns);

    const methods = [];

    for (const methodRow of methodsResult.rows) {
      const methodTitle = methodRow.title;

      // Récupérer les zones où cette méthode existe
      const zonesResult = await pool.query(`
        SELECT sz.id as zone_id, sz.name as zone_name, szm.id as method_id
        FROM shipping_zone_methods szm
        JOIN shipping_zones sz ON szm.zone_id = sz.id
        WHERE szm.title = $1
        ORDER BY sz.zone_order
      `, [methodTitle]);

      const zones = [];

      for (const zoneRow of zonesResult.rows) {
        // Récupérer les tarifs pour cette méthode + zone
        const ratesResult = await pool.query(`
          SELECT id, weight_from, weight_to, price_ht
          FROM shipping_method_zone_rates
          WHERE method_title = $1 AND zone_id = $2
          ORDER BY weight_from
        `, [methodTitle, zoneRow.zone_id]);

        zones.push({
          zone_id: zoneRow.zone_id,
          zone_name: zoneRow.zone_name,
          rates: ratesResult.rows.map(r => ({
            id: r.id,
            weight_from: parseFloat(r.weight_from),
            weight_to: parseFloat(r.weight_to),
            price_ht: parseFloat(r.price_ht)
          }))
        });
      }

      methods.push({
        title: methodTitle,
        zones
      });
    }

    res.json({ success: true, carrier, methods });
  } catch (error) {
    console.error('Error getting methods by carrier:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Ajouter une tranche de tarif pour une méthode/zone
 */
const createMethodZoneRate = async (req, res) => {
  try {
    const { method_title, zone_id, weight_from, weight_to, price_ht } = req.body;

    const result = await pool.query(`
      INSERT INTO shipping_method_zone_rates (method_title, zone_id, weight_from, weight_to, price_ht)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [method_title, zone_id, weight_from || 0, weight_to || 250, price_ht || 0]);

    res.json({ success: true, id: result.rows[0].id });
  } catch (error) {
    console.error('Error creating method zone rate:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Mettre à jour une tranche de tarif
 */
const updateMethodZoneRate = async (req, res) => {
  try {
    const { id } = req.params;
    const { weight_from, weight_to, price_ht } = req.body;

    await pool.query(`
      UPDATE shipping_method_zone_rates
      SET weight_from = COALESCE($1, weight_from),
          weight_to = COALESCE($2, weight_to),
          price_ht = COALESCE($3, price_ht),
          updated_at = NOW()
      WHERE id = $4
    `, [weight_from, weight_to, price_ht, id]);

    res.json({ success: true, message: 'Rate updated' });
  } catch (error) {
    console.error('Error updating method zone rate:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Supprimer une tranche de tarif
 */
const deleteMethodZoneRate = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM shipping_method_zone_rates WHERE id = $1', [id]);
    res.json({ success: true, message: 'Rate deleted' });
  } catch (error) {
    console.error('Error deleting method zone rate:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Calcule et applique les frais de port pour une commande spécifique.
 * Appelé automatiquement à l'import/mise à jour d'une commande via wcSyncService.
 */
const applyShippingCostToOrder = async (wpOrderId) => {
  try {
    const settingsResult = await pool.query(
      "SELECT config_value FROM shipping_settings WHERE config_key = 'packaging_weight'"
    );
    const packagingWeight = settingsResult.rows[0] ? parseFloat(settingsResult.rows[0].config_value) : 0;

    const orderResult = await pool.query(`
      SELECT
        o.wp_order_id,
        o.shipping_method,
        o.shipping_country,
        COALESCE(o.paid_date, o.post_date) AS order_date,
        o.shipping_cost_calculated,
        COALESCE((SUM(oi.qty * COALESCE(p.weight, parent.weight, 0)) FILTER (WHERE p.product_type IS DISTINCT FROM 'woosb') + CASE WHEN bool_or(oi.line_total = 0 AND COALESCE(p.weight, parent.weight, 0) > 0 AND p.product_type IS DISTINCT FROM 'woosb') THEN 0 ELSE COALESCE(SUM(oi.qty * COALESCE(p.weight, parent.weight, 0)) FILTER (WHERE p.product_type = 'woosb'), 0) END) * 1000, 0) + $2 AS total_weight
      FROM orders o
      LEFT JOIN order_items oi ON o.wp_order_id = oi.wp_order_id
      LEFT JOIN products p ON p.wp_product_id = COALESCE(NULLIF(oi.variation_id::int, 0), oi.product_id::int)
      LEFT JOIN products parent ON p.wp_parent_id = parent.wp_product_id
      WHERE o.wp_order_id = $1
      GROUP BY o.wp_order_id, o.shipping_method, o.shipping_country, o.paid_date, o.post_date, o.shipping_cost_calculated
    `, [wpOrderId, packagingWeight]);

    if (orderResult.rows.length === 0) return;
    const order = orderResult.rows[0];

    if (!order.shipping_method) return;

    const computed = await computeOrderCost(pool, order, packagingWeight, new Map());

    if (computed.skip) {
      await pool.query(
        'UPDATE orders SET shipping_cost_calculated = 0 WHERE wp_order_id = $1',
        [wpOrderId]
      );
    } else if (computed.calculated_cost !== undefined) {
      await pool.query(
        'UPDATE orders SET shipping_cost_calculated = $1 WHERE wp_order_id = $2',
        [computed.calculated_cost, wpOrderId]
      );
    }
    // Si erreur (zone/tarif non trouvé), on ne met pas à jour — shipping_cost_calculated reste NULL
  } catch (err) {
    console.error(`Erreur calcul frais port commande #${wpOrderId}:`, err.message);
  }
};

module.exports = {
  getSettings,
  updateSettings,
  getCarriers,
  updateCarrier,
  getMethods,
  createMethod,
  updateMethod,
  deleteMethod,
  getRates,
  createRate,
  updateRate,
  deleteRate,
  calculateShippingCosts,
  applyShippingCosts,
  applyShippingCostToOrder,
  getZones,
  updateZone,
  updateZoneMethod,
  getMethodsByCarrier,
  createMethodZoneRate,
  updateMethodZoneRate,
  deleteMethodZoneRate
};
