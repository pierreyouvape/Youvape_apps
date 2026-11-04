/**
 * Rattrapage du coût de livraison RÉEL des commandes (add_order_carrier_costs.sql).
 *
 * 1. Calcule cost_ht (coût complet de la ligne, charges réparties) pour chaque colis
 *    de chaque facture Chronopost, Colissimo et Mondial Relay ;
 * 2. réécrit orders.shipping_cost_calculated = vue order_carrier_costs (toutes les
 *    lignes de la commande, tous transporteurs, retours compris, avoirs déduits).
 *
 *   node src/scripts/recomputeOrderShippingCosts.js           → simulation (transaction annulée)
 *   node src/scripts/recomputeOrderShippingCosts.js --apply   → écrit
 *
 * La simulation fait le vrai calcul dans une transaction puis l'annule : les chiffres
 * annoncés sont exactement ceux qui seront écrits.
 */
const pool = require('../config/database');
const { computeInvoiceCosts } = require('../services/orderShippingCost');

const APPLY = process.argv.includes('--apply');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: invoices } = await client.query(`
      SELECT id, carrier FROM carrier_invoices WHERE carrier IN ('chronopost','colissimo','mondial_relay') ORDER BY id`);
    const parCarrier = {};
    for (const inv of invoices) {
      const r = await computeInvoiceCosts(client, inv.id);
      parCarrier[inv.carrier] = (parCarrier[inv.carrier] || 0) + r.lines.filter(l => l.cost != null).length;
    }
    console.log(`${invoices.length} factures, colis chiffrés :`, parCarrier);

    // Avant / après, sur les commandes qui ont un coût réel
    const { rows: diff } = await client.query(`
      SELECT o.wp_order_id AS id, o.shipping_cost_calculated AS avant, GREATEST(0, ROUND(v.cost, 2)) AS apres, v.lines
      FROM order_carrier_costs v JOIN orders o ON o.wp_order_id = v.order_id`);
    const changed = diff.filter(d => d.avant == null || Math.abs(Number(d.avant) - Number(d.apres)) >= 0.01);
    const sum = k => diff.reduce((s, d) => s + Number(d[k] || 0), 0);
    console.log(`${diff.length} commandes avec un coût facturé, ${changed.length} changent.`);
    console.log(`Total avant ${sum('avant').toFixed(2)} € → après ${sum('apres').toFixed(2)} € HT`);
    const ecarts = changed.map(d => ({ ...d, delta: Number(d.apres) - Number(d.avant || 0) })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    console.log('Plus gros écarts :');
    for (const d of ecarts.slice(0, 15)) console.log(`   ${d.id} : ${d.avant ?? '—'} → ${d.apres} (${d.lines} lignes)`);
    const exemples = [1264731, 1254334, 1256078, 1259607];
    const { rows: ex } = await client.query(`
      SELECT o.wp_order_id AS id, o.shipping_cost_calculated AS avant, GREATEST(0, ROUND(v.cost, 2)) AS apres
      FROM orders o LEFT JOIN order_carrier_costs v ON v.order_id = o.wp_order_id WHERE o.wp_order_id = ANY($1::bigint[])`, [exemples]);
    console.log('Exemples :'); for (const d of ex) console.log(`   ${d.id} : ${d.avant} → ${d.apres}`);

    const upd = await client.query(`
      UPDATE orders o SET shipping_cost_calculated = GREATEST(0, ROUND(v.cost, 2))
      FROM order_carrier_costs v WHERE o.wp_order_id = v.order_id
        AND o.shipping_cost_calculated IS DISTINCT FROM GREATEST(0, ROUND(v.cost, 2))`);
    console.log(`${upd.rowCount} commandes ${APPLY ? 'mises à jour' : 'à mettre à jour'}.`);
    await client.query(APPLY ? 'COMMIT' : 'ROLLBACK');
    console.log(APPLY ? '— appliqué' : "— simulation, rien n'est écrit (--apply pour écrire)");
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch(e => { console.error(e); process.exit(1); });
