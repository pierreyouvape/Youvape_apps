const FormData = require('form-data');
const Mailgun = require('mailgun.js');
const crypto = require('crypto');

const mailgun = new Mailgun(FormData);
const mg = mailgun.client({
  username: 'api',
  key: process.env.MAILGUN_API_KEY,
  url: process.env.MAILGUN_BASE_URL || 'https://api.mailgun.net',
});

const DOMAIN = process.env.MAILGUN_DOMAIN;
const FROM   = process.env.MAILGUN_FROM;

const mailgunService = {

  // ─── Envoyer une réponse agent au client ─────────────────────────────────
  sendReply: async ({ to, subject, ticketId, bodyText, bodyHtml }) => {
    try {
      // Le sujet contient le ticket ID pour matcher les réponses entrantes
      const fullSubject = subject.includes(`[SAV #${ticketId}]`)
        ? subject
        : `[SAV #${ticketId}] ${subject}`;

      const messageData = {
        from: FROM,
        to: [to],
        subject: fullSubject,
        text: bodyText,
        'h:Reply-To': FROM,
      };

      if (bodyHtml) {
        messageData.html = bodyHtml;
      }

      const result = await mg.messages.create(DOMAIN, messageData);
      console.log(`📧 [Mailgun] Email envoyé au client ${to} pour ticket #${ticketId}`);
      return { success: true, id: result.id };

    } catch (error) {
      console.error(`❌ [Mailgun] Erreur envoi email ticket #${ticketId}:`, error.message);
      return { success: false, error: error.message };
    }
  },

  // ─── Vérifier la signature d'un webhook Mailgun entrant ──────────────────
  verifyWebhookSignature: (timestamp, token, signature) => {
    try {
      const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY || process.env.MAILGUN_API_KEY;
      const value = timestamp + token;
      const hash = crypto
        .createHmac('sha256', signingKey)
        .update(value)
        .digest('hex');
      return hash === signature;
    } catch (e) {
      return false;
    }
  },

  // ─── Extraire le ticket ID depuis le sujet d'un email entrant ────────────
  extractTicketIdFromSubject: (subject) => {
    if (!subject) return null;
    const match = subject.match(/\[SAV #(\d+)\]/i);
    return match ? parseInt(match[1]) : null;
  },

  // ─── Test de connexion Mailgun ────────────────────────────────────────────
  testConnection: async () => {
    try {
      await mg.domains.get(DOMAIN);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
};

module.exports = mailgunService;
