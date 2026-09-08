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

/**
 * Clés de stockage par module (table `user_column_preferences`, qui sert de dépôt
 * JSON générique par utilisateur/page). Une clé par module : les préférences du
 * graphique et les recherches enregistrées n'ont pas à se marcher dessus.
 */
const PREFS_PAGE = 'atb-commandes';
const SEARCH_PREFS_PAGE = 'atb-recherche';

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
async function getPreferences(userId, page = PREFS_PAGE) {
  const { rows } = await pool.query(
    'SELECT hidden_columns FROM user_column_preferences WHERE user_id = $1 AND page = $2',
    [userId, page],
  );

  // Les recherches enregistrées sont un TABLEAU ; les préférences du graphique un
  // objet. On rend donc la valeur telle quelle et l'appelant décide.
  const raw = rows[0]?.hidden_columns;
  return raw && typeof raw === 'object' ? raw : null;
}

async function savePreferences(userId, prefs, page = PREFS_PAGE) {
  await pool.query(
    `INSERT INTO user_column_preferences (user_id, page, hidden_columns, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, page)
     DO UPDATE SET hidden_columns = $3, updated_at = NOW()`,
    [userId, page, JSON.stringify(prefs)],
  );
}


/* ═══════════════════════════════════════════════════════════════════════════
 * RECHERCHE DE COMMANDES PAR CRITÈRES CROISÉS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Le front envoie une LISTE PLATE de règles, chacune portant le connecteur qui
 * la relie à la précédente ('AND' | 'OR'). La priorité est celle de SQL et des
 * mathématiques : le ET lie plus fort que le OU. « A ET B OU C » se lit donc
 * « (A ET B) OU C ».
 *
 * Cette priorité est invisible dans une liste plate, et c'est le piège classique
 * de ce genre d'outil — on croit avoir demandé autre chose. Elle est donc REPRIS
 * visuellement dans l'écran (les règles liées par ET sont encadrées ensemble) et
 * dans la phrase récapitulative. Ici, on se contente de l'appliquer : découper la
 * liste en groupes ET, puis relier les groupes par OU.
 */

/** Champs autorisés. Toute valeur vient de $n paramétré, jamais concaténée. */
const SEARCH_FIELDS = new Set(['status', 'city', 'postcode', 'country', 'carrier', 'date', 'amount', 'content']);

/** Cibles d'une règle de contenu. */
const CONTENT_TARGETS = new Set(['product', 'category', 'brand']);

/**
 * Résolution produit d'une ligne de commande.
 *
 * Une ligne de déclinaison porte product_id = PARENT et variation_id = déclinaison
 * (vérifié en base). D'où la résolution par COALESCE, et le repli sur le parent
 * pour la marque et la catégorie : la marque est portée par le parent, pas par la
 * déclinaison — sans ce repli, la couverture tombe de 99,9 % à 30 % et le filtre
 * raterait sept produits vendus sur dix, en silence.
 */
const ITEM_JOIN = `
        LEFT JOIN products p  ON p.wp_product_id = COALESCE(NULLIF(oi.variation_id, 0), oi.product_id)
        LEFT JOIN products pp ON pp.wp_product_id = p.wp_parent_id`;

const ITEM_BRAND = `COALESCE(NULLIF(p.brand, ''), NULLIF(pp.brand, ''))`;
const ITEM_CATEGORY = `COALESCE(NULLIF(p.category, ''), NULLIF(pp.category, ''))`;

/** Date de rattachement d'une commande (règle projet : jamais post_date seul). */
const ORDER_DATE = `COALESCE(o.paid_date, o.post_date)`;

/**
 * Traduit une règle en fragment SQL + paramètres.
 * @returns {{sql: string, params: any[]}}
 */
