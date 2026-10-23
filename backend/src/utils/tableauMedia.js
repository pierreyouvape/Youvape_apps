const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isHeic } = require('./heicConvert');

/**
 * Images de l'app Tableau : posées seules sur le tableau, ou dans le texte d'un
 * post-it (<img src="/api/tableau/media/<fichier>">).
 *
 * Volume Docker `tableau_uploads` (cf. docker-compose.yml) : le contenu survit
 * aux rebuilds. Un seul dossier : un post-it change de propriétaire quand il est
 * envoyé, ses fichiers ne bougent pas. Nom en UUID, extension d'après le type.
 *
 * Même principe de liens signés que l'app Process (utils/processMedia.js) : une
 * balise <img> ne porte pas d'en-tête Authorization, la route média est donc
 * ouverte, et c'est la signature (fichier + expiration) qui tient lieu d'accès.
 * Chemin nu en base, signé à la lecture.
 */

const UPLOAD_ROOT = '/usr/src/app/uploads/tableau';
const MAX_IMAGE_SIZE = 15 * 1024 * 1024; // 15 Mo, comme l'app Process
// Long : un onglet Tableau reste ouvert toute la journée, et les liens ne sont
// re-signés qu'à la relecture du tableau.
const MEDIA_URL_TTL = 7 * 24 * 60 * 60;

// Pas de SVG : il peut porter du script.
const EXT_BY_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
};
const FILENAME_RE = /^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/;
const MEDIA_PREFIX = '/api/tableau/media/';

/** Accepte une image multer (memoryStorage). Lève une erreur 400 sinon. */
async function saveImage(file) {
  const fail = (msg) => { const e = new Error(msg); e.statusCode = 400; throw e; };
  if (!file?.buffer) fail('Image requise');

  let { buffer } = file;
  let mime = (file.mimetype || '').toLowerCase();
  // Photo d'iPhone : convertie une fois pour toutes, le navigateur ne sait pas l'afficher
  if (isHeic(mime, file.originalname)) {
    buffer = await require('heic-convert')({ buffer, format: 'JPEG', quality: 0.85 });
    mime = 'image/jpeg';
  }
  const ext = EXT_BY_MIME[mime];
  if (!ext) fail('Format d\'image non pris en charge (JPG, PNG, WebP, GIF ou HEIC)');

  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
  const filename = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_ROOT, filename), buffer);
  return filename;
}

/** Double un fichier (copie de post-it : chacun son exemplaire). */
function copyFile(filename) {
  if (!FILENAME_RE.test(filename)) return null;
  const src = path.join(UPLOAD_ROOT, filename);
  if (!fs.existsSync(src)) return null;
  const copy = `${crypto.randomUUID()}${path.extname(filename)}`;
  fs.copyFileSync(src, path.join(UPLOAD_ROOT, copy));
  return copy;
}

function removeFiles(filenames) {
  for (const f of filenames) {
    if (!FILENAME_RE.test(f || '')) continue;
    try { fs.rmSync(path.join(UPLOAD_ROOT, f), { force: true }); } catch (e) {
      console.warn('[Tableau] suppression image échouée:', e.message);
    }
  }
}

function resolvePath(filename) {
  if (!FILENAME_RE.test(String(filename))) return null;
  const resolved = path.join(UPLOAD_ROOT, filename);
  return fs.existsSync(resolved) ? resolved : null;
}

/* ─── Signature ─────────────────────────────────────────── */

const mediaKey = () => crypto.createHmac('sha256', process.env.JWT_SECRET).update('tableau-media-v1').digest();
const signature = (filename, exp) =>
  crypto.createHmac('sha256', mediaKey()).update(`${filename}:${exp}`).digest('hex').slice(0, 32);

/** Fichier → URL signée. */
function signedUrl(filename) {
  if (!filename) return null;
  const exp = Math.floor(Date.now() / 1000) + MEDIA_URL_TTL;
  return `${MEDIA_PREFIX}${filename}?exp=${exp}&sig=${signature(filename, exp)}`;
}

function verify(filename, exp, sig) {
  const expNum = parseInt(exp, 10);
  if (!Number.isInteger(expNum) || expNum < Math.floor(Date.now() / 1000)) return false;
  const a = Buffer.from(String(sig || ''));
  const b = Buffer.from(signature(filename, expNum));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ─── Images dans le texte d'un post-it ─────────────────── */

// L'éditeur encode le « & » de la signature en « &amp; » : on capture la query
// jusqu'au guillemet. L'origine éventuelle (https://apps…) est retirée.
const BODY_SRC = /(<img\b[^>]*?\bsrc=")(?:https?:\/\/[^/"]+)?\/api\/tableau\/media\/([0-9a-f-]{36}\.(?:jpg|png|webp|gif))(?:\?[^"]*)?"/g;

const stripSignatures = (html) => String(html || '').replace(BODY_SRC, `$1${MEDIA_PREFIX}$2"`);
const signHtml = (html) =>
  String(html || '').replace(BODY_SRC, (_m, start, f) => `${start}${signedUrl(f).replace(/&/g, '&amp;')}"`);
const htmlFiles = (html) => [...String(html || '').matchAll(BODY_SRC)].map((m) => m[2]);

/** Le HTML d'un post-it avec chaque image remplacée par une copie du fichier. */
function copyHtmlImages(html) {
  const map = new Map();
  for (const f of htmlFiles(html)) if (!map.has(f)) map.set(f, copyFile(f));
  return {
    html: String(html || '').replace(BODY_SRC, (m, start, f) => (map.get(f) ? `${start}${MEDIA_PREFIX}${map.get(f)}"` : m)),
    files: [...map.values()].filter(Boolean),
  };
}

/**
 * Post-its écrits avant le texte enrichi : du texte brut. Converti à la lecture
 * (retours à la ligne gardés), réécrit en HTML au premier enregistrement.
 */
function asHtml(content) {
  const s = String(content || '');
  if (!s || /^\s*</.test(s)) return s;
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<p>${esc.replace(/\n/g, '<br>')}</p>`;
}

/**
 * Fichiers sans référence depuis plus d'un jour : image retirée du texte d'un
 * post-it, copie refusée… On ne supprime pas à l'enregistrement : un Cmd+Z dans
 * le post-it ramènerait une image dont le fichier n'existe plus.
 */
function sweep(referenced) {
  if (!fs.existsSync(UPLOAD_ROOT)) return 0;
  const limit = Date.now() - 24 * 60 * 60 * 1000;
  const orphans = fs.readdirSync(UPLOAD_ROOT).filter((f) => FILENAME_RE.test(f) && !referenced.has(f)
    && fs.statSync(path.join(UPLOAD_ROOT, f)).mtimeMs < limit);
  removeFiles(orphans);
  return orphans.length;
}

module.exports = {
  MAX_IMAGE_SIZE,
  saveImage, removeFiles, resolvePath, signedUrl, verify,
  stripSignatures, signHtml, htmlFiles, copyHtmlImages, asHtml, sweep,
};
