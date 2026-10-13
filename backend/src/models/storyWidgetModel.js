/**
 * Widgets de l'app « Stories » : listes ordonnées de stories, au format bulles
 * ou carrousel, rattachées à des fiches produit ou à des pages du site.
 * Voir migrations/add_story_widgets.sql.
 *
 * Toute modification d'un widget (contenu, ordre, emplacements) touche son
 * `updated_at` : c'est ce qui signale dans l'app une modification pas encore
 * publiée sur le site.
 */
const pool = require('../config/database');

const touch = (client, widgetId) => client.query(
  'UPDATE story_widgets SET updated_at = NOW() WHERE id = $1', [widgetId],
);

const list = async () => {
  const { rows } = await pool.query(
    `SELECT w.*,
            (SELECT count(*)::int FROM story_widget_items i WHERE i.widget_id = w.id) AS stories_count,
            (SELECT count(*)::int FROM story_placements p WHERE p.widget_id = w.id) AS placements_count,
            (SELECT array_agg(s.thumb_key ORDER BY i.position)
               FROM story_widget_items i JOIN stories s ON s.id = i.story_id
              WHERE i.widget_id = w.id) AS thumb_keys
       FROM story_widgets w
      ORDER BY w.created_at DESC`,
  );
  return rows;
};

const getById = async (id) => {
  const { rows } = await pool.query('SELECT * FROM story_widgets WHERE id = $1', [id]);
  const widget = rows[0];
  if (!widget) return null;
  const [items, placements] = await Promise.all([
    pool.query(
      `SELECT i.position, s.id, s.slug, s.title, s.status, s.format, s.thumb_key, s.duration_s
         FROM story_widget_items i JOIN stories s ON s.id = i.story_id
        WHERE i.widget_id = $1
        ORDER BY i.position`,
      [id],
    ),
    pool.query(
      `SELECT p.id, p.target_type, p.target_ref, pr.post_title, pr.post_status, pr.image_url
         FROM story_placements p
         LEFT JOIN products pr
                ON pr.wp_product_id = CASE WHEN p.target_type = 'product' THEN p.target_ref::bigint END
        WHERE p.widget_id = $1
        ORDER BY p.target_type, pr.post_title, p.target_ref`,
      [id],
    ),
  ]);
  return { ...widget, stories: items.rows, placements: placements.rows };
};

const slugExists = async (slug) => {
  const { rows } = await pool.query('SELECT 1 FROM story_widgets WHERE slug = $1', [slug]);
  return rows.length > 0;
};

const create = async ({ slug, title, layout, createdBy }) => {
  const { rows } = await pool.query(
    `INSERT INTO story_widgets (slug, title, layout, created_by)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [slug, title, layout, createdBy || null],
  );
  return rows[0];
};

const update = async (id, { title, layout, status }) => {
  const { rows } = await pool.query(
    `UPDATE story_widgets
        SET title = COALESCE($2, title),
            layout = COALESCE($3, layout),
            status = COALESCE($4, status),
            updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, title ?? null, layout ?? null, status ?? null],
  );
  return rows[0] || null;
};

const remove = async (id) => {
  const { rowCount } = await pool.query('DELETE FROM story_widgets WHERE id = $1', [id]);
  return rowCount > 0;
};

