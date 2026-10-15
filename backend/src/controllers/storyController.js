/**
 * App « Stories » — envoi, compression et publication des vidéos (remplace Join Stories).
 *
 * Parcours d'un envoi :
 *  1. POST /api/stories (ou /:id/source) : la story est créée, le backend renvoie
 *     une URL signée R2 ;
 *  2. le navigateur envoie la vidéo DIRECTEMENT au bucket des sources (PUT) ;
 *  3. POST /api/stories/:id/uploaded : le backend vérifie la présence du fichier
 *     chez R2 et met la story en file de compression.
 */
const path = require('path');
const storyModel = require('../models/storyModel');
const r2 = require('../services/r2Service');
const processing = require('../services/storyProcessingService');

const FORMATS = ['portrait', 'landscape'];
const MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024; // 2 Go : une source fait 180-200 Mo

const slugify = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 60)
  .replace(/-+$/g, '');

const uniqueSlug = async (title) => {
  const base = slugify(title) || 'story';
  let slug = base;
  for (let i = 2; await storyModel.slugExists(slug); i += 1) slug = `${base}-${i}`;
  return slug;
};

/** Ajoute les URL publiques des fichiers diffusés. */
const withUrls = (s) => s && ({
  ...s,
  video_url: r2.publicUrl(s.video_key),
  poster_url: r2.publicUrl(s.poster_key),
  thumb_url: r2.publicUrl(s.thumb_key),
  gif_url: r2.publicUrl(s.gif_key),
});

const fail = (res, err, status = 500) => {
  console.error('[stories]', err.message || err);
  return res.status(status).json({ error: err.message || 'Erreur serveur' });
};

/** Contrôle le fichier annoncé par le navigateur et prépare l'URL d'envoi. */
const prepareSource = async (story, { filename, content_type: contentType, size }) => {
  if (!contentType || !String(contentType).startsWith('video/')) {
    const err = new Error('Le fichier doit être une vidéo (MP4, MOV…)');
    err.status = 400;
    throw err;
  }
  if (Number(size) > MAX_SOURCE_BYTES) {
    const err = new Error('Fichier trop lourd (2 Go maximum)');
    err.status = 400;
    throw err;
  }
  const ext = (path.extname(String(filename || '')).toLowerCase().match(/^\.[a-z0-9]{1,5}$/) || ['.mp4'])[0];
  const sourceKey = `stories/${story.id}-${story.slug}/source-${Date.now()}${ext}`;
  const uploadUrl = await r2.presignSourceUpload(sourceKey, contentType);
  const updated = await storyModel.setSourcePending(story.id, {
    sourceKey,
    sourceName: String(filename || '').slice(0, 255) || null,
  });
  return { story: withUrls(updated), upload_url: uploadUrl, content_type: contentType };
};

const statsOptions = (q) => ({
  days: Math.min(365, Math.max(1, parseInt(q.days, 10) || 30)),
  includeTests: q.tests === '1',
});

const list = async (req, res) => {
  try {
    const opts = statsOptions(req.query);
    const [stories, placements, stats] = await Promise.all([
      storyModel.list({ includeArchived: req.query.archived === '1' }),
      storyModel.placementsByStory(),
      storyModel.statsByStory(opts),
    ]);
    const statsBySlug = new Map(stats.map((r) => [r.story_slug, r]));
    const data = stories.map((s) => ({
      ...withUrls(s),
      placements: placements.filter((p) => p.story_id === s.id),
      stats: statsBySlug.get(s.slug) || null,
    }));
    res.json({ data, r2_missing: r2.missingConfig(), stats_days: opts.days, stats_tests: opts.includeTests });
  } catch (err) {
    fail(res, err);
  }
};

const stats = async (req, res) => {
  try {
    const story = await storyModel.getById(req.params.id);
    if (!story) return res.status(404).json({ error: 'Story introuvable' });
    res.json({ data: await storyModel.statsForStory(story.slug, statsOptions(req.query)) });
  } catch (err) {
    fail(res, err);
  }
};

const get = async (req, res) => {
  try {
    const story = await storyModel.getById(req.params.id);
    if (!story) return res.status(404).json({ error: 'Story introuvable' });
    res.json({ data: withUrls(story) });
  } catch (err) {
    fail(res, err);
  }
};

const create = async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Le titre est obligatoire' });
    const format = FORMATS.includes(req.body.format) ? req.body.format : 'portrait';
    if (r2.missingConfig().length) {
      return res.status(503).json({ error: `R2 non configuré : ${r2.missingConfig().join(', ')}` });
    }
    const story = await storyModel.create({
      slug: await uniqueSlug(title),
      title,
      description: req.body.description,
      format,
      createdBy: req.user?.id,
    });
    const prepared = await prepareSource(story, req.body);
    res.status(201).json({ data: prepared });
  } catch (err) {
    fail(res, err, err.status || 500);
  }
};

