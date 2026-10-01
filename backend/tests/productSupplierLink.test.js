/**
 * Banc des liens produit × fournisseur (productSupplierLinkModel).
 *
 * Sans base : un faux `db` répond aux requêtes par motif et enregistre ce qui
 * aurait été écrit. `node tests/productSupplierLink.test.js` (ou `npm test`).
 *
 * Ce qui est couvert :
 *   - un fournisseur se choisit pour un PRODUIT : le lien posé sur une déclinaison
 *     est propagé à ses sœurs (cas réel Cartouche Dojo Blast 15K 20mg, 22 parfums) ;
 *   - un parent variable ne porte jamais le lien, seules ses déclinaisons ;
 *   - les déclinaisons non publiées sont écartées, sauf si la cible l'est elle-même
 *     et sauf si aucune n'est publiée (jamais zéro lien) ;
 *   - les sœurs sont CRÉÉES et jamais mises à jour (DO NOTHING) : un upsert
 *     remettrait pack_qty à 1 et multiplierait les prix à l'import ;
 *   - le prix n'est pas recopié sur les sœurs (il varie d'un parfum à l'autre) ;
 *   - une suppression manuelle pose l'exclusion sur TOUTE la famille, même sur les
 *     déclinaisons qui n'avaient pas de lien (sinon le cron BMS les rattache) ;
 *   - un ajout explicite lève l'exclusion.
 */

const assert = require('assert');
const link = require('../src/models/productSupplierLinkModel');

let failures = 0;
// Les cas sont asynchrones : on les empile puis on les joue dans l'ordre, pour que
// les titres de section restent devant leurs résultats.
const queue = [];
const test = (name, fn) => queue.push({ name, fn });
const section = (titre) => queue.push({ titre });

const run = async () => {
  for (const item of queue) {
    if (item.titre) { console.log(item.titre); continue; }
    try {
      await item.fn();
      console.log(`  ok   ${item.name}`);
    } catch (err) {
      failures++;
      console.error(`  FAIL ${item.name}\n       ${err.message}`);
    }
  }
  if (failures > 0) {
    console.error(`\n${failures} test(s) en échec`);
    process.exitCode = 1;
  } else {
    console.log('\nTous les tests passent');
  }
};

/**
 * Faux client PG. `family` = lignes renvoyées par la requête de famille,
 * sous la forme [id, post_status, est_cible].
 */
const fakeDb = ({ targetId, family, cibleType, upserted = {} }) => {
  const log = { clearedExclusions: [], upsert: null, siblings: null, deleted: null, exclusions: null };
  return {
    log,
    query: async (sql, params) => {
      if (sql.includes('ORDER BY CASE WHEN wp_product_id')) {
        return { rows: [{ id: targetId }] };
      }
      if (sql.includes('WITH cible')) {
        return {
          rows: family.map(([id, post_status, est_cible]) => ({
            id, post_status, est_cible: !!est_cible, cible_type: cibleType,
          })),
        };
      }
      if (sql.includes('DELETE FROM product_supplier_exclusions')) {
        log.clearedExclusions.push(params);
        return { rowCount: 0 };
      }
      if (sql.includes('INSERT INTO product_suppliers') && sql.includes('DO UPDATE')) {
        log.upsert = { sql, params };
        return { rows: [{ product_id: params[1], supplier_id: params[0], pack_qty: upserted.pack_qty ?? params[5], min_order_qty: upserted.min_order_qty ?? params[4] }] };
      }
      if (sql.includes('INSERT INTO product_suppliers') && sql.includes('unnest')) {
        log.siblings = { sql, params };
        return { rowCount: params[1].length };
      }
      if (sql.includes('DELETE FROM product_suppliers')) {
        log.deleted = { sql, params };
        return { rowCount: 2, rows: [{ product_id: params[1][0], supplier_id: params[0] }] };
      }
      if (sql.includes('INSERT INTO product_supplier_exclusions')) {
        log.exclusions = { sql, params };
        return { rowCount: params[1].length };
      }
      throw new Error(`Requête non prévue par le banc : ${sql.slice(0, 80)}`);
    },
  };
};

section('Propagation aux déclinaisons sœurs');

// Cartouche Dojo Blast 15K 20mg : on achète « Cerise » (985132) chez LVP,
// les 3 autres parfums publiés doivent suivre.
test('une déclinaison rattache toutes ses sœurs publiées', async () => {
  const db = fakeDb({
    targetId: 985132,
    cibleType: 'variation',
    family: [[985132, 'publish', true], [985133, 'publish'], [985134, 'publish'], [985135, 'publish']],
  });
  const res = await link.link({ supplierId: 36, productId: 985132, db });
  assert.strictEqual(db.log.upsert.params[1], 985132, 'la cible porte les valeurs saisies');
  assert.deepStrictEqual(db.log.siblings.params[1], [985133, 985134, 985135]);
  assert.strictEqual(res.family_size, 4);
  assert.strictEqual(res.propagated, 3);
});

