/**
 * Picking — commandes à préparer, règles et vagues.
 *
 * La photo BMS (pickingSyncService) donne QUOI préparer ; notre base donne le
 * reste (client, adresse, point relais, transporteur, tickets SAV). La
 * disponibilité et le découpage en vagues sont calculés par pickingPlanner.
 */

const pool = require('../config/database');
const shippingMethodMapModel = require('./shippingMethodMapModel');
const { expectedNetwork } = require('../services/carriers/relayPoints');
const { BUCKETS, allocateStock, physicalFromBms, planWaves, waveNumber } = require('../services/pickingPlanner');

const BLOCKED = 'bloquee';
const MANUAL_PREFIX_KEY = 'picking_manual_prefix';

// Tags « à corriger » : la commande reste dans son onglet mais ne peut être ni
// cochée ni prise par une règle. Un blocage, lui, est toujours manuel.
const TAGS = Object.freeze({
  CARRIER_UNKNOWN: 'transporteur_inconnu',
  RELAY_MISSING: 'point_relais_manquant',
  ADDRESS_INCOMPLETE: 'adresse_incomplete',
  NOT_SYNCED: 'commande_absente'
});

const httpError = (status, message) => Object.assign(new Error(message), { statusCode: status });

const blank = (v) => !String(v ?? '').trim();

/**
 * Tags à corriger d'une commande.
 * @param {?object} o - ligne `orders` (null si la commande n'est pas encore dans notre base)
 * @param {object} carrier - réponse de shippingMethodMapModel.resolve
 */
const correctionTags = (o, carrier) => {
  if (!o) return [TAGS.NOT_SYNCED];
  if (carrier.status === 'unknown') return [TAGS.CARRIER_UNKNOWN];
  if (carrier.status !== 'mapped' || carrier.carrierCode === 'interne') return [];

  if (expectedNetwork(carrier.carrierCode, carrier.deliveryMode)) {
    return blank(o.relay_point_id) ? [TAGS.RELAY_MISSING] : [];
  }
  const incomplete = [o.shipping_address_1, o.shipping_postcode, o.shipping_city,
    o.shipping_country || o.billing_country].some(blank);
  return incomplete ? [TAGS.ADDRESS_INCOMPLETE] : [];
};

/**
 * Stock disponible par SKU (`products.stock`). Un produit sans suivi de stock
 * (stock NULL) n'est jamais un frein : il reçoit un stock illimité.
 */
const availableBySku = async (skus) => {
  const { rows } = await pool.query(
    'SELECT sku, stock FROM products WHERE sku = ANY($1::text[])',
    [skus]
  );
  return new Map(rows.map(r => [r.sku, r.stock === null ? Number.MAX_SAFE_INTEGER : Number(r.stock)]));
};

/**
 * Toutes les commandes de la photo, classées et annotées.
 * Les commandes déjà dans une vague de l'app ne sont pas rendues : elles sont
 * dans l'onglet Vagues.
 */
