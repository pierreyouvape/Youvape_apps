/**
 * Appliquer un tarif relevé à la commande qu'il vient de payer.
 *
 * Sans base : un faux `db` répond aux quatre requêtes du modèle et enregistre ce
 * qui est écrit. Ce qu'on protège ici a un prix en euros :
 *
 *   • le FIFO lit `unit_price / units_per_qty` — écrire un prix de PIÈCE dans
 *     une ligne comptée en PACKS valorise le lot units_per_qty fois trop bas ;
 *   • `discount_percent` est appliqué PAR-DESSUS — le prix réellement payé
 *     contient déjà la remise, la laisser en place la compterait deux fois ;
 *   • un tarif que la commande ne porte pas est retenu quand même, mais le dit :
 *     afficher « Appliqué » sur un FIFO resté au prix commandé serait pire que
 *     de ne rien faire.
 *
 * `unit_price` étant un NUMERIC(10,2), le prix écrit est arrondi au centime de
 * l'unité de ligne. C'est la précision de la colonne, pas un choix d'ici.
 */

const assert = require('assert');
const supplierDocumentModel = require('../src/models/supplierDocumentModel');

let failures = 0;
function test(name, fn) {
  return fn().then(
    () => console.log(`  ok   ${name}`),
    (err) => { failures++; console.error(`  FAIL ${name}\n       ${err.message}`); },
  );
}

/** Faux `db` : aiguille sur le texte SQL, garde la trace des écritures. */
function fakeDb({ order, refs, items }) {
  const ecrites = [];
  const db = {
    ecrites,
    query: async (sql, params) => {
      const q = sql.replace(/\s+/g, ' ').trim();

      if (q.startsWith('SELECT po.id')) return { rows: order ? [order] : [] };

      if (q.startsWith('SELECT r.*')) {
        const cle = String(params[1]).toLowerCase();
        const r = refs.find((x) => x.supplier_sku.toLowerCase() === cle);
        return { rows: r ? [r] : [] };
      }

      if (q.startsWith('UPDATE supplier_refs')) {
        ecrites.push({ table: 'supplier_refs', packPrice: params[2] });
        const r = refs.find((x) => x.id === params[1]);
        return { rows: [{ supplier_sku: r.supplier_sku, pack_qty: r.pack_qty, pack_price: params[2] }] };
      }

      if (q.startsWith('SELECT id, unit_price')) {
        const cle = String(params[1]).toLowerCase().trim();
        return { rows: items.filter((i) => i.supplier_sku.toLowerCase().trim() === cle) };
      }

      if (q.startsWith('UPDATE purchase_order_items')) {
        ecrites.push({ table: 'purchase_order_items', id: params[0], unitPrice: params[1], sql: q });
        return { rows: [{ unit_price: params[1] }] };
      }

      throw new Error(`requête non prévue : ${q.slice(0, 60)}`);
    },
  };
  return db;
}

const commande = { id: 9342, bms_reference: 'S04795', order_number: 'S04795', units_received: 0 };

console.log('\nAppliquer un tarif à la commande');

