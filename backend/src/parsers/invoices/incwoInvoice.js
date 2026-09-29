/**
 * Gabarit incwo — Laboratoire LIPS France.
 *
 * LIPS édite depuis DEUX logiciels : Odoo (FAC/2026/04162) et incwo
 * (F2603-09576). Rien ne les rapproche, et le parseur Odoo ne lisait aucune
 * ligne du second — l'écran affichait « Aucune ligne lue dans ce document ».
 *
 * CE QUI FAIT LA DIFFICULTÉ
 *
 * 1. LA CELLULE DE CHIFFRES SE COUPE N'IMPORTE OÙ. « 1,39 72 / flacons /
 *    100,08 20% A » s'étale sur trois lignes, et l'unité (« pack », « flacons »,
 *    « unit ») s'intercale entre la quantité et le total. On accumule donc
 *    jusqu'au terminateur « <total> <taux>% <code> », qui ferme toute ligne
 *    d'article et rien d'autre.
 *
 * 2. LA DÉSIGNATION EST BOURRÉE DE CHIFFRES : « E2S-LACHOSE-5050-60-03 - La
 *    Chose - 60ml - 3mg/ml ». Prendre « les deux nombres avant le total »
 *    marcherait par hasard. On exige que QUANTITÉ × PRIX = TOTAL : l'égalité
 *    s'auto-valide, comme partout ailleurs dans ces parseurs.
 *
 * 3. LA RÉFÉRENCE EST AU MILIEU du libellé, en deuxième position :
 *    « Marque - RÉFÉRENCE - Libellé ». C'est stable sur tout le document, y
 *    compris pour la PLV (« CLK - PLV-DISPLAY-CLK-X10 - … »).
 */

const NUM = String.raw`-?\d[\d   .,]*`;

/** Ferme une ligne d'article : « 134,40 20% A ». Rien d'autre n'a cette forme. */
const ROW_END = new RegExp(String.raw`(?:^|\s)(${NUM})\s+(\d+)\s*%\s*[A-Z]\s*$`);

const NOISE = [
  /^Désignation\b/i,
  /^€\s*HT\b/i,
  /^Adresse\b/i,
  /^Page\s+\d+\/\d+$/i,
  /^--\s*\d+\s+of\s+\d+\s*--$/i,
  /^Facture$/i,
  /^Laboratoire LIPS/i,
  /^RCS\s/i,
  /^T[ée]l\s/i,
  /^TVA Intra/i,
  /^Conditions de paiement/i,
  /^Modalit[ée]s\s*:/i,
  /^(forfaitaire|escompte)\b/i,
  /^Commande\/Order/i,
  /^Livraison\/Delivery/i,
  /^Montant total/i,
  /^Code TVA/i,
  /^Quantit[ée] totale/i,
  /^R[ée]glements/i,
  /^Facture acquitt[ée]e/i,
  /^Signature\s*:/i,
  /^TVA collect[ée]e/i,
  /^https?:/i,
  /^\d+\s+rue\s/i,
  /^SIREN\b/i,
];

