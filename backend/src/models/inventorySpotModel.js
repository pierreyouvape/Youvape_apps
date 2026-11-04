/**
 * Inventaire PAR EMPLACEMENT (04/11/2026, validé avec Pierre).
 *
 * Un dossier (inventories.kind = 'location') se crée au PC ou au PDA. On y
 * scanne n'importe quel emplacement BMS : c'est un PASSAGE, une personne à la
 * fois sur un emplacement, qui garde qui l'a validé et quand.
 *
 *   - le PDA liste les produits rangés là avec leur quantité (physique BMS −
 *     prélevé non expédié, lue à l'ouverture) — PAS à l'aveugle ; on la
 *     corrige en absolu ;
 *   - un produit attendu avec du stock doit être VU (scanné, ou quantité
 *     saisie) ; à la validation, ceux qui ne l'ont pas été passent à 0 ou sont
 *     « rangés ailleurs » (nouvel emplacement). Un produit à 0 qu'on ne touche
 *     pas reste à 0 ;
 *   - un produit trouvé ici s'ajoute : sa quantité devient son stock TOTAL
 *     (BMS ne connaît qu'un emplacement par produit) et il est rangé ici ;
 *   - un produit engagé dans un inventaire classique ouvert est en lecture
 *     seule : son écart partirait deux fois ;
 *   - la validation envoie tout à BMS (services/inventorySpotService), sans
 *     recomptage ni relecture au bureau.
 */

const pool = require('../config/database');
const pdaProductModel = require('./pdaProductModel');
const inventoryModel = require('./inventoryModel');
const { lookupCode } = require('./inventoryPdaModel');
const inventorySpotService = require('../services/inventorySpotService');
const { mustBeSeen, theoreticalOf } = require('../services/inventoryRules');

const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { statusCode: status }, extra);

// Les inventaires classiques ouverts : une référence qui y est comptée n'est
// pas corrigée ici.
const CLASSIC_BUSY_SQL = `
  SELECT oi.product_id, ov.name FROM inventory_items oi
    JOIN inventories ov ON ov.id = oi.inventory_id AND ov.status = 'open'`;

const normLocation = (column) => `regexp_replace(upper(btrim(${column})), '\\s+', ' ', 'g')`;

// ── Dossier ─────────────────────────────────────────────────────────────────

const create = async (name, userId) => {
  const today = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris' }).format(new Date());
  const title = (String(name || '').trim() || `Inventaire par emplacement du ${today}`).slice(0, 120);
  const { rows: [v] } = await pool.query(
    `INSERT INTO inventories (name, kind, filters, created_by) VALUES ($1, 'location', '{}', $2) RETURNING id, name`,
    [title, userId]
  );
  await inventoryModel.log(v.id, userId, 'create');
  return { id: v.id, name: v.name };
};

const loadInventory = async (inventoryId) => {
  const { rows: [v] } = await pool.query('SELECT id, name, kind, status FROM inventories WHERE id = $1', [inventoryId]);
  if (!v || v.kind !== 'location') throw httpError(404, 'Inventaire par emplacement introuvable.');
  return v;
};

const loadOpenInventory = async (inventoryId) => {
  const v = await loadInventory(inventoryId);
  if (v.status !== 'open') throw httpError(400, 'Cet inventaire n\'est plus en cours.');
  return v;
};

// ── Un passage ──────────────────────────────────────────────────────────────

const PASS_SQL = `
  SELECT s.*, v.name AS inventory_name, v.status AS inventory_status,
         ub.name AS started_name, uv.name AS validated_name, ua.name AS abandoned_name
    FROM inventory_spot_passes s
    JOIN inventories v ON v.id = s.inventory_id
    LEFT JOIN users ub ON ub.id = s.started_by
    LEFT JOIN users uv ON uv.id = s.validated_by
    LEFT JOIN users ua ON ua.id = s.abandoned_by`;

const LINES_SQL = `
  SELECT l.*, COALESCE(p.image_url, pp.image_url) AS image_url,
         COALESCE(NULLIF(p.brand, ''), pp.brand) AS brand, p.post_status,
         COALESCE(p.computed_cost, p.wc_cog_cost, 0)::float AS cost,
         EXISTS (SELECT 1 FROM product_barcodes pb WHERE pb.product_id = l.product_id) AS has_barcode
    FROM inventory_spot_lines l
    JOIN products p ON p.id = l.product_id
    LEFT JOIN products pp ON p.product_type = 'variation' AND pp.wp_product_id = p.wp_parent_id`;

