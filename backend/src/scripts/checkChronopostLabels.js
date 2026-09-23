/**
 * Répétition Chronopost, en deux temps.
 *
 * 1. ESSAI À BLANC (par défaut) — aucun appel réseau. Construit la requête
 *    d'étiquette de toutes les commandes Chronopost payées des N derniers jours,
 *    par le même chemin que le packing (loadOrderForLabel, receiverFromOrder),
 *    et compte les refus par motif. Sans danger.
 *
 *      node src/scripts/checkChronopostLabels.js [jours]
 *
 * 2. UNE VRAIE ÉTIQUETTE — Chronopost n'a pas de serveur de test ni d'appel de
 *    validation seule, contrairement à Colissimo. On émet donc UNE étiquette
 *    réelle, on l'enregistre dans /tmp pour la regarder, et on l'ANNULE aussitôt
 *    (`cancelSkybill`). Rien n'est écrit en base, rien n'est envoyé à BMS.
 *
 *      node src/scripts/checkChronopostLabels.js reel <n° commande> [--garder]
 *
 *    `--garder` saute l'annulation (pour tester l'annulation depuis l'écran).
 *
 * Le mode et le contrat viennent de la correspondance des dénominations, lue
 * ACTIVE OU NON : on répète avant d'activer. Faute de correspondance, l'essai à
 * blanc se rabat sur le routage prévu au lot 3 (DENOMINATIONS_PREVUES).
 *
 * ⚠️ S'ARRÊTE au premier refus d'identifiants — leçon du 11/09/2026 (Colissimo) :
 * une boucle qui continue après un refus peut bloquer le compte.
 *
 * Sortie : code 0 si tout passe, 1 sinon.
 */

'use strict';

const fs = require('fs');
const pool = require('../config/database');
const chrono = require('../services/carriers/chronopostAdapter');
const { getAccount } = require('../services/carriers/accounts');
const { loadOrderForLabel, receiverFromOrder } = require('../controllers/shipmentController');

const STATUTS_PAYES = ['wc-completed', 'wc-delivered', 'wc-processing',
  'wc-awaiting-delivery', 'wc-shipped', 'wc-being-delivered'];

// Routage prévu au lot 3 (cadrage du 23/09/2026) : le 2Shop France hors Corse a
// son propre contrat, tout le reste passe par le contrat principal.
const DENOMINATIONS_PREVUES = {
  'Chronopost Relais 24h':    { mode: 'relais',   contrat: 'principal' },
  '2Shop':                    { mode: '2shop',    contrat: '2shop' },
  '2Shop 2 à 4 jours ouvrés': { mode: '2shop',    contrat: 'principal' },
  'Chronopost Domicile 24h':  { mode: 'domicile', contrat: 'principal' },
  'Chronopost Express':       { mode: 'express',  contrat: 'principal' }
};

/** Mode et contrat d'une dénomination : la correspondance si elle existe, sinon le plan. */
const routage = async () => {
  const { rows } = await pool.query(
    `SELECT denomination, account_code, delivery_mode, active FROM shipping_method_carrier_map
     WHERE carrier_code = 'chronopost'`
  );
  if (rows.length === 0) return { source: 'plan du lot 3 (aucune correspondance en base)', table: DENOMINATIONS_PREVUES };
  return {
    source: 'correspondances en base',
    table: Object.fromEntries(rows.map(r => [r.denomination, { mode: r.delivery_mode, contrat: r.account_code, active: r.active }]))
  };
};

// Contrat factice de l'essai à blanc : la requête est construite, jamais envoyée.
const COMPTE_BLANC = {
  carrierCode: 'chronopost', accountCode: 'blanc',
  credentials: { account_number: '00000000', password: 'x' },
  settings: { sender: { name: 'SAS EMC', address: 'x', zipcode: '34170', city: 'x', country: 'FR' } }
};

