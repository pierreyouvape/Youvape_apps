const pool = require('../config/database');

/**
 * ATB — Anthony Tool Box : accès données.
 *
 * Liste blanche des 6 statuts payés (règle projet, cf. CLAUDE.md) : jamais de
 * liste noire, le shop a des statuts custom + `wc-checkout-draft` très volumineux.
 */
const PAID_STATUSES = [
  'wc-completed',
  'wc-delivered',
  'wc-processing',
  'wc-awaiting-delivery',
  'wc-shipped',
  'wc-being-delivered',
];

/**
 * Le pays d'une commande, c'est `shipping_country` — où le colis part, pas où la
 * carte est facturée. Même convention que `statsService` et `analysisController`,
 * donc les chiffres se recoupent d'un écran à l'autre.
 */
const COUNTRY_FIELD = 'shipping_country';

/** Clé de stockage des préférences du module (table `user_column_preferences`). */
const PREFS_PAGE = 'atb-commandes';

/**
 * Nombre de commandes par jour sur une fenêtre [dateFrom, dateTo] (bornes incluses).
 *
 * Rattachement au jour par `COALESCE(paid_date, post_date)` — date de paiement
 * réelle, repli sur la création. Même convention que Financier.
 *
 * WooCommerce stocke en heure Paris locale : aucune conversion de fuseau ici,
 * la date est déjà celle attendue.
 *
 * @param {{ dateFrom: string, dateTo: string, countries?: string[]|null }} params
 *        dates en 'YYYY-MM-DD' ; `countries` vide ou null = tous les pays.
 * @returns {Promise<Map<string, number>>} jour 'YYYY-MM-DD' → nombre de commandes
 */
async function dailyOrderCounts({ dateFrom, dateTo, countries = null, statuses = PAID_STATUSES }) {
  // Tableau vide traité comme « pas de filtre » : sans ça, un filtre vidé par
  // l'utilisateur renverrait zéro commande au lieu de tout.
  const countryFilter = countries && countries.length ? countries : null;

  const { rows } = await pool.query(
    `SELECT to_char(COALESCE(o.paid_date, o.post_date), 'YYYY-MM-DD') AS day,
            COUNT(*)::int AS orders
       FROM orders o
      WHERE o.post_status = ANY($1::varchar[])
        AND COALESCE(o.paid_date, o.post_date) >= $2::timestamp
        AND COALESCE(o.paid_date, o.post_date) <  ($3::date + INTERVAL '1 day')
        AND ($4::varchar[] IS NULL OR o.${COUNTRY_FIELD} = ANY($4::varchar[]))
      GROUP BY 1`,
    [statuses, dateFrom, dateTo, countryFilter],
  );

  return new Map(rows.map((r) => [r.day, r.orders]));
}

/**
 * Pays présents dans les commandes payées, du plus gros volume au plus petit —
 * FR et BE d'abord, donc, ce qui met les deux seuls pays à fort volume en tête
 * de liste.
 *
 * Fenêtre glissante de 24 mois plutôt que tout l'historique : la liste reste
 * stable quand on change la période affichée (une liste qui se recompose à
 * chaque changement de dates ferait disparaître un pays déjà coché), tout en
 * excluant les pays qu'on ne sert plus.
 *
 * Les commandes sans pays renseigné sont exclues de la LISTE (on ne peut pas
 * cocher « vide »), mais restent comptées tant qu'aucun filtre n'est posé.
 */
async function listCountries() {
  const { rows } = await pool.query(
    `SELECT o.${COUNTRY_FIELD} AS code,
            COUNT(*)::int AS orders
       FROM orders o
      WHERE o.post_status = ANY($1::varchar[])
        AND COALESCE(o.paid_date, o.post_date) >= (CURRENT_DATE - INTERVAL '24 months')
        AND o.${COUNTRY_FIELD} IS NOT NULL
        AND o.${COUNTRY_FIELD} <> ''
      GROUP BY 1
      ORDER BY 2 DESC, 1 ASC`,
    [PAID_STATUSES],
  );

  return rows;
}

/**
 * Préférences du module pour un utilisateur (période, pays, séries affichées).
 *
 * Stockées dans `user_column_preferences`, qui malgré son nom sert déjà de
 * dépôt JSON générique par utilisateur/page (`usersController` y range la page
 * « home »). Pas de table ni de migration supplémentaire.
 */
async function getPreferences(userId) {
  const { rows } = await pool.query(
    'SELECT hidden_columns FROM user_column_preferences WHERE user_id = $1 AND page = $2',
    [userId, PREFS_PAGE],
  );

  const raw = rows[0]?.hidden_columns;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
}

async function savePreferences(userId, prefs) {
  await pool.query(
    `INSERT INTO user_column_preferences (user_id, page, hidden_columns, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, page)
     DO UPDATE SET hidden_columns = $3, updated_at = NOW()`,
    [userId, PREFS_PAGE, JSON.stringify(prefs)],
  );
}

module.exports = {
  PAID_STATUSES,
  PREFS_PAGE,
  dailyOrderCounts,
  listCountries,
  getPreferences,
  savePreferences,
};
