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
const lipsInvoice = require('./lipsInvoice');

// Trois fournisseurs, un seul gabarit : LCA, LVP et GFC éditent tous depuis OpenSi.
const parsers = {
  'LCA': opensiInvoice,
  'LVP Distribution': opensiInvoice,
  'GFC FrancoChine': opensiInvoice,

  // Quatre fournisseurs sur Odoo : prix unitaire TTC chez JoshNoa, HT chez les
  // autres, colonne TAXES intercalée partout.
  'Joshnoa': odooInvoice,
  'Levest - Roykin': odooInvoice,
  // LIPS édite depuis deux logiciels : l'aiguillage reconnaît lequel.
  'LIPS - French Liquide': lipsInvoice,
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

// Fournisseurs dont la facture est rangée SANS parseur ni contrôle (demande du
// 26/10/2026) : on dépose le fichier et on saisit numéro, date et montant.
// AliExpress envoie une facture par vendeur — huit pour une seule commande —
// au gabarit changeant, et le prix y est celui déjà payé en ligne : rien à
// réclamer, seulement une pièce comptable à garder et à régler. Reconnu au
// nom comme au code, ce dernier n'étant pas toujours renseigné dans BMS.
const MANUAL_INVOICE_SUPPLIER = /ali\s*express/i;

const isManualInvoiceSupplier = (supplier) => !!supplier
  && (MANUAL_INVOICE_SUPPLIER.test(supplier.name || '') || MANUAL_INVOICE_SUPPLIER.test(supplier.code || ''));

module.exports = {
  isManualInvoiceSupplier,
  getInvoiceParser: (supplierCode) => parsers[supplierCode] || null,
  hasInvoiceParser: (supplierCode) => !!parsers[supplierCode],
  availableInvoiceParsers: () => Object.keys(parsers),
};
