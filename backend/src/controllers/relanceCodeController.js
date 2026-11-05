const relanceCodeModel = require('../models/relanceCodeModel');

/**
 * App « Relance code promo » : clients qui n'ont jamais utilisé un code.
 * GET /api/relance-code          → chiffres + aperçu (PREVIEW_LIMIT lignes)
 * GET /api/relance-code/export   → CSV complet pour Probance
 * Query : code, ref (first|last|registered), minDays, maxDays, oneOrderOnly (1/0), country
 */

const PREVIEW_LIMIT = 300;

const toInt = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 20000) throw new Error('Nombre de jours invalide');
  return n;
};

function parseFilters(q) {
  const code = String(q.code || 'TEAMYOUVAPE').trim();
  if (!code || code.length > 100) throw new Error('Code promo invalide');
  const ref = relanceCodeModel.REF_COLUMNS[q.ref] ? q.ref : 'first';
  const minDays = toInt(q.minDays);
  const maxDays = toInt(q.maxDays);
  if (minDays !== null && maxDays !== null && minDays > maxDays) {
    throw new Error('Le nombre de jours minimum dépasse le maximum');
  }
  const country = /^[A-Z]{2}$/.test(String(q.country || '')) ? q.country : '';
  return { code, ref, minDays, maxDays, oneOrderOnly: q.oneOrderOnly === '1', country };
}

