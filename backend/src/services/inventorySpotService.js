/**
 * Inventaire par emplacement — les échanges avec BMS et le mail.
 *
 * 1. Relevé à l'ouverture : la quantité affichée au PDA (physique BMS −
 *    prélevé non expédié). File `inventory_spot_lines.ref_needed`, comme les
 *    relevés de l'inventaire classique (quota BMS ~100 appels/minute).
 *
 * 2. Envoi à la validation : file `push_status` (queued → sending → sent |
 *    error). Le stock est RELU au moment de l'envoi : écart = saisi −
 *    (physique − prélevé), si bien qu'une vague prélevée ou expédiée pendant
 *    le comptage ne fausse rien. Puis, dans cet ordre :
 *      - l'emplacement change si le produit est « rangé ailleurs » ou ajouté
 *        ici (pdaProductModel.setLocation relit BMS, rejouable sans dégât) ;
 *      - un mouvement d'ajustement du montant de l'écart, jamais une quantité
 *        absolue. « sending » est posé AVANT l'appel : une réponse incertaine
 *        n'est jamais renvoyée seule (même règle que inventoryPushService).
 *
 * 3. Mail à contact@ une fois tous les envois d'un emplacement terminés : les
 *    produits tombés à 0, et ceux trouvés alors qu'ils étaient à 0 (décision
 *    Pierre du 04/11/2026). Rien d'autre, et rien du tout s'il n'y en a pas.
 */

const pool = require('../config/database');
const bmsApiModel = require('../models/bmsApiModel');
const pdaProductModel = require('../models/pdaProductModel');
const inventoryRefService = require('./inventoryRefService');
const { sendMail } = require('./alertService');
const { CONTACT_EMAIL } = require('../models/pickingPackingModel');
const { theoreticalOf, movementFor, zeroChange } = require('./inventoryRules');

const CONCURRENCY = 3;
const PAUSE_MS = 150;
const BATCH = 300;
const STALE_MINUTES = 10;
const MAIL_ATTEMPTS = 5;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rateLimited = (error) => error.statusCode === 503 || /Too Many Attempts/i.test(error.message || '');

// ── 1. Relevé à l'ouverture ─────────────────────────────────────────────────

let readingRefs = false;

const processRefs = async () => {
  if (readingRefs) return;
  readingRefs = true;
  try {
    const { rows } = await pool.query(
      `SELECT l.id, l.product_id, l.sku FROM inventory_spot_lines l
         JOIN inventory_spot_passes s ON s.id = l.pass_id AND s.status = 'counting'
        WHERE l.ref_needed ORDER BY l.id LIMIT $1`,
      [BATCH]
    );
    if (!rows.length) return;
    const pickedOut = await inventoryRefService.pickedOutByProduct();
    let limited = false;
    for (let i = 0; i < rows.length && !limited; i += CONCURRENCY) {
      await Promise.all(rows.slice(i, i + CONCURRENCY).map(async (r) => {
        let stock = null;
        let error = null;
        try {
          if (!r.sku) error = 'Produit sans SKU : inconnu de BMS.';
          else stock = await pdaProductModel.readBmsStock(r.sku);
        } catch (e) {
          if (rateLimited(e)) { limited = true; return; }
          error = e.message;
        }
        await pool.query(
          `UPDATE inventory_spot_lines SET ref_needed = false, ref_at = NOW(), shown_qty = $2, bms_location = $3, ref_error = $4
            WHERE id = $1`,
          [r.id, stock ? theoreticalOf(stock.physical, pickedOut.get(r.product_id)) : null, stock?.location || null, error]
        );
      }));
      if (!limited) await sleep(PAUSE_MS);
    }
    if (limited) console.log('[Inventaire emplacement] Quota BMS atteint : relevés repris à la minute suivante');
  } finally {
    readingRefs = false;
  }
};

// ── 2. Envoi à BMS ──────────────────────────────────────────────────────────

