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
 * Elle est lue dans la réserve, par quelqu'un qui cherche le colis d'un client
 * qui vient d'arriver au comptoir. **On cherche au nom, pas au numéro de
 * commande** : c'est le nom qui domine l'étiquette, le numéro ne sert qu'à
 * lever un doute entre deux commandes du même client.
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

  /** Rétrécit jusqu'à tenir sur la largeur : un nom long doit rester entier. */
  const centreAjuste = (text, font, tailleMax, tailleMin, y) => {
    const t = sanitizeAddressField(String(text ?? '')) || '';
    let taille = tailleMax;
    while (taille > tailleMin && font.widthOfTextAtSize(t, taille) > WIDTH - 30) taille -= 1;
    centre(t, font, taille, y);
    return taille;
  };

  centre('RETRAIT MAGASIN', bold, 14, HEIGHT - 40);
  page.drawLine({ start: { x: 20, y: HEIGHT - 54 }, end: { x: WIDTH - 20, y: HEIGHT - 54 }, thickness: 1.2 });

  // Le bloc est centré verticalement : l'étiquette se lit à un mètre, dans une
  // réserve, sur un carton posé de travers. Tout tasser en haut gâcherait la
  // moitié de la surface utile.
  const nom = (receiver.last_name || '').trim().toUpperCase();
  const prenom = (receiver.first_name || '').trim();

  if (nom && prenom) {
    centreAjuste(nom, bold, 34, 12, 250);
    centreAjuste(prenom, bold, 24, 10, 210);
  } else {
    // Repli : certaines commandes n'ont qu'un nom complet non séparé.
    centreAjuste(nom || prenom || receiver.name || '(sans nom)', bold, 32, 10, 230);
  }

  if (receiver.company) centreAjuste(receiver.company, regular, 13, 8, 175);

  // Le numéro de commande, discret : il ne sert qu'à départager deux commandes
  // du même client.
  page.drawLine({ start: { x: 60, y: 140 }, end: { x: WIDTH - 60, y: 140 }, thickness: 0.5 });
  centre(`Commande n° ${orderNumber}`, regular, 13, 115);
  centre(new Date().toLocaleDateString('fr-FR'), regular, 10, 30);

  const pdfBase64 = Buffer.from(await doc.save()).toString('base64');
  console.log(`[${LOG_TAG}] Étiquette de retrait pour la commande`, orderNumber);

  // Pas de numéro de suivi : il n'y a pas de transport. BMS est quand même
  // informé de la sortie de stock, cf. shipmentController.
  return { carrierOrderId: null, trackingNumber: null, pdfBase64 };
};

/**
 * Rien à annuler chez personne — mais l'étiquette peut être marquée annulée en
 * base comme les autres, ce que fait le contrôleur. La fenêtre reste ouverte :
 * un retrait annulé se range, il n'y a aucune contrainte de facturation.
 */
const cancelWindow = () => ({ cancellable: true, reason: null });
const cancelLabel = async () => ({ cancelled: true, carrier: 'interne' });

/**
 * Nom du fichier téléchargé au packing : `retraitmagasin_<n°>.pdf`.
 *
 * Même forme que Mondial Relay, faute de consigne AutoPrint pour le retrait —
 * à ajuster si l'imprimante du comptoir doit être distinguée.
 */
const labelFileName = (orderNumber) => `retraitmagasin_${orderNumber}.pdf`;

module.exports = assertAdapter({
  code: 'interne',
  accountCode: 'retrait_magasin',
  methodCode: 'retrait_magasin',
  label: CARRIER_LABEL,
  logTag: LOG_TAG,
  labelFileName,
  // Le colis ne part pas chez un transporteur, mais il sort du stock : BMS doit
  // le savoir comme pour n'importe quelle expédition. Il n'aura simplement
  // aucun numéro de suivi.
  bmsShipmentTitle: 'Retrait magasin',
  requiresAccount: false,
  resolveWeight,
  createLabel,
  cancelLabel,
  cancelWindow
});
