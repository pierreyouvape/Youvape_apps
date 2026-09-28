/**
 * Tamponnage du numéro de commande sur l'étiquette.
 *
 * La personne au packing pose l'étiquette sur le colis qu'elle vient de fermer :
 * sans la référence imprimée dessus, plus rien ne rattache le papier au carton
 * si la pile se mélange. Aucun transporteur ne l'imprime — on l'ajoute nous-mêmes,
 * en bas à gauche, hors de la zone du code-barres.
 *
 * Extrait de `controllers/laposteController` (lot 0), inchangé : mêmes
 * coordonnées, même corps de police, pour que les étiquettes des prochains
 * transporteurs se lisent comme celles déjà en circulation.
 */

const { PDFDocument, StandardFonts } = require('pdf-lib');

/**
 * L'étiquette est-elle du ZPL (programme d'imprimante) plutôt qu'un PDF ?
 * Même règle qu'AutoPrint, qui choisit l'impression d'après le CONTENU : pas
 * d'en-tête `%PDF` et une commande `^XA` en tête de fichier.
 *
 * @param {Buffer} bytes
 * @returns {boolean}
 */
const estZpl = (bytes) => {
  const debut = bytes.slice(0, 200).toString('latin1');
  return !debut.startsWith('%PDF') && /\^XA/.test(debut);
};

// Position du numéro de commande sur une étiquette ZPL Chronopost 203 dpi : en
// bas à gauche, sur la ligne des chiffres du code-barres, qui commencent à
// x = 190 (relevé sur une étiquette Chronopost imprimée par BMS). « #1263675 »
// en police 0 de 22 points tient dans les 160 points libres.
const ZPL_TAMPON = { x: 30, y: 1162, taille: 22 };

/**
 * Ajoute le numéro de commande à une étiquette ZPL, juste avant sa fin (`^XZ`).
 * Le reste du fichier est laissé octet pour octet : un ZPL peut contenir des
 * images binaires (`^GFA`) qu'un transcodage casserait.
 *
 * @param {Buffer} bytes
 * @param {string|number} orderNumber
 * @returns {Buffer}
 */
const stampZpl = (bytes, orderNumber) => {
  const ref = String(orderNumber).replace(/[^0-9A-Za-z-]/g, '');
  const texte = bytes.toString('latin1');
  const fin = texte.lastIndexOf('^XZ');
  if (fin < 0) return bytes;
  const { x, y, taille } = ZPL_TAMPON;
  const champ = `^FO${x},${y}^A0N,${taille},${taille}^FD#${ref}^FS\n`;
  return Buffer.concat([bytes.slice(0, fin), Buffer.from(champ, 'latin1'), bytes.slice(fin)]);
};

/**
 * Tamponne le PDF — ou le ZPL, reconnu à son contenu.
 *
 * @param {string} pdfBase64 - étiquette renvoyée par le transporteur
 * @param {string|number} orderNumber - référence à imprimer, préfixée d'un « # »
 * @returns {Promise<string>} le PDF tamponné, en base64
 */
const stampOrderNumber = async (pdfBase64, orderNumber) => {
  const pdfBytes = Buffer.from(pdfBase64, 'base64');
  if (estZpl(pdfBytes)) return stampZpl(pdfBytes, orderNumber).toString('base64');

  const pdfDoc = await PDFDocument.load(pdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page = pdfDoc.getPages()[0];

  page.drawText(`#${orderNumber}`, {
    x: 10,
    y: 10,
    size: 9,
    font
  });

  const modifiedBytes = await pdfDoc.save();
  return Buffer.from(modifiedBytes).toString('base64');
};

/**
 * Décale le contenu d'une étiquette vers le bas, sans changer le format de page.
 *
 * Pour les transporteurs qui collent leur contenu au bord supérieur de la page :
 * imprimé par le pilote de l'imprimante thermique, le haut est perdu. Colissimo
 * est dans ce cas — la commande 1260104 est sortie sans le nom du destinataire.
 * Le décalage réglé dans l'Intermec n'y peut rien : il ne s'applique qu'au ZPL
 * envoyé tel quel, pas à un PDF que le pilote transforme en image.
 *
 * Le contenu est repris tel quel, en vectoriel : codes-barres intacts, aucune
 * mise à l'échelle. La marge gagnée en haut est prise sur le bas de la page, qui
 * doit donc être vide sur au moins autant.
 *
 * @param {string} pdfBase64
 * @param {number} mm - décalage ; 0 ou moins rend l'étiquette inchangée
 * @returns {Promise<string>} le PDF décalé, en base64
 */
const shiftContentDown = async (pdfBase64, mm) => {
  if (!(mm > 0)) return pdfBase64;

  const source = await PDFDocument.load(Buffer.from(pdfBase64, 'base64'));
  const out = await PDFDocument.create();
  const pages = await out.embedPdf(source, source.getPageIndices());
  const decalage = mm / 25.4 * 72;

  for (const p of pages) {
    const page = out.addPage([p.width, p.height]);
    page.drawPage(p, { x: 0, y: -decalage, width: p.width, height: p.height });
  }

  return Buffer.from(await out.save()).toString('base64');
};

/**
 * Ramène une étiquette sur une vraie page 10 × 15 cm, avec une marge latérale.
 *
 * Chronopost rend son étiquette « thermique » (mode THE) sur une page A4. Le
 * pilote de l'Intermec la réduit pour la faire tenir sur le 10 × 15 ; l'A4
 * étant moins allongé, l'étiquette réduite remplit toute la largeur, et les
 * bords tombent hors de la zone imprimable — constaté le 25/09/2026, environ
 * 1 mm perdu de chaque côté.
 *
 * Le contenu est réduit en vectoriel (codes-barres intacts, proportions
 * gardées) pour laisser `margeMm` à gauche et à droite, calé en haut : la place
 * libre reste en bas, où le numéro de commande est tamponné.
 *
 * @param {string} pdfBase64
 * @param {number} margeMm - marge minimale sur chaque bord
 * @returns {Promise<string>} le PDF 10 × 15, en base64
 */
const fitToLabelPage = async (pdfBase64, margeMm = 2) => {
  const pt = (mm) => mm / 25.4 * 72;
  const largeur = pt(100);
  const hauteur = pt(150);
  const marge = pt(Math.max(0, Number(margeMm) || 0));

  const source = await PDFDocument.load(Buffer.from(pdfBase64, 'base64'));
  const out = await PDFDocument.create();
  const pages = await out.embedPdf(source, source.getPageIndices());

  for (const p of pages) {
    const echelle = Math.min((largeur - 2 * marge) / p.width, (hauteur - 2 * marge) / p.height);
    const w = p.width * echelle;
    const h = p.height * echelle;
    const page = out.addPage([largeur, hauteur]);
    page.drawPage(p, { x: (largeur - w) / 2, y: hauteur - marge - h, width: w, height: h });
  }

  return Buffer.from(await out.save()).toString('base64');
};

module.exports = { stampOrderNumber, shiftContentDown, fitToLabelPage, estZpl };
