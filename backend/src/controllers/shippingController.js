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

/**
 * Calculer les frais de port pour une plage de dates (prévisualisation)
 */
const calculateShippingCosts = async (req, res) => {
  try {
    const { date_from, date_to } = req.body;

    // Récupérer le poids de l'emballage
    const settingsResult = await pool.query(
      "SELECT config_value FROM shipping_settings WHERE config_key = 'packaging_weight'"
    );
    const packagingWeight = settingsResult.rows[0] ? parseFloat(settingsResult.rows[0].config_value) : 0;

    // Récupérer les commandes avec leurs items et poids
    const ordersResult = await pool.query(`
      SELECT
        o.wp_order_id,
        o.shipping_method,
        o.shipping_cost_calculated,
        COALESCE(
          SUM(
            oi.qty * COALESCE(p.weight, parent.weight, 0)
          ), 0
        ) + $3 as total_weight
      FROM orders o
      LEFT JOIN order_items oi ON o.wp_order_id = oi.wp_order_id
      LEFT JOIN products p ON (oi.product_id = p.wp_product_id OR oi.variation_id = p.wp_product_id)
      LEFT JOIN products parent ON p.wp_parent_id = parent.wp_product_id
      WHERE o.post_date >= $1 AND o.post_date < $2
        AND o.post_status IN ('wc-completed', 'wc-processing', 'wc-shipped')
      GROUP BY o.wp_order_id, o.shipping_method, o.shipping_cost_calculated
    `, [date_from, date_to, packagingWeight]);

    // Pour chaque commande, trouver le tarif correspondant
    const results = [];
    let totalCalculated = 0;
    let ordersMatched = 0;
    let ordersUnmatched = 0;

    for (const order of ordersResult.rows) {
      // Trouver la méthode correspondante
      const methodResult = await pool.query(`
        SELECT sm.id as method_id, sc.fuel_surcharge
        FROM shipping_methods sm
        JOIN shipping_carriers sc ON sm.carrier_id = sc.id
        WHERE sm.wc_method_title = $1 AND sm.active = true AND sc.active = true
      `, [order.shipping_method]);

      if (methodResult.rows.length === 0) {
        ordersUnmatched++;
        results.push({
          wp_order_id: order.wp_order_id,
          shipping_method: order.shipping_method,
          weight: parseFloat(order.total_weight),
          calculated_cost: null,
          error: 'Méthode non trouvée'
        });
        continue;
      }

      const { method_id, fuel_surcharge } = methodResult.rows[0];

      // Trouver la tranche de poids
      const rateResult = await pool.query(`
        SELECT price_ht
        FROM shipping_rates
        WHERE method_id = $1 AND weight_from <= $2 AND weight_to >= $2
        ORDER BY weight_from DESC
        LIMIT 1
      `, [method_id, order.total_weight]);

      if (rateResult.rows.length === 0) {
        ordersUnmatched++;
        results.push({
          wp_order_id: order.wp_order_id,
          shipping_method: order.shipping_method,
          weight: parseFloat(order.total_weight),
          calculated_cost: null,
          error: 'Tranche de poids non trouvée'
        });
        continue;
      }

      const basePrice = parseFloat(rateResult.rows[0].price_ht);
      const calculatedCost = basePrice * parseFloat(fuel_surcharge);

      ordersMatched++;
      totalCalculated += calculatedCost;

      results.push({
        wp_order_id: order.wp_order_id,
        shipping_method: order.shipping_method,
        weight: parseFloat(order.total_weight),
        base_price: basePrice,
        fuel_surcharge: parseFloat(fuel_surcharge),
        calculated_cost: Math.round(calculatedCost * 100) / 100,
        current_cost: order.shipping_cost_calculated ? parseFloat(order.shipping_cost_calculated) : null
      });
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

    // Même logique que calculate mais avec UPDATE
    const settingsResult = await pool.query(
      "SELECT config_value FROM shipping_settings WHERE config_key = 'packaging_weight'"
    );
    const packagingWeight = settingsResult.rows[0] ? parseFloat(settingsResult.rows[0].config_value) : 0;

    const ordersResult = await pool.query(`
      SELECT
        o.wp_order_id,
        o.shipping_method,
        COALESCE(
          SUM(
            oi.qty * COALESCE(p.weight, parent.weight, 0)
          ), 0
        ) + $3 as total_weight
      FROM orders o
      LEFT JOIN order_items oi ON o.wp_order_id = oi.wp_order_id
      LEFT JOIN products p ON (oi.product_id = p.wp_product_id OR oi.variation_id = p.wp_product_id)
      LEFT JOIN products parent ON p.wp_parent_id = parent.wp_product_id
      WHERE o.post_date >= $1 AND o.post_date < $2
        AND o.post_status IN ('wc-completed', 'wc-processing', 'wc-shipped')
      GROUP BY o.wp_order_id, o.shipping_method
    `, [date_from, date_to, packagingWeight]);

    let updated = 0;
    let skipped = 0;

    for (const order of ordersResult.rows) {
      const methodResult = await pool.query(`
        SELECT sm.id as method_id, sc.fuel_surcharge
        FROM shipping_methods sm
        JOIN shipping_carriers sc ON sm.carrier_id = sc.id
        WHERE sm.wc_method_title = $1 AND sm.active = true AND sc.active = true
      `, [order.shipping_method]);

      if (methodResult.rows.length === 0) {
        skipped++;
        continue;
      }

      const { method_id, fuel_surcharge } = methodResult.rows[0];

      const rateResult = await pool.query(`
        SELECT price_ht
        FROM shipping_rates
        WHERE method_id = $1 AND weight_from <= $2 AND weight_to >= $2
        ORDER BY weight_from DESC
        LIMIT 1
      `, [method_id, order.total_weight]);

      if (rateResult.rows.length === 0) {
        skipped++;
        continue;
      }

      const basePrice = parseFloat(rateResult.rows[0].price_ht);
      const calculatedCost = Math.round(basePrice * parseFloat(fuel_surcharge) * 100) / 100;

      await pool.query(`
        UPDATE orders
        SET shipping_cost_calculated = $1, updated_at = NOW()
        WHERE wp_order_id = $2
      `, [calculatedCost, order.wp_order_id]);

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
  getZones,
  updateZone,
  updateZoneMethod,
  getMethodsByCarrier,
  createMethodZoneRate,
  updateMethodZoneRate,
  deleteMethodZoneRate
};
