/**
 * Picking au PDA (lot 3).
 *
 * Règles actées avec Pierre le 28/09/2026 :
 *   - une vague se prend par « Me l'assigner » (geste volontaire) ; ensuite
 *     personne d'autre n'y entre. « Libérer » (app de bureau, droit écriture)
 *     est la seule porte de sortie ;
 *   - les lignes sont figées à l'assignation : produits cumulés sur toute la
 *     vague, reste à expédier, packs éclatés — le même calcul que le bon ;
 *   - scan = +1, la ligne se valide seule quand la quantité est atteinte ;
 *     « Valider » met le reste d'un coup (sans code-barres, grosse quantité) ;
 *     « Manquant » déclare manquant ce qui reste à prendre ;
 *   - « Terminer » seulement quand toutes les lignes sont traitées ;
 *   - TOUT l'avancement est en base : un PDA qui plante ou qu'on change ne
 *     perd rien.
 */

const pool = require('../config/database');
const pickingModel = require('./pickingModel');
const { aggregateWaveLines } = require('../services/pickingPlanner');

const httpError = (status, message) => Object.assign(new Error(message), { statusCode: status });

const OPEN_STATUSES = ['new', 'picking'];

const lineFromRow = (r) => ({
  id: r.id,
  sku: r.sku,
  productId: r.product_id,
  name: r.name,
  brand: r.brand,
  location: r.location,
  ordersCount: r.orders_count,
  qtyNeeded: r.qty_needed,
  qtyPicked: r.qty_scanned + r.qty_manual,
  qtyScanned: r.qty_scanned,
  qtyManual: r.qty_manual,
  qtyMissing: r.qty_missing,
  done: r.qty_scanned + r.qty_manual + r.qty_missing >= r.qty_needed,
  hasBarcode: r.has_barcode
});

const LINES_SQL = `
  SELECT l.*, EXISTS (SELECT 1 FROM product_barcodes pb WHERE pb.product_id = l.product_id AND pb.type = 'unit') AS has_barcode
    FROM picking_wave_lines l
   WHERE l.wave_id = $1
   ORDER BY l.id`;

/** Vagues à préparer (nouvelles + en cours), et celle en cours de l'utilisateur. */
const listWaves = async (userId) => {
  const { rows } = await pool.query(
    `SELECT w.id, w.wave_number, w.status, w.created_at, w.assigned_to, u.name AS assigned_name,
            count(wo.order_number)::int AS orders,
            COALESCE(array_agg(DISTINCT m.carrier_code || ':' || m.account_code)
                     FILTER (WHERE m.carrier_code IS NOT NULL), '{}') AS carriers,
            (SELECT COALESCE(sum(qty_needed), 0)::int FROM picking_wave_lines l WHERE l.wave_id = w.id) AS items,
            (SELECT COALESCE(sum(qty_scanned + qty_manual + qty_missing), 0)::int FROM picking_wave_lines l WHERE l.wave_id = w.id) AS items_done
       FROM picking_waves w
       LEFT JOIN users u ON u.id = w.assigned_to
       LEFT JOIN picking_wave_orders wo ON wo.wave_id = w.id
       LEFT JOIN orders o ON o.wp_order_id::text = wo.order_number
       LEFT JOIN shipping_method_carrier_map m ON lower(btrim(m.denomination)) = lower(btrim(o.shipping_method))
      WHERE w.status = ANY($1)
      GROUP BY w.id, u.name
      ORDER BY w.created_at`,
    [OPEN_STATUSES]
  );
  const waves = rows.map(r => ({
    id: r.id,
    waveNumber: r.wave_number,
    status: r.status,
    createdAt: r.created_at,
    orders: r.orders,
    items: r.items,
    itemsDone: r.items_done,
    assignedTo: r.assigned_name,
    mine: r.assigned_to === userId,
    locked: r.assigned_to !== null && r.assigned_to !== userId,
    carriers: r.carriers.map(c => {
      const [carrierCode, accountCode] = c.split(':');
      return { carrierCode, accountCode };
    })
  }));
  return { waves, current: waves.find(w => w.mine && w.status === 'picking')?.id || null };
};

/** Retrouve une vague par son numéro scanné sur la page de garde. */
const findByNumber = async (number) => {
  const { rows: [w] } = await pool.query(
    'SELECT id, status FROM picking_waves WHERE upper(wave_number) = upper($1)',
    [String(number || '').trim()]
  );
  if (!w) throw httpError(404, `Vague « ${number} » inconnue.`);
  if (!OPEN_STATUSES.includes(w.status)) throw httpError(400, `La vague ${number} n'est plus à préparer.`);
  return w.id;
};

/** Lignes calculées à la volée (vague pas encore assignée : aperçu). */
const computeLines = async (waveId) => {
  const data = await pickingModel.getWavePrintData(waveId);
  return aggregateWaveLines(data.orders);
};

/**
 * Une vague pour le PDA. Tant qu'elle n'est pas assignée, ses lignes sont un
 * aperçu recalculé ; ensuite ce sont les lignes figées, avec l'avancement.
 */
