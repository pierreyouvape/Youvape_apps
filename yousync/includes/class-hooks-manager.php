<?php
/**
 * Hooks Manager - Écoute les événements WooCommerce et les ajoute à la queue
 */

namespace YouSync;

defined('ABSPATH') || exit;

class Hooks_Manager {

    /**
     * Initialize hooks
     */
    public static function init() {
        $settings = get_option('yousync_settings', []);

        // Only register hooks if sync is enabled
        if (empty($settings['enabled'])) {
            return;
        }

        // Orders hooks
        if (!empty($settings['sync_orders'])) {
            // New order
            add_action('woocommerce_new_order', [__CLASS__, 'on_new_order'], 10, 2);

            // Order status changed (LIGHT - explicit hook)
            add_action('woocommerce_order_status_changed', [__CLASS__, 'on_order_status_changed'], 10, 4);

            // Order updated (FULL - generic hook)
            add_action('woocommerce_update_order', [__CLASS__, 'on_order_updated'], 10, 2);
        }

        // Products hooks
        if (!empty($settings['sync_products'])) {
            // Product saved (create or update)
            add_action('woocommerce_update_product', [__CLASS__, 'on_product_saved'], 10, 2);
            add_action('woocommerce_new_product', [__CLASS__, 'on_product_created'], 10, 2);

            // Variation saved
            add_action('woocommerce_update_product_variation', [__CLASS__, 'on_product_saved'], 10, 2);
            add_action('woocommerce_new_product_variation', [__CLASS__, 'on_product_created'], 10, 2);

            // Stock changed (LIGHT - explicit hook)
            add_action('woocommerce_product_set_stock', [__CLASS__, 'on_stock_changed'], 10, 1);
            add_action('woocommerce_variation_set_stock', [__CLASS__, 'on_stock_changed'], 10, 1);

            // Product deleted
            add_action('before_delete_post', [__CLASS__, 'on_product_deleted'], 10, 1);
        }

        // Customers hooks
        if (!empty($settings['sync_customers'])) {
            // New customer
            add_action('woocommerce_created_customer', [__CLASS__, 'on_customer_created'], 10, 3);

            // Customer updated
            add_action('woocommerce_update_customer', [__CLASS__, 'on_customer_updated'], 10, 2);

            // Profile updated (fallback for WP users)
            add_action('profile_update', [__CLASS__, 'on_profile_updated'], 10, 2);
        }

        // Refunds hooks
        if (!empty($settings['sync_refunds'])) {
            // Refund created
            add_action('woocommerce_refund_created', [__CLASS__, 'on_refund_created'], 10, 2);

            // Refund deleted
            add_action('woocommerce_refund_deleted', [__CLASS__, 'on_refund_deleted'], 10, 2);
        }
    }

    /* ============================================
     * ORDER HOOKS
     * ============================================ */

    /**
     * New order created - FULL
     */
    public static function on_new_order($order_id, $order = null) {
        if (!$order) {
            $order = wc_get_order($order_id);
        }
        if (!$order) return;

        $data = Data_Fetcher::get_order($order_id);
        if ($data) {
            Queue_Manager::add('order', 'create', $order_id, $data);
        }
    }

    /**
     * Order status changed - LIGHT (explicit hook)
     */
    public static function on_order_status_changed($order_id, $old_status, $new_status, $order) {
        // Only send the status change, not full data
        Queue_Manager::add('order', 'update', $order_id, [
            'status' => $new_status,
            'previous_status' => $old_status,
            'date_modified' => current_time('mysql')
        ]);
    }

    /**
     * Order updated - FULL (generic hook, we don't know what changed)
     */
    public static function on_order_updated($order_id, $order = null) {
        // Skip if this is triggered by status change (already handled)
        static $status_changed = [];
        if (isset($status_changed[$order_id])) {
            return;
        }

        // Check if we just processed a status change
        if (doing_action('woocommerce_order_status_changed')) {
            $status_changed[$order_id] = true;
            return;
        }

        $data = Data_Fetcher::get_order($order_id);
        if ($data) {
            Queue_Manager::add('order', 'update', $order_id, $data);
        }
    }

    /* ============================================
     * PRODUCT HOOKS
     * ============================================ */

    /**
     * Product created - FULL
     */
    public static function on_product_created($product_id, $product = null) {
        $data = Data_Fetcher::get_product($product_id);
        if ($data) {
            Queue_Manager::add('product', 'create', $product_id, $data);
        }
    }

    /**
     * Product saved/updated - FULL
     */
    public static function on_product_saved($product_id, $product = null) {
        // Skip if stock change (already handled by explicit hook)
        if (doing_action('woocommerce_product_set_stock') || doing_action('woocommerce_variation_set_stock')) {
            return;
        }

        $data = Data_Fetcher::get_product($product_id);
        if ($data) {
            Queue_Manager::add('product', 'update', $product_id, $data);
        }
    }

    /**
     * Stock changed - LIGHT (explicit hook)
     */
    public static function on_stock_changed($product) {
        Queue_Manager::add('product', 'update', $product->get_id(), [
            'stock_quantity' => $product->get_stock_quantity(),
            'stock_status' => $product->get_stock_status(),
            'date_modified' => current_time('mysql')
        ]);
    }

    /**
     * Product deleted - LIGHT
     */
    public static function on_product_deleted($post_id) {
        $post = get_post($post_id);
        if (!$post || !in_array($post->post_type, ['product', 'product_variation'])) {
            return;
        }

        Queue_Manager::add('product', 'delete', $post_id, [
            'deleted' => true,
            'deleted_at' => current_time('mysql')
        ]);
    }

    /* ============================================
     * CUSTOMER HOOKS
     * ============================================ */

    /**
     * Customer created - FULL
     */
    public static function on_customer_created($customer_id, $new_customer_data = [], $password_generated = false) {
        $data = Data_Fetcher::get_customer($customer_id);
        if ($data) {
            Queue_Manager::add('customer', 'create', $customer_id, $data);
        }
    }

    /**
     * Customer updated via WooCommerce - FULL
     */
    public static function on_customer_updated($customer_id, $customer = null) {
        $data = Data_Fetcher::get_customer($customer_id);
        if ($data) {
            Queue_Manager::add('customer', 'update', $customer_id, $data);
        }
    }

    /**
     * Profile updated via WordPress - FULL
     */
    public static function on_profile_updated($user_id, $old_user_data = null) {
        // Check if user is a customer
        $customer = new \WC_Customer($user_id);
        if (!$customer->get_id()) {
            return;
        }

        $data = Data_Fetcher::get_customer($user_id);
        if ($data) {
            Queue_Manager::add('customer', 'update', $user_id, $data);
        }
    }

    /* ============================================
     * REFUND HOOKS
     * ============================================ */

    /**
     * Refund created - FULL
     */
    public static function on_refund_created($refund_id, $args = []) {
        $data = Data_Fetcher::get_refund($refund_id);
        if ($data) {
            Queue_Manager::add('refund', 'create', $refund_id, $data);
        }
    }

    /**
     * Refund deleted - LIGHT
     */
    public static function on_refund_deleted($refund_id, $order_id) {
        Queue_Manager::add('refund', 'delete', $refund_id, [
            'wp_order_id' => $order_id,
            'deleted' => true,
            'deleted_at' => current_time('mysql')
        ]);
    }
}
