/**
 * Suivi des colis : journal des évènements transporteur, correspondance
 * code → état, état courant porté par `shipment_labels`.
 *
 * Voir services/tracking/states.js pour les règles de calcul de l'état, et
 * migrations/add_shipment_tracking.sql pour le schéma.
 */

const pool = require('../config/database');
const { STATES, MAX_AGE_DAYS, FINAL_STATES, computeState } = require('../services/tracking/states');
const { SOURCE_BY_CARRIER } = require('../services/tracking/readers');

const mapKey = (source, key) => `${source}|${key}`;

/** Correspondance complète, sous forme de fonction `(source, key) → état`. */
const loadStateOf = async () => {
  const { rows } = await pool.query('SELECT source, event_key, state FROM tracking_status_map');
  const map = new Map(rows.map(r => [mapKey(r.source, r.event_key), r.state]));
  return (source, key) => map.get(mapKey(source, key)) || null;
};

/** Les colis dont le passage est dû, les jamais interrogés d'abord. */
const dueLabels = async (limit) => {
  const { rows } = await pool.query(
    `SELECT id, carrier_code, account_code, tracking_number, created_at
       FROM shipment_labels
      WHERE status = 'active'
        AND NULLIF(tracking_number, '') IS NOT NULL
        AND carrier_code = ANY($1)
        AND created_at > NOW() - make_interval(days => $2)
        AND (tracking_state IS NULL OR tracking_state <> ALL($3))
        AND (tracking_next_check_at IS NULL OR tracking_next_check_at <= NOW())
      ORDER BY tracking_next_check_at NULLS FIRST, created_at DESC
      LIMIT $4`,
    [Object.keys(SOURCE_BY_CARRIER), MAX_AGE_DAYS, FINAL_STATES, limit]
  );
  return rows;
};

const findLabel = async (id) => {
  const { rows: [row] } = await pool.query(
    `SELECT id, carrier_code, account_code, tracking_number, created_at, status
       FROM shipment_labels WHERE id = $1`,
    [id]
  );
  return row || null;
};

/**
 * Enregistre les évènements reçus (ceux déjà connus sont ignorés) et inscrit
 * dans la correspondance tout code jamais vu, sans état : il apparaît « à
 * classer » dans les réglages et ne change rien tant qu'on ne l'a pas classé.
 */
