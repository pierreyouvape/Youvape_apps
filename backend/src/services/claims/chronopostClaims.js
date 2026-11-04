/**
 * Réclamations Chronopost : la partie sans base ni réseau.
 *
 * Testée par tests/chronopostClaims.test.js. Ce qui est décidé ici :
 *   - le jour où un colis est DÛ, d'après son produit et son jour de dépôt ;
 *   - s'il faut le réclamer, et sous quel objet (RT retard, PC position colis) ;
 *   - le fichier d'import du « Service Client en ligne » Chronopost ;
 *   - la lecture du compte-rendu que Chronopost affiche après l'import.
 *
 * Les règles d'import viennent de la notice Chronopost (« Notice pour l'import
 * sur le Service Client en ligne ») : pour RT, ni motif, ni famille, ni contenu ;
 * pour PC, famille et contenu facultatifs ; commentaire toujours obligatoire.
 */

const { addBusinessDays } = require('../../utils/frenchHolidays');

/**
 * Produits Chronopost suivis. Chrono 13 et Chrono Relais sont garantis le
 * lendemain avant 13 h ; Chrono Express (international) est laissé à J+3 ouvrés
 * (décision Pierre du 03/11/2026). 2Shop n'est jamais réclamé.
 */
const PRODUCTS = {
  '01': { label: 'Chrono 13', days: 1, before13: true },
  '86': { label: 'Chrono Relais', days: 1, before13: true, relay: true },
  '17': { label: 'Chrono Express', days: 3 },
};

/** Le colis est jugé à cette heure-là, le jour dû (heure de Paris). */
const CHECK_TIME = '16:00';

const OBJECTS = {
  RT: 'Retard / Hors délais',
  PC: 'Position colis',
};

/** Famille « Autre » : toujours F1 (décision Pierre), là où la notice l'admet. */
const FAMILY = 'F1';

const CSV_HEADER = ['numeroColis', 'codeObjetDemande', 'codeMotif', 'contenuColis', 'codeFamilleProduit', 'commentaire'];

/** '86-SAMEDI' → { code: '86', saturday: true } */
const parseMethod = (methodCode) => {
  const [code, option] = String(methodCode || '').split('-');
  return { code, saturday: option === 'SAMEDI' };
};

/**
 * Jour dû d'un colis, ou null s'il n'est pas d'un produit suivi.
 * @param {string} depositDay - 'YYYY-MM-DD', jour du bordereau (heure de Paris)
 * @param {string} methodCode - shipment_labels.method_code
 */
const dueDay = (depositDay, methodCode) => {
  const { code, saturday } = parseMethod(methodCode);
  const product = PRODUCTS[code];
  if (!product) return null;
  return addBusinessDays(depositDay, product.days, { saturday: saturday && product.days === 1 });
};

/** Décalage de Paris sur UTC (en minutes) à un instant donné. */
const parisOffsetMinutes = (date) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(date).map(p => [p.type, p.value]));
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return Math.round((asUtc - date.getTime()) / 60000);
};

/** 'YYYY-MM-DD' + 'HH:MM' heure de Paris → instant. */
const parisInstant = (day, hhmm) => {
  const guess = new Date(`${day}T${hhmm}:00Z`);
  return new Date(guess.getTime() - parisOffsetMinutes(guess) * 60000);
};

/** L'instant où un colis dû ce jour-là est jugé. */
const checkInstant = (day) => parisInstant(day, CHECK_TIME);

/**
 * Réclamer, et quoi ?
 *
 * Seuls comptent les évènements survenus AVANT l'heure du contrôle : rejoué un
 * autre jour (rattrapage), le contrôle rend la même réponse.
 *   - livré → rien. Relais : mis à disposition au point relais, c'est là que
 *     s'arrête l'engagement de Chronopost. Domicile : présenté suffit (client
 *     absent, avis de passage, laissé en point de retrait) ;
 *   - aucun scan Chronopost → PC, le colis remis au chauffeur n'a jamais été vu ;
 *   - sinon → RT.
 * Un code jamais classé est un vrai scan Chronopost : il prouve la prise en
 * charge. « Étiquette créée » et les simples informations, non.
 *
 * @param {{method_code: string}} label
 * @param {{event_key: string, occurred_at: (Date|string)}[]} events
 * @param {(key: string) => ?string} stateOf
 * @param {string} day - jour dû
 * @returns {{object: ?('RT'|'PC'), lastEvent: ?object}}
 */
