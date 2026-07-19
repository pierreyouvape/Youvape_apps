const reportEmailModel = require('../models/reportEmailModel');
const { sendMail } = require('./alertService');
const { computeDashboard, computeByCountry } = require('../controllers/financierController');

// Code ISO pays → nom FR (mêmes libellés que l'app Stats/Commandes).
const COUNTRY_NAMES = {
  FR: 'France', BE: 'Belgique', CH: 'Suisse', DE: 'Allemagne', ES: 'Espagne',
  IT: 'Italie', NL: 'Pays-Bas', PT: 'Portugal', GB: 'Royaume-Uni', LU: 'Luxembourg',
  AT: 'Autriche', IE: 'Irlande', PL: 'Pologne', CZ: 'Tchéquie', DK: 'Danemark',
  SE: 'Suède', NO: 'Norvège', FI: 'Finlande', GR: 'Grèce', HU: 'Hongrie',
  RO: 'Roumanie', BG: 'Bulgarie', HR: 'Croatie', SK: 'Slovaquie', SI: 'Slovénie',
  EE: 'Estonie', LV: 'Lettonie', LT: 'Lituanie', MT: 'Malte', CY: 'Chypre',
  US: 'États-Unis', CA: 'Canada', AU: 'Australie', JP: 'Japon', CN: 'Chine',
  GP: 'Guadeloupe', MQ: 'Martinique', GF: 'Guyane', RE: 'Réunion', YT: 'Mayotte',
  NC: 'Nouvelle-Calédonie', PF: 'Polynésie', MC: 'Monaco', MA: 'Maroc', TN: 'Tunisie',
  DZ: 'Algérie', SN: 'Sénégal', CI: "Côte d'Ivoire",
};
const countryName = (code) => COUNTRY_NAMES[code] || (code === '??' ? 'Inconnu' : code);

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
  nouveaux_clients: 'Nouveaux clients inscrits',
  nouveaux_clients_commande: 'Nouveaux clients ayant commandé',
};

// Ordre d'affichage souhaité (les clés absentes ici sont ajoutées à la fin).
const KPI_ORDER = [
  'ca_ttc_brut', 'ca_ttc_net', 'ca_ht_net', 'profit_ht', 'marge_ht',
  'orders_count', 'panier_moyen_ht', 'nouveaux_clients', 'nouveaux_clients_commande',
  'refunds_count', 'remboursements_ttc',
  'tva', 'cout_produits', 'frais_port_reel', 'frais_paiement', 'frais_port_client',
];

// Clés en pourcentage
const PERCENT_KEYS = new Set(['marge_ht']);
// Clés = compteurs (pas de devise)
const COUNT_KEYS = new Set(['orders_count', 'refunds_count', 'nouveaux_clients', 'nouveaux_clients_commande']);

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

// Période révolue, calculée "maintenant" (cron à 6h → couvre la période close).
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

