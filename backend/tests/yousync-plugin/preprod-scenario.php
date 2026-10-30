<?php
/**
 * Scénario du plugin yousync sur un vrai WordPress + WooCommerce (préprod).
 *
 * ssh youvape 'php /home/ubuntu/youvape-site/wp-cli.phar \
 *   --path=/home/ubuntu/youvape-site/www/current eval-file -' < preprod-scenario.php
 *
 * ⚠️ JAMAIS sur la prod. ⚠️ Ne pas retirer les garde-fous du début : une commande créée
 * en préprod partirait vers le vrai Metorik (webhook actif) et VosFactures (mesuré le
 * 30/10/2026). Crée des objets de test, les supprime, restaure les options du jeton.
 * wp eval-file exécute dans une fonction : le `global` ci-dessous est indispensable.
 */
global $fails, $created, $TOKEN, $allEvents, $T;
// Garde-fous : rien ne sort de la préprod pendant le test.
$GLOBALS['blocked'] = [];
add_filter('pre_http_request', function ($pre, $args, $url) { $GLOBALS['blocked'][] = parse_url($url, PHP_URL_HOST); return new WP_Error('blocked', 'test'); }, 1, 3);
add_filter('woocommerce_webhook_should_deliver', '__return_false', 999);
add_filter('pre_wp_mail', '__return_false', 999);
$_SERVER['HTTPS'] = 'on';
wp_set_current_user(69);

use YouSync\Queue;
global $wpdb;
$T = $wpdb->prefix . 'yousync_events';
$bak = ['auth' => get_option('yousync_auth'), 'settings' => get_option('yousync_settings'), 'paused' => get_option('yousync_paused')];
$TOKEN = $bak['settings']['api_token'];
$fails = 0; $created = ['orders' => [], 'products' => [], 'users' => []]; $allEvents = [];

function t($name, $cond, $info = '') { global $fails; if (!$cond) $fails++; echo ($cond ? '  ok   ' : '  FAIL ') . $name . ($info !== '' ? "  [$info]" : '') . "\n"; }
function req($method, $route, $token = null, $body = null, $params = []) {
    $r = new WP_REST_Request($method, $route);
    if ($token !== null) $r->set_header('X-YouSync-Token', $token);
    if ($body !== null) { $r->set_header('Content-Type', 'application/json'); $r->set_body(wp_json_encode($body)); }
    foreach ($params as $k => $v) $r->set_param($k, $v);
    $res = rest_do_request($r);
    return [$res->get_status(), $res->get_data()];
}
function fresh($id) { clean_post_cache($id); wp_cache_flush_group('orders'); return wc_get_order($id); }
function pull() { global $TOKEN, $allEvents; [$s, $d] = req('GET', '/yousync/v2/queue', $TOKEN); if ($s === 200) foreach ($d['events'] as $e) $allEvents[] = $e; return [$s, $d]; }
function find($events, $type, $id) { foreach ($events as $e) if ($e['type'] === $type && (int) $e['wp_id'] === (int) $id) return $e; return null; }
function ack_all($events) { global $TOKEN; $ids = []; foreach ($events as $e) $ids = array_merge($ids, $e['ids']); return req('POST', '/yousync/v2/queue/ack', $TOKEN, ['acked' => $ids, 'failed' => []]); }
function drain() { for ($i = 0; $i < 6; $i++) { [, $d] = pull(); if (!$d['events']) return; ack_all($d['events']); } }
function mk_order($pid, $status) {
    global $created;
    $o = wc_create_order(['customer_id' => 69, 'status' => 'pending']);
    $created['orders'][] = $o->get_id();
    $o->add_product(wc_get_product($pid), 2);
    $o->set_billing_email('pierre.merle.723@gmail.com'); $o->set_billing_first_name('Test'); $o->set_billing_last_name('YouSync');
    $o->set_billing_company('Societe Test'); $o->set_customer_note('note de test');
    $ship = new WC_Order_Item_Shipping(); $ship->set_method_title('Test transport'); $ship->set_total(5); $o->add_item($ship);
    $o->update_meta_data('_wc_order_attribution_user_agent', 'AgentTest');
    $o->set_payment_method('bacs'); $o->calculate_totals(); $o->save();
    if ($status !== 'pending') $o->update_status($status, 'test yousync');
    return $o;
}

