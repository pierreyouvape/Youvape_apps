/**
 * Réclamations transporteur : lectures et écritures.
 *
 * Voir services/chronopostClaimService.js pour le déroulé, et
 * migrations/add_carrier_claims.sql pour le schéma.
 */

const pool = require('../config/database');
const { PRODUCTS } = require('../services/claims/chronopostClaims');

/** Jour de départ du contrôle (app_config.chronopost_claims_since). */
const getSince = async () => {
  const { rows: [row] } = await pool.query(
    `SELECT config_value FROM app_config WHERE config_key = 'chronopost_claims_since'`
  );
  return row?.config_value || null;
};

/**
 * Colis Chronopost du compte principal, déposés (bordereau) depuis `fromDay`,
 * d'un produit suivi, pas encore réclamés. Le jour de dépôt est celui du
 * bordereau, en heure de Paris.
 */
const candidates = async (fromDay) => {
  const { rows } = await pool.query(
    `SELECT l.id, l.order_number, l.tracking_number, l.method_code, l.carrier_code, l.account_code,
            l.created_at, l.tracking_state, b.bordereau_number,
            to_char(b.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS deposit_day
       FROM shipment_labels l
       JOIN shipment_bordereaux b ON b.id = l.bordereau_id
      WHERE l.carrier_code = 'chronopost'
        AND l.account_code = 'principal'
        AND l.status = 'active'
        AND NULLIF(l.tracking_number, '') IS NOT NULL
        AND split_part(l.method_code, '-', 1) = ANY($1)
        AND (b.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris')::date >= $2::date
        AND NOT EXISTS (SELECT 1 FROM carrier_claims c WHERE c.label_id = l.id)
      ORDER BY b.created_at, l.id`,
    [Object.keys(PRODUCTS), fromDay]
  );
  return rows;
};

/** Ce que dit la commande : le contenu du colis, et de quoi ouvrir un ticket SAV. */
const loadOrder = async (orderNumber) => {
  const { rows: [row] } = await pool.query(
    `SELECT o.wp_order_id, o.billing_email, o.billing_first_name, o.billing_last_name, o.billing_phone,
            (SELECT string_agg(oi.qty || ' x ' || oi.order_item_name, ', ' ORDER BY oi.id)
               FROM order_items oi
              WHERE oi.wp_order_id = o.wp_order_id AND oi.order_item_type = 'line_item'
                AND COALESCE(oi.line_total, 0) > 0) AS items
       FROM orders o
      WHERE o.wp_order_id = CASE WHEN $1 ~ '^[0-9]{1,18}$' THEN $1::bigint END`,
    [String(orderNumber)]
  );
  return row || null;
};

/**
 * Enregistre un fichier et ses réclamations, d'un bloc : un colis déjà réclamé
 * entre-temps (deux contrôles simultanés) fait échouer le tout plutôt que de
 * partir deux fois.
 */
const createBatch = async ({ carrierCode, fileName, csv, claims, userId }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [batch] } = await client.query(
      `INSERT INTO carrier_claim_batches (carrier_code, claim_count, file_name, csv_data, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [carrierCode, claims.length, fileName, csv, userId || null]
    );
    const saved = [];
    for (const c of claims) {
      const { rows: [row] } = await client.query(
        `INSERT INTO carrier_claims (label_id, batch_id, carrier_code, order_number, tracking_number,
                                     object_code, motif_code, family_code, content, comment, deposit_day, due_day)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [c.labelId, batch.id, carrierCode, c.orderNumber, c.trackingNumber, c.object,
          c.motif || null, c.family || null, c.content || null, c.comment, c.depositDay, c.dueDay]
      );
      saved.push(row);
    }
    await client.query('COMMIT');
    return { batch, claims: saved };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const markMailed = (batchId, error) => pool.query(
  `UPDATE carrier_claim_batches
      SET mailed_at = CASE WHEN $2::text IS NULL THEN NOW() ELSE mailed_at END, mail_error = $2
    WHERE id = $1`,
  [batchId, error || null]
);

const setSavResult = (claimId, ticketId, error) => pool.query(
  'UPDATE carrier_claims SET sav_ticket_id = COALESCE($2, sav_ticket_id), sav_error = $3 WHERE id = $1',
  [claimId, ticketId || null, error || null]
);

/** Réclamations dont la note SAV n'a pas pu être posée (à retenter). */
const pendingSav = async () => {
  const { rows } = await pool.query(
    `SELECT c.*, l.method_code FROM carrier_claims c JOIN shipment_labels l ON l.id = c.label_id
      WHERE c.sav_ticket_id IS NULL AND c.created_at > NOW() - interval '7 days'
      ORDER BY c.id`
  );
  return rows;
};

