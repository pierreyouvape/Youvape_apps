<?php
/**
 * Banc du plugin yousync : la vraie file, sur une vraie base SQL (SQLite en mémoire).
 *
 * WordPress est remplacé par le strict nécessaire. Pas de PHP sur le Mac : ce fichier
 * se lance par `backend/tests/yousync-plugin/run.sh`, qui l'envoie dans un conteneur
 * PHP jetable, sans rien déposer, avec les sources du plugin.
 *
 * Ne couvre pas WooCommerce lui-même (hooks, wc_get_orders, Data_Fetcher) : c'est
 * l'objet de la liste de tests préprod de yousync/AVANT-DE-MODIFIER.md.
 */

define('ABSPATH', sys_get_temp_dir() . '/yousync-harness-' . getmypid() . '/');
define('YOUSYNC_VERSION', '2.0.0');
define('MINUTE_IN_SECONDS', 60);
define('HOUR_IN_SECONDS', 3600);
define('DAY_IN_SECONDS', 86400);
@mkdir(ABSPATH . 'wp-admin/includes', 0777, true);
file_put_contents(ABSPATH . 'wp-admin/includes/upgrade.php', '<?php function dbDelta($sql) { global $wpdb; $wpdb->create_events(); }');

$GLOBALS['options'] = [];
$GLOBALS['transients'] = [];
$GLOBALS['cleared_hooks'] = [];
$GLOBALS['posts'] = [];
$GLOBALS['now'] = time();
$GLOBALS['is_ssl'] = true;
$GLOBALS['logs'] = [];

function is_ssl() { return $GLOBALS['is_ssl']; }
function get_option($key, $default = false) { return array_key_exists($key, $GLOBALS['options']) ? $GLOBALS['options'][$key] : $default; }
function update_option($key, $value, $autoload = null) { $GLOBALS['options'][$key] = $value; return true; }
function get_transient($key) { return $GLOBALS['transients'][$key] ?? false; }
function set_transient($key, $value, $ttl = 0) { $GLOBALS['transients'][$key] = $value; return true; }
function current_time($type, $gmt = 0) { return gmdate('Y-m-d H:i:s', $GLOBALS['now']); }
function wp_json_encode($data) { return json_encode($data); }
function get_post($id) { return $GLOBALS['posts'][$id] ?? null; }
function wc_get_logger() { return new class { public function error($m, $c = []) { $GLOBALS['logs'][] = $m; } }; }
function trailingslashit($s) { return rtrim($s, '/') . '/'; }
function wp_upload_dir() { return ['basedir' => $GLOBALS['uploads']]; }
function wp_clear_scheduled_hook($hook) { $GLOBALS['cleared_hooks'][] = $hook; }
function wp_next_scheduled($hook) { return false; }
function wp_schedule_single_event($t, $hook) { return true; }
function is_wp_error($v) { return $v instanceof WP_Error; }
function absint($v) { return abs((int) $v); }

class WP_Error {
    public $code; public $data;
    public function __construct($code, $message = '', $data = []) { $this->code = $code; $this->data = $data; }
}
class WP_REST_Response {
    public $data; public $headers = [];
    public function __construct($data, $status = 200) { $this->data = $data; }
    public function header($k, $v) { $this->headers[$k] = $v; }
}
class FakeRequest {
    private $h; private $b;
    public function __construct($headers = [], $body = []) { $this->h = $headers; $this->b = $body; }
    public function get_header($k) { return $this->h[$k] ?? null; }
    public function get_json_params() { return $this->b; }
    public function get_param($k) { return $this->b[$k] ?? null; }
}

/** $wpdb sur SQLite : mêmes méthodes, même échappement simplifié. */
class FakeWpdb {
    public $prefix = 'hJvjTIOu';
    public $options = 'options';
    public $pdo;
    public $writes = 0;

