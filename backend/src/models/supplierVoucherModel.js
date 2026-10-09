/**
 * Bons de réduction fournisseur « à valoir sur la prochaine commande ».
 *
 * Le cycle de vie d'un bon :
 *   1. on le saisit sur la facture FAUTIVE (montant HT, code s'il est connu,
 *      références dont il rend l'écart) : ces écarts cessent d'être à réclamer ;
 *   2. la facture suivante qui imprime son code (ou, sans code, sa remise au
 *      centime près) le CONSOMME : le montant sort de la remise de pied et n'est
 *      réparti sur aucune ligne (cf. utils/invoiceVouchers) ;
 *   3. supprimer la facture qui l'a consommé le rouvre (ON DELETE SET NULL).
 *
 * Cf. la migration add_supplier_vouchers.sql pour le cas d'origine (LVP
 * F2610289037, 6,25 € HT).
 */

const pool = require('../config/database');

const SELECT_SQL = `
  SELECT v.*, s.name AS supplier_name,
         src.number AS source_number, src.doc_date AS source_date,
         con.number AS consumed_number, con.doc_date AS consumed_date,
         (CURRENT_DATE - src.doc_date) AS age_days
    FROM supplier_vouchers v
    JOIN suppliers s ON s.id = v.supplier_id
    JOIN supplier_documents src ON src.id = v.source_document_id
    LEFT JOIN supplier_documents con ON con.id = v.consumed_document_id`;

/** Références normalisées et dédoublonnées, telles que les lignes les portent. */
const cleanRefs = (refs) => [...new Set((refs || [])
  .map((r) => String(r || '').trim())
  .filter(Boolean))];

const cleanCode = (code) => {
  const c = String(code || '').trim();
  return c || null;
};

async function listVouchers({ supplierId, status } = {}, db = pool) {
  const where = [];
  const params = [];
  if (supplierId) { params.push(supplierId); where.push(`v.supplier_id = $${params.length}`); }
  if (status === 'open') where.push('v.consumed_document_id IS NULL');
  if (status === 'consumed') where.push('v.consumed_document_id IS NOT NULL');
  const { rows } = await db.query(
    `${SELECT_SQL}
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY src.doc_date DESC, v.id DESC`,
    params,
  );
  return rows;
}

async function getVoucher(id, db = pool) {
  const { rows } = await db.query(`${SELECT_SQL} WHERE v.id = $1`, [id]);
  return rows[0] || null;
}

/** Les bons rattachés à un document : ceux qu'il a fait naître, ceux qu'il a consommés. */
async function listForDocument(documentId, db = pool) {
  const { rows } = await db.query(
    `${SELECT_SQL}
     WHERE v.source_document_id = $1 OR v.consumed_document_id = $1
     ORDER BY v.id`,
    [documentId],
  );
  return rows;
}

function invalid(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}

async function createVoucher(documentId, { amountHt, code, coveredRefs, note, userId }, db = pool) {
  const { rows: docs } = await db.query(
    'SELECT id, supplier_id, doc_type FROM supplier_documents WHERE id = $1',
    [documentId],
  );
  const doc = docs[0];
  if (!doc) {
    const e = new Error('Document introuvable');
    e.status = 404;
    throw e;
  }
  if (doc.doc_type !== 'invoice') throw invalid('Un bon de réduction se rattache à une facture');

  const montant = Math.round(Number(amountHt) * 100) / 100;
  if (!(montant > 0)) throw invalid('Montant HT du bon manquant');

  const { rows } = await db.query(
    `INSERT INTO supplier_vouchers (supplier_id, source_document_id, amount_ht, code, covered_refs, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [doc.supplier_id, doc.id, montant, cleanCode(code), cleanRefs(coveredRefs), note || null, userId || null],
  );
  return getVoucher(rows[0].id, db);
}

/**
 * Compléter un bon : le cas normal est d'ajouter le CODE reçu après coup, pour
 * que la facture suivante le reconnaisse.
 */
async function updateVoucher(id, { amountHt, code, coveredRefs, note }, db = pool) {
  const sets = [];
  const params = [id];
  const set = (col, value) => { params.push(value); sets.push(`${col} = $${params.length}`); };

  if (amountHt !== undefined) {
    const montant = Math.round(Number(amountHt) * 100) / 100;
    if (!(montant > 0)) throw invalid('Montant HT du bon invalide');
    set('amount_ht', montant);
  }
  if (code !== undefined) set('code', cleanCode(code));
  if (coveredRefs !== undefined) set('covered_refs', cleanRefs(coveredRefs));
  if (note !== undefined) set('note', note || null);
  if (sets.length === 0) return getVoucher(id, db);

  const { rowCount } = await db.query(
    `UPDATE supplier_vouchers SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    params,
  );
  return rowCount ? getVoucher(id, db) : null;
}

async function deleteVoucher(id, db = pool) {
  const { rows } = await db.query('DELETE FROM supplier_vouchers WHERE id = $1 RETURNING id', [id]);
  return rows[0] || null;
}

/**
 * Les bons qu'une facture de ce fournisseur PEUT consommer : ceux encore à
 * valoir, et ceux qu'elle a déjà consommés (re-contrôle d'une facture rangée).
 * Jamais un bon né de cette facture-ci.
 */
async function candidatesFor({ supplierId, documentId = null, invoiceNumber = null }, db = pool) {
  const { rows } = await db.query(
    `SELECT v.id, v.code, v.amount_ht, src.number AS source_number
       FROM supplier_vouchers v
       JOIN supplier_documents src ON src.id = v.source_document_id
      WHERE v.supplier_id = $1
        AND (v.consumed_document_id IS NULL OR v.consumed_document_id = $2)
        AND v.source_document_id IS DISTINCT FROM $2
        AND src.number IS DISTINCT FROM $3
      ORDER BY src.doc_date, v.id`,
    [supplierId, documentId, invoiceNumber],
  );
  return rows;
}

/**
 * Inscrire ce qu'un document a consommé — et rendre ce qu'il ne consomme plus
 * (le re-contrôle peut défaire un rapprochement au montant, par exemple après
 * qu'on a saisi un code qui ne figure pas sur le document).
 */
async function markConsumed(documentId, voucherIds, db = pool) {
  const ids = (voucherIds || []).map(Number).filter(Number.isFinite);
  await db.query(
    `UPDATE supplier_vouchers
        SET consumed_document_id = NULL, consumed_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE consumed_document_id = $1 AND NOT (id = ANY($2::int[]))`,
    [documentId, ids],
  );
  if (ids.length === 0) return;
  await db.query(
    `UPDATE supplier_vouchers
        SET consumed_document_id = $1, consumed_at = COALESCE(consumed_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ANY($2::int[]) AND source_document_id <> $1
        AND (consumed_document_id IS NULL OR consumed_document_id = $1)`,
    [documentId, ids],
  );
}

module.exports = {
  listVouchers,
  listForDocument,
  getVoucher,
  createVoucher,
  updateVoucher,
  deleteVoucher,
  candidatesFor,
  markConsumed,
};