function buildRule(rule, addParam) {
  const { field } = rule;
  if (!SEARCH_FIELDS.has(field)) {
    throw Object.assign(new Error(`Critère inconnu : ${field}`), { status: 400 });
  }

  switch (field) {
    case 'status': {
      const values = asList(rule.values, 'statut');
      return `o.post_status = ANY(${addParam(values)}::varchar[])`;
    }

    case 'country': {
      const values = asList(rule.values, 'pays').map((v) => String(v).toUpperCase());
      return `o.shipping_country = ANY(${addParam(values)}::varchar[])`;
    }

    case 'carrier': {
      const values = asList(rule.values, 'transporteur');
      return `o.shipping_method = ANY(${addParam(values)}::varchar[])`;
    }

    case 'city': {
      // Le champ est saisi par le client : « Montpellier », « montpellier » et
      // « MONTPELLIER » coexistent sur 4 codes postaux. Comparer tel quel raterait
      // ~980 commandes sur cette seule ville. D'où la normalisation des deux côtés.
      const value = asText(rule.value, 'ville');
      const p = addParam(`%${value}%`);
      return `UPPER(unaccent(TRIM(COALESCE(o.shipping_city, '')))) LIKE UPPER(unaccent(${p}))`;
    }

    case 'postcode': {
      const value = asText(rule.value, 'code postal');
      return `TRIM(COALESCE(o.shipping_postcode, '')) LIKE ${addParam(`${value}%`)}`;
    }

    case 'date': {
      const parts = [];
      if (rule.from) parts.push(`${ORDER_DATE} >= ${addParam(rule.from)}::timestamp`);
      if (rule.to) parts.push(`${ORDER_DATE} < (${addParam(rule.to)}::date + INTERVAL '1 day')`);
      if (!parts.length) throw Object.assign(new Error('Période sans borne'), { status: 400 });
      return `(${parts.join(' AND ')})`;
    }

    case 'amount': {
      const parts = [];
      if (rule.min !== undefined && rule.min !== null && rule.min !== '') {
        parts.push(`o.order_total >= ${addParam(Number(rule.min))}`);
      }
      if (rule.max !== undefined && rule.max !== null && rule.max !== '') {
        parts.push(`o.order_total <= ${addParam(Number(rule.max))}`);
      }
      if (!parts.length) throw Object.assign(new Error('Montant sans borne'), { status: 400 });
      return `(${parts.join(' AND ')})`;
    }

    case 'content': {
      const target = rule.target;
      if (!CONTENT_TARGETS.has(target)) {
        throw Object.assign(new Error(`Cible de contenu inconnue : ${target}`), { status: 400 });
      }
      const exclude = rule.op === 'excludes';
      const values = asList(rule.values, 'contenu');

      let cond;
      if (target === 'product') {
        // Choisir un parent doit ramener toutes ses déclinaisons : on teste les
        // deux colonnes, product_id (parent) et variation_id (déclinaison).
        const ids = values.map((v) => parseInt(v, 10)).filter(Number.isFinite);
        if (!ids.length) throw Object.assign(new Error('Produit invalide'), { status: 400 });
        const pIds = addParam(ids);
        cond = `(oi.product_id = ANY(${pIds}::bigint[]) OR oi.variation_id = ANY(${pIds}::bigint[]))`;
      } else if (target === 'category') {
        cond = `${ITEM_CATEGORY} = ANY(${addParam(values)}::varchar[])`;
      } else {
        cond = `${ITEM_BRAND} = ANY(${addParam(values)}::varchar[])`;
      }

      /*
       * « Ne comprend pas » est un NOT EXISTS, jamais une jointure niée : une
       * jointure avec négation renverrait toute commande possédant AU MOINS UN
       * autre article, c'est-à-dire presque toutes. Le NOT EXISTS dit bien
       * « aucune ligne de cette commande ne correspond ».
       */
      return `${exclude ? 'NOT ' : ''}EXISTS (
        SELECT 1
          FROM order_items oi${ITEM_JOIN}
         WHERE oi.wp_order_id = o.wp_order_id
           AND oi.order_item_type = 'line_item'
           AND ${cond}
      )`;
    }

    default:
      throw Object.assign(new Error(`Critère non géré : ${field}`), { status: 400 });
  }
}

function asList(values, label) {
  if (!Array.isArray(values) || !values.length) {
    throw Object.assign(new Error(`Aucune valeur pour le critère ${label}`), { status: 400 });
  }
  if (values.length > 200) {
    throw Object.assign(new Error(`Trop de valeurs pour le critère ${label} (maximum 200)`), { status: 400 });
  }
  return values;
}