/** Écart envoyé (ou à envoyer) : connu une fois le stock relu à l'envoi. */
const lineOut = (l) => {
  const theoretical = l.push_physical != null ? theoreticalOf(l.push_physical, l.push_picked) : null;
  const gap = theoretical != null && l.outcome === 'count' ? l.qty - theoretical : null;
  return {
    id: l.id,
    productId: l.product_id,
    sku: l.sku,
    name: l.name,
    brand: l.brand,
    imageUrl: l.image_url || null,
    hasBarcode: l.has_barcode,
    notPublished: l.post_status !== 'publish',
    added: l.added,
    fromLocation: l.from_location,
    lockedBy: l.locked_by_inventory,
    reading: l.ref_needed,
    refError: l.ref_error,
    shownQty: l.shown_qty,
    bmsLocation: l.bms_location,
    qty: l.qty,
    outcome: l.outcome,
    movedTo: l.moved_to,
    seen: l.qty != null || l.outcome === 'moved',
    mustSee: mustBeSeen(l),
    theoretical,
    gap,
    value: gap == null ? null : Math.round(gap * l.cost * 100) / 100,
    pushStatus: l.push_status,
    pushQty: l.push_qty,
    pushAt: l.push_at,
    pushError: l.push_error,
    bmsMovementId: l.bms_movement_id,
  };
};

// En haut : ce qu'on s'attend à trouver ; en bas, grisés : les produits à 0
// pas encore vus, puis ceux d'un inventaire classique.
const lineRank = (l) => {
  if (l.lockedBy) return 2;
  if (!l.added && !l.seen && l.shownQty === 0) return 1;
  return 0;
};

const passOut = (s, lines, userId) => {
  const out = lines.map(lineOut).sort((a, b) => lineRank(a) - lineRank(b) || a.name.localeCompare(b.name, 'fr'));
  return {
    id: s.id,
    inventoryId: s.inventory_id,
    inventoryName: s.inventory_name,
    location: s.location,
    status: s.status,
    startedBy: s.started_name,
    startedAt: s.started_at,
    validatedBy: s.validated_name,
    validatedAt: s.validated_at,
    abandonedBy: s.abandoned_name,
    abandonedAt: s.abandoned_at,
    mailDoneAt: s.mail_done_at,
    mailRows: s.mail_rows,
    mailError: s.mail_error,
    mine: s.started_by === userId,
    canCount: s.status === 'counting' && s.started_by === userId && s.inventory_status === 'open',
    reading: out.filter(l => l.reading).length,
    lines: out,
  };
};

const getPass = async (passId, userId) => {
  const { rows: [s] } = await pool.query(`${PASS_SQL} WHERE s.id = $1`, [passId]);
  if (!s) throw httpError(404, 'Passage introuvable.');
  const { rows: lines } = await pool.query(`${LINES_SQL} WHERE l.pass_id = $1`, [passId]);
  if (lines.some(l => l.ref_needed)) inventorySpotService.kickRefs();
  return passOut(s, lines, userId);
};

