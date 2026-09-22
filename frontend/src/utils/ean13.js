/**
 * Rendu EAN-13 en SVG — le même dessin que les étiquettes d'avril 2026.
 *
 * Géométrie reprise à l'identique des SVG déjà imprimés (100 × 25 mm) : un
 * symbole EAN-13 fait 95 modules, plus les zones de silence obligatoires de
 * 11 modules à gauche et 7 à droite = 113 modules pour 100 mm de large. Donc
 * un module = 100/113 mm, et la première barre commence à 11 modules du bord.
 *
 * Ne pas « améliorer » ces valeurs : les codes déjà collés viennent de là, et
 * une étiquette réimprimée doit rester superposable à l'ancienne. La zone de
 * silence, en particulier, n'est pas de la marge décorative — sans elle un
 * lecteur refuse le code.
 *
 * L'étiquette ne porte AUCUN texte, comme les originales.
 */

/* Motifs des chiffres, par jeu (1 = barre). Le jeu utilisé à gauche (L ou G)
 * encode le 1er chiffre, qui n'a pas de barres à lui. */
const L = ['0001101', '0011001', '0010011', '0111101', '0100011',
           '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101',
           '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100',
           '1001110', '1010000', '1000100', '1001000', '1110100'];

/** Parité de la moitié gauche, dictée par le 1er chiffre. */
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
                'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

const GUARD = '101';
const CENTER = '01010';

/** Les 95 modules du symbole, en 0/1. */
export function ean13Bits(code) {
  const s = String(code ?? '');
  if (!/^\d{13}$/.test(s)) throw new Error(`Code EAN-13 invalide : ${code}`);
  const d = s.split('').map(Number);
  const parity = PARITY[d[0]];
  let bits = GUARD;
  for (let i = 0; i < 6; i++) bits += (parity[i] === 'L' ? L : G)[d[i + 1]];
  bits += CENTER;
  for (let i = 0; i < 6; i++) bits += R[d[i + 7]];
  return bits + GUARD;
}

/* Les originaux écrivent les mm avec 1 décimale pour le cadre, 4 pour les
 * barres — on s'aligne pour que deux fichiers se comparent sans bruit. */
const mm1 = (n) => n.toFixed(1);
const mm4 = (n) => n.toFixed(4);

/**
 * SVG complet d'une étiquette, en millimètres.
 * @param {string} code    13 chiffres
 * @param {object} [opts]  { width = 100, height = 25 } en mm
 */
export function ean13Svg(code, { width = 100, height = 25 } = {}) {
  const bits = ean13Bits(code);
  const module = width / (bits.length + 18); // 11 modules de silence à gauche, 7 à droite
  const bars = [];

  // Barres contiguës fusionnées en un seul rect : c'est ce que font les
  // fichiers d'origine, et ça divise par deux le poids du SVG.
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === '0') { i++; continue; }
    let run = 0;
    while (i + run < bits.length && bits[i + run] === '1') run++;
    bars.push(`<rect x="${mm4((11 + i) * module)}" y="0" width="${mm4(run * module)}"`
      + ` height="${mm1(height)}" fill="#000"/>`);
    i += run;
  }

  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + `<svg xmlns="http://www.w3.org/2000/svg" width="${mm1(width)}mm" height="${mm1(height)}mm"`
    + ` viewBox="0 0 ${mm1(width)} ${mm1(height)}" shape-rendering="crispEdges">\n`
    + `  <rect x="0" y="0" width="${mm1(width)}" height="${mm1(height)}" fill="#fff"/>\n`
    + `  ${bars.join('')}\n`
    + '</svg>\n';
}

/** Lecture humaine : 2522 16 13 0003 7 → « 2522 1613 0003 7 ». */
export const formatBarcode = (code) => {
  const s = String(code ?? '');
  return /^\d{13}$/.test(s)
    ? `${s.slice(0, 4)} ${s.slice(4, 8)} ${s.slice(8, 12)} ${s.slice(12)}`
    : s;
};