function toNumber(s) {
  if (s == null) return null;
  const clean = String(s).replace(/[\s ]/g, '').replace(',', '.');
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const isNoise = (l) => NOISE.some((re) => re.test(l.trim()));

/** Ce document sort-il d'incwo ? */
function looksLikeIncwo(text) {
  return /incwo/i.test(text) || /Montant total lignes HT/i.test(text);
}

/**
 * La référence est le deuxième segment de « Marque - RÉFÉRENCE - Libellé ».
 * À défaut, le premier segment qui en a la forme.
 */
function splitRef(designation) {
  const segments = String(designation || '').split(/\s+-\s+/).map((x) => x.trim()).filter(Boolean);
  if (segments.length < 2) return { ref: null, label: designation || null };

  const refLike = (x) => /^[A-Z0-9][A-Z0-9-]{3,}$/.test(x) && /[A-Z]/.test(x);
  let i = refLike(segments[1]) ? 1 : segments.findIndex(refLike);
  if (i < 1) return { ref: null, label: designation || null };

  return {
    ref: segments[i],
    label: segments.slice(i + 1).join(' - ') || segments[0],
  };
}

/**
 * Quantité et prix, dans le fatras de chiffres qui précède le total.
 *
 * On part de la fin — le prix précède la quantité chez incwo — et on ne retient
 * le couple que si son produit retombe sur le total imprimé.
 */
function readQtyPrice(before, total) {
  const tokens = before.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const nums = [];
  for (let i = tokens.length - 1; i >= 0 && nums.length < 8; i -= 1) {
    const n = toNumber(tokens[i]);
    if (n !== null && /\d/.test(tokens[i])) nums.push({ n, i });
  }

  // nums[0] = le plus à droite. Chez incwo la colonne est « prix qté [unité] ».
  for (let a = 0; a < nums.length; a += 1) {
    for (let b = a + 1; b < nums.length; b += 1) {
      const qty = nums[a].n;
      const price = nums[b].n;
      if (!Number.isInteger(qty) || qty <= 0) continue;
      if (Math.abs(round2(qty * price) - total) > 0.011) continue;
      // `cut` est un indice de JETON, pas de caractère : c'est au appelant de
      // rejoindre les jetons, pas de découper la chaîne.
      return { qty, price, tokens, cut: nums[b].i };
    }
  }
  return null;
}

function parseHeader(text) {
  const flat = text.replace(/\s*\n\s*/g, ' ');
  const amount = (re) => {
    const m = flat.match(re);
    return m ? toNumber(m[1]) : null;
  };

  const numero = flat.match(/Facture\s+(F\d{3,4}-\d{4,6})/i);
  const date = flat.match(/F\d{3,4}-\d{4,6}\s+(\d{2}\/\d{2}\/\d{4})/);
  const commande = flat.match(/Commande\/Order\s*:\s*([A-Z0-9-]+)/i);
  const reglement = flat.match(/R[ée]glements\s+([A-Za-zÀ-ÿ]+)/i);

  const totalHt = amount(/Montant total lignes HT\s+([\d   .,]+)\s*€/i);
  const totalTtc = amount(/Montant total TTC\s+([\d   .,]+)\s*€/i);

  return {
    number: numero ? numero[1] : null,
    date: date ? date[1] : null,
    dueDate: null,
    orderRefOnDoc: commande ? commande[1] : null,
    statedPaymentMethod: reglement ? reglement[1] : null,
    totalHt,
    totalTtc,
    totalTva: totalHt != null && totalTtc != null ? round2(totalTtc - totalHt) : null,
    isCreditNote: false,
    docType: 'invoice',
  };
}

function parseInvoice(rawText) {
  const header = parseHeader(rawText);
  const lines = [];
  const warnings = [];

  let buffer = '';
  for (const raw of String(rawText).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (isNoise(line)) { buffer = ''; continue; }

    const bloc = (buffer ? `${buffer} ${line}` : line).trim();
    const fin = bloc.match(ROW_END);
    if (!fin) {
      // Un tampon qui enfle n'est plus une désignation : c'est du mobilier que
      // rien n'a reconnu, et il irait polluer l'article suivant.
      buffer = bloc.length > 400 ? line : bloc;
      continue;
    }

    const total = toNumber(fin[1]);
    const before = bloc.slice(0, bloc.length - fin[0].length);
    const lu = total === null ? null : readQtyPrice(before, total);

    if (!lu) {
      warnings.push({ type: 'unreadable_row', text: bloc.slice(0, 200) });
      buffer = '';
      continue;
    }

    const { ref, label } = splitRef(lu.tokens.slice(0, lu.cut).join(' '));
    lines.push({
      ref,
      label,
      qty: lu.qty,
      lineTotalHt: round2(total),
      unitPriceNet: lu.price,
      discountPercent: 0,
      kind: 'product',
    });
    buffer = '';
  }

  const somme = round2(lines.reduce((s, l) => s + l.lineTotalHt, 0));
  if (header.totalHt != null && Math.abs(somme - header.totalHt) > 0.02) {
    warnings.push({
      type: 'total_mismatch',
      text: `Lignes lues ${somme.toFixed(2)} € contre ${header.totalHt.toFixed(2)} € imprimés`,
    });
  }

  return { ...header, lines, warnings };
}

module.exports = { parseInvoice, looksLikeIncwo, splitRef, readQtyPrice };