echo "--- contexte\n";
echo 'WC ', WC_VERSION, ' WP ', get_bloginfo('version'), ' PHP ', PHP_VERSION, ' HPOS=', (\Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled() ? 'oui' : 'non'), "\n";

try {
    drain();
    echo "--- produit et commande\n";
    $p = new WC_Product_Simple(); $p->set_name('TEST YOUSYNC'); $p->set_status('draft'); $p->set_regular_price('10'); $p->set_manage_stock(false); $p->save();
    $pid = $p->get_id(); $created['products'][] = $pid;
    $o = mk_order($pid, 'processing'); $oid = $o->get_id();
    $rows = $wpdb->get_results($wpdb->prepare("SELECT action, COUNT(*) c FROM $T WHERE object_type='order' AND wp_id=%d AND state='pending' GROUP BY action", $oid), OBJECT_K);
    t('commande : create + update en table', isset($rows['create'], $rows['update']), 'update=' . ($rows['update']->c ?? 0));
    t('table sans contenu client', !preg_grep('/email|billing|address|phone|data/', $wpdb->get_col("SHOW COLUMNS FROM $T")));

    [$s, $d] = pull();
    t('GET queue : 200 et succès', $s === 200 && $d['success'] === true, 'version ' . ($d['version'] ?? '?'));
    t('no-store', (function () use ($TOKEN) { $r = new WP_REST_Request('GET', '/yousync/v2/health'); $r->set_header('X-YouSync-Token', $TOKEN); return ($h = rest_do_request($r)->get_headers()) && ($h['Cache-Control'] ?? '') === 'no-store, private'; })());
    $e = find($d['events'], 'order', $oid);
    t('commande livrée en un seul événement, tous ses identifiants', $e && count($e['ids']) >= 2, 'ids=' . ($e ? count($e['ids']) : 0));
    $data = $e['data'] ?? [];
    t('lignes présentes à la lecture', count($data['items'] ?? []) === 1 && (int) $data['items'][0]['quantity'] === 2);
    t('port et totaux', (float) ($data['total'] ?? 0) > 20 && count($data['shipping'] ?? []) === 1, 'total=' . ($data['total'] ?? '?'));
    t('statut processing, client 69', ($data['status'] ?? '') === 'processing' && (int) ($data['customer_id'] ?? 0) === 69);
    t('champs conservés', ($data['billing_company'] ?? '') === 'Societe Test' && ($data['customer_note'] ?? '') === 'note de test' && ($data['attribution']['user_agent'] ?? '') === 'AgentTest' && array_key_exists('mollie_payment_instructions', $data['payment_meta'] ?? []));
    $ep = find($d['events'], 'product', $pid);
    t('produit livré, descriptions présentes', $ep && array_key_exists('description', $ep['data']) && array_key_exists('permalink', $ep['data']));

    echo "--- ack et modification pendant l'ack\n";
    $o2 = fresh($oid); $o2->set_customer_note('modifiee entre lecture et ack'); $o2->save();
    [$s2, $a] = ack_all($d['events']);
    t('ack accepté', $s2 === 200 && ($a['acked'] ?? 0) > 0, 'acked=' . ($a['acked'] ?? 0));
    $left = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM $T WHERE object_type='order' AND wp_id=%d AND state='pending'", $oid));
    t('la modification arrivée après la lecture reste en file', $left > 0, "pending=$left");
    [, $d] = pull(); $e = find($d['events'], 'order', $oid);
    t('elle repart avec le contenu à jour', ($e['data']['customer_note'] ?? '') === 'modifiee entre lecture et ack');
    ack_all($d['events']);

    echo "--- remboursement\n";
    $r = wc_create_refund(['order_id' => $oid, 'amount' => 5, 'reason' => 'test', 'refund_payment' => false, 'restock_items' => false]);
    t('remboursement créé', !is_wp_error($r));
    $rid = $r->get_id();
    [, $d] = pull(); $e = find($d['events'], 'refund', $rid);
    t('événement remboursement, TVA et commande parente', $e && (float) $e['data']['refund_amount'] === 5.0 && (int) $e['parent_id'] === $oid && array_key_exists('order_tax', $e['data']));
    ack_all($d['events']);
    $r->delete(true);
    [, $d] = pull(); $e = find($d['events'], 'refund', $rid);
    t('suppression du remboursement : marqueur gone', $e && $e['gone'] === true && $e['data'] === null);
    ack_all($d['events']);

    echo "--- index des commandes et statuts\n";
    $since = time() - 3600;
    $o3 = mk_order($pid, 'delivered'); $o4 = mk_order($pid, 'awaiting-delivery'); $o5 = mk_order($pid, 'completed');
    $o6 = wc_create_order(['customer_id' => 69, 'status' => 'checkout-draft']); $created['orders'][] = $o6->get_id();
    [$s, $i] = req('GET', '/yousync/v2/orders/index', $TOKEN, null, ['since' => $since, 'per_page' => 200]);
    $by = []; foreach ($i['orders'] ?? [] as $row) $by[$row['id']] = $row;
    t('index : 200', $s === 200, 'total=' . ($i['total'] ?? '?'));
    t('delivered présent', ($by[$o3->get_id()]['status'] ?? '') === 'delivered');
    t('awaiting-delivery présent', ($by[$o4->get_id()]['status'] ?? '') === 'awaiting-delivery');
    t('completed présent', ($by[$o5->get_id()]['status'] ?? '') === 'completed');
    t('brouillon absent', !isset($by[$o6->get_id()]));
    t('aucune donnée client dans l\'index', !array_diff(array_keys($i['orders'][0] ?? []), ['id', 'status', 'date_modified', 'pending']));
    t('pending vrai tant que non livré', ($by[$o3->get_id()]['pending'] ?? false) === true);
    t('date au format attendu', preg_match('/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/', (string) ($by[$o3->get_id()]['date_modified'] ?? '')) === 1, (string) ($by[$o3->get_id()]['date_modified'] ?? ''));
    drain();
    [, $i] = req('GET', '/yousync/v2/orders/index', $TOKEN, null, ['since' => $since]);
    $by = []; foreach ($i['orders'] as $row) $by[$row['id']] = $row;
    t('pending faux une fois acquitté', ($by[$o3->get_id()]['pending'] ?? true) === false);

    echo "--- rattrapage : événement supprimé à la main\n";
    $o7 = mk_order($pid, 'processing');
    $wpdb->query($wpdb->prepare("DELETE FROM $T WHERE object_type='order' AND wp_id=%d", $o7->get_id()));
    [, $i] = req('GET', '/yousync/v2/orders/index', $TOKEN, null, ['since' => $since]);
    $by = []; foreach ($i['orders'] as $row) $by[$row['id']] = $row;
    t('la commande sans événement reste visible, non marquée en attente', isset($by[$o7->get_id()]) && $by[$o7->get_id()]['pending'] === false);
    $wpdb->query($wpdb->prepare("DELETE FROM $T WHERE object_type='order' AND wp_id=%d", $o7->get_id()));
    echo 'INDEX_GAP ', $o7->get_id(), ' ', $by[$o7->get_id()]['status'], ' ', $by[$o7->get_id()]['date_modified'], "\n";

    echo "--- client et objets disparus\n";
    wp_update_user(['ID' => 69, 'description' => get_user_meta(69, 'description', true)]);
    [, $d] = pull(); $e = find($d['events'], 'customer', 69);
    t('client livré avec tous ses champs', $e && array_key_exists('billing_address_1', $e['data']) && array_key_exists('total_spent', $e['data']));
    ack_all($d['events']);
    $u = wp_insert_user(['user_login' => 'test_yousync_' . time(), 'user_pass' => wp_generate_password(), 'user_email' => 'test-yousync@example.invalid', 'role' => 'customer']);
    $created['users'][] = $u; Queue::add('customer', 'update', $u); drain();
    Queue::add('customer', 'update', $u);
    $victim = mk_order($pid, 'processing'); require_once ABSPATH . 'wp-admin/includes/user.php'; wp_delete_user($u); $created['users'] = [];
    [$s, $d] = pull(); $e = find($d['events'], 'customer', $u);
    t('compte supprimé : gone, le lot n\'est pas bloqué', $s === 200 && $e && $e['gone'] === true && find($d['events'], 'order', $victim->get_id()) !== null);
    ack_all($d['events']);
    $tmp = new WC_Product_Simple(); $tmp->set_name('TEST YOUSYNC 2'); $tmp->set_status('draft'); $tmp->save(); $tmpId = $tmp->get_id(); drain();
    $tmp->delete(true);
    [, $d] = pull(); $e = find($d['events'], 'product', $tmpId);
    t('produit supprimé : gone', $e && $e['gone'] === true, $e['action'] ?? '');
    ack_all($d['events']);

    echo "--- accès\n";
    t('sans jeton : 401', req('GET', '/yousync/v2/queue')[0] === 401);
    t('faux jeton : 401', req('GET', '/yousync/v2/queue', 'faux')[0] === 401);
    t('ack sans jeton : 401', req('POST', '/yousync/v2/queue/ack', null, ['acked' => [1]])[0] === 401);
    t('index sans jeton : 401', req('GET', '/yousync/v2/orders/index')[0] === 401);
    unset($_SERVER['HTTPS']);
    t('hors HTTPS, bon jeton : 403', req('GET', '/yousync/v2/queue', $TOKEN)[0] === 403);
    $_SERVER['HTTPS'] = 'on';
    delete_option('yousync_auth');
    t('accès non configuré : 503', req('GET', '/yousync/v2/queue', $TOKEN)[0] === 503);
    update_option('yousync_auth', $bak['auth'], false);
    $routes = array_keys(rest_get_server()->get_index(new WP_REST_Request('GET', '/'))->get_data()['routes'] ?? []);
    t('routes masquées de l\'index REST', !array_filter($routes, function ($r) { return preg_match('#yousync.*/(queue|token|orders|health)#', $r); }));

    echo "--- renouvellement\n";
    wp_set_current_user(0);
    t('route du jeton anonyme : refusée', in_array(req('POST', '/wc-yousync/v1/token', null, ['token' => str_repeat('a', 64)])[0], [401, 403], true));
    wp_set_current_user(69);
    $new = bin2hex(random_bytes(32));
    [$s, $b] = req('POST', '/wc-yousync/v1/token', null, ['token' => $new]);
    t('compte gestionnaire : accepté, jeton non renvoyé', $s === 200 && strpos(wp_json_encode($b), $new) === false);
    t('rejouable', req('POST', '/wc-yousync/v1/token', null, ['token' => $new])[0] === 200);
    t('second jeton refusé pendant le délai : 409', req('POST', '/wc-yousync/v1/token', null, ['token' => str_repeat('b', 64)])[0] === 409);
    t('ancien et nouveau acceptés', req('GET', '/yousync/v2/health', $TOKEN)[0] === 200 && req('GET', '/yousync/v2/health', $new)[0] === 200);
    t('jeton en clair effacé', !array_key_exists('api_token', get_option('yousync_settings')));
    $au = get_option('yousync_auth'); $au['previous_until'] = time() - 1; update_option('yousync_auth', $au, false);
    t('après le délai : seul le nouveau', req('GET', '/yousync/v2/health', $TOKEN)[0] === 401 && req('GET', '/yousync/v2/health', $new)[0] === 200);
    update_option('yousync_auth', $bak['auth'], false); update_option('yousync_settings', $bak['settings']);

    echo "--- pause, échec, ancienneté\n";
    Queue::set_paused(true);
    $o8 = mk_order($pid, 'processing');
    [, $d] = pull();
    t('pause : rien ne sort, tout s\'enregistre', $d['paused'] === true && $d['events'] === [] && $d['stats']['pending'] > 0, 'pending=' . $d['stats']['pending']);
    Queue::set_paused(false);
    $wpdb->query($wpdb->prepare("UPDATE $T SET created_at = %s WHERE object_type='order' AND wp_id=%d", gmdate('Y-m-d H:i:s', time() - 72 * 3600), $o8->get_id()));
    Queue::purge();
    [, $d] = pull(); $e = find($d['events'], 'order', $o8->get_id());
    t('événement de 72 h : ni expiré ni purgé, il repart', $e !== null);
    [, $n] = req('POST', '/yousync/v2/queue/ack', $TOKEN, ['acked' => [], 'failed' => [['ids' => $e['ids'], 'code' => 'DB_23505']]]);
    for ($i = 0; $i < 12; $i++) { $wpdb->query($wpdb->prepare("UPDATE $T SET attempts = attempts + 1 WHERE object_type='order' AND wp_id=%d AND state='pending'", $o8->get_id())); }
    [, $d] = pull();
    t('après trop d\'essais : en échec, reste en table', $d['stats']['failed'] >= 1 && find($d['events'], 'order', $o8->get_id()) === null, 'failed=' . $d['stats']['failed']);
    t('code conservé, sans donnée', ($d['stats']['failed_sample'][0]['code'] ?? '') === 'DB_23505');
    t('rejeu', Queue::replay_failed() >= 1);
    drain();
    t('file vide à la fin', (int) $wpdb->get_var("SELECT COUNT(*) FROM $T WHERE state IN ('pending','failed')") === 0);
} catch (\Throwable $e) {
    $fails++; echo '  FAIL exception : ', $e->getMessage(), ' (', basename($e->getFile()), ':', $e->getLine(), ")\n";
} finally {
    update_option('yousync_auth', $bak['auth'], false);
    update_option('yousync_settings', $bak['settings']);
    update_option('yousync_paused', $bak['paused'] ? 1 : 0, false);
    foreach ($created['orders'] as $id) { $x = wc_get_order($id); if ($x) { foreach ($x->get_refunds() as $rf) $rf->delete(true); $x->delete(true); } }
    foreach ($created['products'] as $id) { $x = wc_get_product($id); if ($x) $x->delete(true); }
    if ($created['users']) { require_once ABSPATH . 'wp-admin/includes/user.php'; foreach ($created['users'] as $id) wp_delete_user($id); }
    $wpdb->query("DELETE FROM $T WHERE state IN ('pending','failed')");
}
echo "--- nettoyage et sorties\n";
$left = $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->postmeta} m JOIN {$wpdb->posts} p ON p.ID=m.post_id WHERE m.meta_key='_billing_last_name' AND m.meta_value='YouSync' AND p.post_type='shop_order'");
echo 'commandes de test restantes : ', $left, ' ; produits : ', $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_title LIKE 'TEST YOUSYNC%'"), "\n";
if ($created['orders']) { $at = $wpdb->prefix . 'actionscheduler_actions'; foreach ($wpdb->get_col($wpdb->prepare("SELECT action_id FROM $at WHERE status='pending' AND hook='wc-admin_import_orders' AND args REGEXP %s", '(^|[^0-9])(' . implode('|', $created['orders']) . ')([^0-9]|$)')) as $aid) ActionScheduler::store()->delete_action($aid); }
$hosts = array_count_values($GLOBALS['blocked']); echo 'requêtes sortantes bloquées : ', ($hosts ? wp_json_encode($hosts) : 'aucune'), "\n";
echo $fails ? "BILAN : $fails échec(s)\n" : "BILAN : tout est bon\n";
echo '###EVENTS###' . base64_encode(wp_json_encode($allEvents)) . "\n";
