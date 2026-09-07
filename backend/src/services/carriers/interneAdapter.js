/**
 * Adaptateur interne — retrait en magasin.
 *
 * Il n'y a pas de transporteur : le colis attend le client au comptoir. Mais il
 * lui faut quand même une étiquette, sinon rien ne dit à qui appartient le
 * carton dans la réserve. Trois informations suffisent : nom, prénom, numéro de
 * commande.
 *
 * Le fabriquer ici plutôt qu'ailleurs a une raison : il remplit le même contrat
 * que La Poste et Mondial Relay. Il est donc enregistré dans `shipment_labels`,
 * apparaît dans la liste des étiquettes, se réimprime avec le même bouton. Un
 * bouton séparé dans le packing aurait été plus court à écrire et aurait produit
 * une étiquette que personne ne peut retrouver.
 *
 * Aucun appel réseau, aucun contrat : cet adaptateur déclare `requiresAccount:
 * false` et le contrôleur ne lui cherche pas d'identifiants.
 */

const { PDFDocument, StandardFonts } = require('pdf-lib');
const { sanitizeAddressField } = require('./addressFields');
const { assertAdapter } = require('./contract');

const LOG_TAG = 'Interne';
const CARRIER_LABEL = 'Retrait magasin';

// 10 × 15 cm en points PDF (1 pt = 1/72"), le format des étiquettes du packing.
const WIDTH = 283.46;
const HEIGHT = 425.20;

/** Aucun poids à déclarer : personne ne transporte le colis. */
const resolveWeight = async () => 0;

/**
 * Dessine l'étiquette de retrait.
 *
 * Sobre et grande : elle est lue à distance, dans une réserve, par quelqu'un qui
 * cherche un carton parmi d'autres. Le numéro de commande domine parce que c'est
 * lui qu'on recherche ; le nom vient confirmer.
 *
 * @param {import('./contract').CreateLabelInput} input
 * @returns {Promise<import('./contract').CreateLabelResult>}
 */
const createLabel = async ({ orderNumber, receiver }) => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([WIDTH, HEIGHT]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  const centre = (text, font, size, y) => {
    const t = sanitizeAddressField(String(text ?? '')) || '';
    const w = font.widthOfTextAtSize(t, size);
    page.drawText(t, { x: (WIDTH - w) / 2, y, size, font });
  };

  centre('RETRAIT MAGASIN', bold, 16, HEIGHT - 45);
  page.drawLine({ start: { x: 25, y: HEIGHT - 60 }, end: { x: WIDTH - 25, y: HEIGHT - 60 }, thickness: 1.2 });

  // Le numéro de commande, en très grand : c'est le critère de recherche.
  centre(`#${orderNumber}`, bold, 34, HEIGHT - 115);

  const nom = [receiver.first_name, receiver.last_name].filter(Boolean).join(' ').trim()
    || receiver.name || '';
  // Rétrécir plutôt que déborder : un nom long doit rester lisible en entier.
  let taille = 20;
  while (taille > 9 && bold.widthOfTextAtSize(sanitizeAddressField(nom) || '', taille) > WIDTH - 40) {
    taille -= 1;
  }
  centre(nom, bold, taille, HEIGHT - 165);

  if (receiver.company) centre(receiver.company, regular, 12, HEIGHT - 190);

  centre(new Date().toLocaleDateString('fr-FR'), regular, 10, 30);

  const pdfBase64 = Buffer.from(await doc.save()).toString('base64');
  console.log(`[${LOG_TAG}] Étiquette de retrait pour la commande`, orderNumber);

  // Ni numéro de suivi ni identifiant transporteur : il n'y a pas de transport.
  return { carrierOrderId: null, trackingNumber: null, pdfBase64 };
};

/**
 * Rien à annuler chez personne — mais l'étiquette peut être marquée annulée en
 * base comme les autres, ce que fait le contrôleur. La fenêtre reste ouverte :
 * un retrait annulé se range, il n'y a aucune contrainte de facturation.
 */
const cancelWindow = () => ({ cancellable: true, reason: null });
const cancelLabel = async () => ({ cancelled: true, carrier: 'interne' });

module.exports = assertAdapter({
  code: 'interne',
  accountCode: 'retrait_magasin',
  methodCode: 'retrait_magasin',
  label: CARRIER_LABEL,
  logTag: LOG_TAG,
  // Aucune expédition à confirmer : le colis ne quitte pas le magasin.
  bmsShipmentTitle: 'Retrait magasin',
  requiresAccount: false,
  confirmsShipmentInBms: false,
  resolveWeight,
  createLabel,
  cancelLabel,
  cancelWindow
});
