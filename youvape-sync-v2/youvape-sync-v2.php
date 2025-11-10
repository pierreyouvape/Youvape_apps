<?php
/**
 * Plugin Name: Youvape Sync v2
 * Plugin URI: https://youvape.fr
 * Description: Module de synchronisation massive WooCommerce vers VPS Youvape - Refonte complète
 * Version: 2.0.7
 * Author: Youvape
 * Author URI: https://youvape.fr
 * Text Domain: youvape-sync-v2
 * Requires at least: 5.8
 * Requires PHP: 7.4
 * WC requires at least: 6.0
 * WC tested up to: 8.5
 */

defined('ABSPATH') || exit;

// Define plugin constants
define('YOUVAPE_SYNC_V2_VERSION', '2.0.7');
define('YOUVAPE_SYNC_V2_FILE', __FILE__);
define('YOUVAPE_SYNC_V2_PATH', plugin_dir_path(__FILE__));
define('YOUVAPE_SYNC_V2_URL', plugin_dir_url(__FILE__));
define('YOUVAPE_SYNC_V2_BASENAME', plugin_basename(__FILE__));

// Autoloader
spl_autoload_register(function ($class) {
    $prefix = 'Youvape_Sync_V2\\';
    $base_dir = YOUVAPE_SYNC_V2_PATH . 'includes/';

    $len = strlen($prefix);
    if (strncmp($prefix, $class, $len) !== 0) {
        return;
    }

    $relative_class = substr($class, $len);
    $relative_class = str_replace('\\', '/', $relative_class);

    // Convert class name to file name (PSR-4 style)
    $file_parts = explode('/', $relative_class);
    $file_name = 'class-' . strtolower(str_replace('_', '-', array_pop($file_parts))) . '.php';

    if (!empty($file_parts)) {
        $file = $base_dir . strtolower(implode('/', $file_parts)) . '/' . $file_name;
    } else {
        $file = $base_dir . $file_name;
    }

    if (file_exists($file)) {
        require $file;
    }
});

// Add custom cron intervals FIRST (must be registered before any cron scheduling)
add_filter('cron_schedules', function($schedules) {
    $schedules['five_minutes'] = [
        'interval' => 300, // 5 minutes in seconds
        'display' => __('Every 5 Minutes', 'youvape-sync-v2')
    ];
    $schedules['one_minute'] = [
        'interval' => 60, // 1 minute for bulk sync
        'display' => __('Every Minute', 'youvape-sync-v2')
    ];
    return $schedules;
});

// Initialize plugin
add_action('plugins_loaded', function() {
    if (!class_exists('WooCommerce')) {
        add_action('admin_notices', function() {
            echo '<div class="error"><p><strong>Youvape Sync v2</strong> nécessite WooCommerce pour fonctionner.</p></div>';
        });
        return;
    }

    // Bootstrap the plugin
    if (class_exists('Youvape_Sync_V2\\Plugin')) {
        Youvape_Sync_V2\Plugin::instance();
    }

    // Ensure cron is scheduled (auto-repair if missing)
    if (!wp_next_scheduled('youvape_sync_v2_cron')) {
        wp_schedule_event(time(), 'five_minutes', 'youvape_sync_v2_cron');
    }
}, 20);

// Activation hook
register_activation_hook(__FILE__, function() {
    // Initialize default settings
    $default_settings = [
        'api_url' => '',
        'api_token' => '',
        'batch_size' => 500,
        'timeout' => 60,
        'time_restrictions_enabled' => false,
        'time_restrictions_start' => '02:00',
        'time_restrictions_end' => '06:00',
        'queues_enabled' => [
            'customers' => true,
            'products' => true,
            'orders' => true
        ]
    ];

    add_option('youvape_sync_v2_settings', $default_settings);

    // Initialize queue state
    $queue_state = [
        'active_queue' => null,
        'offset' => 0,
        'total_processed' => 0,
        'last_run' => null,
        'is_running' => false,
        'last_error' => null
    ];

    add_option('youvape_sync_v2_queue_state', $queue_state);
});

// Cron hook: Process bulk sync batches
add_action('youvape_sync_v2_cron', function() {
    if (!class_exists('Youvape_Sync_V2\\Bulk_Sync_Manager')) {
        require_once YOUVAPE_SYNC_V2_PATH . 'includes/class-bulk-sync-manager.php';
    }

    $queue_state = get_option('youvape_sync_v2_queue_state', []);
    $status = isset($queue_state['status']) ? $queue_state['status'] : 'idle';

    // Only process if status is 'running'
    if ($status !== 'running') {
        return;
    }

    // Check time restrictions
    $settings = get_option('youvape_sync_v2_settings', []);
    $time_restrictions_enabled = isset($settings['time_restrictions_enabled']) ? $settings['time_restrictions_enabled'] : false;

    if ($time_restrictions_enabled) {
        $start_time = isset($settings['time_restrictions_start']) ? $settings['time_restrictions_start'] : '02:00';
        $end_time = isset($settings['time_restrictions_end']) ? $settings['time_restrictions_end'] : '06:00';
        $current_time = current_time('H:i');

        // Check if current time is within allowed range
        if ($start_time <= $end_time) {
            // Normal range (e.g., 02:00 to 06:00)
            if ($current_time < $start_time || $current_time > $end_time) {
                return; // Outside allowed time range
            }
        } else {
            // Range crosses midnight (e.g., 22:00 to 02:00)
            if ($current_time < $start_time && $current_time > $end_time) {
                return; // Outside allowed time range
            }
        }
    }

    // Process one batch of each type
    $types = ['customers', 'products', 'orders'];

    foreach ($types as $type) {
        $offset = isset($queue_state[$type . '_offset']) ? intval($queue_state[$type . '_offset']) : 0;
        $total = isset($queue_state[$type . '_total']) ? intval($queue_state[$type . '_total']) : 0;

        // Skip if this type is already completed
        if ($total > 0 && $offset >= $total) {
            continue;
        }

        // Process batch
        \Youvape_Sync_V2\Bulk_Sync_Manager::process_batch($type);

        // Refresh queue state after processing
        $queue_state = get_option('youvape_sync_v2_queue_state', []);
    }

    // Check if all types are completed
    $customers_done = ($queue_state['customers_total'] > 0 && $queue_state['customers_offset'] >= $queue_state['customers_total']);
    $products_done = ($queue_state['products_total'] > 0 && $queue_state['products_offset'] >= $queue_state['products_total']);
    $orders_done = ($queue_state['orders_total'] > 0 && $queue_state['orders_offset'] >= $queue_state['orders_total']);

    if ($customers_done && $products_done && $orders_done) {
        // Mark sync as completed
        $queue_state['status'] = 'completed';
        $queue_state['completed_at'] = current_time('mysql');
        update_option('youvape_sync_v2_queue_state', $queue_state);

        if (class_exists('Youvape_Sync_V2\\Plugin')) {
            \Youvape_Sync_V2\Plugin::log('Bulk sync completed successfully!', 'success');
        }
    }
});

// Deactivation hook
register_deactivation_hook(__FILE__, function() {
    // Remove cron event
    $timestamp = wp_next_scheduled('youvape_sync_v2_cron');
    if ($timestamp) {
        wp_unschedule_event($timestamp, 'youvape_sync_v2_cron');
    }
});
