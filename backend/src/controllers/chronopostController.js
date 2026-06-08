const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const ExcelJS = require('exceljs');
const pool = require('../config/database');

const PACKAGING_KG = 0.011; // 11g

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Seuls les fichiers PDF sont acceptés'));
  },
});

/* ─── PDF PARSER ─────────────────────────────────────────────── */
function parseChronopostPdf(text) {
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const orders = [];
  const supplements = [];
  const globalCharges = [];

  // Tracking number pattern : XS/XN/XF...FR, XR/XT...TS, XV...JB (CRESA), et autres
  const TRACKING_RE = /\b(X[A-Z]\d{9,12}(?:FR|TS|JB|[A-Z]{2}))\b/;
  // Date pattern DD/MM/YYYY
  const DATE_RE = /\b(\d{2}\/\d{2}\/\d{4})\b/;
  // WooCommerce order ID: 7-digit number starting with 12
  const ORDER_ID_RE = /\b(12\d{5})\b/;
  // French decimal numbers
  const FRENCH_NUM_RE = /(\d+),(\d{2,3})/g;

  // Per-order supplement patterns
  const SUPPLEMENT_PATTERNS = [
    { re: /Traitement Retour exp[eé]diteur/i, label: 'Retour expéditeur' },
    { re: /Supp(?:lément)?\s+Retour\s+Exp[eé]diteur/i, label: 'Retour expéditeur international' },
    { re: /Traitement\s+R[eé]acheminement/i, label: 'Réacheminement' },
    { re: /Supplément Zones? Difficiles?/i, label: 'Zone difficile d\'accès' },
    { re: /Supplément manutention/i, label: 'Supplément manutention' },
    { re: /[ÉE]tiquette non conforme/i, label: 'Étiquette non conforme' },
    { re: /Supplément hors norme/i, label: 'Supplément hors norme' },
    { re: /Supplément Zone Internationale [ÉE]loign[ée]+/i, label: 'Zone Internationale Éloignée' },
    { re: /Supplément zone éloignée/i, label: 'Zone éloignée' },
    { re: /Supplément carburant/i, label: 'Surcharge carburant' },
    { re: /Correction de poids/i, label: 'Correction de poids' },
  ];

  // Global invoice charge patterns
  const GLOBAL_PATTERNS = [
    { re: /Redevance sûreté\s+(\d+)\s+colis\s+à\s+([\d,]+)\s+EUR\s+([\d,]+)/i, type: 'redevance' },
    { re: /Participation eco[^0-9]*([\d,]+)\s+colis\s+à\s+([\d,]+)\s+EUR\s+([\d,]+)/i, type: 'eco' },
    { re: /Surcharge Carburant[^:]*:\s*([\d,]+)\s*%[^0-9]*([\d,]+)\s+EUR\s+([\d,]+)/i, type: 'carburant' },
    { re: /Frais de gestion de compte\s*:?\s*([\d,]+)/i, type: 'gestion' },
  ];

  let lastOrderId = null;
  let lastTracking = null;
  let invoiceNumber = null;
  let invoiceDate = null;

  // Extract invoice metadata
  for (const line of lines) {
    const facMatch = line.match(/Facture\s+(\d{8})/i);
    if (facMatch && !invoiceNumber) invoiceNumber = facMatch[1];
    const dateMatch = line.match(/Date\s+(\d{2}\/\d{2}\/\d{4})/i);
    if (dateMatch && !invoiceDate) invoiceDate = dateMatch[1];
  }

  for (const line of lines) {
    // ── Order line (has tracking number)
    if (TRACKING_RE.test(line)) {
      const trackMatch = line.match(TRACKING_RE);
      const dateMatch = line.match(DATE_RE);
      const orderMatch = line.match(ORDER_ID_RE);

      // Extract all French decimals from the line
      const nums = [];
      let m;
      const tmp = line;
      FRENCH_NUM_RE.lastIndex = 0;
      while ((m = FRENCH_NUM_RE.exec(line)) !== null) {
        nums.push({ val: parseFloat(`${m[1]}.${m[2]}`), dec: m[2].length });
      }

      // Weight has 3 decimal places, amount has 2
      const weightNum = nums.find(n => n.dec === 3);
      const amountNum = nums.find(n => n.dec === 2);

      // Detect observation flags
      const isReturn = /\bR{1,2}\b/.test(line);
      const isWeightCorrected = /\bP\b/.test(line);

      if (trackMatch) {
        lastTracking = trackMatch[1];
        lastOrderId = orderMatch ? parseInt(orderMatch[1]) : null;

        // Toujours ajouter le colis — order_id sera résolu via tracking si absent
        orders.push({
          date: dateMatch?.[0] || null,
          tracking: trackMatch[1],
          order_id: orderMatch ? parseInt(orderMatch[1]) : null,
          weight_chrono: weightNum?.val ?? null,
          amount_ht: amountNum?.val ?? null,
          is_return: isReturn,
          weight_corrected: isWeightCorrected,
          weight_bdd: null,
          diff_g: null,
        });
      }
      continue;
    }

    // ── Per-order supplement (no tracking, follows an order line)
    let foundSuppl = false;
    for (const { re, label } of SUPPLEMENT_PATTERNS) {
      if (re.test(line)) {
        // Extract amount from line
        const amtMatch = line.match(/(\d+),(\d{2})/);
        const amount = amtMatch ? parseFloat(`${amtMatch[1]}.${amtMatch[2]}`) : null;
        supplements.push({
          description: label,
          amount_ht: amount,
          related_order_id: lastOrderId,
          related_tracking: lastTracking,
        });
        foundSuppl = true;
        break;
      }
    }
    if (foundSuppl) continue;

    // ── Global invoice charges
    for (const { re, type } of GLOBAL_PATTERNS) {
      const gm = line.match(re);
      if (gm) {
        let description, amount_ht, detail;
        if (type === 'redevance') {
          description = `Redevance sûreté`;
          detail = `${gm[1]} colis × ${gm[2].replace(',', '.')} EUR`;
          amount_ht = parseFloat(gm[3].replace(',', '.'));
        } else if (type === 'eco') {
          description = 'Participation eco-responsable';
          detail = `${gm[1]} colis × ${gm[2].replace(',', '.')} EUR`;
          amount_ht = parseFloat(gm[3].replace(',', '.'));
        } else if (type === 'carburant') {
          description = 'Surcharge Carburant';
          detail = `${gm[1].replace(',', '.')}% sur ${gm[2].replace(',', '.')} EUR`;
          amount_ht = parseFloat(gm[3].replace(',', '.'));
        } else if (type === 'gestion') {
          description = 'Frais de gestion de compte';
          detail = '';
          amount_ht = parseFloat(gm[1].replace(',', '.'));
        }
        // Avoid duplicates
        if (!globalCharges.find(g => g.description === description)) {
          globalCharges.push({ description, detail: detail || '', amount_ht });
        }
        break;
      }
    }
  }

  return { orders, supplements, globalCharges, invoiceNumber, invoiceDate };
}

