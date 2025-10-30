<?php
/**
 * Batch Processor - Gère l'import historique massif par lots
 *
 * @package YouvapeSync
 */

if (!defined('ABSPATH')) {
    exit;
}

class Youvape_Sync_Batch_Processor {

    /**
     * API Client
     */
    private $api_client;

    /**
     * Taille des lots
     */
    private $batch_size = 25;

    /**
     * Types de données à synchroniser (ordre respecté)
     */
    private $sync_types = array('customers', 'products', 'orders');

    /**
     * Constructeur
     *
     * @param Youvape_Sync_API_Client $api_client Instance de l'API client
     */
    public function __construct($api_client) {
        $this->api_client = $api_client;

        $settings = get_option('youvape_sync_settings', array());
        if (isset($settings['batch_size']) && $settings['batch_size'] > 0) {
            $this->batch_size = (int) $settings['batch_size'];
        }
    }

    /**
     * Démarre un import batch
     *
     * @return array Résultat du démarrage
     */
    public function start_batch_import() {
        // Vérifie qu'un import n'est pas déjà en cours
        $current_status = get_option('youvape_sync_batch_status');
        if ($current_status && $current_status['status'] === 'running') {
            return array(
                'success' => false,
                'error' => __('Un import est déjà en cours.', 'youvape-sync'),
            );
        }

        // Vérifie que l'API est configurée
        if (!$this->api_client->is_configured()) {
            return array(
                'success' => false,
                'error' => __('L\'API n\'est pas configurée.', 'youvape-sync'),
            );
        }

        // Compte le nombre total d'items à importer
        $totals = $this->count_totals();

        // Initialise le statut
        $status = array(
            'status' => 'running',
            'started_at' => current_time('mysql'),
            'current_type' => 'customers',
            'current_offset' => 0,
            'totals' => $totals,
            'processed' => array(
                'customers' => 0,
                'products' => 0,
                'orders' => 0,
            ),
            'errors' => array(),
            'last_update' => current_time('mysql'),
        );

        update_option('youvape_sync_batch_status', $status);

        return array(
            'success' => true,
            'message' => __('Import démarré avec succès.', 'youvape-sync'),
            'status' => $status,
        );
    }

    /**
     * Traite le prochain lot
     *
     * @return array Résultat du traitement
     */
    public function process_next_batch() {
        $status = get_option('youvape_sync_batch_status');

        if (!$status || $status['status'] !== 'running') {
            return array(
                'success' => false,
                'error' => __('Aucun import en cours.', 'youvape-sync'),
            );
        }

        // Vérifie les restrictions horaires
        if (!$this->is_within_time_window()) {
            return array(
                'success' => false,
                'waiting' => true,
                'message' => __('En attente de la plage horaire autorisée.', 'youvape-sync'),
            );
        }

        $current_type = $status['current_type'];
        $current_offset = $status['current_offset'];

        // Récupère les données du type actuel
        $result = $this->fetch_and_send_batch($current_type, $current_offset);

        if (!$result['success']) {
            // Log l'erreur
            $status['errors'][] = array(
                'type' => $current_type,
                'offset' => $current_offset,
                'error' => $result['error'],
                'time' => current_time('mysql'),
            );
            update_option('youvape_sync_batch_status', $status);

            return $result;
        }

        // Met à jour le statut
        $items_sent = $result['items_sent'];
        $status['processed'][$current_type] += $items_sent;
        $status['current_offset'] += $items_sent;
        $status['last_update'] = current_time('mysql');

        // Vérifie si on a terminé ce type
        if ($items_sent < $this->batch_size) {
            // Passe au type suivant
            $next_type = $this->get_next_type($current_type);

            if ($next_type) {
                $status['current_type'] = $next_type;
                $status['current_offset'] = 0;
            } else {
                // Tous les types sont terminés
                $status['status'] = 'completed';
                $status['completed_at'] = current_time('mysql');
            }
        }

        update_option('youvape_sync_batch_status', $status);

        return array(
            'success' => true,
            'items_sent' => $items_sent,
            'status' => $status,
            'completed' => $status['status'] === 'completed',
        );
    }

