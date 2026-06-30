const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const ExcelJS = require('exceljs');
const pool = require('../config/database');
const { parseMondialRelayPdf } = require('../parsers/mondialRelayParser');

const CARRIER = 'mondial_relay';

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
  return parseMondialRelayPdf(data.text);
}

/* ─── EXCEL ──────────────────────────────────────────────────── */
async function generateExcel(parsed) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'YouVape Apps';
  const HDR = '7A1F4E', FG = 'FFFFFF';
  const FMT = '#,##0.00 "€"';
  const styleHeader = row => {
    row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HDR } }; c.font = { bold: true, color: { argb: FG } }; c.alignment = { horizontal: 'center' }; });
    row.height = 20;
  };

  const ws0 = wb.addWorksheet('Résumé');
  ws0.columns = [{ width: 30 }, { width: 26 }];
  styleHeader(ws0.addRow(['Poste', 'Valeur']));
  [
    ['Facture n°', parsed.invoiceNumber], ['Date', parsed.invoiceDate],
    ['Pays de livraison', parsed.pays], ['Période', `${parsed.periodStart} → ${parsed.periodEnd}`],
    ['Nombre de colis', parsed.nbColis],
    ['Remise', parsed.remiseRate != null ? `${parsed.remiseRate} %` : '—'],
    ['Total HT', parsed.totalHT], ['TVA', parsed.totalTVA], ['Total TTC', parsed.totalTTC],
  ].forEach(([l, v]) => { const r = ws0.addRow([l, v]); if (typeof v === 'number' && /HT|TVA|TTC/.test(l)) r.getCell(2).numFmt = FMT; });

  const ws1 = wb.addWorksheet('Livraisons');
  ws1.columns = [{ width: 34 }, { width: 16 }, { width: 12 }, { width: 13 }, { width: 13 }, { width: 14 }, { width: 14 }];
  styleHeader(ws1.addRow(['Type de livraison', 'Tranche de poids', 'Poids (kg)', 'Quantité', 'PU (€)', 'Montant HT', 'Grille 2026']));
  for (const d of parsed.deliveries) {
    const r = ws1.addRow([d.type, d.bracket, d.poids, d.qty, d.pu, d.montant, d.grid_pu ?? '—']);
    r.getCell(5).numFmt = FMT; r.getCell(6).numFmt = FMT; if (typeof d.grid_pu === 'number') r.getCell(7).numFmt = FMT;
  }

  const ws2 = wb.addWorksheet('Frais & remise');
  ws2.columns = [{ width: 40 }, { width: 12 }, { width: 13 }, { width: 14 }];
  styleHeader(ws2.addRow(['Libellé', 'Quantité', 'PU (€)', 'Montant HT']));
  const addRow = (label, qty, pu, montant) => { const r = ws2.addRow([label, qty, pu, montant]); if (typeof pu === 'number') r.getCell(3).numFmt = FMT; if (typeof montant === 'number') r.getCell(4).numFmt = FMT; };
  if (parsed.remiseMontant != null) addRow(`Remise ${parsed.remiseRate} %`, 1, null, parsed.remiseMontant);
  if (parsed.indexation) addRow(`Indexation Gasoil (${parsed.indexation.taux} %)`, '', '', parsed.indexation.montant);
  parsed.collecte.forEach(c => addRow(c.label, c.qty, c.pu, c.montant));
  parsed.retourPCI.forEach(c => addRow(c.label, c.qty, c.pu, c.montant));
  parsed.complements.forEach(c => addRow(c.label, c.qty, c.pu, c.montant));
  parsed.surcharges.forEach(c => addRow(c.label, c.qty, c.pu, c.montant));
  parsed.participations.forEach(c => addRow(c.label, c.qty, c.pu, c.montant));

  return wb;
}

/* ─── CONTROLLERS ────────────────────────────────────────────── */

