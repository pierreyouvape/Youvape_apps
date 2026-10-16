/**
 * Boutique › Coffre — solde théorique du coffre d'une boutique.
 *
 *   théorique = dernier comptage du coffre
 *             + Σ (espèces comptées à la clôture − fond de caisse) des clôtures depuis
 *             − remises en banque depuis
 *
 * À la clôture (≈ 19h), le vendeur compte le tiroir, garde le fond et passe le
 * reste au coffre : c'est ce montant COMPTÉ qui entre au coffre, pas le
 * théorique des ventes. Une caisse encore ouverte n'a rien versé, et le tiroir
 * n'est jamais dans le coffre.
 *
 * Tant qu'aucun comptage n'existe, le solde est inconnu : le premier comptage
 * fixe le point de départ. Chaque comptage suivant recale le solde et garde son
 * écart. Tout est recalculé à chaque lecture — supprimer une saisie erronée
 * corrige donc aussi les soldes qui suivent.
 *
 * Toutes les dates sont en heure de Paris (comme Nextore) et circulent en
 * texte « AAAA-MM-JJ HH:MM:SS » : le serveur est en UTC.
 */

const pool = require('../config/database');
const nextoreApi = require('../services/nextoreApiClient');
const { REGISTER_USER_WAREHOUSE } = require('../config/nextore');

/** Coupures du calculateur, en euros. */
const DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];

// Premier passage : on ne remonte que les dernières sessions (~2 par jour).
const FIRST_SYNC_DEPTH = 150;

const NOW_PARIS = "to_char(NOW() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD HH24:MI:SS')";
const TXT = (col) => `to_char(${col}, 'YYYY-MM-DD HH24:MI:SS')`;

const cents = (n) => Math.round(Number(n) * 100) / 100;

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

/** Somme des espèces d'un JSON de paiements Nextore (`[{paid_by, value}]` en string). */
function cashOf(json) {
  if (!json) return null;
  try {
    return cents(JSON.parse(json)
      .filter((p) => p.paid_by === 'ESPECES')
      .reduce((s, p) => s + Number(p.value || 0), 0));
  } catch {
    return null;
  }
}

/**
 * Recopie les sessions de caisse nouvelles, et rafraîchit celles encore
 * ouvertes (leur clôture arrive plus tard).
 */
async function syncRegisters() {
  const ids = (await nextoreApi.getRegisterIds()).map(Number).filter(Number.isInteger);
  if (!ids.length) return;
  const { rows } = await pool.query(`
    SELECT COALESCE(MAX(id), 0) AS max_id,
           COALESCE(ARRAY_AGG(id) FILTER (WHERE status = 'open'), '{}') AS open_ids
    FROM nextore_registers
  `);
  const maxKnown = Number(rows[0].max_id);
  const floor = maxKnown || Math.max(...ids) - FIRST_SYNC_DEPTH;
  const toFetch = new Set([...ids.filter((id) => id > floor), ...rows[0].open_ids.map(Number)]);

  for (const id of [...toFetch].sort((a, b) => a - b)) {
    const r = await nextoreApi.getRegister(id);
    if (!r) continue;
    await pool.query(`
      INSERT INTO nextore_registers
        (id, warehouse_id, user_id, opened_at, closed_at, status, cash_in_hand, cash_sold, cash_declared, synced_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (id) DO UPDATE SET
        warehouse_id = EXCLUDED.warehouse_id, user_id = EXCLUDED.user_id,
        opened_at = EXCLUDED.opened_at, closed_at = EXCLUDED.closed_at, status = EXCLUDED.status,
        cash_in_hand = EXCLUDED.cash_in_hand, cash_sold = EXCLUDED.cash_sold,
        cash_declared = EXCLUDED.cash_declared, synced_at = NOW()
    `, [
      id,
      REGISTER_USER_WAREHOUSE[r.user_id] || null,
      r.user_id,
      r.date || null,
      r.closed_at || null,
      r.status,
      r.cash_in_hand === '' || r.cash_in_hand == null ? null : Number(r.cash_in_hand),
      cashOf(r.total_payments_real),
      cashOf(r.total_payments_declare),
    ]);
  }
}

/**
 * État du coffre : solde, détail depuis le dernier comptage, caisse du jour,
 * journal (du plus récent au plus ancien).
 */
