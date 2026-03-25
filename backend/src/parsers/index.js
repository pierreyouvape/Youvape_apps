const lcaParser = require('./lcaParser');
const joshnoaParser = require('./joshnoaParser');
const gfcParser = require('./gfcParser');

// Map supplier.code -> parser module
const parsers = {
  'LCA': lcaParser,
  'Joshnoa': joshnoaParser,
  'GFC FrancoChine': gfcParser,
};

module.exports = {
  getParser: (supplierCode) => parsers[supplierCode] || null,
  hasParser: (supplierCode) => !!parsers[supplierCode],
  availableParsers: () => Object.keys(parsers),
};
