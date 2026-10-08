/*
 * Détail au colis des factures Mondial Relay — l'annexe CSV de Primobox.
 *
 * Chaque facture PDF (une par pays de livraison) a son annexe
 * « Annexe_<n° facture>_LGYOUVAP_<date>.csv » : latin-1, séparateur « ; »,
 * décimales à point, une ligne par colis. Vérifié sur 12 factures (oct. 2025 →
 * sept. 2026) : la somme de la colonne « Total htva » retombe AU CENTIME sur le
 * total HT du PDF, et le nombre de lignes facturées sur son nombre de colis.
 *
 * Ce que contient une ligne de colis :
 *   - « Référence expédition » = le n° de commande WooCommerce ;
 *   - « Nr expédition » = le n° de suivi (orders.tracking_number) ;
 *   - « Total htva » = transport + indexation gasoil + complément (participations
 *     sûreté/éco 0,13 €, ré-étiquetage, colis trop petit, Corse…), AVANT remise ;
 *   - les poids : annoncé (notre étiquette), mesuré (pesée MR), volumétrique
 *     (L × l × H / 5000) et facturé (« Poids en gr », le plus élevé retenu).
 *
 * Lignes sans référence (niveau facture) : la REMISE, négative (14 % du
 * transport), le forfait collecte, des arrondis. La remise n'est donc pas
 * ventilée par MR : on l'impute à chaque colis au prorata de son transport —
 * c'est exactement sa base de calcul (Σ transport × 14 % = remise, au centime).
 *
 * Retours (2025) : Type « Retour », référence « LG479896 », et « Expedition
 * liée » = n° de suivi du colis aller, qui donne la commande.
 *
 * Lignes à 0 € sans mode de livraison : colis déposés en fin de mois précédent,
 * facturés sur la facture d'avant. Ignorées, sinon leur coût serait écrasé.
 */

const { GRID_2026_HD } = require('./mondialRelayParser');

const PAYS_LABELS = {
  FR: 'France', BE: 'Belgique', LU: 'Luxembourg', ES: 'Espagne', NL: 'Pays-Bas',
  DE: 'Allemagne', PT: 'Portugal', IT: 'Italie', AT: 'Autriche', PL: 'Pologne',
};

// Bornes hautes des tranches de poids MR, en grammes — même index que GRID_2026_HD.
const BRACKETS_G = [250, 500, 1000, 2000, 3000, 4000, 5000, 7000, 10000, 15000, 20000, 25000, 30000];

// Une pesée n'est « aberrante » — donc réclamable — que si elle est physiquement
// impossible pour les dimensions mesurées par MR : plus de 1 g/cm³. Sur les 653
// colis mesurés de la facture LGYOUVAP2600000087, le plus dense après la 1260857
// (2,65 g/cm³ : 4,4 kg dans 16,5 × 15,5 × 6,5 cm) pèse 0,64 g/cm³.
//
// Un simple rapport « pesé ÷ déclaré » ne suffit PAS : il signale aussi les
// commandes dont un produit est mal pesé en base (Concentré 30 ml à 40 g parti
// dans un carton de 46 × 33 × 16 cm : 950 g pesés, cohérents avec le carton).
// Et la plupart des écarts (+100 à +300 g) sont l'emballage, la tare étant
// réglée à 11 g : là, Mondial Relay a raison, rien à réclamer.
// Sans dimensions (annexes 2025), aucune pesée n'est déclarée aberrante.
const ABERRANT_DENSITY = 1.0; // g/cm³
const ABERRANT_MIN_G = 500;

// Pesée sans rapport avec le CONTENU (motif « incoherent ») : au moins 3 fois
// notre poids et 500 g de plus. Pas besoin de dimensions : MR vérifie sur la
// photo de la pesée (avoir AVC26_006067 du 07/10/2026 : « un autre colis a été
// pesé en partie avec votre colis »). Preuve plus faible que la densité — la
// 1237799, 2 puffs pesées 2,92 kg, a été refusée — d'où un motif à part, jamais
// coché d'office. Le contrôleur le rétrograde en « pesee » si un produit de la
// commande n'a pas de poids en base (notre poids serait alors sous-estimé).
const INCOHERENT_RATIO = 3;