async function getState(warehouseId) {
  let syncError = null;
  try {
    await syncRegisters();
  } catch (error) {
    console.error('[Coffre] Synchro des caisses Nextore :', error.message);
    syncError = 'Caisses Nextore injoignables : les dernières clôtures peuvent manquer.';
  }

  const [movements, registers, unknown, now] = await Promise.all([
    pool.query(`
      SELECT m.id, m.kind, m.amount::float AS amount, ${TXT('m.occurred_at')} AS at,
             m.denominations, m.note, COALESCE(NULLIF(u.name, ''), u.email) AS author
      FROM coffre_movements m
      LEFT JOIN users u ON u.id = m.created_by
      WHERE m.warehouse_id = $1 AND m.deleted_at IS NULL
    `, [warehouseId]),
    pool.query(`
      SELECT id, ${TXT('opened_at')} AS opened_at, ${TXT('closed_at')} AS at, status,
             cash_in_hand::float AS fond, cash_sold::float AS sold, cash_declared::float AS declared
      FROM nextore_registers
      WHERE warehouse_id = $1
    `, [warehouseId]),
    // Comptes d'ouverture inconnus : impossible de dire à quelle boutique ils versent.
    pool.query(`
      SELECT id, user_id, ${TXT('opened_at')} AS opened_at
      FROM nextore_registers
      WHERE warehouse_id IS NULL AND opened_at > NOW() - INTERVAL '60 days'
      ORDER BY id DESC
    `),
    pool.query(`SELECT ${NOW_PARIS} AS now`),
  ]);

  const events = [
    ...registers.rows.filter((r) => r.status === 'close' && r.at).map((r) => {
      const deposit = r.declared == null ? null : cents(r.declared - (r.fond || 0));
      return {
        type: 'cloture', id: r.id, at: r.at, openedAt: r.opened_at,
        fond: r.fond, sold: r.sold, declared: r.declared, deposit,
        registerGap: deposit == null || r.sold == null ? null : cents(deposit - r.sold),
      };
    }),
    ...movements.rows.map((m) => ({
      type: m.kind, id: m.id, at: m.at, amount: m.amount,
      denominations: m.denominations, note: m.note, author: m.author,
    })),
  ];
  // À la même seconde, la clôture passe avant ce qui a été saisi après elle.
  const order = { cloture: 0, remise: 1, comptage: 2 };
  events.sort((a, b) => a.at.localeCompare(b.at) || order[a.type] - order[b.type] || a.id - b.id);

  let balance = null;
  let anchor = null;
  let since = { deposits: 0, closures: 0, remises: 0, remiseCount: 0 };
  for (const e of events) {
    if (e.type === 'cloture') {
      if (balance != null && e.deposit != null) {
        balance = cents(balance + e.deposit);
        since.deposits = cents(since.deposits + e.deposit);
        since.closures += 1;
      }
    } else if (e.type === 'remise') {
      if (balance != null) {
        balance = cents(balance - e.amount);
        since.remises = cents(since.remises + e.amount);
        since.remiseCount += 1;
      }
    } else {
      e.theoretical = balance;
      e.gap = balance == null ? null : cents(e.amount - balance);
      balance = e.amount;
      anchor = e;
      since = { deposits: 0, closures: 0, remises: 0, remiseCount: 0 };
    }
    e.balance = balance;
  }

  const open = registers.rows
    .filter((r) => r.status === 'open')
    .sort((a, b) => b.id - a.id)[0];

  return {
    now: now.rows[0].now,
    balance,
    anchor: anchor && { id: anchor.id, at: anchor.at, amount: anchor.amount, author: anchor.author, gap: anchor.gap },
    since: anchor ? since : null,
    openRegister: open ? { id: open.id, openedAt: open.opened_at, fond: open.fond } : null,
    unknownRegisters: unknown.rows,
    denominations: DENOMINATIONS,
    journal: events.reverse().slice(0, 200),
    syncError,
  };
}

/** Comptage du coffre : le total se recalcule ici depuis les coupures. */
async function addComptage(warehouseId, denominations, note, userId) {
  const clean = {};
  let total = 0;
  for (const value of DENOMINATIONS) {
    const raw = denominations?.[String(value)];
    if (raw === undefined || raw === null || raw === '' || Number(raw) === 0) continue;
    const count = Number(raw);
    if (!Number.isInteger(count) || count < 0) throw httpError(400, `Nombre invalide pour ${value} €`);
    clean[String(value)] = count;
    total += Math.round(value * 100) * count;
  }

  // Le théorique gardé avec le comptage est celui de l'écran à cet instant.
  const { balance } = await getState(warehouseId);
  const { rows } = await pool.query(`
    INSERT INTO coffre_movements (warehouse_id, kind, amount, occurred_at, denominations, theoretical, note, created_by)
    VALUES ($1, 'comptage', $2, NOW() AT TIME ZONE 'Europe/Paris', $3, $4, $5, $6)
    RETURNING id
  `, [warehouseId, total / 100, JSON.stringify(clean), balance, note || null, userId]);
  return { id: rows[0].id, amount: total / 100, theoretical: balance };
}

const DATETIME_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?$/;

/** Remise en banque : de l'argent qui sort du coffre. `at` = heure de Paris, défaut maintenant. */
async function addRemise(warehouseId, amount, at, note, userId) {
  const value = cents(amount);
  if (!Number.isFinite(value) || value <= 0) throw httpError(400, 'Montant invalide');
  let occurredAt = null;
  if (at) {
    const m = DATETIME_RE.exec(String(at));
    if (!m) throw httpError(400, 'Date invalide');
    occurredAt = `${m[1]} ${m[2]}${m[3] || ':00'}`;
    const { rows } = await pool.query(`SELECT ($1::timestamp > NOW() AT TIME ZONE 'Europe/Paris' + INTERVAL '5 minutes') AS future`, [occurredAt]);
    if (rows[0].future) throw httpError(400, 'La remise ne peut pas être dans le futur');
  }
  const { rows } = await pool.query(`
    INSERT INTO coffre_movements (warehouse_id, kind, amount, occurred_at, note, created_by)
    VALUES ($1, 'remise', $2, COALESCE($3::timestamp, NOW() AT TIME ZONE 'Europe/Paris'), $4, $5)
    RETURNING id
  `, [warehouseId, value, occurredAt, note || null, userId]);
  return { id: rows[0].id };
}

/** Suppression logique d'un comptage ou d'une remise de la boutique. */
async function deleteMovement(warehouseId, id, userId) {
  const { rowCount } = await pool.query(`
    UPDATE coffre_movements
    SET deleted_at = NOW() AT TIME ZONE 'Europe/Paris', deleted_by = $3
    WHERE id = $1 AND warehouse_id = $2 AND deleted_at IS NULL
  `, [id, warehouseId, userId]);
  if (!rowCount) throw httpError(404, 'Opération introuvable');
}

module.exports = { getState, addComptage, addRemise, deleteMovement, DENOMINATIONS };
