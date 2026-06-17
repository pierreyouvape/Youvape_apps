const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_ROOT = '/usr/src/app/uploads/sav';

// Sanitise un nom de fichier : enlève chemins, garde alphanum + . _ -
function safeBasename(name) {
  const base = path.basename(name || 'file');
  return base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'file';
}

// Détecte si un fichier multer est une pièce jointe utile (filtre les champs
// techniques Mailgun comme message-headers, body-mime, etc.).
function isUserAttachment(file) {
  if (!file || !file.originalname) return false;
  // Mailgun nomme les vraies PJ "attachment-N" ; les autres champs (content-id-map,
  // message-headers, body-mime…) n'ont pas de filename ou sont en text/plain inline.
  if (/^attachment-\d+$/i.test(file.fieldname)) return true;
  // Sinon, on garde tout fichier qui a un nom et n'est pas un champ système Mailgun
  const systemFields = new Set([
    'message-headers',
    'body-mime',
    'content-id-map',
    'attachment-count',
    'recipient',
    'sender',
    'from',
    'subject',
    'body-plain',
    'body-html',
    'stripped-text',
    'stripped-html',
    'stripped-signature',
    'timestamp',
    'token',
    'signature',
  ]);
  if (systemFields.has(file.fieldname.toLowerCase())) return false;
  return true;
}

/**
 * Persiste les fichiers multer (memoryStorage) sur disque dans uploads/sav/{ticketId}/.
 * Retourne le tableau d'objets attachment à stocker dans le JSONB messages.
 *
 * Chaque attachment : { filename, original_name, mime, size, url }
 *   - filename     : nom physique sur disque (uuid_safe-name.ext)
 *   - original_name: nom d'origine (affichage)
 *   - mime         : content-type
 *   - size         : octets
 *   - url          : chemin relatif servi par l'API
 */
function saveAttachments(ticketId, files) {
  if (!Array.isArray(files) || files.length === 0) return [];

  const realFiles = files.filter(isUserAttachment);
  if (realFiles.length === 0) return [];

  const dir = path.join(UPLOAD_ROOT, String(ticketId));
  fs.mkdirSync(dir, { recursive: true });

  return realFiles.map((file) => {
    const uuid = crypto.randomUUID();
    const safe = safeBasename(file.originalname);
    const filename = `${uuid}_${safe}`;
    const fullPath = path.join(dir, filename);
    fs.writeFileSync(fullPath, file.buffer);

    return {
      filename,
      original_name: file.originalname,
      mime: file.mimetype,
      size: file.size,
      url: `/api/sav/attachments/${ticketId}/${filename}`,
    };
  });
}

/**
 * Pour les emails entrants reçus en mode "Store and notify" : Mailgun n'envoie
 * pas les fichiers en multipart mais un champ `attachments` (chaîne JSON) avec
 * des URLs vers le stockage Mailgun. On télécharge chaque fichier (auth API key)
 * et on le persiste localement, au même format que saveAttachments().
 *
 * @param {number} ticketId
 * @param {string|Array} attachmentsField  req.body.attachments (string JSON ou array)
 * @returns {Promise<Array>} tableau d'objets attachment stockés
 */
async function saveAttachmentsFromUrls(ticketId, attachmentsField) {
  if (!attachmentsField) return [];

  let list;
  try {
    list = typeof attachmentsField === 'string' ? JSON.parse(attachmentsField) : attachmentsField;
  } catch {
    return [];
  }
  if (!Array.isArray(list) || list.length === 0) return [];

  const apiKey = process.env.MAILGUN_API_KEY;
  if (!apiKey) {
    console.warn('[savAttachments] MAILGUN_API_KEY absent : impossible de télécharger les PJ entrantes');
    return [];
  }
  const auth = 'Basic ' + Buffer.from(`api:${apiKey}`).toString('base64');

  const dir = path.join(UPLOAD_ROOT, String(ticketId));
  fs.mkdirSync(dir, { recursive: true });

  const saved = [];
  for (const att of list) {
    if (!att || !att.url) continue;
    try {
      const res = await fetch(att.url, { headers: { Authorization: auth } });
      if (!res.ok) {
        console.warn(`[savAttachments] Téléchargement PJ échoué (${res.status}) : ${att.url}`);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      const original = att.name || 'piece-jointe';
      const uuid = crypto.randomUUID();
      const safe = safeBasename(original);
      const filename = `${uuid}_${safe}`;
      fs.writeFileSync(path.join(dir, filename), buffer);

      saved.push({
        filename,
        original_name: original,
        mime: att['content-type'] || 'application/octet-stream',
        size: att.size || buffer.length,
        url: `/api/sav/attachments/${ticketId}/${filename}`,
      });
    } catch (e) {
      console.warn(`[savAttachments] Erreur PJ entrante (${att.url}) :`, e.message);
    }
  }
  return saved;
}

/**
 * Pour les formulaires Gravity Forms : le champ upload renvoie une chaîne JSON
 * contenant un tableau d'URLs publiques vers le serveur WP, ex :
 *   '["https://www.youvape.fr/wp-content/uploads/gravity_forms/.../photo.jpg"]'
 * On télécharge chaque fichier (URL publique, pas d'auth) et on le persiste
 * localement, au même format que saveAttachments().
 *
 * @param {number} ticketId
 * @param {string|Array} urlsField  valeur brute du champ upload GF
 * @returns {Promise<Array>} tableau d'objets attachment stockés
 */
async function saveAttachmentsFromPublicUrls(ticketId, urlsField) {
  if (!urlsField) return [];

  let urls;
  try {
    urls = typeof urlsField === 'string' ? JSON.parse(urlsField) : urlsField;
  } catch {
    // Champ avec une seule URL non encodée en JSON
    urls = typeof urlsField === 'string' ? [urlsField] : [];
  }
  if (!Array.isArray(urls)) urls = [urls];
  urls = urls.filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u));
  if (urls.length === 0) return [];

  const dir = path.join(UPLOAD_ROOT, String(ticketId));
  fs.mkdirSync(dir, { recursive: true });

  const saved = [];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[savAttachments] Téléchargement PJ GF échoué (${res.status}) : ${url}`);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      const original = decodeURIComponent(path.basename(new URL(url).pathname)) || 'piece-jointe';
      const uuid = crypto.randomUUID();
      const safe = safeBasename(original);
      const filename = `${uuid}_${safe}`;
      fs.writeFileSync(path.join(dir, filename), buffer);

      saved.push({
        filename,
        original_name: original,
        mime: res.headers.get('content-type') || 'application/octet-stream',
        size: Number(res.headers.get('content-length')) || buffer.length,
        url: `/api/sav/attachments/${ticketId}/${filename}`,
      });
    } catch (e) {
      console.warn(`[savAttachments] Erreur PJ GF (${url}) :`, e.message);
    }
  }
  return saved;
}

/**
 * Pour les réponses sortantes : retourne les fichiers au format attendu par
 * mailgun.js (champ "attachment" avec data + filename).
 */
function toMailgunAttachments(files) {
  if (!Array.isArray(files) || files.length === 0) return [];
  return files.map((file) => ({
    filename: safeBasename(file.originalname),
    data: file.buffer,
    contentType: file.mimetype,
  }));
}

module.exports = {
  UPLOAD_ROOT,
  saveAttachments,
  saveAttachmentsFromUrls,
  saveAttachmentsFromPublicUrls,
  toMailgunAttachments,
  safeBasename,
};
