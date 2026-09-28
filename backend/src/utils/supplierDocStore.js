/**
 * Rangement des factures et avoirs fournisseur sur disque.
 *
 * Règle posée par Pierre le 28/09/2026 : « chaque facture et avoir doit être
 * stocké pour pouvoir être retéléchargé à souhait ». Le fichier d'origine est
 * donc conservé tel quel, jamais régénéré — c'est la pièce comptable, et c'est
 * elle qu'on ressortira en cas de litige, pas une reconstitution.
 *
 * Même dispositif que les pièces jointes du SAV : un volume Docker monté sur
 * `/usr/src/app/uploads`, qui survit aux reconstructions d'image. Le chemin
 * stocké en base est RELATIF à cette racine, pour que déplacer le volume ne
 * casse rien.
 *
 * Le nom physique est préfixé d'un identifiant aléatoire : deux fournisseurs
 * peuvent très bien envoyer deux « facture.pdf », et un nom deviné depuis
 * l'extérieur ne doit pas permettre de tomber sur le document d'un autre.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_ROOT = process.env.SUPPLIER_DOCS_ROOT || '/usr/src/app/uploads/supplier_docs';

/** Nom de fichier sûr : ni chemin, ni caractère exotique. */
function safeBasename(name) {
  const base = path.basename(name || 'document.pdf');
  return base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'document.pdf';
}

/**
 * Écrit le document et renvoie son chemin RELATIF, à stocker en base.
 * @returns {{ filePath: string, originalName: string, size: number }}
 */
function saveDocument({ supplierId, buffer, originalName }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Document vide');
  }
  const dir = path.join(UPLOAD_ROOT, String(supplierId));
  fs.mkdirSync(dir, { recursive: true });

  const safe = safeBasename(originalName);
  const filename = `${crypto.randomUUID()}-${safe}`;
  fs.writeFileSync(path.join(dir, filename), buffer);

  return {
    filePath: path.join(String(supplierId), filename),
    originalName: safe,
    size: buffer.length,
  };
}

/**
 * Chemin absolu d'un document rangé, ou null s'il a disparu.
 * Refuse tout chemin qui sortirait de la racine (`../`), même venu de la base.
 */
function resolveDocument(filePath) {
  if (!filePath) return null;
  const absolute = path.resolve(UPLOAD_ROOT, filePath);
  if (!absolute.startsWith(path.resolve(UPLOAD_ROOT) + path.sep)) return null;
  return fs.existsSync(absolute) ? absolute : null;
}

/** Supprime le fichier d'un document (suppression d'un dépôt erroné). */
function removeDocument(filePath) {
  const absolute = resolveDocument(filePath);
  if (!absolute) return false;
  fs.unlinkSync(absolute);
  return true;
}

module.exports = { saveDocument, resolveDocument, removeDocument, safeBasename, UPLOAD_ROOT };
