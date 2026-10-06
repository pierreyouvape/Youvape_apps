const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const pool = require('../config/database');
const { parseMondialRelayPdf, computeAutresFrais, applyGridCheck } = require('../parsers/mondialRelayParser');
const { parseMondialRelayCsv, analyzeMondialRelayCsv } = require('../parsers/mondialRelayCsvParser');
const { orderWeightSql, getPackagingWeight } = require('../services/orderWeightService');

const CARRIER = 'mondial_relay';

// Insère une facture analysée (utilisé par save et import ZIP). Renvoie
// { status: 'inserted'|'already' }.
async function insertParsed(parsed, pdfBuffer) {
  const existing = await pool.query(
    'SELECT id FROM carrier_invoices WHERE carrier = $1 AND invoice_number = $2',
    [CARRIER, parsed.invoiceNumber]
  );
  if (existing.rows.length) {
    if (pdfBuffer) await pool.query('UPDATE carrier_invoices SET pdf_data = $1 WHERE id = $2', [pdfBuffer, existing.rows[0].id]);
    return { status: 'already', id: existing.rows[0].id };
  }
  const r = await pool.query(`
    INSERT INTO carrier_invoices
      (carrier, invoice_number, invoice_date, period_start, period_end, account_number,
       total_parcels, parcels_matched, total_ht, parcels_detail, pdf_data)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING id
  `, [
    CARRIER, parsed.invoiceNumber, parsed.invoiceDate || null,
    parsed.periodStart || null, parsed.periodEnd || null, parsed.pays || null,
    parsed.nbColis ?? 0, parsed.stats?.pu_conform ?? 0, parsed.totalHT ?? null,
    JSON.stringify(parsed), pdfBuffer || null,
  ]);
  return { status: 'inserted', id: r.rows[0].id };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Seuls les fichiers PDF sont acceptés'));
  },
});

const uploadZip = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/zip/i.test(file.mimetype) || /\.zip$/i.test(file.originalname) || file.mimetype === 'application/octet-stream') cb(null, true);
    else cb(new Error('Un fichier ZIP est attendu'));
  },
});

const uploadCsv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.csv$/i.test(file.originalname) || /csv|excel|text\/plain|octet-stream/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Un fichier CSV est attendu'));
  },
});

async function parsePdfBuffer(buffer) {
  const parser = new PDFParse(new Uint8Array(buffer));
  await parser.load();
  const data = await parser.getText();
  return parseMondialRelayPdf(data.text);
}

/* ─── ANNEXE CSV : détail au colis ───────────────────────────── */

// Commandes connues, suivi → commande, et poids calculé en base (g, tare comprise).
async function resolveCsvContext(csv) {
  const refs = [...new Set(csv.parcels.map(r => parseInt(r.ref, 10)).filter(Number.isInteger))];
  const trackings = [...new Set(csv.parcels.flatMap(r => [r.tracking, r.linked]).filter(Boolean))];

  const known = await pool.query(
    'SELECT wp_order_id::int AS id FROM orders WHERE wp_order_id::int = ANY($1::int[])', [refs]
  );
  const byTracking = await pool.query(
    'SELECT wp_order_id::int AS id, tracking_number FROM orders WHERE tracking_number = ANY($1::text[])', [trackings]
  );
  const orderByTracking = {};
  for (const r of byTracking.rows) orderByTracking[r.tracking_number] = r.id;
  const knownOrderIds = new Set(known.rows.map(r => r.id));

  const ids = [...new Set([...knownOrderIds, ...Object.values(orderByTracking)])];
  const tare = await getPackagingWeight(pool, 11);
  const weights = await pool.query(`
    SELECT o.wp_order_id::int AS id, ${orderWeightSql('$1', 'g')} AS grams
    FROM orders o
    LEFT JOIN order_items oi ON o.wp_order_id = oi.wp_order_id AND oi.order_item_type = 'line_item'
    LEFT JOIN products p ON p.wp_product_id = COALESCE(NULLIF(oi.variation_id::int, 0), oi.product_id::int)
    LEFT JOIN products parent ON p.wp_parent_id = parent.wp_product_id
    WHERE o.wp_order_id::int = ANY($2::int[])
    GROUP BY o.wp_order_id
  `, [tare, ids]);
  const bddWeights = {};
  for (const r of weights.rows) bddWeights[r.id] = parseFloat(r.grams);

  return { knownOrderIds, orderByTracking, bddWeights, tare };
}

/**
 * Rattache une annexe CSV à sa facture PDF déjà enregistrée et remplace ses
 * colis. Les coûts par commande alimentent aussitôt /financier (coût réel =
 * Σ carrier_invoice_parcels.amount_ht) ; orders.shipping_cost_calculated n'est
 * touché que par « Mettre à jour les coûts » (applyTariffs).
 */
