const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const pool = require('../config/database');
const { parseMollieInvoice } = require('../parsers/mollieInvoiceParser');
const { auditInvoice, classifyLine, coverageOf } = require('../services/mollieAuditService');
const { ensureTables, applyMollieCosts } = require('../services/mollieCostService');
const mollieApi = require('../services/mollieApiService');
const { PAID_STATUSES } = require('../config/mollieContract');
const { CONTRACT, GRIDS, REFERENCE_GRIDS, RATE_LABELS, METHODS } = require('../config/mollieContract');

// Les migrations .sql ne sont pas versionnées (.gitignore) : les tables se
// créent d'elles-mêmes au premier appel, un déploiement suffit.
const ensureTable = ensureTables;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 36 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Seuls les fichiers PDF sont acceptés'));
  },
});

async function pdfText(buffer) {
  const parser = new PDFParse(new Uint8Array(buffer));
  await parser.load();
  const data = await parser.getText();
  return data.text;
}

/**
 * Période d'un avoir : celle de la facture qu'il corrige si elle est déposée,
 * sinon le mois de l'avoir. Recalculée quand la facture d'origine arrive.
 */
async function creditPeriod(parsed) {
  if (parsed.appliesTo) {
    const { rows: [o] } = await pool.query('SELECT period_start, period_end FROM mollie_invoices WHERE invoice_number = $1', [parsed.appliesTo]);
    if (o) return [isoDate(o.period_start), isoDate(o.period_end)];
  }
  const d = new Date(`${parsed.invoiceDate}T12:00:00`);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12);
  return [`${parsed.invoiceDate.slice(0, 7)}-01`, isoDate(end)];
}

/** Avoirs et corrections connus, pour dire qu'une surfacturation est déjà remboursée. */
async function loadCredits() {
  const { rows } = await pool.query('SELECT invoice_number, parsed FROM mollie_invoices');
  const credits = [];
  for (const r of rows) {
    for (const l of r.parsed.lines || []) {
      const cls = classifyLine(l.label);
      if (!cls || cls.kind !== 'adjustment' || l.amount >= 0) continue;
      const cov = coverageOf(l.label);
      credits.push({ docNumber: r.invoice_number, label: l.label, amount: l.amount, from: cov?.from || null, to: cov?.to || null, appliesTo: r.parsed.appliesTo || null });
    }
  }
  return credits;
}

// Le contrôle lit la période en base (celle d'un avoir y est déduite).
const withPeriod = (r) => ({ ...r.parsed, periodStart: isoDate(r.period_start), periodEnd: isoDate(r.period_end) });

const isoDate = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : d);