function asText(value, label) {
  const v = String(value ?? '').trim();
  if (!v) throw Object.assign(new Error(`Valeur vide pour le critère ${label}`), { status: 400 });
  if (v.length > 120) throw Object.assign(new Error(`Valeur trop longue pour ${label}`), { status: 400 });
  // Les jokers LIKE saisis par l'utilisateur seraient interprétés : on les neutralise.
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Assemble la clause WHERE complète à partir de la liste plate de règles.
 * Découpe en groupes ET (priorité standard), puis relie les groupes par OU.
 */
function buildWhere(rules, params) {
  const addParam = (value) => { params.push(value); return `$${params.length}`; };

  const groups = [];
  let current = [];

  rules.forEach((rule, i) => {
    // Le connecteur porté par une règle la relie à la PRÉCÉDENTE ; celui de la
    // première règle n'a pas de sens et est ignoré.
    if (i > 0 && String(rule.join || 'AND').toUpperCase() === 'OR') {
      groups.push(current);
      current = [];
    }
    current.push(buildRule(rule, addParam));
  });
  groups.push(current);

  return groups
    .filter((g) => g.length)
    .map((g) => (g.length === 1 ? g[0] : `(${g.join(' AND ')})`))
    .join('\n     OR ');
}

/**
 * Recherche paginée de commandes.
 * @param {{rules: object[], limit?: number, offset?: number}} params
 */
async function searchOrders({ rules = [], limit = 50, offset = 0 }) {
  const params = [];
  const where = rules.length ? buildWhere(rules, params) : 'TRUE';

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM orders o WHERE ${where}`,
    params,
  );

  const dataParams = [...params, limit, offset];
  const { rows } = await pool.query(
    `SELECT o.wp_order_id, o.post_status, ${ORDER_DATE} AS order_date,
            o.billing_first_name, o.billing_last_name, o.billing_email,
            o.shipping_city, o.shipping_postcode, o.shipping_country,
            o.shipping_method, o.order_total, o.tracking_number
       FROM orders o
      WHERE ${where}
      ORDER BY ${ORDER_DATE} DESC NULLS LAST
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams,
  );

  return { total: countRows[0].total, rows };
}

/**
 * Villes suggérées. Regroupées sur leur forme normalisée (casse et accents),
 * sinon « Montpellier », « montpellier » et « MONTPELLIER » apparaîtraient comme
 * trois villes différentes. MIN() donne une orthographe représentative à afficher.
 */
async function suggestCities(q, limit = 20) {
  const { rows } = await pool.query(
    `SELECT MIN(o.shipping_city) AS label,
            COUNT(*)::int        AS orders
       FROM orders o
      WHERE COALESCE(o.shipping_city, '') <> ''
        AND UPPER(unaccent(TRIM(o.shipping_city))) LIKE UPPER(unaccent($1))
      GROUP BY UPPER(unaccent(TRIM(o.shipping_city)))
      ORDER BY 2 DESC
      LIMIT $2`,
    [`%${q}%`, limit],
  );
  return rows;
}

/**
 * Produits suggérés. Les parents sortent avant les déclinaisons : choisir un
 * parent ramène déjà toutes ses déclinaisons, c'est presque toujours ce qu'on veut.
 */
async function suggestProducts(q, limit = 25) {
  const { rows } = await pool.query(
    `SELECT p.wp_product_id, p.post_title, p.sku, p.product_type
       FROM products p
      WHERE p.post_status = 'publish'
        AND (p.post_title ILIKE $1 OR p.sku ILIKE $1)
      ORDER BY (p.product_type = 'variation') ASC, p.post_title ASC
      LIMIT $2`,
    [`%${q}%`, limit],
  );
  return rows;
}

/** Catégories du catalogue (une vingtaine), avec le nombre de produits. */
async function listCategories() {
  const { rows } = await pool.query(
    `SELECT category AS label, COUNT(*)::int AS products
       FROM products
      WHERE COALESCE(category, '') <> ''
      GROUP BY 1 ORDER BY 1`,
  );
  return rows;
}

/**
 * Modes de livraison réellement utilisés (12 derniers mois).
 *
 * ⚠️ C'est `shipping_method` — le mode CHOISI par le client — et non
 * `shipping_carrier`, le transporteur assigné ensuite, vide sur 3 447 commandes
 * en 3 mois. La règle « transporteur » filtre `shipping_method` : lui servir la
 * liste de l'autre colonne donnerait un menu dont aucune valeur ne correspond.
 */
async function listShippingMethods() {
  const { rows } = await pool.query(
    `SELECT o.shipping_method AS label, COUNT(*)::int AS orders
       FROM orders o
      WHERE COALESCE(o.shipping_method, '') <> ''
        AND COALESCE(o.paid_date, o.post_date) >= (CURRENT_DATE - INTERVAL '12 months')
      GROUP BY 1 ORDER BY 2 DESC`,
  );
  return rows;
}

/** Marques du catalogue, parent inclus (cf. repli ITEM_BRAND). */
async function listBrands() {
  const { rows } = await pool.query(
    `SELECT brand AS label, COUNT(*)::int AS products
       FROM products
      WHERE COALESCE(brand, '') <> ''
      GROUP BY 1 ORDER BY 1`,
  );
  return rows;
}

module.exports = {
  PAID_STATUSES,
  PREFS_PAGE,
  SEARCH_PREFS_PAGE,
  dailyOrderCounts,
  listCountries,
  getPreferences,
  savePreferences,
  searchOrders,
  suggestCities,
  suggestProducts,
  listCategories,
  listBrands,
  listShippingMethods,
};
