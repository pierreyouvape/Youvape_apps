const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const savMacroModel = require('../models/savMacroModel');

const MACRO_UPLOAD_ROOT = '/usr/src/app/uploads/sav_macros';

function safeBasename(name) {
  const base = path.basename(name || 'file');
  return base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'file';
}

// Stocke un buffer multer sur disque dans uploads/sav_macros/<macro_id>/
// Retourne l'objet attachment à persister en BDD.
function persistAttachment(macroId, file) {
  if (!file || !file.buffer) return null;
  const dir = path.join(MACRO_UPLOAD_ROOT, String(macroId));
  fs.mkdirSync(dir, { recursive: true });
  const uuid = crypto.randomUUID();
  const safe = safeBasename(file.originalname);
  const filename = `${uuid}_${safe}`;
  fs.writeFileSync(path.join(dir, filename), file.buffer);
  return {
    filename,
    original_name: file.originalname,
    size: file.size,
    mime: file.mimetype,
  };
}

// Supprime physiquement la PJ d'une macro (si présente)
function removeAttachmentFile(macroId, filename) {
  if (!filename) return;
  try {
    const fullPath = path.join(MACRO_UPLOAD_ROOT, String(macroId), filename);
    const resolved = path.resolve(fullPath);
    if (!resolved.startsWith(path.resolve(MACRO_UPLOAD_ROOT) + path.sep)) return;
    if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
  } catch (e) {
    console.warn('[SavMacro] suppression PJ échouée:', e.message);
  }
}

module.exports = {
  MACRO_UPLOAD_ROOT,

  // ─── Liste ───────────────────────────────────────────────────────────────
  getAll: async (req, res) => {
    try {
      const macros = await savMacroModel.getAll();
      // Enrichir avec URL de PJ (relative)
      const enriched = macros.map(m => ({
        ...m,
        attachment_url: m.attachment_filename ? `/api/sav/macros/${m.id}/attachment` : null,
      }));
      res.json({ success: true, macros: enriched });
    } catch (e) {
      console.error('❌ [SavMacro] getAll:', e);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Créer ───────────────────────────────────────────────────────────────
  create: async (req, res) => {
    try {
      const { name, description, subject, body, sav_status } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: 'Nom requis' });

      // Création sans PJ d'abord pour obtenir l'id
      const macro = await savMacroModel.create({
        name: name.trim(),
        description, subject, body, sav_status,
        created_by: req.user?.id || null,
      });

      // Si PJ envoyée, la persister puis update la macro
      const file = req.files?.[0];
      if (file) {
        const att = persistAttachment(macro.id, file);
        const updated = await savMacroModel.update(macro.id, {
          name: macro.name,
          description: macro.description,
          subject: macro.subject,
          body: macro.body,
          sav_status: macro.sav_status,
          attachment: att,
        });
        return res.status(201).json({ success: true, macro: updated });
      }

      res.status(201).json({ success: true, macro });
    } catch (e) {
      console.error('❌ [SavMacro] create:', e);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Modifier ────────────────────────────────────────────────────────────
  update: async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await savMacroModel.getById(id);
      if (!existing) return res.status(404).json({ error: 'Macro introuvable' });

      const { name, description, subject, body, sav_status, remove_attachment } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: 'Nom requis' });

      let attachment; // undefined = ne pas toucher
      const file = req.files?.[0];
      if (file) {
        // Nouvelle PJ -> supprimer l'ancienne d'abord
        if (existing.attachment_filename) {
          removeAttachmentFile(id, existing.attachment_filename);
        }
        attachment = persistAttachment(id, file);
      } else if (remove_attachment === 'true' || remove_attachment === true) {
        // Demande explicite de suppression
        if (existing.attachment_filename) {
          removeAttachmentFile(id, existing.attachment_filename);
        }
        attachment = null;
      }

      const updated = await savMacroModel.update(id, {
        name: name.trim(), description, subject, body, sav_status, attachment,
      });

      res.json({ success: true, macro: updated });
    } catch (e) {
      console.error('❌ [SavMacro] update:', e);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Supprimer ───────────────────────────────────────────────────────────
  delete: async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await savMacroModel.getById(id);
      if (!existing) return res.status(404).json({ error: 'Macro introuvable' });

      if (existing.attachment_filename) {
        removeAttachmentFile(id, existing.attachment_filename);
      }
      await savMacroModel.delete(id);
      res.json({ success: true });
    } catch (e) {
      console.error('❌ [SavMacro] delete:', e);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Télécharger la PJ d'une macro ───────────────────────────────────────
  getAttachment: async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const macro = await savMacroModel.getById(id);
      if (!macro || !macro.attachment_filename) return res.status(404).json({ error: 'Aucune PJ' });

      const filename = macro.attachment_filename;
      if (!/^[A-Za-z0-9._-]+$/.test(filename)) return res.status(400).json({ error: 'Nom invalide' });

      const fullPath = path.join(MACRO_UPLOAD_ROOT, String(id), filename);
      const resolved = path.resolve(fullPath);
      if (!resolved.startsWith(path.resolve(MACRO_UPLOAD_ROOT) + path.sep)) {
        return res.status(400).json({ error: 'Chemin invalide' });
      }
      if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'Fichier introuvable' });

      // Forcer le filename original côté téléchargement
      res.setHeader('Content-Disposition', `inline; filename="${macro.attachment_original_name || filename}"`);
      if (macro.attachment_mime) res.setHeader('Content-Type', macro.attachment_mime);
      res.sendFile(resolved);
    } catch (e) {
      console.error('❌ [SavMacro] getAttachment:', e);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },
};
