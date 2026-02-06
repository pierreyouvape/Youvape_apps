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
