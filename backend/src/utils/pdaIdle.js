/**
 * Verrouillage du PDA après inactivité : délai réglé dans /settings, onglet
 * « Gestion utilisateurs » (app_config `pda_idle_minutes`).
 *
 * 0 = jamais. Lu par chaque PDA via GET /api/users/me/pda-settings : la route
 * des réglages est réservée aux admins, un préparateur ne la lit pas.
 */

const PDA_IDLE_KEY = 'pda_idle_minutes';
const PDA_IDLE_DEFAULT = 1;
const PDA_IDLE_MAX = 240;

/** Valeur saisie → chaîne à enregistrer, ou null si refusée. */
const validatePdaIdle = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 0 && minutes <= PDA_IDLE_MAX ? String(minutes) : null;
};

/** Valeur enregistrée (ou absente) → minutes. */
const readPdaIdle = (stored) => {
  const valid = validatePdaIdle(stored);
  return valid === null ? PDA_IDLE_DEFAULT : Number(valid);
};

module.exports = { PDA_IDLE_KEY, PDA_IDLE_DEFAULT, PDA_IDLE_MAX, validatePdaIdle, readPdaIdle };