    public function __construct() {
        $this->pdo = new PDO('sqlite::memory:');
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    }
    public function create_events() {
        $this->pdo->exec("CREATE TABLE IF NOT EXISTS {$this->prefix}yousync_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT, object_type TEXT NOT NULL, action TEXT NOT NULL,
            wp_id INTEGER NOT NULL, parent_id INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0, last_code TEXT DEFAULT NULL, created_at TEXT NOT NULL,
            acked_at TEXT DEFAULT NULL, failed_at TEXT DEFAULT NULL)");
    }
    public function get_charset_collate() { return ''; }
    public function esc_like($s) { return $s; }
    public function prepare($sql, ...$args) {
        if (count($args) === 1 && is_array($args[0])) { $args = $args[0]; }
        $i = 0;
        return preg_replace_callback('/%[ds]/', function ($m) use (&$i, $args) {
            $v = $args[$i++];
            return $m[0] === '%d' ? (string) (int) $v : $this->pdo->quote((string) $v);
        }, $sql);
    }
    private function special($sql) {
        if (strpos($sql, 'GET_LOCK') !== false) return '1';
        if (strpos($sql, 'RELEASE_LOCK') !== false) return '1';
        if (strpos($sql, 'SHOW TABLES') !== false) return $this->prefix . 'yousync_events';
        if (strpos($sql, $this->options) !== false && strpos($sql, 'option_value') !== false) return get_option('yousync_db_version', null);
        return null;
    }
    public function get_var($sql) {
        $s = $this->special($sql);
        if ($s !== null) return $s;
        if (strpos($sql, 'option_value') !== false) return null;
        $v = $this->pdo->query($sql)->fetchColumn();
        return $v === false ? null : $v;
    }
    public function get_results($sql) { return $this->pdo->query($sql)->fetchAll(PDO::FETCH_OBJ); }
    public function get_col($sql) { return $this->pdo->query($sql)->fetchAll(PDO::FETCH_COLUMN); }
    public function query($sql) {
        $s = $this->special($sql);
        if ($s !== null) return 1;
        // SQLite n'a pas DELETE ... LIMIT.
        $sql = preg_replace('/^(\s*DELETE .*?)\s+LIMIT \d+\s*$/s', '$1', $sql);
        return $this->pdo->exec($sql);
    }
    public function insert($table, $row, $formats) {
        $this->writes++;
        $cols = implode(',', array_keys($row));
        $values = implode(',', array_map(function ($v) { return is_int($v) ? $v : $this->pdo->quote($v); }, array_values($row)));
        return $this->pdo->exec("INSERT INTO {$table} ({$cols}) VALUES ({$values})");
    }
}

$wpdb = new FakeWpdb();
$wpdb->create_events();

foreach (json_decode(base64_decode(getenv('YOUSYNC_SOURCES') ?: stream_get_contents(fopen('php://fd/3', 'r'))), true) as $source) {
    eval('?>' . $source);
}

class Stub {}

// Contenu des objets, à la main : `Data_Fetcher` est remplacé par ce qui suit.
$GLOBALS['content'] = [];

function t_rows() { global $wpdb; return $wpdb->get_results("SELECT * FROM hJvjTIOuyousync_events ORDER BY id"); }
function t_reset() {
    global $wpdb;
    $wpdb->pdo->exec('DROP TABLE IF EXISTS hJvjTIOuyousync_events');
    $wpdb->pdo->exec("DELETE FROM sqlite_sequence");
    $wpdb->create_events();
    $GLOBALS['options'] = [];
    $GLOBALS['content'] = [];
    $GLOBALS['posts'] = [];
    $GLOBALS['is_ssl'] = true;
    $GLOBALS['now'] = time();
    $GLOBALS['logs'] = [];
}
function t_eq($a, $b, $msg = '') { if ($a !== $b) throw new Exception(($msg ? "$msg : " : '') . 'attendu ' . json_encode($b) . ', obtenu ' . json_encode($a)); }
function t_true($c, $msg = '') { if (!$c) throw new Exception($msg ?: 'condition fausse'); }

$GLOBALS['fails'] = 0;
function test($name, $fn) {
    t_reset();
    try { $fn(); echo "  ok   $name\n"; }
    catch (\Throwable $e) { $GLOBALS['fails']++; echo "  FAIL $name\n       " . $e->getMessage() . ' (ligne ' . $e->getLine() . ")\n"; }
}

use YouSync\Queue;
use YouSync\Auth;
use YouSync\Install;
use YouSync\Rest;

$order = function ($id) { return ['wp_order_id' => $id]; };
$okAll = function () use ($order) { foreach (func_get_args() as $id) { $GLOBALS['content']['order:' . $id] = $order($id); } };
$ids = function ($events) { $r = []; foreach ($events as $e) { $r = array_merge($r, $e['ids']); } return $r; };

