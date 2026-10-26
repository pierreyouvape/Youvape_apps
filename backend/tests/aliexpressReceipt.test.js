/**
 * Lecture du récapitulatif AliExpress (pré-remplissage du dépôt manuel).
 * Fixture = texte brut de l'OCR d'une vraie capture (commande 3077545413325687).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseAliexpressReceipt, montant, dateIso } = require('../src/parsers/invoices/aliexpressReceipt');

const ocr = fs.readFileSync(path.join(__dirname, 'fixtures/aliexpress_ocr_3077545413325687.txt'), 'utf8');
const r = parseAliexpressReceipt(ocr);
// Total frais d'importation compris, et surtout pas le sous-total.
assert.deepStrictEqual(r, { number: '3077545413325687', date: '2026-10-26', totalTtc: 148.39, totalTva: null });

// Libellés anglais, TVA imprimée, € devant.
assert.deepStrictEqual(
  parseAliexpressReceipt('Order ID 8123456789012345\nOrder time: Feb 3, 2026\nSubtotal: €10.00\nVAT: €2.00\nTotal: €12.00'),
  { number: '8123456789012345', date: null, totalTtc: 12, totalTva: 2 },
);

assert.strictEqual(montant('1 234,56 €'), 1234.56);
assert.strictEqual(montant('EUR 148.39'), 148.39);
assert.strictEqual(dateIso('3 févr. 2026'), '2026-02-03');
assert.strictEqual(dateIso('26/10/2026'), '2026-10-26');

// Rien de reconnaissable : tout à null, rien d'inventé.
assert.deepStrictEqual(parseAliexpressReceipt('facture quelconque'), { number: null, date: null, totalTtc: null, totalTva: null });

console.log('aliexpressReceipt.test.js : OK');
