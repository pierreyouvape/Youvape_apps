/**
 * Accès à la table shipment_bordereaux — les bordereaux de dépôt émis.
 *
 * Un bordereau est le papier que le chauffeur signe en emportant les colis. Il
 * a deux propriétés qui commandent tout ce fichier :
 *
 *   1. **Il n'est rendu qu'une fois.** Aucune API ne sait relire un bordereau
 *      déjà produit — ni Colissimo, ni le plugin officiel, qui stocke lui aussi
 *      le PDF dans sa base. D'où `pdf_data` : c'est la seule copie.
 *   2. **Un colis n'y figure qu'une fois.** Le lien vit dans
 *      `shipment_labels.bordereau_id` ; « à déposer » se lit `bordereau_id IS
 *      NULL`. C'est la colonne, et non une requête par dates, qui garantit
 *      qu'un colis n'est jamais déclaré déposé deux fois.
 *
 * Tout le SQL des bordereaux est ici, comme celui des étiquettes est dans
 * shipmentLabelModel : les adaptateurs transporteurs ne touchent pas la base.
 */

const pool = require('../config/database');

/**
 * Le schéma des bordereaux est-il en place ?
 *
 * Même garde-fou que pour les étiquettes, et pour la même raison : un bordereau
 * acheté chez Colissimo puis impossible à enregistrer serait un papier perdu et
 * des colis déclarés déposés sans trace. On vérifie AVANT d'appeler l'API.
 *
 * Le succès est mémorisé, jamais l'échec : l'app doit repartir dès que la
 * migration est passée, sans redémarrage du backend.
 */
let schemaReady = false;

const assertSchemaReady = async () => {
  if (schemaReady) return;

  const { rows: [etat] } = await pool.query(
    `SELECT to_regclass('public.shipment_bordereaux') IS NOT NULL AS table_ok,
            EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'shipment_labels'
                      AND column_name = 'bordereau_id') AS colonne_ok`
  );

  if (!etat.table_ok || !etat.colonne_ok) {
    const err = new Error(
      'Schéma des bordereaux absent : appliquer la migration '
      + 'backend/src/migrations/add_shipment_bordereaux.sql avant de reconstruire le backend'
    );
    err.statusCode = 500;
    err.userMessage = "La migration des bordereaux n'a pas encore été appliquée sur cette base. "
      + "L'étiquetage n'est pas affecté ; prévenez un responsable.";
    throw err;
  }

  schemaReady = true;
};

/**
 * Les colis étiquetés depuis une date et pas encore déposés.
 *
 * ── Pourquoi une date de départ et pas « tout ce qui n'est pas déposé » ──────
 * Les bordereaux étaient produits dans BMS jusqu'ici : les colis antérieurs à la
 * bascule ont été déposés sans que notre base le sache, et les prendre ferait
 * un bordereau de rattrapage absurde. BMS fonctionne de la même façon — on
 * choisit une date, il montre ce qui n'a pas été déposé depuis. Décision de
 * Pierre, 21/09/2026.
 *
 * ── Pourquoi la conversion de fuseau ────────────────────────────────────────
 * `created_at` est un timestamp SANS fuseau, écrit par `NOW()` d'un serveur qui
 * tourne en UTC. La date saisie, elle, est une date de calendrier parisienne :
 * « depuis le 22 » veut dire 22 septembre 00:00 à Castelnau, soit 21 à 22:00 en
 * UTC l'été. Sans la conversion, deux heures de colis du soir seraient
 * invisibles chaque nuit d'été.
 *
 * @param {{carrierCodes: string[], since: string}} params - `since` au format AAAA-MM-JJ
 * @returns {Promise<object[]>} une ligne par colis, triée par transporteur puis date
 */
const listPending = async ({ carrierCodes, since }) => {
  await assertSchemaReady();
  if (!carrierCodes || carrierCodes.length === 0) return [];

  const { rows } = await pool.query(
    `SELECT l.id, l.carrier_code, l.account_code, l.method_code,
            l.order_number, l.tracking_number, l.created_at,
            u.name AS packer_name
       FROM shipment_labels l
       LEFT JOIN users u ON u.id = l.packed_by
      WHERE l.carrier_code = ANY($1)
        AND l.status = 'active'
        AND l.bordereau_id IS NULL
        AND l.tracking_number IS NOT NULL
        AND l.tracking_number <> ''
        AND (l.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris' >= $2::date
      ORDER BY l.carrier_code, l.account_code, l.created_at`,
    [carrierCodes, since]
  );
  return rows;
};

