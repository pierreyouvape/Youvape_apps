<?php
/**
 * Event Listener - Gère la synchronisation temps réel via hooks WooCommerce
 *
 * @package YouvapeSync
 */

if (!defined('ABSPATH')) {
    exit;
}

class Youvape_Sync_Event_Listener {

    /**
     * API Client
     */
    private $api_client;

    /**
     * Délai avant envoi (en secondes)
     */
    private $delay = 60;

    /**
     * Constructeur
     *
     * @param Youvape_Sync_API_Client $api_client Instance de l'API client
     */
    public function __construct($api_client) {
        $this->api_client = $api_client;

        $settings = get_option('youvape_sync_settings', array());
        if (isset($settings['live_sync_delay']) && $settings['live_sync_delay'] > 0) {
            $this->delay = (int) $settings['live_sync_delay'];
        }

        $this->init_hooks();
    }

    /**
     * Initialise les hooks WooCommerce
     */
    private function init_hooks() {
        $settings = get_option('youvape_sync_settings', array());

        // Vérifie que la synchro live est activée
        if (!isset($settings['live_sync_enabled']) || !$settings['live_sync_enabled']) {
            return;
        }

        // Hooks pour les commandes
        if (isset($settings['enable_orders']) && $settings['enable_orders']) {
            add_action('woocommerce_new_order', array($this, 'schedule_order_sync'), 10, 1);
            add_action('woocommerce_update_order', array($this, 'schedule_order_sync'), 10, 1);
            add_action('woocommerce_order_status_changed', array($this, 'schedule_order_sync'), 10, 1);
        }

        // Hooks pour les produits
        if (isset($settings['enable_products']) && $settings['enable_products']) {
            add_action('woocommerce_new_product', array($this, 'schedule_product_sync'), 10, 1);
            add_action('woocommerce_update_product', array($this, 'schedule_product_sync'), 10, 1);
        }

        // Hooks pour les clients
        if (isset($settings['enable_customers']) && $settings['enable_customers']) {
            add_action('user_register', array($this, 'schedule_customer_sync'), 10, 1);
            add_action('profile_update', array($this, 'schedule_customer_sync'), 10, 1);
            add_action('woocommerce_customer_save_address', array($this, 'schedule_customer_sync'), 10, 1);
            add_action('woocommerce_new_customer', array($this, 'schedule_customer_sync'), 10, 1);
        }

        // Hook pour traiter la queue avec délai
        add_action('youvape_sync_process_queue', array($this, 'process_sync_queue'));
    }

    /**
     * Planifie la synchronisation d'une commande
     *
     * @param int|WC_Order $order_id ID de la commande ou objet commande
     */
    public function schedule_order_sync($order_id) {
        if (is_a($order_id, 'WC_Order')) {
            $order_id = $order_id->get_id();
        }

        $this->add_to_queue('order', $order_id);
    }

    /**
     * Planifie la synchronisation d'un produit
     *
     * @param int|WC_Product $product_id ID du produit ou objet produit
     */
    public function schedule_product_sync($product_id) {
        if (is_a($product_id, 'WC_Product')) {
            $product_id = $product_id->get_id();
        }

        $this->add_to_queue('product', $product_id);
    }

    /**
     * Planifie la synchronisation d'un client
     *
     * @param int $user_id ID de l'utilisateur
     */
    public function schedule_customer_sync($user_id) {
        // Vérifie que c'est un client WooCommerce
        $user = get_user_by('id', $user_id);
        if (!$user || !in_array('customer', $user->roles)) {
            return;
        }

        $this->add_to_queue('customer', $user_id);
    }

    /**
     * Ajoute un item à la queue de synchronisation
     *
     * @param string $type Type d'item (order, product, customer)
     * @param int $item_id ID de l'item
     */
    private function add_to_queue($type, $item_id) {
        $queue = get_option('youvape_sync_live_queue', array());

        // Évite les doublons (on garde seulement le plus récent)
        $key = $type . '_' . $item_id;
        $queue[$key] = array(
            'type' => $type,
            'item_id' => $item_id,
            'scheduled_at' => time(),
            'send_at' => time() + $this->delay,
        );

        update_option('youvape_sync_live_queue', $queue);

        // Planifie le traitement de la queue si pas déjà planifié
        if (!wp_next_scheduled('youvape_sync_process_queue')) {
            wp_schedule_single_event(time() + $this->delay, 'youvape_sync_process_queue');
        }

        // Log en mode debug
        if (defined('WP_DEBUG') && WP_DEBUG) {
            error_log(sprintf(
                'Youvape Sync: %s #%d ajouté à la queue (envoi dans %d secondes)',
                $type,
                $item_id,
                $this->delay
            ));
        }
    }