async function essaiABlanc(jours) {
  const { source, table } = await routage();
  console.log(`=== Essai à blanc Chronopost — ${jours} jours, routage : ${source} — AUCUN appel réseau ===\n`);

  let ok = 0;
  let ko = 0;
  for (const [denomination, r] of Object.entries(table)) {
    const { rows } = await pool.query(`
      SELECT wp_order_id, post_date < '2026-09-07' AS avant_point FROM orders
      WHERE lower(btrim(shipping_method)) = lower(btrim($1))
        AND post_status = ANY($2)
        AND COALESCE(paid_date, post_date) > NOW() - ($3 || ' days')::interval
      ORDER BY post_date DESC
    `, [denomination, STATUTS_PAYES, String(jours)]);

    const motifs = new Map();
    const produits = new Map();
    let historique = 0;
    for (const { wp_order_id: orderNumber, avant_point: avantPoint } of rows) {
      try {
        const order = await loadOrderForLabel(orderNumber);
        const options = { deliveryMode: r.mode, relayPoint: order.relay_point, shippingMethod: order.shipping_method };
        const weightGrams = await chrono.resolveWeight({ pool, orderNumber });
        const receiver = receiverFromOrder(order);
        const dest = chrono.resolveDestination({ receiver, options, orderNumber });
        if (chrono.requiresRelayPoint(dest.mode)) chrono.assertRelayPoint(order.relay_point, orderNumber);
        chrono.buildLabelPayload({ orderNumber, receiver, account: COMPTE_BLANC, weightGrams, options });
        produits.set(dest.productCode, (produits.get(dest.productCode) || 0) + 1);
        ok++;
      } catch (e) {
        // `relay_point` n'est alimenté que depuis le 07/09/2026 : une commande
        // plus ancienne sans point n'est pas un défaut, elle est déjà partie.
        if (avantPoint && /aucun point/.test(e.userMessage || '')) { historique++; continue; }
        ko++;
        // Motif sans le numéro de commande, pour regrouper.
        const motif = String(e.userMessage || e.message).replace(/\d{6,}/g, '#').substring(0, 160);
        const m = motifs.get(motif) || { n: 0, exemple: orderNumber };
        m.n++;
        motifs.set(motif, m);
      }
    }

    const detail = [...produits].map(([p, n]) => `${p} × ${n}`).join(', ') || '—';
    console.log(`${denomination} → ${r.mode} / ${r.contrat}${r.active === false ? ' [inactive]' : ''} : `
      + `${rows.length} commande(s), produits ${detail}`
      + (historique ? ` — ${historique} antérieure(s) au 07/09 sans point, ignorée(s)` : ''));
    for (const [motif, { n, exemple }] of motifs) console.log(`   ❌ ${n} × ${motif} (ex. ${exemple})`);
  }

  console.log(`\n${ok} requête(s) construite(s), ${ko} refusée(s) avant appel.`);
  return ko === 0 ? 0 : 1;
}

async function etiquetteReelle(orderNumber, garder) {
  const order = await loadOrderForLabel(orderNumber);
  if (!order) { console.log(`Commande ${orderNumber} introuvable.`); return 1; }

  const { table } = await routage();
  const r = table[order.shipping_method];
  if (!r) { console.log(`« ${order.shipping_method} » n'est pas une dénomination Chronopost.`); return 1; }

  const account = await getAccount('chronopost', r.contrat);
  const weightGrams = await chrono.resolveWeight({ pool, orderNumber });

  console.log(`=== UNE étiquette RÉELLE — commande ${orderNumber}, ${r.mode} / contrat ${r.contrat}, `
    + `${weightGrams} g — ${garder ? 'CONSERVÉE' : 'annulée aussitôt'} ===\n`);

  let label;
  try {
    label = await chrono.createLabel({
      orderNumber,
      receiver: receiverFromOrder(order),
      account,
      weightGrams,
      options: { deliveryMode: r.mode, relayPoint: order.relay_point, shippingMethod: order.shipping_method }
    });
  } catch (e) {
    console.log(`❌ ${e.userMessage || e.message}`);
    if (chrono.estRefusIdentifiants(e)) {
      console.log('\n⛔ ARRÊT : identifiants refusés. Corrigez le contrat dans les réglages avant toute autre tentative.');
    }
    return 1;
  }

  const fichier = `/tmp/chronopost_${orderNumber}.pdf`;
  fs.writeFileSync(fichier, Buffer.from(label.pdfBase64, 'base64'));
  console.log(`✅ Colis ${label.trackingNumber} (réservation ${label.carrierOrderId}), produit ${label.methodCode}`);
  console.log(`   Libellé BMS : ${label.bmsShipmentTitle}`);
  console.log(`   PDF : ${fichier} — docker cp youvape_backend:${fichier} .`);

  if (garder) {
    console.log('\n⚠️ Étiquette CONSERVÉE, et absente de l\'app : à annuler dans l\'espace Chronopost si elle ne part pas.');
    return 0;
  }

  try {
    await chrono.cancelLabel({ label: { tracking_number: label.trackingNumber }, account });
    console.log(`✅ Colis ${label.trackingNumber} annulé chez Chronopost.`);
    return 0;
  } catch (e) {
    console.log(`❌ ANNULATION ÉCHOUÉE pour ${label.trackingNumber} : ${e.message}\n   À annuler dans l'espace Chronopost.`);
    return 1;
  }
}

async function main() {
  if (process.argv[2] === 'reel') {
    const orderNumber = process.argv[3];
    if (!orderNumber) { console.log('Usage : checkChronopostLabels.js reel <n° commande> [--garder]'); return 1; }
    return etiquetteReelle(orderNumber, process.argv.includes('--garder'));
  }
  return essaiABlanc(Number(process.argv[2]) || 90);
}

main()
  .then(async (code) => { await pool.end(); process.exit(code); })
  .catch(async (e) => { console.error('Erreur de la répétition :', e.message); await pool.end(); process.exit(1); });
