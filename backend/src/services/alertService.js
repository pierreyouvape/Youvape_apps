const nodemailer = require('nodemailer');
const pool = require('../config/database');

const getConfig = async (key) => {
  const result = await pool.query('SELECT config_value FROM app_config WHERE config_key = $1', [key]);
  return result.rows[0]?.config_value || null;
};

const sendAlert = async (subject, body) => {
  try {
    const [host, port, user, pass, from, to] = await Promise.all([
      getConfig('smtp_host'),
      getConfig('smtp_port'),
      getConfig('smtp_user'),
      getConfig('smtp_pass'),
      getConfig('smtp_from'),
      getConfig('alert_email_to')
    ]);

    if (!host || !user || !pass || !to) {
      console.error('[Alert] Config SMTP manquante, alerte non envoyée:', subject);
      return;
    }

    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(port) || 587,
      secure: false,
      auth: { user, pass }
    });

    await transporter.sendMail({
      from: from || user,
      to,
      subject: `[Youvape] ${subject}`,
      text: body
    });

    console.log('[Alert] Email envoyé:', subject);
  } catch (error) {
    console.error('[Alert] Erreur envoi email:', error.message);
  }
};

module.exports = { sendAlert };
