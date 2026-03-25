const lcaParser = require('./lcaParser');
const joshnoaParser = require('./joshnoaParser');

// Map supplier.code -> parser module
const parsers = {
  'LCA': lcaParser,
  'Joshnoa': joshnoaParser,
};

module.exports = {
  getParser: (supplierCode) => parsers[supplierCode] || null,
  hasParser: (supplierCode) => !!parsers[supplierCode],
  availableParsers: () => Object.keys(parsers),
};
