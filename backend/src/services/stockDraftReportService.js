const pool = require('../config/database');
const { sendMail } = require('./alertService');

// Destinataire du rapport hebdomadaire "stock hors statut publié"
const RECIPIENT = 'youvape34@gmail.com';

const round2 = (n) => Math.round((parseFloat(n) + Number.EPSILON) * 100) / 100;
const fmtEur = (n) => round2(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STATUS_LABELS = {
  draft: 'Brouillon', private: 'Privé', pending: 'En attente', trash: 'Corbeille',
  'auto-draft': 'Brouillon auto', future: 'Planifié',
};
const statusLabel = (s) => STATUS_LABELS[s] || s;

/**
 * Produits avec du stock mais NON publiés (draft, private, pending, trash, ...).
 * Parents 'variable' exclus (pas de stock propre). Coût = COALESCE(computed_cost, wc_cog_cost).
 */
async function fetchDraftStockProducts() {
  const { rows } = await pool.query(`
    SELECT p.sku,
           p.post_title,
           p.product_type,
           p.post_status,
           GREATEST(p.stock, 0)::int AS stock,
           ROUND(COALESCE(p.computed_cost, NULLIF(p.wc_cog_cost, 0), 0)::numeric, 2) AS unit_cost,
           ROUND((GREATEST(p.stock, 0) * COALESCE(p.computed_cost, NULLIF(p.wc_cog_cost, 0), 0))::numeric, 2) AS value_ht,
           par.post_title AS parent_title
    FROM products p
    LEFT JOIN products par ON par.wp_product_id = p.wp_parent_id
    WHERE p.stock > 0
      AND p.post_status <> 'publish'
      AND (p.product_type IS NULL OR p.product_type <> 'variable')
    ORDER BY value_ht DESC, p.stock DESC
  `);
  return rows;
}

function buildHtml(rows, dateStr) {
  const totalValue = rows.reduce((s, r) => s + parseFloat(r.value_ht), 0);
  const totalUnits = rows.reduce((s, r) => s + r.stock, 0);

  if (rows.length === 0) {
    return `<div style="font-family:Arial,sans-serif;color:#333;max-width:700px">
      <h2 style="color:#28a745">✅ Aucun produit à signaler</h2>
      <p>Au ${esc(dateStr)}, aucun produit avec du stock n'est en statut brouillon / privé / corbeille. Tout est propre 🎉</p>
    </div>`;
  }

  const trs = rows.map((r) => {
    const name = r.product_type === 'variation' && r.parent_title
      ? `${esc(r.parent_title)} — ${esc(r.post_title)}`
      : esc(r.post_title);
    const isTrash = r.post_status === 'trash';
    return `<tr style="border-bottom:1px solid #eee">
      <td style="padding:8px 10px;font-size:12px;color:#666;white-space:nowrap">${esc(r.sku)}</td>
      <td style="padding:8px 10px;font-size:13px">${name}</td>
      <td style="padding:8px 10px;font-size:12px;color:#888">${esc(r.product_type || '')}</td>
      <td style="padding:8px 10px;font-size:12px">
        <span style="padding:2px 8px;border-radius:10px;background:${isTrash ? '#f8d7da' : '#fff3cd'};color:${isTrash ? '#721c24' : '#856404'}">${esc(statusLabel(r.post_status))}</span>
      </td>
      <td style="padding:8px 10px;font-size:13px;text-align:right;font-weight:600">${r.stock.toLocaleString('fr-FR')}</td>
      <td style="padding:8px 10px;font-size:13px;text-align:right;color:#666">${fmtEur(r.unit_cost)}</td>
      <td style="padding:8px 10px;font-size:13px;text-align:right;font-weight:600;color:#dc3545">${fmtEur(r.value_ht)}</td>
    </tr>`;
  }).join('');

  return `<div style="font-family:Arial,sans-serif;color:#333;max-width:820px">
    <h2 style="margin:0 0 4px">📦 Produits en stock mais non publiés</h2>
    <p style="color:#666;font-size:13px;margin:0 0 16px">Au ${esc(dateStr)} · ${rows.length} produit(s) · ${totalUnits.toLocaleString('fr-FR')} unités · valeur ${fmtEur(totalValue)} HT</p>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e9ecef">
      <thead>
        <tr style="background:#f8f9fa">
          <th style="padding:10px;text-align:left;font-size:11px;color:#666;text-transform:uppercase">SKU</th>
          <th style="padding:10px;text-align:left;font-size:11px;color:#666;text-transform:uppercase">Produit</th>
          <th style="padding:10px;text-align:left;font-size:11px;color:#666;text-transform:uppercase">Type</th>
          <th style="padding:10px;text-align:left;font-size:11px;color:#666;text-transform:uppercase">Statut</th>
          <th style="padding:10px;text-align:right;font-size:11px;color:#666;text-transform:uppercase">Stock</th>
          <th style="padding:10px;text-align:right;font-size:11px;color:#666;text-transform:uppercase">Coût u.</th>
          <th style="padding:10px;text-align:right;font-size:11px;color:#666;text-transform:uppercase">Valeur HT</th>
        </tr>
      </thead>
      <tbody>${trs}</tbody>
      <tfoot>
        <tr style="background:#f8f9fa;font-weight:700">
          <td colspan="4" style="padding:10px;font-size:13px">Total</td>
          <td style="padding:10px;text-align:right;font-size:13px">${totalUnits.toLocaleString('fr-FR')}</td>
          <td></td>
          <td style="padding:10px;text-align:right;font-size:13px;color:#dc3545">${fmtEur(totalValue)}</td>
        </tr>
      </tfoot>
    </table>
    <p style="color:#999;font-size:11px;margin-top:14px">Rapport automatique Youvape Apps — chaque lundi 13h. Produits avec stock &gt; 0 dont le statut n'est pas « publié ».</p>
  </div>`;
}

function buildText(rows, dateStr) {
  if (rows.length === 0) return `Au ${dateStr}, aucun produit avec du stock n'est en statut brouillon/privé/corbeille.`;
  const totalValue = rows.reduce((s, r) => s + parseFloat(r.value_ht), 0);
  const lines = rows.map((r) => `- [${r.sku}] ${r.post_title} (${r.product_type}, ${statusLabel(r.post_status)}) — ${r.stock} u. — ${fmtEur(r.value_ht)}`);
  return `Produits en stock mais non publiés au ${dateStr} (${rows.length}, valeur ${fmtEur(totalValue)} HT):\n\n${lines.join('\n')}`;
}

/**
 * Génère et envoie le rapport hebdomadaire.
 */
async function sendWeeklyDraftStockReport() {
  const rows = await fetchDraftStockProducts();
  const dateStr = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const subject = rows.length > 0
    ? `📦 ${rows.length} produit(s) en stock non publiés`
    : `✅ Aucun produit en stock non publié`;
  const html = buildHtml(rows, dateStr);
  const text = buildText(rows, dateStr);
  const result = await sendMail({ to: RECIPIENT, subject, html, text });
  console.log(`[StockDraftReport] ${rows.length} produit(s) — envoi a ${RECIPIENT}: ${result.success ? 'OK' : 'ECHEC (' + result.error + ')'}`);
  return { count: rows.length, result };
}

module.exports = { fetchDraftStockProducts, sendWeeklyDraftStockReport };
