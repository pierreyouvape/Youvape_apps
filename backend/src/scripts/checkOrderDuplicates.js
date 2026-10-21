/**
 * Rejoue à blanc la détection des doublons probables de commandes
 * (orderDuplicateService.findPairs) sur une période : n'écrit rien, n'ouvre
 * aucun ticket. Sert à vérifier la règle sur l'historique.
 *
 * Usage (sur le VPS, depuis le container backend) :
 *   docker exec youvape_backend node src/scripts/checkOrderDuplicates.js [--since 2026-01-01] [--until 2026-10-21] [--with-refunded]
 *
 * Sans --since : les dernières 24 h (comme le cron). --with-refunded garde les
 * commandes remboursées depuis (le cron les ignore : doublon déjà réglé).
 */

'use strict';

const pool = require('../config/database');
const { findPairs } = require('../services/orderDuplicateService');

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};

async function main() {
  const pairs = await findPairs({
    since: arg('--since'), until: arg('--until'), withRefunded: process.argv.includes('--with-refunded')
  });
  const ids = pairs.flatMap(p => [p.firstOrderId, p.secondOrderId]);
  const { rows } = await pool.query(
    `SELECT wp_order_id::text AS id, to_char(post_date, 'DD/MM/YYYY HH24:MI') AS created,
            post_status, order_total, billing_email
       FROM orders WHERE wp_order_id = ANY($1::bigint[])`,
    [ids]
  );
  const byId = new Map(rows.map(r => [r.id, r]));

  console.log(`=== ${pairs.length} doublon(s) probable(s) ===`);
  for (const p of pairs) {
    const a = byId.get(p.firstOrderId);
    const b = byId.get(p.secondOrderId);
    console.log(`${a.created}  ${p.firstOrderId} (${a.post_status}) → ${p.secondOrderId} (${b.post_status}, ${b.created})  ${b.order_total} €  ${b.billing_email}`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error('[checkOrderDuplicates][FATAL]', err.message);
  process.exit(1);
});
