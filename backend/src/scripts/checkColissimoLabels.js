/**
 * Répétition Colissimo : fait VALIDER par Colissimo les étiquettes de vraies
 * commandes, sans en produire une seule.
 *
 * Passe exclusivement par `checkGenerateLabel` : la requête est contrôlée par
 * Colissimo comme une vraie, mais aucune étiquette n'est produite et rien n'est
 * facturé. Colissimo n'a pas de serveur de test ; c'est ce qui en tient lieu.
 * Sans danger, y compris avec le contrat de production.
 *
 * Strictement en lecture côté base. Les commandes sont lues par le même chemin
 * que le packing (loadOrderForLabel, receiverFromOrder, correspondance des
 * dénominations) : la répétition valide ce qui partira vraiment.
 *
 * Les correspondances sont lues ACTIVES OU NON : la migration du lot 2 les amorce
 * inactives, justement pour qu'on puisse répéter avant de les mettre en service.
 *
 * Échantillon : pour chaque dénomination mappée sur Colissimo, les commandes
 * payées les plus récentes, une par pays de destination (et, pour les points de
 * retrait, seulement celles qui portent un point — la colonne n'est alimentée
 * que depuis le 07/09/2026).
 *
 * Usage (sur le VPS, après déploiement) :
 *   docker exec youvape_backend node src/scripts/checkColissimoLabels.js [contrat] [par_pays]
 *     contrat  : account_code dans carrier_accounts (défaut : test)
 *     par_pays : commandes par pays et par dénomination (défaut : 2)
 *
 * Sortie : code 0 si toutes les requêtes sont valides, 1 sinon.
 */

'use strict';

const pool = require('../config/database');
const coli = require('../services/carriers/colissimoAdapter');
const { getAccount } = require('../services/carriers/accounts');
const { loadOrderForLabel, receiverFromOrder } = require('../controllers/shipmentController');

const STATUTS_PAYES = ['wc-completed', 'wc-delivered', 'wc-processing',
  'wc-awaiting-delivery', 'wc-shipped', 'wc-being-delivered'];

async function main() {
  const accountCode = process.argv[2] || 'test';
  const parPays = Number(process.argv[3]) || 2;

  const account = await getAccount('colissimo', accountCode);
  console.log(`=== Répétition Colissimo — contrat « ${accountCode} », checkGenerateLabel uniquement ===\n`);

  const { rows: mappages } = await pool.query(
    `SELECT denomination, delivery_mode, active FROM shipping_method_carrier_map
     WHERE carrier_code = 'colissimo' ORDER BY denomination`
  );
  if (mappages.length === 0) {
    console.log('Aucune dénomination mappée sur Colissimo : rien à répéter.');
    return 1;
  }

  let valides = 0;
  let refusees = 0;

  for (const m of mappages) {
    const { rows: echantillon } = await pool.query(`
      SELECT wp_order_id FROM (
        SELECT o.wp_order_id,
               row_number() OVER (PARTITION BY o.shipping_country ORDER BY o.post_date DESC) AS rang
        FROM orders o
        WHERE lower(btrim(o.shipping_method)) = lower(btrim($1))
          AND o.post_status = ANY($2)
          AND COALESCE(o.paid_date, o.post_date) > NOW() - INTERVAL '90 days'
          AND ($3 <> 'relais' OR o.relay_point IS NOT NULL)
      ) t WHERE rang <= $4
    `, [m.denomination, STATUTS_PAYES, m.delivery_mode, parPays]);

    console.log(`${m.denomination} → ${m.delivery_mode}${m.active ? '' : ' [inactive]'} (${echantillon.length} commande(s))`);

    for (const { wp_order_id: orderNumber } of echantillon) {
      const order = await loadOrderForLabel(orderNumber);
      try {
        const weightGrams = await coli.resolveWeight({ pool, orderNumber });
        const r = await coli.validateLabel({
          orderNumber,
          receiver: receiverFromOrder(order),
          account,
          weightGrams,
          options: { deliveryMode: m.delivery_mode, relayPoint: order.relay_point, shippingMethod: order.shipping_method },
          pool
        });
        valides++;
        console.log(`  ✅ ${orderNumber} ${order.shipping_country} ${r.productCode}${r.cn23 ? ' + CN23' : ''}`);
      } catch (e) {
        refusees++;
        console.log(`  ❌ ${orderNumber} ${order.shipping_country} — ${e.userMessage || e.message}`);
      }
    }
  }

  console.log(`\n${valides} requête(s) valide(s), ${refusees} refusée(s).`);
  return refusees === 0 ? 0 : 1;
}

main()
  .then(async (code) => { await pool.end(); process.exit(code); })
  .catch(async (e) => { console.error('Erreur de la répétition :', e.message); await pool.end(); process.exit(1); });
