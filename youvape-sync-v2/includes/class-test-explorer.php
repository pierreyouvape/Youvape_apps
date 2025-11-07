<?php
/**
 * Test Explorer - Phase 0
 * Fetches one item of each type (RAW data only) and sends to VPS
 */

namespace Youvape_Sync_V2;

defined('ABSPATH') || exit;

class Test_Explorer {

    /**
     * Run the complete test
     */
    public function run_test($product_id = null) {
        global $wpdb;

        $results = [
            'success' => true,
            'timestamp' => current_time('mysql'),
            'customer' => null,
            'product' => null,
            'order' => null,
            'errors' => []
        ];

        try {
            // Test Customer
            $results['customer'] = $this->test_customer();

            // Test Product (with optional product_id)
            $results['product'] = $this->test_product($product_id);

            // Test Order
            $results['order'] = $this->test_order();

            // Send RAW data to VPS test endpoint
            $vps_response = $this->send_to_vps_test([
                'customer' => $results['customer'],
                'product' => $results['product'],
                'order' => $results['order']
            ]);

            $results['vps_response'] = $vps_response;

        } catch (\Exception $e) {
            $results['success'] = false;
            $results['errors'][] = $e->getMessage();

            Plugin::log('Test Explorer failed: ' . $e->getMessage(), 'error');
        }

        return $results;
    }