    /**
     * Traite la queue de synchronisation
     */
    public function process_sync_queue() {
        $queue = get_option('youvape_sync_live_queue', array());

        if (empty($queue)) {
            return;
        }

        $current_time = time();
        $items_to_sync = array();
        $remaining_queue = array();

        // Sépare les items prêts à être envoyés
        foreach ($queue as $key => $item) {
            if ($item['send_at'] <= $current_time) {
                $items_to_sync[] = $item;
            } else {
                $remaining_queue[$key] = $item;
            }
        }

        // Met à jour la queue
        update_option('youvape_sync_live_queue', $remaining_queue);

        // Replanifie si nécessaire
        if (!empty($remaining_queue)) {
            $next_send = min(array_column($remaining_queue, 'send_at'));
            wp_schedule_single_event($next_send, 'youvape_sync_process_queue');
        }

        // Groupe les items par type
        $grouped = array(
            'customer' => array(),
            'product' => array(),
            'order' => array(),
        );

        foreach ($items_to_sync as $item) {
            $grouped[$item['type']][] = $item['item_id'];
        }

        // Envoie les items groupés
        if (!empty($grouped['customer'])) {
            $this->sync_customers($grouped['customer']);
        }

        if (!empty($grouped['product'])) {
            $this->sync_products($grouped['product']);
        }

        if (!empty($grouped['order'])) {
            $this->sync_orders($grouped['order']);
        }
    }

    /**
     * Synchronise un groupe de clients
     *
     * @param array $customer_ids IDs des clients
     */
    private function sync_customers($customer_ids) {
        $customers = array();

        foreach ($customer_ids as $customer_id) {
            $customer_data = $this->format_customer($customer_id);
            if ($customer_data) {
                $customers[] = $customer_data;
            }
        }

        if (empty($customers)) {
            return;
        }

        $response = $this->api_client->send_customers($customers, 'live_update');

        if (defined('WP_DEBUG') && WP_DEBUG) {
            if ($response['success']) {
                error_log(sprintf('Youvape Sync: %d clients synchronisés', count($customers)));
            } else {
                error_log(sprintf('Youvape Sync: Erreur sync clients - %s', $response['error']));
            }
        }
    }

    /**
     * Synchronise un groupe de produits
     *
     * @param array $product_ids IDs des produits
     */
    private function sync_products($product_ids) {
        $products = array();

        foreach ($product_ids as $product_id) {
            $product_data = $this->format_product($product_id);
            if ($product_data) {
                $products[] = $product_data;
            }
        }

        if (empty($products)) {
            return;
        }

        $response = $this->api_client->send_products($products, 'live_update');

        if (defined('WP_DEBUG') && WP_DEBUG) {
            if ($response['success']) {
                error_log(sprintf('Youvape Sync: %d produits synchronisés', count($products)));
            } else {
                error_log(sprintf('Youvape Sync: Erreur sync produits - %s', $response['error']));
            }
        }
    }

    /**
     * Synchronise un groupe de commandes
     *
     * @param array $order_ids IDs des commandes
     */
    private function sync_orders($order_ids) {
        $orders = array();

        foreach ($order_ids as $order_id) {
            $order_data = $this->format_order($order_id);
            if ($order_data) {
                $orders[] = $order_data;
            }
        }

        if (empty($orders)) {
            return;
        }

        $response = $this->api_client->send_orders($orders, 'live_update');

        if (defined('WP_DEBUG') && WP_DEBUG) {
            if ($response['success']) {
                error_log(sprintf('Youvape Sync: %d commandes synchronisées', count($orders)));
            } else {
                error_log(sprintf('Youvape Sync: Erreur sync commandes - %s', $response['error']));
            }
        }
    }

    /**
     * Formate les données d'un client
     *
     * @param int $customer_id ID du client
     * @return array|null Données formatées ou null si erreur
     */
    private function format_customer($customer_id) {
        try {
            $customer = new WC_Customer($customer_id);

            if (!$customer->get_id()) {
                return null;
            }

            return array(
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
            );
        } catch (Exception $e) {
            error_log('Youvape Sync: Erreur format customer #' . $customer_id . ' - ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Formate les données d'un produit
     *
     * @param int $product_id ID du produit
     * @return array|null Données formatées ou null si erreur
     */
    private function format_product($product_id) {
        try {
            $product = wc_get_product($product_id);

            if (!$product) {
                return null;
            }

            // Récupère le coût d'achat
            $cost_price = $product->get_meta('_cost_price');
            if (empty($cost_price)) {
                $cost_price = $product->get_meta('_alg_wc_cog_cost');
            }
            if (empty($cost_price)) {
                $cost_price = $product->get_meta('_wc_cog_cost');
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

            return array(
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
        } catch (Exception $e) {
            error_log('Youvape Sync: Erreur format product #' . $product_id . ' - ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Formate les données d'une commande
     *
     * @param int $order_id ID de la commande
     * @return array|null Données formatées ou null si erreur
     */
    private function format_order($order_id) {
        try {
            $order = wc_get_order($order_id);

            if (!$order) {
                return null;
            }

            // Line items
            $line_items = array();
            foreach ($order->get_items() as $item) {
                $product = $item->get_product();

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

            return array(
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
        } catch (Exception $e) {
            error_log('Youvape Sync: Erreur format order #' . $order_id . ' - ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Retourne la taille actuelle de la queue
     *
     * @return int
     */
    public function get_queue_size() {
        $queue = get_option('youvape_sync_live_queue', array());
        return count($queue);
    }

    /**
     * Vide la queue
     */
    public function clear_queue() {
        delete_option('youvape_sync_live_queue');
        wp_clear_scheduled_hook('youvape_sync_process_queue');
    }
}
