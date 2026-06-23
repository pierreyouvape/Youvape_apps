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
// Clés à afficher en rouge (coûts / déductions)
const NEGATIVE_KEYS = new Set(['remboursements_ttc', 'tva', 'cout_produits', 'frais_port_reel', 'frais_paiement']);

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

// ─── Rendu HTML ───────────────────────────────────────────────────────────────
function orderedKeys(kpis) {
  const keys = Object.keys(kpis);
  const ordered = KPI_ORDER.filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !KPI_ORDER.includes(k));
  return [...ordered, ...rest];
}

function kpiCardsHtml(kpis) {
  return orderedKeys(kpis).map((k) => {
    const color = NEGATIVE_KEYS.has(k) ? '#DE2020' : (k === 'profit_ht' ? '#4AB866' : '#2a2e38');
    return `
      <td style="padding:6px;" width="33%" valign="top">
        <div style="background:#fff;border:1px solid #e2e6ea;border-radius:10px;padding:14px 16px;">
          <div style="font-size:11px;font-weight:700;color:#8A99A4;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">${KPI_LABELS[k] || humanizeKey(k)}</div>
          <div style="font-size:20px;font-weight:800;color:${color};">${formatKpi(k, kpis[k])}</div>
        </div>
      </td>`;
  });
}

// Met les cartes en lignes de 3 (compatibilité email = tables)
function kpiGridHtml(kpis) {
  const cells = kpiCardsHtml(kpis);
  let rows = '';
  for (let i = 0; i < cells.length; i += 3) {
    const slice = cells.slice(i, i + 3);
    while (slice.length < 3) slice.push('<td width="33%"></td>');
    rows += `<tr>${slice.join('')}</tr>`;
  }
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>`;
}

function buildHtml(freq, period, dashboard) {
  const kpis = dashboard?.kpis || {};
  const hasData = (kpis.orders_count || 0) > 0 || (kpis.ca_ttc_brut || 0) > 0;

  return `
  <div style="font-family:Lato,Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px;background:#f2f6f8;">
    <div style="background:#fff;border-radius:14px;padding:28px 26px;border:1px solid #e2e6ea;">
      <div style="margin-bottom:4px;">
        <span style="font-size:22px;">📊</span>
        <span style="font-size:20px;font-weight:800;color:#2a2e38;vertical-align:middle;margin-left:6px;">${FREQ_TITLE[freq]} — YouVape</span>
      </div>
      <p style="margin:0 0 2px;color:#8A99A4;font-size:13px;text-transform:capitalize;">${period.label}</p>
      <p style="margin:0 0 18px;color:#aab3bd;font-size:12px;">Du ${period.dateFrom} au ${period.dateTo}</p>
      ${hasData
        ? kpiGridHtml(kpis)
        : '<p style="color:#8A99A4;margin:24px 0;">Aucune commande sur cette période.</p>'}
      <p style="margin-top:28px;color:#aab3bd;font-size:11px;border-top:1px solid #eef0f3;padding-top:16px;line-height:1.6;">
        Rapport généré automatiquement par l'application Rapport YouVape. Les métriques sont identiques à celles affichées dans l'application.
      </p>
    </div>
  </div>`;
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
  const subject = `[YouVape] ${FREQ_TITLE[freq]} — ${period.label}`;
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