    /**
     * Récupère et envoie un lot de données
     *
     * @param string $type Type de données (customers, products, orders)
     * @param int $offset Offset de pagination
     * @return array Résultat
     */
    private function fetch_and_send_batch($type, $offset) {
        $settings = get_option('youvape_sync_settings', array());

        // Vérifie si ce type est activé
        $enabled_key = 'enable_' . $type;
        if (!isset($settings[$enabled_key]) || !$settings[$enabled_key]) {
            return array(
                'success' => true,
                'items_sent' => 0,
                'message' => sprintf(__('Type %s désactivé.', 'youvape-sync'), $type),
            );
        }

        switch ($type) {
            case 'customers':
                $items = $this->fetch_customers($offset);
                $response = $this->api_client->send_customers($items, 'batch_import');
                break;

            case 'products':
                $items = $this->fetch_products($offset);
                $response = $this->api_client->send_products($items, 'batch_import');
                break;

            case 'orders':
                $items = $this->fetch_orders($offset);
                $response = $this->api_client->send_orders($items, 'batch_import');
                break;

            default:
                return array(
                    'success' => false,
                    'error' => sprintf(__('Type inconnu: %s', 'youvape-sync'), $type),
                );
        }

        if (!$response['success']) {
            return $response;
        }

        return array(
            'success' => true,
            'items_sent' => count($items),
        );
    }

    /**
     * Récupère un lot de clients
     *
     * @param int $offset Offset de pagination
     * @param int $limit Nombre d'items (optionnel, utilise batch_size par défaut)
     * @return array Clients formatés
     */
    private function fetch_customers($offset, $limit = null) {
        if ($limit === null) {
            $limit = $this->batch_size;
        }

        $customers = get_users(array(
            'role' => 'customer',
            'number' => $limit,
            'offset' => $offset,
            'orderby' => 'ID',
            'order' => 'ASC',
        ));

        $formatted = array();

        foreach ($customers as $user) {
            $customer = new WC_Customer($user->ID);

            $formatted[] = array(
                'customer_id' => $customer->get_id(),
                'email' => $customer->get_email(),
                'first_name' => $customer->get_first_name(),
                'last_name' => $customer->get_last_name(),
                'phone' => $customer->get_billing_phone(),
                'username' => $customer->get_username(),
                'date_created' => $customer->get_date_created() ? $customer->get_date_created()->date('c') : null,
                'total_spent' => (float) wc_format_decimal($customer->get_total_spent(), 2),
                'order_count' => $customer->get_order_count(),
                'billing_address' => array(
                    'first_name' => $customer->get_billing_first_name(),
                    'last_name' => $customer->get_billing_last_name(),
                    'company' => $customer->get_billing_company(),
                    'address_1' => $customer->get_billing_address_1(),
                    'address_2' => $customer->get_billing_address_2(),
                    'city' => $customer->get_billing_city(),
                    'state' => $customer->get_billing_state(),
                    'postcode' => $customer->get_billing_postcode(),
                    'country' => $customer->get_billing_country(),
                    'email' => $customer->get_billing_email(),
                    'phone' => $customer->get_billing_phone(),
                ),
                'shipping_address' => array(
                    'first_name' => $customer->get_shipping_first_name(),
                    'last_name' => $customer->get_shipping_last_name(),
                    'company' => $customer->get_shipping_company(),
                    'address_1' => $customer->get_shipping_address_1(),
                    'address_2' => $customer->get_shipping_address_2(),
                    'city' => $customer->get_shipping_city(),
                    'state' => $customer->get_shipping_state(),
                    'postcode' => $customer->get_shipping_postcode(),
                    'country' => $customer->get_shipping_country(),
                ),
                'avatar_url' => get_avatar_url($customer->get_email()),
            );
        }

        return $formatted;
    }

