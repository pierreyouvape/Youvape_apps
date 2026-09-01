const pool = require('../config/database');

/** Statuts autorisés — toute autre valeur est ramenée à 'draft'. */
const STATUSES = ['draft', 'published', 'archived'];
const normalizeStatus = (s) => (STATUSES.includes(s) ? s : 'draft');

/** Encadrés autorisés sur une étape. */
const CALLOUTS = ['info', 'warning', 'danger'];

/**
 * Visibilité d'un process.
 *   'restricted' : seuls les utilisateurs listés dans process_access le voient
 *   'all'        : lisible par tout détenteur de l'app — l'écriture, elle,
 *                  reste toujours nominative
 * Dans les deux cas, un admin voit et modifie tout sans figurer nulle part.
 */
const VISIBILITIES = ['restricted', 'all'];
const normalizeVisibility = (v) => (VISIBILITIES.includes(v) ? v : 'restricted');

const SUPER_ADMIN_EMAIL = 'youvape34@gmail.com';

/**
 * Normalise les étapes reçues du frontend avant écriture.
 * La position est TOUJOURS recalculée depuis l'ordre du tableau : le frontend
 * n'a qu'à envoyer les étapes dans le bon ordre.
 */
function normalizeSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.map((s, i) => ({
    position: i + 1,
    title: (s?.title ?? '').toString().slice(0, 500) || null,
    body: (s?.body ?? '').toString() || null,
    callout: CALLOUTS.includes(s?.callout) ? s.callout : null,
    images: Array.isArray(s?.images)
      ? s.images
          .filter((img) => img && typeof img.url === 'string')
          .map((img) => ({
            filename: img.filename || null,
            original_name: img.original_name || null,
            mime: img.mime || null,
            size: img.size || null,
            // On retire toute signature : l'URL stockée est le chemin nu, et
            // c'est le contrôleur qui re-signe à chaque lecture.
            url: String(img.url).split('?')[0],
            caption: (img.caption ?? '').toString().slice(0, 300) || null,
          }))
      : [],
  }));
}

class ProcessModel {

  /* ─── Droits ──────────────────────────────────────────────────────────── */

  /**
   * L'utilisateur est-il administrateur ? (super admin par email, ou is_admin
   * en base). Même règle que middleware/permissionMiddleware.checkAdmin.
   */
  async isAdmin(user) {
    if (!user) return false;
    if (user.email === SUPER_ADMIN_EMAIL) return true;
    const res = await pool.query('SELECT is_admin FROM users WHERE id = $1', [user.id]);
    return !!res.rows[0]?.is_admin;
  }

  /**
   * Droits d'un acteur sur un process donné.
   *
   * @param {number} processId
   * @param {{id:number, isAdmin:boolean}} actor
   * @returns {{exists:boolean, canRead:boolean, canWrite:boolean}}
   *
   * Un process qu'on n'a pas le droit de voir doit se comporter comme un
   * process inexistant côté API : c'est au contrôleur de répondre 404 et non
   * 403, un 403 confirmerait son existence.
   */
  async resolveRights(processId, actor) {
    const res = await pool.query(
      `SELECT p.visibility,
              a.can_write AS granted_write,
              (a.user_id IS NOT NULL) AS granted
       FROM processes p
       LEFT JOIN process_access a ON a.process_id = p.id AND a.user_id = $2
       WHERE p.id = $1`,
      [processId, actor?.id || null]
    );
    const row = res.rows[0];
    if (!row) return { exists: false, canRead: false, canWrite: false };
    if (actor?.isAdmin) return { exists: true, canRead: true, canWrite: true };

    return {
      exists: true,
      canRead: row.visibility === 'all' || row.granted,
      // L'écriture ne vient JAMAIS de visibility : toujours d'un accès nominatif.
      canWrite: !!row.granted_write,
    };
  }

  /* ─── Accès nominatifs ────────────────────────────────────────────────── */

