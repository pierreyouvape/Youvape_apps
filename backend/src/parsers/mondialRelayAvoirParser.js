/*
 * Parser des avoirs Mondial Relay (AVC26_006095…).
 *
 * Contrairement aux factures, un avoir ne porte pas de balise <ref> : tout se
 * lit dans le texte, que pdf-parse sort ligne à ligne :
 *   Avoir n° AVC26_006095
 *   Villeneuve d'Ascq, le 08 octobre 2026
 *   AVOIR REMISE 1% MANQUANTE 1ER SEMESTRE            ← motif
 *   Description Quantité Prix unitaire Montant
 *   REMISE 1% LGYOUVAP2600000048 1 28,58 € 28,58 €    ← une ligne par poste
 *   ERREUR POIDS COLIS 657030 1 9,21 € 9,21 €
 *   Montant HT(€) % TVA Montant TVA Montant TTC(€)
 *   128,13 20,00 25,63 153,76\tMONTANT TOTAL DE VOTRE AVOIR
 *
 * Les montants sont imprimés POSITIFS (c'est un avoir) ; le signe est posé à
 * l'enregistrement. Selon l'avoir, la décimale est une virgule (« 28,58 ») ou
 * un point (« 0.05 », AVC26_000006).
 *
 * Une ligne désigne soit une FACTURE (« REMISE 1% LGYOUVAP2600000048 »), soit
 * un COLIS par son n° d'expédition sans les zéros de tête (« COLIS 657030 » =
 * « 00657030 » de l'annexe CSV).
 */

const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];

// Montant à 2 décimales, milliers éventuels : « 1 234,56 », « 1.234,56 », « 0.05 »
const AMOUNT_SRC = String.raw`-?\d{1,3}(?:[ .\u00a0\u202f]?\d{3})*[.,]\d{2}`;
const AMOUNT = new RegExp(AMOUNT_SRC, 'g');
// « <libellé> <qté> <PU> € <montant> € » : PU et montant au format strict, sans
// quoi le n° de « COLIS 657030 1 9,21 € » passerait pour la quantité.
const LINE_RE = new RegExp(String.raw`^(.+?)\s+(\d+)\s+(${AMOUNT_SRC})\s*€\s+(${AMOUNT_SRC})\s*€$`);

function parseAmount(s) {
  if (s == null) return null;
  const t = String(s).replace(/[\s\u00a0\u202f€]/g, '');
  const dec = t.match(/[.,](\d{2})$/);
  const n = dec
    ? parseFloat(t.slice(0, -3).replace(/[.,]/g, '') + '.' + dec[1])
    : parseFloat(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

function stripAccents(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, ''); }

// « le 08 octobre 2026 » → « 08/10/2026 »
function parseFrenchDate(text) {
  const m = stripAccents(text).match(/\ble\s+(\d{1,2})\s+([a-z]+)\s+(\d{4})/i);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  if (month < 0) return null;
  return `${m[1].padStart(2, '0')}/${String(month + 1).padStart(2, '0')}/${m[3]}`;
}

function isMondialRelayAvoir(text) {
  return /Avoir\s+n°\s*AVC/i.test(text) || /MONTANT TOTAL DE VOTRE AVOIR/i.test(text);
}

function parseMondialRelayAvoir(text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  const full = lines.join('\n');

  const creditNumber = (full.match(/Avoir\s+n°\s*(AVC[\w-]+)/i) || full.match(/\b(AVC\d{2}_\d+)\b/) || [])[1] || null;
  const clientCode = (full.match(/N° donneur d'ordre\s+([A-Z0-9]+)/i) || [])[1] || null;
  const pays = (full.match(/^Pays de livraison\s+(.+)$/m) || [])[1] || null;
  const dueM = full.match(/Date d'[ée]ch[ée]ance\s+(\d{2})\/(\d{2})\/(\d{2,4})/i);
  const dueDate = dueM ? `${dueM[1]}/${dueM[2]}/${dueM[3].length === 2 ? `20${dueM[3]}` : dueM[3]}` : null;
  const creditDate = parseFrenchDate(full) || dueDate;
  const titleLine = lines.find(l => /^AVOIR\s+/.test(l) && !/VOTRE AVOIR/.test(l));
  const title = titleLine ? titleLine.replace(/^AVOIR\s+/, '').trim() : null;

  // Lignes de détail : entre l'en-tête « Description … Montant » et le pied « Montant HT »
  const start = lines.findIndex(l => /^Description\b.*Montant/i.test(l));
  const end = lines.findIndex((l, i) => i > start && /^Montant\b/i.test(l));
  const invoiceRe = new RegExp(`\\b(${clientCode || 'LG[A-Z]+'}\\d{6,})\\b`);
  const detail = [];
  for (const l of lines.slice(start + 1, end > start ? end : undefined)) {
    const m = l.match(LINE_RE);
    if (!m) continue;
    const label = m[1].trim();
    const colis = label.match(/\bCOLIS\s+(\d{4,})\b/i);
    detail.push({
      label,
      qty: parseInt(m[2], 10),
      pu: parseAmount(m[3]),
      montant: parseAmount(m[4]),
      relatedInvoice: (label.match(invoiceRe) || [])[1] || null,
      tracking: colis ? colis[1].padStart(8, '0') : null,
    });
  }

  // Totaux : 1re ligne de montants après l'en-tête « Montant TTC »
  let totalHT = null, tvaRate = null, totalTVA = null, totalTTC = null;
  const ttcIdx = lines.findIndex(l => /Montant TTC/i.test(l));
  for (const l of ttcIdx >= 0 ? lines.slice(ttcIdx + 1) : []) {
    const nums = l.match(AMOUNT);
    if (nums && nums.length >= 4) {
      [totalHT, tvaRate, totalTVA, totalTTC] = nums.slice(0, 4).map(parseAmount);
      break;
    }
  }

  const linesTotal = round2(detail.reduce((s, d) => s + (d.montant || 0), 0));
  if (totalHT == null && detail.length) totalHT = linesTotal;

  return {
    creditNumber, creditDate, dueDate, title, clientCode, pays,
    lines: detail,
    totalHT, tvaRate, totalTVA, totalTTC,
    linesTotal,
    reconcileOk: totalHT != null && Math.abs(linesTotal - totalHT) < 0.02,
  };
}

module.exports = { parseMondialRelayAvoir, isMondialRelayAvoir, parseAmount };
