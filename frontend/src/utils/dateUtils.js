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
