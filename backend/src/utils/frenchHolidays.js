/**
 * Jours fériés français (métropole) et jours ouvrés.
 *
 * Les dates circulent en chaînes 'YYYY-MM-DD' : un jour de calendrier n'a pas
 * de fuseau, et un objet Date créé à minuit Paris vaut la veille en UTC — le
 * serveur tourne en UTC. Les calculs se font donc sur des dates UTC « nues ».
 *
 * Sert les réclamations Chronopost : un colis déposé la veille d'un férié n'est
 * dû que le jour ouvré suivant.
 */

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s) => {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const addDays = (s, n) => {
  const d = parse(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
};

/** Dimanche de Pâques (algorithme de Meeus / Butcher). */
const easterSunday = (year) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
};

const cache = new Map();

/** Les onze jours fériés d'une année. */
const holidaysOf = (year) => {
  if (cache.has(year)) return cache.get(year);
  const easter = easterSunday(year);
  const set = new Set([
    `${year}-01-01`,            // Jour de l'an
    addDays(easter, 1),         // Lundi de Pâques
    `${year}-05-01`,            // Fête du travail
    `${year}-05-08`,            // Victoire 1945
    addDays(easter, 39),        // Ascension
    addDays(easter, 50),        // Lundi de Pentecôte
    `${year}-07-14`,            // Fête nationale
    `${year}-08-15`,            // Assomption
    `${year}-11-01`,            // Toussaint
    `${year}-11-11`,            // Armistice
    `${year}-12-25`,            // Noël
  ]);
  cache.set(year, set);
  return set;
};

const isHoliday = (s) => holidaysOf(Number(String(s).slice(0, 4))).has(s);

/** 1 = lundi … 7 = dimanche. */
const isoWeekday = (s) => parse(s).getUTCDay() || 7;

/**
 * Le n-ième jour ouvré après `s` (lundi → vendredi, hors fériés). Avec
 * `saturday`, le samedi compte aussi (livraison samedi prise en option).
 *
 * @param {string} s - 'YYYY-MM-DD'
 * @param {number} n
 * @param {{saturday?: boolean}} [opts]
 * @returns {string}
 */
const addBusinessDays = (s, n, { saturday = false } = {}) => {
  let day = s;
  let left = n;
  while (left > 0) {
    day = addDays(day, 1);
    const wd = isoWeekday(day);
    if (wd === 7 || (wd === 6 && !saturday) || isHoliday(day)) continue;
    left--;
  }
  return day;
};

module.exports = { easterSunday, holidaysOf, isHoliday, isoWeekday, addDays, addBusinessDays };
