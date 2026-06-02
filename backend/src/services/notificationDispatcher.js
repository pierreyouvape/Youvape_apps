const savNotificationModel = require('../models/savNotificationModel');
const mailgunService = require('./mailgunService');
const { parseRecipients } = require('../controllers/savNotificationController');

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://apps.youvape.fr';

const TRIGGER_LABEL = {
  new_message:    'Nouveau message reçu',
  reply_received: 'Réponse client reçue',
};

function truncate(s, n = 200) {
  if (!s) return '';
  const t = String(s).trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function buildEmail({ trigger, ticket, message }) {
  const triggerLabel = TRIGGER_LABEL[trigger] || trigger;
  const ticketUrl = `${APP_BASE_URL}/tickets/${ticket.id}`;
  const customer  = ticket.customer_name || ticket.customer_email || 'Client';
  const subject   = `[SAV Youvape] ${triggerLabel} — Ticket #${ticket.id}`;

  const body = message?.body || ticket.description || '';
  const excerpt = truncate(body, 240);

  const textLines = [
    `${triggerLabel} sur le ticket #${ticket.id}.`,
    '',
    `Client : ${customer}`,
    `Email  : ${ticket.customer_email || '—'}`,
    `Sujet  : ${ticket.subject || '—'}`,
    '',
    'Extrait :',
    excerpt || '(aucun contenu)',
    '',
    `Voir le ticket : ${ticketUrl}`,
  ];

  const html = `
    <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333; max-width: 560px;">
      <h2 style="color: #0891B2; margin: 0 0 12px;">${triggerLabel}</h2>
      <p style="margin: 0 0 14px;">Ticket <strong>#${ticket.id}</strong></p>
      <table style="border-collapse: collapse; width: 100%; margin-bottom: 16px;">
        <tr><td style="padding: 4px 12px 4px 0; color: #666; width: 90px;">Client</td><td style="padding: 4px 0;"><strong>${escapeHtml(customer)}</strong></td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #666;">Email</td><td style="padding: 4px 0;">${escapeHtml(ticket.customer_email || '—')}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #666;">Sujet</td><td style="padding: 4px 0;">${escapeHtml(ticket.subject || '—')}</td></tr>
      </table>
      <div style="padding: 12px 14px; background: #F8FAFB; border-left: 3px solid #0891B2; border-radius: 4px; white-space: pre-wrap; word-break: break-word; margin-bottom: 18px;">${escapeHtml(excerpt) || '<em style="color:#999">(aucun contenu)</em>'}</div>
      <a href="${ticketUrl}" style="display: inline-block; background: #0891B2; color: #fff; padding: 9px 18px; border-radius: 6px; text-decoration: none; font-weight: 700;">Ouvrir le ticket →</a>
    </div>
  `;

  return { subject, text: textLines.join('\n'), html };
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Point d'entrée principal ───────────────────────────────────────────────
// Appelé en fire-and-forget : on ne fait jamais échouer l'événement source à
// cause d'une notif qui ne part pas. Les erreurs sont loggées et c'est tout.
async function dispatchNotifications(trigger, ticket, message = null) {
  try {
    const notifs = await savNotificationModel.getActiveByTrigger(trigger);
    if (notifs.length === 0) return;

    const { subject, text, html } = buildEmail({ trigger, ticket, message });

    // Une notif = une règle utilisateur. On envoie un mail par règle (la liste
    // de destinataires de la règle dans le To:).
    await Promise.all(notifs.map(async (n) => {
      if (n.action !== 'email') return;
      const recipients = parseRecipients(n.recipients);
      if (recipients.length === 0) return;
      try {
        await mailgunService.sendNotification({
          to: recipients,
          subject,
          bodyText: text,
          bodyHtml: html,
        });
      } catch (e) {
        console.warn(`[NotifDispatch] règle #${n.id} échouée :`, e.message);
      }
    }));
  } catch (e) {
    console.error('[NotifDispatch] erreur :', e.message);
  }
}

module.exports = { dispatchNotifications };