  async listAccess(processId) {
    const res = await pool.query(
      `SELECT a.user_id, a.can_write, a.granted_at,
              u.name AS user_name, u.email AS user_email,
              g.name AS granted_by_name
       FROM process_access a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN users g ON g.id = a.granted_by
       WHERE a.process_id = $1
       ORDER BY u.name ASC`,
      [processId]
    );
    return res.rows;
  }

  async setAccess(processId, userId, canWrite, grantedBy) {
    const res = await pool.query(
      `INSERT INTO process_access (process_id, user_id, can_write, granted_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (process_id, user_id)
       DO UPDATE SET can_write = EXCLUDED.can_write,
                     granted_by = EXCLUDED.granted_by,
                     granted_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [processId, userId, !!canWrite, grantedBy || null]
    );
    return res.rows[0];
  }

  async removeAccess(processId, userId) {
    const res = await pool.query(
      `DELETE FROM process_access WHERE process_id = $1 AND user_id = $2 RETURNING *`,
      [processId, userId]
    );
    return res.rows[0] || null;
  }

  async setVisibility(processId, visibility) {
    const res = await pool.query(
      `UPDATE processes SET visibility = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [normalizeVisibility(visibility), processId]
    );
    return res.rows[0] || null;
  }

  /* ─── Catégories ──────────────────────────────────────────────────────── */

  async listCategories() {
    const res = await pool.query(`
      SELECT c.*, COUNT(p.id)::int AS processes_count
      FROM process_categories c
      LEFT JOIN processes p ON p.category_id = c.id
      GROUP BY c.id
      ORDER BY c.position ASC, c.name ASC
    `);
    return res.rows;
  }

  async createCategory({ name, color }) {
    const res = await pool.query(
      `INSERT INTO process_categories (name, color, position)
       VALUES ($1, $2, COALESCE((SELECT MAX(position) + 1 FROM process_categories), 1))
       RETURNING *`,
      [name, color || '#135E84']
    );
    return res.rows[0];
  }

  async updateCategory(id, { name, color }) {
    const res = await pool.query(
      `UPDATE process_categories SET name = $1, color = $2 WHERE id = $3 RETURNING *`,
      [name, color || '#135E84', id]
    );
    return res.rows[0] || null;
  }

  // Les process rattachés ne sont pas supprimés : leur category_id passe à NULL
  // (ON DELETE SET NULL).
  async deleteCategory(id) {
    const res = await pool.query(`DELETE FROM process_categories WHERE id = $1 RETURNING *`, [id]);
    return res.rows[0] || null;
  }

  /* ─── Liste ───────────────────────────────────────────────────────────── */

  /**
   * @param {object} filters
   *   q           recherche plein texte (titre, résumé, contenu des étapes)
   *   category_id filtre catégorie
   *   status      filtre statut ('all' = tous)
   * @param {{id:number, isAdmin:boolean}} actor
   *
   * Le filtre de visibilité vit dans le WHERE, pas dans un filtrage des
   * résultats : un process invisible ne doit jamais quitter la base.
   */
  async list({ q, category_id, status } = {}, actor = {}) {
    const where = [];
    const values = [];
    let i = 1;

    if (!actor.isAdmin) {
      where.push(`(p.visibility = 'all' OR EXISTS (
        SELECT 1 FROM process_access a WHERE a.process_id = p.id AND a.user_id = $${i}
      ))`);
      values.push(actor.id || null);
      i++;
    }

    if (q && q.trim()) {
      // Le corps des étapes est du HTML : on retire les balises avant de
      // chercher, sinon « div » ou « strong » remonteraient tous les process.
      where.push(`(
        p.title ILIKE $${i} OR p.summary ILIKE $${i}
        OR EXISTS (
          SELECT 1 FROM process_steps s
          WHERE s.process_id = p.id
            AND (s.title ILIKE $${i}
                 OR regexp_replace(COALESCE(s.body, ''), '<[^>]*>', ' ', 'g') ILIKE $${i})
        )
      )`);
      values.push(`%${q.trim()}%`);
      i++;
    }
    if (category_id) {
      where.push(`p.category_id = $${i++}`);
      values.push(category_id);
    }
    if (status && status !== 'all') {
      where.push(`p.status = $${i++}`);
      values.push(status);
    } else if (!status) {
      // Par défaut, on masque les process archivés.
      where.push(`p.status <> 'archived'`);
    }

    const res = await pool.query(`
      SELECT
        p.id, p.title, p.summary, p.status, p.version_no, p.visibility,
        p.category_id, p.created_at, p.updated_at,
        (SELECT COUNT(*)::int FROM process_access a WHERE a.process_id = p.id) AS access_count,
        c.name AS category_name, c.color AS category_color,
        author.name  AS created_by_name,
        editor.name  AS updated_by_name,
        (SELECT COUNT(*)::int FROM process_steps s WHERE s.process_id = p.id) AS steps_count
      FROM processes p
      LEFT JOIN process_categories c ON c.id = p.category_id
      LEFT JOIN users author ON author.id = p.created_by
      LEFT JOIN users editor ON editor.id = p.updated_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY p.updated_at DESC
    `, values);
    return res.rows;
  }

