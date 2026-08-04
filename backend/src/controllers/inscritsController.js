const inscritsModel = require('../models/inscritsModel');

/**
 * GET /api/inscrits
 * Liste des clients inscrits SANS commande payée, regroupés par jour d'inscription.
 * Query params : ?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD (bornes incluses).
 * Sans dates : renvoie tout l'historique.
 */
exports.getWithoutOrders = async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    const rows = await inscritsModel.listWithoutOrders({ dateFrom, dateTo });

    // Regroupement par jour d'inscription (clé locale YYYY-MM-DD, heure Paris brute).
    const byDay = new Map();
    for (const r of rows) {
      const d = r.user_registered;
      // user_registered peut arriver en Date (pg) : on prend la partie date locale.
      const day = d instanceof Date
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        : String(d).slice(0, 10);

      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push({
        id: r.id,
        wp_user_id: r.wp_user_id,
        email: r.email,
        first_name: r.first_name || '',
        last_name: r.last_name || '',
        user_registered: r.user_registered,
        country_code: r.country_code || null,
      });
    }

    // Tableau trié par jour décroissant (le plus récent en premier).
    const days = [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, customers]) => ({ date, count: customers.length, customers }));

    res.json({
      success: true,
      total: rows.length,
      days,
    });
  } catch (error) {
    console.error('Erreur getWithoutOrders (inscrits sans commande):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};
