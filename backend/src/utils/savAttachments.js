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
  toMailgunAttachments,
  safeBasename,
};
