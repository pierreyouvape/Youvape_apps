/**
 * Lecture du récapitulatif de commande AliExpress — pour PRÉ-REMPLIR le dépôt
 * manuel, jamais pour contrôler (cf. `isManualInvoiceSupplier`).
 *
 * Le texte vient soit du PDF, soit de l'OCR d'une capture d'écran : les
 * libellés sont donc cherchés avec tolérance (deux-points facultatifs, espaces
 * en trop, « € » devant ou derrière). Ce qui n'est pas trouvé reste à null et
 * se saisit à la main — un champ vide vaut mieux qu'un montant deviné.
 *
 *   ID de commande: 3077545413325687      → number (une commande par vendeur)
 *   Temps de commande: 26 oct. 2026       → date
 *   Total: 148,39€                        → totalTtc (frais d'importation compris)
 *   TVA: 12,34€                           → totalTva, quand elle est imprimée
 */

const MOIS = {
  janv: 1, jan: 1, janvier: 1, fevr: 2, fev: 2, fevrier: 2, feb: 2, mars: 3, mar: 3,
  avr: 4, avril: 4, apr: 4, mai: 5, may: 5, juin: 6, jun: 6, juil: 7, juillet: 7, jul: 7,
  aout: 8, aug: 8, sept: 9, sep: 9, septembre: 9, oct: 10, octobre: 10, nov: 11, novembre: 11,
  dec: 12, decembre: 12,
};

const sansAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** « 142,39€ », « € 1 234.50 », « EUR 148.39 » → 142.39 */
function montant(s) {
  if (!s) return null;
  const m = String(s).match(/-?\d[\d  .,]*/);
  if (!m) return null;
  let t = m[0].replace(/[\s ]/g, '');
  // Le dernier séparateur suivi de 2 chiffres est la décimale.
  t = /[.,]\d{2}$/.test(t) ? t.slice(0, -3).replace(/[.,]/g, '') + '.' + t.slice(-2) : t.replace(/[.,]/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** « 26 oct. 2026 », « 26/10/2026 », « 2026-10-26 » → '2026-10-26' */
function dateIso(s) {
  if (!s) return null;
  const pad = (n) => String(n).padStart(2, '0');
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m = sansAccents(s).toLowerCase().match(/(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})/);
  if (m && MOIS[m[2]]) return `${m[3]}-${pad(MOIS[m[2]])}-${pad(m[1])}`;
  return null;
}

/** La valeur qui suit un libellé sur la même ligne. */
function apres(lignes, libelle) {
  for (const l of lignes) {
    const m = sansAccents(l).match(libelle);
    if (m) return l.slice(m.index + m[0].length).replace(/^\s*:?\s*/, '');
  }
  return null;
}

function parseAliexpressReceipt(text) {
  const lignes = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);

  const id = apres(lignes, /(ID de commande|N(o|°|um[eé]ro) de commande|Order ID)/i);
  const number = id ? (id.match(/\d{8,}/) || [null])[0] : null;

  const date = dateIso(apres(lignes, /(Temps de commande|Date de commande|Order time|Date)/i))
    || dateIso(apres(lignes, /Pay[eé] (sur|le)/i));

  // « Total » seul en tête de ligne : pas « Sous-total ».
  const totalTtc = montant(apres(lignes, /^Total\b(?! HT)/i));
  const tva = apres(lignes, /^(TVA|VAT)\b/i);
  const totalTva = tva ? montant(tva) : null;

  return { number, date, totalTtc, totalTva };
}

module.exports = { parseAliexpressReceipt, montant, dateIso };
