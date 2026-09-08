const atbModel = require('../models/atbModel');

/** Fenêtre maximale demandable, en jours (garde-fou : la requête scanne 3 fenêtres). */
const MAX_RANGE_DAYS = 366;

/** Plafond du filtre pays — la base n'en compte que 38, au-delà c'est du bruit. */
const MAX_COUNTRIES = 60;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;

/** Nombre de jours du mois (year, month 1-12). */
const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

const toYmd = (y, m, d) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * Décale une date de `months` mois et `years` années, en gardant le même
 * quantième. Renvoie `null` si la date cible n'existe pas (31 mars → 31 février,
 * 29 février → 29 février d'une année non bissextile).
 *
 * Choix assumé : on ne rabat PAS sur le dernier jour du mois. Rabattre ferait
 * répéter la valeur du 28 février sur les 29, 30 et 31 mars — trois fantômes
 * identiques qui ne correspondent à rien. Pas de contrepartie = pas de barre.
 */
function shiftDate(ymd, { months = 0, years = 0 }) {
  const [y, m, d] = ymd.split('-').map(Number);

  let ty = y + years;
  let tm = m + months;
  while (tm < 1) { tm += 12; ty -= 1; }
  while (tm > 12) { tm -= 12; ty += 1; }

  if (d > daysInMonth(ty, tm)) return null;
  return toYmd(ty, tm, d);
}

