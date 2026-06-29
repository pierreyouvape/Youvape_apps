const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const ExcelJS = require('exceljs');
const pool = require('../config/database');
const { parseLettreSuiviePdf } = require('../parsers/lettreSuivieParser');

const CARRIER = 'lettre_suivie';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Seuls les fichiers PDF sont acceptés'));
  },
});

async function parsePdfBuffer(buffer) {
  const parser = new PDFParse(new Uint8Array(buffer));
  await parser.load();
  const data = await parser.getText();
  return parseLettreSuiviePdf(data.text);
}

/* ─── EXCEL ──────────────────────────────────────────────────── */
async function generateExcel(parsed) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'YouVape Apps';
  const HDR = '1F4E79', FG = 'FFFFFF', GREY = 'F3F4F6';
  const FMT = '#,##0.00 "€"';

  function styleHeader(row) {
    row.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HDR } };
      cell.font = { bold: true, color: { argb: FG }, size: 11 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    row.height = 20;
  }

  // Résumé
  const ws0 = wb.addWorksheet('Résumé');
  ws0.columns = [{ width: 32 }, { width: 24 }];
  styleHeader(ws0.addRow(['Poste', 'Valeur']));
  const rows = [
    ['Facture n°', parsed.invoiceNumber],
    ['Date facture', parsed.invoiceDate],
    ['Période', parsed.periodRange || parsed.periodDate],
    ['Contrat', `${parsed.contractType || ''} ${parsed.contractNumber || ''}`.trim()],
    ['N° client', parsed.clientNumber],
    ['Total HT', parsed.totalHT],
    ['TVA', parsed.totalTVA],
    ['Total TTC', parsed.totalTTC],
    ['Nombre de lettres', parsed.stats.nb_lettres],
    ['Nombre de lignes', parsed.stats.nb_lines],
  ];
  for (const [l, v] of rows) {
    const r = ws0.addRow([l, v]);
    if (typeof v === 'number' && /HT|TVA|TTC/.test(l)) r.getCell(2).numFmt = FMT;
  }

  // Par tranche
  const ws1 = wb.addWorksheet('Par tranche');
  ws1.columns = [{ key: 'tier', width: 28 }, { key: 'pu', width: 14 }, { key: 'qty', width: 12 }, { key: 'montant', width: 16 }];
  styleHeader(ws1.addRow(['Tranche', 'Prix unitaire', 'Quantité', 'Montant HT']));
  for (const t of parsed.tierSummary) {
    const r = ws1.addRow([t.tier, t.pu, t.qty, t.montant]);
    r.getCell(2).numFmt = FMT; r.getCell(4).numFmt = FMT;
  }

  // Détail
  const ws2 = wb.addWorksheet('Détail lignes');
  ws2.columns = [{ key: 'tier', width: 28 }, { key: 'qty', width: 12 }, { key: 'pu', width: 14 }, { key: 'montant', width: 16 }];
  styleHeader(ws2.addRow(['Tranche', 'Quantité', 'Prix unitaire', 'Montant HT']));
  for (const l of parsed.lines) {
    const r = ws2.addRow([l.tier, l.qty, l.pu, l.montant]);
    r.getCell(3).numFmt = FMT; r.getCell(4).numFmt = FMT;
  }

  return wb;
}

/* ─── CONTROLLERS ────────────────────────────────────────────── */

