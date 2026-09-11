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
 * @param {string} pdfBase64 - étiquette renvoyée par le transporteur
 * @param {string|number} orderNumber - référence à imprimer, préfixée d'un « # »
 * @returns {Promise<string>} le PDF tamponné, en base64
 */
const stampOrderNumber = async (pdfBase64, orderNumber) => {
  const pdfBytes = Buffer.from(pdfBase64, 'base64');
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

module.exports = { stampOrderNumber, shiftContentDown };
