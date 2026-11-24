/**
 * Sortie de BMS, lot 1 : la règle « à expédier » EN SIMULATION, à côté de BMS.
 *
 * Rien ne change pour l'équipe : le Picking reste sur la photo BMS
 * (pickingSyncService). Ici on calcule NOTRE liste (toShipRules), on la compare
 * à chaque photo et on prévient. Rien n'est écrit sur le site ni chez BMS :
 * tant que BMS est branché, changer le statut d'une vieille commande lui fait
 * réimporter, ressortir le stock et renvoyer son statut (incident du 19-20/11).
 *
 *   compareWithPhoto() — après chaque photo BMS : écarts suivis dans
 *     picking_shadow_diffs (vu, revu, disparu).
 *   runMails() — cron 8h → 20h lun-sam, un passage utile par jour et par mail :
 *     écarts qui durent jamais signalés ; commandes « à vérifier » (encore à
 *     expédier 3 jours après le paiement) jamais signalées. Rien s'il n'y a
 *     rien. Un envoi raté est retenté à l'heure suivante. SMTP seul (quota
 *     Mailgun), vers contact@.
 *
 * Éteint tant que app_config.picking_shadow_since (AAAA-MM-JJ, la veille de la
 * mise en service) n'existe pas. Les commandes payées avant cette date ne sont
 * ni comparées ni signalées : leur ménage se fera après la coupure de BMS.
 */

const pool = require('../config/database');
const appConfigModel = require('../models/appConfigModel');
const { getToShipStatuses } = require('./logistiqueService');
const { REFUNDED_QTY_SQL } = require('./refundLinesService');
const { sendMail } = require('./alertService');
const { CONTACT_EMAIL } = require('../models/pickingPackingModel');
const rules = require('./toShipRules');
const { buildDiffMail, buildCheckMail } = require('./toShipMail');

const SINCE_KEY = 'picking_shadow_since';
const MAIL_DAY_KEYS = { diffs: 'picking_shadow_mail_diffs_day', checks: 'picking_shadow_mail_checks_day' };
const APP_URL = process.env.APP_BASE_URL || 'https://apps.youvape.fr';

const PAID_TEXT = "to_char(COALESCE(o.paid_date, o.post_date), 'YYYY-MM-DD HH24:MI:SS')";
const PAID_LABEL = "to_char(COALESCE(o.paid_date, o.post_date), 'DD/MM/YYYY HH24:MI')";

/** Borne de la date de début, ou null : service éteint. */
const readSince = async () => rules.sinceBound((await appConfigModel.get(SINCE_KEY))?.config_value);

/** Lignes `order_items` (jointes au produit) de ces commandes, par commande. */
const loadItems = async (orderNumbers) => {
  const byOrder = new Map();
  if (!orderNumbers.length) return byOrder;
  const { rows } = await pool.query(`
    SELECT oi.wp_order_id::text AS order_number, oi.order_item_name AS name, oi.qty, oi.line_total,
           oi.product_id, p.sku, p.product_type AS type, p.woosb_ids,
           ${REFUNDED_QTY_SQL} AS refunded
      FROM order_items oi
      LEFT JOIN products p ON p.wp_product_id = COALESCE(NULLIF(oi.variation_id, 0), oi.product_id)
     WHERE oi.order_item_type = 'line_item' AND oi.wp_order_id = ANY($1::bigint[])
     ORDER BY oi.id`, [orderNumbers]);
  for (const r of rows) {
    if (!byOrder.has(r.order_number)) byOrder.set(r.order_number, []);
    byOrder.get(r.order_number).push(r);
  }
  return byOrder;
};

/**
 * Les deux listes, filtrées sur la date de début.
 * @returns {Promise<?{ours, oursInfo, bms, itemsByOrder, nowParis}>} null si le service est éteint
 */