// POST /api/lettre-suivie/analyze
exports.analyze = [
  upload.single('pdf'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, error: 'Fichier PDF requis' });
      const parsed = await parsePdfBuffer(req.file.buffer);
      if (!parsed.invoiceNumber) {
        return res.status(400).json({ success: false, error: "Ce PDF ne semble pas être une facture La Poste (numéro introuvable)." });
      }
      res.json({ success: true, ...parsed });
    } catch (err) {
      console.error('[LettreSuivie] analyze error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },
];

// POST /api/lettre-suivie/export-excel
exports.exportExcel = [
  upload.single('pdf'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, error: 'Fichier PDF requis' });
      const parsed = await parsePdfBuffer(req.file.buffer);
      const wb = await generateExcel(parsed);
      const fname = `LettreSuivie_${parsed.invoiceNumber || 'facture'}_${Date.now()}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
      await wb.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error('[LettreSuivie] exportExcel error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },
];

// POST /api/lettre-suivie/save
exports.saveInvoice = [
  upload.single('pdf'),
  async (req, res) => {
    try {
      const parsed = req.body.data ? JSON.parse(req.body.data) : req.body;
      const { invoiceNumber } = parsed;
      if (!invoiceNumber) return res.status(400).json({ success: false, error: 'invoiceNumber requis' });

      const existing = await pool.query(
        'SELECT id FROM carrier_invoices WHERE carrier = $1 AND invoice_number = $2',
        [CARRIER, invoiceNumber]
      );
      if (existing.rows.length) {
        if (req.file) {
          await pool.query('UPDATE carrier_invoices SET pdf_data = $1 WHERE id = $2', [req.file.buffer, existing.rows[0].id]);
        }
        return res.json({ success: true, already_saved: true, id: existing.rows[0].id });
      }

      const invRes = await pool.query(`
        INSERT INTO carrier_invoices
          (carrier, invoice_number, invoice_date, period_start, period_end, account_number,
           total_parcels, parcels_matched, total_ht, parcels_detail, pdf_data)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING id
      `, [
        CARRIER, invoiceNumber, parsed.invoiceDate || null,
        parsed.periodStart || parsed.periodDate || null, parsed.periodEnd || null,
        parsed.contractNumber || null,
        parsed.stats?.nb_lettres ?? 0,
        parsed.stats?.nb_lines ?? 0,
        parsed.totalHT ?? null,
        JSON.stringify(parsed),
        req.file ? req.file.buffer : null,
      ]);

      res.json({ success: true, already_saved: false, id: invRes.rows[0].id });
    } catch (err) {
      console.error('[LettreSuivie] saveInvoice error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },
];

// GET /api/lettre-suivie/history
exports.getHistory = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id, invoice_number, invoice_date, period_start, period_end, account_number,
        total_parcels, parcels_matched, total_ht, created_at,
        (parcels_detail->>'totalTVA')::numeric  AS total_tva,
        (parcels_detail->>'totalTTC')::numeric  AS total_ttc,
        parcels_detail->>'contractType'         AS contract_type,
        parcels_detail->>'format'               AS format
      FROM carrier_invoices
      WHERE carrier = $1
      ORDER BY created_at DESC
      LIMIT 100
    `, [CARRIER]);
    res.json({ success: true, invoices: result.rows });
  } catch (err) {
    console.error('[LettreSuivie] getHistory error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/lettre-suivie/history/:id
exports.getInvoiceDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const inv = await pool.query('SELECT * FROM carrier_invoices WHERE id=$1 AND carrier=$2', [id, CARRIER]);
    if (!inv.rows.length) return res.status(404).json({ success: false, error: 'Facture non trouvée' });
    const row = inv.rows[0];
    // parcels_detail contient le modèle complet analysé
    res.json({ success: true, invoice: row, parsed: row.parcels_detail });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/lettre-suivie/history/:id/pdf
exports.downloadPdf = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT invoice_number, pdf_data FROM carrier_invoices WHERE id=$1 AND carrier=$2', [id, CARRIER]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Facture non trouvée' });
    const { invoice_number, pdf_data } = result.rows[0];
    if (!pdf_data) return res.status(404).json({ error: 'PDF non disponible pour cette facture' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="LettreSuivie_${invoice_number}.pdf"`);
    res.send(pdf_data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/lettre-suivie/history/:id
exports.deleteInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM carrier_invoices WHERE id=$1 AND carrier=$2 RETURNING invoice_number', [id, CARRIER]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, error: 'Facture non trouvée' });
    res.json({ success: true, deleted: result.rows[0].invoice_number });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/lettre-suivie/totals — totaux HT/TTC par mois / par année
exports.getTotals = async (req, res) => {
  try {
    const invoices = await pool.query(`
      SELECT invoice_number, period_start, total_ht,
             (parcels_detail->>'totalTTC')::numeric AS total_ttc,
             total_parcels
      FROM carrier_invoices
      WHERE carrier = $1
      ORDER BY period_start
    `, [CARRIER]);
    res.json({ success: true, invoices: invoices.rows });
  } catch (err) {
    console.error('[LettreSuivie] getTotals error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/lettre-suivie/debug-text
exports.debugText = [
  upload.single('pdf'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'PDF requis' });
    const parser = new PDFParse(new Uint8Array(req.file.buffer));
    await parser.load();
    const data = await parser.getText();
    res.json({ lines: data.text.split('\n').map((l, i) => `${i}: ${l}`) });
  },
];