/* ─── TRACKING → ORDER ID LOOKUP ────────────────────────────── */
async function resolveOrderIdsByTracking(trackingNumbers) {
  if (!trackingNumbers.length) return {};
  const res = await pool.query(
    `SELECT wp_order_id::int AS order_id, tracking_number
     FROM orders
     WHERE UPPER(tracking_number) = ANY($1::text[])`,
    [trackingNumbers.map(t => t.toUpperCase())]
  );
  // Certaines commandes ont leur tracking enregistre en minuscules : on indexe
  // la map par valeur normalisee pour que la comparaison soit insensible a la casse
  const map = {};
  for (const row of res.rows) {
    map[row.tracking_number.toUpperCase()] = row.order_id;
  }
  return map;
}

/* ─── DATABASE WEIGHT LOOKUP ─────────────────────────────────── */
async function fetchBddWeights(orderIds) {
  if (!orderIds.length) return {};

  const settingsRes = await pool.query(
    "SELECT config_value FROM shipping_settings WHERE config_key = 'packaging_weight'"
  );
  const packagingG = settingsRes.rows[0] ? parseFloat(settingsRes.rows[0].config_value) : 11;
  const packagingKg = packagingG / 1000;

  const res = await pool.query(`
    SELECT
      o.wp_order_id::int AS order_id,
      COALESCE(SUM(oi.qty * COALESCE(p.weight, parent.weight, 0)), 0) + $1 AS total_weight
    FROM orders o
    LEFT JOIN order_items oi ON o.wp_order_id = oi.wp_order_id
    LEFT JOIN products p ON p.wp_product_id = COALESCE(NULLIF(oi.variation_id::int, 0), oi.product_id::int)
    LEFT JOIN products parent ON p.wp_parent_id = parent.wp_product_id
    WHERE o.wp_order_id::int = ANY($2::int[])
    GROUP BY o.wp_order_id
  `, [packagingKg, orderIds]);

  const map = {};
  for (const row of res.rows) {
    map[row.order_id] = Math.round(parseFloat(row.total_weight) * 1000) / 1000;
  }
  return map;
}

