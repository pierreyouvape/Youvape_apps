const fs = require('fs');
const path = require('path');

// ─── Service d'enrobage des emails SAV par les templates HTML ────────────────
// Les templates (faits par le graphiste) vivent dans src/templates/email/ et
// contiennent des placeholders {{nom}}. On les charge une fois en mémoire et on
// substitue les valeurs à l'envoi.

const TEMPLATE_DIR = path.join(__dirname, '..', 'templates', 'email');

// URL publique du logo affiché dans les emails. Servi par le frontend en prod.
// Surchargeable par env var si besoin (ex. CDN).
const LOGO_URL = process.env.SAV_EMAIL_LOGO_URL
  || 'https://www.youvape.fr/wp-content/uploads/2026/01/logo-couleur-fond.png';

const FILES = {
  reponse: 'sav-reponse.html',
  accuse:  'sav-accuse-reception.html',
};

// Cache des templates chargés (clé → HTML brut).
const _cache = {};

function loadTemplate(key) {
  if (_cache[key]) return _cache[key];
  const file = FILES[key];
  if (!file) throw new Error(`Template email inconnu : ${key}`);
  const html = fs.readFileSync(path.join(TEMPLATE_DIR, file), 'utf8');
  _cache[key] = html;
  return html;
}

// Échappe une valeur destinée à un contexte HTML (placeholders texte).
// NB : on n'échappe PAS message_body, qui est du HTML déjà sanitisé en amont.
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Remplace les {{placeholders}} du template. `rawHtmlKeys` liste les clés dont
// la valeur est déjà du HTML sûr et ne doit pas être échappée (message_body).
function render(key, values, rawHtmlKeys = []) {
  const tpl = loadTemplate(key);
  const merged = { year: new Date().getFullYear(), logo_url: LOGO_URL, ...values };
  return tpl.replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, name) => {
    if (!(name in merged)) return ''; // placeholder non fourni → vide
    const val = merged[name];
    return rawHtmlKeys.includes(name) ? String(val == null ? '' : val) : escapeHtml(val);
  });
}

const emailTemplateService = {
  LOGO_URL,

  // Email de réponse agent. messageBodyHtml = HTML déjà sanitisé du message.
  renderReponse: ({ customer_name, subject, ticket_id, messageBodyHtml }) =>
    render('reponse', {
      customer_name, subject, ticket_id,
      message_body: messageBodyHtml || '',
    }, ['message_body']),

  // Email d'accusé de réception (pas de corps de message).
  renderAccuse: ({ customer_name, subject, ticket_id }) =>
    render('accuse', { customer_name, subject, ticket_id }),
};

module.exports = emailTemplateService;
