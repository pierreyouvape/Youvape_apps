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

function parseLettreSuiviePdf(text) {
  const lines = text.split('\n').map(l => l.trim());
  const nonEmpty = lines.filter(l => l.length > 0);
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
  const nbLettres = recon.reduce((s, r) => s + (r.qty || 0), 0);
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