/* ─── EXCEL GENERATOR ────────────────────────────────────────── */
async function generateExcel(data) {
  const { orders, supplements, globalCharges, invoiceNumber, invoiceDate } = data;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'YouVape Apps';

  // ── Colors
  const HEADER_BG = '1F4E79';
  const HEADER_FG = 'FFFFFF';
  const GREEN_BG = 'C6EFCE';
  const RED_BG = 'FFC7CE';
  const YELLOW_BG = 'FFEB9C';
  const ORANGE_BG = 'FCE4D6';

  function styleHeader(row) {
    row.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
      cell.font = { bold: true, color: { argb: HEADER_FG }, size: 11 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'CCCCCC' } },
        left: { style: 'thin', color: { argb: 'CCCCCC' } },
        bottom: { style: 'thin', color: { argb: 'CCCCCC' } },
        right: { style: 'thin', color: { argb: 'CCCCCC' } },
      };
    });
    row.height = 22;
  }

  function styleDataRow(row, bgColor) {
    row.eachCell({ includeEmpty: true }, cell => {
      if (bgColor) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      }
      cell.border = {
        top: { style: 'thin', color: { argb: 'EEEEEE' } },
        left: { style: 'thin', color: { argb: 'EEEEEE' } },
        bottom: { style: 'thin', color: { argb: 'EEEEEE' } },
        right: { style: 'thin', color: { argb: 'EEEEEE' } },
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
  }

  // ── Sheet 1 : Comparaison poids
  const ws1 = wb.addWorksheet('Comparaison poids');
  ws1.columns = [
    { key: 'order_id', width: 14 },
    { key: 'date', width: 13 },
    { key: 'tracking', width: 20 },
    { key: 'weight_bdd', width: 14 },
    { key: 'weight_chrono', width: 16 },
    { key: 'diff_g', width: 12 },
    { key: 'is_return', width: 12 },
  ];

  const h1 = ws1.addRow(['N° Commande', 'Date', 'N° Suivi', 'Poids BDD (kg)', 'Poids Chrono (kg)', 'Écart (g)', 'Retour']);
  styleHeader(h1);
  ws1.views = [{ state: 'frozen', ySplit: 1 }];
  ws1.autoFilter = { from: 'A1', to: 'G1' };

  for (const o of orders.sort((a, b) => a.order_id - b.order_id)) {
    const row = ws1.addRow([
      o.order_id,
      o.date,
      o.tracking,
      o.weight_bdd ?? 'N/A',
      o.weight_chrono,
      o.diff_g ?? '?',
      o.is_return ? 'Oui' : '',
    ]);

    let bg = null;
    if (o.diff_g === null || o.diff_g === undefined) bg = YELLOW_BG;
    else if (Math.abs(o.diff_g) <= 20) bg = GREEN_BG;
    else if (Math.abs(o.diff_g) > 200) bg = RED_BG;

    styleDataRow(row, bg);

    // Format numbers
    if (typeof o.weight_bdd === 'number') row.getCell(4).numFmt = '0.000';
    if (typeof o.weight_chrono === 'number') row.getCell(5).numFmt = '0.000';
    if (typeof o.diff_g === 'number') row.getCell(6).numFmt = '+0;-0;0';
  }

  // ── Sheet 2 : Suppléments
  const ws2 = wb.addWorksheet('Suppléments par colis');
  ws2.columns = [
    { key: 'related_order_id', width: 16 },
    { key: 'related_tracking', width: 22 },
    { key: 'description', width: 32 },
    { key: 'amount_ht', width: 14 },
  ];

  const h2 = ws2.addRow(['N° Commande', 'N° Suivi', 'Type supplément', 'Montant HT (€)']);
  styleHeader(h2);
  ws2.views = [{ state: 'frozen', ySplit: 1 }];
  ws2.autoFilter = { from: 'A1', to: 'D1' };

  for (const s of supplements) {
    const row = ws2.addRow([
      s.related_order_id ?? 'N/A',
      s.related_tracking ?? '',
      s.description,
      s.amount_ht,
    ]);
    styleDataRow(row, ORANGE_BG);
    if (typeof s.amount_ht === 'number') row.getCell(4).numFmt = '#,##0.00 "€"';
  }

  // ── Sheet 3 : Charges globales
  const ws3 = wb.addWorksheet('Charges globales facture');
  ws3.columns = [
    { key: 'description', width: 34 },
    { key: 'detail', width: 36 },
    { key: 'amount_ht', width: 16 },
  ];

  const h3 = ws3.addRow(['Description', 'Détail', 'Montant HT (€)']);
  styleHeader(h3);
  ws3.views = [{ state: 'frozen', ySplit: 1 }];

  for (const g of globalCharges) {
    const row = ws3.addRow([g.description, g.detail, g.amount_ht]);
    styleDataRow(row, null);
    if (typeof g.amount_ht === 'number') row.getCell(3).numFmt = '#,##0.00 "€"';
  }

  // Total row
  const totalSuppl = supplements.reduce((s, x) => s + (x.amount_ht || 0), 0);
  const totalGlobal = globalCharges.reduce((s, x) => s + (x.amount_ht || 0), 0);
  const totalRow = ws3.addRow(['TOTAL', '', totalSuppl + totalGlobal]);
  totalRow.font = { bold: true };
  totalRow.getCell(3).numFmt = '#,##0.00 "€"';

  return wb;
}

/* ─── CONTROLLERS ────────────────────────────────────────────── */

// POST /api/chronopost/analyze
exports.analyze = [
  upload.single('pdf'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'Fichier PDF requis' });
      }

      // 1. Parse PDF
      const uint8 = new Uint8Array(req.file.buffer);
      const pdfParser = new PDFParse(uint8);
      await pdfParser.load();
      const pdfData = await pdfParser.getText();
      const { orders, supplements, globalCharges, invoiceNumber, invoiceDate } =
        parseChronopostPdf(pdfData.text);

      // 2a. Résoudre les order_id manquants via numéro de suivi
      const trackingsWithoutId = orders
        .filter(o => !o.order_id && o.tracking)
        .map(o => o.tracking);

      if (trackingsWithoutId.length) {
        const trackingMap = await resolveOrderIdsByTracking(trackingsWithoutId);
        for (const o of orders) {
          const key = o.tracking ? o.tracking.toUpperCase() : null;
          if (!o.order_id && key && trackingMap[key]) {
            o.order_id = trackingMap[key];
          }
        }
      }

      // 2b. Query BDD weights
      const numericOrderIds = orders
        .filter(o => o.order_id && !o.is_return)
        .map(o => o.order_id);

      const bddWeights = await fetchBddWeights(numericOrderIds);

      // 3. Merge BDD weights into orders
      for (const o of orders) {
        if (bddWeights[o.order_id] !== undefined) {
          o.weight_bdd = bddWeights[o.order_id];
          o.diff_g = o.weight_chrono !== null
            ? Math.round((o.weight_chrono - o.weight_bdd) * 1000)
            : null;
        }
      }

      res.json({
        success: true,
        invoiceNumber,
        invoiceDate,
        orders,
        supplements,
        globalCharges,
        stats: {
          total_orders: orders.length,
          orders_with_bdd: orders.filter(o => o.weight_bdd !== null).length,
          orders_not_found: orders.filter(o => o.weight_bdd === null && !o.is_return).length,
          returns: orders.filter(o => o.is_return).length,
          supplements_count: supplements.length,
          supplements_total_ht: supplements.reduce((s, x) => s + (x.amount_ht || 0), 0),
        },
      });
    } catch (err) {
      console.error('[Chronopost] analyze error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },
];

// POST /api/chronopost/export-excel
exports.exportExcel = [
  upload.single('pdf'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'Fichier PDF requis' });
      }

      const uint8 = new Uint8Array(req.file.buffer);
      const pdfParser = new PDFParse(uint8);
      await pdfParser.load();
      const pdfData2 = await pdfParser.getText();
      const parsed = parseChronopostPdf(pdfData2.text);

      // Résoudre les order_id via tracking si absent
      const trackingsWithoutId2 = parsed.orders
        .filter(o => !o.order_id && o.tracking)
        .map(o => o.tracking);

      if (trackingsWithoutId2.length) {
        const trackingMap2 = await resolveOrderIdsByTracking(trackingsWithoutId2);
        for (const o of parsed.orders) {
          const key2 = o.tracking ? o.tracking.toUpperCase() : null;
          if (!o.order_id && key2 && trackingMap2[key2]) {
            o.order_id = trackingMap2[key2];
          }
        }
      }

      const numericOrderIds = parsed.orders
        .filter(o => o.order_id && !o.is_return)
        .map(o => o.order_id);

      const bddWeights = await fetchBddWeights(numericOrderIds);

      for (const o of parsed.orders) {
        if (bddWeights[o.order_id] !== undefined) {
          o.weight_bdd = bddWeights[o.order_id];
          o.diff_g = o.weight_chrono !== null
            ? Math.round((o.weight_chrono - o.weight_bdd) * 1000)
            : null;
        }
      }

      const wb = await generateExcel(parsed);

      const fname = `Chronopost_${parsed.invoiceNumber || 'facture'}_${Date.now()}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);

      await wb.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error('[Chronopost] exportExcel error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },
];

// POST /api/chronopost/save — enregistre une facture + son PDF en BDD
exports.saveInvoice = [
  upload.single('pdf'), // PDF optionnel joint en multipart
  async (req, res) => {
    try {
      // Données JSON dans le champ 'data' (multipart) ou directement dans body (json)
      let parsed;
      if (req.body.data) {
        parsed = JSON.parse(req.body.data);
      } else {
        parsed = req.body;
      }
      const { invoiceNumber, invoiceDate, orders, supplements, globalCharges, stats } = parsed;

      if (!invoiceNumber) return res.status(400).json({ success: false, error: 'invoiceNumber requis' });

      // Vérifier si déjà enregistrée
      const existing = await pool.query(
        'SELECT id FROM carrier_invoices WHERE carrier = $1 AND invoice_number = $2',
        ['chronopost', invoiceNumber]
      );
      if (existing.rows.length) {
        // Mettre à jour le PDF si fourni et pas encore stocké
        if (req.file) {
          await pool.query(
            'UPDATE carrier_invoices SET pdf_data = $1 WHERE id = $2',
            [req.file.buffer, existing.rows[0].id]
          );
        }
        return res.json({ success: true, already_saved: true, id: existing.rows[0].id });
      }

      const totalHt = (orders || []).reduce((s, o) => s + (o.amount_ht || 0), 0)
                    + (supplements || []).reduce((s, x) => s + (x.amount_ht || 0), 0);
      const gc = globalCharges || [];
      const pdfBuffer = req.file ? req.file.buffer : null;

      const invRes = await pool.query(`
        INSERT INTO carrier_invoices
          (carrier, invoice_number, invoice_date, total_parcels, parcels_matched,
           total_ht, supplements_total, global_charges, pdf_data)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id
      `, [
        'chronopost', invoiceNumber, invoiceDate || null,
        stats?.total_orders || (orders||[]).length,
        stats?.orders_with_bdd || (orders||[]).filter(o=>o.weight_bdd!==null).length,
        totalHt,
        gc.reduce((s,g) => s+(g.amount_ht||0), 0) + (supplements||[]).reduce((s,x)=>s+(x.amount_ht||0),0),
        JSON.stringify(gc),
        pdfBuffer,
      ]);
      const invoiceId = invRes.rows[0].id;

      if (orders?.length) {
        const vals = orders.map((o,i) => { const b=i*10; return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10})`; }).join(',');
        const params = orders.flatMap(o => [invoiceId, o.tracking||null, o.order_id||null, o.date||null, o.weight_chrono??null, o.weight_bdd??null, o.diff_g??null, o.amount_ht??null, o.is_return||false, o.weight_corrected||false]);
        await pool.query(`INSERT INTO carrier_invoice_parcels (invoice_id,tracking,order_id,date,weight_carrier,weight_bdd,diff_g,amount_ht,is_return,weight_corrected) VALUES ${vals}`, params);
      }

      if (supplements?.length) {
        const vals = supplements.map((s,i) => { const b=i*5; return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5})`; }).join(',');
        const params = supplements.flatMap(s => [invoiceId, s.related_tracking||null, s.related_order_id||null, s.description||null, s.amount_ht??null]);
        await pool.query(`INSERT INTO carrier_invoice_supplements (invoice_id,tracking,order_id,description,amount_ht) VALUES ${vals}`, params);
      }

      res.json({ success: true, already_saved: false, id: invoiceId });
    } catch (err) {
      console.error('[Chronopost] saveInvoice error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },
];

// DELETE /api/chronopost/history/:id — supprimer une facture enregistrée
// POST /api/chronopost/apply-tariffs — met à jour shipping_cost_calculated en une seule requête batch
exports.applyTariffs = async (req, res) => {
  try {
    const { tariffs } = req.body;
    if (!Array.isArray(tariffs) || !tariffs.length) {
      return res.status(400).json({ success: false, error: 'tariffs[] requis' });
    }

    // Filtrer les entrées valides
    const valid = tariffs.filter(t => t.order_id && t.tarif != null);
    const skipped = tariffs.length - valid.length;

    if (!valid.length) return res.json({ success: true, updated: 0, skipped });

    // Une seule requête batch avec VALUES multiples
    // UPDATE orders SET shipping_cost_calculated = c.tarif FROM (VALUES ...) AS c(order_id, tarif)
    // WHERE orders.wp_order_id::int = c.order_id
    const valueRows = valid.map((_, i) => `($${i * 2 + 1}::int, $${i * 2 + 2}::numeric)`).join(', ');
    const params = valid.flatMap(t => [t.order_id, parseFloat(t.tarif.toFixed(4))]);

    const result = await pool.query(`
      UPDATE orders
      SET shipping_cost_calculated = c.tarif
      FROM (VALUES ${valueRows}) AS c(order_id, tarif)
      WHERE orders.wp_order_id::int = c.order_id
    `, params);

    res.json({ success: true, updated: result.rowCount, skipped });
  } catch (err) {
    console.error('[Chronopost] applyTariffs error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.deleteInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM carrier_invoices WHERE id=$1 AND carrier=$2 RETURNING invoice_number',
      [id, 'chronopost']
    );
    if (!result.rows.length) return res.status(404).json({ success: false, error: 'Facture non trouvée' });
    res.json({ success: true, deleted: result.rows[0].invoice_number });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/chronopost/history/:id/pdf — télécharger le PDF d'une facture
exports.downloadPdf = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT invoice_number, pdf_data FROM carrier_invoices WHERE id=$1 AND carrier=$2',
      [id, 'chronopost']
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Facture non trouvée' });
    const { invoice_number, pdf_data } = result.rows[0];
    if (!pdf_data) return res.status(404).json({ error: 'PDF non disponible pour cette facture' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Chronopost_${invoice_number}.pdf"`);
    res.send(pdf_data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/chronopost/history — liste des factures enregistrées
exports.getHistory = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        ci.id, ci.invoice_number, ci.invoice_date, ci.total_parcels,
        ci.parcels_matched, ci.total_ht, ci.supplements_total,
        ci.created_at,
        COUNT(DISTINCT cip.id) AS parcel_count,
        SUM(CASE WHEN cip.diff_g IS NOT NULL AND ABS(cip.diff_g) <= 20 THEN 1 ELSE 0 END) AS weight_ok,
        SUM(CASE WHEN cip.diff_g IS NOT NULL AND ABS(cip.diff_g) > 200 THEN 1 ELSE 0 END) AS weight_ecart
      FROM carrier_invoices ci
      LEFT JOIN carrier_invoice_parcels cip ON cip.invoice_id = ci.id
      WHERE ci.carrier = 'chronopost'
      GROUP BY ci.id
      ORDER BY ci.created_at DESC
      LIMIT 50
    `);
    res.json({ success: true, invoices: result.rows });
  } catch (err) {
    console.error('[Chronopost] getHistory error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/chronopost/history/:id — détail d'une facture enregistrée
exports.getInvoiceDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const inv = await pool.query('SELECT * FROM carrier_invoices WHERE id=$1 AND carrier=$2', [id,'chronopost']);
    if (!inv.rows.length) return res.status(404).json({ success: false, error: 'Facture non trouvée' });

    const parcels = await pool.query(
      'SELECT * FROM carrier_invoice_parcels WHERE invoice_id=$1 ORDER BY id', [id]
    );
    const suppl = await pool.query(
      'SELECT * FROM carrier_invoice_supplements WHERE invoice_id=$1 ORDER BY id', [id]
    );

    res.json({
      success: true,
      invoice: inv.rows[0],
      parcels: parcels.rows,
      supplements: suppl.rows,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/chronopost/debug-text — retourne le texte brut extrait du PDF (debug)
exports.debugText = [
  upload.single('pdf'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'PDF requis' });
    const uint8 = new Uint8Array(req.file.buffer);
    const pdfParser = new PDFParse(uint8);
    await pdfParser.load();
    const pdfData = await pdfParser.getText();
    res.json({ text: pdfData.text, lines: pdfData.text.split('\n').map((l,i) => `${i}: ${l}`) });
  }
];
