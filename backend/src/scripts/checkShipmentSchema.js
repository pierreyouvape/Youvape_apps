/**
 * Contrôle avant bascule de l'étiquetage multi-transporteurs (lot 0).
 *
 * À lancer APRÈS la migration et AVANT `docker compose up --build -d backend`.
 * Le packing envoie des lettres suivies toute la journée sans solution de
 * secours : ce script transforme le « je crois que c'est bon » en go / no-go.
 *
 * Strictement en lecture. N'écrit rien, n'appelle aucun transporteur.
 *
 * Usage (sur le VPS) :
 *   docker exec youvape_backend node src/scripts/checkShipmentSchema.js
 *
 * Sortie : code 0 si la bascule peut se faire, 1 sinon.
 */

'use strict';

const pool = require('../config/database');
const { getAdapter, listCarrierCodes } = require('../services/carriers');

let problemes = 0;
const ok = (m) => console.log('  ✅', m);
const ko = (m) => { problemes++; console.log('  ❌', m); };

async function main() {
  console.log('=== Contrôle avant bascule étiquetage ===\n');

  // 1. Les deux tables sont là.
  const { rows: [tables] } = await pool.query(`
    SELECT to_regclass('public.shipment_labels')  IS NOT NULL AS labels,
           to_regclass('public.carrier_accounts') IS NOT NULL AS accounts,
           to_regclass('public.laposte_labels')   IS NOT NULL AS ancienne
  `);
  console.log('Tables');
  tables.labels   ? ok('shipment_labels présente')  : ko('shipment_labels ABSENTE — migration non passée');
  tables.accounts ? ok('carrier_accounts présente') : ko('carrier_accounts ABSENTE — migration non passée');
  tables.ancienne ? ok('laposte_labels conservée (photo d\'avant-bascule, retour arrière possible)')
                  : ko('laposte_labels a disparu — le retour arrière n\'est plus possible');

  if (!tables.labels || !tables.accounts) {
    console.log('\n⛔ NE PAS RECONSTRUIRE LE BACKEND. Appliquer d\'abord :');
    console.log('   docker compose exec -T postgres psql -U youvape -d youvape_db \\');
    console.log('     < backend/src/migrations/add_shipment_labels.sql\n');
    return 1;
  }

  // 2. Reprise complète des étiquettes, id conservés (le front s'en sert dans ses URL).
  console.log('\nReprise des étiquettes');
  const { rows: [reprise] } = await pool.query(`
    SELECT (SELECT COUNT(*) FROM laposte_labels)::int   AS avant,
           (SELECT COUNT(*) FROM shipment_labels)::int   AS apres,
           (SELECT COUNT(*) FROM laposte_labels l
              WHERE NOT EXISTS (SELECT 1 FROM shipment_labels s WHERE s.id = l.id))::int AS manquantes,
           (SELECT COUNT(*) FROM laposte_labels l
              JOIN shipment_labels s ON s.id = l.id
             WHERE s.order_number IS DISTINCT FROM l.order_number
                OR s.tracking_number IS DISTINCT FROM l.tracking_id
                OR s.status IS DISTINCT FROM l.status
                OR s.carrier_order_id IS DISTINCT FROM l.laposte_order_id)::int AS divergentes
  `);
  console.log(`  laposte_labels : ${reprise.avant} · shipment_labels : ${reprise.apres}`);
  reprise.manquantes === 0
    ? ok('toutes les étiquettes reprises, id conservés')
    : ko(`${reprise.manquantes} étiquette(s) NON reprise(s)`);
  reprise.divergentes === 0
    ? ok('aucune divergence de contenu sur les lignes reprises')
    : ko(`${reprise.divergentes} ligne(s) divergente(s) entre les deux tables`);

  // 3. La séquence doit être au-dessus du plus grand id, sinon collision au 1er insert.
  const { rows: [seq] } = await pool.query(`
    SELECT COALESCE((SELECT MAX(id) FROM shipment_labels), 0)::int AS max_id,
           last_value::int AS derniere, is_called
    FROM shipment_labels_id_seq
  `);
  const prochain = seq.is_called ? seq.derniere + 1 : seq.derniere;
  prochain > seq.max_id
    ? ok(`séquence saine (prochain id ${prochain} > max ${seq.max_id})`)
    : ko(`séquence en retard : prochain id ${prochain} ≤ max ${seq.max_id} — collision au premier insert`);

  // 4. Le contrat La Poste porte de quoi appeler l'API.
  console.log('\nContrat transporteur');
  const { rows: comptes } = await pool.query(
    'SELECT carrier_code, account_code, active, credentials, settings FROM carrier_accounts'
  );
  if (comptes.length === 0) ko('carrier_accounts est vide — aucun contrat semé');

  for (const c of comptes) {
    const cle = `${c.carrier_code}/${c.account_code}`;
    if (!c.active) { ko(`${cle} : contrat désactivé`); continue; }

    const manquants = [
      ...['token_url', 'client_id', 'client_secret'].filter(k => !c.credentials?.[k]).map(k => 'credentials.' + k),
      ...['api_url', 'contract_number', 'cust_acc_number', 'cust_invoice'].filter(k => !c.settings?.[k]).map(k => 'settings.' + k),
      ...['name', 'address', 'zipcode', 'town'].filter(k => !c.settings?.sender?.[k]).map(k => 'settings.sender.' + k)
    ];
    manquants.length === 0
      ? ok(`${cle} : configuration complète`)
      : ko(`${cle} : il manque ${manquants.join(', ')}`);

    // Le contrat doit correspondre encore à ce qu'app_config contenait : c'est
    // la seule vérification qui prouve que la migration a lu les bonnes clés.
    if (c.carrier_code === 'laposte') {
      const { rows } = await pool.query(
        `SELECT config_key, config_value FROM app_config WHERE config_key LIKE 'laposte\\_%'`
      );
      const cfg = Object.fromEntries(rows.map(r => [r.config_key, r.config_value]));
      const ecarts = [
        ['api_url', c.settings?.api_url, cfg.laposte_api_url],
        ['contract_number', c.settings?.contract_number, cfg.laposte_contract_number],
        ['cust_acc_number', c.settings?.cust_acc_number, cfg.laposte_cust_acc_number],
        ['cust_invoice', c.settings?.cust_invoice, cfg.laposte_cust_invoice],
        ['client_id', c.credentials?.client_id, cfg.laposte_client_id],
        ['client_secret', c.credentials?.client_secret, cfg.laposte_client_secret],
        ['token_url', c.credentials?.token_url, cfg.laposte_token_url]
      ].filter(([, a, b]) => b !== undefined && a !== b).map(([k]) => k);

      ecarts.length === 0
        ? ok(`${cle} : identique aux clés app_config d'origine`)
        : ko(`${cle} : diverge d'app_config sur ${ecarts.join(', ')}`);
    }
  }

  // 5. Un adaptateur existe pour chaque transporteur présent en base.
  console.log('\nAdaptateurs');
  ok(`branchés : ${listCarrierCodes().join(', ')}`);
  const { rows: codes } = await pool.query(
    'SELECT DISTINCT carrier_code FROM shipment_labels'
  );
  for (const { carrier_code } of codes) {
    try { getAdapter(carrier_code); ok(`${carrier_code} : adaptateur présent`); }
    catch { ko(`${carrier_code} : étiquettes en base mais aucun adaptateur`); }
  }

  console.log('');
  if (problemes === 0) {
    console.log('✅ Bascule possible — reconstruire le backend.');
    return 0;
  }
  console.log(`⛔ ${problemes} problème(s). NE PAS RECONSTRUIRE avant correction.`);
  return 1;
}

main()
  .then(async (code) => { await pool.end(); process.exit(code); })
  .catch(async (e) => { console.error('Erreur du contrôle :', e.message); await pool.end(); process.exit(1); });