const computeLists = async () => {
  const since = await readSince();
  if (!since) return null;
  const statuses = rules.wcStatuses(await getToShipStatuses());

  const [{ rows: candidates }, { rows: bmsOrders }, { rows: bmsLines }, { rows: [{ now_paris: nowParis }] }] = await Promise.all([
    pool.query(`
      SELECT o.wp_order_id::text AS order_number, o.post_status AS status, o.shipping_method,
             ${PAID_TEXT} AS paid_at, ${PAID_LABEL} AS paid_label,
             EXISTS (SELECT 1 FROM shipment_labels sl
                      WHERE sl.order_number = o.wp_order_id::text AND sl.status = 'active') AS has_label,
             EXISTS (SELECT 1 FROM refunds r
                      WHERE r.wp_order_id = o.wp_order_id AND r.lines_synced_at IS NULL) AS pending_refund
        FROM orders o
       WHERE o.post_status = ANY($1::text[])
         AND COALESCE(o.paid_date, o.post_date) >= $2::timestamp`, [statuses, since]),
    pool.query(`
      SELECT b.order_number, b.bms_status AS status,
             to_char(COALESCE(o.paid_date, o.post_date, b.bms_created_at), 'YYYY-MM-DD HH24:MI:SS') AS paid_at
        FROM picking_bms_orders b
        LEFT JOIN orders o ON o.wp_order_id::text = b.order_number`),
    pool.query('SELECT order_number, sku, qty_to_ship FROM picking_bms_lines'),
    pool.query("SELECT to_char(NOW() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD HH24:MI:SS') AS now_paris")
  ]);

  // Côté BMS aussi, seules les commandes payées depuis la date de début.
  const bmsKept = bmsOrders.filter(o => o.paid_at && o.paid_at >= since)
    .map(o => ({ orderNumber: o.order_number, status: o.status }));
  const numbers = [...new Set([...candidates.map(c => c.order_number), ...bmsKept.map(o => o.orderNumber)])]
    .filter(n => /^\d+$/.test(n));
  const itemsByOrder = await loadItems(numbers);

  const ours = new Map();
  const oursInfo = new Map();
  for (const c of candidates) {
    const lines = rules.orderLines(itemsByOrder.get(c.order_number));
    const o = { status: c.status, hasActiveLabel: c.has_label, pendingRefund: c.pending_refund, paidAt: c.paid_at };
    if (!rules.isToShip(o, lines, { statuses, since })) continue;
    ours.set(c.order_number, lines);
    oursInfo.set(c.order_number, c);
  }

  // Le Picking plafonne la photo par ce qui reste dans WooCommerce pour les
  // commandes à article remboursé (pickingModel.refundedLeftBySku).
  const { rows: refundedOrders } = await pool.query(
    `SELECT DISTINCT wp_order_id::text AS n FROM refund_items
      WHERE item_type = 'line_item' AND wp_order_id = ANY($1::bigint[])`,
    [bmsKept.map(o => o.orderNumber).filter(n => /^\d+$/.test(n))]
  );
  const refundedLeft = new Map(refundedOrders.map(({ n }) => [n, rules.remainingBySku(itemsByOrder.get(n))]));
  const keptNumbers = new Set(bmsKept.map(o => o.orderNumber));
  const bms = rules.bmsView(bmsKept, bmsLines.filter(l => keptNumbers.has(l.order_number)), refundedLeft);

  return { ours, oursInfo, bms, itemsByOrder, nowParis };
};

