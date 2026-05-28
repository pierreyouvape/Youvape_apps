const pool = require('../config/database');

const savViewModel = {

  getAll: async () => {
    const res = await pool.query(`SELECT * FROM sav_views ORDER BY sort_order, id`);
    return res.rows;
  },

  create: async ({ label, statuses }) => {
    const res = await pool.query(
      `INSERT INTO sav_views (label, statuses, sort_order, updated_at)
       VALUES ($1, $2::jsonb, (SELECT COALESCE(MAX(sort_order),0)+1 FROM sav_views), NOW())
       RETURNING *`,
      [label.trim(), JSON.stringify(statuses || [])]
    );
    return res.rows[0];
  },

  update: async (id, { label, statuses }) => {
    const res = await pool.query(
      `UPDATE sav_views SET label=$1, statuses=$2::jsonb, updated_at=NOW()
       WHERE id=$3 RETURNING *`,
      [label.trim(), JSON.stringify(statuses || []), id]
    );
    return res.rows[0] || null;
  },

  reorder: async (orderedIds) => {
    // orderedIds = [id1, id2, ...] dans le nouvel ordre
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < orderedIds.length; i++) {
        await client.query(
          `UPDATE sav_views SET sort_order=$1, updated_at=NOW() WHERE id=$2`,
          [i + 1, orderedIds[i]]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  delete: async (id) => {
    await pool.query(`DELETE FROM sav_views WHERE id=$1`, [id]);
  },
};

module.exports = savViewModel;