test('un événement est un INSERT, aucune donnée client en table', function () {
    t_true(Queue::add('order', 'create', 12));
    $row = t_rows()[0];
    t_eq($row->state, 'pending');
    t_eq(array_keys((array) $row), ['id', 'object_type', 'action', 'wp_id', 'parent_id', 'state', 'attempts', 'last_code', 'created_at', 'acked_at', 'failed_at']);
});

test('entrées invalides : type, action ou identifiant refusés', function () {
    t_eq(Queue::add('commande', 'create', 1), false);
    t_eq(Queue::add('order', 'drop', 1), false);
    t_eq(Queue::add('order', 'create', 0), false);
    t_eq(count(t_rows()), 0);
});

test('regroupe par objet : un seul envoi, tous les identifiants lus', function () use ($okAll) {
    $okAll(1, 2);
    Queue::add('order', 'create', 1);
    Queue::add('order', 'update', 2);
    Queue::add('order', 'update', 1);
    $events = Queue::read();
    t_eq(count($events), 2);
    t_eq($events[0]['ids'], [1, 3]);
    t_eq($events[0]['action'], 'update');
    t_eq($events[1]['ids'], [2]);
});

test('ack : une ligne arrivée après la lecture reste en file', function () use ($okAll, $ids) {
    $okAll(1);
    Queue::add('order', 'update', 1);
    $events = Queue::read();
    Queue::add('order', 'update', 1);
    $r = Queue::acknowledge($ids($events), []);
    t_eq($r['acked'], 1);
    $rows = t_rows();
    t_eq([$rows[0]->state, $rows[1]->state], ['acked', 'pending']);
    t_eq($ids(Queue::read()), [2]);
});

test('ack d\'un identifiant jamais lu : sans effet', function () {
    Queue::add('order', 'update', 1);
    t_eq(Queue::acknowledge([1], [])['acked'], 0);
    t_eq(t_rows()[0]->state, 'pending');
});

test('ack rejoué : sans effet', function () use ($okAll, $ids) {
    $okAll(1);
    Queue::add('order', 'update', 1);
    $l = $ids(Queue::read());
    t_eq(Queue::acknowledge($l, [])['acked'], 1);
    t_eq(Queue::acknowledge($l, [])['acked'], 0);
});

test('ack : identifiants nettoyés, volume plafonné', function () {
    t_eq(Queue::acknowledge(["1; DROP TABLE x", 'abc', -3, 0], [])['acked'], 0);
    t_true(Queue::acknowledge(range(1, 2001), []) instanceof WP_Error);
    t_eq(count(t_rows()), 0);
});

test('jamais d\'expiration : un événement ancien repart', function () use ($okAll, $ids) {
    $okAll(1);
    $GLOBALS['now'] = time() - 40 * DAY_IN_SECONDS;
    Queue::add('order', 'update', 1);
    $GLOBALS['now'] = time();
    Queue::purge();
    t_eq($ids(Queue::read()), [1]);
});

test('objet disparu : marqueur explicite, pas d\'événement sauté', function () {
    Queue::add('order', 'update', 1);
    $e = Queue::read()[0];
    t_eq($e['gone'], true);
    t_eq($e['action'], 'delete');
    t_eq($e['data'], null);
});

test('remboursement disparu : la commande parente suit', function () {
    Queue::add('refund', 'delete', 9, 77);
    $e = Queue::read()[0];
    t_eq([$e['gone'], $e['parent_id']], [true, 77]);
});

test('produit illisible mais présent : PAS déclaré disparu', function () {
    $GLOBALS['posts'][5] = (object) ['ID' => 5];
    Queue::add('product', 'update', 5);
    t_eq(Queue::read(), []);
    $row = t_rows()[0];
    t_eq([$row->state, $row->last_code], ['pending', 'READ_ERROR']);
});

test('dernier événement « delete » mais objet présent (restauré) : mise à jour', function () use ($okAll) {
    $okAll(1);
    Queue::add('order', 'delete', 1);
    $e = Queue::read()[0];
    t_eq([$e['gone'], $e['action']], [false, 'update']);
});

