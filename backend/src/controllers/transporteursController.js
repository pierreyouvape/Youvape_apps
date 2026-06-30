const pool = require('../config/database');

// Vue consolidée des 4 transporteurs (toutes les factures de carrier_invoices).
// Normalisation côté frontend : country_totals (Colissimo/Chronopost) en codes ISO,
// account_number = pays (Mondial Relay) en clair, Lettre Suivie = France.
exports.getTotals = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT carrier,
             COALESCE(period_start, invoice_date) AS date,
             total_parcels,
             total_ht,
             CASE WHEN carrier = 'mondial_relay' THEN account_number ELSE NULL END AS mr_pays,
             country_totals
      FROM carrier_invoices
      WHERE carrier IN ('colissimo','chronopost','lettre_suivie','mondial_relay')
      ORDER BY COALESCE(period_start, invoice_date)
    `);
    res.json({ success: true, invoices: rows });
  } catch (err) {
    console.error('[Transporteurs] getTotals error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