async function importCsvBuffer(buffer, fileName) {
  const csv = parseMondialRelayCsv(buffer);
  if (!csv.invoiceNumber) throw Object.assign(new Error('Numéro de facture introuvable dans le CSV'), { status: 400 });

  const inv = await pool.query(
    'SELECT id, total_ht, total_parcels, parcels_detail FROM carrier_invoices WHERE carrier = $1 AND invoice_number = $2',
    [CARRIER, csv.invoiceNumber]
  );
  if (!inv.rows.length) {
    throw Object.assign(
      new Error(`La facture ${csv.invoiceNumber} n'est pas enregistrée : importe d'abord son PDF (ou le ZIP Primobox qui contient les deux).`),
      { status: 404, code: 'INVOICE_MISSING' }
    );
  }
  const invoice = inv.rows[0];
  const pdf = invoice.parcels_detail || {};

  const ctx = await resolveCsvContext(csv);
  const analysis = analyzeMondialRelayCsv(csv, {
    ...ctx,
    remiseRate: pdf.remiseRate ?? null,
    pdfTotalHT: invoice.total_ht != null ? parseFloat(invoice.total_ht) : null,
    pdfNbColis: invoice.total_parcels ?? null,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM carrier_invoice_parcels WHERE invoice_id = $1', [invoice.id]);
    const rows = analysis.parcels;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const vals = chunk.map((_, j) => { const b = j * 9; return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9})`; }).join(',');
      const params = chunk.flatMap(p => {
        const bddKg = p.bdd_g != null ? p.bdd_g / 1000 : null;
        return [
          invoice.id, p.tracking || p.ref, p.order_id, p.date,
          p.billed_g ? p.billed_g / 1000 : null, bddKg,
          p.bdd_g != null && p.billed_g ? Math.round(p.billed_g - p.bdd_g) : null,
          p.net, p.is_return,
        ];
      });
      await client.query(
        `INSERT INTO carrier_invoice_parcels (invoice_id,tracking,order_id,date,weight_carrier,weight_bdd,diff_g,amount_ht,is_return) VALUES ${vals}`,
        params
      );
    }
    const { parcels, ...summary } = analysis;
    const csvDetail = { ...summary, fileName: fileName || null, importedAt: new Date().toISOString(), tareG: ctx.tare, parcels };
    await client.query(
      `UPDATE carrier_invoices
         SET parcels_detail = jsonb_set(COALESCE(parcels_detail, '{}'::jsonb), '{csv}', $2::jsonb),
             tariffs_applied_at = NULL
       WHERE id = $1`,
      [invoice.id, JSON.stringify(csvDetail)]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const { parcels, ...summary } = analysis;
  return { invoiceId: invoice.id, invoiceNumber: csv.invoiceNumber, summary };
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

  // Sous-total « Autres frais » (hors gasoil / participations MR standard / remise)
  const totRow = ws2.addRow(['Autres frais (hors gasoil, participations MR, remise)', '', '', computeAutresFrais(parsed).total]);
  totRow.getCell(1).font = { bold: true };
  totRow.getCell(4).font = { bold: true };
  totRow.getCell(4).numFmt = FMT;

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
        (parcels_detail->'stats'->>'reconcile_ok')::boolean AS reconcile_ok,
        tariffs_applied_at,
        (parcels_detail ? 'csv') AS has_csv,
        (parcels_detail->'csv'->>'reconcileOk')::boolean AS csv_reconcile_ok,
        (SELECT COALESCE(SUM((p->>'ecart')::numeric), 0) FROM jsonb_array_elements(COALESCE(parcels_detail->'csv'->'parcels', '[]'::jsonb)) p
          WHERE p->>'kind' = 'aberrant') AS ecart_reclamable,
        parcels_detail->'collecte'       AS collecte,
        parcels_detail->'retourPCI'      AS "retourPCI",
        parcels_detail->'complements'    AS complements,
        parcels_detail->'surcharges'     AS surcharges,
        parcels_detail->'participations' AS participations
      FROM carrier_invoices
      WHERE carrier = $1
      ORDER BY created_at DESC
      LIMIT 200
    `, [CARRIER]);
    // « Autres frais » = frais & remises hors gasoil / participations MR standard / remise
    const invoices = result.rows.map(r => {
      const { total } = computeAutresFrais(r);
      const { collecte, retourPCI, complements, surcharges, participations, ...rest } = r;
      return { ...rest, autres_frais: total };
    });
    res.json({ success: true, invoices });
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
    const { pdf_data, ...invoice } = inv.rows[0];
    res.json({ success: true, invoice, parsed: applyGridCheck(invoice.parcels_detail) });
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
             (parcels_detail->>'totalTTC')::numeric AS total_ttc,
             parcels_detail->'collecte'       AS collecte,
             parcels_detail->'retourPCI'      AS "retourPCI",
             parcels_detail->'complements'    AS complements,
             parcels_detail->'surcharges'     AS surcharges,
             parcels_detail->'participations' AS participations
      FROM carrier_invoices
      WHERE carrier = $1
      ORDER BY period_start
    `, [CARRIER]);
    // « Autres frais » détaillés (hors gasoil / participations MR standard / remise)
    const rows = invoices.rows.map(r => {
      const { total, detail } = computeAutresFrais(r);
      const { collecte, retourPCI, complements, surcharges, participations, ...rest } = r;
      return { ...rest, autres_frais: total, autres_frais_detail: detail };
    });
    res.json({ success: true, invoices: rows });
  } catch (err) {
    console.error('[MondialRelay] getTotals error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/mondial-relay/import-zip — importe en lot toutes les factures PDF d'un ZIP
exports.importZip = [
  uploadZip.single('zip'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, error: 'Fichier ZIP requis' });
      const zip = await JSZip.loadAsync(req.file.buffer);
      const entries = Object.values(zip.files).filter(f => !f.dir && !/__MACOSX/.test(f.name));
      const pdfEntries = entries.filter(f => /\.pdf$/i.test(f.name));
      // Les annexes CSV passent APRÈS les PDF : le ZIP Primobox contient les deux,
      // et une annexe ne se rattache qu'à une facture déjà enregistrée.
      const csvEntries = entries.filter(f => /\.csv$/i.test(f.name));
      if (!pdfEntries.length && !csvEntries.length) return res.status(400).json({ success: false, error: 'Aucun PDF ni CSV trouvé dans le ZIP' });

      let imported = 0, already = 0, csvImported = 0;
      const failed = [];
      for (const entry of pdfEntries) {
        const name = entry.name.split('/').pop();
        try {
          const buf = await entry.async('nodebuffer');
          const parsed = await parsePdfBuffer(buf);
          if (!parsed.invoiceNumber) { failed.push({ name, error: 'Facture Mondial Relay non reconnue' }); continue; }
          const r = await insertParsed(parsed, buf);
          if (r.status === 'inserted') imported++; else already++;
        } catch (e) {
          failed.push({ name, error: e.message });
        }
      }
      for (const entry of csvEntries) {
        const name = entry.name.split('/').pop();
        try {
          await importCsvBuffer(await entry.async('nodebuffer'), name);
          csvImported++;
        } catch (e) {
          failed.push({ name, error: e.message });
        }
      }
      res.json({ success: true, total: pdfEntries.length + csvEntries.length, imported, already, csvImported, failed });
    } catch (err) {
      console.error('[MondialRelay] importZip error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },
];

// POST /api/mondial-relay/import-csv — annexe CSV Primobox d'une facture enregistrée
exports.importCsv = [
  uploadCsv.single('csv'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, error: 'Fichier CSV requis' });
      const r = await importCsvBuffer(req.file.buffer, req.file.originalname);
      res.json({ success: true, ...r });
    } catch (err) {
      if (!err.status) console.error('[MondialRelay] importCsv error:', err);
      res.status(err.status || 500).json({ success: false, error: err.message, code: err.code || null });
    }
  },
];

// POST /api/mondial-relay/history/:id/apply-tariffs
// Coût de livraison des commandes de la facture = somme de TOUS leurs colis
// facturés (aller + retours, toutes factures confondues), net de remise —
// la même somme que le coût réel de /financier.
exports.applyTariffs = async (req, res) => {
  try {
    const { id } = req.params;
    const inv = await pool.query('SELECT id FROM carrier_invoices WHERE id = $1 AND carrier = $2', [id, CARRIER]);
    if (!inv.rows.length) return res.status(404).json({ success: false, error: 'Facture non trouvée' });

    const result = await pool.query(`
      WITH cmd AS (
        SELECT DISTINCT order_id FROM carrier_invoice_parcels
        WHERE invoice_id = $1 AND order_id IS NOT NULL
      ), cout AS (
        SELECT cip.order_id, SUM(cip.amount_ht) AS tarif
        FROM carrier_invoice_parcels cip
        JOIN cmd ON cmd.order_id = cip.order_id
        WHERE cip.amount_ht IS NOT NULL
        GROUP BY cip.order_id
      )
      UPDATE orders o
      SET shipping_cost_calculated = cout.tarif
      FROM cout
      WHERE o.wp_order_id::int = cout.order_id
    `, [id]);
    const upd = await pool.query(
      'UPDATE carrier_invoices SET tariffs_applied_at = NOW() WHERE id = $1 RETURNING tariffs_applied_at', [id]
    );
    res.json({ success: true, updated: result.rowCount, tariffsAppliedAt: upd.rows[0].tariffs_applied_at });
  } catch (err) {
    console.error('[MondialRelay] applyTariffs error:', err);
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