/**
 * Numéro du prochain récapitulatif local d'un transporteur, pour la journée.
 *
 * Forme `MR-20260923-01` : le préfixe du transporteur, le jour de remise en
 * heure de Paris, et un rang dans la journée. Un numéro qui se lit à voix haute
 * au téléphone quand le chauffeur en cherche un.
 *
 * Appelé DANS la transaction, et sous le verrou de génération : deux postes ne
 * peuvent pas tomber sur le même rang. L'index unique
 * (carrier_code, bordereau_number) reste la dernière barrière — si elle cède,
 * l'écriture échoue et l'app le dit, ce qui vaut mieux que deux papiers
 * portant le même numéro.
 *
 * @param {object} client - client pg de la transaction en cours
 * @param {{carrierCode: string, prefix: string, dayParis: string}} params
 * @returns {Promise<string>}
 */
const nextLocalNumber = async (client, { carrierCode, prefix, dayParis }) => {
  const { rows: [{ rang }] } = await client.query(
    `SELECT COUNT(*) + 1 AS rang
       FROM shipment_bordereaux
      WHERE carrier_code = $1
        AND (created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris' >= $2::date
        AND (created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris' <  $2::date + 1`,
    [carrierCode, dayParis]
  );
  return `${prefix}-${dayParis.replace(/-/g, '')}-${String(rang).padStart(2, '0')}`;
};

/**
 * Enregistre un bordereau et y rattache ses colis, d'un seul tenant.
 *
 * L'étiquette est déjà achetée quand on arrive ici : si l'écriture échouait à
 * moitié, on aurait un bordereau sans colis (donc des colis qui repartiraient
 * dans un second bordereau, déposés deux fois) ou des colis sans bordereau
 * imprimable. D'où la transaction.
 *
 * `bordereau_id IS NULL` est répété dans le UPDATE : c'est la dernière barrière
 * contre le double rattachement, même si l'appelant s'est trompé de liste.
 *
 * @param {object} client - client pg, transaction déjà ouverte par l'appelant
 * @returns {Promise<object>} le bordereau créé
 */
const insertBordereau = async (client, {
  carrierCode, accountCode, number, publishedAt, pdfBase64, labelIds, userId
}) => {
  const { rows: [bordereau] } = await client.query(
    `INSERT INTO shipment_bordereaux
       (carrier_code, account_code, bordereau_number, published_at, parcel_count, pdf_data, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, carrier_code, account_code, bordereau_number, published_at, parcel_count, created_at`,
    [carrierCode, accountCode, number, publishedAt || null, labelIds.length, pdfBase64 || null, userId || null]
  );

  const { rowCount } = await client.query(
    `UPDATE shipment_labels
        SET bordereau_id = $1
      WHERE id = ANY($2) AND bordereau_id IS NULL`,
    [bordereau.id, labelIds]
  );

  return { ...bordereau, attached: rowCount };
};

/**
 * Historique des bordereaux, le plus récent d'abord.
 *
 * `parcel_count` est lu dans la table et non recompté par jointure : le papier
 * signé par le chauffeur porte un nombre de colis qui ne bouge plus, même si
 * une étiquette est annulée après coup.
 *
 * @param {{limit?: number, carrierCodes?: string[]}} [options]
 * @returns {Promise<object[]>}
 */
const listHistory = async ({ limit = 50, carrierCodes = null } = {}) => {
  await assertSchemaReady();

  const { rows } = await pool.query(
    `SELECT b.id, b.carrier_code, b.account_code, b.bordereau_number,
            b.published_at, b.parcel_count, b.created_at,
            (b.pdf_data IS NOT NULL) AS has_pdf,
            u.name AS created_by_name
       FROM shipment_bordereaux b
       LEFT JOIN users u ON u.id = b.created_by
      WHERE ($2::text[] IS NULL OR b.carrier_code = ANY($2))
      ORDER BY b.created_at DESC
      LIMIT $1`,
    [limit, carrierCodes]
  );
  return rows;
};

/**
 * Les colis portés par un bordereau — ce que le chauffeur a emporté.
 *
 * @param {number|string} id
 * @returns {Promise<object[]>}
 */
const listLabelsForBordereau = async (id) => {
  await assertSchemaReady();

  const { rows } = await pool.query(
    `SELECT l.id, l.order_number, l.tracking_number, l.method_code, l.status, l.created_at
       FROM shipment_labels l
      WHERE l.bordereau_id = $1
      ORDER BY l.created_at`,
    [id]
  );
  return rows;
};

/**
 * Le PDF d'un bordereau, pour le réimprimer.
 *
 * @param {number|string} id
 * @returns {Promise<?object>}
 */
const findPdfById = async (id) => {
  await assertSchemaReady();

  const { rows: [row] } = await pool.query(
    `SELECT id, carrier_code, bordereau_number, pdf_data, parcel_count, created_at
       FROM shipment_bordereaux
      WHERE id = $1`,
    [id]
  );
  return row || null;
};

module.exports = {
  assertSchemaReady,
  listPending,
  nextLocalNumber,
  insertBordereau,
  listHistory,
  listLabelsForBordereau,
  findPdfById
};
