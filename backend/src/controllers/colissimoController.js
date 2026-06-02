const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const ExcelJS = require('exceljs');
const pool = require('../config/database');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Seuls les fichiers PDF sont acceptés'));
  },
});

/* ─── PDF PARSER ─────────────────────────────────────────────── */
/*
 * Le PDF Colissimo extrait les colonnes de chaque tableau sur des lignes séparées.
 * Ex:
 *   " CA696831030FR"      ← numéro de suivi
 *   "0,040"               ← poids kg
 *   "8,50€"               ← port brut
 *   "45,00%"              ← taux remise
 *   "-3,83€"              ← remise HT
 *   "4,67€"               ← port net
 *   "0,54€"               ← CAE HT
 *   "0,05€"               ← décarbonation
 *   "0,00€"               ← SMIC HT
 *   "5,26€"               ← total HT
 *   "Supplément : ..."    ← libellé supplément
 *   "0,20€"               ← montant supplément
 * Machine à états pour reconstruire chaque colis.
 */
function parseColissimoPdf(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  const parcels        = [];
  const supplements    = [];
  const indemnizations = [];
  const globalSummary  = {};

  const TRACKING_RE = /\b(6[AC]\d{11}|8Q\d{11}|C[ABF]\d{9}FR)\b/;
  const DATE_RE     = /\b(\d{2}\/\d{2})\b/;

  // ── Metadata extraction
  const INVOICE_RE  = /Facture\s+N°\s*(\w+)/i;
  const PERIOD_RE   = /du\s+(\d{2}\/\d{2}\/\d{4})\s+au\s+(\d{2}\/\d{2}\/\d{4})/i;
  const PORTBRUT_RE = /^Port Brut\s+([\d\s,]+)/i;
  const REMISE_RE   = /^Remise\s+(-[\d\s,]+)/i;
  const PORTNET_RE  = /^Port Net\s+([\d\s,]+)/i;
  const CAE_RE      = /^Coefficient.*[ÉE]nergie\s+([\d\s,]+)/i;
  const SUPPTOT_RE  = /^Suppl?ements?\s+([\d\s,]+)/i;
  const INDEMTOT_RE = /^Indemnisations\s+(-[\d\s,]+)/i;

  let invoiceNumber = null, periodStart = null, periodEnd = null;

  for (const line of lines) {
    const invM = line.match(INVOICE_RE); if (invM && !invoiceNumber) invoiceNumber = invM[1];
    const perM = line.match(PERIOD_RE);  if (perM && !periodStart) { periodStart = perM[1]; periodEnd = perM[2]; }
    const pbM = line.match(PORTBRUT_RE); if (pbM) globalSummary.portBrut = parseFloat(pbM[1].replace(/\s/g,'').replace(',','.'));
    const rmM = line.match(REMISE_RE);   if (rmM) globalSummary.remise   = parseFloat(rmM[1].replace(/\s/g,'').replace(',','.'));
    const pnM = line.match(PORTNET_RE);  if (pnM) globalSummary.portNet  = parseFloat(pnM[1].replace(/\s/g,'').replace(',','.'));
    const caeM = line.match(CAE_RE);     if (caeM) globalSummary.cae     = parseFloat(caeM[1].replace(/\s/g,'').replace(',','.'));
    const spM = line.match(SUPPTOT_RE);  if (spM) globalSummary.supplements = parseFloat(spM[1].replace(/\s/g,'').replace(',','.'));
    const idM = line.match(INDEMTOT_RE); if (idM) globalSummary.indemnizations = parseFloat(idM[1].replace(/\s/g,'').replace(',','.'));
  }

  // ── Line classifiers
  // Amount line: just a number (positive or negative) followed by € or ¤
  const IS_AMOUNT = /^\s*(-?\d[\d\s]*[,\.]\d+)\s*[€¤]\s*$/;
  // Pure decimal (weight): just a decimal number, no € ¤ %
  const IS_WEIGHT = /^\s*\d+[,\.]\d+\s*$/;
  // Percentage line
  const IS_PCT    = /^\s*(\d+[,\.]\d+)\s*%\s*$/;
  // Supplement label
  const IS_SUPPL  = /Supplément\s*:/i;
  // Indemnizations
  const INDEMN_START  = /Indemnisations Pour Hors D[ée]lais/i;
  const INDEMN_DIVERS = /Indemnisations Diverses/i;
  const INDEMN_ARTICLE = /Article\s+(IN\w+|ICA)\s+-\s+(.+?)\s+([-\d,]+)[€¤]/i;

  function parseAmt(s) { return parseFloat(s.replace(/\s/g,'').replace(',','.')); }

  // ── State machine
  // States: idle | weight | port_brut | tx_remise | remise_ht | port_net
  //         | cae | decarbonation | smic | total | supp_label | supp_amount
  let state        = 'idle';
  let cur          = null;  // current parcel being built
  let supplLabel   = null;  // pending supplement label
  let lastDate     = null;  // last seen DD/MM
  let inIndemn     = false;
  let indemnType   = 'Hors Délais';

  const FIELD_SEQ = ['weight','port_brut','tx_remise','remise_ht','port_net','cae_ht','decarbonation','smic_ht','total_ht'];
  let fieldIdx = 0; // index in FIELD_SEQ

  function commitParcel() {
    if (cur) parcels.push(cur);
    cur = null; state = 'idle'; fieldIdx = 0;
  }

  function startParcel(tracking, dateVal) {
    if (cur) commitParcel();
    cur = {
      date: dateVal,
      tracking,
      weight_colissimo: null, port_brut: null, tx_remise: null, remise_ht: null,
      port_net: null, cae_ht: null, decarbonation: null, smic_ht: null, total_ht: null,
      order_id: null, weight_bdd: null, diff_g: null, supplements_list: [],
    };
    fieldIdx = 0;
    state = 'collecting';
  }

  for (const line of lines) {
    // ── Track date context
    const dateM = line.match(/^(\d{2}\/\d{2})\b/);
    if (dateM) lastDate = dateM[1];

    // ── Indemnization detection
    if (INDEMN_START.test(line))  { inIndemn = true;  indemnType = 'Hors Délais'; continue; }
    if (INDEMN_DIVERS.test(line)) { indemnType = 'Diverses'; continue; }

    if (inIndemn) {
      const idM = line.match(INDEMN_ARTICLE);
      if (idM) {
        indemnizations.push({
          date: lastDate, reference: null, tracking: null,
          label: `Article ${idM[1]} - ${idM[2].trim()}`,
          amount: parseFloat(idM[3].replace(',','.')),
          type: indemnType,
        });
      }
      // Full indemnization line format: DD/MM COL-xxx TRACKING label amount€
      const fullIdM = line.match(/(\d{2}\/\d{2})\s+(COL-\S+)\s+(\S+)\s+(Article.+?)\s+([-\d,]+)[€¤]/i);
      if (fullIdM) {
        indemnizations.push({
          date: fullIdM[1], reference: fullIdM[2], tracking: fullIdM[3],
          label: fullIdM[4].trim(),
          amount: parseFloat(fullIdM[5].replace(',','.')),
          type: indemnType,
        });
      }
      continue;
    }

    // ── New tracking number detected
    if (TRACKING_RE.test(line)) {
      const tracking = line.match(TRACKING_RE)[1];
      const lineDate = line.match(DATE_RE)?.[1] || lastDate;
      startParcel(tracking, lineDate);
      continue;
    }

    // ── Collecting parcel values (state machine)
    if (state === 'collecting' && cur) {
      const field = FIELD_SEQ[fieldIdx];
      if (!field) { state = 'done'; continue; }

      if (field === 'weight') {
        if (IS_WEIGHT.test(line)) {
          cur.weight_colissimo = parseFloat(line.trim().replace(',','.'));
          fieldIdx++;
        }
        // Skip non-weight lines (destination, postal code, dimensions)
      } else if (field === 'tx_remise') {
        if (IS_PCT.test(line)) {
          cur.tx_remise = parseFloat(line.trim().replace(/[%\s]/g,'').replace(',','.'));
          fieldIdx++;
        } else if (IS_AMOUNT.test(line)) {
          // tx_remise missing, go to remise_ht
          const v = parseAmt(line.match(IS_AMOUNT)[1]);
          if (v < 0) { cur.remise_ht = v; fieldIdx = FIELD_SEQ.indexOf('port_net'); }
          else       { cur.port_brut = v; fieldIdx = FIELD_SEQ.indexOf('tx_remise'); } // re-align
        }
      } else {
        // Expects an amount line
        if (IS_AMOUNT.test(line)) {
          const v = parseAmt(line.match(IS_AMOUNT)[1]);
          cur[field] = v;
          fieldIdx++;
          if (fieldIdx >= FIELD_SEQ.length) state = 'done';
        }
        // Skip non-amount lines
      }
      continue;
    }

    // ── Supplement label line (after parcel is done or in collecting state)
    if ((state === 'done' || state === 'collecting') && IS_SUPPL.test(line) && cur) {
      // Extract label - remove amount if present on same line
      const inlineAmt = line.match(/([\d,]+)[€¤]\s*$/);
      if (inlineAmt) {
        // Amount is on the same line as label
        const amount = parseFloat(inlineAmt[1].replace(',','.'));
        let label = line.replace(/\s+[\d,]+[€¤]\s*$/, '').replace(/Supplément\s*:\s*/i,'').trim();
        supplements.push({ tracking: cur.tracking, label, amount, parcel_idx: parcels.length });
        cur.supplements_list.push({ label, amount });
        supplLabel = null;
      } else {
        // Amount will be on the next line
        supplLabel = line.replace(/Supplément\s*:\s*/i,'').trim();
      }
      continue;
    }

    // ── Supplement amount on separate line
    if (supplLabel && cur && IS_AMOUNT.test(line)) {
      const amount = parseAmt(line.match(IS_AMOUNT)[1]);
      supplements.push({ tracking: cur.tracking, label: supplLabel, amount, parcel_idx: parcels.length });
      cur.supplements_list.push({ label: supplLabel, amount });
      supplLabel = null;
      continue;
    }
  }

  // Commit last parcel
  if (cur) commitParcel();

  return { parcels, supplements, indemnizations, globalSummary, invoiceNumber, periodStart, periodEnd };
}