test('objet en erreur : n\'empêche pas les autres', function () use ($okAll, $ids) {
    $GLOBALS['content']['order:1'] = 'THROW';
    $okAll(2);
    Queue::add('order', 'update', 1);
    Queue::add('order', 'update', 2);
    t_eq($ids(Queue::read()), [2]);
    t_eq(t_rows()[0]->last_code, 'READ_ERROR');
});

test('objet non encodable : signalé, n\'emporte pas toute la réponse', function () use ($okAll, $ids) {
    $GLOBALS['content']['order:1'] = ['nom' => "\xB1\x31"];
    $okAll(2);
    Queue::add('order', 'update', 1);
    Queue::add('order', 'update', 2);
    t_eq($ids(Queue::read()), [2]);
    t_eq(t_rows()[0]->last_code, 'JSON_ERROR');
});

test('après N essais : en échec, ne consomme plus le lot, reste en table', function () use ($okAll, $ids) {
    Queue::add('order', 'update', 1);
    $okAll(1);
    for ($i = 0; $i < Queue::MAX_ATTEMPTS; $i++) {
        Queue::read();
        Queue::acknowledge([], [['ids' => [1], 'code' => 'DB_23505']]);
    }
    t_eq(t_rows()[0]->state, 'pending');
    Queue::add('order', 'update', 2);
    $okAll(2);
    t_eq($ids(Queue::read()), [2]);
    $row = t_rows()[0];
    t_eq([$row->state, $row->last_code], ['failed', 'DB_23505']);
    $stats = Queue::stats();
    t_eq($stats['failed'], 1);
    t_eq($stats['failed_sample'], [['type' => 'order', 'wp_id' => 1, 'code' => 'DB_23505']]);
});

test('une ligne en échec se rejoue', function () use ($okAll, $ids) {
    Queue::add('order', 'update', 1);
    $okAll(1);
    for ($i = 0; $i <= Queue::MAX_ATTEMPTS; $i++) { Queue::read(); }
    t_eq(t_rows()[0]->state, 'failed');
    t_eq(Queue::replay_failed(), 1);
    $row = t_rows()[0];
    t_eq([$row->state, (int) $row->attempts], ['pending', 0]);
    t_eq($ids(Queue::read()), [1]);
});

test('une nouvelle livraison réussie solde les anciens échecs du même objet', function () use ($okAll, $ids) {
    Queue::add('order', 'update', 1);
    $okAll(1);
    for ($i = 0; $i <= Queue::MAX_ATTEMPTS; $i++) { Queue::read(); }
    Queue::add('order', 'update', 1);
    $l = $ids(Queue::read());
    t_eq($l, [2, 1]);
    Queue::acknowledge($l, []);
    t_eq(Queue::stats()['failed'], 0);
});

test('PHP tombe sur un objet : lui seul est pénalisé, pas son lot', function () use ($okAll) {
    $okAll(1, 2, 3);
    Queue::add('order', 'update', 1);
    Queue::add('order', 'update', 2);
    Queue::add('order', 'update', 3);
    for ($i = 0; $i < 4; $i++) {
        Queue::read();
        global $wpdb; // L'objet 2 a planté : sa ligne reste « en lecture », aucune réponse n'est partie.
        $wpdb->query("UPDATE hJvjTIOuyousync_events SET last_code = 'READING' WHERE wp_id = 2");
    }
    Queue::read();
    $rows = t_rows();
    t_eq($rows[1]->state, 'failed', 'objet en cause');
    t_eq([$rows[0]->state, $rows[2]->state], ['pending', 'pending'], 'objets sains');
});

test('lot plafonné : le reste part au passage suivant, dans l\'ordre', function () use ($ids) {
    for ($i = 1; $i <= 60; $i++) { $GLOBALS['content']['order:' . $i] = ['n' => $i]; Queue::add('order', 'update', $i); }
    $first = Queue::read();
    t_eq(count($first), 50);
    Queue::acknowledge($ids($first), []);
    $second = Queue::read();
    t_eq(count($second), 10);
    t_eq($second[0]['wp_id'], 51);
});

