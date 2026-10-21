/**
 * Suivi SEO (Google Search Console) — app « seo »
 * Monté avec authMiddleware dans server.js ; droit `seo` exigé ici.
 */
const express = require('express');
const multer = require('multer');
const { checkPermission } = require('../middleware/permissionMiddleware');
const gsc = require('../services/gscService');
const advisor = require('../services/seoAdvisorService');
const writer = require('../services/seoWriterService');

// Export CSV du Planificateur de mots-clés Google Ads (quelques centaines de Ko).
const adsUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router = express.Router();
router.use(checkPermission('seo', 'read'));

const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (error) {
    console.error('[SEO]', error.message);
    res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
};

router.get('/status', handle(() => gsc.getStatus()));

router.get('/groups', handle((req) => gsc.getGroupsSeries({
  weeks: req.query.weeks,
  country: req.query.country,
})));

router.get('/groups/:slug', handle(async (req) => {
  const detail = await gsc.getGroupDetail(req.params.slug, {
    days: req.query.days,
    country: req.query.country,
  });
  if (!detail) throw new Error('Groupe inconnu');
  return detail;
}));

router.get('/new-queries', handle((req) => gsc.getNewQueries({
  days: req.query.days,
  country: req.query.country,
})));

// Lance une reprise en tâche de fond (N derniers jours, 480 maximum).
router.post('/sync', checkPermission('seo', 'write'), handle((req) => {
  if (!gsc.isConfigured()) throw new Error('Search Console non configurée');
  return gsc.startBackfill(req.body?.days);
}));

// Recommandations classées par gain estimé (statuts todo,doing par défaut).
router.get('/recommendations', handle((req) => advisor.listRecommendations({ status: req.query.status })));

// Recalcul en tâche de fond : relevé de ~150 pages + détecteurs (1 à 2 min).
router.post('/recommendations/refresh', checkPermission('seo', 'write'), handle(() => {
  advisor.computeRecommendations().catch((error) => console.error('[SEO] Recommandations :', error.message));
  return { started: true };
}));

router.patch('/recommendations/:id', checkPermission('seo', 'write'), handle(async (req) => {
  const rec = await advisor.updateRecommendation(Number(req.params.id), req.body || {}, req.user?.email);
  if (!rec) throw new Error('Recommandation introuvable');
  return rec;
}));

/* ─── Rédaction SEO : une page à la fois ─── */
const canWrite = checkPermission('seo', 'write');
const pageId = (req) => Number(req.params.id);

router.get('/writer', handle(() => writer.listPages()));
router.post('/writer', canWrite, handle((req) => writer.createPage(req.body?.url, req.user?.email)));
router.get('/writer/:id', handle((req) => writer.getPage(pageId(req))));
router.patch('/writer/:id', canWrite, handle((req) => writer.updatePage(pageId(req), req.body || {}, req.user?.email)));
router.delete('/writer/:id', canWrite, handle((req) => writer.deletePage(pageId(req))));
// Relevé de la page + fiches produits + requêtes Search Console (10 à 30 s).
router.post('/writer/:id/analyze', canWrite, handle(async (req) => {
  await writer.analyze(pageId(req));
  return writer.getPage(pageId(req));
}));
router.post('/writer/:id/ads', canWrite, adsUpload.single('file'), handle(async (req) => {
  if (!req.file) throw new Error('Fichier manquant');
  const r = await writer.saveAds(pageId(req), req.file.buffer, req.file.originalname);
  return { ...r, page: await writer.getPage(pageId(req)) };
}));
router.delete('/writer/:id/ads', canWrite, handle((req) => writer.clearAds(pageId(req))));
router.get('/writer/:id/brief', handle((req) => writer.getBrief(pageId(req))));
// Génération en tâche de fond (1 à 3 min) : le front interroge la fiche.
router.post('/writer/:id/generate', canWrite, handle((req) => writer.startGeneration(pageId(req))));
router.post('/writer/:id/draft-import', canWrite, handle((req) => writer.importDraft(pageId(req), req.body?.text, req.user?.email)));
router.post('/writer/:id/verify', canWrite, handle((req) => writer.verifyLive(pageId(req))));
router.get('/writer/:id/positions', handle((req) => writer.getPositions(pageId(req), { weeks: req.query.weeks })));
router.post('/writer/:id/events', canWrite, handle((req) => writer.addEvent(pageId(req), req.body || {}, req.user?.email)));
router.delete('/writer/:id/events/:eventId', canWrite, handle((req) => writer.deleteEvent(pageId(req), Number(req.params.eventId))));

router.post('/weekly-report', checkPermission('seo', 'write'), handle(() => gsc.sendWeeklyReport()));

module.exports = router;
