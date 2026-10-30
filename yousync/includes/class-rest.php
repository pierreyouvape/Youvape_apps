<?php
/**
 * Rest - Routes lues par le serveur Youvape.
 *
 * Tout est en lecture, sauf l'ack (qui ne touche qu'à notre table) et le
 * renouvellement de l'accès. yousync n'écrit jamais sur le site : ni stock, ni statut,
 * ni méta.
 */

namespace YouSync;

defined('ABSPATH') || exit;

class Rest {

    const NAMESPACE_V2 = 'yousync/v2';
    const NAMESPACE_ADMIN = 'wc-yousync/v1';

    const INDEX_MAX_PER_PAGE = 200;
    const INDEX_MAX_DAYS = 14;
    const DRAFT_STATUSES = ['wc-checkout-draft', 'wc-auto-draft', 'auto-draft', 'checkout-draft'];

    public static function register_routes() {
        $by_token = ['\YouSync\Auth', 'check_request'];

        register_rest_route(self::NAMESPACE_V2, '/queue', [
            'methods' => 'GET',
            'callback' => [__CLASS__, 'get_queue'],
            'permission_callback' => $by_token,
            'show_in_index' => false,
        ]);

        register_rest_route(self::NAMESPACE_V2, '/queue/ack', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'post_ack'],
            'permission_callback' => $by_token,
            'show_in_index' => false,
        ]);

        register_rest_route(self::NAMESPACE_V2, '/orders/index', [
            'methods' => 'GET',
            'callback' => [__CLASS__, 'get_orders_index'],
            'permission_callback' => $by_token,
            'show_in_index' => false,
        ]);

        register_rest_route(self::NAMESPACE_V2, '/health', [
            'methods' => 'GET',
            'callback' => [__CLASS__, 'get_health'],
            'permission_callback' => $by_token,
            'show_in_index' => false,
        ]);

        register_rest_route(self::NAMESPACE_ADMIN, '/token', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'post_token'],
            'permission_callback' => [__CLASS__, 'can_manage'],
            'show_in_index' => false,
        ]);
    }

    /**
     * Réservé aux comptes qui gèrent la boutique, en HTTPS.
     */
    public static function can_manage() {
        return Auth::is_https() && current_user_can('manage_woocommerce');
    }

    /**
     * Réponse jamais mise en cache : un proxy ne doit pas pouvoir la resservir.
     */
    private static function respond($data) {
        $response = new \WP_REST_Response($data, 200);
        $response->header('Cache-Control', 'no-store, private');
        return $response;
    }

    /**
     * GET queue : les événements à livrer. En pause, rien ne sort et rien ne se perd.
     */
    public static function get_queue() {
        update_option(Queue::LAST_POLL_OPTION, time(), false);

        $paused = Queue::is_paused();

        return self::respond([
            'success' => true,
            'version' => YOUSYNC_VERSION,
            'paused' => $paused,
            'events' => $paused ? [] : Queue::read(),
            'stats' => Queue::stats(),
        ]);
    }

    /**
     * POST queue/ack : { "acked": [ids], "failed": [{ "ids": [...], "code": "CODE" }] }
     */
    public static function post_ack($request) {
        $body = $request->get_json_params();
        $body = is_array($body) ? $body : [];

        $result = Queue::acknowledge($body['acked'] ?? [], $body['failed'] ?? []);
        if (is_wp_error($result)) {
            return $result;
        }

        return self::respond(['success' => true] + $result);
    }

    /**
     * GET orders/index : commandes modifiées depuis `since`, sans aucune donnée client.
     * Lecture par wc_get_orders : fonctionne avant et après le passage en HPOS.
     */
    public static function get_orders_index($request) {
        if (Queue::is_paused()) {
            return self::respond(['success' => true, 'paused' => true, 'orders' => [], 'page' => 1, 'pages' => 1]);
        }

        $oldest = time() - self::INDEX_MAX_DAYS * DAY_IN_SECONDS;
        $since = max($oldest, absint($request->get_param('since')));
        $page = max(1, absint($request->get_param('page')));
        $per_page = max(1, min(self::INDEX_MAX_PER_PAGE, absint($request->get_param('per_page')) ?: self::INDEX_MAX_PER_PAGE));

        $result = wc_get_orders([
            'type' => 'shop_order',
            'status' => array_values(array_diff(array_keys(wc_get_order_statuses()), self::DRAFT_STATUSES)),
            'date_modified' => '>=' . $since,
            'orderby' => 'ID',
            'order' => 'ASC',
            'limit' => $per_page,
            'paged' => $page,
            'paginate' => true,
        ]);

        $pending = Queue::pending_orders(array_map(function($order) {
            return $order->get_id();
        }, $result->orders));

        $orders = [];
        foreach ($result->orders as $order) {
            $modified = $order->get_date_modified() ?: $order->get_date_created();
            $orders[] = [
                'id' => $order->get_id(),
                'status' => $order->get_status(),
                'date_modified' => $modified ? $modified->format('Y-m-d H:i:s') : null,
                'pending' => isset($pending[$order->get_id()]),
            ];
        }

        return self::respond([
            'success' => true,
            'paused' => false,
            'orders' => $orders,
            'page' => $page,
            'pages' => (int) $result->max_num_pages,
            'total' => (int) $result->total,
        ]);
    }

    /**
     * GET health : état, sans donnée client.
     */
    public static function get_health() {
        $hpos = null;
        if (class_exists('\Automattic\WooCommerce\Utilities\OrderUtil')) {
            $hpos = \Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled();
        }

        return self::respond([
            'success' => true,
            'version' => YOUSYNC_VERSION,
            'db_version' => get_option(Install::VERSION_OPTION),
            'paused' => Queue::is_paused(),
            'hpos_enabled' => $hpos,
            'stats' => Queue::stats(),
        ]);
    }

    /**
     * POST token.
     */
    public static function post_token($request) {
        $body = $request->get_json_params();
        $result = Auth::rotate(is_array($body) ? ($body['token'] ?? null) : null);
        if (is_wp_error($result)) {
            return $result;
        }

        return self::respond(['success' => true, 'grace_seconds' => Auth::GRACE_SECONDS]);
    }
}
