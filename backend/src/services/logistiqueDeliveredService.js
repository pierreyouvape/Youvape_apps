/**
 * Passage en « Livrée » par l'app (plugin youvape-logistique, `order/status`),
 * pour les commandes d'une LISTE seulement : essais de sortie de BMS / Vikings.
 *
 * `app_config.logistique_delivered_push_orders` = tableau JSON de numéros de
 * commande. Dès que notre suivi des colis classe l'étiquette active « livrée »
 * (`shipment_labels.tracking_state`), la commande passe en Livrée AVEC le mail
 * client (`notify_customer: true`), puis sort de la liste. Clé absente ou
 * vide : rien ne part.
 *
 * L'interrupteur des statuts du plugin est global : il n'est allumé que le
 * temps de l'envoi, et toujours recoupé (finally). Le service tourne dans le
 * même cron que l'envoi du suivi, APRÈS lui : jamais deux envois en même temps
 * pendant que les statuts sont allumés.
 *
 * Premier essai : 1279632 (25/11/2026), expédiée sans BMS.
 */

const pool = require('../config/database');
const appConfigModel = require('../models/appConfigModel');
const logistiqueService = require('./logistiqueService');
const alertService = require('./alertService');

const LIST_KEY = 'logistique_delivered_push_orders';

/** Codes du plugin qui permettent de renvoyer la ligne au passage suivant. */
const RETRYABLE = ['ORDER_LOCKED', 'EXCEPTION', 'STATUS_CHANGES_DISABLED'];

/** La liste, toujours en chaînes ; illisible = vide. */
const parseList = (row) => {
  if (!row) return [];
  try {
    const list = JSON.parse(row.config_value);
    return Array.isArray(list) ? [...new Set(list.map(String))] : [];
  } catch {
    return [];
  }
};

const parisDateTime = (d) => new Date(d).toLocaleString('fr-FR', {
  timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/** La ligne `order/status` d'une commande livrée. */
const buildDeliveredLine = (label) => ({
  order_id: Number(label.order_number),
  step: 'delivered',
  notify_customer: true,
  note: label.tracking_delivered_at
    ? `Colis ${label.tracking_number} livré selon le transporteur le ${parisDateTime(label.tracking_delivered_at)}.`
    : `Colis ${label.tracking_number} livré selon le transporteur.`,
});

/**
 * Sort d'une ligne : 'done' (la commande quitte la liste), 'retry' (on garde),
 * avec `alert` quand un humain doit regarder.
 */
const classify = (result) => {
  if (result?.result === 'applied') {
    return { outcome: 'done', alert: result.warning || null };
  }
  if (result?.result === 'already') return { outcome: 'done', alert: null };
  const code = result?.code || 'REPONSE_INATTENDUE';
  const message = `${code} : ${result?.message || 'réponse du plugin illisible'}`;
  if (result?.result === 'not_processed' || RETRYABLE.includes(code)) return { outcome: 'retry', alert: null, message };
  return { outcome: 'done', alert: message, message };
};

/** Étiquettes actives livrées des commandes de la liste. */
const loadDelivered = async (orders) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (order_number) id, order_number, tracking_number, tracking_delivered_at
       FROM shipment_labels
      WHERE status = 'active' AND tracking_state = 'delivered' AND order_number = ANY($1::text[])
      ORDER BY order_number, created_at DESC`,
    [orders]
  );
  return rows;
};

const removeFromList = async (done) => {
  const list = parseList(await appConfigModel.get(LIST_KEY)).filter(o => !done.includes(o));
  await appConfigModel.upsert(LIST_KEY, JSON.stringify(list));
};

let running = false;

/** Un passage. Ne lève jamais. */
const runDue = async () => {
  if (running) return { skipped: 'déjà en cours' };
  running = true;
  try {
    const orders = parseList(await appConfigModel.get(LIST_KEY));
    if (!orders.length) return { skipped: 'liste vide' };
    const labels = await loadDelivered(orders);
    if (!labels.length) return { waiting: orders.length };

    const lines = labels.map(buildDeliveredLine);
    let results;
    let switchedOn = false;
    try {
      const on = await logistiqueService.updateSettings({ status_changes_enabled: true });
      switchedOn = on?.settings?.status_changes_enabled === true;
      if (!switchedOn) {
        console.warn('[Livrée → site] Interrupteur des statuts non allumé :', JSON.stringify(on).slice(0, 300));
        return { retry: lines.length };
      }
      results = await logistiqueService.postBatch('/order/status', 'orders', lines);
    } catch (error) {
      console.error('[Livrée → site] Envoi non confirmé, repart au passage suivant :', error.message);
      return { retry: lines.length };
    } finally {
      if (switchedOn) {
        try {
          const off = await logistiqueService.updateSettings({ status_changes_enabled: false });
          if (off?.settings?.status_changes_enabled !== false) throw new Error(JSON.stringify(off).slice(0, 300));
        } catch (error) {
          console.error('[Livrée → site] INTERRUPTEUR DES STATUTS RESTÉ ALLUMÉ :', error.message);
          alertService.sendAlert('URGENT : statuts du plugin youvape-logistique restés allumés',
            `Après un passage en Livrée par l'app, l'interrupteur des statuts n'a pas pu être recoupé.\n\n${error.message}\n\nLe couper à la main : Paramètres → Paramètres WooCommerce → Action sur WooCommerce.`);
        }
      }
    }

    const done = [];
    const report = { delivered: 0, retry: 0, error: 0 };
    results.forEach((r, k) => {
      const { outcome, alert, message } = classify(r);
      const order = String(lines[k].order_id);
      if (outcome === 'done') done.push(order);
      if (outcome === 'retry') report.retry++;
      else if (alert && r?.result !== 'applied') report.error++;
      else report.delivered++;
      console.log(`[Livrée → site] Commande ${order} : ${r?.result || '?'} ${r?.status_before || ''}→${r?.status_after || ''}${message ? ` (${message})` : ''}`);
      if (alert) {
        alertService.sendAlert(`Passage en Livrée par l'app : commande ${order} à vérifier`,
          `Le plugin youvape-logistique a répondu pour la commande ${order} :\n\n${alert}\n\nLa commande est retirée de la liste : vérifier son statut sur le site.`);
      }
    });
    if (done.length) await removeFromList(done);
    return report;
  } catch (error) {
    console.error('[Livrée → site] Erreur :', error.message);
    return { error: error.message };
  } finally {
    running = false;
  }
};

module.exports = { runDue, parseList, buildDeliveredLine, classify, LIST_KEY };
