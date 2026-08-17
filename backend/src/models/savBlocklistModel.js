const pool = require('../config/database');

/**
 * Liste de blocage des demandes SAV publiques.
 *
 * Une demande qui matche n'est pas jetée : elle est créée en `is_spam` et
 * privée d'accusé de réception (voir clientSavController.createPublicTicket).
 * On ne perd donc jamais un faux positif — il reste dans la vue Spam.
 *
 * Quatre types de motifs, du plus précis au plus large :
 *   email    → adresse exacte
 *   domain   → tout ce qui suit le @ (sous-domaines inclus : `x.promodoc.ru`
 *              matche la règle `promodoc.ru`)
 *   local    → partie locale, tous domaines confondus
 *   contains → texte présent dans le nom OU le message
 */

const VALID_TYPES = ['email', 'domain', 'local', 'contains'];

// Le matching `contains` ne balaie que le début du message : au-delà, on ne
// gagne rien en détection et on paie une comparaison sur 10 000 caractères.
const CONTAINS_SCAN_LEN = 2000;

function splitEmail(email) {
  const clean = String(email || '').trim().toLowerCase();
  const at = clean.lastIndexOf('@');
  if (at === -1) return { email: clean, local: '', domain: '' };
  return { email: clean, local: clean.slice(0, at), domain: clean.slice(at + 1) };
}

const savBlocklistModel = {
  VALID_TYPES,

  async getAll() {
    const res = await pool.query(
      `SELECT b.*, u.name AS created_by_name
         FROM sav_blocklist b
         LEFT JOIN users u ON u.id = b.created_by
        ORDER BY b.is_active DESC, b.created_at DESC`
    );
    return res.rows;
  },

  /**
   * @returns {object|{error:string}} la règle créée, ou { error } si le motif
   *          est invalide / déjà présent (l'appelant traduit en 400/409).
   */
  async create({ type, value, reason, created_by }) {
    const t = String(type || '').trim();
    if (!VALID_TYPES.includes(t)) return { error: 'Type de motif invalide' };

    let v = String(value || '').trim().toLowerCase();
    if (!v) return { error: 'Motif vide' };
    if (v.length > 255) return { error: 'Motif trop long' };

    // Tolérance de saisie : un domaine collé depuis une adresse complète, ou
    // précédé d'un @, reste utilisable tel quel.
    if (t === 'domain') v = v.replace(/^@/, '').split('@').pop();
    if (t === 'email' && !v.includes('@')) return { error: 'Adresse email incomplète' };
    // Un `contains` d'un ou deux caractères matcherait à peu près tout message.
    if (t === 'contains' && v.length < 3) return { error: 'Motif « contient » trop court (3 caractères minimum)' };

    try {
      const res = await pool.query(
        `INSERT INTO sav_blocklist (type, value, reason, created_by)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [t, v, (reason || '').trim() || null, created_by || null]
      );
      return res.rows[0];
    } catch (e) {
      if (e.code === '23505') return { error: 'Ce motif est déjà dans la liste' };
      throw e;
    }
  },

  async update(id, { is_active, reason }) {
    const sets = [];
    const vals = [];
    if (is_active !== undefined) { vals.push(!!is_active); sets.push(`is_active = $${vals.length}`); }
    if (reason !== undefined) { vals.push((reason || '').trim() || null); sets.push(`reason = $${vals.length}`); }
    if (sets.length === 0) return null;
    vals.push(id);
    const res = await pool.query(
      `UPDATE sav_blocklist SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    return res.rows[0] || null;
  },

  async delete(id) {
    await pool.query('DELETE FROM sav_blocklist WHERE id = $1', [id]);
  },

  /**
   * Retire la règle qui vise exactement cet expéditeur — utilisée quand un agent
   * déclasse un ticket marqué spam par erreur, pour que la règle qui l'a produit
   * ne rebloque pas la prochaine demande.
   *
   * Ne touche ni aux `contains` ni aux `local` : ces motifs-là ne désignent pas
   * un expéditeur en particulier, les supprimer sur un seul faux positif ferait
   * repasser tout le reste.
   */
  async removeForSender(email) {
    const { email: full, domain } = splitEmail(email);
    if (!full) return [];
    const res = await pool.query(
      `DELETE FROM sav_blocklist
        WHERE (type = 'email'  AND lower(value) = $1)
           OR (type = 'domain' AND lower(value) = $2)
        RETURNING *`,
      [full, domain]
    );
    return res.rows;
  },

  /**
   * Première règle active correspondant à la demande, ou null.
   * Les compteurs (`hits`, `last_hit_at`) sont mis à jour en fire-and-forget :
   * une statistique ne doit pas pouvoir faire échouer la création d'un ticket.
   */
  async findMatch({ email, name, body }) {
    const res = await pool.query('SELECT * FROM sav_blocklist WHERE is_active');
    if (res.rows.length === 0) return null;

    const { email: full, local, domain } = splitEmail(email);
    const haystack = `${name || ''}\n${String(body || '').slice(0, CONTAINS_SCAN_LEN)}`.toLowerCase();

    const rule = res.rows.find(r => {
      const v = String(r.value || '').toLowerCase();
      switch (r.type) {
        case 'email':    return full === v;
        // Sous-domaines inclus, sans faire matcher `notpromodoc.ru` sur `promodoc.ru`.
        case 'domain':   return domain === v || domain.endsWith(`.${v}`);
        case 'local':    return local === v;
        case 'contains': return haystack.includes(v);
        default:         return false;
      }
    }) || null;

    if (rule) {
      pool.query(
        'UPDATE sav_blocklist SET hits = hits + 1, last_hit_at = CURRENT_TIMESTAMP WHERE id = $1',
        [rule.id]
      ).catch(() => {});
    }
    return rule;
  },
};

module.exports = savBlocklistModel;
