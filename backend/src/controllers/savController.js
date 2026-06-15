const savModel = require('../models/savModel');
const savViewModel = require('../models/savViewModel');
const mailgunService = require('../services/mailgunService');
const emailTemplateService = require('../services/emailTemplateService');
const pool = require('../config/database');
const { saveAttachments, saveAttachmentsFromUrls, toMailgunAttachments } = require('../utils/savAttachments');
const { getTrackingStatus } = require('../services/trackingService');
const { dispatchNotifications } = require('../services/notificationDispatcher');
const { tagDuplicates } = require('../services/duplicateDetector');
const { mergeTickets } = require('../services/ticketMerge');
const { sendAlert } = require('../services/alertService');
const { syncTicketOrderTag } = require('../services/bmsOrderTagService');
const { ticketEvents } = require('../services/ticketEvents');

// Déduplication des inbounds : Mailgun peut appeler le webhook plusieurs fois
// pour un même mail (actions Forward + Store-notify, ou retries). On garde en
// mémoire les identifiants récents (TTL 10 min) pour ignorer les doublons.
const _recentInbound = new Map(); // id -> timestamp
const INBOUND_DEDUP_TTL_MS = 10 * 60 * 1000;
function isDuplicateInbound(id) {
  if (!id) return false;
  const now = Date.now();
  // Purge des entrées expirées
  for (const [k, ts] of _recentInbound) {
    if (now - ts > INBOUND_DEDUP_TTL_MS) _recentInbound.delete(k);
  }
  if (_recentInbound.has(id)) return true;
  _recentInbound.set(id, now);
  return false;
}

// Extrait le texte réellement écrit par le client dans un email entrant, en
// retirant la citation du fil précédent et la signature.
// 1) Si Mailgun fournit `stripped-text` (corps déjà nettoyé), on l'utilise.
// 2) Sinon fallback : on coupe à la 1re ligne d'en-tête de citation (EN + FR)
//    puis on enlève les lignes restantes préfixées par ">".
function stripQuotedReply(strippedText, bodyPlain) {
  if (strippedText && strippedText.trim()) return strippedText.trim();
  if (!bodyPlain) return '';

  // En-têtes de citation : "On ... wrote:" / "Le ... a écrit :"
  const quoteHeader = /^\s*(On .+ wrote:|Le .+ a écrit\s*:)\s*$/m;
  let text = bodyPlain.split(quoteHeader)[0];

  // Variante inline (sans saut de ligne avant le "Le ... a écrit :")
  text = text.replace(/Le .+ a écrit\s*:[\s\S]*$/, '');
  text = text.replace(/On .+ wrote:[\s\S]*$/, '');

  // Retirer les lignes de citation restantes (préfixe ">")
  text = text.split('\n').filter(l => !/^\s*>/.test(l)).join('\n');

  return text.trim();
}

// Envoi (fire-and-forget) d'un accusé de réception au client. Enrobe le template
// accusé et passe par Mailgun. Sécurité : jamais d'accusé vers notre propre
// adresse SAV (évite une auto-boucle si un mail système rebondit).
async function sendAckEmail({ ticketId, email, customerName, subject }) {
  try {
    if (!email) return;
    const from = (process.env.MAILGUN_FROM || '').toLowerCase();
    if (from && email.toLowerCase() === from) return;

    const html = emailTemplateService.renderAccuse({
      customer_name: customerName || '',
      subject:       subject || '',
      ticket_id:     ticketId,
    });
    const result = await mailgunService.sendAcknowledgement({
      to: email, subject: subject || 'Votre demande', ticketId, bodyHtml: html,
    });
    if (!result.success) {
      console.warn(`[SAV] Accusé réception non envoyé (ticket #${ticketId}):`, result.error);
    }
  } catch (e) {
    console.warn(`[SAV] Accusé réception échoué (ticket #${ticketId}):`, e.message);
  }
}