test('purge : seulement les lignes acquittées et anciennes', function () use ($okAll, $ids) {
    global $wpdb;
    $okAll(1, 2, 3);
    Queue::add('order', 'update', 1);
    Queue::add('order', 'update', 2);
    Queue::add('order', 'update', 3);
    Queue::acknowledge($ids(Queue::read()), []);
    Queue::add('order', 'update', 4);
    $wpdb->query("UPDATE hJvjTIOuyousync_events SET acked_at = '2020-01-01 00:00:00' WHERE id IN (1, 2)");
    $wpdb->query("UPDATE hJvjTIOuyousync_events SET state = 'failed', acked_at = '2020-01-01 00:00:00' WHERE id = 2");
    Queue::purge();
    $left = array_map(function ($r) { return (int) $r->id; }, t_rows());
    t_eq($left, [2, 3, 4]);
});

test('pause : rien ne sort, tout s\'enregistre', function () use ($okAll, $ids) {
    $okAll(1);
    Queue::set_paused(true);
    Queue::add('order', 'update', 1);
    $r = Rest::get_queue()->data;
    t_eq([$r['paused'], $r['events']], [true, []]);
    t_eq($r['stats']['pending'], 1);
    t_eq((int) t_rows()[0]->attempts, 0);
    Queue::set_paused(false);
    t_eq(count(Rest::get_queue()->data['events']), 1);
});

test('réponse de file : jamais en cache', function () {
    t_eq(Rest::get_queue()->headers['Cache-Control'], 'no-store, private');
});

$req = function ($token = null) { return new FakeRequest($token === null ? [] : ['X-YouSync-Token' => $token]); };
$setToken = function ($t) { $GLOBALS['options']['yousync_auth'] = ['hash' => hash('sha256', $t)]; };

test('jeton : bon → accepté, faux ou absent → 401', function () use ($req, $setToken) {
    $setToken('bon');
    t_eq(Auth::check_request($req('bon')), true);
    t_eq(Auth::check_request($req('faux'))->data['status'], 401);
    t_eq(Auth::check_request($req())->data['status'], 401);
});

test('jeton non configuré : 503, distinct de 401 et 404', function () use ($req) {
    t_eq(Auth::check_request($req('x'))->data['status'], 503);
});

test('hors HTTPS : refus, même avec le bon jeton', function () use ($req, $setToken) {
    $setToken('bon');
    $GLOBALS['is_ssl'] = false;
    t_eq(Auth::check_request($req('bon'))->data['status'], 403);
    $_SERVER['HTTP_X_FORWARDED_PROTO'] = 'https';
    t_eq(Auth::check_request($req('bon')), true);
    unset($_SERVER['HTTP_X_FORWARDED_PROTO']);
});

test('le site ne garde pas le jeton en clair', function () {
    $new = str_repeat('a', 64);
    Auth::rotate($new);
    t_true(strpos(json_encode($GLOBALS['options']), $new) === false);
});

test('renouvellement : les deux jetons marchent 15 min, puis seul le nouveau', function () use ($req, $setToken) {
    $setToken('ancien');
    $new = str_repeat('b', 64);
    t_eq(Auth::rotate($new), true);
    t_eq(Auth::check_request($req('ancien')), true);
    t_eq(Auth::check_request($req($new)), true);
    $GLOBALS['options']['yousync_auth']['previous_until'] = time() - 1;
    t_eq(Auth::check_request($req('ancien'))->data['status'], 401);
    t_eq(Auth::check_request($req($new)), true);
});

test('renouvellement rejouable, second jeton refusé pendant le délai', function () use ($setToken) {
    $setToken('ancien');
    $a = str_repeat('a', 64);
    $b = str_repeat('b', 64);
    t_eq(Auth::rotate($a), true);
    t_eq(Auth::rotate($a), true);
    t_eq(Auth::rotate($b)->data['status'], 409);
});

test('renouvellement : format contrôlé, ancien jeton en clair effacé', function () use ($setToken) {
    $setToken('ancien');
    $GLOBALS['options']['yousync_settings'] = ['api_token' => 'ancien', 'enabled' => true];
    t_eq(Auth::rotate('court')->data['status'], 400);
    t_eq(Auth::rotate(null)->data['status'], 400);
    t_true(array_key_exists('api_token', $GLOBALS['options']['yousync_settings']));
    Auth::rotate(str_repeat('c', 64));
    t_eq($GLOBALS['options']['yousync_settings'], ['enabled' => true]);
});