const moveStock = async (r, gap) => {
  const mv = movementFor(gap);
  if (!mv) return null;
  const comments = ['Inventaire emplacement', r.location, r.user_name].filter(Boolean).join(' · ').slice(0, 100);
  const bmsProductId = await pdaProductModel.findBmsProductId(r.sku);
  let created;
  try {
    created = await bmsApiModel.apiCall('/v2/stock-movements', 'POST', {
      product_id: bmsProductId,
      ...(mv.direction === 'in'
        ? { to_warehouse_id: pdaProductModel.BMS_WAREHOUSE_ID }
        : { from_warehouse_id: pdaProductModel.BMS_WAREHOUSE_ID }),
      qty: mv.qty,
      category: 'adjustment',
      comments,
    });
  } catch (error) {
    // Un refus net (4xx) n'a rien écrit ; tout autre échec a pu passer.
    if (/BMS API error: 4\d\d/.test(error.message) || rateLimited(error)) throw error;
    throw new Error(`Réponse BMS incertaine, VÉRIFIEZ le mouvement dans BMS avant de réessayer : ${error.message}`);
  }
  return pdaProductModel.findMovementId(created, bmsProductId, comments, mv.qty);
};

const pushLine = async (r, pickedOut) => {
  const stock = await pdaProductModel.readBmsStock(r.sku);
  const picked = pickedOut.get(r.product_id) || 0;
  await pool.query('UPDATE inventory_spot_lines SET push_physical = $2, push_picked = $3 WHERE id = $1', [r.id, stock.physical, picked]);

  const target = r.outcome === 'moved' ? r.moved_to : (r.added ? r.location : null);
  if (target && !r.location_done) {
    await pdaProductModel.setLocation(r.product_id, target, { id: r.validated_by });
    await pool.query('UPDATE inventory_spot_lines SET location_done = true WHERE id = $1', [r.id]);
  }
  if (r.outcome !== 'count') return { qty: null, movementId: null };
  const gap = r.qty - theoreticalOf(stock.physical, picked);
  return { qty: gap, movementId: await moveStock(r, gap) };
};

let pushing = false;

const processPushes = async () => {
  if (pushing) return;
  pushing = true;
  try {
    await pool.query(
      `UPDATE inventory_spot_lines
          SET push_status = 'error',
              push_error = 'Envoi interrompu (serveur redémarré pendant l''appel) : VÉRIFIEZ dans BMS si le mouvement est passé avant de réessayer.'
        WHERE push_status = 'sending' AND push_at < NOW() - make_interval(mins => $1)`,
      [STALE_MINUTES]
    );
    const { rows: ids } = await pool.query(
      `SELECT id FROM inventory_spot_lines WHERE push_status = 'queued' ORDER BY id LIMIT $1`, [BATCH]
    );
    let pickedOut = null;
    for (const { id } of ids) {
      // Le verrou : seule la ligne passée de queued à sending part.
      const { rows: [r] } = await pool.query(
        `UPDATE inventory_spot_lines l SET push_status = 'sending', push_at = NOW()
           FROM inventory_spot_passes s
          WHERE l.id = $1 AND l.push_status = 'queued' AND s.id = l.pass_id
          RETURNING l.*, s.location, s.validated_by, (SELECT name FROM users WHERE id = s.validated_by) AS user_name`,
        [id]
      );
      if (!r) continue;
      try {
        if (!pickedOut) pickedOut = await inventoryRefService.pickedOutByProduct();
        const { qty, movementId } = await pushLine(r, pickedOut);
        await pool.query(
          `UPDATE inventory_spot_lines SET push_status = 'sent', push_qty = $2, push_at = NOW(), push_error = NULL,
                  bms_movement_id = $3
            WHERE id = $1`,
          [id, qty, movementId == null ? null : String(movementId)]
        );
      } catch (error) {
        if (rateLimited(error)) {
          await pool.query(`UPDATE inventory_spot_lines SET push_status = 'queued' WHERE id = $1`, [id]);
          console.log('[Inventaire emplacement] Quota BMS atteint : envois repris à la minute suivante');
          break;
        }
        await pool.query(
          `UPDATE inventory_spot_lines SET push_status = 'error', push_error = $2 WHERE id = $1`,
          [id, String(error.message || 'Erreur inconnue').slice(0, 500)]
        );
      }
      await sleep(PAUSE_MS);
    }
  } finally {
    pushing = false;
  }
};

