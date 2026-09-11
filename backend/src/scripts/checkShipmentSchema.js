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
    SELECT to_regclass('public.shipment_labels')             IS NOT NULL AS labels,
           to_regclass('public.carrier_accounts')            IS NOT NULL AS accounts,
           to_regclass('public.shipping_method_carrier_map') IS NOT NULL AS mappage,
           to_regclass('public.laposte_labels')              IS NOT NULL AS ancienne,
           EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'shipment_labels' AND column_name = 'cn23_data') AS cn23,
           EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'orders' AND column_name = 'relay_point_manual') AS saisie_point
  `);
  console.log('Tables');
  tables.labels   ? ok('shipment_labels présente')  : ko('shipment_labels ABSENTE — migration non passée');
  tables.accounts ? ok('carrier_accounts présente') : ko('carrier_accounts ABSENTE — migration non passée');
  tables.mappage  ? ok('shipping_method_carrier_map présente') : ko('shipping_method_carrier_map ABSENTE — migration non passée');
  tables.ancienne ? ok('laposte_labels conservée (photo d\'avant-bascule, retour arrière possible)')
                  : ko('laposte_labels a disparu — le retour arrière n\'est plus possible');

  // Lot 2 : sans cette colonne, Colissimo refuse d'étiqueter (avant d'acheter
  // l'étiquette). La lettre suivie et Mondial Relay, eux, n'en dépendent pas.
  const cn23Requise = listCarrierCodes().some(c => getAdapter(c).producesCustomsDocuments === true);
  if (cn23Requise) {
    tables.cn23 ? ok('shipment_labels.cn23_data présente (déclarations douanières)')
                : ko('shipment_labels.cn23_data ABSENTE — appliquer add_cn23_to_shipment_labels.sql');
  }

  // Point relais saisi dans la fiche commande. Le packing lit la colonne sans la
  // nommer et tourne sans elle ; c'est la saisie qui échouerait.
  tables.saisie_point ? ok('orders.relay_point_manual présente (point relais saisi à la main)')
                      : ko('orders.relay_point_manual ABSENTE — appliquer add_orders_relay_point_manual.sql');

  if (!tables.labels || !tables.accounts || !tables.mappage) {
    console.log('\n⛔ NE PAS RECONSTRUIRE LE BACKEND. Appliquer d\'abord :');
    console.log('   docker compose exec -T postgres psql -U youvape -d youvape_db \\');
    console.log('     < backend/src/migrations/add_shipment_labels.sql');
    console.log('   docker compose exec -T postgres psql -U youvape -d youvape_db \\');
    console.log('     < backend/src/migrations/add_shipping_method_carrier_map.sql\n');
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

    // Les champs obligatoires viennent de l'ADAPTATEUR, pas d'une liste figée :
    // La Poste attend un client_id, Mondial Relay une connexion API. Une liste
    // en dur ferait échouer le contrôle sur des contrats parfaitement valides,
    // et une alerte qui crie au loup finit ignorée.
    let champs;
    try {
      champs = getAdapter(c.carrier_code).accountFields;
    } catch (e) {
      ko(`${cle} : transporteur absent du registre`);
      continue;
    }
    if (!champs) { ok(`${cle} : aucun champ requis`); continue; }

    // Seuls les champs OBLIGATOIRES sont exigés. Les avancés et les facultatifs
    // ont une valeur par défaut dans l'adaptateur : les réclamer ferait échouer
    // le contrôle sur des contrats parfaitement fonctionnels — et une alerte qui
    // crie au loup finit ignorée.
    const lire = (o, chemin) => chemin.split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
    const vide = (v) => v === undefined || v === null || v === '';
    const manquants = [
      ...champs.credentials.filter(f => f.required && vide(lire(c.credentials, f.key)))
        .map(f => 'identifiants.' + f.key),
      ...champs.settings.filter(f => f.required && vide(lire(c.settings, f.key)))
        .map(f => 'réglages.' + f.key)
    ];

    manquants.length === 0
      ? ok(`${cle} : configuration complète`)
      : ko(`${cle} : il manque ${manquants.join(', ')}`);

    // Le contrat La Poste doit toujours correspondre aux clés app_config
    // d'origine : c'est la seule vérification qui prouve que la migration du
    // lot 0 a lu les bonnes.
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

  // 4 bis. Une correspondance active qui désigne un contrat absent ou de TEST
  // enverrait le packing dans le mur au premier colis.
  console.log('\nCorrespondances des modes de livraison');
  const { rows: maps } = await pool.query(
    `SELECT m.denomination, m.carrier_code, m.account_code, m.delivery_mode,
            a.id IS NOT NULL AS contrat_present,
            COALESCE(NULLIF(a.settings->>'sandbox', '')::boolean, false) AS sandbox,
            COALESCE(a.settings->>'api_url', '') AS api_url,
            COALESCE(a.active, false) AS contrat_actif
     FROM shipping_method_carrier_map m
     LEFT JOIN carrier_accounts a
       ON a.carrier_code = m.carrier_code AND a.account_code = m.account_code
     WHERE m.active = true AND m.carrier_code IS NOT NULL`
  );
  if (maps.length === 0) ko('aucune correspondance active — le packing bloquera sur tout');

  for (const m of maps) {
    const cle = `${m.denomination} → ${m.carrier_code}/${m.account_code}`;

    // Le retrait magasin n'appelle aucune API : lui réclamer un contrat serait
    // une fausse alerte, et les fausses alertes font ignorer les vraies.
    let adapterMap = null;
    try { adapterMap = getAdapter(m.carrier_code); } catch (e) { /* signalé plus bas */ }

    // Un mode hors de la liste du transporteur n'échouerait qu'au packing,
    // colis en main — typiquement une faute de frappe dans les réglages.
    const modes = adapterMap?.deliveryModes;
    if (modes && !modes.some(x => x.code === m.delivery_mode)) {
      ko(`${cle} : mode « ${m.delivery_mode || 'vide'} » inconnu (attendu : ${modes.map(x => x.code).join(', ')})`);
      continue;
    }

    if (adapterMap?.requiresAccount === false) { ok(`${cle} (aucun contrat nécessaire)`); continue; }

    if (!m.contrat_present) { ko(`${cle} : contrat INTROUVABLE`); continue; }
    if (!m.contrat_actif)   { ko(`${cle} : contrat désactivé`); continue; }
    if (m.sandbox)          { ko(`${cle} : contrat de TEST — les étiquettes ne seront pas valides`); continue; }

    // Le drapeau « test » est déclaratif ; l'URL est ce qui décide vraiment du
    // serveur appelé. Un contrat de production pointant le bac à sable se fait
    // refuser ses identifiants (« 10001 : login et/ou mot de passe non valide »),
    // et rien dans les réglages ne le laissait deviner — arrivé le 08/09/2026,
    // l'URL ayant été recopiée depuis le contrat de test.
    if (/sandbox|\/test\//i.test(m.api_url)) {
      ko(`${cle} : l'URL pointe le serveur de TEST (${m.api_url}) — les identifiants de production y seront refusés`);
      continue;
    }
    ok(cle);
  }

  const { rows: sansEtiquette } = await pool.query(
    `SELECT count(*)::int c FROM shipping_method_carrier_map WHERE active = true AND carrier_code IS NULL`
  );
  ok(`${sansEtiquette[0].c} mode(s) déclaré(s) sans étiquette (volontairement)`);

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
