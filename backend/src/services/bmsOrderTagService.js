/**
 * Tag « Ticket » sur la commande BMS associée à un ticket SAV.
 *
 * Logique (best-effort — n'interrompt jamais le flux ticket) :
 *  - Quand un ticket a un order_id et qu'il diffère de la dernière référence
 *    taguée (bms_tagged_order_ref), on pose le tag BMS sur la commande.
 *  - Si une ancienne commande était taguée (order_id a changé), on retire
 *    d'abord le tag de l'ancienne référence.
 *  - On mémorise la référence taguée en BDD pour l'idempotence + le détag futur.
 *
 * La référence BMS d'une sales order == le order_id WooCommerce (vérifié via
 * l'API : GET /sales/orders/reference/{order_id} matche directement). Aucune
 * conversion nécessaire.
 *
 * Pas de rétroactif : on ne traite que les tickets passés ici (création /
 * liaison). Le tag n'est jamais retiré à la fermeture du ticket (historique).
 */

const pool = require('../config/database');
const bmsApiModel = require('../models/bmsApiModel');

// ID du tag BMS « Ticket » (catalogue /sales/orders/tags → t_id = 5)
const BMS_TICKET_TAG_ID = 5;

function attachTag(reference) {
  return bmsApiModel.apiCall(
    `/sales/orders/reference/${encodeURIComponent(reference)}/tags/${BMS_TICKET_TAG_ID}`,
    'POST'
  );
}

function detachTag(reference) {
  return bmsApiModel.apiCall(
    `/sales/orders/reference/${encodeURIComponent(reference)}/tags/${BMS_TICKET_TAG_ID}`,
    'DELETE'
  );
}

/**
 * Synchronise le tag BMS pour un ticket. Best-effort : toute erreur est logguée
 * mais jamais propagée (on ne marque pas comme tagué en cas d'échec → retry
 * possible à la prochaine modification du ticket).
 *
 * @param {{id:number, order_id?:string|null, bms_tagged_order_ref?:string|null}} ticket
 */
async function syncTicketOrderTag(ticket) {
  try {
    if (!ticket || !ticket.id) return;

    const newRef = ticket.order_id ? String(ticket.order_id).trim() : null;
    const taggedRef = ticket.bms_tagged_order_ref
      ? String(ticket.bms_tagged_order_ref).trim()
      : null;

    // Rien à faire : pas de commande, ou commande déjà taguée et inchangée.
    if (!newRef && !taggedRef) return;
    if (newRef && newRef === taggedRef) return;

    // L'order_id a changé (ou a été retiré) → détaguer l'ancienne commande.
    if (taggedRef && taggedRef !== newRef) {
      try {
        await detachTag(taggedRef);
      } catch (e) {
        // Détag raté (commande absente, tag déjà retiré…) : on continue quand même.
        console.warn(`[BMS tag] détag #${ticket.id} ref ${taggedRef} échoué: ${e.message}`);
      }
      // Si plus aucune commande liée, on efface le flag et on s'arrête.
      if (!newRef) {
        await pool.query(
          `UPDATE sav_tickets SET bms_tagged_order_ref = NULL WHERE id = $1`,
          [ticket.id]
        );
        return;
      }
    }

    // Taguer la nouvelle commande.
    await attachTag(newRef);
    await pool.query(
      `UPDATE sav_tickets SET bms_tagged_order_ref = $1 WHERE id = $2`,
      [newRef, ticket.id]
    );
    console.log(`🏷️  [BMS tag] ticket #${ticket.id} → commande ${newRef} taguée`);
  } catch (e) {
    // Échec d'attache : on NE met PAS à jour le flag (retry au prochain passage).
    console.warn(`[BMS tag] ticket #${ticket?.id} sync échoué: ${e.message}`);
  }
}

/**
 * Cron de rattrapage : re-tente le tag BMS pour les tickets récents qui ont un
 * order_id mais dont le tag n'a jamais été posé (bms_tagged_order_ref NULL).
 *
 * Cas couvert : client qui écrit juste après sa commande, avant que BMS ne
 * l'ait importée → le 1er essai échoue (« Commande non trouvée »), ce cron
 * rattrape une fois la commande synchronisée côté BMS. Couvre aussi les échecs
 * réseau ponctuels.
 *
 * Fenêtre de 48h : au-delà, si la commande n'est toujours pas dans BMS, c'est
 * qu'elle n'y sera jamais (commande remboursée/annulée/non payée) → on arrête
 * de polluer les logs. Best-effort : chaque échec reste loggué sans bloquer.
 */
async function retryPendingTags() {
  const { rows } = await pool.query(
    `SELECT id, order_id, bms_tagged_order_ref
       FROM sav_tickets
      WHERE order_id IS NOT NULL
        AND TRIM(order_id) <> ''
        AND bms_tagged_order_ref IS NULL
        AND created_at >= NOW() - INTERVAL '48 hours'`
  );

  if (rows.length === 0) return { attempted: 0, tagged: 0 };

  let tagged = 0;
  for (const ticket of rows) {
    const before = ticket.bms_tagged_order_ref;
    await syncTicketOrderTag(ticket);
    // syncTicketOrderTag met à jour bms_tagged_order_ref en BDD en cas de succès.
    // On relit pour savoir si ça a marché (évite de dupliquer la logique).
    const { rows: [updated] } = await pool.query(
      `SELECT bms_tagged_order_ref FROM sav_tickets WHERE id = $1`,
      [ticket.id]
    );
    if (updated && updated.bms_tagged_order_ref && updated.bms_tagged_order_ref !== before) {
      tagged += 1;
    }
  }

  if (tagged > 0) {
    console.log(`🏷️  [BMS tag] rattrapage: ${tagged}/${rows.length} ticket(s) tagué(s)`);
  }
  return { attempted: rows.length, tagged };
}

module.exports = { syncTicketOrderTag, retryPendingTags, BMS_TICKET_TAG_ID };