const decide = (label, events, stateOf, day) => {
  const product = PRODUCTS[parseMethod(label.method_code).code];
  const cutoff = checkInstant(day);
  const before = events
    .filter(e => new Date(e.occurred_at) <= cutoff)
    .sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));

  // À domicile, un colis PRÉSENTÉ (client absent, laissé en point de retrait)
  // a été livré dans les temps : le réclamer serait faux.
  const delivered = product?.relay
    ? ['delivered', 'at_pickup_point']
    : ['delivered', 'delivery_failed', 'at_pickup_point'];
  if (before.some(e => delivered.includes(stateOf(e.event_key)))) return { object: null, lastEvent: null };

  const scans = before.filter(e => !['label_created', 'info'].includes(stateOf(e.event_key)));
  const lastEvent = scans[scans.length - 1] || null;
  return { object: scans.length ? 'RT' : 'PC', lastEvent };
};

const frDay = (day) => day.split('-').reverse().join('/');

/** 'jj/mm hh:mm' heure de Paris. */
const frStamp = (date) => new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(new Date(date)).replace(',', '').replace(' à ', ' ');

/**
 * Toujours demandé (Pierre, 04/11/2026). Placé AVANT le dernier évènement :
 * si le commentaire est coupé, c'est l'évènement qui saute, pas la demande.
 */
const REFUND_REQUEST = 'Nous demandons le remboursement des frais de livraison de ce colis.';

/**
 * Le commentaire envoyé à Chronopost (obligatoire). Factuel : produit, dépôt,
 * échéance, demande de remboursement du port, ce que dit le suivi.
 */
const buildComment = ({ object, label, depositDay, bordereauNumber, day, lastEvent }) => {
  const product = PRODUCTS[parseMethod(label.method_code).code];
  const depot = `${product.label} remis au chauffeur le ${frDay(depositDay)}`
    + (bordereauNumber ? ` (bordereau ${bordereauNumber})` : '');
  if (object === 'PC') {
    return `${depot}, aucune prise en charge enregistrée depuis. Merci de localiser le colis. ${REFUND_REQUEST}`;
  }
  const due = `livraison due le ${frDay(day)}${product.before13 ? ' avant 13h' : ''}`;
  const last = lastEvent
    ? ` Dernier évènement : ${frStamp(lastEvent.occurred_at)} ${lastEvent.label || lastEvent.event_key}`
      + `${lastEvent.location ? ` (${lastEvent.location})` : ''}.`
    : '';
  return `${depot}, ${due}, non livré à 16h. ${REFUND_REQUEST}${last}`;
};

// ── Fichier d'import ────────────────────────────────────────────────────────

/** Le séparateur et les retours à la ligne n'ont pas leur place dans un champ. */
const clean = (v, max = 400) => String(v ?? '')
  .replace(/[;\r\n\t]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

/**
 * Une ligne du fichier, selon la notice : RT n'a ni motif, ni famille, ni
 * contenu ; PC admet famille et contenu.
 */
const csvRow = ({ trackingNumber, object, content, comment }) => [
  clean(trackingNumber, 30),
  object,
  '',
  object === 'PC' ? clean(content, 100) : '',
  object === 'PC' ? FAMILY : '',
  clean(comment),
];

/**
 * Le fichier complet : en-tête du modèle, `;`, CRLF, en UTF-8 SANS BOM.
 *
 * Chronopost lit le fichier en UTF-8 : le premier import (03/11/2026, en
 * Windows-1252) a donné « non livr� � 16h ». Pas de BOM : il se collerait
 * devant « numeroColis » et l'en-tête ne serait plus reconnu.
 */
const buildCsv = (claims) => {
  const lines = [CSV_HEADER, ...claims.map(csvRow)].map(cols => cols.join(';'));
  return Buffer.from(lines.join('\r\n').normalize('NFC') + '\r\n', 'utf8');
};

/**
 * Le compte-rendu affiché par Chronopost après l'import :
 *   « Ligne 1 XW001312035FR : Ticket créé avec le numéro 01208496 »
 * Une ligne sans « Ticket créé » est un refus : son texte est gardé tel quel.
 *
 * @returns {{trackingNumber: string, ticket: ?string, error: ?string}[]}
 */
const parseImportReport = (text) => {
  const results = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const m = /\b([A-Z]{2}\d{9}[A-Z]{2})\b\s*:?\s*(.*)$/i.exec(raw.trim());
    if (!m) continue;
    const trackingNumber = m[1].toUpperCase();
    const rest = m[2].trim();
    const ok = /ticket\s+cr[ée]{2}\s+avec\s+le\s+num[ée]ro\s+(\d+)/i.exec(rest);
    results.push({ trackingNumber, ticket: ok ? ok[1] : null, error: ok ? null : (rest || 'Ligne refusée') });
  }
  return results;
};

module.exports = {
  PRODUCTS, OBJECTS, FAMILY, CSV_HEADER, CHECK_TIME, REFUND_REQUEST,
  parseMethod, dueDay, parisInstant, checkInstant, decide, buildComment,
  csvRow, buildCsv, parseImportReport, frDay,
};
