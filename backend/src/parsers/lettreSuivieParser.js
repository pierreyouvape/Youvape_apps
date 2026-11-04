/*
 * Parser des factures La Poste « Lettre Suivie » (et services associés).
 *
 * Particularité : pdf-parse extrait les tableaux colonne par colonne, dans un
 * ordre qui ne correspond pas aux lignes visibles. On ne peut donc PAS aligner
 * Quantité / Prix unitaire / Montant par index. On reconstruit chaque ligne par
 * l'arithmétique « montant = quantité × prix unitaire » (les prix unitaires
 * forment un petit ensemble, ce qui rend la quantité déductible sans ambiguïté).
 *
 * 3 formats gérés (détection automatique) :
 *   A — Contrat Port Payé (D-648009-1)         : groupé par « Commande n°SAFxxx »
 *   B — Contrat API AFF Entreprise (D-1153498-1): groupé par « Date de prestation »
 *   C — Service (Collecte annuelle, Frais de dossier renouvellement) : 1 ligne
 *
 *   D — Facture électronique (depuis octobre 2026) : « Facture N° PFxxx du … »,
 *       chaque ligne du tableau sort entière sur une ligne de texte → lecture directe
 *       (voir parseTargetFormat).
 *
 * Distinction des montants dans le texte extrait :
 *   "13,48€"   (€ collé)          → montant d'une LIGNE
 *   "136,59 €" (espace avant €)   → total d'un bloc (commande / contrat)
 *   "767,30"   (nombre nu)        → grand total
 */

function parseFrNum(s) {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/\s/g, '').replace('€', '').replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
}

// Tranche de poids La Poste à partir d'un poids en grammes (borne supérieure).
function bracketForGrams(g) {
  if (g <= 20)   return { order: 1, label: '0–20 g' };
  if (g <= 50)   return { order: 2, label: '20–50 g' };
  if (g <= 100)  return { order: 3, label: '50–100 g' };
  if (g <= 250)  return { order: 4, label: '100–250 g' };
  if (g <= 500)  return { order: 5, label: '250–500 g' };
  if (g <= 1000) return { order: 6, label: '500 g–1 kg' };
  if (g <= 2000) return { order: 7, label: '1–2 kg' };
  return { order: 8, label: '2–3 kg' };
}

function round2(n) { return Math.round(n * 100) / 100; }

const TARGET_INVOICE_RE = /^Facture N[°º]\s*(\S+)\s+du\s+(\d{2}\/\d{2}\/\d{4})/i;
// « Lettre verte suivie 0 A 20 G 20.0G 12 XUN 1.8000 21,60 E 0,00 % »
//   libellé · quantité · unité · prix unitaire · montant HT · code TVA · taux TVA
const TARGET_ROW_RE = /^(?:\d+\s+\d{4,6}\s+)?(.+?)\s+(\d+(?:[.,]\d+)?)\s+([A-Z0-9]{2,3})\s+(\d+(?:[.,]\d+)?)\s+(-?\d[\d\s]*,\d{2})\s+([A-Z]{1,2})\s+([\d,]+)\s*%$/;