// ── 3. Mail ─────────────────────────────────────────────────────────────────

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const parisTime = (d) => new Date(d).toLocaleString('fr-FR', {
  timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/** Les lignes d'un passage qui vont dans le mail (théorique relu à l'envoi, sinon celui affiché). */
const mailRows = (lines) => lines
  .map(l => {
    const theoretical = l.push_physical != null ? theoreticalOf(l.push_physical, l.push_picked) : l.shown_qty;
    return { ...l, theoretical, change: zeroChange(theoretical, l.qty) };
  })
  .filter(l => l.change);

const buildMail = (pass, rows) => {
  const toZero = rows.filter(r => r.change === 'to_zero').length;
  const fromZero = rows.length - toZero;
  const bms = (r) => (r.push_status === 'sent'
    ? `Corrigé${r.bms_movement_id ? ` (mouvement ${r.bms_movement_id})` : ''}`
    : `ERREUR : ${r.push_error || 'envoi non fait'}`);
  const htmlRows = rows.map(r => `<tr><td>${escapeHtml(r.sku)}</td>`
    + `<td>${escapeHtml(r.name)}${r.added && r.from_location ? `<br><small>trouvé ici, était rangé en ${escapeHtml(r.from_location)}</small>` : ''}</td>`
    + `<td align="right">${r.theoretical}</td><td align="right">${r.qty}</td>`
    + `<td>${r.change === 'to_zero' ? 'Tombé à 0' : 'Trouvé (était à 0)'}</td>`
    + `<td${r.push_status === 'sent' ? '' : ' style="color:#b91c1c"'}>${escapeHtml(bms(r))}</td></tr>`).join('');
  const when = parisTime(pass.validated_at);
  const head = `Emplacement ${pass.location} validé par ${pass.user_name || '?'} le ${when}`
    + ` (inventaire « ${pass.inventory_name} »).`;
  const html = `<p>${escapeHtml(head)}</p>`
    + `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-size:13px">`
    + `<tr><th>SKU</th><th>Produit</th><th>Théorique</th><th>Compté</th><th>Changement</th><th>BMS</th></tr>${htmlRows}</table>`;
  const text = `${head}\n\n${rows.map(r => `${r.sku} · ${r.name} : ${r.theoretical} → ${r.qty}`
    + ` (${r.change === 'to_zero' ? 'tombé à 0' : 'trouvé, était à 0'}) · ${bms(r)}`).join('\n')}`;
  const parts = [toZero && `${toZero} tombé(s) à 0`, fromZero && `${fromZero} retrouvé(s) alors qu'à 0`].filter(Boolean).join(', ');
  return { subject: `Inventaire emplacement ${pass.location} : ${parts}`, html, text };
};

let mailing = false;

const processMails = async () => {
  if (mailing) return;
  mailing = true;
  try {
    const { rows: passes } = await pool.query(
      `SELECT s.*, v.name AS inventory_name, u.name AS user_name
         FROM inventory_spot_passes s
         JOIN inventories v ON v.id = s.inventory_id
         LEFT JOIN users u ON u.id = s.validated_by
        WHERE s.status = 'validated' AND s.mail_done_at IS NULL AND s.mail_attempts < $1
          AND NOT EXISTS (SELECT 1 FROM inventory_spot_lines l
                           WHERE l.pass_id = s.id AND l.push_status IN ('queued', 'sending'))
        ORDER BY s.validated_at`,
      [MAIL_ATTEMPTS]
    );
    for (const pass of passes) {
      const { rows: lines } = await pool.query(
        `SELECT * FROM inventory_spot_lines
          WHERE pass_id = $1 AND outcome = 'count' AND push_status IN ('sent', 'error') ORDER BY name`,
        [pass.id]
      );
      const rows = mailRows(lines);
      if (!rows.length) {
        await pool.query('UPDATE inventory_spot_passes SET mail_done_at = NOW(), mail_rows = 0 WHERE id = $1', [pass.id]);
        continue;
      }
      const result = await sendMail({ to: CONTACT_EMAIL, ...buildMail(pass, rows) });
      if (result.success) {
        await pool.query(
          'UPDATE inventory_spot_passes SET mail_done_at = NOW(), mail_rows = $2, mail_error = NULL WHERE id = $1',
          [pass.id, rows.length]
        );
      } else {
        await pool.query(
          'UPDATE inventory_spot_passes SET mail_attempts = mail_attempts + 1, mail_error = $2 WHERE id = $1',
          [pass.id, String(result.error || 'Envoi refusé').slice(0, 500)]
        );
      }
    }
  } finally {
    mailing = false;
  }
};

/** Cron chaque minute (avec l'inventaire classique). */
const processAll = async () => {
  await processRefs();
  await processPushes();
  await processMails();
};

const kickRefs = () => {
  processRefs().catch(error => console.error('[Inventaire emplacement] Relevés :', error.message));
};

const kickPushes = () => {
  processPushes()
    .then(processMails)
    .catch(error => console.error('[Inventaire emplacement] Envois :', error.message));
};

module.exports = { processAll, kickRefs, kickPushes, mailRows, buildMail };