test('les sœurs sont créées, jamais mises à jour (pack_qty préservé)', async () => {
  const db = fakeDb({ targetId: 10, cibleType: 'variation', family: [[10, 'publish', true], [11, 'publish']] });
  await link.link({ supplierId: 1, productId: 10, db });
  assert.ok(db.log.siblings.sql.includes('DO NOTHING'), 'DO NOTHING attendu sur les sœurs');
  assert.ok(!db.log.siblings.sql.includes('DO UPDATE'));
});

test('le prix n\'est pas recopié sur les sœurs, le conditionnement si', async () => {
  const db = fakeDb({ targetId: 10, cibleType: 'variation', family: [[10, 'publish', true], [11, 'publish']], upserted: { pack_qty: 10, min_order_qty: 5 } });
  await link.link({ supplierId: 1, productId: 10, data: { supplier_price: 7.7, pack_qty: 10, min_order_qty: 5 }, db });
  assert.ok(!db.log.siblings.sql.includes('supplier_price'), 'le prix varie d\'un parfum à l\'autre');
  assert.strictEqual(db.log.siblings.params[2], 5, 'min_order_qty héritée de la cible');
  assert.strictEqual(db.log.siblings.params[3], 10, 'pack_qty héritée de la cible');
});

test('un parent variable ne porte pas le lien, ses déclinaisons seulement', async () => {
  const db = fakeDb({
    targetId: 35854,
    cibleType: 'variable',
    family: [[35885, 'publish'], [35886, 'publish'], [35887, 'publish']],
  });
  const res = await link.link({ supplierId: 36, productId: 1209789, db });
  assert.strictEqual(db.log.upsert.params[1], 35885, 'la 1re déclinaison sert de cible');
  assert.deepStrictEqual(db.log.siblings.params[1], [35886, 35887]);
  assert.strictEqual(res.family_size, 3);
});

test('un produit simple reste seul', async () => {
  const db = fakeDb({ targetId: 500, cibleType: 'simple', family: [[500, 'publish', true]] });
  const res = await link.link({ supplierId: 1, productId: 500, db });
  assert.strictEqual(res.family_size, 1);
  assert.strictEqual(db.log.siblings, null, 'aucune propagation');
});

section('Déclinaisons non publiées');

test('les déclinaisons privées sont écartées', async () => {
  const db = fakeDb({
    targetId: 10,
    cibleType: 'variation',
    family: [[10, 'publish', true], [11, 'private'], [12, 'publish'], [13, 'draft']],
  });
  const res = await link.link({ supplierId: 1, productId: 10, db });
  assert.deepStrictEqual(db.log.siblings.params[1], [12]);
  assert.strictEqual(res.family_size, 2);
});

test('une cible privée est quand même liée', async () => {
  const db = fakeDb({
    targetId: 11,
    cibleType: 'variation',
    family: [[10, 'publish'], [11, 'private', true]],
  });
  await link.link({ supplierId: 1, productId: 11, db });
  assert.strictEqual(db.log.upsert.params[1], 11);
  assert.deepStrictEqual(db.log.siblings.params[1], [10]);
});

test('aucune déclinaison publiée : on garde l\'ancien comportement', async () => {
  const db = fakeDb({
    targetId: 35854,
    cibleType: 'variable',
    family: [[11, 'private'], [12, 'private']],
  });
  const res = await link.link({ supplierId: 1, productId: 1209789, db });
  assert.strictEqual(res.family_size, 2, 'mieux vaut deux liens privés que zéro lien');
});

section('Mémoire des suppressions manuelles');

test('retirer un fournisseur exclut toute la famille', async () => {
  const db = fakeDb({
    targetId: 35854,
    cibleType: 'variable',
    family: [[35885, 'publish'], [35886, 'publish'], [35887, 'publish']],
  });
  const res = await link.unlink({ supplierId: 1, productId: 1209789, db });
  assert.deepStrictEqual(db.log.deleted.params[1], [35885, 35886, 35887]);
  assert.deepStrictEqual(db.log.exclusions.params[1], [35885, 35886, 35887],
    'y compris les déclinaisons sans lien, sinon le cron BMS les rattache');
  assert.strictEqual(res.excluded, 3);
});

test('ajouter explicitement lève l\'exclusion de toute la famille', async () => {
  const db = fakeDb({ targetId: 10, cibleType: 'variation', family: [[10, 'publish', true], [11, 'publish']] });
  await link.link({ supplierId: 7, productId: 10, db });
  assert.strictEqual(db.log.clearedExclusions.length, 1);
  assert.strictEqual(db.log.clearedExclusions[0][0], 7);
  assert.deepStrictEqual(db.log.clearedExclusions[0][1], [10, 11]);
});

run();
