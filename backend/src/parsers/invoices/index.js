/**
 * Registre des parseurs de FACTURE, indexé sur `suppliers.code`.
 *
 * À ne pas confondre avec `parsers/index.js`, qui lit les bons de commande et
 * confirmations à l'import. Les deux documents n'ont ni le même gabarit ni le
 * même usage : l'un crée la commande, l'autre la contrôle.
 *
 * Un parseur de facture renvoie toujours la même forme, quelle que soit la
 * mise en page du fournisseur :
 *
 *   { number, date, dueDate, orderRefOnDoc, statedPaymentMethod,
 *     totalHt, totalTva, totalTtc,
 *     lines: [{ ref, label, qty, lineTotalHt, kind }],
 *     warnings: [] }
 *
 * C'est exactement ce qu'attend `compareInvoiceToOrder` : ajouter un
 * fournisseur ne demande donc jamais de toucher au moteur de comparaison.
 *
 * Un fournisseur sans code renseigné dans BMS n'a aucun parseur — le piège
 * connu depuis le parseur Pulp (cf. `project_parseur_pulp_code_fournisseur`).
 */

const opensiInvoice = require('./opensiInvoice');
const odooInvoice = require('./odooInvoice');
const prestashopInvoice = require('./prestashopInvoice');

// Trois fournisseurs, un seul gabarit : LCA, LVP et GFC éditent tous depuis OpenSi.
const parsers = {
  'LCA': opensiInvoice,
  'LVP Distribution': opensiInvoice,
  'GFC FrancoChine': opensiInvoice,

  // Quatre fournisseurs sur Odoo : prix unitaire TTC chez JoshNoa, HT chez les
  // autres, colonne TAXES intercalée partout.
  'Joshnoa': odooInvoice,
  'Levest - Roykin': odooInvoice,
  'LIPS - French Liquide': odooInvoice,
  'Cloud Vapor': odooInvoice,

  // Sept fournisseurs sur PrestaShop : le prix y précède la quantité, à
  // l'inverse des deux autres gabarits.
  'Revolute - Cosmer': prestashopInvoice,
  'Highbuy': prestashopInvoice,
  'Curieux': prestashopInvoice,
  'Cigaccess': prestashopInvoice,
  'Etasty': prestashopInvoice,
  'MG Vape': prestashopInvoice,
  'Pulp': prestashopInvoice,
};

module.exports = {
  getInvoiceParser: (supplierCode) => parsers[supplierCode] || null,
  hasInvoiceParser: (supplierCode) => !!parsers[supplierCode],
  availableInvoiceParsers: () => Object.keys(parsers),
};