// Période de comparaison précédente (même durée, décalée d'une unité).
function getPrevPeriod(freq, now = new Date()) {
  if (freq === 'daily') {
    // Avant-hier vs hier
    const y = new Date(now); y.setDate(y.getDate() - 2);
    return { dateFrom: fmt(y), dateTo: fmt(y), label: `journée du ${frLong(y)}` };
  }
  if (freq === 'weekly') {
    // Semaine d'avant la semaine du rapport
    const mon = new Date(now);
    const day = mon.getDay() === 0 ? 6 : mon.getDay() - 1;
    mon.setDate(mon.getDate() - day - 14);
    const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
    return { dateFrom: fmt(mon), dateTo: fmt(sun), label: `semaine du ${frLong(mon)} au ${frLong(sun)}` };
  }
  if (freq === 'monthly') {
    // Mois d'avant le mois du rapport
    const first = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const last = new Date(now.getFullYear(), now.getMonth() - 1, 0);
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
// type: 'eur' | 'pct' | 'count'
function formatDelta(current, prev, type = 'eur') {
  if (prev === null || prev === undefined || prev === 0) return null;
  const delta = ((current - prev) / Math.abs(prev)) * 100;
  const arrow = delta >= 0 ? '▲' : '▼';
  const col = delta >= 0 ? COL.vert : COL.rouge;
  const abs = current - prev;
  let absStr;
  if (type === 'pct')   absStr = `${abs >= 0 ? '+' : ''}${abs.toFixed(1)} pts`;
  else if (type === 'count') absStr = `${abs >= 0 ? '+' : ''}${num.format(Math.round(abs))}`;
  else                  absStr = `${abs >= 0 ? '+' : ''}${eur.format(abs)}`;
  return { arrow, pct: Math.abs(delta).toFixed(1), col, absStr };
}

function kpiCard(label, value, color, big = false, delta = null) {
  const deltaHtml = delta
    ? `<div style="margin-top:6px;font-size:12px;font-weight:700;color:${delta.col};font-family:${FONT};">
         ${delta.arrow} ${delta.pct}%
         <span style="font-weight:600;"> · ${delta.absStr}</span>
         <span style="color:${COL.grisM};font-weight:500;font-size:11px;"> vs période préc.</span>
       </div>`
    : '';
  return `
    <td valign="top" style="padding:6px;" width="33%">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:${COL.blanc};border:1px solid #d9dee4;border-top:4px solid ${color};border-radius:12px;">
        <tr><td class="yv-card-pad" style="padding:16px 16px 17px;">
          <div style="font-size:12px;font-weight:700;color:${COL.grisF};text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px;font-family:${FONT};">${label}</div>
          <div class="${big ? 'yv-card-value-big' : 'yv-card-value'}" style="font-size:${big ? 27 : 21}px;font-weight:800;color:${COL.grisTF};font-family:${FONT};letter-spacing:-0.4px;">${value}</div>
          ${deltaHtml}
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
function heroCardsHtml(k, pk) {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 -6px;">
      ${kpiRow([
        kpiCard(KPI_LABELS.ca_ht_net, formatKpi('ca_ht_net', k.ca_ht_net), COL.saphir, true, pk ? formatDelta(k.ca_ht_net, pk.ca_ht_net, 'eur') : null),
        kpiCard(KPI_LABELS.profit_ht, formatKpi('profit_ht', k.profit_ht), COL.vert, true, pk ? formatDelta(k.profit_ht, pk.profit_ht, 'eur') : null),
        kpiCard(KPI_LABELS.marge_ht, formatKpi('marge_ht', k.marge_ht), COL.violet, true, pk ? formatDelta(k.marge_ht, pk.marge_ht, 'pct') : null),
      ])}
    </table>`;
}

// Cartes secondaires (commandes, panier, remboursements)
function secondaryCardsHtml(k, pk) {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:6px -6px 0;">
      ${kpiRow([
        kpiCard(KPI_LABELS.orders_count, formatKpi('orders_count', k.orders_count), COL.bleu, false, pk ? formatDelta(k.orders_count, pk.orders_count, 'count') : null),
        kpiCard(KPI_LABELS.panier_moyen_ht, formatKpi('panier_moyen_ht', k.panier_moyen_ht), COL.orange, false, pk ? formatDelta(k.panier_moyen_ht, pk.panier_moyen_ht, 'eur') : null),
        kpiCard(KPI_LABELS.refunds_count, formatKpi('refunds_count', k.refunds_count), COL.rouge, false, pk ? formatDelta(k.refunds_count, pk.refunds_count, 'count') : null),
      ])}
    </table>`;
}

// Cartes nouveaux clients (inscrits sur la période + parmi eux, ceux ayant commandé)
function newCustomersCardsHtml(k, pk) {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:6px -6px 0;">
      ${kpiRow([
        kpiCard(KPI_LABELS.nouveaux_clients, formatKpi('nouveaux_clients', k.nouveaux_clients), COL.violet, false, pk ? formatDelta(k.nouveaux_clients, pk.nouveaux_clients, 'count') : null),
        kpiCard(KPI_LABELS.nouveaux_clients_commande, formatKpi('nouveaux_clients_commande', k.nouveaux_clients_commande), COL.vert, false, pk ? formatDelta(k.nouveaux_clients_commande, pk.nouveaux_clients_commande, 'count') : null),
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

// Bloc "Total par pays" : CA TTC + CA HT + nb commandes par pays (CA décroissant)
function countryHtml(rows) {
  if (!rows || rows.length === 0) return '';

  const th = (label, align = 'left', cls = '') => `<td align="${align}" class="yv-ctable-cell ${cls}" style="padding:8px 6px;font-size:11.5px;font-weight:800;color:${COL.grisM};text-transform:uppercase;letter-spacing:0.04em;font-family:${FONT};border-bottom:2px solid #e3e7ec;${align === 'right' ? 'white-space:nowrap;' : ''}">${label}</td>`;
  const td = (value, { align = 'left', bold = false, color = COL.grisF, cls = '' } = {}) => `<td align="${align}" class="yv-ctable-cell ${cls}" style="padding:9px 6px;font-size:14px;color:${color};font-weight:${bold ? 800 : 600};font-family:${FONT};border-bottom:1px solid #eef1f4;${align === 'right' ? 'white-space:nowrap;' : ''}">${value}</td>`;

  const totalTtc = rows.reduce((s, r) => s + (r.ca_ttc_brut || 0), 0);
  const totalHt = rows.reduce((s, r) => s + (r.ca_ht || 0), 0);
  const totalOrders = rows.reduce((s, r) => s + (r.orders_count || 0), 0);
  const totalPanier = totalOrders > 0 ? totalHt / totalOrders : 0;

  // Nom de pays tronqué (ellipsis) : évite qu'un nom long ("Nouvelle-Calédonie")
  // n'élargisse la colonne et ne pousse le tableau hors de l'écran sur mobile.
  const countryCell = (code) => `<span class="yv-country-name" style="display:inline-block;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom;">${countryName(code)}</span>`;

  const body = rows.map((r) => `
    <tr>
      ${td(countryCell(r.country_code))}
      ${td(num.format(r.orders_count), { align: 'right' })}
      ${td(eur.format(r.ca_ttc_brut), { align: 'right' })}
      ${td(eur.format(r.ca_ht), { align: 'right', bold: true, color: COL.saphir })}
      ${td(eur.format(r.panier_moyen_ht), { align: 'right', cls: 'yv-hide-mobile' })}
    </tr>`).join('');

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${COL.blanc};border:1px solid #d9dee4;border-radius:12px;margin-top:18px;">
      <tr><td class="yv-card-pad-lg" style="padding:20px 24px;">
        <div style="font-size:16px;font-weight:800;color:${COL.grisTF};font-family:${FONT};margin-bottom:4px;">Total par pays</div>
        <div style="font-size:13px;color:${COL.grisM};font-family:${FONT};margin-bottom:12px;">CA par pays de facturation, du plus élevé au plus faible</div>
        <!-- Conteneur scrollable en secours si le tableau ne tient pas malgré la
             réduction de police/marges mobile (cf. media query dans <head>). -->
        <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;min-width:300px;">
          <tr>
            ${th('Pays')}
            ${th('Cmd.', 'right')}
            ${th('CA TTC', 'right')}
            ${th('CA HT', 'right')}
            ${th('Panier moy. HT', 'right', 'yv-hide-mobile')}
          </tr>
          ${body}
          <tr>
            ${td('Total', { bold: true })}
            ${td(num.format(totalOrders), { align: 'right', bold: true })}
            ${td(eur.format(totalTtc), { align: 'right', bold: true })}
            ${td(eur.format(totalHt), { align: 'right', bold: true, color: COL.saphir })}
            ${td(eur.format(totalPanier), { align: 'right', bold: true, cls: 'yv-hide-mobile' })}
          </tr>
        </table>
        </div>
      </td></tr>
    </table>`;
}

function buildHtml(freq, period, dashboard, countries, prevDashboard, prevPeriod) {
  const k = dashboard?.kpis || {};
  const pk = prevDashboard?.kpis || null;
  const hasData = (k.orders_count || 0) > 0 || (k.ca_ttc_brut || 0) > 0;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const content = hasData
    ? `${heroCardsHtml(k, pk)}${secondaryCardsHtml(k, pk)}${newCustomersCardsHtml(k, pk)}${recapHtml(k)}${countryHtml(countries)}`
    : `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${COL.blanc};border:1px solid #e6eaee;border-radius:12px;"><tr><td style="padding:32px;text-align:center;color:${COL.grisM};font-family:${FONT};font-size:14px;">Aucune commande sur cette période.</td></tr></table>`;

  return `
  <!DOCTYPE html>
  <html><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      body, table, td, div, span, p { font-family: Arial, Helvetica, sans-serif; }
      /* Lisibilité mobile (Gmail app/web) : réduit marges, polices, et masque la
         colonne la moins critique du tableau pays plutôt que de la laisser
         écraser les autres colonnes ou forcer un scroll horizontal illisible. */
      @media only screen and (max-width: 480px) {
        .yv-outer-pad     { padding: 14px 8px !important; }
        .yv-header-pad    { padding: 20px 16px !important; }
        .yv-header-title  { font-size: 21px !important; }
        .yv-body-pad      { padding: 16px 12px 20px !important; }
        .yv-card-pad      { padding: 12px 12px 13px !important; }
        .yv-card-pad-lg   { padding: 16px 14px !important; }
        .yv-card-value    { font-size: 18px !important; }
        .yv-card-value-big{ font-size: 21px !important; }
        .yv-ctable-cell   { padding: 7px 4px !important; font-size: 12px !important; }
        .yv-country-name  { max-width: 68px !important; }
        .yv-hide-mobile   { display: none !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:${COL.grisTL};">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${COL.grisTL};">
      <tr><td align="center" class="yv-outer-pad" style="padding:26px 16px;">
        <table width="640" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:640px;width:100%;background:${COL.blanc};border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,58,86,0.08);">

          <!-- Bandeau header (dégradé saphir) -->
          <tr><td class="yv-header-pad" style="background:${COL.saphirF};background:linear-gradient(135deg,${COL.saphir} 0%,${COL.saphirF} 100%);padding:28px 30px;">
            <div style="font-size:13px;font-weight:700;color:#b3d3e2;text-transform:uppercase;letter-spacing:0.1em;font-family:${FONT};margin-bottom:7px;">📊 Rapport YouVape</div>
            <div class="yv-header-title" style="font-size:25px;font-weight:800;color:#ffffff;font-family:${FONT};letter-spacing:-0.3px;">${FREQ_TITLE[freq]}</div>
            <div style="font-size:15px;color:#cfe5ef;font-family:${FONT};margin-top:5px;">${cap(period.label)}</div>
            ${prevPeriod ? `<div style="font-size:12px;color:#8bbfd4;font-family:${FONT};margin-top:3px;">Comparé à : ${cap(prevPeriod.label)}</div>` : ''}
          </td></tr>

          <!-- Corps -->
          <tr><td class="yv-body-pad" style="padding:22px 24px 26px;">
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
function buildText(freq, period, dashboard, countries, prevDashboard, prevPeriod) {
  const kpis = dashboard?.kpis || {};
  const pk = prevDashboard?.kpis || null;
  const lines = [
    `${FREQ_TITLE[freq]} — YouVape`,
    `${period.label} (du ${period.dateFrom} au ${period.dateTo})`,
    prevPeriod ? `Comparé à : ${prevPeriod.label}` : '',
    '',
  ];
  if ((kpis.orders_count || 0) > 0 || (kpis.ca_ttc_brut || 0) > 0) {
    for (const k of orderedKeys(kpis)) {
      let line = `${KPI_LABELS[k] || humanizeKey(k)} : ${formatKpi(k, kpis[k])}`;
      if (pk && pk[k] !== undefined && pk[k] !== 0) {
        const delta = ((kpis[k] - pk[k]) / Math.abs(pk[k])) * 100;
        const abs = kpis[k] - pk[k];
        const absStr = COUNT_KEYS.has(k)
          ? `${abs >= 0 ? '+' : ''}${num.format(Math.round(abs))}`
          : PERCENT_KEYS.has(k)
            ? `${abs >= 0 ? '+' : ''}${abs.toFixed(1)} pts`
            : `${abs >= 0 ? '+' : ''}${eur.format(abs)}`;
        line += `  (${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)}% · ${absStr})`;
      }
      lines.push(line);
    }
    if (countries && countries.length > 0) {
      lines.push('', 'Total par pays (CA TTC / CA HT / commandes / panier moyen HT) :');
      for (const c of countries) {
        lines.push(`  ${countryName(c.country_code)} : ${eur.format(c.ca_ttc_brut)} / ${eur.format(c.ca_ht)} / ${num.format(c.orders_count)} / ${eur.format(c.panier_moyen_ht)}`);
      }
    }
  } else {
    lines.push('Aucune commande sur cette période.');
  }
  return lines.join('\n');
}

// ─── Génération + envoi ─────────────────────────────────────────────────────
async function renderReport(freq, now = new Date()) {
  const period = getPeriod(freq, now);
  const prevPeriod = getPrevPeriod(freq, now);
  let dashboard = null;
  let prevDashboard = null;
  let countries = [];
  try {
    [dashboard, prevDashboard, countries] = await Promise.all([
      computeDashboard({ dateFrom: period.dateFrom, dateTo: period.dateTo }),
      computeDashboard({ dateFrom: prevPeriod.dateFrom, dateTo: prevPeriod.dateTo }),
      computeByCountry({ dateFrom: period.dateFrom, dateTo: period.dateTo }),
    ]);
  } catch (e) {
    console.error(`[ReportEmail] échec calcul dashboard (${freq}):`, e.message);
  }
  const html = buildHtml(freq, period, dashboard, countries, prevDashboard, prevPeriod);
  const text = buildText(freq, period, dashboard, countries, prevDashboard, prevPeriod);
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
