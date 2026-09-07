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

module.exports = { stampOrderNumber };
