const lcaParser = require('./lcaParser');
const joshnoaParser = require('./joshnoaParser');
const gfcParser = require('./gfcParser');
const lvpParser = require('./lvpParser');
const cigaccessParser = require('./cigaccessParser');
const curieuxParser = require('./curieuxParser');
const etastyParser = require('./etastyParser');
const revoluteParser = require('./revoluteParser');
const levestParser = require('./levestParser');
const lipsParser = require('./lipsParser');
const highbuyParser = require('./highbuyParser');
const cloudvaporParser = require('./cloudvaporParser');
const mgvapeParser = require('./mgvapeParser');

// Map supplier.code -> parser module
const parsers = {
  'LCA': lcaParser,
  'Joshnoa': joshnoaParser,
  'GFC FrancoChine': gfcParser,
  'LVP Distribution': lvpParser,
  'Cigaccess': cigaccessParser,
  'Curieux': curieuxParser,
  'Etasty': etastyParser,
  'Revolute - Cosmer': revoluteParser,
  'Levest - Roykin': levestParser,
  'LIPS - French Liquide': lipsParser,
  'Highbuy': highbuyParser,
  'Cloud Vapor': cloudvaporParser,
  'MG Vape': mgvapeParser,
};

module.exports = {
  getParser: (supplierCode) => parsers[supplierCode] || null,
  hasParser: (supplierCode) => !!parsers[supplierCode],
  availableParsers: () => Object.keys(parsers),
  // Fournisseurs « à l'unité » : leur facture liste déjà prix unitaire et quantités
  // en unités (pas de conditionnement par pack). pack_qty doit donc être neutralisé
  // (=1) sur tout le cycle BMS — pas seulement à l'import (pdfImportModel force déjà
  // packQty=1), mais AUSSI à l'envoi (createInBMS) et au prefill prix vérifié
  // (getLastVerifiedPrices), qui sinon re-multiplient le prix par ps.pack_qty et
  // gonflent le montant BMS (bug ×10, ex. Highbuy PO 118412 du 06/08/2026).
  skipsPackQty: (supplierCode) => !!(parsers[supplierCode] && parsers[supplierCode].skipPackQty),
};
