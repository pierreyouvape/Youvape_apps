/**
 * Les deux mails de la simulation « à expédier » (toShipShadowService) :
 * écarts avec BMS, commandes à vérifier. Fonctions pures, testées
 * (`tests/toShip.test.js`).
 */

const { KINDS } = require('./toShipRules');

const STATUS_LABELS = {
  'wc-processing': 'En cours',
  'wc-being-delivered': 'Préparation en cours',
  'wc-awaiting-delivery': 'Retrait boutique',
  'wc-shipped': 'Expédiée',
  'wc-completed': 'Terminée',
  'wc-delivered': 'Livrée',
  'wc-on-hold': 'En attente',
  'wc-cancelled': 'Annulée',
  'wc-refunded': 'Remboursée',
  'wc-pending': 'En attente de paiement',
  'wc-failed': 'Échouée'
};

const KIND_TITLES = {
  [KINDS.BMS_ONLY]: 'Chez BMS seulement : le Picking les perdrait',
  [KINDS.OURS_ONLY]: 'Chez nous seulement : le Picking les aurait en plus',
  [KINDS.LINES]: 'Des deux côtés, articles différents'
};
const KIND_ORDER = [KINDS.BMS_ONLY, KINDS.OURS_ONLY, KINDS.LINES];

const BMS_STATES = {
  same: 'BMS la donne aussi à expédier, mêmes articles',
  different: 'BMS la donne à expédier, avec d\'autres articles',
  absent: 'absente de la liste BMS : le Picking ne la montre pas'
};

const escapeHtml = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const statusLabel = (s) => (s ? STATUS_LABELS[s] || s : 'absente de notre base');
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

const TABLE = 'border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px';
const TH = 'text-align:left;padding:4px 8px;border-bottom:2px solid #ccc';
const TD = 'padding:4px 8px;border-bottom:1px solid #eee;vertical-align:top';

const orderLink = (appUrl, n) => `<a href="${appUrl}/orders/${escapeHtml(n)}">${escapeHtml(n)}</a>`;

/**
 * @param {{order_number, kind, lines: {sku, name?, ours, bms}[], status, paid_label,
 *          shipping_method, first_seen_label, resolved_label}[]} rows
 */
const buildDiffMail = (rows, appUrl) => {
  const subject = `Picking : ${plural(rows.length, 'écart', 'écarts')} entre notre règle et BMS`;
  const html = [];
  const text = [];
  html.push('<p>Commandes « à expédier » sur lesquelles notre règle et BMS ne sont pas d\'accord '
    + '(écart vu sur au moins deux photos et pendant au moins 30 minutes). Simulation : le Picking reste sur BMS.</p>');

  for (const kind of KIND_ORDER) {
    const group = rows.filter(r => r.kind === kind);
    if (!group.length) continue;
    html.push(`<h3 style="font-family:Arial,sans-serif">${KIND_TITLES[kind]} (${group.length})</h3>`);
    html.push(`<table style="${TABLE}"><tr><th style="${TH}">Commande</th><th style="${TH}">Payée le</th>`
      + `<th style="${TH}">Statut site</th><th style="${TH}">Transporteur</th><th style="${TH}">Articles (nous / BMS)</th>`
      + `<th style="${TH}">Vu</th></tr>`);
    text.push(`\n${KIND_TITLES[kind]} (${group.length})`);
    for (const r of group) {
      const lines = (r.lines || []).map(l =>
        `${escapeHtml(l.sku)}${l.name ? ` ${escapeHtml(l.name)}` : ''} : ${l.ours} / ${l.bms}`).join('<br>');
      const seen = `depuis ${escapeHtml(r.first_seen_label)}`
        + (r.resolved_label ? `<br>disparu ${escapeHtml(r.resolved_label)}` : '<br><b>toujours là</b>');
      html.push(`<tr><td style="${TD}">${orderLink(appUrl, r.order_number)}</td>`
        + `<td style="${TD}">${escapeHtml(r.paid_label || '?')}</td>`
        + `<td style="${TD}">${escapeHtml(statusLabel(r.status))}</td>`
        + `<td style="${TD}">${escapeHtml(r.shipping_method || '?')}</td>`
        + `<td style="${TD}">${lines}</td><td style="${TD}">${seen}</td></tr>`);
      text.push(`- ${r.order_number} (payée ${r.paid_label || '?'}, ${statusLabel(r.status)}) : `
        + (r.lines || []).map(l => `${l.sku} ${l.ours}/${l.bms}`).join(', ')
        + (r.resolved_label ? ` — disparu ${r.resolved_label}` : ' — toujours là'));
    }
    html.push('</table>');
  }
  return { subject, html: html.join('\n'), text: text.join('\n').trim() };
};

/**
 * @param {{order_number, paid_label, status, shipping_method,
 *          lines: {sku, name, qty}[], bms: 'same'|'different'|'absent'}[]} rows
 * @param {?string} photoLabel - heure de la photo BMS lue
 */
const buildCheckMail = (rows, appUrl, photoLabel = null) => {
  const subject = `Picking : ${plural(rows.length, 'commande', 'commandes')} à vérifier (payées il y a plus de 3 jours)`;
  const html = [`<p>Commandes encore à expédier d'après notre règle, plus de 3 jours après leur paiement. `
    + `Chacune n'est signalée qu'une fois.${photoLabel ? ` Photo BMS de ${escapeHtml(photoLabel)}.` : ''}</p>`,
  `<table style="${TABLE}"><tr><th style="${TH}">Commande</th><th style="${TH}">Payée le</th>`
    + `<th style="${TH}">Statut site</th><th style="${TH}">Transporteur</th><th style="${TH}">Reste à expédier</th>`
    + `<th style="${TH}">BMS</th></tr>`];
  const text = [];
  for (const r of rows) {
    const lines = (r.lines || []).map(l => `${l.qty} × ${escapeHtml(l.name || l.sku)} (${escapeHtml(l.sku)})`).join('<br>');
    html.push(`<tr><td style="${TD}">${orderLink(appUrl, r.order_number)}</td>`
      + `<td style="${TD}">${escapeHtml(r.paid_label)}</td>`
      + `<td style="${TD}">${escapeHtml(statusLabel(r.status))}</td>`
      + `<td style="${TD}">${escapeHtml(r.shipping_method || '?')}</td>`
      + `<td style="${TD}">${lines}</td>`
      + `<td style="${TD}">${escapeHtml(BMS_STATES[r.bms] || r.bms)}</td></tr>`);
    text.push(`- ${r.order_number} (payée ${r.paid_label}, ${statusLabel(r.status)}, ${r.shipping_method || '?'}) : `
      + (r.lines || []).map(l => `${l.qty} × ${l.sku}`).join(', ') + ` — ${BMS_STATES[r.bms] || r.bms}`);
  }
  html.push('</table>');
  return { subject, html: html.join('\n'), text: text.join('\n') };
};

module.exports = { buildDiffMail, buildCheckMail, statusLabel, STATUS_LABELS, BMS_STATES };
