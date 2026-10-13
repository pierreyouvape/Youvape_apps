/**
 * Widgets de l'app « Stories » (bulles / carrousel) et publication vers le site.
 */
const widgetModel = require('../models/storyWidgetModel');
const publishService = require('../services/storyPublishService');
const r2 = require('../services/r2Service');

const LAYOUTS = ['bubbles', 'cards'];
const STATUSES = ['draft', 'published'];

const slugify = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 60)
  .replace(/-+$/g, '');

/**
 * Chemin de page normalisé : on accepte une URL complète collée depuis le
 * navigateur (https://www.youvape.fr/youvape-awards/?utm=…) et on garde
 * `/youvape-awards` — c'est la clé que le mu-plugin compare au chemin demandé.
 */
const normalizePath = (raw) => {
  let p = String(raw || '').trim();
  if (!p) return null;
  try {
    if (/^https?:\/\//i.test(p)) p = new URL(p).pathname;
  } catch {
    return null;
  }
  p = p.split(/[?#]/)[0].toLowerCase();
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return /^\/[a-z0-9/_\-.%]*$/.test(p) ? p : null;
};

const withUrls = (w) => w && ({
  ...w,
  thumbs: (w.thumb_keys || []).filter(Boolean).slice(0, 6).map((k) => r2.publicUrl(k)),
  stories: w.stories ? w.stories.map((s) => ({ ...s, thumb_url: r2.publicUrl(s.thumb_key) })) : undefined,
});

const fail = (res, err, status = 500) => {
  console.error('[stories/widgets]', err.message || err);
  return res.status(status).json({ error: err.message || 'Erreur serveur' });
};

const list = async (req, res) => {
  try {
    const [widgets, publication] = await Promise.all([widgetModel.list(), widgetModel.publicationState()]);
    res.json({
      data: widgets.map(withUrls),
      publication,
      // Page d'aperçu (lit la dernière publication) : ?widget=<slug> n'affiche que ce widget.
      preview_url: r2.missingConfig().length ? null : r2.publicUrl('stories/preview/index.html'),
    });
  } catch (err) {
    fail(res, err);
  }
};

const get = async (req, res) => {
  try {
    const widget = await widgetModel.getById(req.params.id);
    if (!widget) return res.status(404).json({ error: 'Widget introuvable' });
    res.json({ data: withUrls(widget) });
  } catch (err) {
    fail(res, err);
  }
};

const create = async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Le nom du widget est obligatoire' });
    const layout = LAYOUTS.includes(req.body.layout) ? req.body.layout : 'bubbles';
    const base = slugify(title) || 'widget';
    let slug = base;
    for (let i = 2; await widgetModel.slugExists(slug); i += 1) slug = `${base}-${i}`;
    const widget = await widgetModel.create({ slug, title, layout, createdBy: req.user?.id });
    res.status(201).json({ data: widget });
  } catch (err) {
    fail(res, err);
  }
};

const update = async (req, res) => {
  try {
    const { title, layout, status } = req.body;
    if (title !== undefined && !String(title).trim()) {
      return res.status(400).json({ error: 'Le nom du widget est obligatoire' });
    }
    if (layout !== undefined && !LAYOUTS.includes(layout)) return res.status(400).json({ error: 'Format inconnu' });
    if (status !== undefined && !STATUSES.includes(status)) return res.status(400).json({ error: 'Statut inconnu' });
    const widget = await widgetModel.update(req.params.id, {
      title: title !== undefined ? String(title).trim() : undefined, layout, status,
    });
    if (!widget) return res.status(404).json({ error: 'Widget introuvable' });
    res.json({ data: withUrls(await widgetModel.getById(widget.id)) });
  } catch (err) {
    fail(res, err);
  }
};

const remove = async (req, res) => {
  try {
    const ok = await widgetModel.remove(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Widget introuvable' });
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
};

const setStories = async (req, res) => {
  try {
    const ids = Array.isArray(req.body.story_ids) ? req.body.story_ids.map((x) => parseInt(x, 10)) : null;
    if (!ids || ids.some((n) => !Number.isFinite(n))) return res.status(400).json({ error: 'story_ids invalide' });
    await widgetModel.setStories(req.params.id, [...new Set(ids)]);
    res.json({ data: withUrls(await widgetModel.getById(req.params.id)) });
  } catch (err) {
    if (err.code === '23503') return fail(res, new Error('Widget ou story introuvable'), 404);
    fail(res, err);
  }
};

const addPlacement = async (req, res) => {
  try {
    const type = req.body.target_type;
    let ref;
    if (type === 'product') {
      const n = parseInt(req.body.target_ref, 10);
      if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: 'Produit invalide' });
      ref = String(n);
    } else if (type === 'page') {
      ref = normalizePath(req.body.target_ref);
      if (!ref) return res.status(400).json({ error: 'Adresse de page invalide (ex. /youvape-awards)' });
    } else {
      return res.status(400).json({ error: 'Type d’emplacement inconnu' });
    }
    await widgetModel.addPlacement(req.params.id, type, ref);
    res.json({ data: withUrls(await widgetModel.getById(req.params.id)) });
  } catch (err) {
    if (err.code === '23503') return fail(res, new Error('Widget introuvable'), 404);
    fail(res, err);
  }
};

const removePlacement = async (req, res) => {
  try {
    await widgetModel.removePlacement(req.params.id, req.params.placementId);
    res.json({ data: withUrls(await widgetModel.getById(req.params.id)) });
  } catch (err) {
    fail(res, err);
  }
};

const searchProducts = async (req, res) => {
  try {
    res.json({ data: await widgetModel.searchProducts(req.query.q) });
  } catch (err) {
    fail(res, err);
  }
};

const publish = async (req, res) => {
  try {
    if (r2.missingConfig().length) {
      return res.status(503).json({ error: `R2 non configuré : ${r2.missingConfig().join(', ')}` });
    }
    res.json({ data: await publishService.publish({ userId: req.user?.id }) });
  } catch (err) {
    fail(res, err);
  }
};

module.exports = {
  list, get, create, update, remove, setStories, addPlacement, removePlacement, searchProducts, publish,
  normalizePath,
};