const getOrdersView = async () => {
  const [{ rows: orders }, { rows: lines }] = await Promise.all([
    pool.query(`
      SELECT b.order_number, b.bms_status, b.bms_wave_id, b.bms_created_at,
             b.shipping_method AS bms_shipping_method, b.ship_name, b.ship_country,
             o.wp_order_id IS NOT NULL AS in_db,
             o.shipping_method, o.paid_date, o.post_date,
             o.shipping_first_name, o.shipping_last_name, o.billing_first_name, o.billing_last_name,
             o.shipping_address_1, o.shipping_postcode, o.shipping_city,
             o.shipping_country, o.billing_country,
             COALESCE(o.relay_point_manual, o.relay_point) ->> 'id' AS relay_point_id,
             pb.reason AS block_reason, pb.blocked_at, u.name AS blocked_by_name,
             (SELECT COALESCE(json_agg(json_build_object('id', t.id, 'status', t.sav_status) ORDER BY t.id), '[]')
                FROM sav_tickets t
               WHERE t.order_id = b.order_number
                 AND NOT COALESCE(t.is_spam, false) AND t.merged_into_id IS NULL) AS tickets,
             EXISTS (SELECT 1 FROM picking_wave_orders wo
                      WHERE wo.order_number = b.order_number AND wo.active) AS in_app_wave
      FROM picking_bms_orders b
      LEFT JOIN orders o ON o.wp_order_id::text = b.order_number
      LEFT JOIN picking_blocks pb ON pb.order_number = b.order_number
      LEFT JOIN users u ON u.id = pb.blocked_by
    `),
    pool.query('SELECT order_number, sku, product_name, qty_to_ship, qty_reserved FROM picking_bms_lines')
  ]);

  const linesByOrder = new Map();
  for (const l of lines) {
    if (!linesByOrder.has(l.order_number)) linesByOrder.set(l.order_number, []);
    linesByOrder.get(l.order_number).push(l);
  }

  // Toutes les commandes photographiées consomment du stock, listées ou non
  // (en attente dans BMS, bloquées, déjà en vague) : sans elles, leur part
  // paraîtrait libre pour les autres.
  const available = await availableBySku([...new Set(lines.map(l => l.sku))]);
  const physical = physicalFromBms(available, lines.map(l => ({ sku: l.sku, reserved: l.qty_reserved })));
  const allocation = allocateStock(
    orders.map(o => ({
      orderNumber: o.order_number,
      paidAt: o.paid_date || o.post_date || o.bms_created_at,
      lines: (linesByOrder.get(o.order_number) || []).map(l => ({ sku: l.sku, qty: l.qty_to_ship }))
    })),
    physical
  );

  const view = [];
  for (const o of orders) {
    if (o.bms_status !== 'processing' || o.in_app_wave) continue;

    const shippingMethod = o.shipping_method || o.bms_shipping_method;
    const carrier = await shippingMethodMapModel.resolve(shippingMethod);
    const tags = correctionTags(o.in_db ? o : null, carrier);
    const alloc = allocation.get(o.order_number);
    const bucket = o.block_reason ? BLOCKED : alloc.bucket;
    const name = [o.shipping_first_name || o.billing_first_name, o.shipping_last_name || o.billing_last_name]
      .filter(Boolean).join(' ').trim() || o.ship_name || '';

    view.push({
      orderNumber: o.order_number,
      name,
      country: o.shipping_country || o.billing_country || o.ship_country || null,
      shippingMethod,
      carrier: {
        status: carrier.status,
        carrierCode: carrier.carrierCode || null,
        accountCode: carrier.accountCode || null
      },
      paidAt: o.paid_date || o.post_date || o.bms_created_at,
      bucket,
      stockBucket: alloc.bucket,
      blocked: o.block_reason
        ? { reason: o.block_reason, at: o.blocked_at, by: o.blocked_by_name }
        : null,
      tags,
      tickets: o.tickets,
      bmsWaveId: o.bms_wave_id,
      items: alloc.lines.reduce((s, l) => s + l.qty, 0),
      missing: alloc.lines.reduce((s, l) => s + (l.qty - l.allocated), 0),
      selectable: !o.block_reason && tags.length === 0 && !o.bms_wave_id
        && (bucket === BUCKETS.READY || bucket === BUCKETS.PARTIAL)
    });
  }
  view.sort((a, b) => new Date(a.paidAt) - new Date(b.paidAt));
  return view;
};

const countByBucket = (view) => {
  const counts = { [BUCKETS.READY]: 0, [BUCKETS.PARTIAL]: 0, [BUCKETS.OUT]: 0, [BLOCKED]: 0 };
  for (const o of view) counts[o.bucket] = (counts[o.bucket] || 0) + 1;
  return counts;
};

// ── Blocages ───────────────────────────────────────────────────────────────

const block = async (orderNumber, reason, userId) => {
  if (blank(reason)) throw httpError(400, 'Le motif du blocage est obligatoire.');
  await pool.query(
    `INSERT INTO picking_blocks (order_number, reason, blocked_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (order_number) DO UPDATE
       SET reason = EXCLUDED.reason, blocked_by = EXCLUDED.blocked_by, blocked_at = NOW()`,
    [String(orderNumber), reason.trim(), userId || null]
  );
};

const unblock = async (orderNumber) => {
  await pool.query('DELETE FROM picking_blocks WHERE order_number = $1', [String(orderNumber)]);
};

// ── Règles ─────────────────────────────────────────────────────────────────

const ruleFromRow = (r) => ({
  id: r.id,
  name: r.name,
  denominations: r.denominations || [],
  maxOrders: r.max_orders,
  prefix: r.prefix,
  priority: r.priority,
  active: r.active
});

const listRules = async () => {
  const { rows } = await pool.query('SELECT * FROM picking_wave_rules ORDER BY priority, id');
  return rows.map(ruleFromRow);
};

