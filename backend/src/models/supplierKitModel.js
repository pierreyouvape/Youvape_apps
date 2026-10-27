/**
 * Packs d'un fournisseur : une référence facturée qui contient plusieurs articles.
 *
 * Une réf. de `supplier_refs` désigne UN produit, et son `pack_qty` compte des
 * pièces de ce même produit. Un pack d'offre (JoshNoa josh00045997 : un de
 * chacun de quatre parfums) n'y entre pas : c'est cette table qui le décrit,
 * et `utils/invoiceKits` qui le découpe au contrôle de facture.
 *
 * Les composants se désignent par LEUR réf. chez ce fournisseur — celle que la
 * commande porte et que le rapprochement compare. Elle doit exister dans
 * `supplier_refs` au moment de la déclaration : un composant inconnu ne
 * retrouverait aucune ligne de commande et le pack resterait une anomalie.
 */

const pool = require('../config/database');
const supplierRefModel = require('./supplierRefModel');

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Tous les packs du fournisseur, composants compris, pour l'écran. */
async function listKits(supplierId, db = pool) {
  const { rows } = await db.query(
    `SELECT k.kit_ref, k.label, k.component_ref, k.qty, r.product_id, p.post_title, p.sku
       FROM supplier_ref_kits k
       LEFT JOIN supplier_refs r
              ON r.supplier_id = k.supplier_id
             AND ${supplierRefModel.normalizedSql('r.supplier_sku')} = ${supplierRefModel.normalizedSql('k.component_ref')}
       LEFT JOIN products p ON p.id = r.product_id
      WHERE k.supplier_id = $1
      ORDER BY k.kit_ref, k.id`,
    [supplierId],
  );
  const parRef = new Map();
  for (const r of rows) {
    const cle = norm(r.kit_ref);
    if (!parRef.has(cle)) parRef.set(cle, { ref: r.kit_ref, label: r.label || null, components: [] });
    parRef.get(cle).components.push({
      ref: r.component_ref,
      qty: Number(r.qty) || 1,
      productId: r.product_id || null,
      label: r.post_title || null,
      sku: r.sku || null,
    });
  }
  return [...parRef.values()];
}

/** Réf. du pack normalisée → pack, la forme qu'attend `explodeKits`. */
async function kitMap(supplierId, db = pool) {
  const kits = await listKits(supplierId, db);
  return new Map(kits.map((k) => [norm(k.ref), k]));
}

/**
 * Déclarer (ou redéfinir) un pack. Remplace ses composants en une transaction :
 * une offre qui change de contenu d'un mois à l'autre n'a pas à garder l'ancien.
 */
async function saveKit({ supplierId, kitRef, label, components, userId = null }, db = pool) {
  const ref = String(kitRef || '').trim();
  if (!ref) throw Object.assign(new Error('Référence du pack manquante'), { status: 400 });
  const liste = (Array.isArray(components) ? components : [])
    .map((c) => ({ ref: String(c.ref || '').trim(), qty: Number(String(c.qty ?? 1).replace(',', '.')) }))
    .filter((c) => c.ref);
  if (liste.length < 2) {
    throw Object.assign(new Error('Un pack contient au moins deux références'), { status: 400 });
  }
  const invalides = liste.filter((c) => !(c.qty > 0));
  if (invalides.length) {
    throw Object.assign(new Error(`Quantité invalide pour ${invalides.map((c) => c.ref).join(', ')}`), { status: 400 });
  }
  if (liste.some((c) => norm(c.ref) === norm(ref))) {
    throw Object.assign(new Error('Un pack ne peut pas se contenir lui-même'), { status: 400 });
  }
  const doublons = liste.filter((c, i) => liste.findIndex((x) => norm(x.ref) === norm(c.ref)) !== i);
  if (doublons.length) {
    throw Object.assign(new Error(`Référence en double : ${doublons.map((c) => c.ref).join(', ')} (indique plutôt la quantité)`), { status: 400 });
  }

  const { rows: connues } = await db.query(
    `SELECT supplier_sku, ${supplierRefModel.normalizedSql('supplier_sku')} AS norm
       FROM supplier_refs
      WHERE supplier_id = $1
        AND ${supplierRefModel.normalizedSql('supplier_sku')} = ANY($2)`,
    [supplierId, liste.map((c) => norm(c.ref))],
  );
  const parNorm = new Map(connues.map((r) => [r.norm, r.supplier_sku]));
  const inconnues = liste.filter((c) => !parNorm.has(norm(c.ref)));
  if (inconnues.length) {
    throw Object.assign(
      new Error(`Réf. inconnue de ce fournisseur : ${inconnues.map((c) => c.ref).join(', ')}`),
      { status: 422 },
    );
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM supplier_ref_kits
        WHERE supplier_id = $1 AND ${supplierRefModel.normalizedSql('kit_ref')} = $2`,
      [supplierId, norm(ref)],
    );
    for (const c of liste) {
      await client.query(
        `INSERT INTO supplier_ref_kits (supplier_id, kit_ref, label, component_ref, qty, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        // La réf. telle qu'elle est en base : c'est elle que la commande porte.
        [supplierId, ref, label ? String(label).trim() : null, parNorm.get(norm(c.ref)), c.qty, userId],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return (await listKits(supplierId, db)).find((k) => norm(k.ref) === norm(ref)) || null;
}

async function deleteKit(supplierId, kitRef, db = pool) {
  const { rowCount } = await db.query(
    `DELETE FROM supplier_ref_kits
      WHERE supplier_id = $1 AND ${supplierRefModel.normalizedSql('kit_ref')} = $2`,
    [supplierId, norm(kitRef)],
  );
  return rowCount;
}

module.exports = { listKits, kitMap, saveKit, deleteKit };