/** Remplace le contenu du widget par cette liste ordonnée de stories. */
const setStories = async (widgetId, storyIds) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM story_widget_items WHERE widget_id = $1', [widgetId]);
    for (let i = 0; i < storyIds.length; i += 1) {
      await client.query(
        `INSERT INTO story_widget_items (widget_id, story_id, position) VALUES ($1, $2, $3)
         ON CONFLICT (widget_id, story_id) DO NOTHING`,
        [widgetId, storyIds[i], i],
      );
    }
    await touch(client, widgetId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const addPlacement = async (widgetId, targetType, targetRef) => {
  const { rows } = await pool.query(
    `INSERT INTO story_placements (widget_id, target_type, target_ref) VALUES ($1, $2, $3)
     ON CONFLICT (widget_id, target_type, target_ref) DO NOTHING RETURNING *`,
    [widgetId, targetType, targetRef],
  );
  await touch(pool, widgetId);
  return rows[0] || null;
};

const removePlacement = async (widgetId, placementId) => {
  const { rowCount } = await pool.query(
    'DELETE FROM story_placements WHERE id = $1 AND widget_id = $2', [placementId, widgetId],
  );
  if (rowCount) await touch(pool, widgetId);
  return rowCount > 0;
};

/**
 * Produits auxquels rattacher un widget : produit simple, variable ou pack,
 * jamais une déclinaison (la fiche produit est celle du parent).
 */
const searchProducts = async (q) => {
  const term = String(q || '').trim();
  if (term.length < 2) return [];
  const asId = /^\d+$/.test(term) ? term : null;
  const { rows } = await pool.query(
    `SELECT wp_product_id, post_title, product_type, post_status, sku, image_url
       FROM products
      WHERE product_type IN ('simple', 'variable', 'woosb')
        AND post_status IN ('publish', 'draft', 'private')
        AND wc_deleted_at IS NULL
        AND (post_title ILIKE $1 OR sku ILIKE $1 OR wp_product_id::text = $2)
      ORDER BY (post_status = 'publish') DESC, post_title
      LIMIT 20`,
    [`%${term}%`, asId],
  );
  return rows;
};

/** Contenu publiable : widgets publiés, leurs stories prêtes, leurs emplacements. */
const dataForPublish = async () => {
  const [widgets, items, placements, stories, products] = await Promise.all([
    pool.query(`SELECT * FROM story_widgets WHERE status = 'published' ORDER BY id`),
    pool.query(
      `SELECT i.widget_id, s.slug
         FROM story_widget_items i
         JOIN story_widgets w ON w.id = i.widget_id AND w.status = 'published'
         JOIN stories s ON s.id = i.story_id AND s.status = 'ready'
        ORDER BY i.widget_id, i.position`,
    ),
    pool.query(
      `SELECT p.widget_id, p.target_type, p.target_ref
         FROM story_placements p
         JOIN story_widgets w ON w.id = p.widget_id AND w.status = 'published'
        ORDER BY p.target_type, p.target_ref, p.widget_id`,
    ),
    // Toutes les vidéos prêtes, même hors widget : la future médiathèque /videos les liste toutes.
    pool.query(`SELECT * FROM stories WHERE status = 'ready' ORDER BY created_at DESC`),
    // Nom, photo et prix des fiches produit visées : pour la page d'aperçu (le
    // site, lui, a déjà ces informations sur la fiche).
    pool.query(
      `SELECT DISTINCT pr.wp_product_id, pr.post_title, pr.image_url, pr.price
         FROM story_placements p
         JOIN story_widgets w ON w.id = p.widget_id AND w.status = 'published'
         -- Jointure sur l'index unique de wp_product_id (et non sur un ::text, qui
         -- parcourait toute la table) ; le CASE ne convertit que les lignes produit.
         JOIN products pr
           ON pr.wp_product_id = CASE WHEN p.target_type = 'product' THEN p.target_ref::bigint END`,
    ),
  ]);
  return {
    widgets: widgets.rows, items: items.rows, placements: placements.rows, stories: stories.rows,
    products: products.rows,
  };
};

const recordPublication = async ({ userId, widgetsCount, storiesCount }) => {
  const { rows } = await pool.query(
    `INSERT INTO story_publications (published_by, widgets_count, stories_count)
     VALUES ($1, $2, $3) RETURNING *`,
    [userId || null, widgetsCount, storiesCount],
  );
  return rows[0];
};

/** Dernière publication et présence de modifications postérieures. */
const publicationState = async () => {
  const { rows } = await pool.query(
    `SELECT p.published_at, p.widgets_count, p.stories_count, u.email AS published_by_email,
            GREATEST(
              (SELECT max(updated_at) FROM story_widgets),
              (SELECT max(updated_at) FROM stories)
            ) AS last_change_at
       FROM (SELECT * FROM story_publications ORDER BY published_at DESC LIMIT 1) p
       LEFT JOIN users u ON u.id = p.published_by`,
  );
  const last = rows[0] || null;
  if (!last) {
    const { rows: any } = await pool.query('SELECT EXISTS (SELECT 1 FROM story_widgets) AS has_widgets');
    return { last: null, pending: any[0].has_widgets };
  }
  return {
    last,
    pending: Boolean(last.last_change_at && last.last_change_at > last.published_at),
  };
};

module.exports = {
  list,
  getById,
  slugExists,
  create,
  update,
  remove,
  setStories,
  addPlacement,
  removePlacement,
  searchProducts,
  dataForPublish,
  recordPublication,
  publicationState,
};
