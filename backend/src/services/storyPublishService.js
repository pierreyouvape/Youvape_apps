/**
 * Publication des stories vers le site : écrit sur R2 les fichiers JSON que le
 * mu-plugin WordPress `youvape-stories` lit (côté serveur, mis en cache).
 *
 *   stories/index.json            tout le nécessaire en un seul fichier :
 *     stories   slug → vidéo prête (URL, aperçu, vignette, GIF, bouton d'action,
 *               created_at fixe = date de création, updated_at = dernière compression)
 *     widgets   slug → { title, layout, stories: [slugs dans l'ordre] }
 *     products  wp_product_id → [slugs de widgets]   (fiches produit)
 *     pages     chemin de page → [slugs de widgets]   (ex. /youvape-awards)
 *     product_info  wp_product_id → { title, image, price } (page d'aperçu)
 *   stories/widgets/<slug>.json   un widget déplié (stories complètes), pour
 *                                 un usage côté navigateur ou un contrôle à l'œil.
 *
 * Seules les stories PRÊTES et les widgets PUBLIÉS partent : une story en
 * compression ou archivée disparaît du site à la publication suivante.
 * Les fichiers vidéo eux-mêmes sont déjà sur R2 (versionnés, immuables).
 */
const r2 = require('./r2Service');
const widgetModel = require('../models/storyWidgetModel');
const sitePurge = require('./sitePurgeService');

const FORMAT_VERSION = 1;

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

const storyJson = (s) => ({
  slug: s.slug,
  title: s.title,
  description: s.description || null,
  format: s.format,
  duration: num(s.duration_s),
  width: s.width,
  height: s.height,
  version: s.version,
  video: r2.publicUrl(s.video_key),
  poster: r2.publicUrl(s.poster_key),
  thumb: r2.publicUrl(s.thumb_key),
  gif: r2.publicUrl(s.gif_key),
  cta: s.cta_url || s.wp_product_id
    ? {
      label: s.cta_label || 'DÉCOUVRIR',
      url: s.cta_url || null,
      product_id: num(s.wp_product_id),
      variation_id: num(s.wp_variation_id),
    }
    : null,
  updated_at: s.processed_at,
  // Date de création de la story (premier envoi dans l'app) : fixe, jamais
  // modifiée ensuite (ni republication, ni nouvelle version, ni nouveau widget).
  // Sert d'`uploadDate` aux données structurées VideoObject du site, qui
  // exigent une date stable — `updated_at`, lui, bouge à chaque compression.
  created_at: s.created_at,
});

const publish = async ({ userId } = {}) => {
  const data = await widgetModel.dataForPublish();
  const generatedAt = new Date().toISOString();

  const stories = Object.fromEntries(data.stories.map((s) => [s.slug, storyJson(s)]));

  const widgets = {};
  for (const w of data.widgets) {
    widgets[w.slug] = {
      title: w.title,
      layout: w.layout,
      stories: data.items.filter((i) => i.widget_id === w.id).map((i) => i.slug),
      updated_at: w.updated_at,
    };
  }
  // Un widget vide n'a rien à afficher : il ne part pas, et ses emplacements non plus.
  const live = new Set(Object.keys(widgets).filter((slug) => widgets[slug].stories.length));
  const slugById = new Map(data.widgets.map((w) => [w.id, w.slug]));

  const products = {};
  const pages = {};
  for (const p of data.placements) {
    const slug = slugById.get(p.widget_id);
    if (!live.has(slug)) continue;
    const map = p.target_type === 'product' ? products : pages;
    (map[p.target_ref] ||= []).push(slug);
  }

  const index = {
    format_version: FORMAT_VERSION,
    generated_at: generatedAt,
    base_url: process.env.R2_PUBLIC_BASE_URL,
    stories,
    widgets: Object.fromEntries([...live].map((slug) => [slug, widgets[slug]])),
    products,
    pages,
    // Informatif (page d'aperçu) : nom, photo et prix TTC des fiches visées.
    product_info: Object.fromEntries(data.products
      .filter((pr) => products[String(pr.wp_product_id)])
      .map((pr) => [String(pr.wp_product_id), {
        title: pr.post_title, image: pr.image_url || null, price: num(pr.price),
      }])),
  };

  // Les widgets dépliés d'abord, l'index en dernier : le site ne voit la
  // nouvelle publication qu'une fois tout en place.
  for (const slug of live) {
    const w = widgets[slug];
    await r2.putPublicObject(
      `stories/widgets/${slug}.json`,
      JSON.stringify({
        format_version: FORMAT_VERSION,
        generated_at: generatedAt,
        slug,
        title: w.title,
        layout: w.layout,
        stories: w.stories.map((s) => stories[s]),
      }),
      'application/json; charset=utf-8',
    );
  }
  await r2.putPublicObject('stories/index.json', JSON.stringify(index), 'application/json; charset=utf-8');

  const record = await widgetModel.recordPublication({
    userId,
    widgetsCount: live.size,
    storiesCount: data.stories.length,
  });

  // Une seule purge par publication, et seulement APRÈS l'écriture d'index.json
  // (sinon le site relirait l'ancienne version). Son échec n'annule rien : la
  // publication est faite, le site la verra au plus tard 5 min après.
  let purge;
  try {
    purge = await sitePurge.purgeAfterPublish({
      onFinal: (final) => widgetModel.recordPurge(record.id, final),
    });
    await widgetModel.recordPurge(record.id, purge);
  } catch (err) {
    console.error('[stories/purge] imprévu :', err.message);
    purge = { status: 'failed', attempts: 0, error: err.message };
  }
  return {
    published_at: record.published_at,
    widgets: live.size,
    stories: data.stories.length,
    products: Object.keys(products).length,
    pages: Object.keys(pages).length,
    empty_widgets: Object.keys(widgets).filter((slug) => !live.has(slug)),
    index_url: r2.publicUrl('stories/index.json'),
    purge: {
      status: purge.status,
      attempts: purge.attempts,
      error: purge.error || null,
      stories: purge.result?.stories ?? null,
      urls: Array.isArray(purge.result?.urls) ? purge.result.urls.length : null,
    },
  };
};

module.exports = { publish };
