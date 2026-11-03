/**
 * Réclamations transporteur — onglet « Réclamations » de l'Historique
 * d'expédition. Voir services/chronopostClaimService.js.
 */

const claimModel = require('../models/carrierClaimModel');
const claimService = require('../services/chronopostClaimService');

const fail = (res, err, fallback) => {
  console.error('[Réclamations]', err.message);
  res.status(err.statusCode || 500).json({ error: err.message || fallback });
};

/** Les fichiers produits, et depuis quand le contrôle tourne. */
const list = async (req, res) => {
  try {
    const [batches, since] = await Promise.all([claimModel.listBatches(), claimModel.getSince()]);
    res.json({ batches, since });
  } catch (err) {
    fail(res, err, 'Erreur de chargement des réclamations');
  }
};

/** Le CSV tel qu'il a été envoyé (UTF-8 ; le tout premier, du 03/11/2026, en Windows-1252). */
const download = async (req, res) => {
  try {
    const file = await claimModel.getBatchFile(parseInt(req.params.batchId, 10));
    if (!file) return res.status(404).json({ error: 'Fichier introuvable' });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${file.file_name}"`);
    res.send(file.csv_data);
  } catch (err) {
    fail(res, err, 'Erreur de téléchargement');
  }
};

/** « Lancer le contrôle maintenant » : le même passage que celui de 16 h. */
const run = async (req, res) => {
  try {
    const result = await claimService.run({ userId: req.user?.id });
    if (result.skipped) return res.status(409).json({ error: 'Un contrôle est déjà en cours.' });
    res.json(result);
  } catch (err) {
    fail(res, err, 'Erreur pendant le contrôle');
  }
};

/** Le compte-rendu d'import de Chronopost, collé dans l'app. */
const importReport = async (req, res) => {
  try {
    const result = await claimService.applyImportReport(
      parseInt(req.params.batchId, 10), req.body?.text, req.user?.id
    );
    res.json(result);
  } catch (err) {
    fail(res, err, 'Compte-rendu illisible');
  }
};

module.exports = { list, download, run, importReport };