const checkRule = ({ name, denominations, maxOrders, prefix }) => {
  if (blank(name)) throw httpError(400, 'Le nom de la règle est obligatoire.');
  if (!Array.isArray(denominations) || denominations.length === 0) {
    throw httpError(400, 'Cochez au moins un mode de livraison.');
  }
  if (!Number.isInteger(Number(maxOrders)) || Number(maxOrders) < 1) {
    throw httpError(400, 'La taille maximale doit être un nombre entier positif.');
  }
  if (!/^[A-Za-z0-9]{1,10}$/.test(String(prefix || ''))) {
    throw httpError(400, 'Le préfixe : 1 à 10 lettres ou chiffres, sans espace.');
  }
};

const saveRule = async (rule) => {
  checkRule(rule);
  const values = [
    rule.name.trim(), rule.denominations, Number(rule.maxOrders), rule.prefix.toUpperCase(),
    Number(rule.priority) || 0, rule.active !== false
  ];
  const { rows } = rule.id
    ? await pool.query(
      `UPDATE picking_wave_rules
          SET name = $1, denominations = $2, max_orders = $3, prefix = $4, priority = $5,
              active = $6, updated_at = NOW()
        WHERE id = $7 RETURNING *`,
      [...values, rule.id])
    : await pool.query(
      `INSERT INTO picking_wave_rules (name, denominations, max_orders, prefix, priority, active)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      values);
  if (!rows[0]) throw httpError(404, 'Règle introuvable.');
  return ruleFromRow(rows[0]);
};

const deleteRule = async (id) => {
  await pool.query('DELETE FROM picking_wave_rules WHERE id = $1', [id]);
};

/** Modes de livraison proposables dans une règle, regroupés par transporteur à l'écran. */
const listDenominations = async () => {
  const { rows } = await pool.query(
    `SELECT denomination, carrier_code, account_code
       FROM shipping_method_carrier_map
      WHERE active
      ORDER BY carrier_code NULLS LAST, account_code, denomination`
  );
  return rows.map(r => ({ denomination: r.denomination, carrierCode: r.carrier_code, accountCode: r.account_code }));
};

const getManualPrefix = async () => {
  const { rows } = await pool.query('SELECT config_value FROM app_config WHERE config_key = $1', [MANUAL_PREFIX_KEY]);
  return rows[0]?.config_value || 'MAN';
};

const setManualPrefix = async (prefix) => {
  if (!/^[A-Za-z0-9]{1,10}$/.test(String(prefix || ''))) {
    throw httpError(400, 'Le préfixe : 1 à 10 lettres ou chiffres, sans espace.');
  }
  await pool.query(
    `INSERT INTO app_config (config_key, config_value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()`,
    [MANUAL_PREFIX_KEY, prefix.toUpperCase()]
  );
};

// ── Vagues ─────────────────────────────────────────────────────────────────

const candidatesForRules = (view) => view.filter(o => o.selectable && o.bucket === BUCKETS.READY);

/**
 * Pour la fenêtre « Générer les vagues » : ce que chaque règle active
 * produirait si on la lançait maintenant. Les règles se lancent une à la fois,
 * chacune est donc calculée seule.
 *
 * `skipped` dit pourquoi des commandes « En cours » de la règle n'y sont pas :
 * sans ça, « Aucune commande » à côté d'une commande visible dans la liste
 * ressemble à une panne.
 */
const previewRules = async () => {
  const [view, rules] = await Promise.all([getOrdersView(), listRules()]);
  const candidates = candidatesForRules(view);
  const norm = (d) => String(d ?? '').trim().toLowerCase();
  return rules.filter(r => r.active).map((rule) => {
    const waves = planWaves([rule], candidates)[0]?.waves || [];
    const wanted = new Set(rule.denominations.map(norm));
    const left = view.filter(o => o.bucket === BUCKETS.READY && !o.selectable && wanted.has(norm(o.shippingMethod)));
    return {
      id: rule.id, name: rule.name, prefix: rule.prefix, maxOrders: rule.maxOrders,
      orders: waves.flat().length, waveSizes: waves.map(w => w.length),
      skipped: {
        bmsWave: left.filter(o => o.bmsWaveId).length,
        toFix: left.filter(o => !o.bmsWaveId && o.tags.length > 0).length
      }
    };
  });
};

const activeRule = async (ruleId) => {
  const rule = (await listRules()).find(r => r.id === Number(ruleId));
  if (!rule) throw httpError(404, 'Règle introuvable.');
  if (!rule.active) throw httpError(400, 'Cette règle est désactivée.');
  return rule;
};

/** Récapitulatif d'UNE règle : ses vagues et les commandes de chacune. */
const previewRule = async (ruleId) => {
  const rule = await activeRule(ruleId);
  const view = await getOrdersView();
  const byNumber = new Map(view.map(o => [o.orderNumber, o]));
  const waves = planWaves([rule], candidatesForRules(view))[0]?.waves || [];
  return {
    rule: { id: rule.id, name: rule.name, prefix: rule.prefix, maxOrders: rule.maxOrders },
    waves: waves.map(numbers => numbers.map((n) => {
      const o = byNumber.get(n);
      return {
        orderNumber: n, name: o.name, country: o.country, carrier: o.carrier,
        shippingMethod: o.shippingMethod, paidAt: o.paidAt, items: o.items
      };
    }))
  };
};

/** Insère des vagues dans une transaction : tout ou rien. */
const insertWaves = async (waves, userId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = [];
    for (const { prefix, ruleId, orderNumbers } of waves) {
      const { rows: [{ seq }] } = await client.query("SELECT nextval('picking_wave_seq') AS seq");
      const number = waveNumber(prefix, seq);
      const { rows: [wave] } = await client.query(
        `INSERT INTO picking_waves (wave_number, rule_id, created_by)
         VALUES ($1, $2, $3) RETURNING id, wave_number`,
        [number, ruleId, userId || null]
      );
      await client.query(
        `INSERT INTO picking_wave_orders (wave_id, order_number, position)
         SELECT $1, n, pos FROM unnest($2::text[]) WITH ORDINALITY AS t(n, pos)`,
        [wave.id, orderNumbers]
      );
      created.push({ id: wave.id, waveNumber: wave.wave_number, orders: orderNumbers.length });
    }
    await client.query('COMMIT');
    return created;
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      throw httpError(409, 'Une de ces commandes vient d\'être mise en vague par quelqu\'un d\'autre : actualisez la liste.');
    }
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Génère les vagues d'UNE règle. Le plan est recalculé ici, jamais repris du
 * client : entre le récapitulatif et le clic, la liste a pu bouger.
 */
const generateFromRule = async (ruleId, userId) => {
  const rule = await activeRule(ruleId);
  const view = await getOrdersView();
  const waves = planWaves([rule], candidatesForRules(view))[0]?.waves || [];
  if (waves.length === 0) throw httpError(400, `Aucune commande « En cours » libre pour la règle « ${rule.name} ».`);
  return insertWaves(waves.map(orderNumbers => ({ prefix: rule.prefix, ruleId: rule.id, orderNumbers })), userId);
};

/** Vague manuelle : commandes « En cours » ou « Partielle », sélectionnables. */
const createManualWave = async (orderNumbers, userId) => {
  const wanted = [...new Set((orderNumbers || []).map(String))];
  if (wanted.length === 0) throw httpError(400, 'Sélectionnez au moins une commande.');

  const view = await getOrdersView();
  const byNumber = new Map(view.map(o => [o.orderNumber, o]));
  const refused = wanted.filter(n => !byNumber.get(n)?.selectable);
  if (refused.length > 0) {
    throw httpError(400, `Commande(s) non disponible(s) pour une vague : ${refused.join(', ')}. Actualisez la liste.`);
  }

  const ordered = wanted.sort((a, b) => new Date(byNumber.get(a).paidAt) - new Date(byNumber.get(b).paidAt));
  return insertWaves([{ prefix: await getManualPrefix(), ruleId: null, orderNumbers: ordered }], userId);
};

const WAVE_TABS = {
  new: ['new'],
  picking: ['picking'],
  done: ['picked', 'closed']
};

const listWaves = async (tab) => {
  const statuses = WAVE_TABS[tab] || WAVE_TABS.new;
  const { rows } = await pool.query(
    `SELECT w.id, w.wave_number, w.status, w.created_at, u.name AS created_by, r.name AS rule_name,
            count(wo.order_number)::int AS orders,
            COALESCE(array_agg(DISTINCT m.carrier_code || ':' || m.account_code)
                     FILTER (WHERE m.carrier_code IS NOT NULL), '{}') AS carriers
       FROM picking_waves w
       LEFT JOIN users u ON u.id = w.created_by
       LEFT JOIN picking_wave_rules r ON r.id = w.rule_id
       LEFT JOIN picking_wave_orders wo ON wo.wave_id = w.id
       LEFT JOIN orders o ON o.wp_order_id::text = wo.order_number
       LEFT JOIN shipping_method_carrier_map m ON lower(btrim(m.denomination)) = lower(btrim(o.shipping_method))
      WHERE w.status = ANY($1)
      GROUP BY w.id, u.name, r.name
      ORDER BY w.created_at DESC
      LIMIT 200`,
    [statuses]
  );
  return rows.map(r => ({
    id: r.id,
    waveNumber: r.wave_number,
    status: r.status,
    createdAt: r.created_at,
    createdBy: r.created_by,
    ruleName: r.rule_name,
    orders: r.orders,
    carriers: r.carriers.map(c => {
      const [carrierCode, accountCode] = c.split(':');
      return { carrierCode, accountCode };
    })
  }));
};

const countWaves = async () => {
  const { rows } = await pool.query('SELECT status, count(*)::int AS n FROM picking_waves GROUP BY status');
  const n = Object.fromEntries(rows.map(r => [r.status, r.n]));
  return {
    new: n.new || 0,
    picking: n.picking || 0,
    done: (n.picked || 0) + (n.closed || 0)
  };
};

const getWave = async (id) => {
  const { rows: [wave] } = await pool.query(
    `SELECT w.*, u.name AS created_by_name, r.name AS rule_name
       FROM picking_waves w
       LEFT JOIN users u ON u.id = w.created_by
       LEFT JOIN picking_wave_rules r ON r.id = w.rule_id
      WHERE w.id = $1`,
    [id]
  );
  if (!wave) throw httpError(404, 'Vague introuvable.');

  const { rows: orders } = await pool.query(
    `SELECT wo.order_number, wo.position, o.shipping_method, o.paid_date, o.post_date,
            COALESCE(NULLIF(btrim(concat_ws(' ', o.shipping_first_name, o.shipping_last_name)), ''),
                     btrim(concat_ws(' ', o.billing_first_name, o.billing_last_name)), b.ship_name) AS name,
            COALESCE(o.shipping_country, o.billing_country, b.ship_country) AS country,
            m.carrier_code, m.account_code,
            b.order_number IS NOT NULL AS still_to_ship
       FROM picking_wave_orders wo
       LEFT JOIN orders o ON o.wp_order_id::text = wo.order_number
       LEFT JOIN picking_bms_orders b ON b.order_number = wo.order_number
       LEFT JOIN shipping_method_carrier_map m ON lower(btrim(m.denomination)) = lower(btrim(o.shipping_method))
      WHERE wo.wave_id = $1
      ORDER BY wo.position`,
    [id]
  );

  return {
    id: wave.id,
    waveNumber: wave.wave_number,
    status: wave.status,
    ruleName: wave.rule_name,
    createdAt: wave.created_at,
    createdBy: wave.created_by_name,
    cancelledAt: wave.cancelled_at,
    orders: orders.map(o => ({
      orderNumber: o.order_number,
      position: o.position,
      name: o.name,
      country: o.country,
      shippingMethod: o.shipping_method,
      carrier: { carrierCode: o.carrier_code, accountCode: o.account_code },
      paidAt: o.paid_date || o.post_date,
      stillToShip: o.still_to_ship
    }))
  };
};

/** Annule une vague pas encore commencée : ses commandes redeviennent libres. */
const cancelWave = async (id, userId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [wave] } = await client.query(
      'SELECT status FROM picking_waves WHERE id = $1 FOR UPDATE', [id]
    );
    if (!wave) throw httpError(404, 'Vague introuvable.');
    if (wave.status !== 'new') throw httpError(400, 'Seule une vague pas encore commencée peut être annulée.');

    await client.query(
      `UPDATE picking_waves SET status = 'cancelled', cancelled_by = $2, cancelled_at = NOW() WHERE id = $1`,
      [id, userId || null]
    );
    await client.query('UPDATE picking_wave_orders SET active = false WHERE wave_id = $1', [id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  TAGS,
  BLOCKED,
  correctionTags,
  getOrdersView,
  countByBucket,
  block,
  unblock,
  listRules,
  saveRule,
  deleteRule,
  listDenominations,
  getManualPrefix,
  setManualPrefix,
  previewRules,
  previewRule,
  generateFromRule,
  createManualWave,
  listWaves,
  countWaves,
  getWave,
  cancelWave
};
