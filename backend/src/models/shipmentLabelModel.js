/**
 * Accès à la table shipment_labels — les étiquettes d'expédition émises.
 *
 * Tout le SQL d'étiquetage est ici, et nulle part ailleurs : les adaptateurs
 * transporteurs ne touchent pas la base, ils parlent à leur API et rendent un
 * PDF. C'est ce qui garantit qu'une étiquette Mondial Relay sera enregistrée,
 * listée et annulée exactement comme une lettre suivie.
 */

const pool = require('../config/database');

// laposte_labels.order_number était en varchar(20) ; shipment_labels garde la
// même largeur. La limite est contrôlée en amont pour rendre une 400 lisible
// plutôt qu'une erreur Postgres.
const ORDER_NUMBER_MAX_LENGTH = 20;

/**
 * Étiquette active existant déjà pour cette commande, tous transporteurs
 * confondus.
 *
 * Volontairement non filtré par transporteur : la règle actée du chantier est
 * « un seul colis par commande ». Une commande déjà étiquetée en lettre suivie
 * ne doit pas repartir en Colissimo sans que le packing s'en aperçoive. Sans
 * effet aujourd'hui, où seule La Poste émet des étiquettes.
 *
 * @param {string|number} orderNumber
 * @returns {Promise<?object>} la ligne, ou null
 */
const findActiveByOrderNumber = async (orderNumber) => {
  const result = await pool.query(
    `SELECT id, carrier_code, account_code, tracking_number, created_at
     FROM shipment_labels
     WHERE order_number = $1 AND status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`,
    [orderNumber]
  );
  return result.rows[0] || null;
};

/**
 * @param {number|string} id
 * @returns {Promise<?object>}
 */
const findById = async (id) => {
  const result = await pool.query('SELECT * FROM shipment_labels WHERE id = $1', [id]);
  return result.rows[0] || null;
};

/**
 * @param {number|string} id
 * @returns {Promise<?{pdf_data: ?string, order_number: string}>}
 */
const findPdfById = async (id) => {
  const result = await pool.query(
    'SELECT pdf_data, order_number FROM shipment_labels WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
};

/**
 * Enregistre une étiquette émise. Le PDF est stocké pour la réimpression :
 * l'API du transporteur ne le rend qu'une fois.
 *
 * @param {object} label
 * @returns {Promise<object>} la ligne créée
 */
const insert = async ({
  carrierCode, accountCode, methodCode, orderNumber, trackingNumber,
  carrierOrderId, weightGrams, packedBy, pdfBase64
}) => {
  const result = await pool.query(
    `INSERT INTO shipment_labels
       (carrier_code, account_code, method_code, order_number, tracking_number,
        carrier_order_id, weight_g, packed_by, pdf_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [carrierCode, accountCode, methodCode || null, orderNumber, trackingNumber,
     carrierOrderId, weightGrams ?? null, packedBy || null, pdfBase64]
  );
  return result.rows[0];
};

/**
 * Les 100 étiquettes les plus récentes, avec le nom du préparateur.
 *
 * @returns {Promise<object[]>}
 */
const listRecent = async (limit = 100) => {
  const result = await pool.query(
    `SELECT l.id, l.carrier_code, l.account_code, l.method_code, l.order_number,
            l.tracking_number, l.carrier_order_id, l.status, l.weight_g,
            l.created_at, l.cancelled_at,
            u.name AS packer_name
     FROM shipment_labels l
     LEFT JOIN users u ON u.id = l.packed_by
     ORDER BY l.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
};

/**
 * @param {number|string} id
 * @returns {Promise<void>}
 */
const markCancelled = async (id) => {
  await pool.query(
    `UPDATE shipment_labels SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1`,
    [id]
  );
};

module.exports = {
  ORDER_NUMBER_MAX_LENGTH,
  findActiveByOrderNumber,
  findById,
  findPdfById,
  insert,
  listRecent,
  markCancelled
};
