/**
 * LIPS édite depuis DEUX logiciels.
 *
 * Odoo pour FAC/2026/04162, incwo pour F2603-09576 — deux mises en page sans
 * rien de commun. Le registre n'associe qu'un parseur par fournisseur : cet
 * aiguillage reconnaît le document avant de le confier au bon.
 *
 * La reconnaissance porte sur des marques du GABARIT (« incwo », « Montant
 * total lignes HT »), jamais sur le numéro de facture : un fournisseur change
 * de numérotation plus souvent que de logiciel.
 */

const odooInvoice = require('./odooInvoice');
const incwoInvoice = require('./incwoInvoice');

function parseInvoice(text) {
  return incwoInvoice.looksLikeIncwo(text)
    ? incwoInvoice.parseInvoice(text)
    : odooInvoice.parseInvoice(text);
}

module.exports = { parseInvoice };
