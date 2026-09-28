/**
 * Session des PDA : elle se ferme tous les soirs à 19h30 (heure de Paris).
 *
 * Les PDA changent de mains dans la journée et d'un jour à l'autre : une
 * connexion de 30 jours laisserait le PDA au nom de celui qui l'a pris le
 * premier. Seules les connexions faites depuis le PDA sont concernées ; les
 * postes de bureau gardent leur durée habituelle.
 */

const CUTOFF = { hour: 19, minute: 30 };

/**
 * Secondes jusqu'à la prochaine fermeture : ce soir 19h30, ou demain 19h30 si
 * on se connecte après. Calculé sur l'heure de Paris, pas celle du serveur (UTC).
 *
 * @param {Date} [now]
 * @returns {number}
 */
const secondsUntilPdaCutoff = (now = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(p => [p.type, p.value]));
  const nowSec = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  const cutoff = CUTOFF.hour * 3600 + CUTOFF.minute * 60;
  const diff = cutoff - nowSec;
  return diff > 0 ? diff : diff + 24 * 3600;
};

module.exports = { secondsUntilPdaCutoff, CUTOFF };
