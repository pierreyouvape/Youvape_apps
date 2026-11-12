/**
 * Module « création de fiche produit » — appelé en serveur à serveur par
 * l'extension WordPress `yv-fiche-redaction` (bouton de l'admin produit).
 *
 * Pas de JWT utilisateur : le secret partagé PRODUCT_WRITER_SECRET prouve que
 * l'appelant est l'extension côté PHP (il ne passe jamais par le navigateur).
 * Le site appelant est dans `x-yv-site` et doit figurer dans PRODUCT_WRITER_SITES :
 * une demande n'est lisible que par le site qui l'a créée.
 *
 * Rien n'est écrit sur le site ici : l'app rend un brouillon, c'est
 * l'extension qui l'applique quand l'utilisateur clique.
 */
const express = require('express');
const crypto = require('crypto');
const writer = require('../services/productWriterService');

const router = express.Router();

const SITES = (process.env.PRODUCT_WRITER_SITES || 'www.youvape.fr,staging.youvape.fr')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

router.use((req, res, next) => {
  const expected = process.env.PRODUCT_WRITER_SECRET;
  if (!expected) return res.status(503).json({ error: 'Module non configuré' });
  if (!safeEqual(req.headers['x-yv-writer-secret'], expected)) return res.status(401).json({ error: 'Non autorisé' });
  const site = String(req.headers['x-yv-site'] || '').toLowerCase();
  if (!SITES.includes(site)) return res.status(403).json({ error: 'Site non autorisé' });
  req.writerSite = site;
  next();
});

router.post('/jobs', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const job = await writer.createJob({
      site: req.writerSite,
      product: req.body?.product,
      requestedBy: req.body?.requested_by ? String(req.body.requested_by).slice(0, 100) : null,
    });
    res.status(job.existing ? 200 : 201).json(job);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.get('/jobs/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Identifiant invalide' });
    const job = await writer.getJob(req.writerSite, id);
    if (!job) return res.status(404).json({ error: 'Demande introuvable' });
    // On ne renvoie que ce que l'admin affiche (pas le dossier complet).
    const r = job.result;
    res.json({
      id: job.id,
      product_id: job.product_id,
      status: job.status,
      step: job.step,
      ahead: job.ahead,
      error: job.error,
      cost_usd: job.cost_usd !== null ? Number(job.cost_usd) : null,
      created_at: job.created_at,
      finished_at: job.finished_at,
      draft: r ? r.brouillon : null,
      checks: r ? r.controles : null,
      facts: r ? r.faits : null,
      recipe: r ? r.dossier?.recette : null,
      // Page à plusieurs goûts : pas de recette, donc pas de composition à enregistrer.
      multi_gouts: r ? !!r.dossier?.page_multi_gouts : false,
      // Marque décrite : la sous-marque d'abord, comme dans les textes.
      brand: r ? (r.dossier?.marque?.gamme?.nom || r.dossier?.marque?.nom) : null,
      // Autres formats de la recette : l'extension leur attache le même terme « Recette »
      // (yv-fiche-blocs ne cherche plus que par ce terme dès qu'une fiche l'a).
      // Jamais une page partagée (puff, flacon sans nicotine) : elle regroupe tous les goûts.
      formats: r ? (r.dossier?.autres_formats || []).filter((f) => !f.page_partagee).map((f) => ({ id: f.id, name: f.nom, path: f.chemin })) : null,
      competitors: r ? (r.concurrents?.concurrents || []).map((c) => ({ site: c.site, url: c.url, title: c.title })) : null,
      // Liens à poser vers la fiche (calculés sans IA) : affichés comme tâches au rédacteur.
      links: r ? (r.maillage || null) : null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
});

module.exports = router;
