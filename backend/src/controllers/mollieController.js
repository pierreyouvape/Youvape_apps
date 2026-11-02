const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const pool = require('../config/database');
const { parseMollieInvoice } = require('../parsers/mollieInvoiceParser');
const { auditInvoice } = require('../services/mollieAuditService');
const { ensureTables, applyMollieCosts } = require('../services/mollieCostService');
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

const isoDate = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : d);

// POST /api/mollie/upload — un ou plusieurs PDF : lus, stockés, contrôlés.
exports.upload = [upload.array('pdfs'), async (req, res) => {
  try {
    await ensureTable();
    const results = [];
    for (const f of req.files || []) {
      try {
        const parsed = parseMollieInvoice(await pdfText(f.buffer));
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
        const audit = await auditInvoice(parsed);
        results.push({ file: f.originalname, id, invoiceNumber: parsed.invoiceNumber, status: already ? 'already' : 'inserted', totals: audit.totals });
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
    const invoices = [];
    for (const r of rows) {
      const audit = await auditInvoice(r.parsed);
      invoices.push({
        id: r.id, invoiceNumber: r.invoice_number, invoiceDate: isoDate(r.invoice_date),
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
    const { rows } = await pool.query('SELECT id, invoice_number, parsed, file_name, created_at, uploaded_by FROM mollie_invoices WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Facture introuvable' });
    const audit = await auditInvoice(rows[0].parsed);
    res.json({ success: true, invoice: { id: rows[0].id, ...rows[0].parsed, fileName: rows[0].file_name, createdAt: rows[0].created_at, uploadedBy: rows[0].uploaded_by }, audit });
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

// GET /api/mollie/contract — grille et échéances affichées à l'écran.
exports.contract = (req, res) => {
  res.json({ success: true, contract: CONTRACT, grids: GRIDS, reference: REFERENCE_GRIDS, labels: RATE_LABELS, methods: Object.fromEntries(Object.entries(METHODS).map(([k, m]) => [k, m.label])) });
};