(async () => {
  await test('le prix payé remplace le prix commandé, et la remise de ligne est neutralisée', async () => {
    const db = fakeDb({
      order: commande,
      refs: [{ id: 1, supplier_sku: 'SVA-ARASUP', pack_qty: 1, pack_price: 1.5 }],
      items: [{ id: 217524, supplier_sku: 'SVA-ARASUP', unit_price: 1.5, units_per_qty: 1, discount_percent: 15 }],
    });
    const r = await supplierDocumentModel.applyTariffs(
      7, 9342, [{ ref: 'SVA-ARASUP', realPrice: 1.4652, packQty: 1 }], db,
    );

    const ligne = db.ecrites.find((e) => e.table === 'purchase_order_items');
    assert.strictEqual(ligne.unitPrice, 1.47, `unit_price ${ligne.unitPrice}`);
    // Sans ça, le FIFO retirerait encore 15 % d'un prix qui les contient déjà.
    assert.ok(/discount_percent = 0/.test(ligne.sql), 'discount_percent non remis à zéro');
    assert.strictEqual(r.applied[0].orderLine.previous, 1.5);
    assert.strictEqual(r.applied[0].orderLine.price, 1.47);
  });

  await test('une ligne comptée en packs reçoit le prix DU PACK, pas celui de la pièce', async () => {
    const db = fakeDb({
      order: commande,
      // La facture donne 2,00 € la pièce ; la ligne est comptée par cartons de 10.
      refs: [{ id: 2, supplier_sku: 'CARTON-10', pack_qty: 1, pack_price: 20 }],
      items: [{ id: 500, supplier_sku: 'CARTON-10', unit_price: 21, units_per_qty: 10, discount_percent: 0 }],
    });
    await supplierDocumentModel.applyTariffs(
      7, 9342, [{ ref: 'CARTON-10', realPrice: 2, packQty: 1 }], db,
    );
    const ligne = db.ecrites.find((e) => e.table === 'purchase_order_items');
    assert.strictEqual(ligne.unitPrice, 20, `unit_price ${ligne.unitPrice}`);
  });

  await test("le prix du pack est arrondi au centime, jamais au-delà d'un demi-centime", async () => {
    const db = fakeDb({
      order: commande,
      refs: [{ id: 3, supplier_sku: 'IMPAIR-3', pack_qty: 1, pack_price: 1 }],
      // 1,004 € la pièce × 3 = 3,012 € le pack, que NUMERIC(10,2) ramène à 3,01.
      items: [{ id: 501, supplier_sku: 'IMPAIR-3', unit_price: 3, units_per_qty: 3, discount_percent: 0 }],
    });
    await supplierDocumentModel.applyTariffs(
      7, 9342, [{ ref: 'IMPAIR-3', realPrice: 1.004, packQty: 1 }], db,
    );
    const ligne = db.ecrites.find((e) => e.table === 'purchase_order_items');
    assert.strictEqual(ligne.unitPrice, 3.01, `unit_price ${ligne.unitPrice}`);
  });

  await test("un tarif absent de la commande est retenu, mais la commande le dit", async () => {
    const db = fakeDb({
      order: commande,
      refs: [{ id: 4, supplier_sku: 'AILLEURS', pack_qty: 1, pack_price: 5 }],
      items: [],
    });
    const r = await supplierDocumentModel.applyTariffs(
      7, 9342, [{ ref: 'AILLEURS', realPrice: 4.5, packQty: 1 }], db,
    );
    assert.strictEqual(db.ecrites.filter((e) => e.table === 'supplier_refs').length, 1);
    assert.strictEqual(r.applied[0].orderLine.skipped, 'ligne absente de la commande');
  });

  await test('une commande déjà reçue est signalée, pas refusée', async () => {
    const db = fakeDb({
      order: { ...commande, units_received: 134 },
      refs: [{ id: 5, supplier_sku: 'SVA-ARASUP', pack_qty: 1, pack_price: 1.5 }],
      items: [{ id: 217524, supplier_sku: 'SVA-ARASUP', unit_price: 1.5, units_per_qty: 1, discount_percent: 0 }],
    });
    const r = await supplierDocumentModel.applyTariffs(
      7, 9342, [{ ref: 'SVA-ARASUP', realPrice: 1.4652, packQty: 1 }], db,
    );
    assert.strictEqual(r.order.alreadyReceived, true);
    assert.strictEqual(db.ecrites.filter((e) => e.table === 'purchase_order_items').length, 1);
  });

  await test("une commande d'un autre fournisseur est refusée", async () => {
    const db = fakeDb({ order: null, refs: [], items: [] });
    await assert.rejects(
      () => supplierDocumentModel.applyTariffs(7, 9999, [{ ref: 'X', realPrice: 1, packQty: 1 }], db),
      /Commande introuvable/,
    );
  });

  console.log(failures === 0 ? '\nTous les tests passent.' : `\n${failures} test(s) en échec.`);
  process.exit(failures === 0 ? 0 : 1);
})();