/** Liste des jours 'YYYY-MM-DD' de dateFrom à dateTo inclus. */
function eachDay(dateFrom, dateTo) {
  const days = [];
  const [fy, fm, fd] = dateFrom.split('-').map(Number);
  const [ty, tm, td] = dateTo.split('-').map(Number);
  const cur = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);

  while (cur <= end) {
    days.push(toYmd(cur.getFullYear(), cur.getMonth() + 1, cur.getDate()));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

/** Bornes [min, max] d'une liste de jours, en ignorant les null. */
function boundsOf(days) {
  const present = days.filter(Boolean).sort();
  return present.length ? { from: present[0], to: present[present.length - 1] } : null;
}

/**
 * Normalise le paramètre `countries` : 'FR,BE' → ['FR','BE'].
 * Renvoie `null` (= tous les pays) si vide, et lève si un code est mal formé —
 * mieux vaut une 400 explicite qu'un filtre silencieusement ignoré.
 */
function parseCountries(raw) {
  if (raw === undefined || raw === null || raw === '') return null;

  const list = (Array.isArray(raw) ? raw : String(raw).split(','))
    .map((c) => String(c).trim().toUpperCase())
    .filter(Boolean);

  if (!list.length) return null;
  if (list.length > MAX_COUNTRIES) {
    throw Object.assign(new Error(`Trop de pays sélectionnés (maximum ${MAX_COUNTRIES})`), { status: 400 });
  }
  const bad = list.find((c) => !COUNTRY_RE.test(c));
  if (bad) {
    throw Object.assign(new Error(`Code pays invalide : ${bad}`), { status: 400 });
  }
  return [...new Set(list)];
}

/**
 * GET /api/atb/orders/daily?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD[&countries=FR,BE]
 *
 * Nombre de commandes payées par jour sur la période, avec pour chaque jour sa
 * contrepartie M-1 (même quantième, mois précédent) et N-1 (même date, année
 * précédente). La comparaison est calendaire, pas par jour de semaine : le
 * 7 septembre 2026 (lundi) se compare au 7 septembre 2025 (dimanche).
 *
 * Le filtre pays s'applique aux TROIS fenêtres, sinon on comparerait la France
 * de cette année à l'Europe entière de l'an dernier.
 */
exports.getDailyOrders = async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    if (!YMD_RE.test(dateFrom || '') || !YMD_RE.test(dateTo || '')) {
      return res.status(400).json({
        success: false,
        error: 'dateFrom et dateTo sont requis au format YYYY-MM-DD',
      });
    }
    if (dateFrom > dateTo) {
      return res.status(400).json({ success: false, error: 'dateFrom doit précéder dateTo' });
    }

    const countries = parseCountries(req.query.countries);

    const days = eachDay(dateFrom, dateTo);
    if (days.length > MAX_RANGE_DAYS) {
      return res.status(400).json({
        success: false,
        error: `Période trop longue (${days.length} jours, maximum ${MAX_RANGE_DAYS})`,
      });
    }

    const m1Days = days.map((d) => shiftDate(d, { months: -1 }));
    const n1Days = days.map((d) => shiftDate(d, { years: -1 }));

    const m1Bounds = boundsOf(m1Days);
    const n1Bounds = boundsOf(n1Days);

    // Trois fenêtres disjointes (un mois puis un an d'écart) → trois requêtes
    // ciblées, en parallèle. Une seule requête couvrirait un an entier.
    const [current, m1, n1] = await Promise.all([
      atbModel.dailyOrderCounts({ dateFrom, dateTo, countries }),
      m1Bounds ? atbModel.dailyOrderCounts({ dateFrom: m1Bounds.from, dateTo: m1Bounds.to, countries }) : new Map(),
      n1Bounds ? atbModel.dailyOrderCounts({ dateFrom: n1Bounds.from, dateTo: n1Bounds.to, countries }) : new Map(),
    ]);

    const series = days.map((date, i) => ({
      date,
      orders: current.get(date) || 0,
      m1Date: m1Days[i],
      m1Orders: m1Days[i] ? (m1.get(m1Days[i]) || 0) : null,
      n1Date: n1Days[i],
      n1Orders: n1Days[i] ? (n1.get(n1Days[i]) || 0) : null,
    }));

    // Totaux comparables : on ne somme le courant que sur les jours ayant une
    // contrepartie, sinon l'écart % serait faussé aux bascules de mois.
    const totals = series.reduce(
      (acc, p) => {
        acc.current += p.orders;
        if (p.m1Date) { acc.m1 += p.m1Orders; acc.currentForM1 += p.orders; }
        if (p.n1Date) { acc.n1 += p.n1Orders; acc.currentForN1 += p.orders; }
        return acc;
      },
      { current: 0, m1: 0, n1: 0, currentForM1: 0, currentForN1: 0 },
    );

    res.json({
      success: true,
      range: { from: dateFrom, to: dateTo, days: days.length },
      compare: { m1: m1Bounds, n1: n1Bounds },
      statuses: atbModel.PAID_STATUSES,
      countries,
      series,
      totals,
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, error: error.message });
    }
    console.error('Erreur getDailyOrders (ATB):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

/**
 * GET /api/atb/orders/countries
 * Pays servis sur les 24 derniers mois, du plus gros volume au plus petit.
 * Les libellés et drapeaux sont posés côté front (`utils/countries.js`), qui les
 * tient déjà pour les autres écrans — inutile de les redire en SQL.
 */
exports.getCountries = async (req, res) => {
  try {
    const countries = await atbModel.listCountries();
    res.json({ success: true, countries });
  } catch (error) {
    console.error('Erreur getCountries (ATB):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

/* ─── PRÉFÉRENCES DU MODULE ─────────────────────────────────────────────────
 * Ce qui est enregistré, c'est le CHOIX, pas son résultat : pour un préréglage
 * on garde sa clé ('30j'), pas les dates qu'elle produit. Sinon « 30 derniers
 * jours » se figerait au 30 jours du jour où il a été coché, et il faudrait le
 * refaire chaque matin — précisément ce qu'on veut éviter. Seule la période
 * personnalisée mérite des dates en dur.
 *
 * La liste des préréglages vit côté front (un seul endroit). Ici on ne valide
 * que la FORME de la clé : un préréglage inconnu est ignoré par le front, qui
 * retombe sur son défaut.
 * ────────────────────────────────────────────────────────────────────────── */

const PRESET_RE = /^[a-zA-Z0-9]{1,16}$/;

function sanitizePrefs(body) {
  const out = {};

  if (typeof body.preset === 'string' && PRESET_RE.test(body.preset)) {
    out.preset = body.preset;
  }
  if (YMD_RE.test(body.dateFrom || '')) out.dateFrom = body.dateFrom;
  if (YMD_RE.test(body.dateTo || '')) out.dateTo = body.dateTo;

  // Dates incohérentes : on n'en garde aucune plutôt qu'une plage inversée que
  // le front rejouerait en boucle en 400.
  if (out.dateFrom && out.dateTo && out.dateFrom > out.dateTo) {
    delete out.dateFrom;
    delete out.dateTo;
  }

  const countries = parseCountries(body.countries);
  out.countries = countries || [];

  if (typeof body.showM1 === 'boolean') out.showM1 = body.showM1;
  if (typeof body.showN1 === 'boolean') out.showN1 = body.showN1;

  return out;
}

/** GET /api/atb/preferences */
exports.getPreferences = async (req, res) => {
  try {
    const prefs = await atbModel.getPreferences(req.user.id);
    res.json({ success: true, preferences: prefs });
  } catch (error) {
    console.error('Erreur getPreferences (ATB):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

/** PUT /api/atb/preferences */
exports.savePreferences = async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ success: false, error: 'Corps invalide' });
    }
    const prefs = sanitizePrefs(req.body);
    await atbModel.savePreferences(req.user.id, prefs);
    res.json({ success: true, preferences: prefs });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, error: error.message });
    }
    console.error('Erreur savePreferences (ATB):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};


/* ═══════════════════════════════════════════════════════════════════════════
 * MODULE « RECHERCHE DE COMMANDES »
 * ═══════════════════════════════════════════════════════════════════════════ */

const MAX_RULES = 20;
const MAX_PAGE_SIZE = 200;
const MAX_EXPORT_ROWS = 5000;
const MAX_SAVED_SEARCHES = 30;

/** Règles reçues du front : forme et volume seulement. Le SQL est bâti (et validé) par le modèle. */
function parseRules(body) {
  const rules = body?.rules;
  if (!Array.isArray(rules)) {
    throw Object.assign(new Error('Corps invalide : { rules: [...] } attendu'), { status: 400 });
  }
  if (rules.length > MAX_RULES) {
    throw Object.assign(new Error(`Trop de critères (${rules.length}, maximum ${MAX_RULES})`), { status: 400 });
  }
  return rules;
}

/**
 * POST /api/atb/orders/search
 * Recherche par critères croisés. POST et non GET : l'arbre de règles est
 * structuré, le faire tenir dans une query string le rendrait illisible et
 * buterait sur la limite de longueur d'URL dès quelques produits sélectionnés.
 */
exports.searchOrders = async (req, res) => {
  try {
    const rules = parseRules(req.body);
    const limit = Math.min(parseInt(req.body.limit, 10) || 50, MAX_PAGE_SIZE);
    const offset = Math.max(parseInt(req.body.offset, 10) || 0, 0);

    const { total, rows } = await atbModel.searchOrders({ rules, limit, offset });

    res.json({ success: true, total, limit, offset, orders: rows });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ success: false, error: error.message });
    console.error('Erreur searchOrders (ATB):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

/**
 * POST /api/atb/orders/search/export
 * Même recherche, mais toutes les lignes (plafonnées) pour l'export CSV.
 * Exporter la seule page affichée serait un piège : on croirait avoir tout sorti.
 */
exports.exportOrders = async (req, res) => {
  try {
    const rules = parseRules(req.body);
    const { total, rows } = await atbModel.searchOrders({ rules, limit: MAX_EXPORT_ROWS, offset: 0 });

    res.json({
      success: true,
      total,
      exported: rows.length,
      truncated: total > rows.length,
      orders: rows,
    });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ success: false, error: error.message });
    console.error('Erreur exportOrders (ATB):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

/** GET /api/atb/search/cities?q= */
exports.getCities = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ success: true, cities: [] });
    res.json({ success: true, cities: await atbModel.suggestCities(q) });
  } catch (error) {
    console.error('Erreur getCities (ATB):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

/** GET /api/atb/search/products?q= */
exports.getProducts = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ success: true, products: [] });
    res.json({ success: true, products: await atbModel.suggestProducts(q) });
  } catch (error) {
    console.error('Erreur getProducts (ATB):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

/**
 * GET /api/atb/search/facets
 * Listes courtes du constructeur de règles, chargées une fois : catégories,
 * marques et modes de livraison.
 */
exports.getSearchFacets = async (req, res) => {
  try {
    const [categories, brands, shippingMethods] = await Promise.all([
      atbModel.listCategories(),
      atbModel.listBrands(),
      atbModel.listShippingMethods(),
    ]);
    res.json({ success: true, categories, brands, shippingMethods });
  } catch (error) {
    console.error('Erreur getSearchFacets (ATB):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

/* ─── RECHERCHES ENREGISTRÉES ───────────────────────────────────────────── */

/** GET /api/atb/search/saved */
exports.getSavedSearches = async (req, res) => {
  try {
    const saved = await atbModel.getPreferences(req.user.id, atbModel.SEARCH_PREFS_PAGE);
    res.json({ success: true, searches: Array.isArray(saved) ? saved : [] });
  } catch (error) {
    console.error('Erreur getSavedSearches (ATB):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

/** PUT /api/atb/search/saved — remplace la liste complète. */
exports.saveSavedSearches = async (req, res) => {
  try {
    const list = req.body?.searches;
    if (!Array.isArray(list)) {
      return res.status(400).json({ success: false, error: 'Corps invalide : { searches: [...] } attendu' });
    }
    if (list.length > MAX_SAVED_SEARCHES) {
      return res.status(400).json({
        success: false,
        error: `Trop de recherches enregistrées (maximum ${MAX_SAVED_SEARCHES})`,
      });
    }

    const clean = list.slice(0, MAX_SAVED_SEARCHES).map((item, i) => ({
      id: String(item?.id || `s${Date.now()}${i}`).slice(0, 40),
      name: String(item?.name || 'Sans titre').trim().slice(0, 80) || 'Sans titre',
      rules: Array.isArray(item?.rules) ? item.rules.slice(0, MAX_RULES) : [],
    }));

    await atbModel.savePreferences(req.user.id, clean, atbModel.SEARCH_PREFS_PAGE);
    res.json({ success: true, searches: clean });
  } catch (error) {
    console.error('Erreur saveSavedSearches (ATB):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};
