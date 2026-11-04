/**
 * Verrouillage après inactivité, réglé dans /settings, onglet « Gestion
 * utilisateurs » :
 *   - PDA                    : app_config `pda_idle_minutes`, 1 min par défaut ;
 *   - postes de préparation  : app_config `station_idle_minutes`, 10 min par défaut
 *     (ordinateurs marqués comme tels dans leur navigateur, depuis /settings).
 *
 * 0 = jamais. Lu via GET /api/users/me/pda-settings : la route des réglages est
 * réservée aux admins, un préparateur ne la lit pas.
 */

const PDA_IDLE_KEY = 'pda_idle_minutes';
const PDA_IDLE_DEFAULT = 1;
const STATION_IDLE_KEY = 'station_idle_minutes';
const STATION_IDLE_DEFAULT = 10;
const IDLE_MAX = 240;

/** Valeur saisie → chaîne à enregistrer, ou null si refusée. */
const validateIdle = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 0 && minutes <= IDLE_MAX ? String(minutes) : null;
};

/** Valeur enregistrée (ou absente) → minutes. */
const readIdle = (stored, fallback) => {
  const valid = validateIdle(stored);
  return valid === null ? fallback : Number(valid);
};

module.exports = {
  PDA_IDLE_KEY, PDA_IDLE_DEFAULT, STATION_IDLE_KEY, STATION_IDLE_DEFAULT, IDLE_MAX, validateIdle, readIdle,
};
