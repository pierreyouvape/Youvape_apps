/**
 * Règles de récurrence des tâches de l'app Tableau.
 *
 * Une règle = { unit: 'day'|'week'|'month', every, weekdays, month_day, start_date }.
 *   - day   : tous les `every` jours à partir de start_date ;
 *   - week  : toutes les `every` semaines (comptées depuis la semaine de start_date),
 *             les jours ISO de `weekdays` (1 = lundi … 7 = dimanche) ;
 *   - month : tous les `every` mois (comptés depuis le mois de start_date), le
 *             `month_day`. Un quantième absent du mois tombe sur son dernier jour :
 *             « le 31 » veut dire « en fin de mois » pour une tâche.
 *
 * Tout se fait sur des chaînes 'YYYY-MM-DD' manipulées en UTC : aucune heure,
 * donc aucun décalage de fuseau possible.
 */

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;

const toDate = (ymd) => new Date(`${ymd}T00:00:00Z`);
const toYmd = (d) => d.toISOString().slice(0, 10);
const addDays = (ymd, n) => toYmd(new Date(toDate(ymd).getTime() + n * DAY_MS));
const diffDays = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY_MS);
const isoDow = (ymd) => toDate(ymd).getUTCDay() || 7;
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Date du jour à Paris, 'YYYY-MM-DD'. */
const parisToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());

/** Valide et normalise une règle venue du front. Lève une erreur 400 sinon. */
function normalizeRule(input) {
  const fail = (msg) => { const e = new Error(msg); e.statusCode = 400; throw e; };
  const unit = input.unit;
  if (!['day', 'week', 'month'].includes(unit)) fail('Récurrence invalide');
  const every = Number(input.every);
  if (!Number.isInteger(every) || every < 1 || every > 365) fail('Intervalle invalide (1 à 365)');
  if (!YMD_RE.test(input.start_date || '')) fail('Date de début invalide');

  let weekdays = null;
  let monthDay = null;
  if (unit === 'week') {
    weekdays = [...new Set((input.weekdays || []).map(Number))]
      .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
      .sort();
    // Aucun jour coché : le jour de la semaine de la date de début
    if (!weekdays.length) weekdays = [isoDow(input.start_date)];
  }
  if (unit === 'month') {
    monthDay = Number(input.month_day) || Number(input.start_date.slice(8, 10));
    if (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31) fail('Jour du mois invalide');
  }
  return { unit, every, weekdays, month_day: monthDay, start_date: input.start_date };
}

/** La date `ymd` est-elle une échéance de la règle ? */
function matches(rule, ymd) {
  if (ymd < rule.start_date) return false;
  if (rule.unit === 'day') return diffDays(rule.start_date, ymd) % rule.every === 0;
  if (rule.unit === 'week') {
    if (!rule.weekdays.includes(isoDow(ymd))) return false;
    const mondayOfStart = addDays(rule.start_date, 1 - isoDow(rule.start_date));
    return Math.floor(diffDays(mondayOfStart, ymd) / 7) % rule.every === 0;
  }
  const [y0, m0] = rule.start_date.split('-').map(Number);
  const [y, m, d] = ymd.split('-').map(Number);
  if (((y - y0) * 12 + (m - m0)) % rule.every !== 0) return false;
  return d === Math.min(rule.month_day, daysInMonth(y, m));
}

/**
 * Première échéance STRICTEMENT après `after` (et jamais avant start_date).
 * Pour la première échéance d'une tâche : `after` = veille du jour voulu.
 */
function nextOccurrence(rule, after) {
  let ymd = addDays(after, 1);
  if (ymd < rule.start_date) ymd = rule.start_date;
  // Borne large : la plus longue période possible est de 365 mois.
  const limit = rule.every * (rule.unit === 'day' ? 1 : rule.unit === 'week' ? 7 : 31) + 31;
  for (let i = 0; i <= limit; i += 1) {
    if (matches(rule, ymd)) return ymd;
    ymd = addDays(ymd, 1);
  }
  throw new Error('Aucune échéance trouvée');
}

module.exports = { normalizeRule, matches, nextOccurrence, parisToday, addDays };
