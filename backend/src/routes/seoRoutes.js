/**
 * Suivi SEO (Google Search Console) — app « seo »
 * Monté avec authMiddleware dans server.js ; droit `seo` exigé ici.
 */
const express = require('express');
const { checkPermission } = require('../middleware/permissionMiddleware');
const gsc = require('../services/gscService');

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

router.post('/weekly-report', checkPermission('seo', 'write'), handle(() => gsc.sendWeeklyReport()));

module.exports = router;