/* ─── TRACKING → ORDER ID LOOKUP ────────────────────────────── */
async function resolveOrderIds(trackingNumbers) {
  if (!trackingNumbers.length) return {};
  const res = await pool.query(
    `SELECT wp_order_id::int AS order_id, tracking_number
     FROM orders WHERE tracking_number = ANY($1::text[])`,
    [trackingNumbers]
  );
  const map = {};
  for (const row of res.rows) map[row.tracking_number] = row.order_id;
  return map;
}

/* ─── BDD WEIGHT LOOKUP ──────────────────────────────────────── */
async function fetchBddWeights(orderIds) {
  if (!orderIds.length) return {};
  const settingsRes = await pool.query(
    "SELECT config_value FROM shipping_settings WHERE config_key = 'packaging_weight'"
  );
  const packagingKg = settingsRes.rows[0] ? parseFloat(settingsRes.rows[0].config_value) / 1000 : 0.011;

  const res = await pool.query(`
    SELECT o.wp_order_id::int AS order_id,
           COALESCE(SUM(oi.qty * COALESCE(p.weight, parent.weight, 0)), 0) + $1 AS total_weight
    FROM orders o
    LEFT JOIN order_items oi ON o.wp_order_id = oi.wp_order_id
    LEFT JOIN products p ON (oi.product_id = p.wp_product_id OR oi.variation_id = p.wp_product_id)
    LEFT JOIN products parent ON p.wp_parent_id = parent.wp_product_id
    WHERE o.wp_order_id::int = ANY($2::int[])
    GROUP BY o.wp_order_id
  `, [packagingKg, orderIds]);

  const map = {};
  for (const row of res.rows) map[row.order_id] = Math.round(parseFloat(row.total_weight) * 1000) / 1000;
  return map;
}

