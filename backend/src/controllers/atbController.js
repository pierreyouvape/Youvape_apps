const atbModel = require('../models/atbModel');

/** Fenêtre maximale demandable, en jours (garde-fou : la requête scanne 3 fenêtres). */
const MAX_RANGE_DAYS = 366;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

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
 * GET /api/atb/orders/daily?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 *
 * Nombre de commandes payées par jour sur la période, avec pour chaque jour sa
 * contrepartie M-1 (même quantième, mois précédent) et N-1 (même date, année
 * précédente). La comparaison est calendaire, pas par jour de semaine : le
 * 7 septembre 2026 (lundi) se compare au 7 septembre 2025 (dimanche).
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
      atbModel.dailyOrderCounts({ dateFrom, dateTo }),
      m1Bounds ? atbModel.dailyOrderCounts({ dateFrom: m1Bounds.from, dateTo: m1Bounds.to }) : new Map(),
      n1Bounds ? atbModel.dailyOrderCounts({ dateFrom: n1Bounds.from, dateTo: n1Bounds.to }) : new Map(),
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
      series,
      totals,
    });
  } catch (error) {
    console.error('Erreur getDailyOrders (ATB):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};