    /**
     * Récupère un lot de produits
     *
     * @param int $offset Offset de pagination
     * @param int $limit Nombre d'items (optionnel, utilise batch_size par défaut)
     * @return array Produits formatés
     */
    private function fetch_products($offset, $limit = null) {
        if ($limit === null) {
            $limit = $this->batch_size;
        }

        $args = array(
            'status' => array('publish', 'private'),
            'limit' => $limit,
            'offset' => $offset,
            'orderby' => 'ID',
            'order' => 'ASC',
            'return' => 'objects',
        );

        $products = wc_get_products($args);
        $formatted = array();

        foreach ($products as $product) {
            // Récupère le coût d'achat si disponible (champs personnalisés communs)
            $cost_price = $product->get_meta('_cost_price');
            if (empty($cost_price)) {
                $cost_price = $product->get_meta('_alg_wc_cog_cost'); // Cost of Goods plugin
            }
            if (empty($cost_price)) {
                $cost_price = $product->get_meta('_wc_cog_cost'); // WooCommerce Cost of Goods
            }

            // Récupère les catégories
            $category_ids = $product->get_category_ids();
            $categories = array();
            $category_name = '';

            if (!empty($category_ids)) {
                foreach ($category_ids as $cat_id) {
                    $term = get_term($cat_id, 'product_cat');
                    if ($term && !is_wp_error($term)) {
                        $categories[] = array(
                            'id' => $term->term_id,
                            'name' => $term->name,
                            'slug' => $term->slug,
                        );
                        if (empty($category_name)) {
                            $category_name = $term->name;
                        }
                    }
                }
            }

            $formatted[] = array(
                'product_id' => $product->get_id(),
                'sku' => $product->get_sku(),
                'name' => $product->get_name(),
                'price' => (float) wc_format_decimal($product->get_price(), 2),
                'regular_price' => (float) wc_format_decimal($product->get_regular_price(), 2),
                'sale_price' => $product->get_sale_price() ? (float) wc_format_decimal($product->get_sale_price(), 2) : null,
                'cost_price' => $cost_price ? (float) wc_format_decimal($cost_price, 2) : null,
                'stock_quantity' => $product->get_stock_quantity(),
                'stock_status' => $product->get_stock_status(),
                'category' => $category_name,
                'categories' => $categories,
                'date_created' => $product->get_date_created() ? $product->get_date_created()->date('c') : null,
                'date_modified' => $product->get_date_modified() ? $product->get_date_modified()->date('c') : null,
                'total_sales' => $product->get_total_sales(),
                'image_url' => wp_get_attachment_url($product->get_image_id()),
            );
        }

        return $formatted;
    }

