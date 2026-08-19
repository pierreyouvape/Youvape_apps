const pool = require('../config/database');

// Vue consolidée des 4 transporteurs (toutes les factures de carrier_invoices).
// Normalisation côté frontend : country_totals (Colissimo/Chronopost) en codes ISO,
// account_number = pays (Mondial Relay) en clair, Lettre Suivie = France.
exports.getTotals = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT ci.carrier,
             COALESCE(ci.period_start, ci.invoice_date) AS date,
             ci.total_parcels,
             ci.total_ht,
             -- Dépense réelle : total_ht n'est que le sous-total transport. Les charges
             -- globales de fin de facture (carburant, sûreté, éco-participation, frais de
             -- gestion) vivent dans supplements_total, qui contient aussi les suppléments
             -- déjà rattachés à un colis — d'où la soustraction. Neutre pour Colissimo,
             -- Mondial Relay et Lettre Suivie ; +32 % sur Chronopost.
             ci.total_ht + COALESCE(ci.supplements_total, 0)
               - COALESCE((
                   SELECT SUM(s.amount_ht) FROM carrier_invoice_supplements s
                   WHERE s.invoice_id = ci.id
                 ), 0) AS total_ht_reel,
             CASE WHEN ci.carrier = 'mondial_relay' THEN ci.account_number ELSE NULL END AS mr_pays,
             ci.country_totals
      FROM carrier_invoices ci
      WHERE ci.carrier IN ('colissimo','chronopost','lettre_suivie','mondial_relay')
      ORDER BY COALESCE(ci.period_start, ci.invoice_date)
    `);
    res.json({ success: true, invoices: rows });
  } catch (err) {
    console.error('[Transporteurs] getTotals error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
