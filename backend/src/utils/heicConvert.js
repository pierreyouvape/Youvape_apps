const fs = require('fs');
const path = require('path');

// Cache disque des JPEG convertis, à côté des HEIC d'origine.
// Le fichier converti est nommé "<heic>.jpg" pour rester déterministe.
const CACHE_SUFFIX = '.jpg';

// Détecte un HEIC/HEIF par mime ou extension (Mailgun envoie parfois
// application/octet-stream pour les .heic).
function isHeic(mime, filename) {
  const m = (mime || '').toLowerCase();
  if (m === 'image/heic' || m === 'image/heif') return true;
  const ext = path.extname(filename || '').toLowerCase();
  return ext === '.heic' || ext === '.heif';
}

/**
 * Convertit un fichier HEIC en JPEG, avec cache disque.
 * Retourne le chemin du JPEG (depuis le cache si déjà converti).
 * Lève une erreur si la conversion échoue (le caller gère le fallback).
 *
 * @param {string} heicPath chemin absolu du fichier HEIC source
 * @returns {Promise<string>} chemin absolu du JPEG converti
 */
async function heicToJpegCached(heicPath) {
  const cachePath = heicPath + CACHE_SUFFIX;

  // Cache valide si présent et plus récent que la source.
  if (fs.existsSync(cachePath)) {
    const srcStat = fs.statSync(heicPath);
    const cacheStat = fs.statSync(cachePath);
    if (cacheStat.mtimeMs >= srcStat.mtimeMs && cacheStat.size > 0) {
      return cachePath;
    }
  }

  // heic-convert est pur JS (libheif WASM) — pas de dépendance système,
  // fonctionne tel quel dans le container.
  const convert = require('heic-convert');
  const inputBuffer = fs.readFileSync(heicPath);
  const outputBuffer = await convert({
    buffer: inputBuffer,
    format: 'JPEG',
    quality: 0.85,
  });

  // Écriture atomique (tmp + rename) pour éviter de servir un fichier partiel
  // si deux requêtes convertissent en parallèle.
  const tmpPath = `${cachePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, outputBuffer);
  fs.renameSync(tmpPath, cachePath);

  return cachePath;
}

module.exports = { isHeic, heicToJpegCached, CACHE_SUFFIX };
