/**
 * Réglages : correspondance « dénomination WooCommerce → transporteur ».
 *
 * C'est l'écran qu'un responsable ouvre quand un préparateur se retrouve
 * bloqué devant une commande dont le mode de livraison n'est pas reconnu.
 *
 * Il expose aussi les dénominations **vues dans les commandes récentes et
 * jamais mappées** : autant proposer de régler le problème avant qu'il se pose,
 * plutôt qu'attendre qu'un colis reste sur la table.
 */

const pool = require('../config/database');
const shippingMethodMapModel = require('../models/shippingMethodMapModel');
const carrierAccountModel = require('../models/carrierAccountModel');
const { getAdapter, listCarrierCodes } = require('../services/carriers');

/**
 * Transporteurs disponibles, avec leurs contrats, pour alimenter les listes
 * déroulantes de l'écran. Les identifiants ne sortent jamais d'ici.
 */
const listCarriers = async () => {
  const { rows } = await pool.query(
    `SELECT carrier_code, account_code, label, active,
            COALESCE(NULLIF(settings->>'sandbox', '')::boolean, false) AS sandbox
     FROM carrier_accounts
     ORDER BY carrier_code, account_code`
  );

  return listCarrierCodes().map((code) => {
    const adapter = getAdapter(code);
    const comptes = rows.filter(r => r.carrier_code === code);

    return {
      code,
      label: adapter.label,
      // Description des champs du contrat : c'est elle qui permet à l'écran de
      // générer le formulaire, plutôt que de coder en dur les champs de chaque
      // transporteur.
      accountFields: adapter.accountFields || null,
      // Le retrait magasin n'a pas de contrat : l'écran ne doit pas en réclamer un.
      requiresAccount: adapter.requiresAccount !== false,
      defaultAccountCode: adapter.accountCode,
      defaultDeliveryMode: adapter.methodCode,
      // Modes autorisés : l'écran en fait une liste au lieu d'un champ libre.
      deliveryModes: adapter.deliveryModes || null,
      cancellable: adapter.cancelWindow({ created_at: new Date() }).cancellable,
      accounts: adapter.requiresAccount === false
        ? [{ code: adapter.accountCode, label: adapter.label, active: true, sandbox: false }]
        : comptes.map(c => ({ code: c.account_code, label: c.label, active: c.active, sandbox: c.sandbox }))
    };
  });
};

/** GET / — tout ce dont l'écran de réglages a besoin, en un appel. */
const getMap = async (req, res) => {
  try {
    const [mappings, unmapped, carriers] = await Promise.all([
      shippingMethodMapModel.listAll(),
      shippingMethodMapModel.listUnmappedSeen(90),
      listCarriers()
    ]);

    res.json({ mappings, unmapped, carriers });
  } catch (error) {
    console.error('[Expedition] Erreur getMap:', error.message);
    res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
};

/** POST / — crée ou met à jour une correspondance (la dénomination fait la clé). */
const saveMapping = async (req, res) => {
  try {
    const { denomination, carrier_code, account_code, delivery_mode, note, active } = req.body || {};

    // Un transporteur inconnu du registre produirait une ligne qui bloque le
    // packing sans que personne comprenne pourquoi.
    const adapter = carrier_code ? getAdapter(carrier_code) : null;

    // Un mode hors de la liste du transporteur passerait l'enregistrement et
    // n'échouerait qu'au packing, colis en main. On le refuse ici.
    const modes = adapter?.deliveryModes;
    if (modes && !modes.some(m => m.code === delivery_mode)) {
      return res.status(400).json({
        error: `Mode « ${delivery_mode || '(vide)'} » inconnu pour ${adapter.label} — `
          + `choisir parmi : ${modes.map(m => `${m.code} (${m.label})`).join(', ')}`
      });
    }

    const row = await shippingMethodMapModel.upsert({
      denomination,
      carrierCode: carrier_code || null,
      accountCode: account_code || null,
      deliveryMode: delivery_mode || null,
      note,
      active: active !== false
    });

    res.json({ success: true, mapping: row });
  } catch (error) {
    console.error('[Expedition] Erreur saveMapping:', error.message);
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
};

/** DELETE /:id — la dénomination redeviendra « inconnue » et bloquera le packing. */
const deleteMapping = async (req, res) => {
  try {
    const row = await shippingMethodMapModel.remove(req.params.id);
    if (!row) return res.status(404).json({ error: 'Correspondance introuvable' });

    res.json({ success: true, deleted: row.denomination });
  } catch (error) {
    console.error('[Expedition] Erreur deleteMapping:', error.message);
    res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
};

/** GET /carrier-accounts — les contrats, sans leurs secrets. */
const getAccounts = async (req, res) => {
  try {
    const [accounts, carriers] = await Promise.all([
      carrierAccountModel.listForSettings(),
      listCarriers()
    ]);
    res.json({ accounts, carriers });
  } catch (error) {
    console.error('[Expedition] Erreur getAccounts:', error.message);
    res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
};

/** POST /carrier-accounts — créer ou modifier un contrat. */
const saveAccount = async (req, res) => {
  try {
    const { carrier_code, account_code, label, credentials, settings, active } = req.body || {};
    const row = await carrierAccountModel.upsert({
      carrierCode: carrier_code,
      accountCode: account_code,
      label,
      credentials: credentials || {},
      settings: settings || {},
      active
    });
    // La réponse ne renvoie surtout pas ce qui vient d'être écrit : l'écran
    // recharge la liste expurgée.
    res.json({ success: true, id: row.id });
  } catch (error) {
    console.error('[Expedition] Erreur saveAccount:', error.message);
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
};

/** DELETE /carrier-accounts/:id */
const deleteAccount = async (req, res) => {
  try {
    const row = await carrierAccountModel.remove(req.params.id);
    if (!row) return res.status(404).json({ error: 'Contrat introuvable' });
    res.json({ success: true });
  } catch (error) {
    console.error('[Expedition] Erreur deleteAccount:', error.message);
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
};

module.exports = {
  getMap, saveMapping, deleteMapping, listCarriers,
  getAccounts, saveAccount, deleteAccount
};
