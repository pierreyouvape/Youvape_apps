const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const pool = require('../config/database');
const { orderWeightSql, getPackagingWeight } = require('../services/orderWeightService');

// Agrège les colis par pays de destination : { FR: { colis, ht }, BE: {...}, ... }
function buildCountryTotals(items, amountKey) {
  const map = {};
  for (const it of (items || [])) {
    const c = it.country || '—';
    if (!map[c]) map[c] = { colis: 0, ht: 0 };
    map[c].colis += 1;
    map[c].ht += (it[amountKey] || 0);
  }
  return map;
}
exports._parsePdf = parseColissimoPdf;
exports._buildCountryTotals = buildCountryTotals;
exports._analyzeBuffer = analyzeColissimoBuffer;
exports._parseCsv = parseColissimoCsv;

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

  // Tous les n° de suivi Colissimo (13 car.), 2 familles :
  //  • National / Outre-mer : chiffre+lettre + 11 chiffres (6A, 6C, 8Q, 8R, 9L, 9V…)
  //  • International         : 2 lettres + 9 chiffres + FR (CA, CB, CF, CG, CI, CM, EY…)
  const TRACKING_RE = /\b([0-9][A-Z]\d{11}|[A-Z]{2}\d{9}FR)\b/;
  const DATE_RE     = /\b(\d{2}\/\d{2})\b/;

  // ── Metadata extraction
  const INVOICE_RE  = /Facture\s+N°\s*(\w+)/i;
  const ACCOUNT_RE  = /[Cc]ompte\s*(?:client)?\s*n°?\s*:?\s*(\d{4,12})/;
  const PERIOD_RE   = /du\s+(\d{2}\/\d{2}\/\d{4})\s+au\s+(\d{2}\/\d{2}\/\d{4})/i;
  const PORTBRUT_RE = /^Port Brut\s+([\d\s,]+)/i;
  const REMISE_RE   = /^Remise\s+(-[\d\s,]+)/i;
  const PORTNET_RE  = /^Port Net\s+([\d\s,]+)/i;
  const CAE_RE      = /^Coefficient.*[ÉE]nergie\s+([\d\s,]+)/i;
  const SUPPTOT_RE  = /^Suppl?ements?\s+([\d\s,]+)/i;
  const INDEMTOT_RE = /^Indemnisations\s+(-[\d\s,]+)/i;
  // Ligne récap : "Article Supplément Participation à la décarbonation - TVA 20.00% 987 0,05€ 49,35€"
  const DECARBO_RE  = /Article Suppl[ée]ment Participation.*?d[ée]carbonation.*?\d+\s+([\d,]+)\s*[€¤]\s+[\d,]+\s*[€¤]/i;

  let invoiceNumber = null, periodStart = null, periodEnd = null, accountNumber = null;

  for (const line of lines) {
    const invM = line.match(INVOICE_RE); if (invM && !invoiceNumber) invoiceNumber = invM[1];
    const accM = line.match(ACCOUNT_RE); if (accM && !accountNumber) accountNumber = accM[1];
    const perM = line.match(PERIOD_RE);  if (perM && !periodStart) { periodStart = perM[1]; periodEnd = perM[2]; }
    const pbM = line.match(PORTBRUT_RE); if (pbM) globalSummary.portBrut = parseFloat(pbM[1].replace(/\s/g,'').replace(',','.'));
    const rmM = line.match(REMISE_RE);   if (rmM) globalSummary.remise   = parseFloat(rmM[1].replace(/\s/g,'').replace(',','.'));
    const pnM = line.match(PORTNET_RE);  if (pnM) globalSummary.portNet  = parseFloat(pnM[1].replace(/\s/g,'').replace(',','.'));
    const caeM = line.match(CAE_RE);     if (caeM) globalSummary.cae     = parseFloat(caeM[1].replace(/\s/g,'').replace(',','.'));
    const spM = line.match(SUPPTOT_RE);  if (spM) globalSummary.supplements = parseFloat(spM[1].replace(/\s/g,'').replace(',','.'));
    const idM = line.match(INDEMTOT_RE); if (idM) globalSummary.indemnizations = parseFloat(idM[1].replace(/\s/g,'').replace(',','.'));
    const dcM = line.match(DECARBO_RE);  if (dcM && globalSummary.decarbonationUnit == null) globalSummary.decarbonationUnit = parseFloat(dcM[1].replace(',','.'));
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
      order_id: null, weight_bdd: null, diff_g: null, country: null, supplements_list: [],
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

    // ── Pays de destination (ligne "FR FR 75009" = départ arrivée CP) juste après le tracking
    if (state === 'collecting' && cur && !cur.country) {
      const cm = line.match(/^\s*([A-Z]{2})\s+([A-Z]{2})\s+\S+/);
      if (cm) { cur.country = cm[2]; continue; }
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

  return { parcels, supplements, indemnizations, globalSummary, invoiceNumber, periodStart, periodEnd, accountNumber };
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
  // Repli à 11 g conservé : c'est ce que faisait ce contrôleur avant l'extraction.
  const packagingKg = (await getPackagingWeight(pool, 11)) / 1000;

  const res = await pool.query(`
    SELECT o.wp_order_id::int AS order_id,
           ${orderWeightSql('$1', 'kg')} AS total_weight
    FROM orders o
    LEFT JOIN order_items oi ON o.wp_order_id = oi.wp_order_id AND oi.order_item_type = 'line_item'
    LEFT JOIN products p ON p.wp_product_id = COALESCE(NULLIF(oi.variation_id::int, 0), oi.product_id::int)
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

/* ─── PARSER CSV COLISSIMO BOX (nouveau format 2026) ──────────── */
/*
 * Depuis la facture d'août 2026, le PDF Colissimo est agrégé : plus aucun
 * n° de suivi, donc plus de comparaison de poids possible (cf. la note de
 * facture qui renvoie vers Colissimo Box). Le détail unitaire est livré dans
 * un ZIP contenant CSV_Prestations_au_colis.csv + CSV_Indemnisations.csv,
 * en ISO-8859-1 et séparés par des « ; ».
 *
 * Chaque colis y occupe plusieurs lignes, une par « Rubrique de la facture » :
 *   FRAIS DE PORT       → 2 lignes : « Charge 6A » (port brut) et
 *                         « Remise Charge 6A » (remise, qui porte le %)
 *   AJUSTEMENT ENERGIE  → CAE
 *   AJUSTEMENT SMIC     → nouveau poste (absent de l'ancien format)
 *   SUPPLEMENTS         → décarbonation, sûreté internationale, qualité
 *                         d'annonce, poids volumétrique…
 * On les ré-agrège par « N colis » pour retrouver la structure `parcels`
 * du parseur PDF, à l'identique en aval (Excel, persistance, réclamations).
 */
const CSV_COUNTRY_ISO = {
  'FRANCE': 'FR', 'BELGIQUE': 'BE', 'SUISSE': 'CH', 'LUXEMBOURG': 'LU',
  'PAYS-BAS': 'NL', 'ALLEMAGNE': 'DE', 'ESPAGNE': 'ES', 'PORTUGAL': 'PT',
  'ITALIE': 'IT', 'DANEMARK': 'DK', 'POLOGNE': 'PL', 'HONGRIE': 'HU',
  'LITUANIE': 'LT', 'MONACO': 'MC', 'REUNION': 'RE', 'MARTINIQUE': 'MQ',
  'GUADELOUPE': 'GP', 'GUYANE': 'GF', 'MAYOTTE': 'YT',
  'POLYNESIE FRANCAISE': 'PF', 'NOUVELLE-CALEDONIE': 'NC',
};

function csvSplitLine(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === ';' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function csvParse(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim().length);
  if (!lines.length) return [];
  const headers = csvSplitLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = csvSplitLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = (cells[i] ?? '').trim(); });
    return row;
  });
}

// Retrouve une colonne par mot-clé : les entêtes Colissimo varient
// (« Produit » avec espace final, « Référence externe colis client »…).
function csvCol(headers, ...needles) {
  const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  for (const n of needles) {
    const hit = headers.find(h => norm(h).includes(norm(n)));
    if (hit) return hit;
  }
  return null;
}

function csvNum(s) {
  if (s === undefined || s === null || !String(s).trim()) return null;
  const v = parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
  return Number.isNaN(v) ? null : v;
}

function parseColissimoCsv(prestationsText, indemnisationsText) {
  const rows = csvParse(prestationsText || '');
  const parcels = [];
  const supplements = [];
  const indemnizations = [];
  const globalSummary = {};
  let invoiceNumber = null, accountNumber = null;
  const allDates = [];

  if (rows.length) {
    const H = Object.keys(rows[0]);
    const C = {
      invoice: csvCol(H, 'N facture', 'N° facture'),
      date: csvCol(H, 'Date'),
      account: csvCol(H, 'Compte deposant', 'Compte déposant'),
      desc: csvCol(H, 'Description'),
      product: csvCol(H, 'Produit'),
      parcel: csvCol(H, 'N colis', 'N° colis'),
      country: csvCol(H, 'Pays Destination'),
      cp: csvCol(H, 'Code Postal Destination'),
      discount: csvCol(H, 'Pourcentage de remise'),
      ref: csvCol(H, 'externe colis client'),
      nature: csvCol(H, 'Nature du poids'),
      weight: csvCol(H, 'Poids Kg'),
      len: csvCol(H, 'LEN'), hgt: csvCol(H, 'HGT'), wid: csvCol(H, 'WID'),
      total: csvCol(H, 'Total HT'),
      rubrique: csvCol(H, 'Rubrique de la facture'),
      charge: csvCol(H, 'Code charge'),
    };

    const byParcel = new Map();
    for (const r of rows) {
      const tracking = C.parcel ? r[C.parcel] : '';
      if (!tracking) continue;
      if (!invoiceNumber && C.invoice) invoiceNumber = r[C.invoice] || null;
      if (!accountNumber && C.account) accountNumber = r[C.account] || null;

      if (!byParcel.has(tracking)) {
        byParcel.set(tracking, {
          date: null, tracking,
          weight_colissimo: null, port_brut: null, tx_remise: null, remise_ht: null,
          port_net: null, cae_ht: null, smic_ht: null, decarbonation: null, total_ht: null,
          order_id: null, weight_bdd: null, diff_g: null, country: null,
          postal_code: null, product: null, weight_type: null, dimensions: null,
          supplements_list: [],
        });
      }
      const p = byParcel.get(tracking);

      const fullDate = C.date ? r[C.date] : '';
      if (fullDate) {
        allDates.push(fullDate);
        if (!p.date) p.date = fullDate.slice(0, 5); // DD/MM, comme le parseur PDF
      }
      if (!p.country && C.country && r[C.country]) {
        const name = r[C.country].toUpperCase();
        p.country = CSV_COUNTRY_ISO[name] || name;
      }
      if (!p.postal_code && C.cp) p.postal_code = r[C.cp] || null;
      if (!p.product && C.product) p.product = r[C.product] || null;

      const rubrique = (C.rubrique ? r[C.rubrique] : '').toUpperCase();
      const desc = C.desc ? r[C.desc] : '';
      const amount = csvNum(C.total ? r[C.total] : null);
      if (amount === null) continue;

      if (rubrique === 'FRAIS DE PORT') {
        // Le % de remise n'est porté que par la ligne « Remise Charge XX »
        if (/^Remise/i.test(desc)) {
          p.remise_ht = (p.remise_ht ?? 0) + amount;
          const pct = csvNum(C.discount ? r[C.discount] : null);
          if (pct !== null) p.tx_remise = pct;
        } else {
          p.port_brut = (p.port_brut ?? 0) + amount;
          const w = csvNum(C.weight ? r[C.weight] : null);
          if (w !== null) p.weight_colissimo = w;
          if (C.nature && r[C.nature]) p.weight_type = r[C.nature]; // M = réel, V = volumétrique
          const dims = [C.len, C.hgt, C.wid].map(c => (c ? r[c] : '')).filter(Boolean);
          if (dims.length === 3) p.dimensions = dims.join('x');
        }
      } else if (rubrique.includes('ENERGIE')) {
        p.cae_ht = (p.cae_ht ?? 0) + amount;
      } else if (rubrique.includes('SMIC')) {
        p.smic_ht = (p.smic_ht ?? 0) + amount;
      } else if (rubrique === 'SUPPLEMENTS') {
        const code = C.charge ? r[C.charge] : '';
        if (/DECARBONATION/i.test(code) || /d[ée]carbonation/i.test(desc)) {
          p.decarbonation = (p.decarbonation ?? 0) + amount;
        } else {
          const label = desc.replace(/^Suppl[ée]ment\s*:\s*/i, '').replace(/^Article\s+/i, '').trim();
          supplements.push({ tracking, label, amount, parcel_idx: parcels.length });
          p.supplements_list.push({ label, amount });
        }
      }
      if (C.ref && r[C.ref] && !p.order_id) p.order_id = parseInt(r[C.ref], 10) || null;
    }

    for (const p of byParcel.values()) {
      if (p.port_brut !== null || p.remise_ht !== null) {
        p.port_net = Math.round(((p.port_brut ?? 0) + (p.remise_ht ?? 0)) * 100) / 100;
      }
      const suppTotal = p.supplements_list.reduce((s, x) => s + x.amount, 0);
      p.total_ht = Math.round((
        (p.port_net ?? 0) + (p.cae_ht ?? 0) + (p.smic_ht ?? 0) + (p.decarbonation ?? 0) + suppTotal
      ) * 100) / 100;
      parcels.push(p);
    }

    const sum = fn => Math.round(parcels.reduce((s, p) => s + (fn(p) ?? 0), 0) * 100) / 100;
    globalSummary.portBrut = sum(p => p.port_brut);
    globalSummary.remise = sum(p => p.remise_ht);
    globalSummary.portNet = sum(p => p.port_net);
    globalSummary.cae = sum(p => p.cae_ht);
    globalSummary.smic = sum(p => p.smic_ht);
    globalSummary.supplements = Math.round((
      sum(p => p.decarbonation) + supplements.reduce((s, x) => s + (x.amount || 0), 0)
    ) * 100) / 100;
    const decarbUnits = parcels.map(p => p.decarbonation).filter(v => v);
    if (decarbUnits.length) globalSummary.decarbonationUnit = decarbUnits[0];
  }

  // ── CSV_Indemnisations.csv (n° de suivi + référence COL-…, absents du PDF)
  const indRows = csvParse(indemnisationsText || '');
  if (indRows.length) {
    const H = Object.keys(indRows[0]);
    const C = {
      date: csvCol(H, 'Date'), desc: csvCol(H, 'Description'),
      parcel: csvCol(H, 'N colis', 'N° colis'), ref: csvCol(H, 'Reference', 'Référence'),
      total: csvCol(H, 'Total HT'),
    };
    for (const r of indRows) {
      const amount = csvNum(C.total ? r[C.total] : null);
      if (amount === null) continue;
      indemnizations.push({
        date: C.date && r[C.date] ? r[C.date].slice(0, 5) : null,
        reference: C.ref ? (r[C.ref] || null) : null,
        tracking: C.parcel ? (r[C.parcel] || null) : null,
        label: C.desc ? r[C.desc].replace(/\s+/g, ' ').trim() : '',
        amount,
        type: 'Diverses',
      });
    }
  }
  globalSummary.indemnizations = Math.round(
    indemnizations.reduce((s, i) => s + (i.amount || 0), 0) * 100
  ) / 100;

  // Période = min/max des dates de dépôt (le CSV ne porte pas d'entête de période)
  let periodStart = null, periodEnd = null;
  if (allDates.length) {
    const toKey = d => { const [dd, mm, yy] = d.split('/'); return `${yy}${mm}${dd}`; };
    const sorted = [...new Set(allDates)].sort((a, b) => toKey(a).localeCompare(toKey(b)));
    periodStart = sorted[0];
    periodEnd = sorted[sorted.length - 1];
  }

  return { parcels, supplements, indemnizations, globalSummary, invoiceNumber, periodStart, periodEnd, accountNumber };
}

/* ─── Extraction du ZIP Colissimo Box (ZIP imbriqué) ──────────── */
async function extractColissimoCsvZip(buffer) {
  let zip = await JSZip.loadAsync(buffer);
  // Le téléchargement Colissimo Box est un ZIP contenant un second ZIP
  for (let depth = 0; depth < 3; depth++) {
    const entries = Object.values(zip.files).filter(f => !f.dir && !/__MACOSX/.test(f.name));
    if (entries.some(f => /\.csv$/i.test(f.name))) break;
    const inner = entries.find(f => /\.zip$/i.test(f.name));
    if (!inner) break;
    zip = await JSZip.loadAsync(await inner.async('nodebuffer'));
  }
  const entries = Object.values(zip.files).filter(f => !f.dir && !/__MACOSX/.test(f.name) && /\.csv$/i.test(f.name));
  const read = async entry => (await entry.async('nodebuffer')).toString('latin1'); // ISO-8859-1
  const prest = entries.find(f => /prestation/i.test(f.name));
  const indem = entries.find(f => /indemnisation/i.test(f.name));
  return {
    prestations: prest ? await read(prest) : null,
    indemnisations: indem ? await read(indem) : null,
    names: entries.map(f => f.name.split('/').pop()),
  };
}

async function analyzeColissimoCsvBuffer(buffer) {
  const { prestations, indemnisations, names } = await extractColissimoCsvZip(buffer);
  if (!prestations) {
    throw new Error(`CSV_Prestations_au_colis.csv introuvable dans le ZIP${names.length ? ` (contenu : ${names.join(', ')})` : ''}`);
  }
  const parsed = parseColissimoCsv(prestations, indemnisations);
  await enrichParcels(parsed.parcels);
  const { parcels, supplements, indemnizations, globalSummary, invoiceNumber, periodStart, periodEnd, accountNumber } = parsed;
  const stats = {
    total_parcels: parcels.length,
    parcels_matched: parcels.filter(p => p.order_id).length,
    parcels_unmatched: parcels.filter(p => !p.order_id).length,
    weight_ok: parcels.filter(p => p.diff_g !== null && Math.abs(p.diff_g) <= 20).length,
    weight_ecart: parcels.filter(p => p.diff_g !== null && Math.abs(p.diff_g) > 200).length,
    supplements_count: supplements.length,
    supplements_total: supplements.reduce((s, x) => s + (x.amount || 0), 0),
    indemnizations_total: indemnizations.reduce((s, i) => s + (i.amount || 0), 0),
  };
  return { invoiceNumber, periodStart, periodEnd, accountNumber, parcels, supplements, indemnizations, globalSummary, stats, source: 'csv' };
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

      const { parcels, supplements, indemnizations, globalSummary, invoiceNumber, periodStart, periodEnd, accountNumber } = parsed;

      // La "Participation à la décarbonation" (0,05€/colis) n'apparaît que dans le récapitulatif
      // global, jamais ligne par ligne — on la reporte sur chaque colis pour qu'elle survive
      // à l'enregistrement/rechargement et puisse être appliquée aux commandes correspondantes.
      if (globalSummary.decarbonationUnit != null) {
        for (const p of parcels) p.decarbonation_unit = globalSummary.decarbonationUnit;
      }

      res.json({
        success: true,
        invoiceNumber,
        periodStart,
        periodEnd,
        accountNumber,
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

// POST /api/colissimo/analyze-csv — nouveau format : ZIP Colissimo Box (CSV au colis)
exports.analyzeCsv = [
  uploadZip.single('zip'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, error: 'ZIP Colissimo Box requis' });
      const parsed = await analyzeColissimoCsvBuffer(req.file.buffer);
      if (!parsed.invoiceNumber) {
        return res.status(400).json({ success: false, error: 'N° de facture introuvable dans le CSV' });
      }
      res.json({ success: true, ...parsed });
    } catch (err) {
      console.error('[Colissimo] analyzeCsv error:', err);
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

/* ─── HISTORIQUE / ENREGISTREMENT ───────────────────────────── */

// POST /api/colissimo/save — enregistre la facture analysée + PDF en BDD
// POST /api/colissimo/export-excel-csv — export Excel depuis le ZIP Colissimo Box
exports.exportExcelCsv = [
  uploadZip.single('zip'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, error: 'ZIP Colissimo Box requis' });
      const parsed = await analyzeColissimoCsvBuffer(req.file.buffer);
      const wb = await generateExcel(parsed);
      const fname = `Colissimo_${parsed.invoiceNumber || 'facture'}_${Date.now()}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
      await wb.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error('[Colissimo] exportExcelCsv error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },
];

exports.saveInvoice = [
  upload.single('pdf'),
  async (req, res) => {
    try {
      let parsed;
      if (req.body.data) parsed = JSON.parse(req.body.data);
      else parsed = req.body;

      const { invoiceNumber, periodStart, periodEnd, accountNumber, parcels, supplements, indemnizations, globalSummary, stats } = parsed;
      if (!invoiceNumber) return res.status(400).json({ success: false, error: 'invoiceNumber requis' });

      const existing = await pool.query(
        'SELECT id FROM carrier_invoices WHERE carrier = $1 AND invoice_number = $2',
        ['colissimo', invoiceNumber]
      );
      if (existing.rows.length) {
        if (req.file) {
          await pool.query('UPDATE carrier_invoices SET pdf_data = $1 WHERE id = $2', [req.file.buffer, existing.rows[0].id]);
        }
        return res.json({ success: true, already_saved: true, id: existing.rows[0].id });
      }

      const gs = globalSummary || {};
      const supplementsTotal = (supplements || []).reduce((s, x) => s + (x.amount || 0), 0);
      const indemnizationsTotal = (indemnizations || []).reduce((s, i) => s + (i.amount || 0), 0);
      const totalHt = (parcels || []).reduce((s, p) => s + (p.total_ht || 0), 0) + supplementsTotal;
      const pdfBuffer = req.file ? req.file.buffer : null;

      const invRes = await pool.query(`
        INSERT INTO carrier_invoices
          (carrier, invoice_number, period_start, period_end, account_number,
           total_parcels, parcels_matched, total_ht, port_brut, remise, port_net, cae,
           supplements_total, indemnizations_total, indemnizations, parcels_detail, country_totals, pdf_data)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        RETURNING id
      `, [
        'colissimo', invoiceNumber, periodStart || null, periodEnd || null, accountNumber || null,
        stats?.total_parcels ?? (parcels || []).length,
        stats?.parcels_matched ?? (parcels || []).filter(p => p.order_id).length,
        totalHt,
        gs.portBrut ?? null, gs.remise ?? null, gs.portNet ?? null, gs.cae ?? null,
        supplementsTotal, indemnizationsTotal,
        JSON.stringify(indemnizations || []),
        JSON.stringify(parcels || []),
        JSON.stringify(buildCountryTotals(parcels, 'total_ht')),
        pdfBuffer,
      ]);
      const invoiceId = invRes.rows[0].id;

      if (parcels?.length) {
        const vals = parcels.map((_, i) => { const b = i * 8; return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8})`; }).join(',');
        const params = parcels.flatMap(p => [invoiceId, p.tracking || null, p.order_id || null, p.date || null, p.weight_colissimo ?? null, p.weight_bdd ?? null, p.diff_g ?? null, p.total_ht ?? null]);
        await pool.query(`INSERT INTO carrier_invoice_parcels (invoice_id,tracking,order_id,date,weight_carrier,weight_bdd,diff_g,amount_ht) VALUES ${vals}`, params);
      }

      if (supplements?.length) {
        const orderMap = {};
        for (const p of (parcels || [])) if (p.order_id) orderMap[p.tracking] = p.order_id;
        const vals = supplements.map((_, i) => { const b = i * 5; return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5})`; }).join(',');
        const params = supplements.flatMap(s => [invoiceId, s.tracking || null, orderMap[s.tracking] || null, s.label || null, s.amount ?? null]);
        await pool.query(`INSERT INTO carrier_invoice_supplements (invoice_id,tracking,order_id,description,amount_ht) VALUES ${vals}`, params);
      }

      res.json({ success: true, already_saved: false, id: invoiceId });
    } catch (err) {
      console.error('[Colissimo] saveInvoice error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },
];

// POST /api/colissimo/apply-tariffs — met à jour shipping_cost_calculated avec le Total HT par colis
exports.applyTariffs = async (req, res) => {
  try {
    const { tariffs, invoiceId } = req.body;
    if (!Array.isArray(tariffs) || !tariffs.length) {
      return res.status(400).json({ success: false, error: 'tariffs[] requis' });
    }

    const valid = tariffs.filter(t => t.order_id && t.tarif != null);
    const skipped = tariffs.length - valid.length;
    if (!valid.length) return res.json({ success: true, updated: 0, skipped });

    const valueRows = valid.map((_, i) => `($${i * 2 + 1}::int, $${i * 2 + 2}::numeric)`).join(', ');
    const params = valid.flatMap(t => [t.order_id, parseFloat(t.tarif.toFixed(4))]);

    const result = await pool.query(`
      UPDATE orders
      SET shipping_cost_calculated = c.tarif
      FROM (VALUES ${valueRows}) AS c(order_id, tarif)
      WHERE orders.wp_order_id::int = c.order_id
    `, params);

    let appliedAt = null;
    if (invoiceId) {
      const upd = await pool.query(
        `UPDATE carrier_invoices SET tariffs_applied_at = NOW() WHERE id = $1 AND carrier = 'colissimo' RETURNING tariffs_applied_at`,
        [invoiceId]
      );
      appliedAt = upd.rows[0]?.tariffs_applied_at || null;
    }

    res.json({ success: true, updated: result.rowCount, skipped, tariffsAppliedAt: appliedAt });
  } catch (err) {
    console.error('[Colissimo] applyTariffs error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// DELETE /api/colissimo/history/:id
exports.deleteInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM carrier_invoices WHERE id=$1 AND carrier=$2 RETURNING invoice_number',
      [id, 'colissimo']
    );
    if (!result.rows.length) return res.status(404).json({ success: false, error: 'Facture non trouvée' });
    res.json({ success: true, deleted: result.rows[0].invoice_number });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/colissimo/history/:id/pdf — télécharger le PDF d'une facture
exports.downloadPdf = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT invoice_number, pdf_data FROM carrier_invoices WHERE id=$1 AND carrier=$2',
      [id, 'colissimo']
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Facture non trouvée' });
    const { invoice_number, pdf_data } = result.rows[0];
    if (!pdf_data) return res.status(404).json({ error: 'PDF non disponible pour cette facture' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Colissimo_${invoice_number}.pdf"`);
    res.send(pdf_data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/colissimo/history — liste des factures enregistrées
exports.getHistory = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        ci.id, ci.invoice_number, ci.period_start, ci.period_end, ci.account_number,
        ci.total_parcels, ci.parcels_matched, ci.total_ht,
        ci.port_brut, ci.remise, ci.port_net, ci.cae,
        ci.supplements_total, ci.indemnizations_total, ci.created_at, ci.tariffs_applied_at,
        SUM(CASE WHEN cip.diff_g IS NOT NULL AND ABS(cip.diff_g) <= 20 THEN 1 ELSE 0 END) AS weight_ok,
        SUM(CASE WHEN cip.diff_g IS NOT NULL AND ABS(cip.diff_g) > 200 THEN 1 ELSE 0 END) AS weight_ecart
      FROM carrier_invoices ci
      LEFT JOIN carrier_invoice_parcels cip ON cip.invoice_id = ci.id
      WHERE ci.carrier = 'colissimo'
      GROUP BY ci.id
      ORDER BY ci.created_at DESC
      LIMIT 50
    `);
    res.json({ success: true, invoices: result.rows });
  } catch (err) {
    console.error('[Colissimo] getHistory error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/colissimo/history/:id — détail d'une facture enregistrée (recharge l'analyse depuis la BDD)
exports.getInvoiceDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const inv = await pool.query('SELECT * FROM carrier_invoices WHERE id=$1 AND carrier=$2', [id, 'colissimo']);
    if (!inv.rows.length) return res.status(404).json({ success: false, error: 'Facture non trouvée' });

    const parcels = await pool.query('SELECT * FROM carrier_invoice_parcels WHERE invoice_id=$1 ORDER BY id', [id]);
    const suppl = await pool.query('SELECT * FROM carrier_invoice_supplements WHERE invoice_id=$1 ORDER BY id', [id]);

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

// GET /api/colissimo/search-order?q=... — retrouve la/les facture(s) contenant une commande ou un suivi
exports.searchOrder = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ success: true, results: [] });

    const result = await pool.query(`
      SELECT ci.id, ci.invoice_number, ci.invoice_date, cip.order_id, cip.tracking
      FROM carrier_invoice_parcels cip
      JOIN carrier_invoices ci ON ci.id = cip.invoice_id
      WHERE ci.carrier = 'colissimo'
        AND (cip.order_id::text = $1 OR cip.tracking ILIKE $2)
      ORDER BY ci.created_at DESC
      LIMIT 10
    `, [q, `%${q}%`]);

    res.json({ success: true, results: result.rows });
  } catch (err) {
    console.error('[Colissimo] searchOrder error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/colissimo/totals — totaux payés par mois / par année
exports.getTotals = async (req, res) => {
  try {
    const invoices = await pool.query(`
      SELECT id, invoice_number, period_start, total_ht, total_parcels, country_totals
      FROM carrier_invoices
      WHERE carrier = 'colissimo'
      ORDER BY period_start
    `);
    res.json({ success: true, invoices: invoices.rows });
  } catch (err) {
    console.error('[Colissimo] getTotals error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/* ─── Analyse + persistance réutilisables (save unitaire + import ZIP) ── */
async function analyzeColissimoBuffer(buffer) {
  const pdfParser = new PDFParse(new Uint8Array(buffer));
  await pdfParser.load();
  const pdfData = await pdfParser.getText();
  const parsed = parseColissimoPdf(pdfData.text);
  await enrichParcels(parsed.parcels);
  const { parcels, supplements, indemnizations, globalSummary, invoiceNumber, periodStart, periodEnd, accountNumber } = parsed;
  if (globalSummary.decarbonationUnit != null) for (const p of parcels) p.decarbonation_unit = globalSummary.decarbonationUnit;
  const stats = {
    total_parcels: parcels.length,
    parcels_matched: parcels.filter(p => p.order_id).length,
    parcels_unmatched: parcels.filter(p => !p.order_id).length,
    weight_ok: parcels.filter(p => p.diff_g !== null && Math.abs(p.diff_g) <= 20).length,
    weight_ecart: parcels.filter(p => p.diff_g !== null && Math.abs(p.diff_g) > 200).length,
    supplements_count: supplements.length,
    supplements_total: supplements.reduce((s, x) => s + (x.amount || 0), 0),
    indemnizations_total: indemnizations.reduce((s, i) => s + (i.amount || 0), 0),
  };
  return { invoiceNumber, periodStart, periodEnd, accountNumber, parcels, supplements, indemnizations, globalSummary, stats };
}

async function persistColissimoInvoice(parsed, pdfBuffer) {
  const { invoiceNumber, periodStart, periodEnd, accountNumber, parcels, supplements, indemnizations, globalSummary, stats } = parsed;
  const existing = await pool.query(
    'SELECT id, total_parcels FROM carrier_invoices WHERE carrier = $1 AND invoice_number = $2',
    ['colissimo', invoiceNumber]
  );
  if (existing.rows.length) {
    const prev = existing.rows[0];
    // Une facture déjà enregistrée SANS aucun colis vient forcément d'un PDF
    // « format cible » (agrégé, sans n° de suivi) : le CSV la remplace.
    // Sinon on ne touche à rien pour ne pas écraser un détail valide.
    const incomingHasParcels = (parcels || []).length > 0;
    if (Number(prev.total_parcels) > 0 || !incomingHasParcels) {
      if (pdfBuffer) await pool.query('UPDATE carrier_invoices SET pdf_data = $1 WHERE id = $2', [pdfBuffer, prev.id]);
      return { status: 'already', id: prev.id };
    }
    await pool.query('DELETE FROM carrier_invoice_parcels WHERE invoice_id = $1', [prev.id]);
    await pool.query('DELETE FROM carrier_invoice_supplements WHERE invoice_id = $1', [prev.id]);
    await pool.query('DELETE FROM carrier_invoices WHERE id = $1', [prev.id]);
  }
  const gs = globalSummary || {};
  const supplementsTotal = (supplements || []).reduce((s, x) => s + (x.amount || 0), 0);
  const indemnizationsTotal = (indemnizations || []).reduce((s, i) => s + (i.amount || 0), 0);
  const totalHt = (parcels || []).reduce((s, p) => s + (p.total_ht || 0), 0) + supplementsTotal;
  const invRes = await pool.query(`
    INSERT INTO carrier_invoices
      (carrier, invoice_number, period_start, period_end, account_number,
       total_parcels, parcels_matched, total_ht, port_brut, remise, port_net, cae,
       supplements_total, indemnizations_total, indemnizations, parcels_detail, country_totals, pdf_data)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id
  `, [
    'colissimo', invoiceNumber, periodStart || null, periodEnd || null, accountNumber || null,
    stats?.total_parcels ?? (parcels || []).length,
    stats?.parcels_matched ?? (parcels || []).filter(p => p.order_id).length,
    totalHt, gs.portBrut ?? null, gs.remise ?? null, gs.portNet ?? null, gs.cae ?? null,
    supplementsTotal, indemnizationsTotal,
    JSON.stringify(indemnizations || []), JSON.stringify(parcels || []),
    JSON.stringify(buildCountryTotals(parcels, 'total_ht')), pdfBuffer || null,
  ]);
  const invoiceId = invRes.rows[0].id;
  if (parcels?.length) {
    const vals = parcels.map((_, i) => { const b = i * 8; return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8})`; }).join(',');
    const params = parcels.flatMap(p => [invoiceId, p.tracking || null, p.order_id || null, p.date || null, p.weight_colissimo ?? null, p.weight_bdd ?? null, p.diff_g ?? null, p.total_ht ?? null]);
    await pool.query(`INSERT INTO carrier_invoice_parcels (invoice_id,tracking,order_id,date,weight_carrier,weight_bdd,diff_g,amount_ht) VALUES ${vals}`, params);
  }
  if (supplements?.length) {
    const orderMap = {};
    for (const p of (parcels || [])) if (p.order_id) orderMap[p.tracking] = p.order_id;
    const vals = supplements.map((_, i) => { const b = i * 5; return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5})`; }).join(',');
    const params = supplements.flatMap(s => [invoiceId, s.tracking || null, orderMap[s.tracking] || null, s.label || null, s.amount ?? null]);
    await pool.query(`INSERT INTO carrier_invoice_supplements (invoice_id,tracking,order_id,description,amount_ht) VALUES ${vals}`, params);
  }
  return { status: 'inserted', id: invoiceId };
}

// POST /api/colissimo/import-zip — import en lot des factures PDF d'un ZIP
exports.importZip = [
  uploadZip.single('zip'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, error: 'Fichier ZIP requis' });
      const zip = await JSZip.loadAsync(req.file.buffer);
      const pdfEntries = Object.values(zip.files).filter(f => !f.dir && /\.pdf$/i.test(f.name) && !/__MACOSX/.test(f.name));

      // Nouveau format : le ZIP Colissimo Box ne contient pas de PDF mais les CSV
      // unitaires (éventuellement dans un ZIP imbriqué) — une seule facture.
      if (!pdfEntries.length) {
        const parsed = await analyzeColissimoCsvBuffer(req.file.buffer);
        if (!parsed.invoiceNumber) {
          return res.status(400).json({ success: false, error: 'N° de facture introuvable dans le CSV' });
        }
        const r = await persistColissimoInvoice(parsed, null);
        return res.json({
          success: true, total: 1,
          imported: r.status === 'inserted' ? 1 : 0,
          already: r.status === 'already' ? 1 : 0,
          failed: [],
        });
      }
      let imported = 0, already = 0; const failed = [];
      for (const entry of pdfEntries) {
        const name = entry.name.split('/').pop();
        try {
          const buf = await entry.async('nodebuffer');
          const parsed = await analyzeColissimoBuffer(buf);
          if (!parsed.invoiceNumber) { failed.push({ name, error: 'Facture Colissimo non reconnue' }); continue; }
          const r = await persistColissimoInvoice(parsed, buf);
          if (r.status === 'inserted') imported++; else already++;
        } catch (e) { failed.push({ name, error: e.message }); }
      }
      res.json({ success: true, total: pdfEntries.length, imported, already, failed });
    } catch (err) {
      console.error('[Colissimo] importZip error:', err);
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
