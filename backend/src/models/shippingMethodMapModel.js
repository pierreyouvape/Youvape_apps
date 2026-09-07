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

module.exports = { resolve, listActive, listAll, listUnmappedSeen, invalidateCache };