    /**
     * Récupère un lot de commandes
     *
     * @param int $offset Offset de pagination
     * @param int $limit Nombre d'items (optionnel, utilise batch_size par défaut)
     * @return array Commandes formatées
     */
    private function fetch_orders($offset, $limit = null) {
        if ($limit === null) {
            $limit = $this->batch_size;
        }

        $args = array(
            'limit' => $limit,
            'offset' => $offset,
            'orderby' => 'ID',
            'order' => 'ASC',
            'return' => 'objects',
        );

        $orders = wc_get_orders($args);
        $formatted = array();

        foreach ($orders as $order) {
            // Line items
            $line_items = array();
            foreach ($order->get_items() as $item) {
                $product = $item->get_product();
                $cost_price = null;

                if ($product) {
                    $cost_price = $product->get_meta('_cost_price');
                    if (empty($cost_price)) {
                        $cost_price = $product->get_meta('_alg_wc_cog_cost');
                    }
                    if (empty($cost_price)) {
                        $cost_price = $product->get_meta('_wc_cog_cost');
                    }
                }

                $line_items[] = array(
                    'product_id' => $item->get_product_id(),
                    'product_name' => $item->get_name(),
                    'sku' => $product ? $product->get_sku() : '',
                    'quantity' => $item->get_quantity(),
                    'price' => (float) wc_format_decimal($item->get_total() / $item->get_quantity(), 2),
                    'regular_price' => $product ? (float) wc_format_decimal($product->get_regular_price(), 2) : null,
                    'subtotal' => (float) wc_format_decimal($item->get_subtotal(), 2),
                    'total' => (float) wc_format_decimal($item->get_total(), 2),
                    'discount' => (float) wc_format_decimal($item->get_subtotal() - $item->get_total(), 2),
                    'tax' => (float) wc_format_decimal($item->get_total_tax(), 2),
                );
            }

            // Coupons
            $coupon_lines = array();
            foreach ($order->get_coupon_codes() as $code) {
                $coupon_items = $order->get_items('coupon');
                foreach ($coupon_items as $coupon_item) {
                    if ($coupon_item->get_code() === $code) {
                        $coupon = new WC_Coupon($code);
                        $coupon_lines[] = array(
                            'code' => $code,
                            'discount' => (float) wc_format_decimal($coupon_item->get_discount(), 2),
                            'discount_type' => $coupon->get_discount_type(),
                        );
                    }
                }
            }

            // Méthode de livraison
            $shipping_method = '';
            $shipping_method_title = '';
            foreach ($order->get_shipping_methods() as $shipping) {
                $shipping_method = $shipping->get_method_id();
                $shipping_method_title = $shipping->get_method_title();
                break;
            }

            $formatted[] = array(
                'order_id' => $order->get_id(),
                'order_number' => $order->get_order_number(),
                'status' => $order->get_status(),
                'total' => (float) wc_format_decimal($order->get_total(), 2),
                'subtotal' => (float) wc_format_decimal($order->get_subtotal(), 2),
                'shipping_total' => (float) wc_format_decimal($order->get_shipping_total(), 2),
                'discount_total' => (float) wc_format_decimal($order->get_discount_total(), 2),
                'tax_total' => (float) wc_format_decimal($order->get_total_tax(), 2),
                'payment_method' => $order->get_payment_method(),
                'payment_method_title' => $order->get_payment_method_title(),
                'currency' => $order->get_currency(),
                'date_created' => $order->get_date_created() ? $order->get_date_created()->date('c') : null,
                'date_completed' => $order->get_date_completed() ? $order->get_date_completed()->date('c') : null,
                'date_modified' => $order->get_date_modified() ? $order->get_date_modified()->date('c') : null,
                'customer_id' => $order->get_customer_id(),
                'shipping_method' => $shipping_method,
                'shipping_method_title' => $shipping_method_title,
                'shipping_country' => $order->get_shipping_country(),
                'billing_address' => $order->get_address('billing'),
                'shipping_address' => $order->get_address('shipping'),
                'customer_note' => $order->get_customer_note(),
                'line_items' => $line_items,
                'coupon_lines' => $coupon_lines,
            );
        }

        return $formatted;
    }

