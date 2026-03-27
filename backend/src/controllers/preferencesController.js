const pool = require('../config/database');

const preferencesController = {
  getPreferences: async (req, res) => {
    const userId = req.user.id;
    const { page } = req.params;
    try {
      const result = await pool.query(
        'SELECT hidden_columns FROM user_column_preferences WHERE user_id = $1 AND page = $2',
        [userId, page]
      );
      const hiddenColumns = result.rows[0]?.hidden_columns || [];
      res.json({ success: true, hiddenColumns });
    } catch (err) {
      console.error('getPreferences error:', err);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  },

  savePreferences: async (req, res) => {
    const userId = req.user.id;
    const { page } = req.params;
    const { hiddenColumns } = req.body;
    if (!Array.isArray(hiddenColumns)) {
      return res.status(400).json({ success: false, error: 'hiddenColumns doit être un tableau' });
    }
    try {
      await pool.query(
        `INSERT INTO user_column_preferences (user_id, page, hidden_columns, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, page)
         DO UPDATE SET hidden_columns = $3, updated_at = NOW()`,
        [userId, page, JSON.stringify(hiddenColumns)]
      );
      res.json({ success: true });
    } catch (err) {
      console.error('savePreferences error:', err);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }
};

module.exports = preferencesController;