const getWave = async (waveId, userId) => {
  const { rows: [w] } = await pool.query(
    `SELECT w.*, u.name AS assigned_name, r.name AS rule_name,
            (SELECT count(*)::int FROM picking_wave_orders wo WHERE wo.wave_id = w.id) AS orders
       FROM picking_waves w
       LEFT JOIN users u ON u.id = w.assigned_to
       LEFT JOIN picking_wave_rules r ON r.id = w.rule_id
      WHERE w.id = $1`,
    [waveId]
  );
  if (!w) throw httpError(404, 'Vague introuvable.');
  if (w.status === 'cancelled') throw httpError(400, 'Cette vague a été annulée.');

  const { rows } = await pool.query(LINES_SQL, [waveId]);
  const frozen = rows.length > 0;
  const lines = frozen
    ? rows.map(lineFromRow)
    : (await computeLines(waveId)).map((l, i) => ({
      id: `apercu-${i}`, sku: l.sku, productId: l.productId, name: l.name, brand: l.brand, location: l.location,
      ordersCount: l.ordersCount, qtyNeeded: l.qtyNeeded, qtyPicked: 0, qtyScanned: 0, qtyManual: 0,
      qtyMissing: 0, done: false, hasBarcode: null
    }));

  return {
    id: w.id,
    waveNumber: w.wave_number,
    status: w.status,
    ruleName: w.rule_name,
    orders: w.orders,
    assignedTo: w.assigned_name,
    mine: w.assigned_to === userId && w.status === 'picking',
    locked: w.assigned_to !== null && w.assigned_to !== userId,
    lines
  };
};

/**
 * « Me l'assigner » : une seule personne par vague. L'UPDATE conditionnel est
 * le verrou — deux PDA qui cliquent à la même seconde, un seul gagne.
 * Les lignes sont figées à la première assignation ; après un « Libérer »,
 * celui qui reprend retrouve l'avancement tel quel.
 */