const saveEvents = async (labelId, source, events) => {
  if (!events.length) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO shipment_tracking_events (label_id, source, event_key, label, location, detail, occurred_at)
       SELECT $1, $2, e.event_key, e.label, e.location, e.detail, e.occurred_at
         FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::timestamptz[])
              AS e(event_key, label, location, detail, occurred_at)
       ON CONFLICT (label_id, occurred_at, event_key) DO NOTHING`,
      [labelId, source,
        events.map(e => e.event_key), events.map(e => e.label), events.map(e => e.location),
        events.map(e => e.detail), events.map(e => e.occurred_at)]
    );
    // Un exemple de libellé par code, et les dates de première / dernière vue.
    const parKey = new Map();
    for (const e of events) {
      const cur = parKey.get(e.event_key);
      if (!cur || e.occurred_at > cur.occurred_at) parKey.set(e.event_key, e);
    }
    const uniques = [...parKey.values()];
    await client.query(
      `INSERT INTO tracking_status_map (source, event_key, example_label, first_seen_at, last_seen_at)
       SELECT $1, k.event_key, k.label, k.seen_at, k.seen_at
         FROM unnest($2::text[], $3::text[], $4::timestamptz[]) AS k(event_key, label, seen_at)
       ON CONFLICT (source, event_key) DO UPDATE
         SET example_label = COALESCE(tracking_status_map.example_label, EXCLUDED.example_label),
             first_seen_at = LEAST(tracking_status_map.first_seen_at, EXCLUDED.first_seen_at),
             last_seen_at  = GREATEST(tracking_status_map.last_seen_at, EXCLUDED.last_seen_at)`,
      [source, uniques.map(e => e.event_key), uniques.map(e => e.label), uniques.map(e => e.occurred_at)]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Recalcule l'état des colis donnés depuis leur journal. Ne touche pas au
 * calendrier des passages : un colis qui redevient non final après un
 * changement de réglage est simplement repris au passage suivant.
 *
 * @param {number[]} labelIds
 * @param {Function} [stateOf] - correspondance déjà chargée
 * @returns {Promise<Map<number, object>>} l'état calculé de chaque colis
 */
const recompute = async (labelIds, stateOf = null) => {
  const result = new Map();
  if (!labelIds.length) return result;
  const of = stateOf || await loadStateOf();

  const { rows } = await pool.query(
    `SELECT label_id, source, event_key, label, occurred_at
       FROM shipment_tracking_events WHERE label_id = ANY($1)`,
    [labelIds]
  );
  const parLabel = new Map(labelIds.map(id => [id, []]));
  for (const r of rows) parLabel.get(r.label_id).push(r);

  for (const [id, events] of parLabel) {
    result.set(id, computeState(events, key => of(events[0]?.source, key)));
  }

  const ids = [...result.keys()];
  const v = ids.map(id => result.get(id));
  await pool.query(
    `UPDATE shipment_labels l
        SET tracking_state = s.state, tracking_state_at = s.state_at,
            tracking_delivered_at = s.delivered_at, tracking_last_event_at = s.last_at,
            tracking_last_label = s.last_label
       FROM unnest($1::int[], $2::text[], $3::timestamptz[], $4::timestamptz[], $5::timestamptz[], $6::text[])
            AS s(id, state, state_at, delivered_at, last_at, last_label)
      WHERE l.id = s.id`,
    [ids, v.map(s => s.state), v.map(s => s.stateAt), v.map(s => s.deliveredAt),
      v.map(s => s.lastEventAt), v.map(s => s.lastLabel)]
  );
  return result;
};

/** Note le passage : date, prochain passage, erreur éventuelle. */
const recordCheck = async (labelId, { nextCheckAt, error = null }) => {
  await pool.query(
    `UPDATE shipment_labels
        SET tracking_checked_at = NOW(), tracking_next_check_at = $2, tracking_error = $3
      WHERE id = $1`,
    [labelId, nextCheckAt, error]
  );
};

/** Le journal d'un colis, du plus ancien au plus récent, avec l'état de chaque évènement. */
const eventsForLabel = async (labelId) => {
  const { rows } = await pool.query(
    `SELECT e.id, e.source, e.event_key, e.label, e.location, e.detail, e.occurred_at, m.state
       FROM shipment_tracking_events e
       LEFT JOIN tracking_status_map m ON m.source = e.source AND m.event_key = e.event_key
      WHERE e.label_id = $1
      ORDER BY e.occurred_at, e.id`,
    [labelId]
  );
  return rows;
};

/** État de suivi d'un numéro, pour le badge du SAV (étiquette active la plus récente). */
const findByTrackingNumber = async (trackingNumber) => {
  const { rows: [row] } = await pool.query(
    `SELECT id, carrier_code, tracking_state, tracking_state_at, tracking_last_label, tracking_last_event_at
       FROM shipment_labels
      WHERE tracking_number = $1 AND status = 'active'
      ORDER BY created_at DESC LIMIT 1`,
    [trackingNumber]
  );
  return row || null;
};

/** La correspondance, pour l'écran de réglages : à classer d'abord, puis par nombre de fois vu. */
const getMap = async () => {
  const { rows } = await pool.query(
    `SELECT m.source, m.event_key, m.example_label, m.state, m.first_seen_at, m.last_seen_at,
            m.updated_at, u.name AS updated_by_name, COALESCE(c.n, 0)::int AS seen_count
       FROM tracking_status_map m
       LEFT JOIN users u ON u.id = m.updated_by
       LEFT JOIN (SELECT source, event_key, COUNT(*) AS n
                    FROM shipment_tracking_events GROUP BY 1, 2) c
              ON c.source = m.source AND c.event_key = m.event_key
      ORDER BY m.source, (m.state IS NULL) DESC, seen_count DESC, m.event_key`
  );
  return rows;
};

/**
 * Change l'état d'un code, puis recalcule les colis qui l'ont reçu.
 *
 * @param {{source: string, eventKey: string, state: ?string, userId: ?number}} p
 * @returns {Promise<?number>} nombre de colis recalculés, null si le code est inconnu
 */
const setMapping = async ({ source, eventKey, state, userId }) => {
  if (state !== null && !STATES[state]) {
    const err = new Error(`État inconnu : ${state}`);
    err.statusCode = 400;
    throw err;
  }
  const { rowCount } = await pool.query(
    `UPDATE tracking_status_map SET state = $3, updated_by = $4, updated_at = NOW()
      WHERE source = $1 AND event_key = $2`,
    [source, eventKey, state, userId || null]
  );
  if (!rowCount) return null;

  const { rows } = await pool.query(
    'SELECT DISTINCT label_id FROM shipment_tracking_events WHERE source = $1 AND event_key = $2',
    [source, eventKey]
  );
  const ids = rows.map(r => r.label_id);
  const stateOf = await loadStateOf();
  for (let i = 0; i < ids.length; i += 500) {
    await recompute(ids.slice(i, i + 500), stateOf);
  }
  return ids.length;
};

module.exports = {
  loadStateOf, dueLabels, findLabel, saveEvents, recompute, recordCheck,
  eventsForLabel, findByTrackingNumber, getMap, setMapping,
};
