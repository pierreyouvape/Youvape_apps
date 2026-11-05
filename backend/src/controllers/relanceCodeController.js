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

exports._test = { parseFilters, csvField };
