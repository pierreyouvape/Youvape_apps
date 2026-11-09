/**
 * Réclamations de facturation Chronopost : la demande cochée, et son résultat
 * d'après les avoirs et rectificatives reçus (services/claims/billingClaimMatch.js).
 */

const pool = require('../config/database');
const { matchBillingClaim } = require('../services/claims/billingClaimMatch');

const CARRIER = 'chronopost';

const CLAIM_SELECT = `
  SELECT b.id, b.invoice_number, to_char(b.sent_on, 'YYYY-MM-DD') AS sent_on, b.created_at, b.updated_at,
         u.name AS created_by_name, ci.id AS invoice_id, ci.invoice_date
    FROM carrier_billing_claims b
    LEFT JOIN users u ON u.id = b.created_by
    LEFT JOIN carrier_invoices ci ON ci.carrier = b.carrier AND ci.invoice_number = b.invoice_number`;

/** Ajoute à des demandes leurs lignes et leur résultat. */
async function withResults(claims) {
  if (!claims.length) return [];
  const ids = claims.map(c => c.id);
  const numbers = claims.map(c => c.invoice_number);

  const [lines, credits] = await Promise.all([
    // La facture ne porte pas toujours la commande sur un supplément : retrouvée par le n° de suivi
    pool.query(`
      SELECT l.id, l.claim_id, l.kind, l.tracking, l.description, l.claimed_ht, l.billed_ht, l.due_ht,
             l.weight_declared, l.weight_billed,
             COALESCE(l.order_id, (SELECT p.order_id FROM carrier_invoice_parcels p
                                    WHERE UPPER(p.tracking) = UPPER(l.tracking) AND p.order_id IS NOT NULL
                                    LIMIT 1)) AS order_id
        FROM carrier_billing_claim_lines l
       WHERE l.claim_id = ANY($1::int[])
       ORDER BY l.id`, [ids]),
    pool.query(`
      SELECT d.related_invoice_number, c.credit_number, c.tracking, c.order_id, c.description, c.has_weight,
             c.base_ht, c.amount_ht, d.is_indemnity,
             CASE WHEN d.credit_date ~ '^\\d{2}/\\d{2}/\\d{4}$'
                  THEN to_char(to_date(d.credit_date, 'DD/MM/YYYY'), 'YYYY-MM-DD') END AS credit_date
        FROM carrier_invoice_credits c
        JOIN carrier_credit_documents d ON d.carrier = c.carrier AND d.credit_number = c.credit_number
       WHERE c.carrier = $1 AND d.related_invoice_number = ANY($2::text[])
       ORDER BY c.id`, [CARRIER, numbers]),
  ]);

  const trackings = [...new Set(lines.rows.map(l => l.tracking.toUpperCase()))];
  const rectifs = await pool.query(`
    SELECT p.tracking, p.amount_ht, ci.invoice_number
      FROM carrier_invoice_parcels p
      JOIN carrier_invoices ci ON ci.id = p.invoice_id
     WHERE ci.carrier = $1 AND ci.is_rectificative AND UPPER(p.tracking) = ANY($2::text[])
     ORDER BY ci.id DESC`, [CARRIER, trackings]);

  return claims.map(claim => {
    const own = lines.rows.filter(l => l.claim_id === claim.id);
    const set = new Set(own.map(l => l.tracking.toUpperCase()));
    return {
      ...claim,
      ...matchBillingClaim({
        sentOn: claim.sent_on,
        lines: own,
        credits: credits.rows.filter(c => c.related_invoice_number === claim.invoice_number),
        rectifs: rectifs.rows.filter(r => set.has(r.tracking.toUpperCase())),
      }),
    };
  });
}

const list = async (limit = 100) => {
  const { rows } = await pool.query(`${CLAIM_SELECT} WHERE b.carrier = $1 ORDER BY b.sent_on DESC, b.id DESC LIMIT $2`, [CARRIER, limit]);
  return withResults(rows);
};

const getByInvoice = async (invoiceNumber) => {
  const { rows } = await pool.query(`${CLAIM_SELECT} WHERE b.carrier = $1 AND b.invoice_number = $2`, [CARRIER, invoiceNumber]);
  return (await withResults(rows))[0] || null;
};

/** Enregistre la demande d'une facture ; une demande existante est remplacée. */
const save = async ({ invoiceNumber, sentOn, lines, userId }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [claim] } = await client.query(`
      INSERT INTO carrier_billing_claims (carrier, invoice_number, sent_on, created_by)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (carrier, invoice_number)
      DO UPDATE SET sent_on = EXCLUDED.sent_on, updated_at = NOW()
      RETURNING id`, [CARRIER, invoiceNumber, sentOn, userId || null]);
    await client.query('DELETE FROM carrier_billing_claim_lines WHERE claim_id = $1', [claim.id]);
    for (const l of lines) {
      await client.query(`
        INSERT INTO carrier_billing_claim_lines
          (claim_id, kind, tracking, order_id, description, claimed_ht, billed_ht, due_ht, weight_declared, weight_billed)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [claim.id, l.kind, l.tracking, l.order_id || null, l.description || null, l.claimed_ht ?? null,
        l.billed_ht ?? null, l.due_ht ?? null, l.weight_declared ?? null, l.weight_billed ?? null]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return getByInvoice(invoiceNumber);
};

const remove = async (invoiceNumber) => {
  const { rowCount } = await pool.query(
    'DELETE FROM carrier_billing_claims WHERE carrier = $1 AND invoice_number = $2', [CARRIER, invoiceNumber]);
  return rowCount > 0;
};

module.exports = { list, getByInvoice, save, remove };
