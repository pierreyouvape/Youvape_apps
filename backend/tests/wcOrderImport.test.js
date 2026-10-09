/**
 * Banc de l'import d'une commande depuis l'API REST WooCommerce.
 *
 * Sans dépendance ni base : `node tests/wcOrderImport.test.js` (ou `npm test`).
 *
 * `toSyncPayload` doit rendre exactement ce que yousync (`Data_Fetcher::get_order`)
 * aurait envoyé, puisque l'écriture passe par `wcSyncService.processOrder`.
 * La commande type reprend la forme de la 1267765 (09/10/2026, perdue par
 * yousync), données personnelles remplacées.
 */

const assert = require('assert');
const { toSyncPayload } = require('../src/services/wcOrderImportService');

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

const wcOrder = () => ({
  id: 1267765,
  number: '1267765',
  status: 'processing',
  currency: 'EUR',
  date_created: '2026-10-09T11:02:25',
  date_created_gmt: '2026-10-09T09:02:25',
  date_modified: '2026-10-09T11:02:43',
  date_completed: null,
  date_paid: '2026-10-09T11:02:43',
  discount_total: '16.05',
  shipping_total: '0.00',
  total: '37.38',
  total_tax: '6.23',
  customer_id: 0,
  payment_method: 'mollie_wc_gateway_bancontact',
  payment_method_title: 'Bancontact',
  transaction_id: 'tr_test',
  customer_note: '',
  billing: {
    first_name: 'Jean', last_name: 'Test', company: '', address_1: '1 rue Test', address_2: '',
    city: 'Mons', postcode: '7000', country: 'BE', email: 'jean@example.com', phone: '+32000000000'
  },
  shipping: {
    first_name: 'Jean', last_name: 'Test', address_1: '1 rue Test', address_2: '',
    city: 'Mons', postcode: '7000', country: 'BE'
  },
  meta_data: [
    { key: '_wc_order_attribution_source_type', value: 'typein' },
    { key: '_wc_order_attribution_session_pages', value: '7' },
    { key: '_wc_order_attribution_utm_campaign', value: '' },
    {
      key: '_wms_mondial_relay_pickup_info',
      value: {
        pickup_id: '041281', pickup_name: 'LOCKER 24/7', pickup_address: '88 RUE DE LA PERCHE',
        pickup_city: 'COLFONTAINE', pickup_zipcode: '7340', pickup_country: 'BE',
        pickup_provider: 'mondial_relay', shipping_method: 'mondial_relay_lockers'
      }
    },
    { key: '_mollie_payment_id', value: 'tr_test' },
    { key: '_mollie_paid_and_processed', value: '1' }
  ],
  line_items: [{
    id: 1236324, name: 'Green Apple Peach Salt', product_id: 1206962, variation_id: 0, quantity: 14,
    tax_class: '', subtotal: '47.20', subtotal_tax: '9.44', total: '31.15', total_tax: '6.23',
    taxes: [{ id: 2, total: '6.23', subtotal: '9.44' }], sku: '1206962',
    meta_data: [
      { key: '_advanced_woo_discount_item_total_discount', value: { initial_price: 5.9 } },
      { key: '_wc_cog_item_cost', value: '1.35' }
    ]
  }],
  shipping_lines: [{ id: 1236325, method_title: 'Mondial Relay - Lockers', method_id: 'mondial_relay_lockers', total: '0.00' }],
  tax_lines: [{ id: 1236323, rate_code: 'BE-TVA 20%-2', rate_id: 2, label: 'TVA 20%', compound: false, tax_total: '6.23', shipping_tax_total: '0.00' }],
  coupon_lines: [{ id: 1236326, code: 'yvp-e5z-3cy', discount: '16.05', discount_tax: '3.21' }],
  fee_lines: []
});

console.log('Import WooCommerce → payload yousync');

test('dates en heure de Paris (date_created, pas date_created_gmt)', () => {
  const p = toSyncPayload(wcOrder());
  assert.strictEqual(p.date_created, '2026-10-09 11:02:25');
  assert.strictEqual(p.date_paid, '2026-10-09 11:02:43');
  assert.strictEqual(p.date_completed, null);
});

