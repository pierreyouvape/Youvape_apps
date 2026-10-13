/**
 * Accès BDD de l'app « Stories » (remplacement de Join Stories).
 * Voir migrations/add_stories.sql pour le cycle de vie d'une story.
 */
const pool = require('../config/database');

const EDITABLE = ['title', 'description', 'cta_label', 'cta_url', 'wp_product_id', 'wp_variation_id'];

const list = async ({ includeArchived = false } = {}) => {
  const { rows } = await pool.query(
    `SELECT s.*, u.email AS created_by_email, pr.post_title AS product_title
       FROM stories s
       LEFT JOIN users u ON u.id = s.created_by
       -- Nom du produit lié au bouton d'action, affiché à côté de son numéro.
       LEFT JOIN products pr ON pr.wp_product_id = s.wp_product_id
      WHERE $1 OR s.status <> 'archived'
      ORDER BY s.created_at DESC`,
    [includeArchived],
  );
  return rows;
};

const getById = async (id) => {
  const { rows } = await pool.query(
    `SELECT s.*, pr.post_title AS product_title
       FROM stories s
       LEFT JOIN products pr ON pr.wp_product_id = s.wp_product_id
      WHERE s.id = $1`,
    [id],
  );
  return rows[0] || null;
};

const slugExists = async (slug) => {
  const { rows } = await pool.query('SELECT 1 FROM stories WHERE slug = $1', [slug]);
  return rows.length > 0;
};

const create = async ({ slug, title, description, format, createdBy }) => {
  const { rows } = await pool.query(
    `INSERT INTO stories (slug, title, description, format, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [slug, title, description || null, format, createdBy || null],
  );
  return rows[0];
};

/** Mise à jour des seuls champs éditables (titre, description, bouton d'action). */
const update = async (id, fields) => {
  const keys = EDITABLE.filter((k) => Object.prototype.hasOwnProperty.call(fields, k));
  if (!keys.length) return getById(id);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  const values = keys.map((k) => (fields[k] === '' ? null : fields[k]));
  const { rowCount } = await pool.query(
    `UPDATE stories SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`,
    [id, ...values],
  );
  // Relu avec le nom du produit lié : l'écran l'affiche à la confirmation.
  return rowCount ? getById(id) : null;
};

/** Source annoncée par le navigateur avant l'envoi (clé R2 + nom d'origine). */
const setSourcePending = async (id, { sourceKey, sourceName }) => {
  const { rows } = await pool.query(
    `UPDATE stories
        SET source_key = $2, source_name = $3, source_size = NULL,
            status = 'awaiting_upload', error = NULL, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, sourceKey, sourceName],
  );
  return rows[0] || null;
};

/** Source reçue par R2 : la story entre dans la file de compression. */
const markUploaded = async (id, sourceSize) => {
  const { rows } = await pool.query(
    `UPDATE stories
        SET source_size = $2, status = 'uploaded', error = NULL, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, sourceSize],
  );
  return rows[0] || null;
};

/**
 * Prend la prochaine story à compresser, de façon atomique : deux passages
 * concurrents de la file ne peuvent pas réclamer la même ligne.
 */
const claimNext = async () => {
  const { rows } = await pool.query(
    `UPDATE stories
        SET status = 'processing', processing_started_at = NOW(), error = NULL, updated_at = NOW()
      WHERE id = (
        SELECT id FROM stories
         WHERE status = 'uploaded'
         ORDER BY updated_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
  );
  return rows[0] || null;
};

/**
 * Au démarrage : une compression interrompue par un redémarrage du backend
 * resterait « processing » pour toujours. On la remet dans la file.
 */
const requeueInterrupted = async () => {
  const { rowCount } = await pool.query(
    `UPDATE stories SET status = 'uploaded', updated_at = NOW() WHERE status = 'processing'`,
  );
  return rowCount;
};

const markReady = async (id, r) => {
  const { rows } = await pool.query(
    `UPDATE stories
        SET status = 'ready', error = NULL, version = $2,
            video_key = $3, video_size = $4, poster_key = $5, thumb_key = $6,
            gif_key = $7, gif_size = $8, duration_s = $9, width = $10, height = $11,
            processed_at = NOW(), updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, r.version, r.videoKey, r.videoSize, r.posterKey, r.thumbKey,
      r.gifKey, r.gifSize, r.duration, r.width, r.height],
  );
  return rows[0] || null;
};

const markError = async (id, message) => {
  await pool.query(
    `UPDATE stories SET status = 'error', error = $2, updated_at = NOW() WHERE id = $1`,
    [id, String(message || 'Erreur inconnue').slice(0, 2000)],
  );
};

/** Relance une compression (nouvelle version) à partir de la source déjà stockée. */
const requeue = async (id) => {
  const { rows } = await pool.query(
    `UPDATE stories SET status = 'uploaded', error = NULL, updated_at = NOW()
      WHERE id = $1 AND source_key IS NOT NULL AND source_size IS NOT NULL
      RETURNING *`,
    [id],
  );
  return rows[0] || null;
};

/** Archiver retire la story des listes ; ses fichiers publiés restent en ligne. */
const setArchived = async (id, archived) => {
  const { rows } = await pool.query(
    `UPDATE stories
        SET status = CASE WHEN $2 THEN 'archived'
                          WHEN video_key IS NOT NULL THEN 'ready'
                          WHEN source_size IS NOT NULL THEN 'uploaded'
                          ELSE 'awaiting_upload' END,
            updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, archived],
  );
  return rows[0] || null;
};

