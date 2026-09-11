/**
 * Conversion d'une ligne d'import fournisseur selon le conditionnement de la RÉF.
 *
 * Sans dépendance ni base : `node tests/importLineConversion.test.js` (ou `npm test`).
 *
 * Depuis le 11/09/2026, un produit peut avoir plusieurs réfs chez un même
 * fournisseur (unité, pack de 50, promo…) : la quantité et le prix du document sont
 * exprimés dans le pack de la réf, la ligne de commande dans l'unité attendue par
 * BMS. Une erreur ici met en stock 50 fois trop (ou pas assez) sans aucun message.
 */

const assert = require('assert');
const { convertLine } = require('../src/utils/importLineConversion');
const cigaccessParser = require('../src/parsers/cigaccessParser');

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}
const close = (a, b) => Math.abs(a - b) < 1e-9;

console.log('\nConversion des lignes d\'import (conditionnement de la réf.)');

test('réf. inconnue : quantité et prix du document repris tels quels', () => {
  const l = convertLine({ docQty: 4, docPrice: 2.5, refPack: 1, refPrice: null, bmsPack: 1, conversion: {} });
  assert.strictEqual(l.qtyOrdered, 4);
  assert.strictEqual(l.pdfGross, 2.5);
  assert.strictEqual(l.packQty, 1);
  assert.strictEqual(l.dbPrice, null);
});

test('cas général, réf. pack de 50 : la ligne passe en unités, le montant est conservé', () => {
  const l = convertLine({ docQty: 2, docPrice: 11.5, refPack: 50, refPrice: 11.5, bmsPack: 1, conversion: {} });
  assert.strictEqual(l.qtyOrdered, 100);
  assert.ok(close(l.pdfGross, 0.23));
  assert.ok(close(l.dbPrice, 0.23));
  assert.ok(close(l.qtyOrdered * l.pdfGross, 2 * 11.5));
});

test('fournisseur compté en packs BMS, réf. reprise (pack réf. = pack BMS) : aucun changement', () => {
  const l = convertLine({ docQty: 3, docPrice: 8.7, refPack: 10, refPrice: 8.7, bmsPack: 10, conversion: { skipPackQty: true } });
  assert.strictEqual(l.packQty, 1);
  assert.strictEqual(l.qtyOrdered, 3);
  assert.strictEqual(l.pdfGross, 8.7);
  assert.strictEqual(l.dbPrice, 8.7);
  assert.strictEqual(l.packWarning, null);
});

test('fournisseur compté en packs BMS, réf. pack de 50 / BMS pack de 10 : 5 packs BMS par article', () => {
  const l = convertLine({ docQty: 2, docPrice: 40, refPack: 50, refPrice: 40, bmsPack: 10, conversion: { skipPackQty: true } });
  assert.strictEqual(l.qtyOrdered, 10);          // 100 unités = 10 packs BMS de 10
  assert.ok(close(l.pdfGross, 8));               // prix d'un pack BMS
  assert.ok(close(l.dbPrice, 8));
  assert.ok(close(l.qtyOrdered * l.pdfGross, 2 * 40));
});

test('packs BMS qui ne tombent pas juste : quantité laissée telle quelle ET signalée', () => {
  const l = convertLine({ docQty: 3, docPrice: 5, refPack: 5, refPrice: null, bmsPack: 10, conversion: { skipPackQty: true } });
  assert.strictEqual(l.qtyOrdered, 3);
  assert.strictEqual(l.packQty, 1);
  assert.ok(l.packWarning && l.packWarning.includes('pack de 10'));
});

test('document déjà en unités (invertPackQty) : quantité et prix intacts, prix réf. ramené à l\'unité', () => {
  const l = convertLine({ docQty: 30, docPrice: 0.9, refPack: 10, refPrice: 9, bmsPack: 1, conversion: { invertPackQty: true } });
  assert.strictEqual(l.qtyOrdered, 30);
  assert.strictEqual(l.pdfGross, 0.9);
  assert.ok(close(l.dbPrice, 0.9));
});

test('prix retenu : le document s\'il est moins cher, la base sinon ; toujours le document si trustPdfPrice', () => {
  const cheaper = convertLine({ docQty: 1, docPrice: 4, refPack: 1, refPrice: 5, bmsPack: 1, conversion: {} });
  assert.strictEqual(cheaper.unitPrice, 4);
  const dearer = convertLine({ docQty: 1, docPrice: 6, refPack: 1, refPrice: 5, bmsPack: 1, conversion: {} });
  assert.strictEqual(dearer.unitPrice, 5);
  const trusted = convertLine({ docQty: 1, docPrice: 6, refPack: 1, refPrice: 5, bmsPack: 1, conversion: { trustPdfPrice: true } });
  assert.strictEqual(trusted.unitPrice, 6);
});

test('remise de ligne appliquée au prix net', () => {
  const l = convertLine({ docQty: 1, docPrice: 10, discountPercent: 15, refPack: 1, refPrice: null, bmsPack: 1, conversion: {} });
  assert.ok(close(l.pdfNet, 8.5));
  assert.ok(close(l.unitPrice, 8.5));
});

console.log('\nCigaccess — confirmation de commande');

test('la réf. d\'une déclinaison est lue en entier, pas ramenée à la réf. parent', () => {
  const text = [
    'Commande n°IEBHLRTQR du 07/04/2026',
    'Produit', 'Quantité', 'Prix unitaire', 'Prix total',
    'DotAio V3', 'Royal Blue',
    'Référence: 012861-1-Ro',
    '2 74,90 € 149,80 €',
    'Résistances DotCoil',
    'Référence: 009898',
    '5 9,90 € 49,50 €',
  ].join('\n');
  const parsed = cigaccessParser.parse(text);
  assert.deepStrictEqual(parsed.items.map(i => i.supplier_sku), ['012861-1-Ro', '009898']);
  assert.deepStrictEqual(parsed.items.map(i => i.qty_ordered), [2, 5]);
});

if (failures > 0) {
  console.log(`\n${failures} test(s) en échec.`);
  process.exit(1);
}
console.log('\nTous les tests passent.');