const ymd = (d) => {
  if (!d) return '';
  if (d instanceof Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return String(d).slice(0, 10);
};

const shape = (r) => ({
  email: r.email,
  first_name: r.first_name || '',
  last_name: r.last_name || '',
  country: r.country || '',
  wp_user_id: r.wp_user_id ? Number(r.wp_user_id) : null,
  registered: ymd(r.user_registered),
  first_order: ymd(r.first_order),
  last_order: ymd(r.last_order),
  nb_orders: r.nb_orders,
});

exports.list = async (req, res) => {
  let filters;
  try {
    filters = parseFilters(req.query);
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
  try {
    const rows = (await relanceCodeModel.list(filters)).map(shape);
    const countries = {};
    let oneOrder = 0;
    for (const r of rows) {
      countries[r.country || '—'] = (countries[r.country || '—'] || 0) + 1;
      if (r.nb_orders === 1) oneOrder += 1;
    }
    res.json({
      success: true,
      filters,
      total: rows.length,
      oneOrder,
      countries,
      rows: rows.slice(0, PREVIEW_LIMIT),
      previewLimit: PREVIEW_LIMIT,
    });
  } catch (error) {
    console.error('Erreur relance code promo:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

// Champ CSV : entre guillemets si besoin ; un « = + - @ » en tête est neutralisé
// (le fichier peut être ouvert dans Excel avant l'import).
const csvField = (v) => {
  let s = String(v ?? '').replace(/[\r\n]+/g, ' ');
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[;"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

exports.exportCsv = async (req, res) => {
  let filters;
  try {
    filters = parseFilters(req.query);
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
  try {
    const rows = (await relanceCodeModel.list(filters)).map(shape);
    const header = ['email', 'prenom', 'nom', 'pays', 'date_inscription', 'premiere_commande', 'derniere_commande', 'nb_commandes'];
    const lines = [header.join(';')];
    for (const r of rows) {
      lines.push([r.email, r.first_name, r.last_name, r.country, r.registered, r.first_order, r.last_order, r.nb_orders]
        .map(csvField).join(';'));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('X-Total-Count', String(rows.length));
    res.send(lines.join('\n') + '\n');
  } catch (error) {
    console.error('Erreur export relance code promo:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

/* ─── Fichier Probance ─────────────────────────────────── */

const { readCsv, writeCsv, EMAIL_RE } = require('../utils/csvRecords');

// « 2026-11-05T10:30 » ou « 2026-11-05 10:30 » (heure de Paris) → texte SQL, sinon null.
const parseSentAt = (v) => {
  if (!v) return null;
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?$/) || String(v).match(/^(\d{4}-\d{2}-\d{2})$/);
  if (!m) throw new Error("Date d'envoi invalide");
  return m[2] ? `${m[1]} ${m[2]}:00` : `${m[1]} 00:00:00`;
};

/**
 * POST /api/relance-code/clean (multipart : file, code, save=1, sentAt, label)
 * Retire du fichier Probance les adresses qui ont déjà utilisé le code et les clients
 * signalés malhonnêtes. Les lignes gardées sont recopiées à l'octet près.
 * Réponse : le CSV nettoyé, chiffres dans l'en-tête X-Relance-Stats (JSON encodé).
 */
exports.cleanProbance = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'Aucun fichier reçu' });
    const code = String(req.body.code || 'TEAMYOUVAPE').trim();
    if (!code || code.length > 100) return res.status(400).json({ success: false, error: 'Code promo invalide' });
    const sentAt = parseSentAt(req.body.sentAt);

    let csv;
    try {
      csv = readCsv(req.file.buffer);
    } catch (e) {
      return res.status(400).json({ success: false, error: e.message });
    }

    // Seules les valeurs qui ressemblent à une adresse partent en base.
    for (const r of csv.rows) if (!EMAIL_RE.test(r.email)) r.email = '';
    const emails = [...new Set(csv.rows.map((r) => r.email).filter(Boolean))];
    const status = await relanceCodeModel.classifyEmails(code, emails);

    const kept = [];
    const stats = { lines: csv.rows.length, used: 0, dishonest: 0, duplicates: 0, noEmail: 0, kept: 0, unknown: 0, emailColumn: csv.emailColumn };
    const seen = new Set();
    for (const row of csv.rows) {
      if (!row.email) { stats.noEmail++; continue; }
      if (seen.has(row.email)) { stats.duplicates++; continue; }
      seen.add(row.email);
      const s = status.get(row.email);
      if (s?.used) { stats.used++; continue; }
      if (s?.dishonest) { stats.dishonest++; continue; }
      if (!s?.known) stats.unknown++;
      kept.push(row);
    }
    stats.kept = kept.length;

    if (req.body.save === '1' && kept.length) {
      const campaign = await relanceCodeModel.createCampaign({
        code, source: 'probance', label: req.body.label || req.file.originalname,
        filters: { file: req.file.originalname, lines: stats.lines },
        sentAt, emails: kept.map((r) => r.email), userId: req.user?.id,
      });
      stats.campaignId = campaign.id;
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('X-Relance-Stats', encodeURIComponent(JSON.stringify(stats)));
    res.send(writeCsv({ header: csv.header, eol: csv.eol, rows: kept, encoding: csv.encoding }));
  } catch (error) {
    console.error('Erreur nettoyage fichier Probance:', error);
    // Le vrai message, pas « Erreur serveur » : c'est ce qui manquait pour diagnostiquer.
    res.status(error.message === "Date d'envoi invalide" ? 400 : 500)
      .json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

/* ─── Suivi des envois ─────────────────────────────────── */

/** POST /api/relance-code/campaigns : enregistre la liste de l'app (mêmes filtres que l'export). */
exports.createFromFilters = async (req, res) => {
  let filters;
  let sentAt;
  try {
    filters = parseFilters(req.body || {});
    sentAt = parseSentAt(req.body?.sentAt);
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
  try {
    const rows = await relanceCodeModel.list(filters);
    if (!rows.length) return res.status(400).json({ success: false, error: 'Liste vide : rien à enregistrer' });
    const campaign = await relanceCodeModel.createCampaign({
      code: filters.code, source: 'app', label: req.body.label, filters, sentAt,
      emails: rows.map((r) => r.email), userId: req.user?.id,
    });
    res.json({ success: true, campaign });
  } catch (error) {
    console.error('Erreur enregistrement campagne relance:', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

exports.listCampaigns = async (req, res) => {
  try {
    const rows = await relanceCodeModel.campaignStats();
    const first = rows[0];
    res.json({
      success: true,
      total: {
        campaigns: rows.length,
        recipients: first?.total_recipients || 0,
        reordered: first?.total_reordered || 0,
        withCode: first?.total_with_code || 0,
        orders: first?.total_orders || 0,
        revenue: rows.reduce((s, r) => s + r.revenue, 0),
        revenueWithCode: rows.reduce((s, r) => s + r.revenue_with_code, 0),
      },
      campaigns: rows.map((r) => ({
        id: r.id, code: r.code, source: r.source, label: r.label, filters: r.filters,
        sent_at: r.sent_at, recipients: r.recipients, created_by: r.created_by_email,
        reordered: r.reordered, with_code: r.with_code, orders: r.orders,
        revenue: r.revenue, revenue_with_code: r.revenue_with_code,
      })),
    });
  } catch (error) {
    console.error('Erreur suivi relance:', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

exports.updateCampaign = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const sentAt = parseSentAt(req.body?.sentAt);
    const label = typeof req.body?.label === 'string' ? req.body.label.slice(0, 200) : null;
    const ok = await relanceCodeModel.updateCampaign(id, { label, sentAt });
    if (!ok) return res.status(404).json({ success: false, error: 'Envoi introuvable' });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.deleteCampaign = async (req, res) => {
  try {
    const ok = await relanceCodeModel.deleteCampaign(parseInt(req.params.id, 10));
    if (!ok) return res.status(404).json({ success: false, error: 'Envoi introuvable' });
    res.json({ success: true });
  } catch (error) {
    console.error('Erreur suppression campagne relance:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

exports._test = { parseFilters, csvField, parseSentAt };
