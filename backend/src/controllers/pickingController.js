const pool = require('../config/database');
const pickingModel = require('../models/pickingModel');
const pickingSyncService = require('../services/pickingSyncService');
const shippingMethodMapModel = require('../models/shippingMethodMapModel');
const { expectedNetwork, relayNetworks } = require('../services/carriers/relayPoints');

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('[Picking]', error.message);
    res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
};

/**
 * Liste des commandes, avec les compteurs d'onglets.
 * La photo BMS est actualisée d'abord si elle a plus de 5 minutes ; si BMS ne
 * répond pas, on sert la dernière photo avec l'erreur, plutôt qu'un écran vide.
 */
const listOrders = handle(async (req, res) => {
  let syncError = null;
  try {
    await pickingSyncService.ensureFresh();
  } catch (error) {
    syncError = `BMS injoignable, liste du dernier relevé (${error.message})`;
    console.error('[Picking] Actualisation BMS :', error.message);
  }
  const [orders, syncedAt, waveCounts] = await Promise.all([
    pickingModel.getOrdersView(),
    pickingSyncService.lastSyncAt(),
    pickingModel.countWaves()
  ]);
  res.json({ orders, counts: pickingModel.countByBucket(orders), waveCounts, syncedAt, syncError });
});

const refresh = handle(async (req, res) => {
  const result = await pickingSyncService.refresh();
  res.json(result);
});

const block = handle(async (req, res) => {
  await pickingModel.block(req.params.orderNumber, req.body?.reason, req.user?.id);
  res.json({ success: true });
});

const unblock = handle(async (req, res) => {
  await pickingModel.unblock(req.params.orderNumber);
  res.json({ success: true });
});

/** Ce qu'il faut pour la fenêtre « Corriger » : adresse, point relais, réseau attendu. */
const getCorrection = handle(async (req, res) => {
  const { rows: [o] } = await pool.query(
    `SELECT wp_order_id, shipping_method,
            shipping_first_name, shipping_last_name, shipping_company,
            shipping_address_1, shipping_address_2, shipping_city, shipping_postcode,
            shipping_country, billing_country, shipping_phone, billing_phone,
            relay_point, relay_point_manual
       FROM orders WHERE wp_order_id::text = $1`,
    [req.params.orderNumber]
  );
  if (!o) return res.status(404).json({ error: 'Commande absente de la base : attendez la synchro WooCommerce.' });

  const carrier = await shippingMethodMapModel.resolve(o.shipping_method);
  res.json({
    orderNumber: String(o.wp_order_id),
    shippingMethod: o.shipping_method,
    carrier,
    shipping: {
      first_name: o.shipping_first_name,
      last_name: o.shipping_last_name,
      company: o.shipping_company,
      address: o.shipping_address_1,
      address_2: o.shipping_address_2,
      city: o.shipping_city,
      postcode: o.shipping_postcode,
      country: o.shipping_country || o.billing_country,
      phone: o.shipping_phone || o.billing_phone
    },
    relayPoint: o.relay_point_manual || o.relay_point,
    relayExpected: carrier.status === 'mapped' ? expectedNetwork(carrier.carrierCode, carrier.deliveryMode) : null,
    relayNetworks: relayNetworks()
  });
});

const listRules = handle(async (req, res) => {
  const [rules, denominations, manualPrefix] = await Promise.all([
    pickingModel.listRules(),
    pickingModel.listDenominations(),
    pickingModel.getManualPrefix()
  ]);
  res.json({ rules, denominations, manualPrefix });
});

const saveRule = handle(async (req, res) => {
  const rule = await pickingModel.saveRule({ ...req.body, id: req.params.id ? Number(req.params.id) : undefined });
  res.json(rule);
});

const deleteRule = handle(async (req, res) => {
  await pickingModel.deleteRule(Number(req.params.id));
  res.json({ success: true });
});

const setManualPrefix = handle(async (req, res) => {
  await pickingModel.setManualPrefix(req.body?.prefix);
  res.json({ success: true });
});

/** Sans `rule` : ce que chaque règle produirait. Avec `rule` : le détail de ses vagues. */
const previewGeneration = handle(async (req, res) => {
  if (req.query.rule) return res.json(await pickingModel.previewRule(req.query.rule));
  res.json({ rules: await pickingModel.previewRules() });
});

const generate = handle(async (req, res) => {
  const created = await pickingModel.generateFromRule(req.body?.ruleId, req.user?.id);
  res.json({ created });
});

const createManualWave = handle(async (req, res) => {
  const created = await pickingModel.createManualWave(req.body?.orderNumbers, req.user?.id);
  res.json({ created });
});

const listWaves = handle(async (req, res) => {
  const [waves, counts] = await Promise.all([
    pickingModel.listWaves(req.query.tab),
    pickingModel.countWaves()
  ]);
  res.json({ waves, counts });
});

const getWave = handle(async (req, res) => {
  res.json(await pickingModel.getWave(Number(req.params.id)));
});

const cancelWave = handle(async (req, res) => {
  await pickingModel.cancelWave(Number(req.params.id), req.user?.id);
  res.json({ success: true });
});

module.exports = {
  listOrders,
  refresh,
  block,
  unblock,
  getCorrection,
  listRules,
  saveRule,
  deleteRule,
  setManualPrefix,
  previewGeneration,
  generate,
  createManualWave,
  listWaves,
  getWave,
  cancelWave
};