/* ─── ENRICH PARCELS ─────────────────────────────────────────── */
async function enrichParcels(parcels) {
  const trackings = parcels.map(p => p.tracking);
  const trackingMap = await resolveOrderIds(trackings);

  for (const p of parcels) {
    if (trackingMap[p.tracking]) p.order_id = trackingMap[p.tracking];
  }

  const orderIds = parcels.filter(p => p.order_id).map(p => p.order_id);
  const weightMap = await fetchBddWeights(orderIds);

  for (const p of parcels) {
    if (p.order_id && weightMap[p.order_id] !== undefined) {
      p.weight_bdd = weightMap[p.order_id];
      if (p.weight_colissimo !== null) {
        p.diff_g = Math.round((p.weight_colissimo - p.weight_bdd) * 1000);
      }
    }
  }
  return parcels;
}

/* ─── EXCEL GENERATOR ────────────────────────────────────────── */
async function generateExcel(data) {
  const { parcels, supplements, indemnizations, globalSummary, invoiceNumber, periodStart, periodEnd } = data;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'YouVape Apps';

  const HDR_BG = '1F4E79'; const HDR_FG = 'FFFFFF';
  const GREEN  = 'C6EFCE'; const RED    = 'FFC7CE';
  const ORANGE = 'FCE4D6'; const BLUE   = 'DBEAFE';

  function styleHeader(row) {
    row.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HDR_BG } };
      cell.font = { bold: true, color: { argb: HDR_FG }, size: 10 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = { top: { style: 'thin', color: { argb: 'CCCCCC' } }, bottom: { style: 'thin', color: { argb: 'CCCCCC' } }, left: { style: 'thin', color: { argb: 'CCCCCC' } }, right: { style: 'thin', color: { argb: 'CCCCCC' } } };
    });
    row.height = 20;
  }

  function styleRow(row, bg) {
    row.eachCell({ includeEmpty: true }, cell => {
      if (bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.border = { top: { style: 'thin', color: { argb: 'EEEEEE' } }, bottom: { style: 'thin', color: { argb: 'EEEEEE' } }, left: { style: 'thin', color: { argb: 'EEEEEE' } }, right: { style: 'thin', color: { argb: 'EEEEEE' } } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
  }

  // ── Sheet 1 : Comparaison poids
  const ws1 = wb.addWorksheet('Comparaison poids');
  ws1.columns = [
    { key: 'order_id', width: 13 }, { key: 'date', width: 8 },
    { key: 'tracking', width: 18 }, { key: 'weight_bdd', width: 13 },
    { key: 'weight_col', width: 15 }, { key: 'diff_g', width: 10 },
  ];
  styleHeader(ws1.addRow(['N° Commande', 'Date', 'N° Suivi', 'Poids BDD (kg)', 'Poids Colissimo (kg)', 'Écart (g)']));
  ws1.views = [{ state: 'frozen', ySplit: 1 }]; ws1.autoFilter = 'A1:F1';

  for (const p of parcels) {
    const diff = p.diff_g;
    const bg = diff === null ? null : Math.abs(diff) <= 20 ? GREEN : Math.abs(diff) > 200 ? RED : null;
    const row = ws1.addRow([p.order_id ?? '—', p.date, p.tracking, p.weight_bdd ?? '—', p.weight_colissimo, diff ?? '—']);
    styleRow(row, bg);
    if (typeof p.weight_bdd === 'number') row.getCell(4).numFmt = '0.000';
    if (typeof p.weight_colissimo === 'number') row.getCell(5).numFmt = '0.000';
    if (typeof diff === 'number') row.getCell(6).numFmt = '+0;-0;0';
  }

  // ── Sheet 2 : Tarifs
  const ws2 = wb.addWorksheet('Tarifs par colis');
  ws2.columns = [
    { key: 'order_id', width: 13 }, { key: 'date', width: 8 },
    { key: 'tracking', width: 18 }, { key: 'port_brut', width: 11 },
    { key: 'tx_remise', width: 11 }, { key: 'remise_ht', width: 11 },
    { key: 'port_net', width: 11 }, { key: 'cae_ht', width: 10 },
    { key: 'total_ht', width: 11 },
  ];
  styleHeader(ws2.addRow(['N° Commande', 'Date', 'N° Suivi', 'Port brut', 'Tx remise', 'Remise HT', 'Port net', 'CAE HT', 'Total HT']));
  ws2.views = [{ state: 'frozen', ySplit: 1 }]; ws2.autoFilter = 'A1:I1';
  const FMT = '#,##0.00 "€"'; const FMTPCT = '0.00"%"';

  for (const p of parcels) {
    const row = ws2.addRow([p.order_id ?? '—', p.date, p.tracking, p.port_brut, p.tx_remise, p.remise_ht, p.port_net, p.cae_ht, p.total_ht]);
    styleRow(row, null);
    [4,6,7,8,9].forEach(i => { if (typeof row.getCell(i).value === 'number') row.getCell(i).numFmt = FMT; });
    if (typeof row.getCell(5).value === 'number') row.getCell(5).numFmt = FMTPCT;
  }

  // ── Sheet 3 : Suppléments
  const ws3 = wb.addWorksheet('Suppléments');
  ws3.columns = [
    { key: 'tracking', width: 18 }, { key: 'order_id', width: 13 },
    { key: 'label', width: 32 }, { key: 'amount', width: 13 },
  ];
  styleHeader(ws3.addRow(['N° Suivi', 'N° Commande', 'Type', 'Montant HT']));
  ws3.views = [{ state: 'frozen', ySplit: 1 }]; ws3.autoFilter = 'A1:D1';
  const orderMap = {};
  for (const p of parcels) if (p.order_id) orderMap[p.tracking] = p.order_id;

  for (const s of supplements) {
    const row = ws3.addRow([s.tracking, orderMap[s.tracking] ?? '—', s.label, s.amount]);
    styleRow(row, ORANGE);
    if (typeof s.amount === 'number') row.getCell(4).numFmt = FMT;
  }
  const totalS = supplements.reduce((sum, s) => sum + (s.amount || 0), 0);
  const totRowS = ws3.addRow(['TOTAL', '', '', totalS]);
  totRowS.font = { bold: true }; totRowS.getCell(4).numFmt = FMT;

  // ── Sheet 4 : Indemnisations
  const ws4 = wb.addWorksheet('Indemnisations');
  ws4.columns = [
    { key: 'date', width: 8 }, { key: 'reference', width: 18 },
    { key: 'tracking', width: 18 }, { key: 'label', width: 38 },
    { key: 'amount', width: 13 }, { key: 'type', width: 16 },
  ];
  styleHeader(ws4.addRow(['Date', 'Référence', 'N° Suivi', 'Libellé', 'Montant HT', 'Type']));
  ws4.views = [{ state: 'frozen', ySplit: 1 }]; ws4.autoFilter = 'A1:F1';

  for (const ind of indemnizations) {
    const row = ws4.addRow([ind.date ?? '—', ind.reference ?? '—', ind.tracking ?? '—', ind.label, ind.amount, ind.type]);
    styleRow(row, BLUE);
    if (typeof ind.amount === 'number') row.getCell(5).numFmt = FMT;
  }
  const totalI = indemnizations.reduce((sum, i) => sum + (i.amount || 0), 0);
  const totRowI = ws4.addRow(['TOTAL', '', '', '', totalI, '']);
  totRowI.font = { bold: true }; totRowI.getCell(5).numFmt = FMT;

  // ── Sheet 5 : Résumé global
  const ws5 = wb.addWorksheet('Résumé global');
  ws5.columns = [{ key: 'label', width: 36 }, { key: 'amount', width: 16 }];
  styleHeader(ws5.addRow(['Poste', 'Montant HT']));

  const summary = [
    ['Facture N°', invoiceNumber ?? '—'],
    ['Période', periodStart && periodEnd ? `${periodStart} → ${periodEnd}` : '—'],
    ['Nombre de colis', parcels.length],
    ['Port Brut', globalSummary.portBrut],
    ['Remise', globalSummary.remise],
    ['Port Net', globalSummary.portNet],
    ['CAE (Coeff. Ajustement Énergie)', globalSummary.cae],
    ['Total Suppléments', globalSummary.supplements ?? supplements.reduce((s,x) => s+(x.amount||0),0)],
    ['Indemnisations', globalSummary.indemnizations ?? indemnizations.reduce((s,i) => s+(i.amount||0),0)],
  ];
  for (const [label, val] of summary) {
    const row = ws5.addRow([label, val]);
    styleRow(row, null);
    if (typeof val === 'number') row.getCell(2).numFmt = FMT;
    row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
  }

  return wb;
}

/* ─── CONTROLLERS ────────────────────────────────────────────── */

exports.analyze = [
  upload.single('pdf'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, error: 'PDF requis' });

      const uint8 = new Uint8Array(req.file.buffer);
      const pdfParser = new PDFParse(uint8);
      await pdfParser.load();
      const pdfData = await pdfParser.getText();
      const parsed = parseColissimoPdf(pdfData.text);
      await enrichParcels(parsed.parcels);

      const { parcels, supplements, indemnizations, globalSummary, invoiceNumber, periodStart, periodEnd } = parsed;

      res.json({
        success: true,
        invoiceNumber,
        periodStart,
        periodEnd,
        parcels,
        supplements,
        indemnizations,
        globalSummary,
        stats: {
          total_parcels: parcels.length,
          parcels_matched: parcels.filter(p => p.order_id).length,
          parcels_unmatched: parcels.filter(p => !p.order_id).length,
          weight_ok: parcels.filter(p => p.diff_g !== null && Math.abs(p.diff_g) <= 20).length,
          weight_ecart: parcels.filter(p => p.diff_g !== null && Math.abs(p.diff_g) > 200).length,
          supplements_count: supplements.length,
          supplements_total: supplements.reduce((s, x) => s + (x.amount || 0), 0),
          indemnizations_total: indemnizations.reduce((s, i) => s + (i.amount || 0), 0),
        },
      });
    } catch (err) {
      console.error('[Colissimo] analyze error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },
];

exports.exportExcel = [
  upload.single('pdf'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, error: 'PDF requis' });

      const uint8 = new Uint8Array(req.file.buffer);
      const pdfParser = new PDFParse(uint8);
      await pdfParser.load();
      const pdfData = await pdfParser.getText();
      const parsed = parseColissimoPdf(pdfData.text);
      await enrichParcels(parsed.parcels);

      const wb = await generateExcel(parsed);
      const fname = `Colissimo_${parsed.invoiceNumber || 'facture'}_${Date.now()}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
      await wb.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error('[Colissimo] exportExcel error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },
];

// POST /api/colissimo/debug-text
exports.debugText = [
  upload.single('pdf'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'PDF requis' });
    const uint8 = new Uint8Array(req.file.buffer);
    const pdfParser = new PDFParse(uint8);
    await pdfParser.load();
    const pdfData = await pdfParser.getText();
    // Return lines containing numbers or € or supplement keywords
    const lines = pdfData.text.split('\n')
      .map((l, i) => `${i}: ${l}`)
      .filter(l => /6A\d|CA\d|Supplément|€|¤|\d,\d\d/.test(l))
      .slice(0, 60);
    res.json({ lines, rawSample: pdfData.text.substring(2000, 3500) });
  }
];