/**
 * Où chaque story est affichée : ses widgets (publiés ou non) et leurs
 * emplacements. Une même vidéo peut être dans plusieurs widgets, chacun sur
 * plusieurs fiches ou pages.
 */
const placementsByStory = async () => {
  const { rows } = await pool.query(
    `SELECT i.story_id, w.id AS widget_id, w.slug AS widget_slug, w.title AS widget_title,
            w.status AS widget_status, w.layout,
            p.target_type, p.target_ref, pr.post_title AS product_title
       FROM story_widget_items i
       JOIN story_widgets w ON w.id = i.widget_id
       LEFT JOIN story_placements p ON p.widget_id = w.id
       LEFT JOIN products pr
              ON pr.wp_product_id = CASE WHEN p.target_type = 'product' THEN p.target_ref::bigint END
      ORDER BY i.story_id, w.title, p.target_type, pr.post_title, p.target_ref`,
  );
  return rows;
};

/**
 * Statistiques par story sur `days` jours. Les événements de la page d'aperçu
 * (source = preview) sont exclus sauf demande : ce sont nos propres tests.
 * Lecture complète = palier 100 % atteint SANS saut (le lecteur ne compte pas
 * les paliers sautés).
 */
const STATS_COLUMNS = `
  count(*) FILTER (WHERE type = 'view')                                   AS views,
  count(DISTINCT session_id) FILTER (WHERE type = 'view')                 AS viewers,
  count(*) FILTER (WHERE type = 'progress' AND percent = 100)             AS completions,
  count(*) FILTER (WHERE type = 'progress' AND percent = 50)              AS halfway,
  count(*) FILTER (WHERE type = 'cta_click')                              AS clicks`;

const statsByStory = async ({ days = 30, includeTests = false } = {}) => {
  const { rows } = await pool.query(
    `SELECT story_slug, ${STATS_COLUMNS}
       FROM story_events
      WHERE at >= NOW() - make_interval(days => $1)
        AND story_slug IS NOT NULL
        AND ($2 OR source <> 'preview')
      GROUP BY story_slug`,
    [days, includeTests],
  );
  return rows;
};

/** Détail d'une story : par page, par appareil et par provenance (site, e-mail, test). */
const statsForStory = async (slug, { days = 30, includeTests = false } = {}) => {
  const where = `story_slug = $1 AND at >= NOW() - make_interval(days => $2) AND ($3 OR source <> 'preview')`;
  const params = [slug, days, includeTests];
  const [total, byPage, byDevice, bySource] = await Promise.all([
    pool.query(`SELECT ${STATS_COLUMNS} FROM story_events WHERE ${where}`, params),
    pool.query(`SELECT page, ${STATS_COLUMNS} FROM story_events WHERE ${where} GROUP BY page ORDER BY views DESC NULLS LAST`, params),
    pool.query(`SELECT device, count(*) FILTER (WHERE type = 'view') AS views FROM story_events WHERE ${where} GROUP BY device`, params),
    pool.query(`SELECT source, count(*) FILTER (WHERE type = 'view') AS views FROM story_events WHERE ${where} GROUP BY source`, params),
  ]);
  return { total: total.rows[0], by_page: byPage.rows, by_device: byDevice.rows, by_source: bySource.rows };
};

module.exports = {
  placementsByStory,
  statsByStory,
  statsForStory,
  list,
  getById,
  slugExists,
  create,
  update,
  setSourcePending,
  markUploaded,
  claimNext,
  requeueInterrupted,
  markReady,
  markError,
  requeue,
  setArchived,
};
