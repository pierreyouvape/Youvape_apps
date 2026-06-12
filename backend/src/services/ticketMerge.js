const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/database');
const { UPLOAD_ROOT } = require('../utils/savAttachments');
const { tagDuplicates } = require('./duplicateDetector');
const { emitChange } = require('./ticketEvents');

// ─── Déplacement physique des PJ source → cible ───────────────────────────────
// Les attachments d'un message stockent une url absolue
// "/api/sav/attachments/{ticketId}/{filename}". À la fusion, on déplace le
// fichier dans le dossier de la cible (en évitant les collisions de noms) et
// on réécrit filename + url pour pointer vers la cible.
function moveAttachment(att, sourceId, targetId) {
  if (!att || !att.filename) return att;

  const srcPath = path.join(UPLOAD_ROOT, String(sourceId), att.filename);
  // Si le fichier source n'existe pas (PJ Mailgun jamais persistée, etc.),
  // on réécrit quand même l'url pour rester cohérent, sans planter.
  const targetDir = path.join(UPLOAD_ROOT, String(targetId));
  fs.mkdirSync(targetDir, { recursive: true });

  let newFilename = att.filename;
  let destPath = path.join(targetDir, newFilename);
  // Collision de nom dans le dossier cible → préfixe uuid court
  if (fs.existsSync(destPath)) {
    newFilename = `${crypto.randomUUID().slice(0, 8)}_${att.filename}`;
    destPath = path.join(targetDir, newFilename);
  }

  try {
    if (fs.existsSync(srcPath)) {
      fs.renameSync(srcPath, destPath);
    }
  } catch (e) {
    console.warn(`[TicketMerge] déplacement PJ ${att.filename} échoué:`, e.message);
  }

  return {
    ...att,
    filename: newFilename,
    url: `/api/sav/attachments/${targetId}/${newFilename}`,
  };
}

// Réécrit les attachments de chaque message d'un fil source vers la cible.
function relocateMessages(messages, sourceId, targetId) {
  if (!Array.isArray(messages)) return [];
  return messages.map(msg => ({
    ...msg,
    attachments: Array.isArray(msg.attachments)
      ? msg.attachments.map(att => moveAttachment(att, sourceId, targetId))
      : [],
  }));
}

/**
 * Fusionne le ticket `sourceId` dans le ticket `targetId` (façon Zendesk).
 *   - Rapatrie tous les messages du source dans la cible (ordre chronologique).
 *   - Déplace les PJ physiquement et réécrit leurs urls.
 *   - Ajoute une note système dans les deux tickets.
 *   - Ferme le source (statut 'terminé') et pose merged_into_id → cible.
 *   - Rafraîchit la détection de doublons sur la cible.
 *
 * @returns {Promise<object>} le ticket cible mis à jour
 */
async function mergeTickets(sourceId, targetId, { agentName = 'SAV Youvape' } = {}) {
  if (sourceId === targetId) {
    throw new Error('Impossible de fusionner un ticket avec lui-même');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verrouille les deux tickets pour la durée de la transaction
    const { rows } = await client.query(
      `SELECT * FROM sav_tickets WHERE id = ANY($1::int[]) FOR UPDATE`,
      [[sourceId, targetId]]
    );
    const source = rows.find(r => r.id === sourceId);
    const target = rows.find(r => r.id === targetId);

    if (!source) throw new Error(`Ticket source #${sourceId} introuvable`);
    if (!target) throw new Error(`Ticket cible #${targetId} introuvable`);
    if (source.merged_into_id) {
      throw new Error(`Le ticket #${sourceId} a déjà été fusionné dans #${source.merged_into_id}`);
    }
    if (target.merged_into_id) {
      throw new Error(`Le ticket cible #${targetId} a lui-même été fusionné dans #${target.merged_into_id}`);
    }

    // 1. Construire le fil source à rapatrier.
    // Si le ticket source a une `description` (1er message historique non migré
    // dans messages[]), on la transforme en message d'ouverture.
    const sourceMessages = [];
    if (source.description && (!Array.isArray(source.messages) || source.messages.length === 0)) {
      sourceMessages.push({
        from: source.customer_name || source.customer_email,
        body: source.description,
        is_agent: false,
        is_private: false,
        date: source.created_at instanceof Date ? source.created_at.toISOString() : source.created_at,
        attachments: [],
      });
    }
    if (Array.isArray(source.messages)) sourceMessages.push(...source.messages);

    // 2. Déplacer les PJ physiquement + réécrire les urls.
    const relocated = relocateMessages(sourceMessages, sourceId, targetId);

    // 3. Séparateur système ouvrant le bloc fusionné dans la cible.
    const mergeBanner = {
      from: agentName,
      body: `— Ticket #${sourceId} fusionné ici (${source.subject || 'sans sujet'}) —`,
      is_agent: true,
      is_private: true,
      is_system: true,
      date: new Date().toISOString(),
      attachments: [],
    };

    // 4. Concaténer dans la cible : messages cible + bannière + messages source.
    //    On garde l'ordre cible-puis-source (le source est le doublon récent
    //    qu'on absorbe). Les dates restent affichables telles quelles.
    await client.query(
      `UPDATE sav_tickets
         SET messages = messages || $1::jsonb,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [JSON.stringify([mergeBanner, ...relocated]), targetId]
    );

    // 5. Note système dans le source + fermeture + flag merged_into.
    const sourceNote = {
      from: agentName,
      body: `— Ce ticket a été fusionné dans le ticket #${targetId} —`,
      is_agent: true,
      is_private: true,
      is_system: true,
      date: new Date().toISOString(),
      attachments: [],
    };
    await client.query(
      `UPDATE sav_tickets
         SET messages = messages || $1::jsonb,
             merged_into_id = $2,
             merged_at = CURRENT_TIMESTAMP,
             sav_status = 'terminé',
             last_status_change_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [JSON.stringify([sourceNote]), targetId, sourceId]
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  // Les deux tickets ont changé (cible enrichie, source fermée/fusionnée).
  emitChange(targetId, 'merge');
  emitChange(sourceId, 'merge');

  // Rafraîchir la détection de doublons sur la cible (hors transaction).
  // Le source étant désormais 'terminé', il ne ressortira plus comme doublon.
  try {
    const targetRow = (await pool.query(`SELECT * FROM sav_tickets WHERE id = $1`, [targetId])).rows[0];
    if (targetRow) await tagDuplicates(targetRow);
  } catch (e) {
    console.warn('[TicketMerge] tagDuplicates post-fusion échoué:', e.message);
  }

  const updated = (await pool.query(`SELECT * FROM sav_tickets WHERE id = $1`, [targetId])).rows[0];
  return updated;
}

module.exports = { mergeTickets };
