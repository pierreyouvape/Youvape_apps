const reportEmailModel = require('../models/reportEmailModel');
const { sendMail } = require('./alertService');
const { computeDashboard } = require('../controllers/financierController');

// ─── Libellés des métriques (app Rapport / Financier) ───────────────────────
// Si une nouvelle métrique apparaît dans le dashboard sans entrée ici, elle est
// quand même affichée avec un label humanisé → le rapport email reste dynamique.
const KPI_LABELS = {
  ca_ttc_brut: 'CA TTC Brut',
  ca_ttc_net: 'CA TTC Net',
  ca_ht_net: 'CA HT Net',
  profit_ht: 'Profit HT',
  marge_ht: 'Marge',
  orders_count: 'Nombre de commandes',
  panier_moyen_ht: 'Panier moyen HT',
  refunds_count: 'Commandes remboursées',
  remboursements_ttc: 'Remboursements TTC',
  tva: 'TVA',
  frais_port_client: 'Frais de port facturés',
  frais_port_reel: 'Frais de port réels',
  frais_paiement: 'Frais de paiement',
  cout_produits: 'Coût produits',
};

// Ordre d'affichage souhaité (les clés absentes ici sont ajoutées à la fin).
const KPI_ORDER = [
  'ca_ttc_brut', 'ca_ttc_net', 'ca_ht_net', 'profit_ht', 'marge_ht',
  'orders_count', 'panier_moyen_ht', 'refunds_count', 'remboursements_ttc',
  'tva', 'cout_produits', 'frais_port_reel', 'frais_paiement', 'frais_port_client',
];

// Clés en pourcentage
const PERCENT_KEYS = new Set(['marge_ht']);
// Clés = compteurs (pas de devise)
const COUNT_KEYS = new Set(['orders_count', 'refunds_count']);

function humanizeKey(key) {
  return String(key).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
const num = new Intl.NumberFormat('fr-FR');

function formatKpi(key, value) {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (Number.isNaN(n)) return String(value);
  if (PERCENT_KEYS.has(key)) return `${n.toFixed(1)} %`;
  if (COUNT_KEYS.has(key)) return num.format(Math.round(n));
  return eur.format(n);
}

// ─── Calcul des périodes ────────────────────────────────────────────────────
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const frLong = (d) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
const frMonth = (d) => d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

// Période révolue, calculée "maintenant" (cron à 8h → couvre la période close).
function getPeriod(freq, now = new Date()) {
  if (freq === 'daily') {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    return { dateFrom: fmt(y), dateTo: fmt(y), label: `journée du ${frLong(y)}` };
  }
  if (freq === 'weekly') {
    const mon = new Date(now);
    const day = mon.getDay() === 0 ? 6 : mon.getDay() - 1;
    mon.setDate(mon.getDate() - day - 7);
    const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
    return { dateFrom: fmt(mon), dateTo: fmt(sun), label: `semaine du ${frLong(mon)} au ${frLong(sun)}` };
  }
  if (freq === 'monthly') {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return { dateFrom: fmt(first), dateTo: fmt(last), label: frMonth(first) };
  }
  throw new Error(`Fréquence inconnue: ${freq}`);
}

const FREQ_TITLE = { daily: 'Rapport journalier', weekly: 'Rapport hebdomadaire', monthly: 'Rapport mensuel' };

// Police système (Arial/Helvetica) : disponible sur tous les clients mail.
// On évite volontairement les webfonts (Lato) car Gmail/Outlook les bloquent et
// retombent sur un rendu maigre/délavé, ignorant les font-weight.
const FONT = "Arial,Helvetica,sans-serif";

// ─── Palette (alignée sur l'app /financier) ─────────────────────────────────
// Textes en noir pour un contraste maximal ; les liserés/accents gardent les
// couleurs de l'app.
const COL = {
  saphir: '#135E84', saphirF: '#003A56', orange: '#C97A00', vert: '#2E9E4F',
  rouge: '#C81B1B', bleu: '#0071EB', violet: '#7E47A8',
  noir: '#000000', grisTF: '#111111', grisF: '#1a1a1a', grisM: '#333333',
  grisCL: '#E2E2E2', grisTL: '#F2F6F8', blanc: '#ffffff',
};

function orderedKeys(kpis) {
  const keys = Object.keys(kpis);
  const ordered = KPI_ORDER.filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !KPI_ORDER.includes(k));
  return [...ordered, ...rest];
}