exports.analyze = [
  upload.single('pdf'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, error: 'Fichier PDF requis' });
      const parsed = await parsePdfBuffer(req.file.buffer);
      if (!parsed.invoiceNumber) {
        return res.status(400).json({ success: false, error: "Ce PDF ne semble pas être une facture Mondial Relay (référence introuvable)." });
      }
      res.json({ success: true, ...parsed });
    } catch (err) {
      console.error('[MondialRelay] analyze error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },
];

exports.exportExcel = [
  upload.single('pdf'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, error: 'Fichier PDF requis' });
      const parsed = await parsePdfBuffer(req.file.buffer);
      const wb = await generateExcel(parsed);
      const fname = `MondialRelay_${parsed.invoiceNumber || 'facture'}_${Date.now()}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
      await wb.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error('[MondialRelay] exportExcel error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },
];

exports.saveInvoice = [
  upload.single('pdf'),
  async (req, res) => {
    try {
      const parsed = req.body.data ? JSON.parse(req.body.data) : req.body;
      const { invoiceNumber } = parsed;
      if (!invoiceNumber) return res.status(400).json({ success: false, error: 'invoiceNumber requis' });

      const existing = await pool.query(
        'SELECT id FROM carrier_invoices WHERE carrier = $1 AND invoice_number = $2', [CARRIER, invoiceNumber]
      );
      if (existing.rows.length) {
        if (req.file) await pool.query('UPDATE carrier_invoices SET pdf_data = $1 WHERE id = $2', [req.file.buffer, existing.rows[0].id]);
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
        parsed.periodStart || null, parsed.periodEnd || null,
        parsed.pays || null,
        parsed.nbColis ?? 0,
        parsed.stats?.pu_conform ?? 0,
        parsed.totalHT ?? null,
        JSON.stringify(parsed),
        req.file ? req.file.buffer : null,
      ]);
      res.json({ success: true, already_saved: false, id: invRes.rows[0].id });
    } catch (err) {
      console.error('[MondialRelay] saveInvoice error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },
];

exports.getHistory = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id, invoice_number, invoice_date, period_start, period_end,
        account_number AS pays, total_parcels, total_ht, created_at,
        (parcels_detail->>'totalTVA')::numeric  AS total_tva,
        (parcels_detail->>'totalTTC')::numeric  AS total_ttc,
        (parcels_detail->>'remiseRate')::numeric AS remise_rate,
        (parcels_detail->'stats'->>'reconcile_ok')::boolean AS reconcile_ok
      FROM carrier_invoices
      WHERE carrier = $1
      ORDER BY created_at DESC
      LIMIT 200
    `, [CARRIER]);
    res.json({ success: true, invoices: result.rows });
  } catch (err) {
    console.error('[MondialRelay] getHistory error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getInvoiceDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const inv = await pool.query('SELECT * FROM carrier_invoices WHERE id=$1 AND carrier=$2', [id, CARRIER]);
    if (!inv.rows.length) return res.status(404).json({ success: false, error: 'Facture non trouvée' });
    res.json({ success: true, invoice: inv.rows[0], parsed: inv.rows[0].parcels_detail });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.downloadPdf = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT invoice_number, pdf_data FROM carrier_invoices WHERE id=$1 AND carrier=$2', [id, CARRIER]);
    if (!result.rows.length) return res.status(404).json({ error: 'Facture non trouvée' });
    const { invoice_number, pdf_data } = result.rows[0];
    if (!pdf_data) return res.status(404).json({ error: 'PDF non disponible pour cette facture' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="MondialRelay_${invoice_number}.pdf"`);
    res.send(pdf_data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM carrier_invoices WHERE id=$1 AND carrier=$2 RETURNING invoice_number', [id, CARRIER]);
    if (!result.rows.length) return res.status(404).json({ success: false, error: 'Facture non trouvée' });
    res.json({ success: true, deleted: result.rows[0].invoice_number });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/mondial-relay/totals — totaux HT/TTC par mois / par année / par pays
exports.getTotals = async (req, res) => {
  try {
    const invoices = await pool.query(`
      SELECT invoice_number, period_start, total_ht, total_parcels,
             account_number AS pays,
             (parcels_detail->>'totalTTC')::numeric AS total_ttc
      FROM carrier_invoices
      WHERE carrier = $1
      ORDER BY period_start
    `, [CARRIER]);
    res.json({ success: true, invoices: invoices.rows });
  } catch (err) {
    console.error('[MondialRelay] getTotals error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

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
