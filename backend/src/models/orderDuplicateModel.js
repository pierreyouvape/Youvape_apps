/**
 * Doublons probables de commandes clients — lecture des alertes en cours.
 *
 * La détection et le ticket SAV sont dans services/orderDuplicateService.js ;
 * ce module ne fait que dire, pour un lot de commandes, quels doublons sont
 * encore à traiter. Il ne dépend que de la base : le Picking et le Packing le
 * lisent sans tirer la création de tickets.
 *
 * Une alerte est en cours tant que :
 *   - les deux commandes sont toujours payées (l'une remboursée ou annulée =
 *     doublon réglé) ;
 *   - et son ticket SAV n'est pas résolu (« terminé », lu sur le ticket cible
 *     s'il a été fusionné). Résolu = le client voulait bien les deux.
 */

const pool = require('../config/database');

// Les 6 statuts payés (cf. CLAUDE.md) : wc-refunded n'y est pas, exprès.
const PAID_STATUSES = [
  'wc-completed', 'wc-delivered', 'wc-processing',
  'wc-awaiting-delivery', 'wc-shipped', 'wc-being-delivered'
];

const RESOLVED_STATUS = 'terminé';

/**
 * Doublons en cours touchant ces commandes.
 *
 * @param {Array<string|number>} orderNumbers
 * @returns {Promise<Map<string, Array<{ otherOrder: string, role: 'first'|'second',
 *   held: boolean, ticketId: ?number, minutes: number }>>>}
 *   `role` = place de CETTE commande dans la paire ; `held` = c'est la seconde,
 *   exclue des règles de vague.
 */
const activeFor = async (orderNumbers) => {
  const numbers = [...new Set(orderNumbers.map(String))];
  const byOrder = new Map();
  if (numbers.length === 0) return byOrder;

  const { rows } = await pool.query(
    `SELECT d.first_order_id::text AS first, d.second_order_id::text AS second, d.ticket_id,
            GREATEST(0, ROUND(EXTRACT(EPOCH FROM o2.post_date - o1.post_date) / 60))::int AS minutes
       FROM order_duplicates d
       JOIN orders o1 ON o1.wp_order_id = d.first_order_id
       JOIN orders o2 ON o2.wp_order_id = d.second_order_id
       LEFT JOIN sav_tickets t ON t.id = d.ticket_id
       LEFT JOIN sav_tickets tm ON tm.id = t.merged_into_id
      WHERE (d.first_order_id::text = ANY($1::text[]) OR d.second_order_id::text = ANY($1::text[]))
        AND o1.post_status = ANY($2::text[])
        AND o2.post_status = ANY($2::text[])
        AND COALESCE(tm.sav_status, t.sav_status, '') <> $3`,
    [numbers, PAID_STATUSES, RESOLVED_STATUS]
  );

  const push = (number, entry) => {
    if (!byOrder.has(number)) byOrder.set(number, []);
    byOrder.get(number).push(entry);
  };
  for (const r of rows) {
    const common = { ticketId: r.ticket_id, minutes: r.minutes };
    push(r.first, { ...common, otherOrder: r.second, role: 'first', held: false });
    push(r.second, { ...common, otherOrder: r.first, role: 'second', held: true });
  }
  return byOrder;
};

module.exports = { activeFor, PAID_STATUSES, RESOLVED_STATUS };
