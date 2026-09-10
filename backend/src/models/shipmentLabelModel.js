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
 * `cn23` : le transporteur peut rendre une déclaration douanière, qui s'écrit
 * dans la colonne cn23_data (lot 2). Seul ce transporteur-là est bloqué si la
 * colonne manque — la lettre suivie et Mondial Relay n'y écrivent jamais et
 * continuent de tourner si la migration tarde.
 *
 * @param {{cn23?: boolean}} [options]
 * @throws {Error & {statusCode: number}} 500 si la migration n'a pas tourné.
 */
let schemaReady = false;
let cn23Ready = false;
const assertSchemaReady = async ({ cn23 = false } = {}) => {
  if (schemaReady && (!cn23 || cn23Ready)) return;

  const { rows: [etat] } = await pool.query(
    `SELECT to_regclass('public.shipment_labels') IS NOT NULL AS ok,
            EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'shipment_labels' AND column_name = 'cn23_data') AS cn23`
  );

  if (!etat.ok) {
    const err = new Error(
      "Table shipment_labels absente : appliquer la migration " +
      "backend/src/migrations/add_shipment_labels.sql avant de reconstruire le backend"
    );
    err.statusCode = 500;
    throw err;
  }
  schemaReady = true;
  if (etat.cn23) cn23Ready = true;

  if (cn23 && !etat.cn23) {
    const err = new Error(
      "Colonne shipment_labels.cn23_data absente : appliquer la migration " +
      "backend/src/migrations/add_cn23_to_shipment_labels.sql. Aucune étiquette n'a été achetée."
    );
    err.statusCode = 500;
    throw err;
  }
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
 * La CN23 passe par `to_jsonb(l)` et non par son nom de colonne : la
 * réimpression d'une lettre suivie doit continuer de marcher sur une base où la
 * migration du lot 2 n'a pas encore tourné.
 *
 * @returns {Promise<?{pdf_data: ?string, cn23_data: ?string, order_number: string, carrier_code: string}>}
 */
const findPdfById = async (id) => {
  const result = await pool.query(
    `SELECT l.pdf_data, l.order_number, l.carrier_code, to_jsonb(l)->>'cn23_data' AS cn23_data
     FROM shipment_labels l WHERE l.id = $1`,
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
  carrierOrderId, weightGrams, packedBy, pdfBase64, cn23Base64 = null
}) => {
  const colonnes = ['carrier_code', 'account_code', 'method_code', 'order_number', 'tracking_number',
    'carrier_order_id', 'weight_g', 'packed_by', 'pdf_data'];
  const valeurs = [carrierCode, accountCode, methodCode || null, orderNumber, trackingNumber,
    carrierOrderId, weightGrams ?? null, packedBy || null, pdfBase64];

  // La colonne n'est nommée que quand il y a une CN23 : une étiquette sans
  // déclaration s'enregistre à l'identique, migration du lot 2 passée ou non.
  if (cn23Base64) {
    colonnes.push('cn23_data');
    valeurs.push(cn23Base64);
  }

  const result = await pool.query(
    `INSERT INTO shipment_labels (${colonnes.join(', ')})
     VALUES (${valeurs.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING id, carrier_code, account_code, method_code, order_number, tracking_number,
               carrier_order_id, status, weight_g, packed_by, created_at`,
    valeurs
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

/**
 * Étiquettes d'une commande, avec le nom du préparateur.
 *
 * Sert la fiche commande, qui affiche qui a préparé le colis et quand
 * l'étiquette a été émise. BMS ne sait pas recevoir le préparateur — son API de
 * création d'expédition n'a aucun champ pour ça (vérifié sur la spec en ligne le
 * 08/09/2026) — donc notre base est la seule source de cette information.
 *
 * L'étiquette correspondant au numéro de suivi de la commande est remontée en
 * premier : une commande réexpédiée en porte plusieurs, et c'est celle dont le
 * suivi est affiché qui intéresse.
 *
 * @param {string|number} orderNumber
 * @param {?string} trackingNumber - suivi affiché sur la commande, pour trancher
 * @returns {Promise<object[]>} de la plus pertinente à la plus ancienne
 */
const findForOrderNumber = async (orderNumber, trackingNumber = null) => {
  const { rows } = await pool.query(
    `SELECT l.id, l.carrier_code, l.account_code, l.tracking_number, l.status,
            l.weight_g, l.created_at, l.cancelled_at, u.name AS packer_name
     FROM shipment_labels l
     LEFT JOIN users u ON u.id = l.packed_by
     WHERE l.order_number = $1
     ORDER BY (l.tracking_number IS NOT DISTINCT FROM $2) DESC, l.created_at DESC`,
    [String(orderNumber), trackingNumber]
  );
  return rows;
};

module.exports = {
  ORDER_NUMBER_MAX_LENGTH,
  findForOrderNumber,
  assertSchemaReady,
  findActiveByOrderNumber,
  findById,
  findPdfById,
  insert,
  listRecent,
  markCancelled
};
