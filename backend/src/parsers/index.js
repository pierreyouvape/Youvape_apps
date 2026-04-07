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
};

module.exports = {
  getParser: (supplierCode) => parsers[supplierCode] || null,
  hasParser: (supplierCode) => !!parsers[supplierCode],
  availableParsers: () => Object.keys(parsers),
};