// ─── Cartes KPI (liseré coloré en haut, façon /financier) ────────────────────
function kpiCard(label, value, color, big = false) {
  return `
    <td valign="top" style="padding:6px;" width="33%">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:${COL.blanc};border:1px solid #d9dee4;border-top:4px solid ${color};border-radius:12px;">
        <tr><td style="padding:16px 16px 17px;">
          <div style="font-size:12px;font-weight:700;color:${COL.grisF};text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px;font-family:${FONT};">${label}</div>
          <div style="font-size:${big ? 27 : 21}px;font-weight:800;color:${COL.grisTF};font-family:${FONT};letter-spacing:-0.4px;">${value}</div>
        </td></tr>
      </table>
    </td>`;
}

function kpiRow(cells) {
  const slice = [...cells];
  while (slice.length < 3) slice.push('<td width="33%" style="padding:6px;"></td>');
  return `<tr>${slice.join('')}</tr>`;
}

// Cartes "héros" : les 3 chiffres clés de la page (CA HT Net, Profit HT, Marge)
function heroCardsHtml(k) {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 -6px;">
      ${kpiRow([
        kpiCard(KPI_LABELS.ca_ht_net, formatKpi('ca_ht_net', k.ca_ht_net), COL.saphir, true),
        kpiCard(KPI_LABELS.profit_ht, formatKpi('profit_ht', k.profit_ht), COL.vert, true),
        kpiCard(KPI_LABELS.marge_ht, formatKpi('marge_ht', k.marge_ht), COL.violet, true),
      ])}
    </table>`;
}

// Cartes secondaires (commandes, panier, remboursements)
function secondaryCardsHtml(k) {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:6px -6px 0;">
      ${kpiRow([
        kpiCard(KPI_LABELS.orders_count, formatKpi('orders_count', k.orders_count), COL.bleu),
        kpiCard(KPI_LABELS.panier_moyen_ht, formatKpi('panier_moyen_ht', k.panier_moyen_ht), COL.orange),
        kpiCard(KPI_LABELS.refunds_count, formatKpi('refunds_count', k.refunds_count), COL.rouge),
      ])}
    </table>`;
}

// Bloc "Récapitulatif" : cascade CA → déductions → coûts → profit (comme la page)
function recapHtml(k) {
  const line = (label, value, { color = COL.grisF, bold = false, indent = false } = {}) => `
    <tr>
      <td style="padding:8px 0;font-size:14.5px;color:${COL.grisF};font-weight:${bold ? 800 : 700};font-family:${FONT};${indent ? 'padding-left:16px;' : ''}">${label}</td>
      <td align="right" style="padding:8px 0;font-size:14.5px;color:${color};font-weight:${bold ? 900 : 700};font-family:${FONT};white-space:nowrap;">${value}</td>
    </tr>`;
  const sep = `<tr><td colspan="2" style="border-top:1px solid #e3e7ec;font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>`;

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${COL.blanc};border:1px solid #d9dee4;border-radius:12px;margin-top:18px;">
      <tr><td style="padding:20px 24px;">
        <div style="font-size:16px;font-weight:800;color:${COL.grisTF};font-family:${FONT};margin-bottom:4px;">Récapitulatif</div>
        <div style="font-size:13px;color:${COL.grisM};font-family:${FONT};margin-bottom:12px;">Résumé de la période</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          ${line('CA TTC Brut', formatKpi('ca_ttc_brut', k.ca_ttc_brut))}
          ${line('− Remboursements TTC', '− ' + formatKpi('remboursements_ttc', k.remboursements_ttc))}
          ${line('− TVA', '− ' + formatKpi('tva', k.tva))}
          ${sep}
          ${line('CA HT Net', formatKpi('ca_ht_net', k.ca_ht_net), { bold: true })}
          ${line('— Coût produits', '− ' + formatKpi('cout_produits', k.cout_produits), { indent: true })}
          ${line('— Frais de port réels', '− ' + formatKpi('frais_port_reel', k.frais_port_reel), { indent: true })}
          ${line('— Frais de paiement', '− ' + formatKpi('frais_paiement', k.frais_paiement), { indent: true })}
          ${sep}
          <tr>
            <td style="padding:13px 0 2px;font-size:15.5px;font-weight:900;color:${COL.noir};font-family:${FONT};">Profit HT
              <span style="font-size:12.5px;font-weight:700;color:${COL.grisM};">· marge ${formatKpi('marge_ht', k.marge_ht)}</span>
            </td>
            <td align="right" style="padding:13px 0 2px;font-size:20px;font-weight:900;color:${COL.noir};font-family:${FONT};white-space:nowrap;">${formatKpi('profit_ht', k.profit_ht)}</td>
          </tr>
        </table>
      </td></tr>
    </table>`;
}

function buildHtml(freq, period, dashboard) {
  const k = dashboard?.kpis || {};
  const hasData = (k.orders_count || 0) > 0 || (k.ca_ttc_brut || 0) > 0;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const content = hasData
    ? `${heroCardsHtml(k)}${secondaryCardsHtml(k)}${recapHtml(k)}`
    : `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${COL.blanc};border:1px solid #e6eaee;border-radius:12px;"><tr><td style="padding:32px;text-align:center;color:${COL.grisM};font-family:${FONT};font-size:14px;">Aucune commande sur cette période.</td></tr></table>`;

  return `
  <!DOCTYPE html>
  <html><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      body, table, td, div, span, p { font-family: Arial, Helvetica, sans-serif; }
    </style>
  </head>
  <body style="margin:0;padding:0;background:${COL.grisTL};">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${COL.grisTL};">
      <tr><td align="center" style="padding:26px 16px;">
        <table width="640" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:640px;width:100%;background:${COL.blanc};border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,58,86,0.08);">

          <!-- Bandeau header (dégradé saphir) -->
          <tr><td style="background:${COL.saphirF};background:linear-gradient(135deg,${COL.saphir} 0%,${COL.saphirF} 100%);padding:28px 30px;">
            <div style="font-size:13px;font-weight:700;color:#b3d3e2;text-transform:uppercase;letter-spacing:0.1em;font-family:${FONT};margin-bottom:7px;">📊 Rapport YouVape</div>
            <div style="font-size:25px;font-weight:800;color:#ffffff;font-family:${FONT};letter-spacing:-0.3px;">${FREQ_TITLE[freq]}</div>
            <div style="font-size:15px;color:#cfe5ef;font-family:${FONT};margin-top:5px;">${cap(period.label)}</div>
          </td></tr>

          <!-- Corps -->
          <tr><td style="padding:22px 24px 26px;">
            ${content}
            <div style="margin-top:24px;border-top:1px solid #e3e7ec;padding-top:15px;font-size:12.5px;color:${COL.grisM};font-family:${FONT};line-height:1.6;">
              Période du ${period.dateFrom} au ${period.dateTo}. Rapport généré automatiquement — métriques identiques à l'application Rapport.
            </div>
          </td></tr>

        </table>
      </td></tr>
    </table>
  </body></html>`;
}

