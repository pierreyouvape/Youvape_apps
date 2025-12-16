<?php
/**
 * Bulk Sync Manager - Import historique
 *
 * Gère l'import par batch de toutes les données WooCommerce
 * - Customers
 * - Products (simple + variable avec variations)
 * - Orders (avec items)
 */

namespace Youvape_Sync_V2;

if (!defined('ABSPATH')) {
    exit;
}

class Bulk_Sync_Manager {

    /**
     * Process bulk sync for a specific type
     * Called via WP-Cron or manual trigger
     *
     * @param string $type 'customers', 'products', 'orders'
     * @return array Result with stats
     */
    public static function process_batch($type) {
        $settings = get_option('youvape_sync_v2_settings', []);
        $batch_size = isset($settings['batch_size']) ? intval($settings['batch_size']) : 500;

        return self::process_batch_with_custom_size($type, $batch_size);
    }

    /**
     * Fetch customers batch with RAW SQL
     */
    private static function fetch_customers_batch($offset, $limit) {
        global $wpdb;

        // Fetch users
        $users = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM {$wpdb->users}
            ORDER BY ID ASC
            LIMIT %d OFFSET %d",
            $limit,
            $offset
        ));

        if (empty($users)) {
            return [];
        }

        $batch = [];

        foreach ($users as $user) {
            // Fetch user meta
            $meta_results = $wpdb->get_results($wpdb->prepare(
                "SELECT meta_key, meta_value FROM {$wpdb->usermeta} WHERE user_id = %d",
                $user->ID
            ));

            $meta = [];
            foreach ($meta_results as $m) {
                $meta[$m->meta_key] = $m->meta_value;
            }

            $batch[] = [
                'type' => 'customer',
                'wp_id' => $user->ID,
                'user' => $user,
                'meta' => $meta
            ];
        }

        return $batch;
    }

    /**
     * Fetch products batch with RAW SQL
     */
    private static function fetch_products_batch($offset, $limit) {
        global $wpdb;

        // Fetch products (post_type = 'product' only, NOT variations)
        $products = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM {$wpdb->posts}
            WHERE post_type = 'product'
            AND post_status IN ('publish', 'draft', 'private')
            ORDER BY ID ASC
            LIMIT %d OFFSET %d",
            $limit,
            $offset
        ));

        if (empty($products)) {
            return [];
        }

        $batch = [];

        foreach ($products as $product) {
            // Fetch product meta
            $meta_results = $wpdb->get_results($wpdb->prepare(
                "SELECT meta_key, meta_value FROM {$wpdb->postmeta} WHERE post_id = %d",
                $product->ID
            ));

            $meta = [];
            foreach ($meta_results as $m) {
                $meta[$m->meta_key] = $m->meta_value;
            }

            // Get product type from taxonomy (not meta!)
            $terms = wp_get_object_terms($product->ID, 'product_type', ['fields' => 'names']);
            $product_type = (!empty($terms) && !is_wp_error($terms)) ? $terms[0] : 'simple';

            // Get brand from taxonomy (pwb-brand)
            $brand_name = null;
            $sub_brand_name = null;
            $brand_terms = wp_get_object_terms($product->ID, 'pwb-brand', ['orderby' => 'parent', 'order' => 'ASC']);
            if (!empty($brand_terms) && !is_wp_error($brand_terms)) {
                foreach ($brand_terms as $term) {
                    if ($term->parent == 0) {
                        // C'est une marque parente
                        $brand_name = $term->name;
                    } else {
                        // C'est une sous-marque
                        $sub_brand_name = $term->name;
                        // Si on n'a pas encore la marque parente, la récupérer
                        if ($brand_name === null) {
                            $parent_term = get_term($term->parent, 'pwb-brand');
                            if ($parent_term && !is_wp_error($parent_term)) {
                                $brand_name = $parent_term->name;
                            }
                        }
                    }
                }
            }

            // Get category from taxonomy (product_cat)
            $category_name = null;
            $sub_category_name = null;
            $category_terms = wp_get_object_terms($product->ID, 'product_cat', ['orderby' => 'parent', 'order' => 'ASC']);
            if (!empty($category_terms) && !is_wp_error($category_terms)) {
                foreach ($category_terms as $term) {
                    if ($term->parent == 0) {
                        // C'est une catégorie parente
                        $category_name = $term->name;
                    } else {
                        // C'est une sous-catégorie
                        $sub_category_name = $term->name;
                        // Si on n'a pas encore la catégorie parente, la récupérer
                        if ($category_name === null) {
                            $parent_term = get_term($term->parent, 'product_cat');
                            if ($parent_term && !is_wp_error($parent_term)) {
                                $category_name = $parent_term->name;
                            }
                        }
                    }
                }
            }

            // If variable, fetch variations
            $variations = [];
            if ($product_type === 'variable') {
                $variation_posts = $wpdb->get_results($wpdb->prepare(
                    "SELECT * FROM {$wpdb->posts}
                    WHERE post_parent = %d
                    AND post_type = 'product_variation'
                    ORDER BY ID ASC",
                    $product->ID
                ));

                foreach ($variation_posts as $var_post) {
                    $var_meta_results = $wpdb->get_results($wpdb->prepare(
                        "SELECT meta_key, meta_value FROM {$wpdb->postmeta} WHERE post_id = %d",
                        $var_post->ID
                    ));

                    $var_meta = [];
                    foreach ($var_meta_results as $vm) {
                        $var_meta[$vm->meta_key] = $vm->meta_value;
                    }

                    $variations[] = [
                        'post' => $var_post,
                        'meta' => $var_meta
                    ];
                }
            }

            // Get image URL from thumbnail_id
            $image_url = null;
            if (isset($meta['_thumbnail_id']) && !empty($meta['_thumbnail_id'])) {
                $image_url = wp_get_attachment_url($meta['_thumbnail_id']);
            }

            // DIAGNOSTIC LOG for variations
            $var_count = count($variations);
            if ($product_type === 'variable') {
                Plugin::log("Product {$product->ID} ({$product_type}): {$var_count} variation(s) fetched", 'info');
            }

            $batch[] = [
                'type' => 'product',
                'wp_id' => $product->ID,
                'product_type' => $product_type,
                'post' => $product,
                'meta' => $meta,
                'image_url' => $image_url,
                'brand' => $brand_name,
                'sub_brand' => $sub_brand_name,
                'category' => $category_name,
                'sub_category' => $sub_category_name,
                'variations' => $variations
            ];
        }

        return $batch;
    }

    /**
     * Fetch orders batch with RAW SQL
     */
    private static function fetch_orders_batch($offset, $limit) {
        global $wpdb;

        // Fetch orders (post_type = 'shop_order')
        $orders = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM {$wpdb->posts}
            WHERE post_type = 'shop_order'
            ORDER BY ID ASC
            LIMIT %d OFFSET %d",
            $limit,
            $offset
        ));

        if (empty($orders)) {
            return [];
        }

        $batch = [];

        foreach ($orders as $order) {
            // Fetch order meta
            $meta_results = $wpdb->get_results($wpdb->prepare(
                "SELECT meta_key, meta_value FROM {$wpdb->postmeta} WHERE post_id = %d",
                $order->ID
            ));

            $meta = [];
            foreach ($meta_results as $m) {
                $meta[$m->meta_key] = $m->meta_value;
            }

            // Fetch order items
            $order_items = $wpdb->get_results($wpdb->prepare(
                "SELECT * FROM {$wpdb->prefix}woocommerce_order_items
                WHERE order_id = %d
                ORDER BY order_item_id",
                $order->ID
            ));

            $items_with_meta = [];
            foreach ($order_items as $item) {
                $item_meta_results = $wpdb->get_results($wpdb->prepare(
                    "SELECT meta_key, meta_value FROM {$wpdb->prefix}woocommerce_order_itemmeta
                    WHERE order_item_id = %d",
                    $item->order_item_id
                ));

                $item_meta = [];
                foreach ($item_meta_results as $im) {
                    $item_meta[$im->meta_key] = $im->meta_value;
                }

                $items_with_meta[] = [
                    'item' => $item,
                    'meta' => $item_meta
                ];
            }

            $batch[] = [
                'type' => 'order',
                'wp_id' => $order->ID,
                'post' => $order,
                'meta' => $meta,
                'items' => $items_with_meta
            ];
        }

        return $batch;
    }

    /**
     * Send batch to VPS
     */
    private static function send_batch_to_vps($type, $batch, $offset, $total) {
        $settings = get_option('youvape_sync_v2_settings', []);
        $api_url = isset($settings['api_url']) ? $settings['api_url'] : '';
        $api_token = isset($settings['api_token']) ? $settings['api_token'] : '';

        if (empty($api_url)) {
            return [
                'success' => false,
                'error' => 'API URL not configured'
            ];
        }

        $endpoint = trailingslashit($api_url) . 'sync/bulk';

        $response = wp_remote_post($endpoint, [
            'timeout' => 120, // 2 minutes pour les gros batch
            'headers' => [
                'Content-Type' => 'application/json',
                'Authorization' => 'Bearer ' . $api_token
            ],
            'body' => json_encode([
                'type' => $type,
                'batch' => $batch,
                'offset' => $offset,
                'total' => $total,
                'timestamp' => current_time('mysql')
            ])
        ]);

        if (is_wp_error($response)) {
            return [
                'success' => false,
                'error' => $response->get_error_message()
            ];
        }

        $status_code = wp_remote_retrieve_response_code($response);
        $body = wp_remote_retrieve_body($response);
        $parsed = json_decode($body, true);

        return [
            'success' => $status_code === 200 && isset($parsed['success']) && $parsed['success'],
            'status_code' => $status_code,
            'response' => $parsed,
            'error' => isset($parsed['error']) ? $parsed['error'] : null
        ];
    }

    /**
     * Start full sync - Initialize queue state
     */
    public static function start_full_sync() {
        global $wpdb;

        // Count totals
        $customers_total = $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->users}");
        $products_total = $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = 'product' AND post_status IN ('publish', 'draft', 'private')");
        $orders_total = $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = 'shop_order'");

        $queue_state = [
            'customers_offset' => 0,
            'products_offset' => 0,
            'orders_offset' => 0,
            'customers_total' => intval($customers_total),
            'products_total' => intval($products_total),
            'orders_total' => intval($orders_total),
            'customers_synced' => 0,
            'products_synced' => 0,
            'orders_synced' => 0,
            'status' => 'running',
            'started_at' => current_time('mysql')
        ];

        update_option('youvape_sync_v2_queue_state', $queue_state);

        Plugin::log("Full sync started: {$customers_total} customers, {$products_total} products, {$orders_total} orders");

        return $queue_state;
    }

    /**
     * Pause sync
     */
    public static function pause_sync() {
        $queue_state = get_option('youvape_sync_v2_queue_state', []);
        $queue_state['status'] = 'paused';
        update_option('youvape_sync_v2_queue_state', $queue_state);

        Plugin::log("Sync paused");
    }

    /**
     * Resume sync
     */
    public static function resume_sync() {
        $queue_state = get_option('youvape_sync_v2_queue_state', []);
        $queue_state['status'] = 'running';
        update_option('youvape_sync_v2_queue_state', $queue_state);

        Plugin::log("Sync resumed");
    }

    /**
     * Reset sync (start from scratch)
     */
    public static function reset_sync() {
        delete_option('youvape_sync_v2_queue_state');

        Plugin::log("Sync reset");
    }

    /**
     * Get sync status
     */
    public static function get_status() {
        return get_option('youvape_sync_v2_queue_state', [
            'status' => 'idle'
        ]);
    }

    /**
     * Process multiple batches manually - DATA ONLY (customers + products)
     *
     * @param int $num_batches Number of batches to process per type
     * @param int $batch_size Size of each batch
     * @return array Results with stats
     */
    public static function process_data_batches($num_batches = 10, $batch_size = 100) {
        global $wpdb;
        $queue_state = get_option('youvape_sync_v2_queue_state', []);
        $status = isset($queue_state['status']) ? $queue_state['status'] : 'idle';

        if ($status !== 'running') {
            return [
                'success' => false,
                'error' => 'Sync is not running. Please start the sync first.'
            ];
        }

        // Ensure totals are calculated if missing (needed for progress bars)
        if (!isset($queue_state['customers_total']) || !isset($queue_state['products_total'])) {
            $queue_state['customers_total'] = intval($wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->users}"));
            $queue_state['products_total'] = intval($wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = 'product' AND post_status IN ('publish', 'draft', 'private')"));
            update_option('youvape_sync_v2_queue_state', $queue_state);
        }

        $types = ['customers', 'products']; // Only customers and products
        $results = [];
        $total_processed = 0;

        Plugin::log("Manual DATA batch processing started: {$num_batches} batches × {$batch_size} items (customers + products only)");

        foreach ($types as $type) {
            $results[$type] = [
                'batches_processed' => 0,
                'items_processed' => 0,
                'errors' => []
            ];

            for ($i = 0; $i < $num_batches; $i++) {
                // Refresh queue state
                $queue_state = get_option('youvape_sync_v2_queue_state', []);
                $offset = isset($queue_state[$type . '_offset']) ? intval($queue_state[$type . '_offset']) : 0;
                $total = isset($queue_state[$type . '_total']) ? intval($queue_state[$type . '_total']) : 0;

                // Check if this type is completed
                if ($total > 0 && $offset >= $total) {
                    break;
                }

                // Process one batch with custom size
                $batch_result = self::process_batch_with_custom_size($type, $batch_size);

                if ($batch_result['success']) {
                    $results[$type]['batches_processed']++;
                    $results[$type]['items_processed'] += $batch_result['count'];
                    $total_processed += $batch_result['count'];
                } else {
                    $results[$type]['errors'][] = $batch_result['error'] ?? 'Unknown error';
                    break; // Stop processing this type on error
                }
            }
        }

        Plugin::log("Manual DATA batch processing completed: {$total_processed} items processed");

        return [
            'success' => true,
            'total_processed' => $total_processed,
            'results' => $results,
            'queue_state' => get_option('youvape_sync_v2_queue_state', [])
        ];
    }

    /**
     * Process multiple batches manually - CUSTOMERS ONLY
     *
     * @param int $num_batches Number of batches to process
     * @param int $batch_size Size of each batch
     * @return array Results with stats
     */
    public static function process_customers_batches($num_batches = 10, $batch_size = 100) {
        global $wpdb;
        $queue_state = get_option('youvape_sync_v2_queue_state', []);
        $status = isset($queue_state['status']) ? $queue_state['status'] : 'idle';

        if ($status !== 'running') {
            return [
                'success' => false,
                'error' => 'Sync is not running. Please start the sync first.'
            ];
        }

        // Ensure totals are calculated if missing (needed for progress bars)
        if (!isset($queue_state['customers_total'])) {
            $queue_state['customers_total'] = intval($wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->users}"));
            update_option('youvape_sync_v2_queue_state', $queue_state);
        }

        $results = [
            'customers' => [
                'batches_processed' => 0,
                'items_processed' => 0,
                'errors' => []
            ]
        ];
        $total_processed = 0;

        Plugin::log("Manual CUSTOMERS batch processing started: {$num_batches} batches × {$batch_size} items");

        for ($i = 0; $i < $num_batches; $i++) {
            // Refresh queue state
            $queue_state = get_option('youvape_sync_v2_queue_state', []);
            $offset = isset($queue_state['customers_offset']) ? intval($queue_state['customers_offset']) : 0;
            $total = isset($queue_state['customers_total']) ? intval($queue_state['customers_total']) : 0;

            // Check if completed
            if ($total > 0 && $offset >= $total) {
                break;
            }

            // Process one batch with custom size
            $batch_result = self::process_batch_with_custom_size('customers', $batch_size);

            if ($batch_result['success']) {
                $results['customers']['batches_processed']++;
                $results['customers']['items_processed'] += $batch_result['count'];
                $total_processed += $batch_result['count'];
            } else {
                $results['customers']['errors'][] = $batch_result['error'] ?? 'Unknown error';
                break; // Stop on error
            }
        }

        Plugin::log("Manual CUSTOMERS batch processing completed: {$total_processed} items processed");

        return [
            'success' => true,
            'total_processed' => $total_processed,
            'results' => $results,
            'queue_state' => get_option('youvape_sync_v2_queue_state', [])
        ];
    }

    /**
     * Process multiple batches manually - PRODUCTS ONLY
     *
     * @param int $num_batches Number of batches to process
     * @param int $batch_size Size of each batch
     * @return array Results with stats
     */
    public static function process_products_batches($num_batches = 10, $batch_size = 100) {
        global $wpdb;
        $queue_state = get_option('youvape_sync_v2_queue_state', []);
        $status = isset($queue_state['status']) ? $queue_state['status'] : 'idle';

        if ($status !== 'running') {
            return [
                'success' => false,
                'error' => 'Sync is not running. Please start the sync first.'
            ];
        }

        // Ensure totals are calculated if missing (needed for progress bars)
        if (!isset($queue_state['products_total'])) {
            $queue_state['products_total'] = intval($wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = 'product' AND post_status IN ('publish', 'draft', 'private')"));
            update_option('youvape_sync_v2_queue_state', $queue_state);
        }

        $results = [
            'products' => [
                'batches_processed' => 0,
                'items_processed' => 0,
                'errors' => []
            ]
        ];
        $total_processed = 0;

        Plugin::log("Manual PRODUCTS batch processing started: {$num_batches} batches × {$batch_size} items");

        for ($i = 0; $i < $num_batches; $i++) {
            // Refresh queue state
            $queue_state = get_option('youvape_sync_v2_queue_state', []);
            $offset = isset($queue_state['products_offset']) ? intval($queue_state['products_offset']) : 0;
            $total = isset($queue_state['products_total']) ? intval($queue_state['products_total']) : 0;

            // Check if completed
            if ($total > 0 && $offset >= $total) {
                break;
            }

            // Process one batch with custom size
            $batch_result = self::process_batch_with_custom_size('products', $batch_size);

            if ($batch_result['success']) {
                $results['products']['batches_processed']++;
                $results['products']['items_processed'] += $batch_result['count'];
                $total_processed += $batch_result['count'];
            } else {
                $results['products']['errors'][] = $batch_result['error'] ?? 'Unknown error';
                break; // Stop on error
            }
        }

        Plugin::log("Manual PRODUCTS batch processing completed: {$total_processed} items processed");

        return [
            'success' => true,
            'total_processed' => $total_processed,
            'results' => $results,
            'queue_state' => get_option('youvape_sync_v2_queue_state', [])
        ];
    }

    /**
     * Process multiple batches manually - ORDERS ONLY
     *
     * @param int $num_batches Number of batches to process
     * @param int $batch_size Size of each batch
     * @return array Results with stats
     */
    public static function process_orders_batches($num_batches = 10, $batch_size = 100) {
        global $wpdb;
        $queue_state = get_option('youvape_sync_v2_queue_state', []);
        $status = isset($queue_state['status']) ? $queue_state['status'] : 'idle';

        if ($status !== 'running') {
            return [
                'success' => false,
                'error' => 'Sync is not running. Please start the sync first.'
            ];
        }

        // Ensure totals are calculated if missing (needed for progress bars)
        if (!isset($queue_state['orders_total'])) {
            $queue_state['orders_total'] = intval($wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = 'shop_order'"));
            update_option('youvape_sync_v2_queue_state', $queue_state);
        }

        $results = [
            'orders' => [
                'batches_processed' => 0,
                'items_processed' => 0,
                'errors' => []
            ]
        ];
        $total_processed = 0;

        Plugin::log("Manual ORDERS batch processing started: {$num_batches} batches × {$batch_size} items");

        for ($i = 0; $i < $num_batches; $i++) {
            // Refresh queue state
            $queue_state = get_option('youvape_sync_v2_queue_state', []);
            $offset = isset($queue_state['orders_offset']) ? intval($queue_state['orders_offset']) : 0;
            $total = isset($queue_state['orders_total']) ? intval($queue_state['orders_total']) : 0;

            // Check if completed
            if ($total > 0 && $offset >= $total) {
                break;
            }

            // Process one batch with custom size
            $batch_result = self::process_batch_with_custom_size('orders', $batch_size);

            if ($batch_result['success']) {
                $results['orders']['batches_processed']++;
                $results['orders']['items_processed'] += $batch_result['count'];
                $total_processed += $batch_result['count'];
            } else {
                $results['orders']['errors'][] = $batch_result['error'] ?? 'Unknown error';
                break; // Stop on error
            }
        }

        Plugin::log("Manual ORDERS batch processing completed: {$total_processed} items processed");

        return [
            'success' => true,
            'total_processed' => $total_processed,
            'results' => $results,
            'queue_state' => get_option('youvape_sync_v2_queue_state', [])
        ];
    }

    /**
     * Process multiple batches manually (AJAX trigger) - ALL TYPES
     * DEPRECATED: Use process_data_batches() or process_orders_batches() instead
     *
     * @param int $num_batches Number of batches to process per type
     * @param int $batch_size Size of each batch
     * @return array Results with stats
     */
    public static function process_multiple_batches($num_batches = 10, $batch_size = 100) {
        $queue_state = get_option('youvape_sync_v2_queue_state', []);
        $status = isset($queue_state['status']) ? $queue_state['status'] : 'idle';

        if ($status !== 'running') {
            return [
                'success' => false,
                'error' => 'Sync is not running. Please start the sync first.'
            ];
        }

        $types = ['customers', 'products', 'orders'];
        $results = [];
        $total_processed = 0;

        Plugin::log("Manual batch processing started: {$num_batches} batches × {$batch_size} items");

        foreach ($types as $type) {
            $results[$type] = [
                'batches_processed' => 0,
                'items_processed' => 0,
                'errors' => []
            ];

            for ($i = 0; $i < $num_batches; $i++) {
                // Refresh queue state
                $queue_state = get_option('youvape_sync_v2_queue_state', []);
                $offset = isset($queue_state[$type . '_offset']) ? intval($queue_state[$type . '_offset']) : 0;
                $total = isset($queue_state[$type . '_total']) ? intval($queue_state[$type . '_total']) : 0;

                // Check if this type is completed
                if ($total > 0 && $offset >= $total) {
                    break;
                }

                // Process one batch with custom size
                $batch_result = self::process_batch_with_custom_size($type, $batch_size);

                if ($batch_result['success']) {
                    $results[$type]['batches_processed']++;
                    $results[$type]['items_processed'] += $batch_result['count'];
                    $total_processed += $batch_result['count'];
                } else {
                    $results[$type]['errors'][] = $batch_result['error'] ?? 'Unknown error';
                    break; // Stop processing this type on error
                }
            }
        }

        Plugin::log("Manual batch processing completed: {$total_processed} items processed");

        return [
            'success' => true,
            'total_processed' => $total_processed,
            'results' => $results,
            'queue_state' => get_option('youvape_sync_v2_queue_state', [])
        ];
    }

    /**
     * Process batch with custom size (for manual processing)
     */
    private static function process_batch_with_custom_size($type, $batch_size) {
        global $wpdb;

        $queue_state = get_option('youvape_sync_v2_queue_state', []);

        if ($queue_state['status'] === 'paused') {
            Plugin::log('Bulk sync is paused. Skipping batch.');
            return ['success' => false, 'error' => 'Sync is paused'];
        }

        $offset = isset($queue_state[$type . '_offset']) ? intval($queue_state[$type . '_offset']) : 0;
        $total = isset($queue_state[$type . '_total']) ? intval($queue_state[$type . '_total']) : 0;

        Plugin::log("Processing {$type} batch: offset={$offset}, batch_size={$batch_size}");

        // Fetch data based on type
        $batch_data = [];

        switch ($type) {
            case 'customers':
                $batch_data = self::fetch_customers_batch($offset, $batch_size);
                break;

            case 'products':
                $batch_data = self::fetch_products_batch($offset, $batch_size);
                break;

            case 'orders':
                $batch_data = self::fetch_orders_batch($offset, $batch_size);
                break;

            default:
                return ['success' => false, 'error' => 'Invalid type'];
        }

        if (empty($batch_data)) {
            Plugin::log("{$type} batch is empty. Sync completed for this type.");

            // Mark this type as completed
            $queue_state[$type . '_offset'] = 0;
            update_option('youvape_sync_v2_queue_state', $queue_state);

            return [
                'success' => true,
                'message' => "{$type} sync completed",
                'count' => 0
            ];
        }

        // Send to VPS
        $vps_result = self::send_batch_to_vps($type, $batch_data, $offset, $total);

        if (!$vps_result['success']) {
            Plugin::log("VPS sync failed for {$type}: " . $vps_result['error']);
            return $vps_result;
        }

        // Update offset
        $queue_state[$type . '_offset'] = $offset + count($batch_data);
        $queue_state[$type . '_synced'] = ($queue_state[$type . '_synced'] ?? 0) + count($batch_data);
        update_option('youvape_sync_v2_queue_state', $queue_state);

        Plugin::log("{$type} batch synced: " . count($batch_data) . " items");

        return [
            'success' => true,
            'count' => count($batch_data),
            'offset' => $queue_state[$type . '_offset'],
            'total' => $total,
            'vps_response' => $vps_result
        ];
    }
}