test('statut sans préfixe (processOrder ajoute « wc- »), invité → customer_id null', () => {
  const p = toSyncPayload(wcOrder());
  assert.strictEqual(p.status, 'processing');
  assert.strictEqual(p.customer_id, null);
  assert.strictEqual(p.customer_email, 'jean@example.com');
});

test('ce dont le Picking a besoin : méthode de livraison et point relais', () => {
  const p = toSyncPayload(wcOrder());
  assert.strictEqual(p.shipping_method, 'Mondial Relay - Lockers');
  assert.deepStrictEqual(p.relay_point, {
    network: 'mondial_relay', id: '041281', name: 'LOCKER 24/7', address: '88 RUE DE LA PERCHE',
    postcode: '7340', city: 'COLFONTAINE', country: 'BE', type: null, service: 'mondial_relay_lockers'
  });
});

test('point relais Colissimo : fiche JSON en chaîne', () => {
  const o = wcOrder();
  o.meta_data = [
    { key: '_lpc_meta_pickUpLocationId', value: '123456' },
    { key: '_lpc_meta_pickUpLocationLabel', value: 'Tabac du centre' },
    { key: '_lpc_meta_pickUpProductCode', value: 'A2P' },
    { key: '_lpc_meta_pickUpLocationData', value: JSON.stringify({ adresse1: '2 place', codePostal: '75001', localite: 'PARIS', codePays: 'FR' }) }
  ];
  const p = toSyncPayload(o);
  assert.deepStrictEqual(p.relay_point, {
    network: 'colissimo', id: '123456', name: 'Tabac du centre', address: '2 place',
    postcode: '75001', city: 'PARIS', country: 'FR', type: 'A2P', service: null
  });
});

test('sans point relais → null', () => {
  const o = wcOrder();
  o.meta_data = [];
  assert.strictEqual(toSyncPayload(o).relay_point, null);
});

test('montants en nombres, TVA produits + livraison, coupon', () => {
  const p = toSyncPayload(wcOrder());
  assert.strictEqual(p.total, 37.38);
  assert.strictEqual(p.discount_total, 16.05);
  assert.deepStrictEqual(p.tax_items, [{
    item_id: 1236323, rate_code: 'BE-TVA 20%-2', rate_id: 2, label: 'TVA 20%', compound: false,
    tax_amount: 6.23, shipping_tax_amount: 0
  }]);
  assert.deepStrictEqual(p.coupon_items, [{ item_id: 1236326, name: 'yvp-e5z-3cy', discount_amount: 16.05, discount_tax: 3.21 }]);
});

test('ligne produit : taxes reconstruites, coût et remise repris des métas', () => {
  const [item] = toSyncPayload(wcOrder()).items;
  assert.strictEqual(item.item_id, 1236324);
  assert.strictEqual(item.quantity, 14);
  assert.strictEqual(item.total, 31.15);
  assert.strictEqual(item.tax, 6.23);
  assert.strictEqual(item.line_subtotal_tax, 9.44);
  assert.deepStrictEqual(item.line_tax_data, { total: { 2: '6.23' }, subtotal: { 2: '9.44' } });
  assert.strictEqual(item.item_cost, 1.35);
  assert.deepStrictEqual(item.advanced_discount, { initial_price: 5.9 });
  assert.strictEqual(item.product_attributes, null);
});

test('déclinaison : attributs au format get_variation_attributes()', () => {
  const o = wcOrder();
  o.line_items[0].variation_id = 1206999;
  o.line_items[0].meta_data.push({ key: 'pa_taux-de-nicotine', value: '20mg' });
  const [item] = toSyncPayload(o).items;
  assert.deepStrictEqual(item.product_attributes, { 'attribute_pa_taux-de-nicotine': '20mg' });
});

test('attribution et Mollie : métas vides → null, compteurs en entiers', () => {
  const p = toSyncPayload(wcOrder());
  assert.strictEqual(p.attribution.source_type, 'typein');
  assert.strictEqual(p.attribution.utm_campaign, null);
  assert.strictEqual(p.attribution.session_pages, 7);
  assert.strictEqual(p.payment_meta.transaction_id, 'tr_test');
  assert.strictEqual(p.payment_meta.mollie_paid_and_processed, true);
});

if (failures) {
  console.log(`\n${failures} échec(s)`);
  process.exit(1);
}
console.log('\nTous les tests passent');