/** Remplacer la vidéo d'une story existante (nouvelle source, nouvelle version). */
const replaceSource = async (req, res) => {
  try {
    const story = await storyModel.getById(req.params.id);
    if (!story) return res.status(404).json({ error: 'Story introuvable' });
    if (story.status === 'processing') {
      return res.status(409).json({ error: 'Compression en cours, réessayez quand elle sera terminée' });
    }
    const prepared = await prepareSource(story, req.body);
    res.json({ data: prepared });
  } catch (err) {
    fail(res, err, err.status || 500);
  }
};

const uploaded = async (req, res) => {
  try {
    const story = await storyModel.getById(req.params.id);
    if (!story) return res.status(404).json({ error: 'Story introuvable' });
    if (!story.source_key) return res.status(400).json({ error: 'Aucun envoi en cours pour cette story' });
    const head = await r2.headSource(story.source_key);
    if (!head || !head.size) {
      return res.status(409).json({ error: "La vidéo n'est pas arrivée sur R2 : relancez l'envoi" });
    }
    const updated = await storyModel.markUploaded(story.id, head.size);
    processing.kick();
    res.json({ data: withUrls(updated) });
  } catch (err) {
    fail(res, err);
  }
};

const update = async (req, res) => {
  try {
    if (req.body.title !== undefined && !String(req.body.title).trim()) {
      return res.status(400).json({ error: 'Le titre est obligatoire' });
    }
    const fields = { ...req.body };
    if (fields.title !== undefined) fields.title = String(fields.title).trim();
    for (const k of ['wp_product_id', 'wp_variation_id']) {
      if (fields[k] !== undefined && fields[k] !== null && fields[k] !== '') {
        const n = parseInt(fields[k], 10);
        if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: `${k} invalide` });
        fields[k] = n;
      }
    }
    const story = await storyModel.update(req.params.id, fields);
    if (!story) return res.status(404).json({ error: 'Story introuvable' });
    res.json({ data: withUrls(story) });
  } catch (err) {
    fail(res, err);
  }
};

const reprocess = async (req, res) => {
  try {
    const story = await storyModel.requeue(req.params.id);
    if (!story) return res.status(409).json({ error: 'Aucune vidéo source à recompresser' });
    processing.kick();
    res.json({ data: withUrls(story) });
  } catch (err) {
    fail(res, err);
  }
};

/**
 * Miniature : POST /:id/cover avec un fichier `image` (multipart), ou un corps
 * JSON { kind: 'frame', at } (instant de la vidéo) / { kind: 'video' } (auto).
 */
const cover = async (req, res) => {
  try {
    const story = await storyModel.getById(req.params.id);
    if (!story) return res.status(404).json({ error: 'Story introuvable' });
    if (story.status === 'processing') {
      return res.status(409).json({ error: 'Compression en cours, réessayez quand elle sera terminée' });
    }
    let opts;
    if (req.file) {
      const ok = /^image\//i.test(req.file.mimetype || '') || /\.hei[cf]$/i.test(req.file.originalname || '');
      if (!ok) return res.status(400).json({ error: 'Le fichier doit être une image (JPEG, PNG, WebP, HEIC)' });
      opts = { kind: 'upload', buffer: req.file.buffer, mime: req.file.mimetype, name: req.file.originalname };
    } else if (req.body?.kind === 'frame') {
      const at = Number(req.body.at);
      if (!Number.isFinite(at) || at < 0) return res.status(400).json({ error: 'Instant invalide' });
      opts = { kind: 'frame', at };
    } else if (req.body?.kind === 'video') {
      opts = { kind: 'video' };
    } else {
      return res.status(400).json({ error: 'Aucune image envoyée' });
    }
    const updated = await processing.changeCover(story, opts);
    res.json({ data: withUrls(updated) });
  } catch (err) {
    fail(res, err, err.status || 500);
  }
};

const archive = async (req, res) => {
  try {
    const story = await storyModel.setArchived(req.params.id, req.body.archived !== false);
    if (!story) return res.status(404).json({ error: 'Story introuvable' });
    if (story.status === 'uploaded') processing.kick();
    res.json({ data: withUrls(story) });
  } catch (err) {
    fail(res, err);
  }
};

module.exports = { list, get, stats, create, replaceSource, uploaded, update, reprocess, cover, archive };
