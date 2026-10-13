/**
 * Cloudflare R2 (API compatible S3) — stockage des stories et vidéos.
 *
 * Deux buckets, dans le compte Cloudflare de l'agence (là où vit la zone
 * youvape.fr, condition pour y rattacher videos.youvape.fr) :
 *  - R2_BUCKET_SOURCES (privé) : vidéos d'origine, 180-200 Mo, jamais exposées ;
 *  - R2_BUCKET_PUBLIC  (public) : fichiers diffusés, servis par R2_PUBLIC_BASE_URL.
 *
 * Les sources partent du navigateur vers R2 par une URL signée : le VPS ne
 * reçoit jamais 200 Mo en HTTP (le nginx du front plafonne à 30 Mo). Cela exige
 * une règle CORS sur le bucket des sources pour l'origine apps.youvape.fr —
 * elle se pose dans le tableau de bord Cloudflare, le jeton de l'app (« Object
 * Read & Write ») n'a pas le droit de modifier la configuration d'un bucket.
 */
const fs = require('fs');
const { pipeline } = require('stream/promises');
const {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const REQUIRED = ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_PUBLIC', 'R2_BUCKET_SOURCES', 'R2_PUBLIC_BASE_URL'];

let client = null;

/** Variables manquantes : l'app répond une erreur claire au lieu d'un 500 opaque. */
const missingConfig = () => REQUIRED.filter((k) => !process.env[k]);

const getClient = () => {
  const missing = missingConfig();
  if (missing.length) {
    throw new Error(`Configuration R2 incomplète dans .env : ${missing.join(', ')}`);
  }
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      // Les SDK récents ajoutent une somme de contrôle CRC32 à chaque envoi, que
      // R2 ne vérifie pas dans une URL signée : sans ces deux réglages, l'envoi
      // depuis le navigateur échoue en 403 (signature qui ne correspond plus).
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }
  return client;
};

const buckets = () => ({
  sources: process.env.R2_BUCKET_SOURCES,
  public: process.env.R2_BUCKET_PUBLIC,
});

/** URL publique d'un fichier du bucket public (null si pas de clé). */
const publicUrl = (key) => {
  if (!key) return null;
  return `${process.env.R2_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
};

/** URL signée d'envoi direct (PUT) d'une source, valable `expiresIn` secondes. */
const presignSourceUpload = async (key, contentType, expiresIn = 3600) => {
  const command = new PutObjectCommand({
    Bucket: buckets().sources,
    Key: key,
    ContentType: contentType || 'application/octet-stream',
  });
  return getSignedUrl(getClient(), command, { expiresIn });
};

/** Métadonnées d'une source (taille réelle reçue), null si absente. */
const headSource = async (key) => {
  try {
    const res = await getClient().send(new HeadObjectCommand({ Bucket: buckets().sources, Key: key }));
    return { size: Number(res.ContentLength) || 0, contentType: res.ContentType || null };
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return null;
    throw err;
  }
};

/** Télécharge une source vers un fichier local (en flux, sans tout charger en mémoire). */
const downloadSource = async (key, destPath) => {
  const res = await getClient().send(new GetObjectCommand({ Bucket: buckets().sources, Key: key }));
  await pipeline(res.Body, fs.createWriteStream(destPath));
};

/**
 * Publie un fichier local dans le bucket public, en cache immuable : le nom
 * porte la version, donc un fichier publié ne change jamais de contenu.
 */
const uploadPublic = async (key, filePath, contentType) => {
  const { size } = await fs.promises.stat(filePath);
  await getClient().send(new PutObjectCommand({
    Bucket: buckets().public,
    Key: key,
    Body: fs.createReadStream(filePath),
    ContentLength: size,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return size;
};

/**
 * Écrit un contenu (JSON de publication) dans le bucket public. Ces fichiers
 * sont RÉÉCRITS à chaque publication, donc cache court, jamais immuable.
 */
const putPublicObject = async (key, body, contentType, cacheControl = 'public, max-age=60') => {
  await getClient().send(new PutObjectCommand({
    Bucket: buckets().public,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: cacheControl,
  }));
};

module.exports = {
  missingConfig,
  publicUrl,
  presignSourceUpload,
  headSource,
  downloadSource,
  uploadPublic,
  putPublicObject,
};
