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
 * Vérifie une fois par processus que la table d'étiquettes est là.
 *
 * Sert à un cas précis et coûteux : une étiquette achetée chez le transporteur
 * puis impossible à enregistrer. L'argent est dépensé, le numéro de suivi
 * perdu, et personne ne le sait. La génération depuis le packing touche la base
 * avant d'appeler le transporteur (contrôle de doublon), donc elle échoue seule ;
 * l'expédition manuelle, elle, n'a aucun contrôle de doublon — d'où ce garde-fou,
 * appelé avant tout appel transporteur.
 *
 * Le résultat est mémorisé : une requête par vie du processus, pas par colis.
 *
 * @throws {Error & {statusCode: number}} 500 si la migration n'a pas tourné.
 */
let schemaReady = false;
const assertSchemaReady = async () => {
  if (schemaReady) return;

  const { rows } = await pool.query(
    `SELECT to_regclass('public.shipment_labels') IS NOT NULL AS ok`
  );

  if (!rows[0].ok) {
    const err = new Error(
      "Table shipment_labels absente : appliquer la migration " +
      "backend/src/migrations/add_shipment_labels.sql avant de reconstruire le backend"
    );
    err.statusCode = 500;
    throw err;
  }

  schemaReady = true;
};

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
 * Le transporteur est rendu avec : la réimpression doit renommer le fichier
 * selon sa convention, sinon AutoPrint l'envoie sur la mauvaise imprimante.
 *
 * @returns {Promise<?{pdf_data: ?string, order_number: string, carrier_code: string}>}
 */
const findPdfById = async (id) => {
  const result = await pool.query(
    'SELECT pdf_data, order_number, carrier_code FROM shipment_labels WHERE id = $1',
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
  assertSchemaReady,
  findActiveByOrderNumber,
  findById,
  findPdfById,
  insert,
  listRecent,
  markCancelled
};