// Fallback texte brut (clients mail sans HTML)
function buildText(freq, period, dashboard) {
  const kpis = dashboard?.kpis || {};
  const lines = [
    `${FREQ_TITLE[freq]} — YouVape`,
    `${period.label} (du ${period.dateFrom} au ${period.dateTo})`,
    '',
  ];
  if ((kpis.orders_count || 0) > 0 || (kpis.ca_ttc_brut || 0) > 0) {
    for (const k of orderedKeys(kpis)) {
      lines.push(`${KPI_LABELS[k] || humanizeKey(k)} : ${formatKpi(k, kpis[k])}`);
    }
  } else {
    lines.push('Aucune commande sur cette période.');
  }
  return lines.join('\n');
}

// ─── Génération + envoi ─────────────────────────────────────────────────────
async function renderReport(freq, now = new Date()) {
  const period = getPeriod(freq, now);
  let dashboard = null;
  try {
    dashboard = await computeDashboard({ dateFrom: period.dateFrom, dateTo: period.dateTo });
  } catch (e) {
    console.error(`[ReportEmail] échec calcul dashboard (${freq}):`, e.message);
  }
  const html = buildHtml(freq, period, dashboard);
  const text = buildText(freq, period, dashboard);
  const subject = `${FREQ_TITLE[freq]} — ${period.label}`;
  return { period, html, text, subject, dashboard };
}

// Envoie le rapport d'une fréquence. Aucune adresse → ne fait rien.
async function sendReport(freq, { recipientsOverride = null, now = new Date() } = {}) {
  const recipients = recipientsOverride || (await reportEmailModel.getRecipients(freq));
  if (!recipients || recipients.length === 0) {
    console.log(`📊 [ReportEmail] ${freq}: aucun destinataire, envoi ignoré.`);
    return { sent: false, reason: 'no_recipients' };
  }

  const { html, text, subject } = await renderReport(freq, now);
  const result = await sendMail({ to: recipients, subject, html, text });

  if (result.success) {
    console.log(`📊 [ReportEmail] ${freq} envoyé à ${recipients.join(', ')}`);
  } else {
    console.error(`📊 [ReportEmail] ${freq} échec envoi:`, result.error);
  }
  return { sent: result.success, recipients, error: result.error };
}

module.exports = { getPeriod, renderReport, sendReport, buildHtml, FREQ_TITLE };
