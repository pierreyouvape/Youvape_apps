<?php
/**
 * Plugin Name: YouSync
 * Plugin URI: https://youvape.fr
 * Description: Synchronisation temps réel WooCommerce vers VPS Youvape
 * Version: 1.0.0
 * Author: Youvape
 * Author URI: https://youvape.fr
 * Text Domain: yousync
 * Requires at least: 5.8
 * Requires PHP: 7.4
 * WC requires at least: 6.0
 * WC tested up to: 8.5
 */

defined('ABSPATH') || exit;

// Define plugin constants
define('YOUSYNC_VERSION', '1.0.0');
define('YOUSYNC_FILE', __FILE__);
define('YOUSYNC_PATH', plugin_dir_path(__FILE__));
define('YOUSYNC_URL', plugin_dir_url(__FILE__));
define('YOUSYNC_BASENAME', plugin_basename(__FILE__));

// Upload directory for queue and logs
define('YOUSYNC_UPLOAD_DIR', wp_upload_dir()['basedir'] . '/yousync/');

// Autoloader
spl_autoload_register(function ($class) {
    $prefix = 'YouSync\\';
    $base_dir = YOUSYNC_PATH . 'includes/';

    $len = strlen($prefix);
    if (strncmp($prefix, $class, $len) !== 0) {
        return;
    }

    $relative_class = substr($class, $len);
    $file = $base_dir . 'class-' . strtolower(str_replace(['_', '\\'], ['-', '/'], $relative_class)) . '.php';

    if (file_exists($file)) {
        require $file;
    }
});

// Add custom cron interval
add_filter('cron_schedules', function($schedules) {
    $settings = get_option('yousync_settings', []);
    $interval = isset($settings['cron_interval']) ? intval($settings['cron_interval']) : 1;

    $schedules['yousync_interval'] = [
        'interval' => $interval * 60,
        'display' => sprintf(__('Every %d Minute(s)', 'yousync'), $interval)
    ];
    return $schedules;
});

// Initialize plugin
add_action('plugins_loaded', function() {
    if (!class_exists('WooCommerce')) {
        add_action('admin_notices', function() {
            echo '<div class="error"><p><strong>YouSync</strong> nécessite WooCommerce pour fonctionner.</p></div>';
        });
        return;
    }

    // Create upload directory if not exists
    if (!file_exists(YOUSYNC_UPLOAD_DIR)) {
        wp_mkdir_p(YOUSYNC_UPLOAD_DIR);
        wp_mkdir_p(YOUSYNC_UPLOAD_DIR . 'logs/');

        // Protect directories
        file_put_contents(YOUSYNC_UPLOAD_DIR . '.htaccess', 'deny from all');
        file_put_contents(YOUSYNC_UPLOAD_DIR . 'index.php', '<?php // Silence is golden');
        file_put_contents(YOUSYNC_UPLOAD_DIR . 'logs/.htaccess', 'deny from all');
        file_put_contents(YOUSYNC_UPLOAD_DIR . 'logs/index.php', '<?php // Silence is golden');
    }

    // Initialize components
    \YouSync\Logger::init();
    \YouSync\Queue_Manager::init();
    \YouSync\Hooks_Manager::init();
    \YouSync\Admin::init();

    // Schedule cron if not exists
    if (!wp_next_scheduled('yousync_process_queue')) {
        wp_schedule_event(time(), 'yousync_interval', 'yousync_process_queue');
    }
}, 20);

// Cron hook: Process queue
add_action('yousync_process_queue', function() {
    $settings = get_option('yousync_settings', []);

    // Check if sync is enabled
    if (empty($settings['enabled'])) {
        return;
    }

    // Check if API is configured
    if (empty($settings['api_url']) || empty($settings['api_token'])) {
        return;
    }

    \YouSync\Sync_Sender::process_queue();
});

// Activation hook
register_activation_hook(__FILE__, function() {
    // Default settings
    $default_settings = [
        'enabled' => false,
        'api_url' => '',
        'api_token' => '',
        'cron_interval' => 1,
        'sync_orders' => true,
        'sync_products' => true,
        'sync_customers' => true,
        'sync_refunds' => true,
        'batch_size' => 50,
        'retry_hours' => 24
    ];

    add_option('yousync_settings', $default_settings);

    // Create upload directories
    $upload_dir = wp_upload_dir()['basedir'] . '/yousync/';
    if (!file_exists($upload_dir)) {
        wp_mkdir_p($upload_dir);
        wp_mkdir_p($upload_dir . 'logs/');
        file_put_contents($upload_dir . '.htaccess', 'deny from all');
        file_put_contents($upload_dir . 'index.php', '<?php // Silence is golden');
        file_put_contents($upload_dir . 'logs/.htaccess', 'deny from all');
        file_put_contents($upload_dir . 'logs/index.php', '<?php // Silence is golden');
    }

    // Initialize empty queue
    if (!file_exists($upload_dir . 'queue.json')) {
        file_put_contents($upload_dir . 'queue.json', json_encode([]));
    }

    // Schedule cron
    if (!wp_next_scheduled('yousync_process_queue')) {
        wp_schedule_event(time(), 'yousync_interval', 'yousync_process_queue');
    }
});

// Deactivation hook
register_deactivation_hook(__FILE__, function() {
    // Remove cron event
    $timestamp = wp_next_scheduled('yousync_process_queue');
    if ($timestamp) {
        wp_unschedule_event($timestamp, 'yousync_process_queue');
    }
});

// Daily cleanup of old logs
add_action('wp_scheduled_delete', function() {
    \YouSync\Logger::cleanup_old_logs(30);
});
