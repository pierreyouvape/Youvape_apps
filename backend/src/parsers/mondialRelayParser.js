/*
 * Parser des factures Mondial Relay (LGYOUVAP…).
 *
 * Bonne nouvelle : chaque page contient une balise machine
 *   <ref>codeClient:…--numeroFacture:…--montantHT:…--montantTVA:…--montantTTC:…
 *        --tauxTVA:…--dateFacture:…</ref>
 * extraite telle quelle par pdf-parse → tous les totaux sont fiables.
 *
 * Les tableaux de détail sortent (presque) ligne par ligne, colonnes
 * réordonnées par tabulation :
 *   "<PU>\t<tranche de poids> <qté> <montant>\t<poids total>"
 *   ex : "3,29\tde 0,01 à 250g 230 756,70\t38,48"
 * Les sections frais (Remise, Indexation, Collecte, Surcharges, Participations…)
 * suivent un format proche : "<PU|->\t<libellé> <qté> <montant>".
 *
 * Chaque facture concerne UN pays de livraison (Pays de livraison) — on le
 * conserve pour différencier les tarifs.
 */

function parseFrNum(s) {
  if (s == null) return null;
  // "1.602,65" → 1602.65 ; "159,74" → 159.74 ; "-378,78" → -378.78
  const n = parseFloat(String(s).trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

const PAYS_LABELS = {
  FR: 'France', BE: 'Belgique', LU: 'Luxembourg', ES: 'Espagne',
  NL: 'Pays-Bas', DE: 'Allemagne', PT: 'Portugal', IT: 'Italie',
  AT: 'Autriche', PL: 'Pologne',
};

/* ─── Grille tarifaire 2026 — Hors Domicile (Point Relais / Locker), € HT ──
 * Index poids : 0:≤250g 1:251-500g 2:501g-1kg 3:1-2kg 4:2-3kg 5:3-4kg
 *               6:4-5kg 7:5-7kg 8:7-10kg 9:10-15kg 10:15-20kg 11:20-25kg 12:25-30kg
 * Luxembourg partage la colonne Belgique.                                    */
const GRID_2026_HD = {
  France:    [3.29,3.29,3.63,5.14,5.46,5.46,11.00,11.00,11.00,17.34,17.34,17.34,19.86],
  Belgique:  [3.59,3.59,4.69,6.49,6.99,6.99,12.80,12.80,12.80,19.64,19.64,19.64,20.87],
  Luxembourg:[3.59,3.59,4.69,6.49,6.99,6.99,12.80,12.80,12.80,19.64,19.64,19.64,20.87],
  'Pays-Bas':[3.59,3.59,4.69,6.49,6.99,6.99,12.80,12.80,12.80,19.64,19.64,19.64,20.87],
  Allemagne: [5.69,5.69,7.39,8.49,11.69,11.69,16.70,16.70,16.70,25.64,25.64,null,null],
  Espagne:   [5.19,5.19,6.79,8.29,9.79,9.79,14.20,14.20,14.20,21.74,21.74,21.74,24.86],
  Portugal:  [5.19,5.19,6.79,8.29,9.79,9.79,14.20,14.20,14.20,21.74,21.74,21.74,24.86],
  Pologne:   [5.69,5.69,7.39,8.49,9.99,9.99,14.50,14.50,14.50,22.24,22.24,22.24,null],
  Italie:    [5.19,5.19,6.79,8.29,9.79,9.79,14.20,14.20,14.20,21.74,21.74,21.74,null],
  Autriche:  [7.59,7.59,9.89,10.79,14.49,14.49,19.60,19.60,19.60,30.14,30.14,null,null],
};

// Borne supérieure de la tranche (en grammes) → index grille
function bracketToGridIndex(label) {
  const m = label.match(/à\s*([\d.]+)\s*(kg|g)/i);
  if (!m) return -1;
  let up = parseFloat(m[1].replace('.', '')); // "2" or "250" ; "1.001"→ handled below
  // label form "de X à Ykg" or "de X à Yg"
  const upRaw = m[1];
  const unit = m[2].toLowerCase();
  const grams = unit === 'kg' ? parseFloat(upRaw.replace('.', '').replace(',', '.')) * 1000 : parseFloat(upRaw);
  const map = [
    [250, 0], [500, 1], [1000, 2], [2000, 3], [3000, 4], [4000, 5],
    [5000, 6], [7000, 7], [10000, 8], [15000, 9], [20000, 10], [25000, 11], [30000, 12],
  ];
  for (const [g, idx] of map) if (Math.round(grams) <= g) return idx;
  return -1;
}

function parseMondialRelayPdf(text) {
  const rawLines = text.split('\n');
  const lines = rawLines.map(l => l.replace(/\s+$/, '')); // keep tabs/leading
  const trimmed = lines.map(l => l.trim());
  const fullText = text;

  /* ─── Balise <ref> : totaux fiables ───────────────────────── */
  const refM = fullText.match(/codeClient:([^-]*)--libelleClient:([^-]*)--numeroFacture:([^-]+)--montantHT:([\d.,]+)--montantTVA:([\d.,]+)--montantTTC:([\d.,]+)--tauxTVA:([\d.,]+)--dateFacture:(\d{2}\/\d{2}\/\d{4})/);
  let invoiceNumber = null, totalHT = null, totalTVA = null, totalTTC = null, tvaRate = null, invoiceDate = null;
  if (refM) {
    invoiceNumber = refM[3].trim();
    totalHT  = parseFrNum(refM[4]);
    totalTVA = parseFrNum(refM[5]);
    totalTTC = parseFrNum(refM[6]);
    tvaRate  = parseFrNum(refM[7]);
    invoiceDate = refM[8];
  }

  /* ─── En-tête : période, pays ─────────────────────────────── */
  let periodStart = null, periodEnd = null;
  const perM = fullText.match(/du\s+(\d{2}\/\d{2}\/\d{4})\s+au\s+(\d{2}\/\d{2}\/\d{4})/);
  if (perM) { periodStart = perM[1]; periodEnd = perM[2]; }

  // N° TVA intra du client (FR8778…) puis la ligne suivante = Pays de livraison
  let paysRaw = null;
  for (let i = 0; i < trimmed.length; i++) {
    if (/^FR\d{9,}$/.test(trimmed[i])) {
      for (let j = i + 1; j < trimmed.length; j++) {
        if (trimmed[j]) { paysRaw = trimmed[j]; break; }
      }
      break;
    }
  }
  let pays = paysRaw;
  if (paysRaw && PAYS_LABELS[paysRaw]) pays = PAYS_LABELS[paysRaw];

  // Nombre de colis (Livraisons PUDO/APM/LCC) : 1er entier après "Quantité Prix (€)"
  let nbColis = null;
  for (let i = 0; i < trimmed.length; i++) {
    if (/^Quantit[ée]\s+Prix\s*\(€\)/i.test(trimmed[i])) {
      for (let j = i + 1; j < trimmed.length; j++) {
        const m = trimmed[j].match(/^(\d+)$/);
        if (m) { nbColis = parseInt(m[1], 10); break; }
        if (trimmed[j]) break;
      }
      break;
    }
  }

  /* ─── Sections détaillées (machine à états) ───────────────── */
  const deliveries = [];     // { type, bracket, gridIndex, poids, qty, pu, montant }
  const deliverySummary = []; // { type, qty, montant }
  const surcharges = [];     // { label, qty, pu, montant }
  const participations = []; // { label, qty, pu, montant }
  const collecte = [];       // { label, qty, pu, montant }
  const complements = [];    // { label, qty, pu, montant }
  const retourPCI = [];      // { label, qty, pu, montant }
  let remiseRate = null, remiseMontant = null;
  let indexation = null;     // { base, taux, montant }

  let section = null;        // 'delivery' | 'remise' | 'indexation' | 'collecte' | 'avisage' | 'options' | 'surcharges' | 'participations' | 'complements' | 'retourpci'
  let curType = null;

  // Ligne de livraison : "<PU>\t<tranche> <qty> <montant>\t<poids>"
  const DELIV_RE = /^([\d.,]+)\t(de .+?(?:kg|g))\s+(\d+)\s+([\d.,]+)\t([\d.,]+)$/;
  // Ligne générique avec PU : "<PU|->\t<libellé> <qty> <montant>"
  const PRICED_RE = /^(-|[\d.,]+)\t(.+?)\s+(\d+)\s+(-?[\d.,]+)$/;
  // Ligne sans PU (souvent qté 0) : "<libellé> <qty> <montant>"
  const ZERO_RE = /^(.+?)\s+(\d+)\s+(-?[\d.,]+)$/;

  for (let i = 0; i < lines.length; i++) {
    const t = trimmed[i];
    if (!t) continue;

    // En-têtes de section
    let m;
    if ((m = t.match(/^Livraison (.+?) LGYOUVAP$/))) { section = 'delivery'; curType = m[1].trim(); continue; }
    if (/^Remise LGYOUVAP$/.test(t)) { section = 'remise'; continue; }
    if (/^Indexation$/.test(t)) { section = 'indexation'; continue; }
    if (/^(Forfait )?collecte LGYOUVAP$/i.test(t)) { section = 'collecte'; continue; }
    if (/^Avisage LGYOUVAP$/.test(t)) { section = 'avisage'; continue; }
    if (/^Options et services$/.test(t)) { section = 'options'; continue; }
    if (/^Surcharges( LGYOUVAP)?$/.test(t)) { section = 'surcharges'; continue; }
    if (/^Participations( LGYOUVAP)?$/.test(t)) { section = 'participations'; continue; }
    if (/^Compl[ée]ments LGYOUVAP$/.test(t)) { section = 'complements'; continue; }
    if (/Quantit[ée] Prix unitaire/i.test(t)) continue; // en-tête colonnes
    if (/^Poids total/i.test(t)) continue;
    if (/MONTANT TOTAL FACTURE|SAS au capital/i.test(t)) { section = null; continue; } // pied de page

    // "Retour identifie / PCI" est une section de livraison sans tranche de poids
    const isPCI = curType && /PCI/i.test(curType) && section === 'delivery';

    if (section === 'delivery' && !isPCI) {
      const dm = lines[i].match(DELIV_RE);
      if (dm) {
        const bracket = dm[2].trim();
        deliveries.push({
          type: curType, bracket,
          gridIndex: bracketToGridIndex(bracket),
          pu: parseFrNum(dm[1]), qty: parseInt(dm[3], 10),
          montant: parseFrNum(dm[4]), poids: parseFrNum(dm[5]),
        });
        continue;
      }
      // TOTAL section : "<qty> <montant>\tTOTAL <poids>"
      const tm = lines[i].match(/^(\d+)\s+([\d.,]+)\tTOTAL\s+([\d.,]+)$/);
      if (tm) { deliverySummary.push({ type: curType, qty: parseInt(tm[1], 10), montant: parseFrNum(tm[2]) }); continue; }
    }

    if (section === 'remise') {
      const rm = t.match(/Remise\s+([\d.,]+)\s*%\s+\d+\s+(-?[\d.,]+)/);
      if (rm) { remiseRate = parseFrNum(rm[1]); remiseMontant = parseFrNum(rm[2]); continue; }
    }

    if (section === 'indexation') {
      // "<taux>\tDécembre 2019 <base> <montant>"  (la ligne d'indexation gasoil)
      const im = lines[i].match(/^([\d.,]+)\t.*?D[ée]cembre\s+\d{4}\s+([\d.,]+)\s+([\d.,]+)$/);
      if (im) {
        indexation = { taux: parseFrNum(im[1]), base: parseFrNum(im[2]), montant: parseFrNum(im[3]) };
        section = null; // évite de capter le pied de page
        continue;
      }
    }

    // Lignes "prix" génériques (collecte, surcharges, participations, compléments, PCI)
    if (['collecte', 'surcharges', 'participations', 'complements'].includes(section) || isPCI) {
      const pm = lines[i].match(PRICED_RE);
      if (pm && pm[1] !== '-') {
        const row = { label: pm[2].trim(), qty: parseInt(pm[3], 10), pu: parseFrNum(pm[1]), montant: parseFrNum(pm[4]) };
        if (section === 'surcharges') { if (row.qty > 0) surcharges.push(row); }
        else if (section === 'participations') participations.push(row);
        else if (section === 'collecte') collecte.push(row);
        else if (section === 'complements') complements.push(row);
        else if (isPCI) retourPCI.push(row);
        continue;
      }
      // surcharges à 0 : "<libellé> 0 0,00" → ignorées
    }
  }

  /* ─── Contrôle tarifaire vs grille 2026 (Hors Domicile) ───── */
  const grid = GRID_2026_HD[pays] || null;
  let puChecked = 0, puConform = 0;
  for (const d of deliveries) {
    d.grid_pu = (grid && d.gridIndex >= 0) ? grid[d.gridIndex] : null;
    if (d.grid_pu != null && d.pu != null) {
      puChecked++;
      d.pu_ok = Math.abs(d.pu - d.grid_pu) < 0.005;
      if (d.pu_ok) puConform++;
    } else {
      d.pu_ok = null;
    }
  }

  /* ─── Réconciliation : somme des postes = HT ──────────────── */
  const sum = arr => arr.reduce((s, x) => s + (x.montant || 0), 0);
  const deliveriesTotal = sum(deliveries);
  const linesTotal = round2(
    deliveriesTotal
    + (remiseMontant || 0)
    + (indexation ? indexation.montant : 0)
    + sum(collecte) + sum(retourPCI) + sum(complements) + sum(surcharges) + sum(participations)
  );
  const reconcileOK = totalHT != null && Math.abs(linesTotal - totalHT) < 0.05;

  const nbColisFinal = nbColis != null ? nbColis : deliverySummary.reduce((s, d) => s + d.qty, 0);

  return {
    invoiceNumber, invoiceDate, periodStart, periodEnd, pays, paysRaw,
    totalHT, totalTVA, totalTTC, tvaRate,
    nbColis: nbColisFinal,
    remiseRate, remiseMontant,
    indexation,
    deliveries, deliverySummary,
    surcharges, participations, collecte, complements, retourPCI,
    stats: {
      nb_colis: nbColisFinal,
      nb_delivery_lines: deliveries.length,
      deliveries_total: round2(deliveriesTotal),
      lines_total: linesTotal,
      reconcile_ok: reconcileOK,
      pu_checked: puChecked,
      pu_conform: puConform,
      pu_grid_ok: puChecked > 0 && puConform === puChecked,
    },
  };
}

module.exports = { parseMondialRelayPdf, parseFrNum, bracketToGridIndex, GRID_2026_HD };
