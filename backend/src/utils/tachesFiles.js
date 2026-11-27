const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isHeic } = require('./heicConvert');

/**
 * Pièces jointes des commentaires de l'app Tâches : capture d'écran collée
 * (Ctrl+V / Cmd+V) ou fichier choisi sur le poste, comme sur Monday.
 *
 * Volume Docker `taches_uploads` (cf. docker-compose.yml) : le contenu survit
 * aux rebuilds. Nom en UUID, extension d'après le CONTENU contrôlé, jamais
 * d'après le type annoncé par le navigateur. Le nom d'origine est gardé en base
 * (`taches_comments.files`) pour le téléchargement.
 *
 * Pas de lien public ni signé : la route de lecture exige la session et le
 * droit `taches`, l'écran récupère le fichier par axios (blob).
 */

const UPLOAD_ROOT = process.env.TACHES_UPLOAD_ROOT || '/usr/src/app/uploads/taches';
const MAX_SIZE = 25 * 1024 * 1024; // sous la limite nginx (30 Mo)
const MAX_FILES = 10;

const fail = (msg) => { const e = new Error(msg); e.statusCode = 400; throw e; };

const ZIP = (b) => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
const OLE = (b) => b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
const TEXT = (b) => !b.subarray(0, 65536).includes(0);
const PDF = (b) => b.subarray(0, 5).toString('latin1') === '%PDF-';

// Pas de SVG ni de HTML : ils peuvent porter du script.
const IMAGE_SIGS = {
  png: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  gif: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8',
  webp: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};
const DOC_SIGS = {
  pdf: PDF, csv: TEXT, txt: TEXT, xls: OLE, doc: OLE, ppt: OLE,
  xlsx: ZIP, docx: ZIP, pptx: ZIP, ods: ZIP, odt: ZIP, zip: ZIP,
};
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
};
const FILENAME_RE = /^[0-9a-f-]{36}\.(png|jpg|gif|webp|pdf|csv|txt|xls|doc|ppt|xlsx|docx|pptx|ods|odt|zip)$/;

const cleanName = (name) => String(name || 'fichier').replace(/[\\/\0\r\n]/g, '_').slice(0, 200) || 'fichier';

function write(buffer, ext) {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
  const filename = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_ROOT, filename), buffer);
  return filename;
}

/** Un fichier multer (memoryStorage) → { file, name, size, kind: 'image' | 'file' }. */
async function saveOne(f) {
  if (!f?.buffer?.length) fail('Fichier vide');
  if (f.buffer.length > MAX_SIZE) fail(`« ${cleanName(f.originalname)} » est trop lourd (25 Mo maximum)`);
  let buffer = f.buffer;
  let name = cleanName(f.originalname);
  // Photo d'iPhone : convertie, le navigateur ne sait pas l'afficher.
  if (isHeic((f.mimetype || '').toLowerCase(), f.originalname)) {
    buffer = await require('heic-convert')({ buffer, format: 'JPEG', quality: 0.85 });
    name = name.replace(/\.hei[cf]$/i, '') + '.jpg';
  }
  const image = Object.keys(IMAGE_SIGS).find((ext) => IMAGE_SIGS[ext](buffer));
  if (image) return { file: write(buffer, image), name, size: buffer.length, kind: 'image' };
  const m = /\.([a-z0-9]+)$/i.exec(name);
  const ext = m && m[1].toLowerCase();
  if (!ext || !DOC_SIGS[ext]) {
    fail(`« ${name} » : format non pris en charge (images, PDF, Word, Excel, PowerPoint, CSV, texte ou ZIP)`);
  }
  if (!DOC_SIGS[ext](buffer)) fail(`« ${name} » n'est pas un .${ext} valide`);
  return { file: write(buffer, ext), name, size: buffer.length, kind: 'file' };
}

/** Enregistre tout ou rien : un fichier refusé efface ceux déjà écrits. */
async function saveFiles(files = []) {
  if (files.length > MAX_FILES) fail(`${MAX_FILES} fichiers maximum par commentaire`);
  const saved = [];
  try {
    for (const f of files) saved.push(await saveOne(f));
  } catch (e) {
    removeFiles(saved.map((s) => s.file));
    throw e;
  }
  return saved;
}

function removeFiles(filenames) {
  for (const f of filenames) {
    if (!FILENAME_RE.test(f || '')) continue;
    try { fs.rmSync(path.join(UPLOAD_ROOT, f), { force: true }); } catch (e) {
      console.warn('[Tâches] suppression de fichier échouée :', e.message);
    }
  }
}

function resolvePath(filename) {
  if (!FILENAME_RE.test(String(filename))) return null;
  const p = path.join(UPLOAD_ROOT, filename);
  return fs.existsSync(p) ? p : null;
}

/** Type servi : les images et PDF s'affichent, le reste se télécharge. */
const contentType = (filename) => MIME[path.extname(filename).slice(1)] || 'application/octet-stream';

module.exports = { saveFiles, removeFiles, resolvePath, contentType, MAX_SIZE, MAX_FILES };