test('mise à jour : jeton repris, réglage d\'envoi retiré, cron déprogrammé, une seule fois', function () use ($req) {
    global $wpdb;
    $wpdb->pdo->exec('DROP TABLE hJvjTIOuyousync_events');
    $GLOBALS['uploads'] = ABSPATH . 'up1';
    $GLOBALS['options']['yousync_settings'] = ['api_url' => '', 'api_token' => 'jeton-actuel', 'enabled' => true, 'batch_size' => 50];
    $GLOBALS['cleared_hooks'] = [];
    Install::maybe_upgrade();
    t_eq(Auth::check_request($req('jeton-actuel')), true);
    t_eq(array_key_exists('api_url', $GLOBALS['options']['yousync_settings']), false);
    t_eq($GLOBALS['options']['yousync_settings']['api_token'], 'jeton-actuel', 'retour à la 1.4 possible');
    t_eq($GLOBALS['options'][Install::VERSION_OPTION], Install::DB_VERSION);
    t_eq(Queue::is_paused(), false);
    t_true(in_array('yousync_process_queue', $GLOBALS['cleared_hooks'], true));
    $count = count($GLOBALS['cleared_hooks']);
    Install::maybe_upgrade();
    t_eq(count($GLOBALS['cleared_hooks']), $count, 'second passage');
});

test('synchro désactivée en 1.x : devient une pause, les événements s\'enregistrent', function () {
    $GLOBALS['uploads'] = ABSPATH . 'up2';
    $GLOBALS['options']['yousync_settings'] = ['enabled' => false];
    Install::maybe_upgrade();
    t_eq(Queue::is_paused(), true);
});

test('reprise de queue.json puis suppression des fichiers de la 1.x', function () {
    $dir = ABSPATH . 'up3/yousync/';
    @mkdir($dir . 'logs', 0777, true);
    file_put_contents($dir . 'queue.json', json_encode([
        ['type' => 'order', 'action' => 'create', 'wp_id' => 1234, 'data' => ['billing_email' => 'client@test']],
        ['type' => 'refund', 'action' => 'delete', 'wp_id' => 55],
        ['type' => 'bizarre', 'wp_id' => 1],
    ]));
    file_put_contents($dir . 'logs/sync-2026-10-30.log', 'x');
    file_put_contents($dir . 'logs/.htaccess', 'x');
    file_put_contents($dir . 'logs/index.php', 'x');
    file_put_contents($dir . '.htaccess', 'x');
    file_put_contents($dir . 'index.php', 'x');
    $GLOBALS['uploads'] = ABSPATH . 'up3';
    Install::import_legacy_queue();
    $rows = t_rows();
    t_eq(count($rows), 2);
    t_eq([$rows[0]->object_type, (int) $rows[0]->wp_id], ['order', 1234]);
    t_true(strpos(json_encode($rows), 'client@test') === false, 'donnée client en table');
    t_eq(is_dir($dir), false, 'dossier supprimé');
});

test('ancienne file abîmée : laissée en place, signalée', function () {
    $dir = ABSPATH . 'up4/yousync/';
    @mkdir($dir, 0777, true);
    file_put_contents($dir . 'queue.json', '{pas du json');
    $GLOBALS['uploads'] = ABSPATH . 'up4';
    Install::import_legacy_queue();
    t_true(is_file($dir . 'queue.json.importing'));
    t_eq(count($GLOBALS['logs']), 1);
});

test('fichier réapparu après la reprise (ancienne requête) : repris par le second passage', function () {
    $dir = ABSPATH . 'up5/yousync/';
    @mkdir($dir, 0777, true);
    file_put_contents($dir . 'queue.json', json_encode([['type' => 'order', 'action' => 'update', 'wp_id' => 1]]));
    $GLOBALS['uploads'] = ABSPATH . 'up5';
    Install::import_legacy_queue();
    @mkdir($dir, 0777, true);
    file_put_contents($dir . 'queue.json', json_encode([['type' => 'order', 'action' => 'update', 'wp_id' => 2]]));
    Install::import_legacy_queue();
    t_eq(count(t_rows()), 2);
});

echo $GLOBALS['fails'] ? "\n{$GLOBALS['fails']} échec(s)\n" : "\nplugin yousync : tout est bon\n";
exit($GLOBALS['fails'] ? 1 : 0);
