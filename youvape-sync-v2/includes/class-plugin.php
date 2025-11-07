<?php
/**
 * Main Plugin Bootstrap Class
 */

namespace Youvape_Sync_V2;

defined('ABSPATH') || exit;

class Plugin {

    private static $instance = null;

    /**
     * Get singleton instance
     */
    public static function instance() {
        if (null === self::$instance) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Constructor
     */
    private function __construct() {
        $this->init_hooks();
    }

    /**
     * Initialize hooks
     */
    private function init_hooks() {
        // Admin initialization
        if (is_admin()) {
            add_action('admin_menu', [$this, 'register_admin_menu']);
            add_action('admin_enqueue_scripts', [$this, 'enqueue_admin_assets']);
        }

        // REST API
        add_action('rest_api_init', [$this, 'register_rest_routes']);

        // Cron hook (will be used in Phase 1)
        // add_action('youvape_sync_v2_cron', [$this, 'run_cron_sync']);
    }

    /**
     * Register admin menu
     */
    public function register_admin_menu() {
        add_menu_page(
            __('Youvape Sync', 'youvape-sync-v2'),
            __('Youvape Sync', 'youvape-sync-v2'),
            'manage_options',
            'youvape-sync-v2',
            [$this, 'render_admin_page'],
            'dashicons-update',
            56
        );

        add_submenu_page(
            'youvape-sync-v2',
            __('Settings', 'youvape-sync-v2'),
            __('Settings', 'youvape-sync-v2'),
            'manage_options',
            'youvape-sync-v2-settings',
            [$this, 'render_settings_page']
        );
    }

    /**
     * Enqueue admin assets
     */
    public function enqueue_admin_assets($hook) {
        if (strpos($hook, 'youvape-sync-v2') === false) {
            return;
        }

        wp_enqueue_style(
            'youvape-sync-v2-admin',
            YOUVAPE_SYNC_V2_URL . 'admin/css/admin.css',
            [],
            YOUVAPE_SYNC_V2_VERSION
        );

        wp_enqueue_script(
            'youvape-sync-v2-admin',
            YOUVAPE_SYNC_V2_URL . 'admin/js/admin.js',
            ['jquery'],
            YOUVAPE_SYNC_V2_VERSION,
            true
        );

        wp_localize_script('youvape-sync-v2-admin', 'youvapeSyncV2', [
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'restUrl' => rest_url('youvape-sync/v1/'),
            'nonce' => wp_create_nonce('wp_rest'),
            'i18n' => [
                'testing' => __('Testing...', 'youvape-sync-v2'),
                'testComplete' => __('Test complete', 'youvape-sync-v2'),
                'error' => __('Error', 'youvape-sync-v2'),
            ]
        ]);
    }

    /**
     * Render main admin page
     */
    public function render_admin_page() {
        if (!class_exists('Youvape_Sync_V2\\Admin\\Admin_Page')) {
            require_once YOUVAPE_SYNC_V2_PATH . 'includes/admin/class-admin-page.php';
        }
        $admin_page = new Admin\Admin_Page();
        $admin_page->render();
    }

    /**
     * Render settings page
     */
    public function render_settings_page() {
        if (!class_exists('Youvape_Sync_V2\\Admin\\Settings')) {
            require_once YOUVAPE_SYNC_V2_PATH . 'includes/admin/class-settings.php';
        }
        $settings = new Admin\Settings();
        $settings->render();
    }

    /**
     * Register REST API routes
     */
    public function register_rest_routes() {
        // Status endpoint
        register_rest_route('youvape-sync/v1', '/status', [
            'methods' => 'GET',
            'callback' => [$this, 'rest_get_status'],
            'permission_callback' => function() {
                return current_user_can('manage_options');
            }
        ]);

        // Test endpoint
        register_rest_route('youvape-sync/v1', '/test', [
            'methods' => 'POST',
            'callback' => [$this, 'rest_run_test'],
            'permission_callback' => function() {
                return current_user_can('manage_options');
            }
        ]);

        // Logs endpoint
        register_rest_route('youvape-sync/v1', '/logs', [
            'methods' => 'GET',
            'callback' => [$this, 'rest_get_logs'],
            'permission_callback' => function() {
                return current_user_can('manage_options');
            }
        ]);

        // Force sync endpoint (for Phase 1)
        register_rest_route('youvape-sync/v1', '/force-sync', [
            'methods' => 'POST',
            'callback' => [$this, 'rest_force_sync'],
            'permission_callback' => function() {
                return current_user_can('manage_options');
            }
        ]);
    }

    /**
     * REST: Get status
     */
    public function rest_get_status($request) {
        $queue_state = get_option('youvape_sync_v2_queue_state', []);

        global $wpdb;

        // Count totals
        $total_customers = $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->users}");
        $total_products = $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = 'product' AND post_status = 'publish'");
        $total_orders = $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = 'shop_order'");

        return [
            'success' => true,
            'data' => [
                'queue_state' => $queue_state,
                'totals' => [
                    'customers' => (int) $total_customers,
                    'products' => (int) $total_products,
                    'orders' => (int) $total_orders
                ]
            ]
        ];
    }

    /**
     * REST: Run test (Phase 0)
     */
    public function rest_run_test($request) {
        if (!class_exists('Youvape_Sync_V2\\Test_Explorer')) {
            require_once YOUVAPE_SYNC_V2_PATH . 'includes/class-test-explorer.php';
        }

        $product_id = $request->get_param('product_id');

        $explorer = new Test_Explorer();
        return $explorer->run_test($product_id);
    }

    /**
     * REST: Get logs
     */
    public function rest_get_logs($request) {
        $logs = get_option('youvape_sync_v2_logs', []);
        return [
            'success' => true,
            'data' => array_slice(array_reverse($logs), 0, 100) // Last 100 logs
        ];
    }

    /**
     * REST: Force sync (Phase 1)
     */
    public function rest_force_sync($request) {
        // Will be implemented in Phase 1
        return [
            'success' => false,
            'message' => 'Force sync not yet implemented (Phase 1)'
        ];
    }

    /**
     * Add log entry
     */
    public static function log($message, $level = 'info', $context = []) {
        $logs = get_option('youvape_sync_v2_logs', []);

        $log_entry = [
            'timestamp' => current_time('mysql'),
            'level' => $level,
            'message' => $message,
            'context' => $context
        ];

        $logs[] = $log_entry;

        // Keep only last 1000 logs
        if (count($logs) > 1000) {
            $logs = array_slice($logs, -1000);
        }

        update_option('youvape_sync_v2_logs', $logs);

        // Also write to file for debugging
        $log_file = YOUVAPE_SYNC_V2_PATH . 'debug.log';
        $log_line = sprintf(
            "[%s] [%s] %s %s\n",
            $log_entry['timestamp'],
            strtoupper($level),
            $message,
            !empty($context) ? json_encode($context) : ''
        );
        error_log($log_line, 3, $log_file);
    }
}
