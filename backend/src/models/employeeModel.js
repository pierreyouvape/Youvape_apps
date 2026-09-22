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
  u.email AS user_email, u.name AS user_name, u.is_admin AS user_is_admin,
  u.disabled_at AS user_disabled_at,
  (SELECT COUNT(*)::int FROM user_permissions p
    WHERE p.user_id = e.user_id AND (p.can_read OR p.can_write)) AS app_count`;

const trim = (v, max = 100) => String(v ?? '').trim().slice(0, max);

/** Le super admin ne peut pas perdre son accès par cet écran. */
const SUPER_ADMIN_EMAIL = 'youvape34@gmail.com';

/**
 * Identifiant SQL cité. Les noms viennent du catalogue Postgres (donc réels),
 * mais ils entrent dans une requête construite : on les cite quand même.
 */
const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

/**
 * Tables où un compte laisse une trace nominative (clé étrangère en NO ACTION
 * ou RESTRICT vers `users`) : étiquettes, commandes fournisseur, tickets…
 * C'est cet historique qui interdit de supprimer un compte, et qu'on affiche
 * au départ d'un salarié. La liste est relue dans le catalogue Postgres, pour
 * qu'une table ajoutée demain soit prise en compte sans que personne n'y pense.
 */
const BLOCKING_FK_SQL = `
  SELECT src.relname AS table_name, att.attname AS column_name
    FROM pg_constraint c
    JOIN pg_class src ON src.oid = c.conrelid
    JOIN pg_class tgt ON tgt.oid = c.confrelid
    JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = c.conkey[1]
   WHERE c.contype = 'f' AND tgt.relname = 'users' AND c.confdeltype IN ('a', 'r')
   ORDER BY 1, 2`;

/** Libellés lisibles pour l'écran de suppression. Inconnu → nom de la table. */
const FK_LABELS = {
  shipment_labels: 'étiquettes d\'expédition',
  laposte_labels: 'étiquettes La Poste',
  purchase_orders: 'commandes fournisseur',
  sav_tickets: 'tickets SAV',
  sav_blocklist: 'entrées de la liste de blocage SAV',
};

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
      `SELECT u.id, u.email, u.name, u.is_admin, u.disabled_at,
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

      // Séquence plutôt que MAX()+1 : un n° d'ordre libéré par une suppression
      // ne doit jamais être réattribué (l'étiquette imprimée, elle, circule
      // encore). nextval() ne revient pas en arrière, même sur rollback.
      const { rows: seqRows } = await client.query("SELECT nextval('employees_barcode_seq') AS seq");
      const seq = Number(seqRows[0].seq);
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

  /** Comptes app rattachés à personne — à rattacher, ou restes d'un départ. */
  listOrphanAccounts: async () => {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.name, u.is_admin, u.disabled_at,
              (SELECT COUNT(*)::int FROM user_permissions p
                WHERE p.user_id = u.id AND (p.can_read OR p.can_write)) AS app_count
         FROM users u
         LEFT JOIN employees e ON e.user_id = u.id
        WHERE e.id IS NULL
        ORDER BY u.disabled_at NULLS FIRST, u.name ASC NULLS LAST, u.email ASC`,
    );
    return rows;
  },

  /**
   * Ce qu'un départ entraîne — lu par l'écran de confirmation.
   *
   * `history` n'est PAS une liste d'obstacles : c'est ce qui reste au nom de la
   * personne après son départ, et qui justifie qu'on ne supprime jamais son
   * compte. Effacer la ligne effacerait qui a emballé quoi.
   */
  deactivationImpact: async (id) => {
    const employee = await module.exports.getById(id);
    if (!employee) return null;

    const impact = {
      employee,
      has_account: !!employee.user_id,
      is_super_admin: employee.user_email === SUPER_ADMIN_EMAIL,
      app_count: 0,
      history: [],
    };
    if (!employee.user_id) return impact;

    const { rows: perms } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM user_permissions
        WHERE user_id = $1 AND (can_read OR can_write)`,
      [employee.user_id],
    );
    impact.app_count = perms[0].n;

    const { rows: fks } = await pool.query(BLOCKING_FK_SQL);
    for (const fk of fks) {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM ${quoteIdent(fk.table_name)}
          WHERE ${quoteIdent(fk.column_name)} = $1`,
        [employee.user_id],
      );
      if (rows[0].n > 0) {
        impact.history.push({
          table: fk.table_name,
          count: rows[0].n,
          label: FK_LABELS[fk.table_name] || fk.table_name,
        });
      }
    }
    return impact;
  },

  /**
   * Départ d'un salarié : sa fiche est archivée et son compte app désactivé.
   *
   * Rien n'est supprimé, jamais — ni la fiche, ni le compte, ni ce qu'il a
   * fait. Ce qui part, c'est l'accès : les droits sont effacés, la connexion
   * refusée, et le jeton en cours cesse d'être accepté (authMiddleware relit
   * les comptes actifs). Le compte disparaît aussi de l'écran Réglages, pour
   * ne pas laisser un profil fantôme dans la grille des permissions.
   *
   * @param {number} id
   * @param {boolean} keepAccount  true = archiver la fiche sans toucher au compte
   */
  deactivate: async (id, keepAccount = false) => {
    const impact = await module.exports.deactivationImpact(id);
    if (!impact) return { error: 'NOT_FOUND' };
    if (!keepAccount && impact.is_super_admin) return { error: 'SUPER_ADMIN' };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let accountAction = 'none';

      if (impact.has_account && !keepAccount) {
        const userId = impact.employee.user_id;
        // Les droits partent : au retour, ils seront à redonner dans Réglages.
        await client.query('DELETE FROM user_permissions WHERE user_id = $1', [userId]);
        await client.query(
          `UPDATE users SET disabled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1`,
          [userId],
        );
        accountAction = 'disabled';
      }

      await client.query(
        'UPDATE employees SET active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [id],
      );
      await client.query('COMMIT');
      return { account_action: accountAction, employee: await module.exports.getById(id) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Retour d'un salarié : fiche réactivée, connexion rouverte.
   * Les droits d'app, eux, ne reviennent PAS tout seuls — ils ont été effacés
   * au départ et se redonnent dans Réglages, en conscience.
   */
  reactivate: async (id) => {
    const employee = await module.exports.getById(id);
    if (!employee) return { error: 'NOT_FOUND' };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (employee.user_id) {
        await client.query(
          `UPDATE users SET disabled_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [employee.user_id],
        );
      }
      await client.query(
        'UPDATE employees SET active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [id],
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
};
