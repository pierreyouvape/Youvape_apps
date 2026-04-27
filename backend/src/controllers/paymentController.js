const pool = require('../config/database');

/**
 * GET /api/payment/methods
 * Récupérer toutes les méthodes de paiement
 */
exports.getMethods = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM payment_methods WHERE is_active = true ORDER BY name'
    );
    res.json({ success: true, methods: result.rows });
  } catch (error) {
    console.error('Error getting payment methods:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /api/payment/methods/:id
 * Récupérer une méthode de paiement par ID
 */
exports.getMethod = async (req, res) => {
  try {
    const { id } = req.params;
    const isNumericId = !isNaN(parseInt(id)) && String(parseInt(id)) === id;
    const whereClause = isNumericId ? 'id = $1' : 'code = $1';

    const result = await pool.query(
      `SELECT * FROM payment_methods WHERE ${whereClause}`,
      [isNumericId ? parseInt(id) : id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Méthode non trouvée' });
    }

    res.json({ success: true, method: result.rows[0] });
  } catch (error) {
    console.error('Error getting payment method:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * PUT /api/payment/methods/:id
 * Mettre à jour une méthode de paiement
 */
exports.updateMethod = async (req, res) => {
  try {
    const { id } = req.params;
    const { monthly_fee, fixed_fee, percent_fee, wc_payment_method } = req.body;

    // Déterminer si c'est un ID numérique ou un code string
    const isNumericId = !isNaN(parseInt(id)) && String(parseInt(id)) === id;
    const whereClause = isNumericId ? 'id = $5' : 'code = $5';

    const result = await pool.query(
      `UPDATE payment_methods
       SET monthly_fee = COALESCE($1, monthly_fee),
           fixed_fee = COALESCE($2, fixed_fee),
           percent_fee = COALESCE($3, percent_fee),
           wc_payment_method = COALESCE($4, wc_payment_method),
           updated_at = CURRENT_TIMESTAMP
       WHERE ${whereClause}
       RETURNING *`,
      [monthly_fee, fixed_fee, percent_fee, wc_payment_method, isNumericId ? parseInt(id) : id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Méthode non trouvée' });
    }

    res.json({ success: true, method: result.rows[0] });
  } catch (error) {
    console.error('Error updating payment method:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/payment/methods
 * Créer une nouvelle méthode de paiement
 */
exports.createMethod = async (req, res) => {
  try {
    const { code, name, wc_payment_method, monthly_fee, fixed_fee, percent_fee } = req.body;

    if (!code || !name) {
      return res.status(400).json({ success: false, error: 'Code et nom requis' });
    }

    const result = await pool.query(
      `INSERT INTO payment_methods (code, name, wc_payment_method, monthly_fee, fixed_fee, percent_fee)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [code, name, wc_payment_method || null, monthly_fee || 0, fixed_fee || 0, percent_fee || 0]
    );

    res.json({ success: true, method: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ success: false, error: 'Ce code existe déjà' });
    }
    console.error('Error creating payment method:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * DELETE /api/payment/methods/:id
 * Supprimer (désactiver) une méthode de paiement
 */
exports.deleteMethod = async (req, res) => {
  try {
    const { id } = req.params;
    const isNumericId = !isNaN(parseInt(id)) && String(parseInt(id)) === id;
    const whereClause = isNumericId ? 'id = $1' : 'code = $1';

    await pool.query(
      `UPDATE payment_methods SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE ${whereClause}`,
      [isNumericId ? parseInt(id) : id]
    );

    res.json({ success: true, message: 'Méthode désactivée' });
  } catch (error) {
    console.error('Error deleting payment method:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /api/payment/wc-titles
 * Liste des payment_method_title distincts en BDD avec mapping actuel
 */
exports.getWcTitles = async (req, res) => {
  try {
    // Comptes par titre WC — tous statuts pour liste exhaustive
    const countsResult = await pool.query(`
      SELECT COALESCE(payment_method_title, '') AS wc_title, COUNT(*) AS order_count
      FROM orders
      WHERE payment_method_title IS NOT NULL AND payment_method_title <> ''
      GROUP BY payment_method_title
      ORDER BY COUNT(*) DESC
    `);

    // Tous les mappings existants
    const mappingsResult = await pool.query(`
      SELECT pmm.id, pmm.wc_title, pmm.country_code, pmm.payment_method_id, pm.name AS method_name
      FROM payment_method_mappings pmm
      JOIN payment_methods pm ON pm.id = pmm.payment_method_id
      WHERE pm.is_active = true
      ORDER BY pmm.wc_title, pmm.country_code NULLS LAST
    `);

    // Indexer les mappings par wc_title
    const mappingsByTitle = {};
    for (const m of mappingsResult.rows) {
      if (!mappingsByTitle[m.wc_title]) mappingsByTitle[m.wc_title] = [];
      mappingsByTitle[m.wc_title].push(m);
    }

    const titles = countsResult.rows.map(row => ({
      wc_title: row.wc_title,
      order_count: parseInt(row.order_count),
      mappings: mappingsByTitle[row.wc_title] || []
    }));

    res.json({ success: true, titles });
  } catch (error) {
    console.error('Error getting wc titles:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/payment/mappings
 * Associer un wc_title à une méthode de paiement
 */
exports.addMapping = async (req, res) => {
  try {
    const { wc_title, payment_method_id, country_code } = req.body;
    if (!wc_title || !payment_method_id) {
      return res.status(400).json({ success: false, error: 'wc_title et payment_method_id requis' });
    }
    const result = await pool.query(
      `INSERT INTO payment_method_mappings (payment_method_id, wc_title, country_code)
       VALUES ($1, $2, $3)
       ON CONFLICT (wc_title, country_code) DO UPDATE SET payment_method_id = EXCLUDED.payment_method_id
       RETURNING *`,
      [payment_method_id, wc_title, country_code || null]
    );
    res.json({ success: true, mapping: result.rows[0] });
  } catch (error) {
    console.error('Error adding mapping:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * DELETE /api/payment/mappings/:id
 * Supprimer un mapping
 */
exports.deleteMapping = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM payment_method_mappings WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting mapping:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Matcher une commande avec une methode de paiement via payment_method_mappings
 * Priorité : correspondance exacte (wc_title + country_code) > fallback (wc_title sans country_code)
 */
const matchPaymentMethod = (paymentMethodTitle, shippingCountry, mappings) => {
  if (!paymentMethodTitle) return null;
  const title = paymentMethodTitle.trim();
  const country = (shippingCountry || '').trim();

  // 1. Match exact titre + pays
  const exactMatch = mappings.find(m => m.wc_title === title && m.country_code === country);
  if (exactMatch) return exactMatch;

  // 2. Fallback : titre sans country_code (tous pays)
  const fallback = mappings.find(m => m.wc_title === title && !m.country_code);
  return fallback || null;
};

/**
 * Charger tous les mappings actifs (utilisé par wcSyncService)
 */
let _mappingsCache = null;
let _mappingsCacheAt = 0;
const loadMappings = async () => {
  // Cache 5 minutes pour ne pas requêter à chaque commande
  if (_mappingsCache && Date.now() - _mappingsCacheAt < 5 * 60 * 1000) return _mappingsCache;
  const result = await pool.query(`
    SELECT pmm.id, pmm.wc_title, pmm.country_code, pmm.payment_method_id,
           pm.fixed_fee, pm.percent_fee, pm.name
    FROM payment_method_mappings pmm
    JOIN payment_methods pm ON pm.id = pmm.payment_method_id
    WHERE pm.is_active = true
  `);
  _mappingsCache = result.rows;
  _mappingsCacheAt = Date.now();
  return _mappingsCache;
};

/**
 * Calculer et appliquer le frais de paiement pour une seule commande
 * Appelé automatiquement lors du sync WC
 */
exports.applyPaymentCostToOrder = async (wpOrderId, paymentMethodTitle, shippingCountry, orderTotal) => {
  try {
    const mappings = await loadMappings();
    const mapping = matchPaymentMethod(paymentMethodTitle, shippingCountry, mappings);
    if (!mapping) return;

    const fixedFee = parseFloat(mapping.fixed_fee) || 0;
    const percentFee = parseFloat(mapping.percent_fee) || 0;
    const total = parseFloat(orderTotal) || 0;
    const cost = Math.round((fixedFee + (percentFee / 100) * total) * 100) / 100;

    await pool.query(
      'UPDATE orders SET payment_cost_calculated = $1 WHERE wp_order_id = $2',
      [cost, wpOrderId]
    );
  } catch (err) {
    console.error(`Erreur calcul frais paiement commande #${wpOrderId}:`, err.message);
  }
};

/**
 * POST /api/payment/calculate
 * Calculer les frais de paiement pour une plage de dates (previsualisation)
 */
exports.calculatePaymentCosts = async (req, res) => {
  try {
    const { date_from, date_to } = req.body;

    if (!date_from || !date_to) {
      return res.status(400).json({ success: false, error: 'date_from et date_to requis' });
    }

    // Charger les mappings avec les frais des méthodes associées
    const mappingsResult = await pool.query(`
      SELECT pmm.id, pmm.wc_title, pmm.payment_method_id,
             pm.fixed_fee, pm.percent_fee, pm.monthly_fee, pm.name
      FROM payment_method_mappings pmm
      JOIN payment_methods pm ON pm.id = pmm.payment_method_id
      WHERE pm.is_active = true
    `);
    const mappings = mappingsResult.rows;

    // Charger les commandes
    const ordersResult = await pool.query(`
      SELECT wp_order_id, payment_method_title, order_total, payment_cost_calculated, shipping_country
      FROM orders
      WHERE post_date >= $1 AND post_date < $2
        AND post_status IN ('wc-completed', 'wc-processing', 'wc-shipped', 'wc-pending')
    `, [date_from, date_to]);

    let totalCalculated = 0;
    let ordersMatched = 0;
    let ordersUnmatched = 0;
    const unmatchedMethods = {};

    for (const order of ordersResult.rows) {
      const mapping = matchPaymentMethod(order.payment_method_title, order.shipping_country, mappings);

      if (!mapping) {
        ordersUnmatched++;
        const key = order.payment_method_title || '(vide)';
        unmatchedMethods[key] = (unmatchedMethods[key] || 0) + 1;
        continue;
      }

      const fixedFee = parseFloat(mapping.fixed_fee) || 0;
      const percentFee = parseFloat(mapping.percent_fee) || 0;
      const orderTotal = parseFloat(order.order_total) || 0;
      const cost = fixedFee + (percentFee / 100) * orderTotal;

      ordersMatched++;
      totalCalculated += cost;
    }

    res.json({
      success: true,
      summary: {
        total_orders: ordersResult.rows.length,
        orders_matched: ordersMatched,
        orders_unmatched: ordersUnmatched,
        total_calculated: Math.round(totalCalculated * 100) / 100,
        unmatched_methods: unmatchedMethods
      }
    });
  } catch (error) {
    console.error('Error calculating payment costs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/payment/apply
 * Appliquer les frais de paiement calcules aux commandes
 */
exports.applyPaymentCosts = async (req, res) => {
  try {
    const { date_from, date_to } = req.body;

    if (!date_from || !date_to) {
      return res.status(400).json({ success: false, error: 'date_from et date_to requis' });
    }

    const mappingsResult = await pool.query(`
      SELECT pmm.id, pmm.wc_title, pmm.payment_method_id,
             pm.fixed_fee, pm.percent_fee, pm.monthly_fee, pm.name
      FROM payment_method_mappings pmm
      JOIN payment_methods pm ON pm.id = pmm.payment_method_id
      WHERE pm.is_active = true
    `);
    const mappings = mappingsResult.rows;

    const ordersResult = await pool.query(`
      SELECT wp_order_id, payment_method_title, order_total, shipping_country
      FROM orders
      WHERE post_date >= $1 AND post_date < $2
        AND post_status IN ('wc-completed', 'wc-processing', 'wc-shipped', 'wc-pending')
    `, [date_from, date_to]);

    let updated = 0;
    let skipped = 0;

    for (const order of ordersResult.rows) {
      const mapping = matchPaymentMethod(order.payment_method_title, order.shipping_country, mappings);

      if (!mapping) {
        skipped++;
        continue;
      }

      const fixedFee = parseFloat(mapping.fixed_fee) || 0;
      const percentFee = parseFloat(mapping.percent_fee) || 0;
      const orderTotal = parseFloat(order.order_total) || 0;
      const cost = Math.round((fixedFee + (percentFee / 100) * orderTotal) * 100) / 100;

      await pool.query(
        'UPDATE orders SET payment_cost_calculated = $1, updated_at = NOW() WHERE wp_order_id = $2',
        [cost, order.wp_order_id]
      );
      updated++;
    }

    res.json({
      success: true,
      message: `${updated} commandes mises a jour, ${skipped} ignorees`,
      updated,
      skipped
    });
  } catch (error) {
    console.error('Error applying payment costs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