  /* ─── Détail ──────────────────────────────────────────────────────────── */

  async getById(id) {
    const res = await pool.query(`
      SELECT
        p.*,
        c.name AS category_name, c.color AS category_color,
        author.name AS created_by_name, author.email AS created_by_email,
        editor.name AS updated_by_name, editor.email AS updated_by_email
      FROM processes p
      LEFT JOIN process_categories c ON c.id = p.category_id
      LEFT JOIN users author ON author.id = p.created_by
      LEFT JOIN users editor ON editor.id = p.updated_by
      WHERE p.id = $1
    `, [id]);

    const process = res.rows[0];
    if (!process) return null;

    const steps = await pool.query(
      `SELECT id, position, title, body, callout, images
       FROM process_steps WHERE process_id = $1 ORDER BY position ASC`,
      [id]
    );
    process.steps = steps.rows;
    return process;
  }

  /* ─── Création ────────────────────────────────────────────────────────── */

  /**
   * Crée un process vide (titre seul) et sa version 1. Les étapes sont
   * ajoutées ensuite via saveContent, depuis la page de détail.
   *
   * La visibilité et les accès nominatifs sont posés dans la même transaction :
   * un process ne doit jamais exister, même une fraction de seconde, sans la
   * liste d'accès que son créateur a choisie.
   *
   * @param {Array<{user_id:number, can_write:boolean}>} access
   */
  async create({ title, summary, category_id, visibility, access, created_by }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const res = await client.query(
        `INSERT INTO processes
           (title, summary, category_id, status, visibility, version_no, created_by, updated_by)
         VALUES ($1, $2, $3, 'draft', $4, 1, $5, $5)
         RETURNING *`,
        [title, summary || null, category_id || null, normalizeVisibility(visibility), created_by || null]
      );
      const process = res.rows[0];

      await client.query(
        `INSERT INTO process_versions
           (process_id, version_no, title, summary, category_id, status, steps, change_note, author_id)
         VALUES ($1, 1, $2, $3, $4, 'draft', '[]'::jsonb, 'Création', $5)`,
        [process.id, process.title, process.summary, process.category_id, created_by || null]
      );

      for (const entry of Array.isArray(access) ? access : []) {
        const userId = parseInt(entry?.user_id, 10);
        if (!Number.isInteger(userId) || userId <= 0) continue;
        await client.query(
          `INSERT INTO process_access (process_id, user_id, can_write, granted_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (process_id, user_id) DO NOTHING`,
          [process.id, userId, !!entry.can_write, created_by || null]
        );
      }

      await client.query('COMMIT');
      return process;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /* ─── Enregistrement (= nouvelle version) ─────────────────────────────── */

  /**
   * Remplace le contenu courant ET fige une nouvelle version.
   *
   * Chaque appel incrémente version_no : l'historique garde donc l'état complet
   * avant/après, avec son auteur et sa note. Les étapes sont réécrites en bloc
   * (delete + insert) — leurs ids ne sont pas stables, ce sont les positions qui
   * font foi.
   */
  async saveContent(id, { title, summary, category_id, status, steps, change_note, author_id }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Verrou sur la ligne : deux enregistrements simultanés ne peuvent pas
      // réclamer le même numéro de version.
      const current = await client.query(
        `SELECT version_no FROM processes WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (current.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      const nextVersion = current.rows[0].version_no + 1;
      const cleanSteps = normalizeSteps(steps);
      const cleanStatus = normalizeStatus(status);

      const updated = await client.query(
        `UPDATE processes
         SET title = $1, summary = $2, category_id = $3, status = $4,
             version_no = $5, updated_by = $6, updated_at = NOW()
         WHERE id = $7
         RETURNING *`,
        [title, summary || null, category_id || null, cleanStatus, nextVersion, author_id || null, id]
      );

      await client.query(`DELETE FROM process_steps WHERE process_id = $1`, [id]);
      for (const step of cleanSteps) {
        await client.query(
          `INSERT INTO process_steps (process_id, position, title, body, callout, images)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [id, step.position, step.title, step.body, step.callout, JSON.stringify(step.images)]
        );
      }

      await client.query(
        `INSERT INTO process_versions
           (process_id, version_no, title, summary, category_id, status, steps, change_note, author_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
        [
          id, nextVersion, title, summary || null, category_id || null, cleanStatus,
          JSON.stringify(cleanSteps), change_note?.trim() || null, author_id || null,
        ]
      );

      await client.query('COMMIT');
      return updated.rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /* ─── Historique ──────────────────────────────────────────────────────── */

  // Sans le snapshot `steps`, trop lourd pour une liste.
  async listVersions(processId) {
    const res = await pool.query(`
      SELECT v.id, v.version_no, v.title, v.summary, v.status, v.change_note,
             v.created_at, v.author_id,
             u.name AS author_name, u.email AS author_email,
             jsonb_array_length(v.steps) AS steps_count
      FROM process_versions v
      LEFT JOIN users u ON u.id = v.author_id
      WHERE v.process_id = $1
      ORDER BY v.version_no DESC
    `, [processId]);
    return res.rows;
  }

  async getVersion(processId, versionId) {
    const res = await pool.query(`
      SELECT v.*, u.name AS author_name, u.email AS author_email,
             c.name AS category_name, c.color AS category_color
      FROM process_versions v
      LEFT JOIN users u ON u.id = v.author_id
      LEFT JOIN process_categories c ON c.id = v.category_id
      WHERE v.process_id = $1 AND v.id = $2
    `, [processId, versionId]);
    return res.rows[0] || null;
  }

  /**
   * Restaure une version : recopie son contenu en tant que NOUVELLE version.
   * L'historique n'est jamais tronqué — on peut donc annuler une restauration
   * en restaurant la version d'avant.
   */
  async restoreVersion(processId, versionId, authorId) {
    const version = await this.getVersion(processId, versionId);
    if (!version) return null;

    return this.saveContent(processId, {
      title: version.title,
      summary: version.summary,
      category_id: version.category_id,
      status: version.status,
      steps: version.steps,
      change_note: `Restauration de la version ${version.version_no}`,
      author_id: authorId,
    });
  }

  /* ─── Suppression ─────────────────────────────────────────────────────── */

  // CASCADE emporte les étapes et l'historique ; les fichiers images sont
  // supprimés par le contrôleur.
  async remove(id) {
    const res = await pool.query(`DELETE FROM processes WHERE id = $1 RETURNING *`, [id]);
    return res.rows[0] || null;
  }
}

module.exports = new ProcessModel();
