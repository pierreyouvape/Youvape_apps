<?php
/**
 * Hooks Manager - Écoute les événements WooCommerce et les enregistre.
 *
 * Chaque hook fait un INSERT et rien d'autre : aucune lecture de la commande ou du
 * produit ici, le contenu est construit à la livraison. Les hooks sont toujours
 * branchés : la pause suspend la livraison, jamais l'enregistrement.
 */

namespace YouSync;

defined('ABSPATH') || exit;

class Hooks_Manager {

    /**
     * Initialize hooks
     */
    public static function init() {
        // Orders
        add_action('woocommerce_new_order', [__CLASS__, 'on_new_order'], 10, 1);
        add_action('woocommerce_update_order', [__CLASS__, 'on_order_updated'], 10, 1);
        add_action('woocommerce_order_status_changed', [__CLASS__, 'on_order_updated'], 10, 1);
        // Seul hook qui passe APRÈS l'enregistrement des lignes : `woocommerce_update_order`
        // part avant save_items(), une lecture à cet instant verrait les anciennes lignes.
        add_action('woocommerce_after_order_object_save', [__CLASS__, 'on_order_object_saved'], 10, 1);

        // Products
        add_action('woocommerce_new_product', [__CLASS__, 'on_product_created'], 10, 1);
        add_action('woocommerce_new_product_variation', [__CLASS__, 'on_product_created'], 10, 1);
        add_action('woocommerce_update_product', [__CLASS__, 'on_product_saved'], 10, 1);
        add_action('woocommerce_update_product_variation', [__CLASS__, 'on_product_saved'], 10, 1);
        add_action('woocommerce_product_set_stock', [__CLASS__, 'on_stock_changed'], 10, 1);
        add_action('woocommerce_variation_set_stock', [__CLASS__, 'on_stock_changed'], 10, 1);
        // Après la suppression : avant, une lecture trouverait encore le produit.
        add_action('deleted_post', [__CLASS__, 'on_post_deleted'], 10, 2);

        // Customers
        add_action('woocommerce_created_customer', [__CLASS__, 'on_customer_created'], 10, 1);
        add_action('woocommerce_update_customer', [__CLASS__, 'on_customer_updated'], 10, 1);
        add_action('profile_update', [__CLASS__, 'on_customer_updated'], 10, 1);

        // Refunds
        add_action('woocommerce_refund_created', [__CLASS__, 'on_refund_created'], 10, 1);
        add_action('woocommerce_refund_deleted', [__CLASS__, 'on_refund_deleted'], 10, 2);
        // `woocommerce_refund_deleted` ne part que de l'admin : celui-ci couvre tous les chemins.
        add_action('woocommerce_delete_order_refund', [__CLASS__, 'on_refund_deleted'], 10, 1);
    }

    public static function on_new_order($order_id) {
        Queue::add('order', 'create', $order_id);
    }

    public static function on_order_updated($order_id) {
        Queue::add('order', 'update', $order_id);
    }

    public static function on_order_object_saved($order) {
        if ($order instanceof \WC_Order && $order->get_id()) {
            Queue::add('order', 'update', $order->get_id());
        }
    }

    public static function on_product_created($product_id) {
        Queue::add('product', 'create', $product_id);
    }

    public static function on_product_saved($product_id) {
        Queue::add('product', 'update', $product_id);
    }

    public static function on_stock_changed($product) {
        if ($product instanceof \WC_Product) {
            Queue::add('product', 'update', $product->get_id());
        }
    }

    public static function on_post_deleted($post_id, $post = null) {
        if ($post && in_array($post->post_type, ['product', 'product_variation'], true)) {
            Queue::add('product', 'delete', $post_id);
        }
    }

    public static function on_customer_created($customer_id) {
        Queue::add('customer', 'create', $customer_id);
    }

    public static function on_customer_updated($customer_id) {
        Queue::add('customer', 'update', $customer_id);
    }

    public static function on_refund_created($refund_id) {
        $refund = wc_get_order($refund_id);
        Queue::add('refund', 'create', $refund_id, $refund ? $refund->get_parent_id() : 0);
    }

    public static function on_refund_deleted($refund_id, $order_id = 0) {
        Queue::add('refund', 'delete', $refund_id, $order_id);
    }
}
