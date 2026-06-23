const nodemailer = require('nodemailer');
const pool = require('../config/database');

const getConfig = async (key) => {
  const result = await pool.query('SELECT config_value FROM app_config WHERE config_key = $1', [key]);
  return result.rows[0]?.config_value || null;
};

// Construit un transporteur nodemailer à partir de la config SMTP en BDD
// (même config que les alertes de bug VPS). Retourne { transporter, from } ou
// null si la config est incomplète.
const buildTransporter = async () => {
  const [host, port, user, pass, from] = await Promise.all([
    getConfig('smtp_host'),
    getConfig('smtp_port'),
    getConfig('smtp_user'),
    getConfig('smtp_pass'),
    getConfig('smtp_from'),
  ]);

  if (!host || !user || !pass) return null;

  const transporter = nodemailer.createTransport({
    host,
    port: parseInt(port) || 587,
    secure: false,
    auth: { user, pass },
  });

  return { transporter, from: from || user };
};

/**
 * Envoi générique via SMTP (nodemailer). Destinataires et contenu libres.
 * @param {Object} opts
 * @param {string|string[]} opts.to    - destinataire(s)
 * @param {string} opts.subject        - sujet (préfixé [Youvape] si absent)
 * @param {string} [opts.text]         - corps texte
 * @param {string} [opts.html]         - corps HTML
 * @param {Array}  [opts.attachments]  - pièces jointes nodemailer
 * @returns {Promise<{success:boolean, error?:string}>}
 */
const sendMail = async ({ to, subject, text, html, attachments }) => {
  try {
    const recipients = Array.isArray(to) ? to : [to];
    if (recipients.filter(Boolean).length === 0) {
      return { success: false, error: 'Aucun destinataire' };
    }

    const cfg = await buildTransporter();
    if (!cfg) {
      console.error('[Mail] Config SMTP manquante, email non envoyé:', subject);
      return { success: false, error: 'Config SMTP manquante' };
    }

    const fullSubject = subject.startsWith('[Youvape]') ? subject : `[Youvape] ${subject}`;
    const msg = { from: cfg.from, to: recipients.join(', '), subject: fullSubject };
    if (text) msg.text = text;
    if (html) msg.html = html;
    if (Array.isArray(attachments) && attachments.length) msg.attachments = attachments;

    await cfg.transporter.sendMail(msg);
    console.log('[Mail] Email envoyé:', fullSubject, '→', recipients.join(', '));
    return { success: true };
  } catch (error) {
    console.error('[Mail] Erreur envoi email:', error.message);
    return { success: false, error: error.message };
  }
};

const sendAlert = async (subject, body) => {
  const to = await getConfig('alert_email_to');
  if (!to) {
    console.error('[Alert] Config SMTP/destinataire manquante, alerte non envoyée:', subject);
    return;
  }
  const res = await sendMail({ to, subject, text: body });
  if (res.success) console.log('[Alert] Email envoyé:', subject);
};

/**
 * Envoyer une alerte avec pieces jointes
 * @param {string} subject
 * @param {string} body
 * @param {Array} attachments - [{filename: 'file.csv', content: 'csv string'}]
 */
const sendAlertWithAttachments = async (subject, body, attachments = []) => {
  const to = await getConfig('alert_email_to');
  if (!to) {
    console.error('[Alert] Config SMTP/destinataire manquante, alerte non envoyée:', subject);
    return;
  }
  const res = await sendMail({ to, subject, text: body, attachments });
  if (res.success) console.log('[Alert] Email avec PJ envoyé:', subject);
};

module.exports = { sendAlert, sendAlertWithAttachments, sendMail };