function bracketIndex(grams) {
  if (!(grams > 0)) return 0;
  const i = BRACKETS_G.findIndex(b => grams <= b);
  return i === -1 ? BRACKETS_G.length - 1 : i;
}

function num(s) {
  if (s == null) return 0;
  const t = String(s).trim();
  if (!t) return 0;
  const n = parseFloat(t.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function round4(n) { return Math.round((n + Number.EPSILON) * 10000) / 10000; }

function frDate(yyyymmdd) {
  const m = String(yyyymmdd || '').trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

// 24R (Point Relais) et 24RC (Locker) sont au même tarif : une seule famille.
function modeGroup(mode) {
  return /^24R/.test(mode) ? 'HD' : (mode || '?');
}

/**
 * Lit l'annexe CSV. Accepte un Buffer (latin-1) ou une chaîne déjà décodée.
 * @returns {{ invoiceNumber: string|null, parcels: object[], invoiceRows: object[] }}
 */
function parseMondialRelayCsv(input) {
  const text = Buffer.isBuffer(input) ? input.toString('latin1') : String(input);
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { invoiceNumber: null, parcels: [], invoiceRows: [] };

  const headers = lines[0].split(';').map(h => h.trim());
  // Dimensions et poids volumétrique n'existent que depuis 2026 : facultatifs.
  const OPTIONAL = ['Longueur', 'Largeur', 'Hauteur', 'Volumetric weight'];
  const col = name => {
    const i = headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
    if (i === -1 && !OPTIONAL.includes(name)) throw new Error(`Colonne « ${name} » absente : ce n'est pas une annexe CSV Mondial Relay`);
    return i;
  };
  const C = {
    invoice: col('Nr de facture'), ref: col('Référence expédition'), tracking: col('Nr expédition'),
    date: col('Date'), pickup: col('Mode de prise en charge'),
    mode: col('Mode de livraison'), type: col('Type'), pays: col('Pays de livraison'),
    billed: col('Poids en gr'), index: col('Indexation gasoil'), transport: col('Montant du transport'),
    declared: col('Poids annoncé'), measured: col('Poids mesuré'), complement: col('Complément'),
    total: col('Total htva'), linked: col('Expedition liée'),
    length: col('Longueur'), width: col('Largeur'), height: col('Hauteur'), volumetric: col('Volumetric weight'),
  };

  let invoiceNumber = null;
  const parcels = [], invoiceRows = [];
  for (const line of lines.slice(1)) {
    const f = line.split(';');
    const get = i => (f[i] ?? '').trim();
    invoiceNumber = invoiceNumber || get(C.invoice) || null;
    const ref = get(C.ref);
    const row = {
      ref, tracking: get(C.tracking).replace(/^0+$/, '') || null, linked: get(C.linked) || null,
      date: frDate(get(C.date)), pickup: get(C.pickup), type: get(C.type), mode: get(C.mode), pays: get(C.pays),
      billed_g: num(get(C.billed)), declared_g: num(get(C.declared)), measured_g: num(get(C.measured)),
      volumetric_g: num(get(C.volumetric)),
      dims_mm: [num(get(C.length)), num(get(C.width)), num(get(C.height))],
      transport: num(get(C.transport)), indexation: num(get(C.index)),
      complement: num(get(C.complement)), total: num(get(C.total)),
    };
    if (ref) parcels.push(row); else invoiceRows.push(row);
  }
  return { invoiceNumber, parcels, invoiceRows };
}

/**
 * Tarif de transport par (pays, famille de mode, tranche), relevé sur la facture
 * elle-même : le tarif le plus fréquent de chaque tranche. Repli sur la grille
 * 2026 hors domicile quand la tranche n'apparaît pas sur la facture.
 */
function buildPriceTable(rows) {
  const counts = {};
  for (const r of rows) {
    if (r.is_return || !(r.transport > 0) || !(r.billed_g > 0)) continue;
    const key = `${r.pays}|${modeGroup(r.mode)}|${bracketIndex(r.billed_g)}`;
    counts[key] = counts[key] || {};
    counts[key][r.transport] = (counts[key][r.transport] || 0) + 1;
  }
  const table = {};
  for (const [key, c] of Object.entries(counts)) {
    table[key] = parseFloat(Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]);
  }
  return (pays, mode, grams) => {
    const idx = bracketIndex(grams);
    const hit = table[`${pays}|${modeGroup(mode)}|${idx}`];
    if (hit != null) return hit;
    const grid = modeGroup(mode) === 'HD' ? GRID_2026_HD[PAYS_LABELS[pays]] : null;
    return grid && grid[idx] != null ? grid[idx] : null;
  };
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Coût net par colis, rapprochement des commandes et écarts de tarif.
 *
 * @param {object} csv - sortie de parseMondialRelayCsv
 * @param {object} ctx
 * @param {number|null} ctx.remiseRate - taux de remise de la facture PDF (14 = 14 %)
 * @param {number|null} ctx.pdfTotalHT - total HT du PDF, pour le rapprochement
 * @param {number|null} ctx.pdfNbColis - nombre de colis du PDF
 * @param {Set<number>} ctx.knownOrderIds - n° de commande existant en base
 * @param {Object<string, number>} ctx.orderByTracking - n° de suivi → commande
 * @param {Object<number, number>} ctx.bddWeights - commande → poids calculé (g, tare comprise)
 */
function analyzeMondialRelayCsv(csv, ctx = {}) {
  const knownOrderIds = ctx.knownOrderIds || new Set();
  const orderByTracking = ctx.orderByTracking || {};
  const bddWeights = ctx.bddWeights || {};

  const sumTotal = round2([...csv.parcels, ...csv.invoiceRows].reduce((s, r) => s + r.total, 0));
  const sumTransport = csv.parcels.reduce((s, r) => s + r.transport, 0);
  const remiseRows = csv.invoiceRows.filter(r => r.total < 0 && !(r.transport > 0));
  const remiseCsv = round2(remiseRows.reduce((s, r) => s + r.total, 0));

  // Le taux du PDF fait foi (la remise porte aussi sur le forfait collecte, que
  // le CSV range hors colonne transport) ; à défaut, on le déduit du CSV.
  let remiseRate = ctx.remiseRate != null ? Number(ctx.remiseRate) : null;
  let remiseSource = 'pdf';
  if (remiseRate == null) {
    remiseRate = sumTransport > 0 ? Math.round((-remiseCsv / sumTransport) * 1000) / 10 : 0;
    remiseSource = 'csv';
  }

  const billed = csv.parcels.filter(r => r.total !== 0);
  const unbilled = csv.parcels.length - billed.length;

  // Deux sortes de retours, tous deux à la charge de la commande d'origine :
  //   - colis non retiré renvoyé par MR : Type « Retour », prise en charge PCI,
  //     référence « LG… », « Expedition liée » = suivi du colis aller ;
  //   - retour client : prise en charge REL, livré chez EMC, référence = commande.
  // Une référence non numérique (« ? » pour une étiquette saisie à la main)
  // n'est PAS un retour : la commande se retrouve par son suivi.
  const rows = billed.map(r => {
    const isReturn = /^retour/i.test(r.type) || /^(PCI|REL)$/i.test(r.pickup || '');
    const ref = /^\d+$/.test(r.ref) ? parseInt(r.ref, 10) : null;
    let orderId = null;
    if (ref != null && knownOrderIds.has(ref)) orderId = ref;
    else orderId = orderByTracking[r.linked] || orderByTracking[r.tracking] || null;
    return { ...r, is_return: isReturn, return_kind: isReturn ? (/^REL$/i.test(r.pickup || '') ? 'client' : 'non_retire') : null, order_id: orderId };
  });
  const parcels = rows.map(r => {
    const net = round4(r.total - r.transport * remiseRate / 100);
    const bdd = r.order_id != null && bddWeights[r.order_id] != null ? Math.round(bddWeights[r.order_id]) : null;
    const out = {
      order_id: r.order_id, ref: r.ref, tracking: r.tracking, linked: r.linked, date: r.date,
      type: r.type, mode: r.mode, pays: r.pays, is_return: r.is_return, return_kind: r.return_kind,
      declared_g: r.declared_g, bdd_g: bdd, measured_g: r.measured_g,
      volumetric_g: r.volumetric_g, billed_g: r.billed_g, dims_mm: r.dims_mm,
      transport: r.transport, indexation: r.indexation, complement: r.complement,
      total: r.total, net, due: null, ecart: null, kind: null,
      density: null,
    };
    const volCm3 = r.dims_mm.every(v => v > 0) ? (r.dims_mm[0] * r.dims_mm[1] * r.dims_mm[2]) / 1000 : 0;
    if (volCm3 > 0 && r.measured_g > 0) out.density = Math.round((r.measured_g / volCm3) * 1000) / 1000;
    return out;
  });
  const cgv = ctx.cgv || cgvForInvoice(ctx);
  classifyParcels(parcels, { remiseRate, cgv });

  const matched = parcels.filter(p => p.order_id != null);
  const netAllocated = round2(matched.reduce((s, p) => s + p.net, 0));
  const gaps = parcels
    .filter(p => !p.is_return && p.measured_g > 0 && p.declared_g > 0)
    .map(p => p.measured_g - p.declared_g);

  return {
    invoiceNumber: csv.invoiceNumber,
    cgv, remiseRate, remiseSource, remiseCsv,
    sumTotal,
    pdfTotalHT: ctx.pdfTotalHT ?? null,
    reconcileOk: ctx.pdfTotalHT != null ? Math.abs(sumTotal - Number(ctx.pdfTotalHT)) < 0.05 : null,
    billedCount: parcels.length,
    pdfNbColis: ctx.pdfNbColis ?? null,
    unbilledCount: unbilled,
    matchedCount: matched.length,
    unmatchedCount: parcels.length - matched.length,
    returnCount: parcels.filter(p => p.is_return).length,
    netAllocated,
    // Forfait collecte net, colis sans commande, arrondis : payé mais à personne.
    unallocated: round2(sumTotal - netAllocated),
    medianWeighGap: median(gaps),
    weighedCount: gaps.length,
    parcels,
  };
}

/**
 * Quelles CGV s'appliquent à une facture : celles du 01/10/2025, notifiées le
 * 27/11/2025 « au 1er janvier 2026 », ou celles annexées au contrat n° 31257.
 * On lit le début de la période facturée (la facture du 31/12/2025 couvre
 * décembre 2025 : anciennes CGV). Faute de date, les CGV en vigueur.
 */
function cgvForInvoice({ periodStart, invoiceDate } = {}) {
  const m = String(periodStart || invoiceDate || '').match(/(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return '2026';
  return parseInt(m[3], 10) >= 2026 ? '2026' : '2025';
}

/**
 * Tarif dû, écart et motif de chaque colis, selon les CGV de la facture.
 * Ne lit que des champs enregistrés : rejouable sur une analyse déjà en base.
 *
 * Poids facturable (art. 4.2) :
 *   - CGV 2026 : le plus élevé du volumétrique, du déclaré et du mesuré. Le
 *     volumétrique est contractuel ; il entre donc dans le tarif dû (la 1231593,
 *     536 g volumétriques, est due à 4,69 € et non 3,59 €).
 *   - CGV 2025 : le déclaré, sauf pesée plus lourde ; le volumétrique seulement
 *     « si nécessaire, notamment en transport aérien ». Un colis facturé au
 *     volumétrique est donc réclamable (motif volumetrique_hors_cgv).
 *
 * Motifs : aberrant (pesée impossible, réclamable), incoherent (pesée sans
 * rapport avec le contenu, réclamable au cas par cas), volumetrique_hors_cgv
 * (réclamable, CGV 2025), volumetrique (CGV 2026 : surcoût carton, info),
 * pesee (pesée plus lourde, presque toujours l'emballage, info).
 */
function classifyParcels(parcels, { remiseRate = 0, cgv = '2026' } = {}) {
  const priceFor = buildPriceTable(parcels);
  for (const p of parcels) {
    p.due = null; p.ecart = null; p.kind = null;
    if (p.is_return || !(p.transport > 0)) continue;
    const ourG = Math.max(p.declared_g || 0, p.bdd_g || 0);
    if (!(ourG > 0)) continue;

    const volBilled = p.volumetric_g > 0 && Math.abs(p.billed_g - p.volumetric_g) < 1 && p.volumetric_g > (p.measured_g || 0);
    // Facturé au volumétrique : on compare au tarif du poids réel (pesé ou déclaré).
    // Sinon : au tarif du poids que le contrat autorise sans contestation possible.
    const floorG = volBilled
      ? Math.max(ourG, p.measured_g || 0)
      : Math.max(ourG, cgv === '2026' ? (p.volumetric_g || 0) : 0);
    const due = priceFor(p.pays, p.mode, floorG);
    if (due == null || p.transport - due < 0.005) continue;

    // L'écart coûte le transport en trop, moins la remise, plus l'indexation
    // gasoil calculée dessus — ce qui a été réellement payé en trop.
    const idxRate = (p.indexation || 0) / p.transport;
    p.due = due;
    p.ecart = round2((p.transport - due) * (1 - remiseRate / 100 + idxRate));
    if (volBilled) p.kind = cgv === '2025' ? 'volumetrique_hors_cgv' : 'volumetrique';
    else if (p.density != null && p.density > ABERRANT_DENSITY && (p.measured_g || 0) - floorG >= ABERRANT_MIN_G) p.kind = 'aberrant';
    else if ((p.measured_g || 0) >= ourG * INCOHERENT_RATIO && (p.measured_g || 0) - ourG >= ABERRANT_MIN_G) p.kind = 'incoherent';
    else p.kind = 'pesee';
  }
  return parcels;
}

const CLAIMABLE_KINDS = ['aberrant', 'volumetrique_hors_cgv'];

/**
 * Rattache aux colis les frais exceptionnels de LEUR facture (PDF) :
 * p.fees = [{ label, amount }].
 *
 * Vérifié sur décembre 2025 → septembre 2026 (« Autres frais » de l'écran) :
 *   - colis non retiré renvoyé (« … renvoyé à l'Expéditeur », « Prestation de
 *     retour suite colis non réclamé ») : la ligne Retour PCI, dont le transport
 *     vaut le prix unitaire (2 €, 3 €, 5 €, 6 €) ;
 *   - autre frais (colis trop petit 2,50 €, ré-étiquetage 1,50 €, Corse 3 €…) :
 *     le complément du colis, participations sûreté + éco (0,13 €) déduites —
 *     les lignes de retour n'en portent pas, d'où le second essai sans déduction.
 * Le libellé vient de la facture, jamais d'un montant deviné : 3 € peut être un
 * supplément Corse comme un dépassement Locker selon les CGV.
 */
const RETURN_FEE_RE = /renvoy|non r[ée]clam/i;
const STD_PARTICIPATION_RE = /[ée]co.?responsable|s[uû]ret[ée]/i;

function annotateParcelFees(parsed) {
  const parcels = parsed?.csv?.parcels;
  if (!Array.isArray(parcels)) return parsed;
  const lines = ['surcharges', 'complements', 'retourPCI', 'participations']
    .flatMap(g => (Array.isArray(parsed[g]) ? parsed[g] : []))
    .filter(l => Number(l.pu) > 0 && !STD_PARTICIPATION_RE.test(l.label || ''));
  const partic = (Array.isArray(parsed.participations) ? parsed.participations : [])
    .filter(l => STD_PARTICIPATION_RE.test(l.label || ''))
    .reduce((s, l) => s + (Number(l.pu) || 0), 0);
  const near = (a, b) => Math.abs(a - b) < 0.005;
  for (const p of parcels) {
    const fees = [];
    if (p.return_kind === 'non_retire') {
      const l = lines.find(x => RETURN_FEE_RE.test(x.label) && near(Number(x.pu), p.transport));
      if (l) fees.push({ label: l.label, amount: Number(l.pu) });
    }
    const compl = Number(p.complement) || 0;
    for (const extra of [round2(compl - partic), round2(compl)]) {
      if (!(extra > 0.005)) continue;
      const l = lines.find(x => !RETURN_FEE_RE.test(x.label) && near(Number(x.pu), extra));
      if (l) { fees.push({ label: l.label, amount: Number(l.pu) }); break; }
    }
    p.fees = fees;
  }
  return parsed;
}

module.exports = {
  parseMondialRelayCsv, analyzeMondialRelayCsv, classifyParcels, annotateParcelFees, cgvForInvoice, CLAIMABLE_KINDS, bracketIndex,
  ABERRANT_DENSITY, ABERRANT_MIN_G, INCOHERENT_RATIO,
};
