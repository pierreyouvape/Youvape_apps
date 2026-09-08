/**
 * Résolution « dénomination WooCommerce → transporteur d'étiquetage ».
 *
 * Le principe tient en une phrase : **on ne devine pas**. Les deux champs sur
 * lesquels on pourrait déduire mentent déjà — `relay_point->>'service'` classe
 * 256 « Bpost Relais » en réseau `mondial_relay`, et le libellé WooCommerce a
 * été renommé le 03/09/2026. Une dénomination non mappée fait donc échouer le
 * packing avec un message clair, elle ne produit jamais une étiquette au hasard.
 *
 * Trois réponses possibles, et la distinction entre les deux dernières est le
 * cœur du sujet :
 *   - `mapped`   : un transporteur est désigné, on étiquette ;
 *   - `no_label` : dénomination connue, sans étiquette (retrait sur place réglé
 *                  autrement, transporteur géré hors app). Silence assumé ;
 *   - `unknown`  : personne ne l'a jamais mappée. C'est ça qui alerte.
 *
 * Sans le cas `no_label`, l'alerte se déclencherait tous les jours sur des modes
 * qui n'ont rien à imprimer — et une alerte qui crie au loup ne protège plus de
 * rien.
 */

const pool = require('../config/database');

const CACHE_TTL_MS = 60000;
let cache = { rows: null, expiresAt: 0 };

/** @returns {Promise<object[]>} toutes les correspondances actives */
const listActive = async () => {
  if (cache.rows && cache.expiresAt > Date.now()) return cache.rows;

  const { rows } = await pool.query(
    `SELECT denomination, carrier_code, account_code, delivery_mode, note
     FROM shipping_method_carrier_map
     WHERE active = true`
  );

  cache = { rows, expiresAt: Date.now() + CACHE_TTL_MS };
  return rows;
};

/** Toutes les correspondances, actives ou non — pour l'écran de réglages. */
const listAll = async () => {
  const { rows } = await pool.query(
    `SELECT id, denomination, carrier_code, account_code, delivery_mode, note,
            active, created_at, updated_at
     FROM shipping_method_carrier_map
     ORDER BY active DESC, denomination`
  );
  return rows;
};

const invalidateCache = () => { cache = { rows: null, expiresAt: 0 }; };

/**
 * Résout une dénomination.
 *
 * La comparaison est insensible à la casse et aux espaces de bord : WooCommerce
 * a déjà livré « 2Shop » et « 2Shop 2 à 4 jours ouvrés » pour le même
 * transporteur, inutile d'y ajouter un écart d'espace.
 *
 * @param {?string} denomination - `orders.shipping_method`
 * @returns {Promise<{status: 'mapped'|'no_label'|'unknown', denomination: ?string,
 *                    carrierCode?: string, accountCode?: string, deliveryMode?: ?string}>}
 */
const resolve = async (denomination) => {
  const needle = String(denomination ?? '').trim().toLowerCase();
  if (!needle) return { status: 'unknown', denomination };

  const rows = await listActive();
  const row = rows.find(r => r.denomination.trim().toLowerCase() === needle);

  if (!row) return { status: 'unknown', denomination };

  if (!row.carrier_code) {
    return { status: 'no_label', denomination: row.denomination, note: row.note };
  }

  return {
    status: 'mapped',
    denomination: row.denomination,
    carrierCode: row.carrier_code,
    accountCode: row.account_code,
    deliveryMode: row.delivery_mode
  };
};

/**
 * Dénominations vues dans les commandes récentes et jamais mappées.
 *
 * Sert l'écran de réglages : proposer à mapper ce qui arrive vraiment, plutôt
 * que d'attendre qu'un préparateur se retrouve bloqué devant un colis.
 *
 * @param {number} days
 * @returns {Promise<{denomination: string, orders: number, last_seen: Date}[]>}
 */
const listUnmappedSeen = async (days = 90) => {
  const { rows } = await pool.query(`
    SELECT o.shipping_method AS denomination,
           COUNT(*)::int     AS orders,
           MAX(COALESCE(o.paid_date, o.post_date)) AS last_seen
    FROM orders o
    WHERE COALESCE(o.paid_date, o.post_date) > NOW() - ($1 || ' days')::interval
      AND o.shipping_method IS NOT NULL
      AND o.shipping_method <> ''
      AND o.post_status IN ('wc-completed','wc-delivered','wc-processing',
                            'wc-awaiting-delivery','wc-shipped','wc-being-delivered')
      AND NOT EXISTS (
        SELECT 1 FROM shipping_method_carrier_map m
        WHERE lower(btrim(m.denomination)) = lower(btrim(o.shipping_method))
      )
    GROUP BY 1
    ORDER BY 2 DESC
  `, [days]);
  return rows;
};

/**
 * Crée ou met à jour une correspondance.
 *
 * L'écriture passe par la dénomination et non par l'id : c'est elle la clé
 * métier, et l'écran de réglages propose de mapper des dénominations repérées
 * dans les commandes, qui n'ont donc pas encore de ligne.
 *
 * @param {object} entry
 * @param {string} entry.denomination
 * @param {?string} entry.carrierCode - null pour « connu, sans étiquette »
 * @param {?string} entry.accountCode
 * @param {?string} entry.deliveryMode
 * @param {?string} entry.note
 * @param {boolean} [entry.active]
 * @returns {Promise<object>} la ligne écrite
 */
const upsert = async ({ denomination, carrierCode, accountCode, deliveryMode, note, active = true }) => {
  const nom = String(denomination ?? '').trim();
  if (!nom) {
    const err = new Error('La dénomination est obligatoire');
    err.statusCode = 400;
    throw err;
  }

  // « Pas d'étiquette » se dit avec un transporteur ET un contrat vides : la
  // contrainte de cohérence en base refuse les demi-mesures.
  const carrier = carrierCode || null;
  const account = carrier ? (accountCode || null) : null;
  if (carrier && !account) {
    const err = new Error(`Le transporteur « ${carrier} » exige un contrat`);
    err.statusCode = 400;
    throw err;
  }

  const { rows } = await pool.query(
    `INSERT INTO shipping_method_carrier_map
       (denomination, carrier_code, account_code, delivery_mode, note, active)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (denomination) DO UPDATE
       SET carrier_code  = EXCLUDED.carrier_code,
           account_code  = EXCLUDED.account_code,
           delivery_mode = EXCLUDED.delivery_mode,
           note          = EXCLUDED.note,
           active        = EXCLUDED.active,
           updated_at    = NOW()
     RETURNING *`,
    [nom, carrier, account, deliveryMode || null, note || null, active]
  );

  invalidateCache();
  return rows[0];
};

/**
 * Supprime une correspondance.
 *
 * Supprimer n'est pas anodin : la dénomination redevient « inconnue » et
 * bloquera le packing. C'est parfois voulu (une dénomination mappée par erreur),
 * mais pour retirer temporairement un transporteur, `active = false` est plus
 * sûr — la ligne et sa note sont conservées.
 *
 * @param {number|string} id
 * @returns {Promise<?object>} la ligne supprimée, ou null
 */
const remove = async (id) => {
  const { rows } = await pool.query(
    'DELETE FROM shipping_method_carrier_map WHERE id = $1 RETURNING *', [id]
  );
  invalidateCache();
  return rows[0] || null;
};

module.exports = {
  resolve, listActive, listAll, listUnmappedSeen, upsert, remove, invalidateCache
};