/** Scan d'une étiquette de rayon : ouvre le passage (ou reprend le sien). */
const openPass = async (inventoryId, code, userId) => {
  const v = await loadOpenInventory(inventoryId);
  const location = pdaProductModel.resolveLocation(await pdaProductModel.listLocations(), code);
  if (!location) throw httpError(404, `Emplacement inconnu de BMS : « ${String(code || '').trim()} ».`);

  const { rows: [current] } = await pool.query(
    `${PASS_SQL} WHERE s.location = $1 AND s.status = 'counting'`, [location]
  );
  if (current) {
    if (current.started_by === userId && current.inventory_id === v.id) return getPass(current.id, userId);
    throw httpError(409, `${location} est en cours de comptage par ${current.started_name || 'quelqu\'un'}`
      + ` (inventaire « ${current.inventory_name} »).`);
  }

  const client = await pool.connect();
  let passId;
  try {
    await client.query('BEGIN');
    const { rows: [s] } = await client.query(
      `INSERT INTO inventory_spot_passes (inventory_id, location, started_by) VALUES ($1, $2, $3) RETURNING id`,
      [v.id, location, userId]
    );
    passId = s.id;
    await client.query(
      `INSERT INTO inventory_spot_lines (pass_id, product_id, sku, name, locked_by_inventory)
       SELECT $1::int, p.id, p.sku, p.post_title,
              (SELECT busy.name FROM (${CLASSIC_BUSY_SQL}) busy WHERE busy.product_id = p.id LIMIT 1)
         FROM products p
        WHERE p.product_type IN ('simple', 'variation') AND p.wc_deleted_at IS NULL
          AND ${normLocation('p.shelf_location')} = ${normLocation('$2::text')}`,
      [passId, location]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') throw httpError(409, `${location} vient d'être pris par quelqu'un d'autre.`);
    throw error;
  } finally {
    client.release();
  }
  await inventoryModel.log(v.id, userId, 'spot_open', { code: location });
  inventorySpotService.kickRefs();
  return getPass(passId, userId);
};

const assertMine = async (passId, userId) => {
  const { rows: [s] } = await pool.query(`${PASS_SQL} WHERE s.id = $1`, [passId]);
  if (!s || s.inventory_status !== 'open') throw httpError(404, 'Passage introuvable dans un inventaire en cours.');
  if (s.status !== 'counting') throw httpError(409, 'Cet emplacement est déjà validé.');
  if (s.started_by !== userId) throw httpError(403, `Emplacement en cours de comptage par ${s.started_name || 'quelqu\'un d\'autre'}.`);
  return s;
};

const loadLine = async (passId, lineId) => {
  const { rows: [l] } = await pool.query('SELECT * FROM inventory_spot_lines WHERE id = $1 AND pass_id = $2', [lineId, passId]);
  if (!l) throw httpError(404, 'Produit introuvable dans cet emplacement.');
  if (l.locked_by_inventory) throw httpError(409, `Produit compté dans l'inventaire « ${l.locked_by_inventory} » : rien à faire ici.`);
  if (l.ref_error) throw httpError(409, `${l.ref_error} : rien à corriger ici.`);
  return l;
};

const productNames = async (ids) => {
  const { rows } = await pool.query('SELECT id, sku, post_title FROM products WHERE id = ANY($1::int[])', [ids]);
  return rows.map(r => ({ productId: r.id, sku: r.sku, name: r.post_title }));
};

/**
 * Scan d'un produit : s'il est dans la liste, il est VU à la quantité
 * affichée. Sinon, le PDA propose de l'ajouter (`NOT_HERE`).
 */
const scan = async (passId, userId, code, chosenProductId) => {
  const s = await assertMine(passId, userId);
  const value = String(code || '').trim();
  if (!value) throw httpError(400, 'Code vide.');
  let matches = await lookupCode(value);
  if (chosenProductId) matches = matches.filter(m => m.productId === Number(chosenProductId));
  const ids = [...new Set(matches.map(m => m.productId))];
  if (ids.length === 0) throw httpError(404, `Code inconnu (${value}).`);

  const { rows: lines } = await pool.query(
    'SELECT * FROM inventory_spot_lines WHERE pass_id = $1 AND product_id = ANY($2::int[])', [passId, ids]
  );
  if (lines.length !== 1) {
    const choices = lines.length > 1 ? lines.map(l => l.product_id) : ids;
    if (choices.length > 1) {
      throw httpError(409, 'Ce code désigne plusieurs produits : lequel avez-vous en main ?', {
        code: 'AMBIGUOUS', barcode: value, choices: await productNames(choices),
      });
    }
    const { rows: [p] } = await pool.query(
      `SELECT p.id, p.sku, p.post_title, NULLIF(btrim(p.shelf_location), '') AS location,
              COALESCE(p.image_url, pp.image_url) AS image_url
         FROM products p
         LEFT JOIN products pp ON p.product_type = 'variation' AND pp.wp_product_id = p.wp_parent_id
        WHERE p.id = $1 AND p.product_type IN ('simple', 'variation') AND p.wc_deleted_at IS NULL`,
      [ids[0]]
    );
    if (!p) throw httpError(404, `Ce code désigne un pack, scannez ses articles (${value}).`);
    throw httpError(404, `« ${p.post_title} » n'est pas rangé ici.`, {
      code: 'NOT_HERE',
      product: { productId: p.id, sku: p.sku, name: p.post_title, location: p.location, imageUrl: p.image_url },
    });
  }

  const line = lines[0];
  if (line.locked_by_inventory) throw httpError(409, `Produit compté dans l'inventaire « ${line.locked_by_inventory} » : rien à faire ici.`);
  if (line.ref_error) throw httpError(409, `${line.ref_error} : rien à corriger ici.`);
  if (line.qty == null && line.outcome !== 'moved') {
    if (line.ref_needed) throw httpError(409, 'Stock en cours de lecture dans BMS : rescannez dans un instant.');
    await pool.query(
      `UPDATE inventory_spot_lines SET qty = COALESCE(shown_qty, 0), outcome = 'count', counted_by = $2, counted_at = NOW()
        WHERE id = $1`,
      [line.id, userId]
    );
    await inventoryModel.log(s.inventory_id, userId, 'spot_seen', { productId: line.product_id, code: s.location });
  }
  return { ...(await getPass(passId, userId)), scanned: { lineId: line.id } };
};

const checkQty = (qty, min = 0) => {
  const n = Number(qty);
  if (!Number.isInteger(n) || n < min || n > 100000) throw httpError(400, 'Quantité invalide.');
  return n;
};

/** Quantité saisie, en absolu (0 = il n'y en a plus). */
const setQty = async (passId, userId, lineId, qty) => {
  const s = await assertMine(passId, userId);
  const l = await loadLine(passId, lineId);
  const n = checkQty(qty);
  await pool.query(
    `UPDATE inventory_spot_lines SET qty = $2, outcome = 'count', moved_to = NULL, counted_by = $3, counted_at = NOW()
      WHERE id = $1`,
    [l.id, n, userId]
  );
  await inventoryModel.log(s.inventory_id, userId, 'spot_set', { productId: l.product_id, qty: n, code: s.location });
  return getPass(passId, userId);
};

/** « Rangé ailleurs » : il change d'emplacement dans BMS, sa quantité n'est pas touchée. */
const moveLine = async (passId, userId, lineId, code) => {
  const s = await assertMine(passId, userId);
  const l = await loadLine(passId, lineId);
  if (l.added) throw httpError(400, 'Produit ajouté ici : retirez-le plutôt.');
  const target = pdaProductModel.resolveLocation(await pdaProductModel.listLocations(), code);
  if (!target) throw httpError(404, `Emplacement inconnu de BMS : « ${String(code || '').trim()} ».`);
  if (target === s.location) throw httpError(400, `C'est l'emplacement que vous comptez (${target}).`);
  await pool.query(
    `UPDATE inventory_spot_lines SET outcome = 'moved', moved_to = $2, qty = NULL, counted_by = $3, counted_at = NOW()
      WHERE id = $1`,
    [l.id, target, userId]
  );
  await inventoryModel.log(s.inventory_id, userId, 'spot_moved', { productId: l.product_id, code: target });
  return getPass(passId, userId);
};

/** Un produit trouvé ici : sa quantité devient son stock total, et il est rangé ici. */
const addProduct = async (passId, userId, productId, qty) => {
  const s = await assertMine(passId, userId);
  const n = checkQty(qty, 1);
  const { rows: [p] } = await pool.query(
    `SELECT p.id, p.sku, p.post_title, NULLIF(btrim(p.shelf_location), '') AS location,
            (SELECT busy.name FROM (${CLASSIC_BUSY_SQL}) busy WHERE busy.product_id = p.id LIMIT 1) AS busy_in,
            (SELECT os.location || ' par ' || COALESCE(u.name, '?')
               FROM inventory_spot_lines ol
               JOIN inventory_spot_passes os ON os.id = ol.pass_id AND os.status = 'counting' AND os.id <> $2
               LEFT JOIN users u ON u.id = os.started_by
              WHERE ol.product_id = p.id LIMIT 1) AS counting_in
       FROM products p
      WHERE p.id = $1 AND p.product_type IN ('simple', 'variation') AND p.wc_deleted_at IS NULL`,
    [productId, passId]
  );
  if (!p) throw httpError(404, 'Produit introuvable.');
  if (p.busy_in) throw httpError(409, `Produit compté dans l'inventaire « ${p.busy_in} » : rien à faire ici.`);
  if (p.counting_in) throw httpError(409, `Produit en cours de comptage en ${p.counting_in}.`);

  const { rows: [existing] } = await pool.query(
    'SELECT id FROM inventory_spot_lines WHERE pass_id = $1 AND product_id = $2', [passId, p.id]
  );
  if (existing) return setQty(passId, userId, existing.id, n);

  const norm = (x) => String(x || '').trim().toUpperCase().replace(/\s+/g, ' ');
  const added = norm(p.location) !== norm(s.location);
  await pool.query(
    `INSERT INTO inventory_spot_lines (pass_id, product_id, sku, name, added, from_location, qty, outcome, counted_by, counted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'count', $8, NOW())`,
    [passId, p.id, p.sku, p.post_title, added, added ? p.location : null, n, userId]
  );
  await inventoryModel.log(s.inventory_id, userId, 'spot_add', { productId: p.id, qty: n, code: s.location });
  inventorySpotService.kickRefs();
  return getPass(passId, userId);
};

/** Retire un produit ajouté par erreur (un produit attendu se met à 0 ou « rangé ailleurs »). */
const removeLine = async (passId, userId, lineId) => {
  const s = await assertMine(passId, userId);
  const l = await loadLine(passId, lineId);
  if (!l.added) throw httpError(400, 'Produit rangé ici : mettez 0, ou « Rangé ailleurs ».');
  await pool.query('DELETE FROM inventory_spot_lines WHERE id = $1', [l.id]);
  await inventoryModel.log(s.inventory_id, userId, 'spot_remove', { productId: l.product_id, code: s.location });
  return getPass(passId, userId);
};

/**
 * Valider l'emplacement : tout ce qui avait du stock a été vu, puis tout part
 * dans la file d'envoi BMS. Les produits non vus sont renvoyés (`UNSEEN`) :
 * le PDA demande pour chacun « Quantité 0 » ou « Rangé ailleurs ».
 */
const validate = async (passId, userId) => {
  const s = await assertMine(passId, userId);
  // Un inventaire classique a pu s'ouvrir depuis : ses références restent à lui.
  await pool.query(
    `UPDATE inventory_spot_lines l SET locked_by_inventory = busy.name
       FROM (${CLASSIC_BUSY_SQL}) busy
      WHERE l.pass_id = $1 AND busy.product_id = l.product_id AND l.locked_by_inventory IS NULL`,
    [passId]
  );
  const { rows: lines } = await pool.query(`${LINES_SQL} WHERE l.pass_id = $1`, [passId]);
  const reading = lines.filter(l => l.ref_needed && !l.added && !l.locked_by_inventory);
  if (reading.length) {
    inventorySpotService.kickRefs();
    throw httpError(409, `Stock encore en lecture dans BMS (${reading.length} produit${reading.length > 1 ? 's' : ''}) : patientez quelques secondes.`);
  }
  const unseen = lines.filter(mustBeSeen);
  if (unseen.length) {
    throw httpError(409, `${unseen.length} produit(s) attendu(s) pas vu(s).`, {
      code: 'UNSEEN', lines: unseen.map(lineOut),
    });
  }

  const client = await pool.connect();
  let queued;
  try {
    await client.query('BEGIN');
    const { rows: [won] } = await client.query(
      `UPDATE inventory_spot_passes SET status = 'validated', validated_by = $2, validated_at = NOW()
        WHERE id = $1 AND status = 'counting' AND started_by = $2 RETURNING id`,
      [passId, userId]
    );
    if (!won) throw httpError(409, 'Cet emplacement est déjà validé.');
    ({ rowCount: queued } = await client.query(
      `UPDATE inventory_spot_lines SET push_status = 'queued'
        WHERE pass_id = $1 AND locked_by_inventory IS NULL AND ref_error IS NULL
          AND (qty IS NOT NULL OR outcome = 'moved')`,
      [passId]
    ));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await inventoryModel.log(s.inventory_id, userId, 'spot_validate', { qty: queued, code: s.location });
  inventorySpotService.kickPushes();
  return { queued, location: s.location };
};

/** Abandon d'un passage (rien n'est envoyé) : par son compteur au PDA, ou « Libérer » au PC. */
const abandon = async (passId, userId, { inventoryId = null, anyone = false } = {}) => {
  const { rows: [s] } = await pool.query(
    `UPDATE inventory_spot_passes SET status = 'abandoned', abandoned_by = $2, abandoned_at = NOW()
      WHERE id = $1 AND status = 'counting' AND ($3 OR started_by = $2) AND ($4::int IS NULL OR inventory_id = $4)
      RETURNING inventory_id, location`,
    [passId, userId, anyone, inventoryId]
  );
  if (!s) throw httpError(400, 'Seul un emplacement en cours peut être abandonné.');
  await inventoryModel.log(s.inventory_id, userId, 'spot_abandon', { code: s.location });
};

// ── Accueil PDA ─────────────────────────────────────────────────────────────

const PASS_SUMMARY_SQL = `
  SELECT s.id, s.location, s.status, s.started_at, s.validated_at, ub.name AS started_name, uv.name AS validated_name,
         s.started_by, s.mail_done_at, s.mail_rows, s.mail_error,
         count(l.id)::int AS lines,
         count(l.id) FILTER (WHERE l.push_status IN ('queued', 'sending'))::int AS sending,
         count(l.id) FILTER (WHERE l.push_status = 'sent')::int AS sent,
         count(l.id) FILTER (WHERE l.push_status = 'error')::int AS errors
    FROM inventory_spot_passes s
    LEFT JOIN inventory_spot_lines l ON l.pass_id = s.id
    LEFT JOIN users ub ON ub.id = s.started_by
    LEFT JOIN users uv ON uv.id = s.validated_by`;

const summaryOut = (r, userId) => ({
  id: r.id, location: r.location, status: r.status, startedBy: r.started_name, startedAt: r.started_at,
  validatedBy: r.validated_name, validatedAt: r.validated_at, mine: r.started_by === userId,
  lines: r.lines, sending: r.sending, sent: r.sent, errors: r.errors,
  mailDoneAt: r.mail_done_at, mailRows: r.mail_rows, mailError: r.mail_error,
});

const home = async (inventoryId, userId) => {
  const v = await loadOpenInventory(inventoryId);
  const { rows } = await pool.query(
    `${PASS_SUMMARY_SQL}
      WHERE s.inventory_id = $1 AND s.status <> 'abandoned'
        AND (s.status = 'counting' OR s.validated_at >= date_trunc('day', NOW()))
      GROUP BY s.id, ub.name, uv.name
      ORDER BY s.status = 'counting' DESC, s.validated_at DESC NULLS LAST`,
    [v.id]
  );
  const { rows: [t] } = await pool.query(
    `SELECT count(*) FILTER (WHERE status = 'validated')::int AS validated FROM inventory_spot_passes WHERE inventory_id = $1`,
    [v.id]
  );
  return {
    inventory: { id: v.id, name: v.name, kind: v.kind },
    validated: t.validated,
    passes: rows.map(r => summaryOut(r, userId)),
  };
};

// ── PC ──────────────────────────────────────────────────────────────────────

const closeCheck = async (inventoryId) => {
  const { rows: [s] } = await pool.query(
    `SELECT count(DISTINCT s.id) FILTER (WHERE s.status = 'counting')::int AS counting,
            count(l.id) FILTER (WHERE l.push_status IN ('queued', 'sending'))::int AS sending,
            count(l.id) FILTER (WHERE l.push_status = 'error')::int AS errors
       FROM inventory_spot_passes s LEFT JOIN inventory_spot_lines l ON l.pass_id = s.id
      WHERE s.inventory_id = $1`,
    [inventoryId]
  );
  const reasons = [];
  if (s.counting) reasons.push(`${s.counting} emplacement(s) en cours de comptage`);
  if (s.sending) reasons.push(`${s.sending} envoi(s) BMS en cours`);
  if (s.errors) reasons.push(`${s.errors} envoi(s) BMS en erreur`);
  return { closable: reasons.length === 0, reasons };
};

/** Fiche du dossier : chaque passage avec ses lignes. */
const detail = async (inventoryId) => {
  const { rows: [v] } = await pool.query(
    `SELECT v.*, u.name AS created_by_name, uc.name AS closed_by_name FROM inventories v
       LEFT JOIN users u ON u.id = v.created_by LEFT JOIN users uc ON uc.id = v.closed_by
      WHERE v.id = $1 AND v.kind = 'location'`,
    [inventoryId]
  );
  if (!v) throw httpError(404, 'Inventaire par emplacement introuvable.');
  const { rows: passes } = await pool.query(`${PASS_SQL} WHERE s.inventory_id = $1 ORDER BY s.started_at DESC`, [inventoryId]);
  const { rows: lines } = await pool.query(
    `${LINES_SQL} JOIN inventory_spot_passes s ON s.id = l.pass_id WHERE s.inventory_id = $1`, [inventoryId]
  );
  const byPass = new Map(passes.map(s => [s.id, []]));
  for (const l of lines) byPass.get(l.pass_id)?.push(l);
  return {
    id: v.id, name: v.name, kind: v.kind, status: v.status,
    createdAt: v.created_at, createdBy: v.created_by_name, closedAt: v.closed_at, closedBy: v.closed_by_name,
    closing: v.status === 'open' ? await closeCheck(inventoryId) : null,
    passes: passes.map(s => passOut(s, byPass.get(s.id), null)),
  };
};

/** Lignes d'un dossier dans un état donné, parmi celles choisies. */
const linesIn = async (inventoryId, lineIds, status) => {
  const { rows } = await pool.query(
    `SELECT l.id FROM inventory_spot_lines l JOIN inventory_spot_passes s ON s.id = l.pass_id
      WHERE s.inventory_id = $1 AND l.id = ANY($2::int[]) AND l.push_status = $3`,
    [inventoryId, (Array.isArray(lineIds) ? lineIds : []).map(Number), status]
  );
  return rows.map(r => r.id);
};

/** Relance des envois en erreur (après vérification dans BMS si la réponse était incertaine). */
const retryLines = async (inventoryId, lineIds, userId) => {
  await loadOpenInventory(inventoryId);
  const ids = await linesIn(inventoryId, lineIds, 'error');
  if (!ids.length) throw httpError(400, 'Aucun envoi en erreur dans cette sélection.');
  await pool.query(
    `UPDATE inventory_spot_lines SET push_status = 'queued', push_error = NULL WHERE id = ANY($1::int[]) AND push_status = 'error'`,
    [ids]
  );
  await inventoryModel.log(inventoryId, userId, 'spot_retry', { qty: ids.length });
  inventorySpotService.kickPushes();
  return { queued: ids.length };
};

/** « Laisser tomber » un envoi en erreur : rien ne part, la clôture redevient possible. */
const ignoreLines = async (inventoryId, lineIds, userId) => {
  await loadOpenInventory(inventoryId);
  const ids = await linesIn(inventoryId, lineIds, 'error');
  if (!ids.length) throw httpError(400, 'Aucun envoi en erreur dans cette sélection.');
  await pool.query(
    `UPDATE inventory_spot_lines SET push_status = 'ignored' WHERE id = ANY($1::int[]) AND push_status = 'error'`, [ids]
  );
  await inventoryModel.log(inventoryId, userId, 'spot_ignore', { qty: ids.length });
  return { ignored: ids.length };
};

const close = async (inventoryId, userId) => {
  await loadOpenInventory(inventoryId);
  const check = await closeCheck(inventoryId);
  if (!check.closable) throw httpError(400, `Impossible de clôturer : ${check.reasons.join(', ')}.`);
  await pool.query(
    `UPDATE inventories SET status = 'closed', closed_at = NOW(), closed_by = $2 WHERE id = $1 AND status = 'open'`,
    [inventoryId, userId]
  );
  await inventoryModel.log(inventoryId, userId, 'close_inventory');
};

/** Annuler le dossier : les passages en cours sont abandonnés, ce qui est validé part quand même. */
const cancel = async (inventoryId, userId) => {
  await inventoryModel.cancel(inventoryId, userId);
  await pool.query(
    `UPDATE inventory_spot_passes SET status = 'abandoned', abandoned_by = $2, abandoned_at = NOW()
      WHERE inventory_id = $1 AND status = 'counting'`,
    [inventoryId, userId]
  );
};

module.exports = {
  create, home, getPass, openPass, scan, setQty, moveLine, addProduct, removeLine, validate, abandon,
  detail, retryLines, ignoreLines, close, cancel,
};