    /**
     * Test one customer (RAW only)
     */
    private function test_customer() {
        global $wpdb;

        // Fetch one user via SQL
        $user = $wpdb->get_row("
            SELECT * FROM {$wpdb->users}
            WHERE ID > 0
            ORDER BY ID DESC
            LIMIT 1
        ");

        if (!$user) {
            throw new \Exception('No customer found in database');
        }

        // Fetch user meta
        $user_meta_results = $wpdb->get_results($wpdb->prepare(
            "SELECT meta_key, meta_value FROM {$wpdb->usermeta} WHERE user_id = %d",
            $user->ID
        ));

        $user_meta = [];
        foreach ($user_meta_results as $meta) {
            $user_meta[$meta->meta_key] = $meta->meta_value;
        }

        return [
            'type' => 'customer',
            'wp_id' => $user->ID,
            'user' => $user,
            'meta' => $user_meta
        ];
    }

    /**
     * Test one product (RAW only)
     */
    private function test_product($product_id = null) {
        global $wpdb;

        if ($product_id) {
            // Fetch specific product by ID
            $product = $wpdb->get_row($wpdb->prepare("
                SELECT * FROM {$wpdb->posts}
                WHERE ID = %d
                AND post_type = 'product'
                AND post_status = 'publish'
            ", $product_id));

            if (!$product) {
                throw new \Exception("Product ID {$product_id} not found or not published");
            }
        } else {
            // Fetch last product
            $product = $wpdb->get_row("
                SELECT * FROM {$wpdb->posts}
                WHERE post_type = 'product'
                AND post_status = 'publish'
                ORDER BY ID DESC
                LIMIT 1
            ");

            if (!$product) {
                throw new \Exception('No product found in database');
            }
        }

        // Fetch product meta
        $product_meta_results = $wpdb->get_results($wpdb->prepare(
            "SELECT meta_key, meta_value FROM {$wpdb->postmeta} WHERE post_id = %d",
            $product->ID
        ));

        $product_meta = [];
        foreach ($product_meta_results as $meta) {
            $product_meta[$meta->meta_key] = $meta->meta_value;
        }

        // Get product type
        $type_term = $wpdb->get_var($wpdb->prepare("
            SELECT t.name FROM {$wpdb->terms} t
            INNER JOIN {$wpdb->term_taxonomy} tt ON t.term_id = tt.term_id
            INNER JOIN {$wpdb->term_relationships} tr ON tt.term_taxonomy_id = tr.term_taxonomy_id
            WHERE tt.taxonomy = 'product_type' AND tr.object_id = %d
            LIMIT 1
        ", $product->ID));

        $product_type = $type_term ? $type_term : 'simple';

        // Get variations if variable product
        $variations = [];
        if ($product_type === 'variable') {
            $variation_posts = $wpdb->get_results($wpdb->prepare("
                SELECT * FROM {$wpdb->posts}
                WHERE post_type = 'product_variation'
                AND post_parent = %d
                AND post_status = 'publish'
            ", $product->ID));

            foreach ($variation_posts as $var_post) {
                // Fetch variation meta
                $var_meta_results = $wpdb->get_results($wpdb->prepare(
                    "SELECT meta_key, meta_value FROM {$wpdb->postmeta} WHERE post_id = %d",
                    $var_post->ID
                ));

                $var_meta = [];
                foreach ($var_meta_results as $meta) {
                    $var_meta[$meta->meta_key] = $meta->meta_value;
                }

                $variations[] = [
                    'post' => $var_post,
                    'meta' => $var_meta
                ];
            }
        }

        return [
            'type' => 'product',
            'wp_id' => $product->ID,
            'product_type' => $product_type,
            'post' => $product,
            'meta' => $product_meta,
            'variations' => $variations
        ];
    }

    /**
     * Test one order (RAW only)
     */
    private function test_order() {
        global $wpdb;

        // Fetch one order via SQL
        $order = $wpdb->get_row("
            SELECT * FROM {$wpdb->posts}
            WHERE post_type = 'shop_order'
            ORDER BY ID DESC
            LIMIT 1
        ");

        if (!$order) {
            throw new \Exception('No order found in database');
        }

        // Fetch order meta
        $order_meta_results = $wpdb->get_results($wpdb->prepare(
            "SELECT meta_key, meta_value FROM {$wpdb->postmeta} WHERE post_id = %d",
            $order->ID
        ));

        $order_meta = [];
        foreach ($order_meta_results as $meta) {
            $order_meta[$meta->meta_key] = $meta->meta_value;
        }

        // Fetch order items
        $order_items = $wpdb->get_results($wpdb->prepare("
            SELECT * FROM {$wpdb->prefix}woocommerce_order_items
            WHERE order_id = %d
            ORDER BY order_item_id
        ", $order->ID));

        $items_with_meta = [];
        foreach ($order_items as $item) {
            $item_meta_results = $wpdb->get_results($wpdb->prepare(
                "SELECT meta_key, meta_value FROM {$wpdb->prefix}woocommerce_order_itemmeta
                WHERE order_item_id = %d",
                $item->order_item_id
            ));

            $item_meta = [];
            foreach ($item_meta_results as $meta) {
                $item_meta[$meta->meta_key] = $meta->meta_value;
            }

            $items_with_meta[] = [
                'item' => $item,
                'meta' => $item_meta
            ];
        }

        return [
            'type' => 'order',
            'wp_id' => $order->ID,
            'post' => $order,
            'meta' => $order_meta,
            'items' => $items_with_meta
        ];
    }

    /**
     * Send test data to VPS
     */
    private function send_to_vps_test($test_data) {
        $settings = get_option('youvape_sync_v2_settings', []);
        $api_url = isset($settings['api_url']) ? $settings['api_url'] : '';
        $api_token = isset($settings['api_token']) ? $settings['api_token'] : '';

        if (empty($api_url)) {
            return [
                'success' => false,
                'error' => 'API URL not configured in settings'
            ];
        }

        $endpoint = trailingslashit($api_url) . 'sync/test';

        $response = wp_remote_post($endpoint, [
            'timeout' => 60,
            'headers' => [
                'Content-Type' => 'application/json',
                'Authorization' => 'Bearer ' . $api_token
            ],
            'body' => json_encode($test_data)
        ]);

        if (is_wp_error($response)) {
            return [
                'success' => false,
                'error' => $response->get_error_message()
            ];
        }

        $status_code = wp_remote_retrieve_response_code($response);
        $body = wp_remote_retrieve_body($response);
        $parsed_body = json_decode($body, true);

        return [
            'success' => $status_code >= 200 && $status_code < 300,
            'status_code' => $status_code,
            'raw_response' => $body,
            'parsed_response' => $parsed_body
        ];
    }
}