/** Suivi des écarts, après une photo. Deux passages ne se chevauchent jamais. */
const doCompare = async () => {
  const lists = await computeLists();
  if (!lists) return null;
  const diffs = rules.compare(lists.ours, lists.bms);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: open } = await client.query(
      'SELECT id, order_number, signature FROM picking_shadow_diffs WHERE resolved_at IS NULL FOR UPDATE');
    const { seen, resolved, fresh } = rules.track(open, diffs);
    if (seen.length) {
      await client.query(
        `UPDATE picking_shadow_diffs SET photos_seen = photos_seen + 1, last_seen_at = NOW()
          WHERE id = ANY($1::int[])`, [seen]);
    }
    if (resolved.length) {
      await client.query('UPDATE picking_shadow_diffs SET resolved_at = NOW() WHERE id = ANY($1::int[])', [resolved]);
    }
    for (const d of fresh) {
      await client.query(
        `INSERT INTO picking_shadow_diffs (order_number, kind, signature, lines)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (order_number, signature) WHERE resolved_at IS NULL DO NOTHING`,
        [d.orderNumber, d.kind, d.signature, JSON.stringify(d.lines)]);
    }
    await client.query('COMMIT');
    return { ours: lists.ours.size, bms: lists.bms.size, diffs: diffs.length, fresh: fresh.length, resolved: resolved.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

let comparing = null;

/**
 * Appelé après chaque photo BMS. Ne fait jamais échouer la photo, et ne la
 * ralentit pas : une comparaison en cours fait sauter la suivante.
 */
const compareWithPhoto = () => {
  if (comparing) return comparing;
  comparing = doCompare()
    .catch((error) => {
      console.error('[À expédier] Comparaison avec BMS échouée :', error.message);
      return null;
    })
    .finally(() => { comparing = null; });
  return comparing;
};

// ── Mails ──────────────────────────────────────────────────────────────────

const productNames = async (skus) => {
  if (!skus.length) return new Map();
  const { rows } = await pool.query('SELECT sku, post_title FROM products WHERE sku = ANY($1::text[])', [skus]);
  return new Map(rows.map(r => [r.sku, r.post_title]));
};

/** Écarts qui durent, jamais signalés. */
const diffsToMail = async () => {
  const { rows } = await pool.query(`
    SELECT d.id, d.order_number, d.kind, d.lines, d.first_seen_at, d.last_seen_at, d.photos_seen,
           to_char(d.first_seen_at AT TIME ZONE 'Europe/Paris', 'DD/MM HH24:MI') AS first_seen_label,
           to_char(d.resolved_at AT TIME ZONE 'Europe/Paris', 'DD/MM HH24:MI') AS resolved_label,
           o.post_status AS status, ${PAID_LABEL} AS paid_label,
           COALESCE(o.shipping_method, b.shipping_method) AS shipping_method
      FROM picking_shadow_diffs d
      LEFT JOIN orders o ON o.wp_order_id::text = d.order_number
      LEFT JOIN picking_bms_orders b ON b.order_number = d.order_number
     WHERE d.mailed_at IS NULL AND d.photos_seen >= $1
       AND d.last_seen_at - d.first_seen_at >= $2 * interval '1 millisecond'
     ORDER BY d.first_seen_at`, [rules.MIN_PHOTOS, rules.MIN_DURATION_MS]);
  const lasting = rows.filter(rules.isLasting);
  const names = await productNames([...new Set(lasting.flatMap(r => r.lines.map(l => l.sku)))]);
  return lasting.map(r => ({ ...r, lines: r.lines.map(l => ({ ...l, name: names.get(l.sku) || null })) }));
};

/** Commandes à expédier depuis plus de 3 jours, jamais signalées. */
const checksToMail = async () => {
  const lists = await computeLists();
  if (!lists) return [];
  const late = [...lists.oursInfo.values()].filter(c => rules.needsCheck(c.paid_at, lists.nowParis));
  if (!late.length) return [];
  const { rows: done } = await pool.query(
    'SELECT order_number FROM picking_shadow_checks WHERE order_number = ANY($1::text[])',
    [late.map(c => c.order_number)]);
  const already = new Set(done.map(r => r.order_number));
  return late.filter(c => !already.has(c.order_number)).map((c) => {
    const lines = lists.ours.get(c.order_number);
    const names = new Map((lists.itemsByOrder.get(c.order_number) || []).map(i => [i.sku, i.name]));
    return {
      order_number: c.order_number,
      paid_at: c.paid_at,
      paid_label: c.paid_label,
      status: c.status,
      shipping_method: c.shipping_method,
      lines: [...lines].map(([sku, qty]) => ({ sku, qty, name: names.get(sku) || null })),
      bms: rules.bmsState(lines, lists.bms.get(c.order_number))
    };
  }).sort((a, b) => a.paid_at.localeCompare(b.paid_at));
};

const todayParis = async () => {
  const { rows: [r] } = await pool.query("SELECT to_char(NOW() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS d");
  return r.d;
};

/**
 * Un mail, au plus un passage réussi par jour. Le jour est marqué quand il n'y
 * a rien à dire ou que l'envoi a réussi ; un échec laisse le jour ouvert et le
 * passage de l'heure suivante réessaie.
 */
const dailyMail = async (kind, today, collect, build, markSent) => {
  const mark = await appConfigModel.get(MAIL_DAY_KEYS[kind]);
  if (mark?.config_value === today) return 'déjà fait';
  const rows = await collect();
  if (rows.length === 0) {
    await appConfigModel.upsert(MAIL_DAY_KEYS[kind], today);
    return 'rien à signaler';
  }
  const result = await sendMail({ to: CONTACT_EMAIL, smtpOnly: true, ...build(rows) });
  if (!result.success) {
    console.error(`[À expédier] Mail « ${kind} » NON envoyé (${rows.length}) : ${result.error}`);
    return 'échec';
  }
  await markSent(rows);
  await appConfigModel.upsert(MAIL_DAY_KEYS[kind], today);
  return `envoyé (${rows.length})`;
};

const runMails = async () => {
  if (!(await readSince())) return null;
  // Photo fraîche avant de comparer : à 8h, la dernière date de la veille.
  await require('./pickingSyncService').ensureFresh(10 * 60 * 1000)
    .catch(err => console.error('[À expédier] Photo BMS non actualisée :', err.message));
  const photo = await require('./pickingSyncService').lastSyncAt();
  const photoLabel = photo
    ? photo.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null;
  const today = await todayParis();

  const diffs = await dailyMail('diffs', today, diffsToMail,
    rows => buildDiffMail(rows, APP_URL),
    rows => pool.query('UPDATE picking_shadow_diffs SET mailed_at = NOW() WHERE id = ANY($1::int[])', [rows.map(r => r.id)]));

  const checks = await dailyMail('checks', today, checksToMail,
    rows => buildCheckMail(rows, APP_URL, photoLabel),
    rows => pool.query(
      `INSERT INTO picking_shadow_checks (order_number, paid_at)
       SELECT * FROM unnest($1::text[], $2::timestamp[]) ON CONFLICT (order_number) DO NOTHING`,
      [rows.map(r => r.order_number), rows.map(r => r.paid_at)]));

  if (diffs !== 'déjà fait' || checks !== 'déjà fait') {
    console.log(`[À expédier] Mails du jour : écarts ${diffs}, à vérifier ${checks}`);
  }
  return { diffs, checks };
};

module.exports = { compareWithPhoto, runMails, computeLists, diffsToMail, checksToMail, SINCE_KEY };
