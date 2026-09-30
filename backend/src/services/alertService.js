const nodemailer = require('nodemailer');
const mailgunService = require('./mailgunService');
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
 * Envoi générique de courrier INTERNE. Mailgun d'abord, SMTP en repli.
 *
 * POURQUOI MAILGUN D'ABORD — appris le 30/09/2026, au prix de plusieurs jours
 * d'alertes VPS perdues sans que personne ne s'en aperçoive : le silence a été
 * lu comme « tout va bien ». Le SMTP sortait d'un compte Gmail nu
 * (alerte.youvape@gmail.com), qui n'a ni SPF ni DKIM sur le domaine youvape.fr.
 * Gmail répondait « 250 OK » — le message était bien parti — et l'antispam
 * d'OVH le retenait à l'arrivée. Un envoi accepté n'est pas un envoi délivré,
 * et SMTP ne sait pas faire la différence.
 *
 * Mailgun envoie depuis un domaine vérifié (SPF + DKIM) et rend un id de
 * message, qui permet ensuite de lui DEMANDER si le message a été délivré.
 *
 * POURQUOI GARDER LE REPLI SMTP : une alerte ne doit jamais mourir parce qu'un
 * transporteur est indisponible. Les pièces jointes passent aussi par SMTP —
 * l'API Mailgun attend un autre format, et les rapports en envoient.
 *
 * @returns {Promise<{success:boolean, via?:string, id?:string, error?:string}>}
 *          `via` dit par où c'est parti : c'est cette information qui manquait.
 */
const sendMail = async ({ to, subject, text, html, attachments }) => {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (recipients.length === 0) return { success: false, error: 'Aucun destinataire' };

  const fullSubject = subject.startsWith('[Youvape]') ? subject : `[Youvape] ${subject}`;
  const avecPJ = Array.isArray(attachments) && attachments.length > 0;
  const echecs = [];

  // 1. Mailgun — sauf pièces jointes, que seul le chemin SMTP sait porter.
  if (!avecPJ) {
    try {
      const mg = await mailgunService.sendInternal({ to: recipients, subject: fullSubject, text, html });
      if (mg.success) {
        console.log(`[Mail] Envoyé via Mailgun (${mg.id}) : ${fullSubject} → ${recipients.join(', ')}`);
        return { success: true, via: 'mailgun', id: mg.id };
      }
      echecs.push(`Mailgun : ${mg.error}`);
      console.warn(`[Mail] Mailgun a refusé « ${fullSubject} » (${mg.error}) — repli sur SMTP.`);
    } catch (e) {
      echecs.push(`Mailgun : ${e.message}`);
      console.warn(`[Mail] Mailgun indisponible (${e.message}) — repli sur SMTP.`);
    }
  }

  // 2. SMTP.
  try {
    const cfg = await buildTransporter();
    if (!cfg) {
      echecs.push('SMTP : configuration manquante');
      console.error('[Mail] Aucun transporteur disponible, email NON envoyé :', fullSubject);
      return { success: false, error: echecs.join(' | ') };
    }

    const msg = { from: cfg.from, to: recipients.join(', '), subject: fullSubject };
    if (text) msg.text = text;
    if (html) msg.html = html;
    if (avecPJ) msg.attachments = attachments;

    // La réponse de nodemailer était jetée : c'est elle qui dit QUI le serveur a
    // accepté et ce qu'il a répondu. Sans elle, il a fallu rejouer un envoi à la
    // main pour comprendre que le message partait bien.
    const info = await cfg.transporter.sendMail(msg);
    console.log(`[Mail] Envoyé via SMTP : ${fullSubject} → ${(info.accepted || recipients).join(', ')}`
      + ` | ${info.response || ''}`);
    if (Array.isArray(info.rejected) && info.rejected.length > 0) {
      console.warn(`[Mail] Destinataires REFUSÉS : ${info.rejected.join(', ')}`);
    }
    return { success: true, via: 'smtp', id: info.messageId, response: info.response };
  } catch (error) {
    echecs.push(`SMTP : ${error.message}`);
    console.error('[Mail] Erreur envoi email:', echecs.join(' | '));
    return { success: false, error: echecs.join(' | ') };
  }
};

const sendAlert = async (subject, body) => {
  const to = await getConfig('alert_email_to');
  if (!to) {
    console.error('[Alert] Config SMTP/destinataire manquante, alerte non envoyée:', subject);
    return;
  }
  const res = await sendMail({ to, subject, text: body });
  // Un échec ne disait RIEN : c'est ainsi que des jours d'alertes VPS se sont
  // perdus sans que personne ne le voie. Une alerte qui ne part pas est elle-même
  // un incident, et doit crier.
  if (res.success) console.log(`[Alert] Email envoyé via ${res.via} :`, subject);
  else console.error(`[Alert] ÉCHEC D'ENVOI DE L'ALERTE « ${subject} » → ${to} : ${res.error}`);
  return res;
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
  if (res.success) console.log(`[Alert] Email avec PJ envoyé via ${res.via} :`, subject);
  else console.error(`[Alert] ÉCHEC D'ENVOI DE L'ALERTE « ${subject} » → ${to} : ${res.error}`);
  return res;
};

module.exports = { sendAlert, sendAlertWithAttachments, sendMail };