const savController = {

  // ─── Flux temps réel des changements de tickets (Server-Sent Events) ──────
  // Le navigateur ouvre cette connexion et reçoit un événement `change` à
  // chaque création/modification de ticket (via le bus ticketEvents). La liste
  // se rafraîchit alors immédiatement, au lieu d'attendre le polling de secours.
  stream: (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // pas de buffering nginx sur ce flux
    res.flushHeaders?.();

    const send = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      res.flush?.();
    };

    // Coalescence : un seul PATCH/réponse peut générer plusieurs émissions
    // rapprochées. On regroupe les `change` reçus dans une fenêtre de 300 ms en
    // un unique event envoyé au client, pour ne pas le saturer de refetchs.
    let pending = null;
    let lastReason = null;
    const onChange = ({ ticketId, reason }) => {
      lastReason = reason;
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        send('change', { reason: lastReason });
      }, 300);
    };
    ticketEvents.on('change', onChange);

    // Heartbeat anti-timeout (nginx/Cloudflare coupent les flux idle).
    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
      res.flush?.();
    }, 15000);

    // Hello initial : confirme au client que le flux est ouvert.
    send('hello', { ok: true });

    // Nettoyage à la déconnexion : indispensable pour ne pas accumuler de
    // listeners (fuite mémoire) à chaque onglet ouvert/fermé.
    req.on('close', () => {
      clearInterval(heartbeat);
      if (pending) clearTimeout(pending);
      ticketEvents.off('change', onChange);
      res.end();
    });
  },

  // ─── Webhook Gravity Forms — création ticket ──────────────────────────────
  webhookGravityForms: async (req, res) => {
    try {
      // Vérification secret
      const secret = req.headers['x-webhook-secret'];
      if (!secret || secret !== process.env.SAV_WEBHOOK_SECRET) {
        console.warn('⚠️ [SAV Webhook] Secret invalide');
        return res.status(401).json({ error: 'Non autorisé' });
      }

      const body = req.body;
      console.log('📥 [SAV Webhook] Payload reçu:', JSON.stringify(body, null, 2));

      // Mapping champs Gravity Forms
      const prenom      = body['1.3'] || '';
      const nom         = body['1.6'] || '';
      const email       = body['2']   || '';
      const order_id    = body['9']   || null;
      const description = body['4']   || '';

      if (!email || !description) {
        return res.status(400).json({ error: 'Email et description requis' });
      }

      const customer_name  = `${prenom} ${nom}`.trim();
      const customer_phone = body['3'] || null; // si champ téléphone existe
      const subject        = description.substring(0, 100); // premiers 100 chars comme sujet

      // Chercher le client par email
      let customer_id = null;
      if (email) {
        const customerResult = await pool.query(
          'SELECT id FROM customers WHERE email = $1 LIMIT 1',
          [email.toLowerCase()]
        );
        if (customerResult.rows.length > 0) {
          customer_id = customerResult.rows[0].id;
        }
      }

      const ticket = await savModel.create({
        order_id:       order_id || null,
        customer_id,
        customer_name,
        customer_email: email.toLowerCase(),
        customer_phone,
        subject,
        description,
        source: 'gravity_form',
      });

      console.log(`✅ [SAV] Ticket #${ticket.id} créé pour ${customer_name} (${email})`);

      // Accusé de réception au client (fire-and-forget)
      sendAckEmail({ ticketId: ticket.id, email: ticket.customer_email, customerName: customer_name, subject });

      // Notification : nouveau message reçu (fire-and-forget)
      dispatchNotifications('new_message', ticket).catch(() => {});

      // Détection de doublons (fire-and-forget)
      tagDuplicates(ticket).catch(e => console.warn('[SAV] tagDuplicates échoué:', e.message));

      // Tag BMS sur la commande associée (fire-and-forget, ne bloque pas)
      syncTicketOrderTag(ticket);

      res.status(200).json({ success: true, ticket_id: ticket.id });

    } catch (error) {
      console.error('❌ [SAV] Erreur webhook GF:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Inbound email Mailgun — réponse client ───────────────────────────────
  inboundEmail: async (req, res) => {
    try {
      // Toujours répondre 200 rapidement à Mailgun (sinon il retry)
      res.status(200).json({ success: true });

      console.log('📨 [SAV Inbound] Payload reçu:', JSON.stringify(req.body, null, 2));

      const {
        sender, subject, 'body-plain': bodyPlain,
        'stripped-text': strippedText,
        'Message-Id': messageId, 'message-url': messageUrl,
        timestamp, token, signature,
      } = req.body;

      // Vérifier signature Mailgun (optionnel en sandbox)
      if (process.env.MAILGUN_WEBHOOK_SIGNING_KEY) {
        const valid = mailgunService.verifyWebhookSignature(timestamp, token, signature);
        if (!valid) {
          console.warn('⚠️ [SAV Inbound] Signature Mailgun invalide');
          return;
        }
      }

      // Anti-doublon : Mailgun peut notifier 2× le même mail (Forward + Store).
      const dedupId = messageId || messageUrl || null;
      if (isDuplicateInbound(dedupId)) {
        console.log(`📨 [SAV Inbound] Doublon ignoré (${dedupId})`);
        return;
      }

      // Extraire ticket ID du sujet pour matcher à un ticket existant.
      // Si le ticket a été fusionné dans un autre, on suit la chaîne jusqu'au
      // ticket actif (sinon la réponse atterrirait dans un ticket fermé/mort).
      const ticketId = mailgunService.extractTicketIdFromSubject(subject);
      const matchedTicket = ticketId ? await savModel.resolveActiveTicket(ticketId) : null;
      if (matchedTicket && ticketId && matchedTicket.id !== ticketId) {
        console.log(`📨 [SAV Inbound] Ticket #${ticketId} fusionné → réponse redirigée vers #${matchedTicket.id}`);
      }

      // Nettoyer le body : on privilégie le `stripped-text` de Mailgun (déjà
      // débarrassé de la citation et de la signature). Sinon, fallback sur un
      // découpage manuel des en-têtes de citation (EN + FR).
      const cleanBody = stripQuotedReply(strippedText, bodyPlain);

      // PJ entrantes : multipart (mode Forward) OU URLs Mailgun (mode Store).
      const resolveInboundAttachments = async (tid) => {
        const fromMultipart = saveAttachments(tid, req.files);
        if (fromMultipart.length > 0) return fromMultipart;
        return saveAttachmentsFromUrls(tid, req.body.attachments);
      };

      // ─── Cas 1 : ticket trouvé → ajouter la réponse au fil existant ─────
      if (matchedTicket) {
        const attachments = await resolveInboundAttachments(matchedTicket.id);
        if (!cleanBody && attachments.length === 0) return;

        await savModel.addMessage(matchedTicket.id, {
          from:        sender,
          body:        cleanBody,
          is_agent:    false,
          attachments,
        });

        // Une réponse du client repasse le ticket en "reponse_client" (à traiter),
        // quel que soit le statut courant (sauf s'il y est déjà). Remonte ainsi
        // le ticket dans la file dès que le client relance.
        if (matchedTicket.sav_status !== 'reponse_client') {
          try {
            await savModel.updateStatus(matchedTicket.id, 'reponse_client');
          } catch (e) {
            console.warn(`[SAV Inbound] Maj statut reponse_client échouée (#${matchedTicket.id}):`, e.message);
          }
        }

        console.log(`📨 [SAV Inbound] Réponse client ajoutée au ticket #${matchedTicket.id}`);

        // Accusé de réception (à chaque entrant, choix métier validé)
        sendAckEmail({
          ticketId: matchedTicket.id, email: sender,
          customerName: matchedTicket.customer_name, subject: matchedTicket.subject,
        });

        dispatchNotifications('reply_received', matchedTicket, {
          body: cleanBody, from: sender,
        }).catch(() => {});
        return;
      }

      // ─── Cas 2 : pas de match → créer un nouveau ticket ─────────────────
      const hasMultipart = req.files && req.files.length > 0;
      const hasUrlAttachments = !!req.body.attachments && req.body.attachments !== '[]';
      if (!cleanBody && !hasMultipart && !hasUrlAttachments) {
        console.warn(`⚠️ [SAV Inbound] Mail vide rejeté (sender=${sender})`);
        return;
      }

      // Nettoyer "Re: " du sujet
      const cleanSubject = (subject || '(sans sujet)')
        .replace(/^\s*(Re\s*:\s*)+/i, '')
        .replace(/\[SAV #\d+\]\s*/i, '')
        .trim() || '(sans sujet)';

      // Lookup client par email
      let customer_id = null;
      let customer_name = sender;
      try {
        const customerResult = await pool.query(
          'SELECT id, first_name, last_name FROM customers WHERE email = $1 LIMIT 1',
          [sender.toLowerCase()]
        );
        if (customerResult.rows.length > 0) {
          customer_id = customerResult.rows[0].id;
          const c = customerResult.rows[0];
          customer_name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || sender;
        }
      } catch (e) {
        console.warn('[SAV Inbound] Lookup customer échoué:', e.message);
      }

      // Le 1er mail devient un message (pas description) pour pouvoir porter ses
      // PJ : messages[] supporte les pièces jointes, pas la description.
      const newTicket = await savModel.create({
        order_id:       null,
        customer_id,
        customer_name,
        customer_email: sender.toLowerCase(),
        customer_phone: null,
        subject:        cleanSubject.substring(0, 200),
        description:    null,
        source:         'email',
      });

      // Sauvegarder les PJ (multipart ou URLs Mailgun) et les attacher au 1er message
      const newAttachments = await resolveInboundAttachments(newTicket.id);
      await savModel.addMessage(newTicket.id, {
        from:        sender,
        body:        cleanBody,
        is_agent:    false,
        attachments: newAttachments,
      });

      console.log(`✅ [SAV Inbound] Nouveau ticket #${newTicket.id} créé depuis email "${cleanSubject}" (sender=${sender}, ${newAttachments.length} PJ)`);

      // Accusé de réception au client (fire-and-forget)
      sendAckEmail({
        ticketId: newTicket.id, email: sender,
        customerName: newTicket.customer_name, subject: newTicket.subject,
      });

      dispatchNotifications('new_message', newTicket).catch(() => {});
      tagDuplicates(newTicket).catch(e => console.warn('[SAV Inbound] tagDuplicates échoué:', e.message));

    } catch (error) {
      console.error('❌ [SAV Inbound] Erreur:', error);
      // Filet de sécurité : on conserve le payload brut + on alerte par mail,
      // pour ne perdre aucun message client mal traité (pas de stockage Mailgun).
      const b = req.body || {};
      const failSender = b.sender || b.from || null;
      const failSubject = b.subject || b.Subject || null;
      const failMsgId = b['Message-Id'] || b['message-url'] || null;
      try {
        await pool.query(
          `INSERT INTO sav_inbound_failures (sender, subject, message_id, payload, error)
           VALUES ($1, $2, $3, $4, $5)`,
          [failSender, failSubject, failMsgId, JSON.stringify(b), error.message]
        );
      } catch (dbErr) {
        console.error('❌ [SAV Inbound] Échec sauvegarde du payload raté:', dbErr.message);
      }
      sendAlert(
        'Email SAV non traité',
        `Un email entrant n'a pas pu être traité et a été mis de côté.\n\n`
        + `Expéditeur : ${failSender || '(inconnu)'}\n`
        + `Sujet : ${failSubject || '(inconnu)'}\n`
        + `Message-Id : ${failMsgId || '(inconnu)'}\n`
        + `Erreur : ${error.message}\n\n`
        + `Le contenu brut est conservé en base (table sav_inbound_failures) pour retraitement manuel.`
      ).catch(() => {});
    }
  },

  // ─── Inbound Zendesk (webhook de transition) ───────────────────────────────
  // Pendant la bascule Zendesk → app, les clients répondent encore à d'anciens
  // tickets côté Zendesk. Un déclencheur Zendesk pousse le commentaire ici.
  // Matching DIRECT par ticket.id : les IDs de l'app sont alignés sur Zendesk
  // (voir import Zendesk), donc {{ticket.id}} = sav_tickets.id.
  inboundZendesk: async (req, res) => {
    try {
      // Répondre 200 vite (Zendesk retry sinon)
      res.status(200).json({ success: true });

      console.log('📨 [SAV Zendesk] Payload reçu:', JSON.stringify(req.body, null, 2));

      const {
        ticket_id,
        requester_email,
        requester_name,
        subject,
        comment,
        comment_id,
      } = req.body;

      const sender = (requester_email || '').toLowerCase();
      const cleanBody = (comment || '').trim();

      // Anti-doublon : on dédup sur comment_id si fourni, sinon ticket+hash.
      const dedupId = comment_id
        ? `zd-${comment_id}`
        : (ticket_id ? `zd-${ticket_id}-${cleanBody.slice(0, 40)}` : null);
      if (isDuplicateInbound(dedupId)) {
        console.log(`📨 [SAV Zendesk] Doublon ignoré (${dedupId})`);
        return;
      }

      // Matching par zendesk_id UNIQUEMENT (jamais par id app) : un ticket créé
      // dans l'app peut avoir un id qui coïncide par hasard avec un n° Zendesk.
      // On suit la chaîne de fusion pour atterrir sur le ticket actif.
      const zid = parseInt(ticket_id, 10);
      const matchedTicket = Number.isInteger(zid)
        ? await savModel.resolveActiveByZendeskId(zid)
        : null;
      if (matchedTicket && matchedTicket.zendesk_id !== zid) {
        console.log(`📨 [SAV Zendesk] Ticket Zendesk #${zid} fusionné → réponse redirigée vers #${matchedTicket.id}`);
      }

      // ─── Cas 1 : ticket trouvé → ajouter la réponse au fil existant ─────
      if (matchedTicket) {
        if (!cleanBody) return;

        await savModel.addMessage(matchedTicket.id, {
          from:        sender || requester_name || 'client',
          body:        cleanBody,
          is_agent:    false,
          attachments: [],
        });

        if (matchedTicket.sav_status !== 'reponse_client') {
          try {
            await savModel.updateStatus(matchedTicket.id, 'reponse_client');
          } catch (e) {
            console.warn(`[SAV Zendesk] Maj statut reponse_client échouée (#${matchedTicket.id}):`, e.message);
          }
        }

        console.log(`📨 [SAV Zendesk] Réponse client ajoutée au ticket #${matchedTicket.id}`);

        dispatchNotifications('reply_received', matchedTicket, {
          body: cleanBody, from: sender,
        }).catch(() => {});
        return;
      }

      // ─── Cas 2 : ticket inconnu (jamais importé) → créer un ticket ──────
      if (!cleanBody) {
        console.warn(`⚠️ [SAV Zendesk] Message vide rejeté (ticket_id=${ticket_id})`);
        return;
      }

      const cleanSubject = (subject || '(sans sujet)')
        .replace(/^\s*(Re\s*:\s*)+/i, '')
        .trim() || '(sans sujet)';

      // Lookup client par email
      let customer_id = null;
      let customer_name = requester_name || sender;
      if (sender) {
        try {
          const r = await pool.query(
            'SELECT id, first_name, last_name FROM customers WHERE email = $1 LIMIT 1',
            [sender]
          );
          if (r.rows.length > 0) {
            customer_id = r.rows[0].id;
            const c = r.rows[0];
            customer_name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || customer_name;
          }
        } catch (e) {
          console.warn('[SAV Zendesk] Lookup customer échoué:', e.message);
        }
      }

      const newTicket = await savModel.create({
        order_id:       null,
        customer_id,
        customer_name,
        customer_email: sender || null,
        customer_phone: null,
        subject:        cleanSubject.substring(0, 200),
        description:    null,
        source:         'email',
      });

      await savModel.addMessage(newTicket.id, {
        from:        sender || customer_name,
        body:        cleanBody,
        is_agent:    false,
        attachments: [],
      });

      console.log(`✅ [SAV Zendesk] Nouveau ticket #${newTicket.id} créé (Zendesk #${ticket_id} inconnu, sender=${sender})`);

      dispatchNotifications('new_message', newTicket).catch(() => {});
      tagDuplicates(newTicket).catch(e => console.warn('[SAV Zendesk] tagDuplicates échoué:', e.message));

    } catch (error) {
      console.error('❌ [SAV Zendesk] Erreur:', error);
      const b = req.body || {};
      try {
        await pool.query(
          `INSERT INTO sav_inbound_failures (sender, subject, message_id, payload, error)
           VALUES ($1, $2, $3, $4, $5)`,
          [b.requester_email || null, b.subject || null,
           b.comment_id ? `zd-${b.comment_id}` : null, JSON.stringify(b), error.message]
        );
      } catch (dbErr) {
        console.error('❌ [SAV Zendesk] Échec sauvegarde du payload raté:', dbErr.message);
      }
      sendAlert(
        'Réponse Zendesk non traitée',
        `Une réponse client transférée depuis Zendesk n'a pas pu être traitée.\n\n`
        + `Ticket Zendesk : ${b.ticket_id || '(inconnu)'}\n`
        + `Expéditeur : ${b.requester_email || '(inconnu)'}\n`
        + `Erreur : ${error.message}\n\n`
        + `Le contenu brut est conservé en base (sav_inbound_failures).`
      ).catch(() => {});
    }
  },

  // ─── Liste des tickets ────────────────────────────────────────────────────
  getAll: async (req, res) => {
    try {
      const { limit = 50, offset = 0, sav_status, sav_statuses, search } = req.query;
      // sav_statuses peut arriver comme ?sav_statuses[]=ouvert&sav_statuses[]=accepté
      const statusesArray = sav_statuses
        ? (Array.isArray(sav_statuses) ? sav_statuses : [sav_statuses])
        : null;
      const { tickets, total } = await savModel.getAll({
        limit:         parseInt(limit),
        offset:        parseInt(offset),
        sav_status:    sav_status || null,
        sav_statuses:  statusesArray,
        search:        search || null,
      });
      res.json({ success: true, tickets, total });
    } catch (error) {
      console.error('❌ [SAV] Erreur liste:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Détail ticket ────────────────────────────────────────────────────────
  getById: async (req, res) => {
    try {
      const ticket = await savModel.getById(parseInt(req.params.id));
      if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
      res.json({ success: true, ticket });
    } catch (error) {
      console.error('❌ [SAV] Erreur détail:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Tickets par commande ─────────────────────────────────────────────────
  getByOrderId: async (req, res) => {
    try {
      const tickets = await savModel.getByOrderId(req.params.order_id);
      res.json({ success: true, tickets });
    } catch (error) {
      console.error('❌ [SAV] Erreur tickets commande:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Tickets par client ───────────────────────────────────────────────────
  getByCustomerId: async (req, res) => {
    try {
      const tickets = await savModel.getByCustomerId(parseInt(req.params.customer_id));
      res.json({ success: true, tickets });
    } catch (error) {
      console.error('❌ [SAV] Erreur tickets client:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Mise à jour statut ───────────────────────────────────────────────────
  updateStatus: async (req, res) => {
    try {
      const { sav_status } = req.body;
      const ticket = await savModel.updateStatus(parseInt(req.params.id), sav_status);
      if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
      res.json({ success: true, ticket });
    } catch (error) {
      console.error('❌ [SAV] Erreur statut:', error);
      res.status(400).json({ error: error.message });
    }
  },

  // ─── Répondre au client par email ────────────────────────────────────────
  reply: async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      const { body, agent_name, is_private } = req.body;

      if (!body) return res.status(400).json({ error: 'Le message est requis' });

      const ticket = await savModel.getById(ticketId);
      if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

      const from = agent_name || 'SAV Youvape';
      const storedAttachments = saveAttachments(ticketId, req.files);

      // Note privée → pas d'envoi email, juste stockage
      if (is_private === 'true' || is_private === true) {
        const updated = await savModel.addMessage(ticketId, {
          from, body, is_agent: true, is_private: true,
          attachments: storedAttachments,
        });
        return res.json({ success: true, ticket: updated });
      }

      // Réponse publique → envoi email via Mailgun.
      // body = HTML du message (éditeur riche front), injecté dans le template
      // de réponse. Le fallback texte est dérivé du HTML enrobé par mailgunService.
      const wrappedHtml = emailTemplateService.renderReponse({
        customer_name: ticket.customer_name || '',
        subject:       ticket.subject || '',
        ticket_id:     ticketId,
        messageBodyHtml: body,
      });
      const emailResult = await mailgunService.sendReply({
        to:          ticket.customer_email,
        subject:     ticket.subject,
        ticketId,
        bodyHtml:    wrappedHtml,
        bodyText:    mailgunService.htmlToPlainText(body), // fallback = message seul, pas tout le template
        attachments: toMailgunAttachments(req.files),
      });

      // Échec d'envoi : on stocke quand même le message (avec send_failed) pour
      // ne pas perdre le travail de l'agent, et on renvoie le ticket à jour avec
      // un flag. Le front affiche le badge "⚠ Non envoyé".
      if (!emailResult.success) {
        const failed = await savModel.addMessage(ticketId, {
          from, body, is_agent: true, is_private: false,
          attachments: storedAttachments,
          send_failed: true, error: emailResult.error,
        });
        return res.json({
          success: true, ticket: failed,
          send_failed: true, warning: `Message enregistré mais non envoyé : ${emailResult.error}`,
        });
      }

      // Stocker le message dans le ticket
      const updated = await savModel.addMessage(ticketId, {
        from, body, is_agent: true, is_private: false,
        attachments: storedAttachments,
      });

      res.json({ success: true, ticket: updated });

    } catch (error) {
      console.error('❌ [SAV] Erreur reply:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Image collée dans l'éditeur (Ctrl+V) — affichée inline dans le message ──
  // POST /:id/inline-image (multipart, champ "image")
  uploadInlineImage: async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      if (!req.file) return res.status(400).json({ error: 'Image requise' });
      if (!req.file.mimetype?.startsWith('image/')) {
        return res.status(400).json({ error: 'Le fichier doit être une image' });
      }

      const ticket = await savModel.getById(ticketId);
      if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

      const [saved] = saveAttachments(ticketId, [req.file]);
      const appBaseUrl = process.env.APP_BASE_URL || 'https://apps.youvape.fr';
      res.json({ success: true, url: `${appBaseUrl}${saved.url}` });
    } catch (error) {
      console.error('❌ [SAV] Erreur uploadInlineImage:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Fusionner ce ticket (source) dans un ticket cible ───────────────────
  // POST /:id/merge  body: { target_id, agent_name? }
  // Façon Zendesk : le ticket courant (:id) est absorbé par target_id puis fermé.
  mergeTicket: async (req, res) => {
    try {
      const sourceId = parseInt(req.params.id);
      const targetId = parseInt(req.body.target_id);

      if (Number.isNaN(sourceId) || Number.isNaN(targetId)) {
        return res.status(400).json({ error: 'target_id invalide' });
      }
      if (sourceId === targetId) {
        return res.status(400).json({ error: 'Impossible de fusionner un ticket avec lui-même' });
      }

      const targetTicket = await mergeTickets(sourceId, targetId, {
        agentName: req.body.agent_name || 'SAV Youvape',
      });

      // Renvoyer la cible enrichie (order_items, infos client…)
      const fullTarget = await savModel.getById(targetTicket.id);
      res.json({ success: true, ticket: fullTarget });
    } catch (error) {
      console.error('❌ [SAV] Erreur fusion:', error);
      res.status(400).json({ error: error.message || 'Erreur serveur' });
    }
  },

  // ─── Mise à jour notes internes ───────────────────────────────────────────
  updateNotes: async (req, res) => {
    try {
      const { notes } = req.body;
      const ticket = await savModel.updateNotes(parseInt(req.params.id), notes);
      if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
      res.json({ success: true, ticket });
    } catch (error) {
      console.error('❌ [SAV] Erreur notes:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── PATCH champs éditables (autosave 600ms debounce) ────────────────────
  patchTicket: async (req, res) => {
    try {
      const ticket = await savModel.patch(parseInt(req.params.id), req.body);
      if (!ticket) return res.status(404).json({ error: 'Ticket introuvable ou aucun champ valide' });

      // Si le PATCH touche la commande liée → resync du tag BMS (fire-and-forget).
      // Le ticket renvoyé porte order_id + bms_tagged_order_ref : le service
      // détecte lui-même un changement et détague l'ancienne commande au besoin.
      if (Object.prototype.hasOwnProperty.call(req.body, 'order_id')) {
        syncTicketOrderTag(ticket);
      }

      res.json({ success: true, ticket });
    } catch (error) {
      console.error('❌ [SAV] Erreur patch:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Créer un ticket manuellement (depuis l'app) ─────────────────────────
  // Body requis : un 1er message (public ou note privée). Si public, envoi mail.
  createManual: async (req, res) => {
    try {
      const {
        order_id, order_tracking, customer_name, customer_email, customer_phone,
        subject, body, is_private, sav_status, assigned_to_id, agent_name,
      } = req.body;

      if (!customer_email || !subject || !body || !body.trim()) {
        return res.status(400).json({ error: 'Email, sujet et message sont requis' });
      }

      // Lookup client par email (priorité à la BDD : si trouvé, on ignore le nom saisi)
      let customer_id = null;
      let resolved_name = customer_name;
      const customerResult = await pool.query(
        'SELECT id, first_name, last_name FROM customers WHERE email = $1 LIMIT 1',
        [customer_email.toLowerCase()]
      );
      if (customerResult.rows.length > 0) {
        customer_id = customerResult.rows[0].id;
        const c = customerResult.rows[0];
        resolved_name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || customer_name;
      }

      const isPrivate = is_private === true || is_private === 'true';

      // Création du ticket (description = null, le 1er message va dans messages[])
      const ticket = await savModel.create({
        order_id: order_id || null,
        customer_id,
        customer_name: resolved_name,
        customer_email: customer_email.toLowerCase(),
        customer_phone: customer_phone || null,
        subject,
        description: null,
        source: 'manual',
      });

      // Appliquer assigné, suivi et statut initial si fournis
      const patchFields = {};
      if (assigned_to_id) patchFields.assigned_to_id = assigned_to_id;
      if (order_tracking && order_tracking.trim()) patchFields.order_tracking = order_tracking.trim();
      if (Object.keys(patchFields).length > 0) {
        await savModel.patch(ticket.id, patchFields);
      }
      if (sav_status) {
        try { await savModel.updateStatus(ticket.id, sav_status); }
        catch (e) { console.warn('[SAV createManual] statut invalide ignoré:', sav_status, e.message); }
      }

      // Sauvegarde des éventuelles PJ
      const storedAttachments = saveAttachments(ticket.id, req.files);

      // Réponse publique → envoi mail au client (enrobé dans le template réponse).
      // En cas d'échec, on stocke quand même le message avec send_failed (comme reply).
      let sendFailedFlag = false;
      let sendError = null;
      if (!isPrivate) {
        const wrappedHtml = emailTemplateService.renderReponse({
          customer_name: resolved_name || '',
          subject:       subject || '',
          ticket_id:     ticket.id,
          messageBodyHtml: body,
        });
        const emailResult = await mailgunService.sendReply({
          to:          customer_email.toLowerCase(),
          subject,
          ticketId:    ticket.id,
          bodyHtml:    wrappedHtml,
          bodyText:    mailgunService.htmlToPlainText(body),
          attachments: toMailgunAttachments(req.files),
        });
        if (!emailResult.success) {
          console.error('[SAV createManual] Envoi mail échoué:', emailResult.error);
          sendFailedFlag = true;
          sendError = emailResult.error;
        }
      }

      // Stocker le 1er message (avec le flag send_failed si l'envoi a échoué)
      await savModel.addMessage(ticket.id, {
        from: agent_name || 'SAV Youvape',
        body,
        is_agent: true,
        is_private: isPrivate,
        attachments: storedAttachments,
        send_failed: sendFailedFlag,
        error: sendError,
      });

      // Détection de doublons (fire-and-forget)
      tagDuplicates(ticket).catch(e => console.warn('[SAV createManual] tagDuplicates échoué:', e.message));

      // Tag BMS sur la commande associée (fire-and-forget, ne bloque pas)
      syncTicketOrderTag({ ...ticket, order_id: order_id || null });

      // Renvoyer le ticket complet (avec enrichissements client, etc.)
      const fullTicket = await savModel.getById(ticket.id);
      res.status(201).json({
        success: true, ticket: fullTicket,
        ...(sendFailedFlag ? { send_failed: true, warning: `Ticket créé mais email non envoyé : ${sendError}` } : {}),
      });

    } catch (error) {
      console.error('❌ [SAV] Erreur création manuelle:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── CRUD statuts ─────────────────────────────────────────────────────────

  // ─── Historique commandes d'un client (avec articles) ───────────────────────
  // Utilisé par NewTicketPage pour afficher l'historique du client sélectionné.
  getCustomerOrders: async (req, res) => {
    try {
      const wpUserId = parseInt(req.params.wp_user_id);
      if (Number.isNaN(wpUserId)) return res.status(400).json({ error: 'wp_user_id invalide' });

      const limit = parseInt(req.query.limit) || 6;
      const ordersRes = await pool.query(
        `SELECT wp_order_id, post_date, post_status, order_total, tracking_number, shipping_carrier
         FROM orders WHERE wp_customer_id = $1
         ORDER BY post_date DESC LIMIT $2`,
        [wpUserId, limit]
      );

      const orders = ordersRes.rows;
      for (const order of orders) {
        const itemsRes = await pool.query(
          `SELECT oi.order_item_name, oi.qty, oi.line_total, p.sku, p.image_url
           FROM order_items oi
           LEFT JOIN products p ON p.wp_product_id = COALESCE(oi.variation_id, oi.product_id)
           WHERE oi.wp_order_id = $1 AND oi.order_item_type = 'line_item'
           ORDER BY oi.id`,
          [order.wp_order_id]
        );
        order.items = itemsRes.rows;
      }

      res.json({ success: true, orders });
    } catch (error) {
      console.error('❌ [SAV] Erreur getCustomerOrders:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Recherche d'une commande par son numéro (création de ticket) ─────────────
  // Renvoie la commande (items + suivi) ET le client associé, pour pré-remplir et
  // lier le demandeur à partir d'un n° de commande. Client enregistré si
  // wp_customer_id matche, sinon client "invité" reconstruit depuis le billing.
  getOrderByRef: async (req, res) => {
    try {
      const orderId = parseInt(req.params.order_id, 10);
      if (Number.isNaN(orderId)) return res.status(400).json({ error: 'N° de commande invalide' });

      const ordersRes = await pool.query(
        `SELECT wp_order_id, wp_customer_id, post_date, post_status, order_total,
                tracking_number, shipping_carrier, shipping_method,
                billing_first_name, billing_last_name, billing_email, billing_phone
         FROM orders WHERE wp_order_id = $1`,
        [orderId]
      );
      if (ordersRes.rows.length === 0) {
        return res.status(404).json({ error: `Commande #${orderId} introuvable` });
      }
      const order = ordersRes.rows[0];

      // Items de la commande (même forme que getCustomerOrders).
      const itemsRes = await pool.query(
        `SELECT oi.order_item_name, oi.qty, oi.line_total, p.sku, p.image_url
         FROM order_items oi
         LEFT JOIN products p ON p.wp_product_id = COALESCE(oi.variation_id, oi.product_id)
         WHERE oi.wp_order_id = $1 AND oi.order_item_type = 'line_item'
         ORDER BY oi.id`,
        [order.wp_order_id]
      );
      order.items = itemsRes.rows;

      // Résolution du client. D'abord par wp_customer_id, sinon par email billing.
      let customer = null;
      if (order.wp_customer_id) {
        const c = await pool.query(
          `SELECT c.id, c.wp_user_id, c.first_name, c.last_name, c.email,
                  (SELECT COUNT(*) FROM orders WHERE wp_customer_id = c.wp_user_id) AS order_count,
                  (SELECT COALESCE(SUM(order_total), 0) FROM orders
                     WHERE wp_customer_id = c.wp_user_id
                       AND post_status = ANY(ARRAY['wc-completed','wc-delivered','wc-processing','wc-awaiting-delivery','wc-shipped','wc-being-delivered'])) AS total_spent
           FROM customers c WHERE c.wp_user_id = $1 LIMIT 1`,
          [order.wp_customer_id]
        );
        if (c.rows.length > 0) customer = c.rows[0];
      }
      if (!customer && order.billing_email) {
        const c = await pool.query(
          `SELECT c.id, c.wp_user_id, c.first_name, c.last_name, c.email,
                  (SELECT COUNT(*) FROM orders WHERE wp_customer_id = c.wp_user_id) AS order_count,
                  (SELECT COALESCE(SUM(order_total), 0) FROM orders
                     WHERE wp_customer_id = c.wp_user_id
                       AND post_status = ANY(ARRAY['wc-completed','wc-delivered','wc-processing','wc-awaiting-delivery','wc-shipped','wc-being-delivered'])) AS total_spent
           FROM customers c WHERE LOWER(c.email) = LOWER($1) LIMIT 1`,
          [order.billing_email]
        );
        if (c.rows.length > 0) customer = c.rows[0];
      }
      // Aucun compte client : on reconstruit un "invité" depuis le billing de la
      // commande, sans id BDD (le ticket sera lié par email à la création).
      if (!customer) {
        customer = {
          id: null,
          wp_user_id: null,
          first_name: order.billing_first_name || '',
          last_name:  order.billing_last_name || '',
          email:      order.billing_email || '',
          order_count: 0,
          total_spent: 0,
          guest: true,
        };
      }
      // Téléphone : pas de colonne sur customers → on prend celui du billing.
      customer.billing_phone = order.billing_phone || '';

      res.json({ success: true, order, customer });
    } catch (error) {
      console.error('❌ [SAV] Erreur getOrderByRef:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Statut livraison transporteur ───────────────────────────────────────────
  getTracking: async (req, res) => {
    try {
      const { number } = req.params;
      const { carrier } = req.query; // shipping_carrier WooCommerce
      const result = await getTrackingStatus(number, carrier || '');
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('❌ [SAV Tracking]:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── CRUD vues ────────────────────────────────────────────────────────────────

  getViews: async (req, res) => {
    try {
      const views = await savViewModel.getAll();
      res.json({ success: true, views });
    } catch (e) {
      console.error('❌ [SAV Views] getViews:', e);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  createView: async (req, res) => {
    try {
      const { label, statuses } = req.body;
      if (!label) return res.status(400).json({ error: 'label requis' });
      const view = await savViewModel.create({ label, statuses: statuses || [] });
      res.status(201).json({ success: true, view });
    } catch (e) {
      console.error('❌ [SAV Views] createView:', e);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  updateView: async (req, res) => {
    try {
      const { id } = req.params;
      const { label, statuses } = req.body;
      if (!label) return res.status(400).json({ error: 'label requis' });
      const view = await savViewModel.update(id, { label, statuses: statuses || [] });
      if (!view) return res.status(404).json({ error: 'Vue introuvable' });
      res.json({ success: true, view });
    } catch (e) {
      console.error('❌ [SAV Views] updateView:', e);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  reorderViews: async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids[] requis' });
      await savViewModel.reorder(ids);
      res.json({ success: true });
    } catch (e) {
      console.error('❌ [SAV Views] reorderViews:', e);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  deleteView: async (req, res) => {
    try {
      await savViewModel.delete(req.params.id);
      res.json({ success: true });
    } catch (e) {
      console.error('❌ [SAV Views] deleteView:', e);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  getStatuses: async (req, res) => {
    try {
      const statuses = await savModel.statusModel.getAll();
      res.json({ success: true, statuses });
    } catch (error) {
      console.error('❌ [SAV Statuts] getStatuses:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  createStatus: async (req, res) => {
    try {
      const { value, label, bg_color, text_color } = req.body;
      if (!value || !label) return res.status(400).json({ error: 'value et label requis' });
      // Slugifier la valeur
      const slug = value.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_éàèùâêîôûäëïöüç-]/g, '');
      const status = await savModel.statusModel.create({ value: slug, label: label.trim(), bg_color, text_color });
      res.status(201).json({ success: true, status });
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Ce statut existe déjà' });
      console.error('❌ [SAV Statuts] createStatus:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  updateStatus_s: async (req, res) => {
    try {
      const { id } = req.params;
      const { label, bg_color, text_color } = req.body;
      if (!label) return res.status(400).json({ error: 'label requis' });
      const status = await savModel.statusModel.update(id, { label, bg_color, text_color });
      if (!status) return res.status(404).json({ error: 'Statut introuvable' });
      res.json({ success: true, status });
    } catch (error) {
      console.error('❌ [SAV Statuts] updateStatus_s:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  deleteStatus: async (req, res) => {
    try {
      const { id } = req.params;
      await savModel.statusModel.delete(id);
      res.json({ success: true });
    } catch (error) {
      console.error('❌ [SAV Statuts] deleteStatus:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },
};

module.exports = savController;
