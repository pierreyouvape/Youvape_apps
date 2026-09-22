const pool = require('../config/database');
const { buildBarcode, isValidBarcode } = require('../utils/employeeBarcode');

/**
 * Registre des salariés (app « Gestion employé »).
 *
 * Indépendant de `users` : un salarié peut n'avoir aucun compte app, et les
 * codes-barres d'avril 2026 précèdent les comptes de plusieurs d'entre eux.
 */

const SELECT_FIELDS = `
  e.id, e.first_name, e.last_name, e.barcode, e.barcode_seq,
  e.barcode_generated_at, e.user_id, e.active, e.created_at, e.updated_at,
  u.email AS user_email, u.name AS user_name`;

const trim = (v, max = 100) => String(v ?? '').trim().slice(0, max);

/** Verrou le temps de la transaction : deux « Générer » simultanés ne peuvent
 *  pas lire le même n° d'ordre maximum et produire deux codes identiques. */
const SEQ_LOCK = 4242101;

module.exports = {

  /** Tous les salariés, présents d'abord, puis par nom. */
  list: async () => {
    const { rows } = await pool.query(
      `SELECT ${SELECT_FIELDS}
         FROM employees e
         LEFT JOIN users u ON u.id = e.user_id
        ORDER BY e.active DESC, e.last_name ASC, e.first_name ASC`,
    );
    return rows;
  },

  getById: async (id) => {
    const { rows } = await pool.query(
      `SELECT ${SELECT_FIELDS}
         FROM employees e
         LEFT JOIN users u ON u.id = e.user_id
        WHERE e.id = $1`,
      [id],
    );
    return rows[0] || null;
  },

  /** Comptes app disponibles pour le rattachement (tous, l'écran filtre). */
  listUsers: async () => {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.name,
              (SELECT e.id FROM employees e WHERE e.user_id = u.id LIMIT 1) AS employee_id
         FROM users u
        ORDER BY u.name ASC NULLS LAST, u.email ASC`,
    );
    return rows;
  },

  create: async ({ firstName, lastName, userId = null, active = true }) => {
    const { rows } = await pool.query(
      `INSERT INTO employees (first_name, last_name, user_id, active)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [trim(firstName), trim(lastName), userId || null, active !== false],
    );
    return module.exports.getById(rows[0].id);
  },

  /**
   * Met à jour l'identité, le rattachement ou la présence.
   * Le code-barre n'est jamais touché ici : renommer quelqu'un ne réimprime
   * pas son étiquette, et son code reste celui qui est déjà collé.
   */
  update: async (id, { firstName, lastName, userId, active }) => {
    const sets = [];
    const vals = [];
    const push = (sql, val) => { vals.push(val); sets.push(`${sql} = $${vals.length}`); };

    if (firstName !== undefined) push('first_name', trim(firstName));
    if (lastName !== undefined) push('last_name', trim(lastName));
    if (userId !== undefined) push('user_id', userId || null);
    if (active !== undefined) push('active', active !== false);
    if (!sets.length) return module.exports.getById(id);

    vals.push(id);
    await pool.query(
      `UPDATE employees SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $${vals.length}`,
      vals,
    );
    return module.exports.getById(id);
  },

  /**
   * Attribue un code au salarié : n° d'ordre suivant de la série, jamais
   * réutilisé (on lit le max, pas un trou). Refuse s'il en a déjà un —
   * régénérer invaliderait l'étiquette en circulation.
   */
  generateBarcode: async (id) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [SEQ_LOCK]);

      const { rows } = await client.query(
        'SELECT id, first_name, last_name, barcode FROM employees WHERE id = $1 FOR UPDATE',
        [id],
      );
      const employee = rows[0];
      if (!employee) {
        await client.query('ROLLBACK');
        return { error: 'NOT_FOUND' };
      }
      if (employee.barcode) {
        await client.query('ROLLBACK');
        return { error: 'ALREADY_HAS_BARCODE' };
      }

      const { rows: maxRows } = await client.query(
        'SELECT COALESCE(MAX(barcode_seq), 0) + 1 AS next FROM employees',
      );
      const seq = Number(maxRows[0].next);
      const barcode = buildBarcode({
        firstName: employee.first_name,
        lastName: employee.last_name,
        seq,
      });
      // Garde-fou : un code mal formé partirait à l'impression sans se voir.
      if (!isValidBarcode(barcode)) {
        await client.query('ROLLBACK');
        return { error: 'INVALID_BARCODE' };
      }

      await client.query(
        `UPDATE employees
            SET barcode = $1, barcode_seq = $2,
                barcode_generated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = $3`,
        [barcode, seq, id],
      );
      await client.query('COMMIT');
      return { employee: await module.exports.getById(id) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  /** Suppression réservée aux saisies erronées : un salarié qui part s'archive. */
  remove: async (id) => {
    const { rowCount } = await pool.query(
      'DELETE FROM employees WHERE id = $1 AND barcode IS NULL',
      [id],
    );
    return rowCount > 0;
  },
};
