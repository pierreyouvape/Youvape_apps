const lcaParser = require('./lcaParser');

// Map supplier.code -> parser module
const parsers = {
  'LCA': lcaParser,
};

module.exports = {
  getParser: (supplierCode) => parsers[supplierCode] || null,
  hasParser: (supplierCode) => !!parsers[supplierCode],
  availableParsers: () => Object.keys(parsers),
};
