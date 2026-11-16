/**
 * Envoi du suivi des colis au site, par le plugin youvape-logistique (`order/ship`).
 *
 * Première étape de la sortie de BMS (16/11/2026) : chaque étiquette émise par
 * l'app écrit son suivi sur la commande du site (5 métas `_yv_*` + une note
 * privée), SANS mail. Tant que l'interrupteur des statuts du plugin est coupé,
 * le statut ne bouge pas : BMS continue de tout gérer, et le client ne voit rien
 * (le thème et Probance lisent encore les métas `bms_*`).
 *
 * Une file posée sur shipment_labels (`site_ship_status`), reprise par un cron :
 * le packing n'attend jamais le site. Chaque étiquette porte un identifiant
 * d'envoi stable (`label-<id>`) : un lot renvoyé après une réponse perdue revient
 * « already », jamais écrit deux fois.
 *
 * Rien ne part tant que l'envoi n'est pas allumé dans les réglages (interrupteur
 * de l'app, `logistiqueService.getShipPush`), et seules les étiquettes émises
 * APRÈS l'allumage partent.
 */

const pool = require('../config/database');
const logistiqueService = require('./logistiqueService');
const rules = require('./logistiqueShipRules');

/** Lignes par appel : 100 lignes ≈ 14 s mesurées en préprod, sous le budget de 20 s du plugin. */
const BATCH_SIZE = 50;
/** Étiquettes par passage du cron (toutes les 5 min). */
const PER_RUN = 200;

let columnsReady = false;
const hasColumns = async () => {
  if (columnsReady) return true;
  const { rows: [r] } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'shipment_labels' AND column_name = 'site_ship_status') AS ok`
  );
  columnsReady = Boolean(r.ok);
  return columnsReady;
};

/**
 * Étiquettes à envoyer : actives, émises depuis l'allumage, pas encore sur le
 * site. `replace` : une autre étiquette de la même commande y est déjà (étiquette
 * refaite), le plugin remplace alors le suivi au lieu de refuser un second colis.
 */
const loadDue = async (since) => {
  const { rows } = await pool.query(
    `SELECT l.id, l.order_number, l.carrier_code, l.account_code, l.tracking_number, l.bms_ship_title,
            l.site_ship_attempts,
            (l.created_at AT TIME ZONE current_setting('TimeZone')) AS created_at_tz,
            o.wp_order_id,
            COALESCE(NULLIF(o.shipping_country, ''), o.billing_country) AS country,
            EXISTS (SELECT 1 FROM shipment_labels p
                     WHERE p.order_number = l.order_number AND p.id <> l.id AND p.site_ship_status = 'sent') AS replace
       FROM shipment_labels l
       LEFT JOIN orders o
         ON o.wp_order_id = CASE WHEN l.order_number ~ '^[0-9]{1,18}$' THEN l.order_number::bigint END
      WHERE l.status = 'active'
        AND (l.site_ship_status = 'retry'
             OR (l.site_ship_status IS NULL
                 AND l.created_at >= ($1::timestamptz AT TIME ZONE current_setting('TimeZone'))))
      ORDER BY l.id
      LIMIT $2`,
    [since, PER_RUN]
  );
  return rows;
};

const mark = (id, status, error, { attempt = true } = {}) => pool.query(
  `UPDATE shipment_labels
      SET site_ship_status = $2::varchar,
          site_ship_error = $3::text,
          site_ship_attempts = site_ship_attempts + $4::int,
          site_ship_last_attempt_at = CASE WHEN $4::int = 1 THEN NOW() ELSE site_ship_last_attempt_at END,
          site_shipped_at = CASE WHEN $2::varchar = 'sent' THEN COALESCE(site_shipped_at, NOW()) ELSE site_shipped_at END
    WHERE id = $1`,
  [id, status, error, attempt ? 1 : 0]
);

/** Un lot dont la réponse manque : rien n'est tenu pour fait, tout repart au passage suivant (mêmes identifiants). */
const markBatchFailed = async (labels, message) => {
  for (const l of labels) {
    const attempts = l.site_ship_attempts + 1;
    await mark(l.id, attempts < rules.MAX_ATTEMPTS ? 'retry' : 'error', message);
  }
};

let running = false;

/**
 * Un passage du cron. Ne lève jamais : un échec reste écrit sur les étiquettes.
 * @returns {Promise<object>} compte rendu (journaux, tests à la main)
 */
const runDue = async () => {
  if (running) return { skipped: 'déjà en cours' };
  const push = await logistiqueService.getShipPush();
  if (!push.enabled) return { skipped: 'envoi coupé' };
  if (!(await hasColumns())) return { skipped: 'migration add_shipment_labels_site_ship.sql absente' };

  running = true;
  const report = { sent: 0, retry: 0, error: 0, skipped: 0 };
  try {
    const due = await loadDue(push.since);
    if (!due.length) return report;

    // Référence qui n'est pas une commande du site (expédition manuelle libre) : rien à écrire.
    const notOrders = due.filter(l => !l.wp_order_id);
    for (const l of notOrders) {
      await mark(l.id, 'skipped', 'Pas une commande du site', { attempt: false });
      report.skipped++;
    }

    const todo = rules.onePerOrder(due.filter(l => l.wp_order_id));
    for (let i = 0; i < todo.length; i += BATCH_SIZE) {
      const batch = todo.slice(i, i + BATCH_SIZE);
      let results;
      try {
        results = await logistiqueService.postBatch('/order/ship', 'shipments', batch.map(rules.buildShipLine));
      } catch (error) {
        // Plugin absent ou désactivé : on n'use pas les tentatives, il sera là au prochain passage.
        if (error.code === 'PLUGIN_ABSENT') {
          console.warn('[Suivi → site] Plugin absent ou inactif : rien envoyé.');
          return { ...report, stopped: 'plugin absent' };
        }
        await markBatchFailed(batch, error.message);
        report.retry += batch.length;
        console.error(`[Suivi → site] Lot de ${batch.length} non confirmé : ${error.message}`);
        continue;
      }
      for (let k = 0; k < batch.length; k++) {
        const { status, error } = rules.classifyResult(results[k], batch[k].site_ship_attempts + 1);
        await mark(batch[k].id, status, error);
        report[status]++;
        if (status === 'error') console.warn(`[Suivi → site] Commande ${batch[k].order_number} (étiquette ${batch[k].id}) : ${error}`);
      }
    }
    if (report.sent || report.retry || report.error) {
      console.log(`[Suivi → site] ${report.sent} écrit(s), ${report.retry} à renvoyer, ${report.error} en erreur, ${report.skipped} hors commande.`);
    }
    return report;
  } finally {
    running = false;
  }
};

/** Bouton « Renvoyer au site » : une étiquette en erreur repart au prochain passage. */
const requeue = async (labelId) => {
  const { rowCount } = await pool.query(
    `UPDATE shipment_labels SET site_ship_status = 'retry', site_ship_attempts = 0
      WHERE id = $1 AND site_ship_status = 'error' AND status = 'active'`,
    [labelId]
  );
  return rowCount > 0;
};

module.exports = { runDue, requeue };
