/**
 * Lecture d'un CSV quelconque (export Probance) en gardant chaque ligne TELLE QUELLE.
 *
 * Le fichier est décodé en latin1 : un caractère = un octet, donc
 * `Buffer.from(texte, 'latin1')` redonne exactement les octets d'origine, quel que soit
 * l'encodage réel (UTF-8 avec ou sans BOM, Windows-1252). On ne réécrit rien : le
 * fichier nettoyé garde les colonnes, l'ordre, les guillemets et l'encodage de Probance.
 * Les adresses e-mail sont en ASCII : les lire en latin1 est sans risque.
 */

const EMAIL_RE = /^[^\s@;,"]+@[^\s@;,"]+\.[^\s@;,"]+$/;

/** Séparateur le plus fréquent hors guillemets sur la 1re ligne. */
function detectDelimiter(text) {
  const counts = { ';': 0, ',': 0, '\t': 0, '|': 0 };
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n' || ch === '\r')) break;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ';';
}

/**
 * Découpe en enregistrements : { raw, fields }. `raw` est le texte exact de la ligne
 * (fin de ligne exclue), un champ entre guillemets peut contenir un retour à la ligne.
 */
function parseRecords(text, delimiter) {
  const records = [];
  let fields = [];
  let field = '';
  let inQuotes = false;
  let start = 0;
  let i = 0;
  const pushRecord = (end) => {
    fields.push(field);
    const raw = text.slice(start, end);
    if (raw.length > 0) records.push({ raw, fields });
    fields = [];
    field = '';
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false;
      } else {
        field += ch;
      }
      i++;
      continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === delimiter) { fields.push(field); field = ''; i++; continue; }
    if (ch === '\r' || ch === '\n') {
      pushRecord(i);
      if (ch === '\r' && text[i + 1] === '\n') i++;
      i++;
      start = i;
      continue;
    }
    field += ch;
    i++;
  }
  if (start < text.length) pushRecord(text.length);
  return records;
}

const normEmail = (s) => String(s || '').replace(/^﻿|^ï»¿/, '').trim().toLowerCase();

/**
 * Colonne e-mail = celle dont le plus de valeurs ressemblent à une adresse
 * (sur les 500 premières lignes). En tête de fichier si sa 1re valeur n'en est pas une.
 */
function findEmailColumn(records) {
  const sample = records.slice(0, 500);
  const width = Math.max(0, ...sample.map((r) => r.fields.length));
  let best = { col: -1, share: 0 };
  for (let c = 0; c < width; c++) {
    let hits = 0;
    for (const r of sample) if (EMAIL_RE.test(normEmail(r.fields[c]))) hits++;
    const share = hits / sample.length;
    if (share > best.share) best = { col: c, share };
  }
  if (best.col < 0 || best.share < 0.5) return null;
  const hasHeader = !EMAIL_RE.test(normEmail(records[0].fields[best.col]));
  return { col: best.col, hasHeader };
}

/**
 * @param {Buffer} buffer le fichier reçu
 * @returns {{ delimiter, eol, header, rows: [{raw, email}], emailColumn }}
 */
function readCsv(buffer) {
  const text = buffer.toString('latin1');
  const delimiter = detectDelimiter(text);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const records = parseRecords(text, delimiter);
  if (records.length === 0) throw new Error('Fichier vide');
  const found = findEmailColumn(records);
  if (!found) throw new Error("Aucune colonne d'adresses e-mail trouvée dans le fichier");
  const header = found.hasHeader ? records[0] : null;
  const body = found.hasHeader ? records.slice(1) : records;
  return {
    delimiter,
    eol,
    header: header ? header.raw : null,
    emailColumn: header ? header.fields[found.col].replace(/^ï»¿|^﻿/, '') : `colonne ${found.col + 1}`,
    rows: body.map((r) => ({ raw: r.raw, email: normEmail(r.fields[found.col]) })),
  };
}

/** Recompose le fichier (mêmes octets que l'original pour chaque ligne gardée). */
function writeCsv({ header, eol, rows }) {
  const lines = header !== null ? [header] : [];
  for (const r of rows) lines.push(r.raw);
  return Buffer.from(lines.join(eol) + eol, 'latin1');
}

module.exports = { readCsv, writeCsv, detectDelimiter, parseRecords, EMAIL_RE };