const assign = async (waveId, userId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [won] } = await client.query(
      `UPDATE picking_waves
          SET assigned_to = $2, assigned_at = NOW(), status = 'picking'
        WHERE id = $1 AND status = ANY($3) AND (assigned_to IS NULL OR assigned_to = $2)
        RETURNING id`,
      [waveId, userId, OPEN_STATUSES]
    );
    if (!won) {
      const { rows: [w] } = await client.query(
        'SELECT w.status, u.name FROM picking_waves w LEFT JOIN users u ON u.id = w.assigned_to WHERE w.id = $1',
        [waveId]
      );
      if (!w) throw httpError(404, 'Vague introuvable.');
      if (!OPEN_STATUSES.includes(w.status)) throw httpError(400, 'Cette vague n\'est plus à préparer.');
      throw httpError(409, `Vague déjà en cours par ${w.name || 'quelqu\'un d\'autre'}.`);
    }

    const { rows: [{ n }] } = await client.query('SELECT count(*)::int AS n FROM picking_wave_lines WHERE wave_id = $1', [waveId]);
    if (n === 0) {
      const lines = await computeLines(waveId);
      if (lines.length === 0) throw httpError(400, 'Rien à préparer dans cette vague : ses commandes sont déjà expédiées.');
      await client.query(
        `INSERT INTO picking_wave_lines
           (wave_id, line_key, product_id, sku, name, brand, location, orders_count, qty_needed)
         SELECT $1, * FROM unnest($2::text[], $3::int[], $4::text[], $5::text[], $6::text[], $7::text[], $8::int[], $9::int[])`,
        [
          waveId,
          lines.map(l => l.lineKey),
          lines.map(l => l.productId),
          lines.map(l => l.sku),
          lines.map(l => l.name),
          lines.map(l => l.brand),
          lines.map(l => l.location),
          lines.map(l => l.ordersCount),
          lines.map(l => l.qtyNeeded)
        ]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const assertMine = async (waveId, userId) => {
  const { rows: [w] } = await pool.query('SELECT status, assigned_to FROM picking_waves WHERE id = $1', [waveId]);
  if (!w) throw httpError(404, 'Vague introuvable.');
  if (w.status !== 'picking' || w.assigned_to !== userId) {
    throw httpError(403, 'Cette vague ne vous est pas assignée.');
  }
};

const readLine = async (lineId) => {
  const { rows: [r] } = await pool.query(
    `SELECT l.*, EXISTS (SELECT 1 FROM product_barcodes pb WHERE pb.product_id = l.product_id AND pb.type = 'unit') AS has_barcode
       FROM picking_wave_lines l WHERE l.id = $1`,
    [lineId]
  );
  return lineFromRow(r);
};

// Marque la ligne « traitée par » dès qu'elle est complète.
const DONE_SET = `
  done_by = CASE WHEN qty_scanned + qty_manual + qty_missing >= qty_needed THEN $2::int ELSE NULL END,
  done_at = CASE WHEN qty_scanned + qty_manual + qty_missing >= qty_needed THEN NOW() ELSE NULL END,
  updated_at = NOW()`;

/**
 * Scan d'un code-barres produit : +1 sur la ligne du produit. Tous les codes
 * « unité » du produit sont acceptés ; un code de carton est refusé (quantité
 * par carton inconnue en base). La ligne se valide seule à la quantité.
 */
const scan = async (waveId, userId, code) => {
  await assertMine(waveId, userId);
  const value = String(code || '').trim();
  if (!value) throw httpError(400, 'Code vide.');

  const { rows: matches } = await pool.query(
    `SELECT l.id AS line_id, pb.type
       FROM picking_wave_lines l
       JOIN product_barcodes pb ON pb.product_id = l.product_id
      WHERE l.wave_id = $1 AND pb.barcode = $2
     UNION
     SELECT l.id, 'sku' FROM picking_wave_lines l WHERE l.wave_id = $1 AND l.sku = $2`,
    [waveId, value]
  );
  if (matches.length === 0) throw httpError(404, `Ce produit n'est pas dans la vague (${value}).`);
  const unit = matches.find(m => m.type !== 'pack');
  if (!unit) throw httpError(400, 'Code d\'un carton : scannez l\'unité.');

  const { rows: [updated] } = await pool.query(
    `UPDATE picking_wave_lines
        SET qty_scanned = qty_scanned + 1,
            done_by = CASE WHEN qty_scanned + 1 + qty_manual + qty_missing >= qty_needed THEN $2::int ELSE NULL END,
            done_at = CASE WHEN qty_scanned + 1 + qty_manual + qty_missing >= qty_needed THEN NOW() ELSE NULL END,
            updated_at = NOW()
      WHERE id = $1 AND qty_scanned + qty_manual + qty_missing < qty_needed
      RETURNING id`,
    [unit.line_id, userId]
  );
  if (!updated) throw httpError(409, 'Quantité déjà complète pour ce produit.');
  return readLine(unit.line_id);
};

/** « Valider » : le reste à prendre est pris, sans scan. */
const validate = async (waveId, userId, lineId) => {
  await assertMine(waveId, userId);
  const { rows: [r] } = await pool.query(
    `UPDATE picking_wave_lines
        SET qty_manual = qty_manual + (qty_needed - qty_scanned - qty_manual - qty_missing), ${DONE_SET}
      WHERE id = $1 AND wave_id = $3
      RETURNING id`,
    [lineId, userId, waveId]
  );
  if (!r) throw httpError(404, 'Ligne introuvable.');
  return readLine(lineId);
};

/** « Manquant » : ce qui reste à prendre est déclaré manquant. */
const markMissing = async (waveId, userId, lineId) => {
  await assertMine(waveId, userId);
  const { rows: [r] } = await pool.query(
    `UPDATE picking_wave_lines
        SET qty_missing = qty_missing + (qty_needed - qty_scanned - qty_manual - qty_missing), ${DONE_SET}
      WHERE id = $1 AND wave_id = $3
      RETURNING id`,
    [lineId, userId, waveId]
  );
  if (!r) throw httpError(404, 'Ligne introuvable.');
  return readLine(lineId);
};

/**
 * Annule un « Valider » ou un « Manquant » fait par erreur (un doigt qui
 * glisse sur un écran tactile). Les scans, eux, restent : ils correspondent à
 * des produits réellement dans le bac.
 */
const undo = async (waveId, userId, lineId) => {
  await assertMine(waveId, userId);
  const { rows: [r] } = await pool.query(
    `UPDATE picking_wave_lines
        SET qty_manual = 0, qty_missing = 0, ${DONE_SET}
      WHERE id = $1 AND wave_id = $3
      RETURNING id`,
    [lineId, userId, waveId]
  );
  if (!r) throw httpError(404, 'Ligne introuvable.');
  return readLine(lineId);
};

/** « Terminer la vague » : seulement quand chaque ligne est complète ou manquante. */
const finish = async (waveId, userId) => {
  await assertMine(waveId, userId);
  const { rows: [{ open }] } = await pool.query(
    `SELECT count(*)::int AS open FROM picking_wave_lines
      WHERE wave_id = $1 AND qty_scanned + qty_manual + qty_missing < qty_needed`,
    [waveId]
  );
  if (open > 0) throw httpError(400, `Il reste ${open} ligne(s) à traiter.`);
  await pool.query(
    `UPDATE picking_waves SET status = 'picked', picked_by = $2, picked_at = NOW() WHERE id = $1`,
    [waveId, userId]
  );
};

/** « Libérer » (app de bureau) : la vague redevient libre, l'avancement est gardé. */
const release = async (waveId) => {
  const { rows: [w] } = await pool.query(
    `UPDATE picking_waves SET assigned_to = NULL, assigned_at = NULL, status = 'new'
      WHERE id = $1 AND status = 'picking' RETURNING id`,
    [waveId]
  );
  if (!w) throw httpError(400, 'Seule une vague en cours de picking peut être libérée.');
};

module.exports = {
  listWaves,
  findByNumber,
  getWave,
  assign,
  scan,
  validate,
  markMissing,
  undo,
  finish,
  release
};
