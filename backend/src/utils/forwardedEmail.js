const pool = require('../config/database');

/**
 * Détection des mails TRANSFÉRÉS par un agent vers l'adresse SAV.
 *
 * Cas typique : un client écrit à contact@youvape.fr, l'agent transfère le mail
 * à contact@service-client.youvape.fr. Côté webhook Mailgun, l'expéditeur est
 * alors l'AGENT — sans traitement, le ticket est créé avec l'agent comme
 * demandeur (et l'accusé de réception part chez lui). On récupère donc
 * l'expéditeur d'origine dans l'en-tête du bloc de transfert.
 *
 * Garde-fous (sinon on requalifierait à tort le demandeur) :
 *  - on ne déclenche QUE si l'expéditeur du webhook est interne (compte de
 *    l'app ou domaine maison) : un client qui transfère un mail de La Poste
 *    reste le demandeur ;
 *  - l'expéditeur d'origine doit être externe (sinon c'est un fil interne).
 */

// Marqueurs de bloc transféré des principaux clients mail (Gmail, Apple Mail,
// Thunderbird), en français et en anglais.
const FORWARD_MARKER = /(?:-{2,}\s*(?:forwarded message|message transf[ée]r[ée])\s*-{2,}|begin forwarded message\s*:|d[ée]but du message transf[ée]r[ée]\s*:)/i;

// Marqueurs ambigus : Outlook les emploie aussi pour citer une RÉPONSE. On ne
// les accepte donc que si le sujet annonce explicitement un transfert.
const QUOTE_MARKER = /-{2,}\s*(?:original message|message d'origine)\s*-{2,}/i;

// Préfixes de sujet annonçant un transfert : "Fwd:", "Fw:", "Tr:", "Rv:"
const FORWARD_SUBJECT = /^\s*(?:(?:fwd?|tr|rv)\s*:\s*)+/i;

// 1re ligne d'en-tête expéditeur du bloc transféré ("From:", "De :"…)
const FROM_LINE = /^[ \t>]*(?:from|de|exp[ée]diteur)\s*:[ \t]*(.+)$/im;

const ADDRESS = /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;

// Domaines maison — surchargeable via SAV_INTERNAL_DOMAINS (liste CSV).
const INTERNAL_DOMAINS = (process.env.SAV_INTERNAL_DOMAINS || 'youvape.fr')
  .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);

/** Extrait l'adresse d'une chaîne "Nom <mail@x.fr>" ou "mail@x.fr". */
function extractAddress(raw) {
  if (!raw) return null;
  const m = String(raw).match(ADDRESS);
  return m ? m[1].toLowerCase() : null;
}

/** Adresse interne ? (domaine maison, ou compte utilisateur de l'app) */
async function isInternalAddress(email) {
  const addr = extractAddress(email);
  if (!addr) return false;

  const domain = addr.split('@')[1] || '';
  if (INTERNAL_DOMAINS.some(d => domain === d || domain.endsWith(`.${d}`))) return true;

  // Les agents utilisent aussi des adresses perso (gmail…) : la liste des
  // comptes de l'app fait foi.
  try {
    const r = await pool.query('SELECT 1 FROM users WHERE LOWER(email) = $1 LIMIT 1', [addr]);
    return r.rows.length > 0;
  } catch (e) {
    console.warn('[SAV Inbound] Vérification expéditeur interne échouée:', e.message);
    return false;
  }
}

/**
 * Repère l'expéditeur d'origine dans le corps d'un mail transféré.
 * @returns {{email: string, name: string|null}|null}
 */
function parseForwardedOrigin(text, subject) {
  if (!text) return null;

  const isForwardSubject = FORWARD_SUBJECT.test(subject || '');
  const marker = text.match(FORWARD_MARKER)
    || (isForwardSubject ? text.match(QUOTE_MARKER) : null);
  // Sans marqueur explicite, on n'accepte que si le sujet annonce un transfert.
  if (!marker && !isForwardSubject) return null;

  const zone = marker ? text.slice(marker.index + marker[0].length) : text;
  const fromLine = zone.match(FROM_LINE);
  if (!fromLine) return null;

  const raw = fromLine[1].trim();
  const email = extractAddress(raw);
  if (!email) return null;

  // Nom affiché = ce qui précède l'adresse, sans les chevrons ni guillemets
  const name = raw.slice(0, raw.toLowerCase().indexOf(email))
    .replace(/["'<]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { email, name: name || null };
}

/** Retire les préfixes "Fwd:" / "Tr:" d'un sujet. */
function stripForwardPrefix(subject) {
  return (subject || '').replace(FORWARD_SUBJECT, '');
}

/**
 * Renvoie le demandeur d'origine si le mail entrant est un transfert d'agent,
 * sinon null (comportement inchangé : l'expéditeur est le demandeur).
 *
 * @param {object} params
 * @param {string} params.sender  expéditeur du webhook Mailgun
 * @param {string} params.subject sujet du mail
 * @param {string} params.text    corps brut (body-plain de préférence)
 */
async function resolveForwardedOrigin({ sender, subject, text }) {
  const senderAddr = extractAddress(sender);
  if (!senderAddr) return null;

  if (!(await isInternalAddress(senderAddr))) return null;

  const origin = parseForwardedOrigin(text, subject);
  if (!origin || origin.email === senderAddr) return null;
  if (await isInternalAddress(origin.email)) return null;

  return origin;
}

module.exports = {
  resolveForwardedOrigin,
  parseForwardedOrigin,
  isInternalAddress,
  stripForwardPrefix,
  extractAddress,
};