/** Les fichiers produits, les plus récents d'abord, avec leurs réclamations. */
const listBatches = async (limit = 60) => {
  const { rows } = await pool.query(
    `SELECT b.id, b.carrier_code, b.claim_count, b.file_name, b.mailed_at, b.mail_error,
            b.imported_at, b.created_at, cu.name AS created_by_name, iu.name AS imported_by_name,
            COALESCE(json_agg(json_build_object(
              'id', c.id, 'label_id', c.label_id, 'order_number', c.order_number,
              'tracking_number', c.tracking_number, 'object_code', c.object_code,
              'comment', c.comment, 'deposit_day', c.deposit_day, 'due_day', c.due_day,
              'carrier_ticket', c.carrier_ticket, 'carrier_error', c.carrier_error,
              'sav_ticket_id', c.sav_ticket_id, 'sav_error', c.sav_error,
              'indemnity_status', c.indemnity_status, 'indemnity_at', c.indemnity_at,
              'indemnity_by_name', ku.name
            ) ORDER BY c.id) FILTER (WHERE c.id IS NOT NULL), '[]') AS claims
       FROM carrier_claim_batches b
       LEFT JOIN carrier_claims c ON c.batch_id = b.id
       LEFT JOIN users ku ON ku.id = c.indemnity_by
       LEFT JOIN users cu ON cu.id = b.created_by
       LEFT JOIN users iu ON iu.id = b.imported_by
      GROUP BY b.id, cu.name, iu.name
      ORDER BY b.created_at DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
};

const getBatchFile = async (id) => {
  const { rows: [row] } = await pool.query(
    'SELECT id, file_name, csv_data FROM carrier_claim_batches WHERE id = $1',
    [id]
  );
  return row || null;
};

const claimsOfBatch = async (batchId) => {
  const { rows } = await pool.query('SELECT * FROM carrier_claims WHERE batch_id = $1 ORDER BY id', [batchId]);
  return rows;
};

const setCarrierResult = (claimId, ticket, error) => pool.query(
  'UPDATE carrier_claims SET carrier_ticket = $2, carrier_error = $3 WHERE id = $1',
  [claimId, ticket || null, error || null]
);

const markImported = (batchId, userId) => pool.query(
  'UPDATE carrier_claim_batches SET imported_at = NOW(), imported_by = $2 WHERE id = $1',
  [batchId, userId || null]
);

/** La réclamation d'un colis, pour son panneau. */
const forLabel = async (labelId) => {
  const { rows: [row] } = await pool.query(
    `SELECT c.*, b.file_name, b.imported_at, ku.name AS indemnity_by_name
       FROM carrier_claims c LEFT JOIN carrier_claim_batches b ON b.id = c.batch_id
       LEFT JOIN users ku ON ku.id = c.indemnity_by
      WHERE c.label_id = $1`,
    [labelId]
  );
  return row || null;
};

/**
 * Réponse de Chronopost sur l'indemnisation : 'accepted', 'refused', ou null
 * (annuler un mauvais clic). Rend la réclamation, avec son état d'avant.
 */
const setIndemnity = async (claimId, status, userId) => {
  const { rows: [row] } = await pool.query(
    `WITH before AS (SELECT id, indemnity_status FROM carrier_claims WHERE id = $1)
     UPDATE carrier_claims c
        SET indemnity_status = $2::varchar,
            indemnity_at = CASE WHEN $2::varchar IS NULL THEN NULL ELSE NOW() END,
            indemnity_by = CASE WHEN $2::varchar IS NULL THEN NULL ELSE $3::int END
       FROM before
      WHERE c.id = before.id
     RETURNING c.*, before.indemnity_status AS previous_status`,
    [claimId, status, userId || null]
  );
  return row || null;
};

/**
 * Récapitulatif : réclamations acceptées ou refusées dont la réponse tombe
 * dans la période, ou en attente (créées dans la période, sans réponse).
 * Bornes 'YYYY-MM-DD' en heure de Paris, incluses.
 */
const listIndemnities = async ({ status = 'accepted', from, to }) => {
  const pending = status === 'pending';
  const dateCol = pending ? 'c.created_at' : 'c.indemnity_at';
  const { rows } = await pool.query(
    `SELECT c.id, c.label_id, c.order_number, c.tracking_number, c.object_code, c.carrier_ticket,
            c.deposit_day, c.due_day, c.created_at, c.indemnity_status, c.indemnity_at,
            c.sav_ticket_id, ku.name AS indemnity_by_name
       FROM carrier_claims c
       LEFT JOIN users ku ON ku.id = c.indemnity_by
      WHERE ${pending ? 'c.indemnity_status IS NULL' : 'c.indemnity_status = $3'}
        AND ${dateCol} >= ($1::date::timestamp AT TIME ZONE 'Europe/Paris')
        AND ${dateCol} <  (($2::date + 1)::timestamp AT TIME ZONE 'Europe/Paris')
      ORDER BY ${dateCol} DESC, c.id DESC`,
    pending ? [from, to] : [from, to, status]
  );
  return rows;
};

module.exports = {
  setIndemnity, listIndemnities,
  getSince, candidates, loadOrder, createBatch, markMailed, setSavResult, pendingSav,
  listBatches, getBatchFile, claimsOfBatch, setCarrierResult, markImported, forLabel,
};