    /**
     * Compte le total d'items pour chaque type
     *
     * @return array Totaux par type
     */
    private function count_totals() {
        $settings = get_option('youvape_sync_settings', array());

        $totals = array(
            'customers' => 0,
            'products' => 0,
            'orders' => 0,
        );

        if (isset($settings['enable_customers']) && $settings['enable_customers']) {
            $totals['customers'] = count_users()['avail_roles']['customer'] ?? 0;
        }

        if (isset($settings['enable_products']) && $settings['enable_products']) {
            $totals['products'] = array_sum((array) wp_count_posts('product'));
        }

        if (isset($settings['enable_orders']) && $settings['enable_orders']) {
            // Compte toutes les commandes (tous statuts confondus)
            $order_count = 0;

            // WooCommerce 8.0+ utilise HPOS (High-Performance Order Storage)
            if (class_exists('Automattic\WooCommerce\Utilities\OrderUtil') &&
                method_exists('Automattic\WooCommerce\Utilities\OrderUtil', 'custom_orders_table_usage_is_enabled') &&
                \Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled()) {
                // HPOS activé : utiliser wc_get_orders avec limit -1
                $order_count = count(wc_get_orders(array(
                    'limit' => -1,
                    'return' => 'ids',
                )));
            } else {
                // Legacy : compter via wp_posts
                global $wpdb;
                $order_count = $wpdb->get_var("
                    SELECT COUNT(ID)
                    FROM {$wpdb->posts}
                    WHERE post_type IN ('shop_order', 'shop_order_placehold')
                ");
            }

            $totals['orders'] = (int) $order_count;
        }

        return $totals;
    }

    /**
     * Vérifie si on est dans la plage horaire autorisée
     *
     * @return bool
     */
    private function is_within_time_window() {
        $settings = get_option('youvape_sync_settings', array());

        if (!isset($settings['enable_time_restriction']) || !$settings['enable_time_restriction']) {
            return true;
        }

        $time_start = isset($settings['time_start']) ? $settings['time_start'] : '02:00';
        $time_end = isset($settings['time_end']) ? $settings['time_end'] : '06:00';

        $current_time = current_time('H:i');

        return ($current_time >= $time_start && $current_time <= $time_end);
    }

    /**
     * Retourne le type suivant dans l'ordre de synchronisation
     *
     * @param string $current_type Type actuel
     * @return string|null Type suivant ou null si terminé
     */
    private function get_next_type($current_type) {
        $current_index = array_search($current_type, $this->sync_types);

        if ($current_index === false || $current_index >= count($this->sync_types) - 1) {
            return null;
        }

        return $this->sync_types[$current_index + 1];
    }

    /**
     * Retourne le statut de l'import en cours
     *
     * @return array|false Statut ou false si aucun import
     */
    public function get_import_status() {
        return get_option('youvape_sync_batch_status', false);
    }

    /**
     * Arrête l'import en cours
     *
     * @return array Résultat
     */
    public function stop_batch_import() {
        $status = get_option('youvape_sync_batch_status');

        if (!$status || $status['status'] !== 'running') {
            return array(
                'success' => false,
                'error' => __('Aucun import en cours.', 'youvape-sync'),
            );
        }

        $status['status'] = 'stopped';
        $status['stopped_at'] = current_time('mysql');
        update_option('youvape_sync_batch_status', $status);

        return array(
            'success' => true,
            'message' => __('Import arrêté avec succès.', 'youvape-sync'),
        );
    }

    /**
     * Envoie un échantillon de test vers l'API
     * NOUVELLE VERSION: Appelle l'API backend pour générer des données de test avec système d'offset
     *
     * @param int $customers_count Nombre de clients à générer
     * @param int $products_count Nombre de produits à générer
     * @param int $orders_count Nombre de commandes à générer
     * @return array Résultat de l'envoi
     */
    public function send_test_sample($customers_count = 5, $products_count = 5, $orders_count = 5) {
        $settings = get_option('youvape_sync_settings', array());

        // Vérifie que l'API est configurée
        if (!$this->api_client->is_configured()) {
            return array(
                'success' => false,
                'error' => __('L\'API n\'est pas configurée.', 'youvape-sync'),
            );
        }

        // Appel à la nouvelle API de génération de données de test
        $api_url = rtrim($settings['api_url'], '/') . '/test/generate';

        $body = array(
            'customers' => intval($customers_count),
            'products' => intval($products_count),
            'orders' => intval($orders_count)
        );

        $response = wp_remote_post($api_url, array(
            'timeout' => 60,
            'headers' => array('Content-Type' => 'application/json'),
            'body' => json_encode($body),
        ));

        if (is_wp_error($response)) {
            return array(
                'success' => false,
                'error' => $response->get_error_message(),
            );
        }

        $body_response = wp_remote_retrieve_body($response);
        $data = json_decode($body_response, true);

        if (!$data) {
            return array(
                'success' => false,
                'error' => __('Réponse invalide de l\'API.', 'youvape-sync'),
            );
        }

        if (isset($data['success']) && $data['success']) {
            return array(
                'success' => true,
                'message' => $data['message'] ?? __('Données de test générées avec succès.', 'youvape-sync'),
                'counts' => $data['counts'] ?? array(),
                'offsets' => $data['offsets'] ?? array(),
                'import_results' => $data['import_results'] ?? array(),
                'results' => array(
                    'data_sent' => array(), // Pas de données envoyées dans ce cas, tout est géré côté backend
                )
            );
        } else {
            return array(
                'success' => false,
                'error' => $data['error'] ?? __('Erreur lors de la génération des données de test.', 'youvape-sync'),
            );
        }
    }
}