// Format D : facture électronique La Poste (réforme facturation, octobre 2026).
function parseTargetFormat(nonEmpty) {
  let invoiceNumber = null, invoiceDate = null, periodStart = null, periodEnd = null;
  let contractNumber = null, contractType = null, clientNumber = null;
  let totalHT = null, totalTVA = null, totalTTC = null, tvaRate = 0;
  const prestationDates = [];
  const recon = [];
  let serviceLabel = null;
  let isLettre = false;

  for (const l of nonEmpty) {
    let m;
    if (!invoiceNumber && (m = l.match(TARGET_INVOICE_RE))) { invoiceNumber = m[1]; invoiceDate = m[2]; continue; }
    if (!periodStart && (m = l.match(/D[ée]tail de vos consommations du\s+(\d{2}\/\d{2}\/\d{4})\s+au\s+(\d{2}\/\d{2}\/\d{4})/i))) {
      periodStart = m[1]; periodEnd = m[2]; continue;
    }
    if (!contractType && (m = l.match(/^Contrat\s+(.+?)\s+n[°º]\s*(D-[\d-]+)/i))) { contractType = m[1].trim(); contractNumber = m[2]; continue; }
    if (!contractNumber && (m = l.match(/^Contrat\s*:\s*(D-[\d-]+)/i))) { contractNumber = m[1]; continue; }
    if (!clientNumber && (m = l.match(/^N[°º]\s*client\s*:\s*([\d-]+)/i))) { clientNumber = m[1]; continue; }
    if (totalHT == null && (m = l.match(/^Montant total net HT\s+(-?[\d\s]+,\d{2})$/i))) { totalHT = parseFrNum(m[1]); continue; }
    if (totalTVA == null && (m = l.match(/^Montant total TVA de la facture\s+(-?[\d\s]+,\d{2})$/i))) { totalTVA = parseFrNum(m[1]); continue; }
    if (totalTTC == null && (m = l.match(/^Montant total TTC\s+(-?[\d\s]+,\d{2})$/i))) { totalTTC = parseFrNum(m[1]); continue; }
    if ((m = l.match(/^Date de prestation\s*:\s*(\d{4})-(\d{2})-(\d{2})/i))) { prestationDates.push(`${m[3]}/${m[2]}/${m[1]}`); continue; }

    if ((m = l.match(TARGET_ROW_RE))) {
      const label = m[1].replace(/\s+/g, ' ').trim();
      const qty = parseFrNum(m[2]);
      const pu = round2(parseFloat(m[4].replace(',', '.')));
      const montant = round2(parseFrNum(m[5]));
      const rate = parseFrNum(m[7]);
      if (rate > tvaRate) tvaRate = rate;
      const g = label.match(/Lettre verte suivie\s+\d+\s*A\s*(\d+)\s*G/i);
      let tier;
      if (g) { isLettre = true; tier = bracketForGrams(parseInt(g[1], 10)).label; }
      else { tier = label; if (!serviceLabel) serviceLabel = label; }
      if (montant === 0) continue;
      recon.push({ tier, pu, qty, montant, date: prestationDates[prestationDates.length - 1] || null, lettre: !!g });
    }
  }

  const tierMap = {};
  for (const r of recon) {
    if (!tierMap[r.tier]) tierMap[r.tier] = { tier: r.tier, pu: r.pu, qty: 0, montant: 0, count: 0 };
    const t = tierMap[r.tier];
    t.qty += r.qty || 0; t.montant = round2(t.montant + r.montant); t.count += 1; t.pu = r.pu;
  }
  const tierSummary = Object.values(tierMap).sort((a, b) => (a.pu || 0) - (b.pu || 0));
  const linesTotal = round2(recon.reduce((s, r) => s + r.montant, 0));
  const nbLettres = recon.filter(r => r.lettre).reduce((s, r) => s + (r.qty || 0), 0);
  const uniqDates = [...new Set(prestationDates)];

  return {
    invoiceNumber, invoiceDate,
    periodDate: periodEnd, periodRange: periodStart ? `${periodStart} → ${periodEnd}` : null,
    periodStart, periodEnd,
    contractNumber, contractType, clientNumber,
    tvaRate, exonerated: tvaRate === 0, totalHT, totalTVA, totalTTC,
    format: isLettre ? 'B' : 'service',
    lines: recon,
    tierSummary,
    commands: [],
    prestationDates: uniqDates,
    stats: {
      nb_lines: recon.length,
      nb_lettres: nbLettres,
      nb_commands: 0,
      nb_prestation_dates: uniqDates.length,
      lines_total: linesTotal,
      reconcile_ok: totalHT != null && Math.abs(linesTotal - totalHT) < 0.05,
    },
  };
}

