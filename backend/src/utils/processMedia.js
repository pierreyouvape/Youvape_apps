const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Volume Docker `process_uploads` (cf. docker-compose.yml), même principe que
// les pièces jointes SAV : le contenu survit aux rebuilds du conteneur.
const UPLOAD_ROOT = '/usr/src/app/uploads/process';

const MAX_IMAGE_SIZE = 15 * 1024 * 1024; // 15 Mo

// Sanitise un nom de fichier : enlève les chemins, garde alphanum + . _ -
function safeBasename(name) {
  const base = path.basename(name || 'image');
  return base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'image';
}

/**
 * Persiste une image multer (memoryStorage) dans uploads/process/<processId>/.
 * Retourne l'objet à stocker dans le JSONB `images` de l'étape.
 *
 * Le nom physique est préfixé d'un UUID : deux captures d'écran nommées
 * « Capture d'écran 2026-09-01.png » ne s'écrasent donc jamais.
 */
function saveImage(processId, file) {
  if (!file || !file.buffer) return null;

  const dir = path.join(UPLOAD_ROOT, String(processId));
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${crypto.randomUUID()}_${safeBasename(file.originalname)}`;
  fs.writeFileSync(path.join(dir, filename), file.buffer);

  return {
    filename,
    original_name: file.originalname,
    mime: file.mimetype,
    size: file.size,
    url: `/api/process/media/${processId}/${filename}`,
  };
}

/* ─── Signature des URLs média ────────────────────────────────────────────────
 *
 * Un process peut être confidentiel, or une balise <img> ne peut pas porter
 * d'en-tête Authorization : la route média reste donc ouverte. Un nom de
 * fichier en UUID n'est pas un contrôle d'accès — une URL recopiée resterait
 * valable indéfiniment.
 *
 * D'où un lien signé : l'URL n'est valable que pour ce fichier, et elle expire.
 * La clé dérive de JWT_SECRET (déjà présent, aucune variable d'env à ajouter),
 * via un HMAC étiqueté pour qu'elle ne serve à rien d'autre.
 * ────────────────────────────────────────────────────────────────────────── */

const MEDIA_URL_TTL = 12 * 60 * 60; // 12 h — une session de lecture confortable

function mediaKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET manquant : impossible de signer les URLs média');
  return crypto.createHmac('sha256', secret).update('process-media-v1').digest();
}

function computeSignature(processId, filename, exp) {
  return crypto
    .createHmac('sha256', mediaKey())
    .update(`${processId}:${filename}:${exp}`)
    .digest('hex')
    .slice(0, 32);
}

/** Chemin nu (celui stocké en base) → chemin signé, valable MEDIA_URL_TTL. */
function signMediaUrl(url) {
  // La signature éventuellement présente est ignorée puis remplacée : le front
  // nous renvoie parfois une URL déjà signée, il ne faut pas la reconduire.
  const bare = String(url || '').split('?')[0];
  const match = /^\/api\/process\/media\/(\d+)\/([A-Za-z0-9._-]+)$/.exec(bare);
  if (!match) return url; // format inattendu : on laisse tel quel plutôt que de casser l'affichage
  const [, processId, filename] = match;
  const exp = Math.floor(Date.now() / 1000) + MEDIA_URL_TTL;
  return `${bare}?exp=${exp}&sig=${computeSignature(processId, filename, exp)}`;
}

const signImages = (images) =>
  (Array.isArray(images) ? images.map((img) => ({ ...img, url: signMediaUrl(img.url) })) : []);

/**
 * Signe les images d'un tableau d'étapes, sous-étapes comprises.
 * Copie : l'entrée n'est pas mutée.
 */
function signStepImages(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.map((step) => ({
    ...step,
    images: signImages(step.images),
    substeps: Array.isArray(step.substeps)
      ? step.substeps.map((sub) => ({ ...sub, images: signImages(sub.images) }))
      : [],
  }));
}

/** Vérifie une signature d'URL média. Refuse aussi bien l'invalide que l'expiré. */
function verifyMediaSignature(processId, filename, exp, sig) {
  const expNum = parseInt(exp, 10);
  if (!Number.isInteger(expNum) || expNum < Math.floor(Date.now() / 1000)) return false;
  const expected = computeSignature(processId, filename, expNum);
  const a = Buffer.from(String(sig || ''), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Résout le chemin disque d'une image en refusant tout ce qui sortirait de
 * UPLOAD_ROOT (path traversal). Retourne null si le fichier est introuvable
 * ou si les paramètres ne sont pas dans la whitelist.
 */
function resolveImagePath(processId, filename) {
  if (!/^\d+$/.test(String(processId)) || !/^[A-Za-z0-9._-]+$/.test(String(filename))) {
    return null;
  }
  const resolved = path.resolve(path.join(UPLOAD_ROOT, String(processId), filename));
  if (!resolved.startsWith(path.resolve(UPLOAD_ROOT) + path.sep)) return null;
  if (!fs.existsSync(resolved)) return null;
  return resolved;
}

/**
 * Supprime tout le dossier d'images d'un process.
 *
 * Appelé UNIQUEMENT à la suppression du process : à l'édition, une image
 * retirée d'une étape reste sur le disque, car les versions précédentes la
 * référencent encore et doivent rester restaurables.
 */
function removeProcessDir(processId) {
  if (!/^\d+$/.test(String(processId))) return;
  try {
    const dir = path.resolve(path.join(UPLOAD_ROOT, String(processId)));
    if (!dir.startsWith(path.resolve(UPLOAD_ROOT) + path.sep)) return;
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    console.warn('[Process] suppression du dossier images échouée:', e.message);
  }
}

module.exports = {
  UPLOAD_ROOT, MAX_IMAGE_SIZE, MEDIA_URL_TTL,
  saveImage, resolveImagePath, removeProcessDir,
  signMediaUrl, signStepImages, verifyMediaSignature,
};