// POST /api/mollie/upload — un ou plusieurs PDF : lus, stockés, contrôlés.
exports.upload = [upload.array('pdfs'), async (req, res) => {
  try {
    await ensureTable();
    const results = [];
    for (const f of req.files || []) {
      try {
        const parsed = parseMollieInvoice(await pdfText(f.buffer));
        if (parsed.docType === 'credit') [parsed.periodStart, parsed.periodEnd] = await creditPeriod(parsed);
        const r = await pool.query(`
          INSERT INTO mollie_invoices (invoice_number, invoice_date, period_start, period_end, total_ht, parsed, pdf_data, file_name, uploaded_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT (invoice_number) DO NOTHING
          RETURNING id
        `, [parsed.invoiceNumber, parsed.invoiceDate, parsed.periodStart, parsed.periodEnd, parsed.totalHT,
          JSON.stringify(parsed), f.buffer, f.originalname, req.user?.email || null]);
        let id = r.rows[0]?.id;
        const already = !id;
        if (already) id = (await pool.query('SELECT id FROM mollie_invoices WHERE invoice_number = $1', [parsed.invoiceNumber])).rows[0].id;
        // Une facture qui arrive après son avoir : l'avoir reprend sa période.
        if (parsed.docType !== 'credit') {
          await pool.query(`UPDATE mollie_invoices SET period_start = $1, period_end = $2 WHERE parsed->>'appliesTo' = $3`,
            [parsed.periodStart, parsed.periodEnd, parsed.invoiceNumber]);
        }
        const audit = await auditInvoice(parsed, undefined, { credits: await loadCredits() });
        results.push({ file: f.originalname, id, invoiceNumber: parsed.invoiceNumber, docType: parsed.docType, status: already ? 'already' : 'inserted', totals: audit.totals });
      } catch (e) {
        results.push({ file: f.originalname, status: 'error', error: e.message });
      }
    }
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}];

// GET /api/mollie/invoices — toutes les factures, contrôlées et ventilées (sert aussi les graphiques).
exports.list = async (req, res) => {
  try {
    await ensureTable();
    const { rows } = await pool.query(`
      SELECT id, invoice_number, invoice_date, period_start, period_end, total_ht, parsed, file_name, created_at
      FROM mollie_invoices ORDER BY invoice_date DESC NULLS LAST, id DESC
    `);
    const credits = await loadCredits();
    const invoices = [];
    for (const r of rows) {
      const audit = await auditInvoice(withPeriod(r), undefined, { credits });
      invoices.push({
        id: r.id, invoiceNumber: r.invoice_number, invoiceDate: isoDate(r.invoice_date),
        docType: r.parsed.docType || 'invoice', appliesTo: r.parsed.appliesTo || null,
        periodStart: isoDate(r.period_start), periodEnd: isoDate(r.period_end),
        totalHT: parseFloat(r.total_ht), fileName: r.file_name, createdAt: r.created_at,
        totals: audit.totals, byMethod: audit.byMethod, byCountry: audit.byCountry, byCountryMethod: audit.byCountryMethod,
      });
    }
    res.json({ success: true, invoices });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/mollie/invoices/:id — facture complète et son contrôle.
exports.detail = async (req, res) => {
  try {
    await ensureTable();
    const { rows } = await pool.query('SELECT id, invoice_number, parsed, period_start, period_end, file_name, created_at, uploaded_by FROM mollie_invoices WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Facture introuvable' });
    const audit = await auditInvoice(withPeriod(rows[0]), undefined, { credits: await loadCredits() });
    res.json({ success: true, invoice: { id: rows[0].id, ...withPeriod(rows[0]), fileName: rows[0].file_name, createdAt: rows[0].created_at, uploadedBy: rows[0].uploaded_by }, audit });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/mollie/invoices/:id/pdf
exports.pdf = async (req, res) => {
  try {
    await ensureTable();
    const { rows } = await pool.query('SELECT invoice_number, pdf_data FROM mollie_invoices WHERE id = $1', [req.params.id]);
    if (!rows.length || !rows[0].pdf_data) return res.status(404).json({ error: 'PDF non disponible' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Mollie_${rows[0].invoice_number}.pdf"`);
    res.send(rows[0].pdf_data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/mollie/invoices/:id
exports.remove = async (req, res) => {
  try {
    await ensureTable();
    const { rows } = await pool.query('DELETE FROM mollie_invoices WHERE id = $1 RETURNING invoice_number', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Facture introuvable' });
    res.json({ success: true, deleted: rows[0].invoice_number });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/mollie/apply-costs — frais de paiement des commandes recalés sur les
// factures ({ apply: false } = simulation, rien n'est écrit).
exports.applyCosts = async (req, res) => {
  try {
    const result = await applyMollieCosts({ apply: req.body?.apply === true });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/* ─── API Mollie (lecture seule) ─────────────────────────────────────── */

// GET /api/mollie/api/status — jeton présent (masqué), paiements synchronisés, synchro en cours.
exports.apiStatus = async (req, res) => {
  try {
    res.json({ success: true, ...(await mollieApi.status()) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// PUT /api/mollie/api/token — admin : jeton testé chez Mollie avant d'être enregistré.
exports.saveApiToken = async (req, res) => {
  try {
    const permissions = await mollieApi.saveToken(req.body?.token);
    mollieApi.runSync().catch(() => {});
    res.json({ success: true, permissions });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message, permissions: err.permissions });
  }
};

// POST /api/mollie/api/sync — lance la synchro des paiements en tâche de fond.
exports.syncPayments = async (req, res) => {
  try {
    const job = await mollieApi.runSync({ full: req.body?.full === true });
    res.json({ success: true, job });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

// GET /api/mollie/invoices/:id/payments — rapprochement paiement par paiement.
exports.paymentsReco = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT period_start, period_end FROM mollie_invoices WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Facture introuvable' });
    if (!(await mollieApi.getToken())) return res.json({ success: true, configured: false });
    const titleMethods = Object.fromEntries(Object.entries(METHODS).flatMap(([k, m]) => m.titles.map((t) => [t, k])));
    const reco = await mollieApi.reconcile(isoDate(rows[0].period_start), isoDate(rows[0].period_end), PAID_STATUSES, titleMethods);
    res.json({ success: true, configured: true, ...reco });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/mollie/contract — grille et échéances affichées à l'écran.
exports.contract = (req, res) => {
  res.json({ success: true, contract: CONTRACT, grids: GRIDS, reference: REFERENCE_GRIDS, labels: RATE_LABELS, methods: Object.fromEntries(Object.entries(METHODS).map(([k, m]) => [k, m.label])) });
};
