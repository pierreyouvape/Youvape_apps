/**
 * Formate une date WooCommerce (string "YYYY-MM-DD HH:MM:SS" heure Paris)
 * sans passer par new Date() pour éviter la conversion timezone du navigateur.
 */
export function formatDate(dateString, options = {}) {
  if (!dateString) return '-';

  // Parse manuellement "YYYY-MM-DD HH:MM:SS" ou "YYYY-MM-DDTHH:MM:SS"
  const str = String(dateString).replace('T', ' ').split('.')[0];
  const [datePart, timePart] = str.split(' ');
  if (!datePart) return '-';

  const [year, month, day] = datePart.split('-').map(Number);
  const [hour = 0, minute = 0] = timePart ? timePart.split(':').map(Number) : [];

  const showTime = options.time !== false && timePart;

  const monthNames = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
    'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const monthLong = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  const monthStr = options.monthLong ? monthLong[month - 1] : monthNames[month - 1];

  const dateFmt = `${day} ${monthStr} ${year}`;

  if (!showTime) return dateFmt;

  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${dateFmt}, ${hh}:${mm}`;
}

/**
 * Formate un timestamp **stocké en UTC** (ex: created_at/updated_at SAV, écrits
 * par NOW()/CURRENT_TIMESTAMP sur une BDD en UTC) en l'affichant en heure de
 * Paris. Contrairement à formatDate() — réservé aux dates WooCommerce déjà en
 * heure Paris — on convertit ici réellement le fuseau (DST géré par Intl).
 *
 * Mêmes options que formatDate ({ time, monthLong }).
 */
export function formatDateUTC(dateString, options = {}) {
  if (!dateString) return '-';

  // Normaliser en chaîne ISO UTC : si pas de fuseau explicite, on force "Z".
  let iso = String(dateString).replace(' ', 'T').split('.')[0];
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso)) iso += 'Z';

  const d = new Date(iso);
  if (isNaN(d.getTime())) return formatDate(dateString, options); // fallback

  // Récupère les composants en Europe/Paris via Intl (robuste DST).
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});

  // On réutilise formatDate pour un rendu identique (mois en lettres, etc.).
  const parisStr = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:00`;
  return formatDate(parisStr, options);
}