function parseLettreSuiviePdf(text) {
  const lines = text.split('\n').map(l => l.trim());
  const nonEmpty = lines.filter(l => l.length > 0);
  if (nonEmpty.some(l => TARGET_INVOICE_RE.test(l)) && !nonEmpty.some(l => /Votre facture n[°º]/i.test(l))) {
    return parseTargetFormat(nonEmpty);
  }
  const fullText = nonEmpty.join('\n');

  /* ─── Métadonnées ──────────────────────────────────────────── */
  let invoiceNumber = null, invoiceDate = null, periodDate = null;
  let contractNumber = null, contractType = null, clientNumber = null;
  let tvaRate = 0, totalTTC = null, periodRange = null;
  let periodStart = null, periodEnd = null;

  for (const l of nonEmpty) {
    let m;
    if (!invoiceNumber && (m = l.match(/Votre facture n[°º]\s*(\S+)\s+du\s+(\d{2}\/\d{2}\/\d{4})/i))) {
      invoiceNumber = m[1]; invoiceDate = m[2];
    }
    if (!periodDate && (m = l.match(/(?:Synth[èe]se|D[ée]tail) de vos consommations au\s+(\d{2}\/\d{2}\/\d{4})/i))) {
      periodDate = m[1];
    }
    if (!periodRange && (m = l.match(/Consommations du\s+(\d{2}\/\d{2}\/\d{4})\s+au\s+(\d{2}\/\d{2}\/\d{4})/i))) {
      periodRange = `${m[1]} → ${m[2]}`;
      periodStart = m[1]; periodEnd = m[2];
    }
    if (!contractNumber && (m = l.match(/Contrat\s+(.*?)\s+N[°º]\s*(D-[\d-]+)/i))) {
      contractType = m[1].trim(); contractNumber = m[2];
    }
    if (!clientNumber && (m = l.match(/N[°º]\s*(?:CLIENT\s*\(COCLICO\)|Client)\s*:?\s*([\d-]+)/i))) {
      clientNumber = m[1];
    }
    if (totalTTC == null && (m = l.match(/La somme de\s+([\d\s]+,\d{2})\s*€\s+sera pr[ée]lev[ée]e/i))) {
      totalTTC = parseFrNum(m[1]);
    }
    if ((m = l.match(/CA soumis [àa]\s+([\d,]+)\s*%/i))) {
      const r = parseFrNum(m[1]);
      if (r != null && r > tvaRate) tvaRate = r;
    }
  }

  const exonerated = tvaRate === 0;
  let totalHT, totalTVA;
  if (totalTTC == null) { totalTTC = null; totalHT = null; totalTVA = null; }
  else if (exonerated) { totalHT = totalTTC; totalTVA = 0; }
  else { totalHT = round2(totalTTC / (1 + tvaRate / 100)); totalTVA = round2(totalTTC - totalHT); }

  /* ─── Colonnes (machine à états sur les en-têtes répétés) ───── */
  const quantities = [];
  const unitPrices = [];
  const lineMontants = [];  // € collé   → lignes
  const blockTotals = [];   // espace €  → totaux de bloc
  let mode = null;

  for (const l of nonEmpty) {
    if (/^Quantit[ée]$/i.test(l))        { mode = 'qty'; continue; }
    if (/^Prix unitaire$/i.test(l))      { mode = 'pu';  continue; }
    if (/^%?\s*TVA$/i.test(l))           { mode = 'tva'; continue; }
    if (/^(?:TVA\s+)?Montant HT$/i.test(l)) { mode = 'montant'; continue; }

    if (mode === 'qty' && /^\d+,\d{2}$/.test(l)) { quantities.push(parseFrNum(l)); continue; }

    if (mode === 'pu') {
      // Le PU peut être collé au taux : "100,00 20,00%"
      const pm = l.match(/^([\d\s]+,\d{2})(?:\s+[\d,]+\s*%)?$/);
      if (pm) { unitPrices.push(parseFrNum(pm[1])); continue; }
    }

    if (mode === 'montant' || mode === 'tva') {
      if (/^[\d\s]+,\d{2}€$/.test(l))      { lineMontants.push(parseFrNum(l)); continue; } // ligne
      if (/^[\d\s]+,\d{2}\s+€$/.test(l))   { blockTotals.push(parseFrNum(l));  continue; } // total bloc
      // nombre nu (grand total) ou "0,0" (TVA) → ignoré
    }
  }

  /* ─── Libellés (tranches de poids) ─────────────────────────── */
  const grams = [];
  let serviceLabel = null;
  for (const l of nonEmpty) {
    let m;
    if ((m = l.match(/LETTRE VERTE SUIVIE\s+(\d+)\s*G/i))) { grams.push(parseInt(m[1], 10)); continue; }
    if ((m = l.match(/Lettre verte suivie\s+\d+\s*A\s*(\d+)\s*G/i))) { grams.push(parseInt(m[1], 10)); continue; }
    if (!serviceLabel && /FRAIS DE DOSSIER|COLLECTE/i.test(l)) serviceLabel = l.replace(/\s+/g, ' ').trim();
  }
  const isLettre = grams.length > 0;

  // Tranches distinctes présentes (triées), prix unitaires distincts (triés)
  const bracketByOrder = {};
  for (const g of grams) { const b = bracketForGrams(g); bracketByOrder[b.order] = b.label; }
  const brackets = Object.keys(bracketByOrder).map(Number).sort((a, b) => a - b).map(o => bracketByOrder[o]);
  const puSet = [...new Set(unitPrices.map(round2))].sort((a, b) => a - b);

  // Mapping prix unitaire → tranche : i-ème PU le plus bas = i-ème tranche la plus légère.
  const puToTier = {};
  if (isLettre && puSet.length === brackets.length) {
    puSet.forEach((pu, i) => { puToTier[pu] = brackets[i]; });
  } else {
    puSet.forEach((pu, i) => { puToTier[pu] = brackets[i] || `Tarif ${pu.toFixed(2)} €`; });
  }

  /* ─── Reconstruction des lignes (montant = qté × PU) ───────── */
  const recon = [];
  for (const M of lineMontants) {
    if (M === 0) continue; // ligne à 0 lettre (bruit) — ignorée
    let best = null;
    for (const pu of puSet) {
      if (pu <= 0) continue;
      const q = M / pu;
      const rq = Math.round(q);
      if (rq < 1) continue;
      const err = Math.abs(q - rq);
      if (err <= 0.02 && (!best || err < best.err)) best = { pu, qty: rq, err };
    }
    const tier = isLettre
      ? (best ? puToTier[best.pu] : '—')
      : (serviceLabel || 'Service');
    recon.push({
      tier,
      pu: best ? best.pu : null,
      qty: best ? best.qty : null,
      montant: round2(M),
    });
  }

  /* ─── Résumé par tranche ───────────────────────────────────── */
  const tierMap = {};
  for (const r of recon) {
    const key = r.tier;
    if (!tierMap[key]) tierMap[key] = { tier: key, pu: r.pu, qty: 0, montant: 0, count: 0 };
    tierMap[key].qty += r.qty || 0;
    tierMap[key].montant = round2(tierMap[key].montant + r.montant);
    tierMap[key].count += 1;
    if (r.pu != null) tierMap[key].pu = r.pu;
  }
  const tierSummary = Object.values(tierMap).sort((a, b) => (a.pu || 0) - (b.pu || 0));

  /* ─── Commandes (format A) & dates de prestation (format B) ── */
  const commands = [];
  const seenSaf = new Set();
  let cm;
  const CMD_RE = /Commande n[°º]\s*(SAF\d+)\s+du\s+(\d{2}\/\d{2}\/\d{4})(?:\s+au\s+(\d{2}\/\d{2}\/\d{4}))?/gi;
  while ((cm = CMD_RE.exec(fullText)) !== null) {
    if (seenSaf.has(cm[1])) continue;
    seenSaf.add(cm[1]);
    commands.push({ saf: cm[1], date: cm[2], dateEnd: cm[3] || null });
  }

  const prestationDates = [...new Set(
    (fullText.match(/Date de prestation\s+(\d{2}\/\d{2}\/\d{4})/gi) || [])
      .map(s => s.replace(/Date de prestation\s+/i, ''))
  )];

  let format = 'service';
  if (commands.length) format = 'A';
  else if (prestationDates.length) format = 'B';

  /* ─── Réconciliation ───────────────────────────────────────── */
  const linesTotal = round2(recon.reduce((s, r) => s + r.montant, 0));
  // Une facture de prestation (abonnement collecte, frais de dossier) n'a pas de tranche
  // de poids : ses lignes ne sont pas des lettres et ne doivent pas gonfler le compteur.
  const nbLettres = isLettre ? recon.reduce((s, r) => s + (r.qty || 0), 0) : 0;
  const reconcileOK = totalHT != null && Math.abs(linesTotal - totalHT) < 0.05;

  return {
    invoiceNumber, invoiceDate, periodDate, periodRange,
    periodStart: periodStart || periodDate, periodEnd,
    contractNumber, contractType, clientNumber,
    tvaRate, exonerated, totalHT, totalTVA, totalTTC,
    format,
    lines: recon,
    tierSummary,
    commands,
    prestationDates,
    stats: {
      nb_lines: recon.length,
      nb_lettres: nbLettres,
      nb_commands: commands.length,
      nb_prestation_dates: prestationDates.length,
      lines_total: linesTotal,
      reconcile_ok: reconcileOK,
    },
  };
}

module.exports = { parseLettreSuiviePdf, parseFrNum, bracketForGrams };
