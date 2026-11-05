/**
 * Lecture d'un CSV quelconque (export Probance) en gardant chaque ligne TELLE QUELLE.
 *
 * Le fichier est décodé en latin1 : un caractère = un octet, donc
 * `Buffer.from(texte, 'latin1')` redonne exactement les octets d'origine, quel que soit
 * l'encodage réel (UTF-8 avec ou sans BOM, Windows-1252). On ne réécrit rien : le
 * fichier nettoyé garde les colonnes, l'ordre, les guillemets et l'encodage de Probance.
 * Les adresses e-mail sont en ASCII : les lire en latin1 est sans risque.
 *
 * Exception : l'UTF-16 (export Excel « Texte Unicode », certains exports Probance),
 * où chaque caractère ASCII est suivi d'un octet nul. Lu en latin1, l'adresse gardait
 * ses octets nuls et PostgreSQL refusait la requête (« Erreur serveur » le 05/11/2026).
 * Il est décodé comme tel et réécrit en UTF-16 avec son BOM.
 */

/** 'utf16le' | 'utf16be' | 'latin1' (= octets bruts, tout le reste). */
function detectEncoding(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return 'utf16le';
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return 'utf16be';
  // Sans BOM : beaucoup d'octets nuls aux positions impaires (ou paires) = UTF-16.
  const n = Math.min(buffer.length, 2000);
  let odd = 0;
  let even = 0;
  for (let i = 0; i < n; i++) {
    if (buffer[i] === 0) { if (i % 2) odd++; else even++; }
  }
  if (odd > n / 4) return 'utf16le';
  if (even > n / 4) return 'utf16be';
  return 'latin1';
}

const swap16 = (buf) => {
  const b = Buffer.from(buf.length % 2 ? buf.subarray(0, buf.length - 1) : buf);
  return b.swap16();
};
const BOM = String.fromCharCode(0xfeff);
const stripBom = (t) => (t.startsWith(BOM) ? t.slice(1) : t);

function decode(buffer, encoding) {
  if (encoding === 'utf16le') return stripBom(buffer.toString('utf16le'));
  if (encoding === 'utf16be') return stripBom(swap16(buffer).toString('utf16le'));
  return buffer.toString('latin1');
}

function encode(text, encoding) {
  if (encoding === 'utf16le') return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  if (encoding === 'utf16be') return Buffer.concat([Buffer.from([0xfe, 0xff]), swap16(Buffer.from(text, 'utf16le'))]);
  return Buffer.from(text, 'latin1');
}

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

// BOM (UTF-8 lu en latin1 ou UTF-16), octets nuls et espaces invisibles retirés :
// PostgreSQL refuse un texte qui contient un octet nul.
const normEmail = (s) => String(s || '').replace(/^\uFEFF|^\u00EF\u00BB\u00BF/, '').replace(/[\u0000\u200B]/g, '').trim().toLowerCase();

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
  const encoding = detectEncoding(buffer);
  const text = decode(buffer, encoding);
  const delimiter = detectDelimiter(text);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const records = parseRecords(text, delimiter);
  if (records.length === 0) throw new Error('Fichier vide');
  const found = findEmailColumn(records);
  if (!found) throw new Error("Aucune colonne d'adresses e-mail trouvée dans le fichier");
  const header = found.hasHeader ? records[0] : null;
  const body = found.hasHeader ? records.slice(1) : records;
  return {
    encoding,
    delimiter,
    eol,
    header: header ? header.raw : null,
    emailColumn: header ? header.fields[found.col].replace(/^\uFEFF|^\u00EF\u00BB\u00BF/, '') : `colonne ${found.col + 1}`,
    rows: body.map((r) => ({ raw: r.raw, email: normEmail(r.fields[found.col]) })),
  };
}

/** Recompose le fichier (mêmes octets que l'original pour chaque ligne gardée). */
function writeCsv({ header, eol, rows, encoding = 'latin1' }) {
  const lines = header !== null ? [header] : [];
  for (const r of rows) lines.push(r.raw);
  return encode(lines.join(eol) + eol, encoding);
}

module.exports = { readCsv, writeCsv, detectDelimiter, detectEncoding, parseRecords, EMAIL_RE };
