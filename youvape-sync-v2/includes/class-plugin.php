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

        // Bulk Sync: Start
        register_rest_route('youvape-sync/v1', '/bulk/start', [
            'methods' => 'POST',
            'callback' => [$this, 'rest_bulk_start'],
            'permission_callback' => function() {
                return current_user_can('manage_options');
            }
        ]);

        // Bulk Sync: Pause
        register_rest_route('youvape-sync/v1', '/bulk/pause', [
            'methods' => 'POST',
            'callback' => [$this, 'rest_bulk_pause'],
            'permission_callback' => function() {
                return current_user_can('manage_options');
            }
        ]);

        // Bulk Sync: Resume
        register_rest_route('youvape-sync/v1', '/bulk/resume', [
            'methods' => 'POST',
            'callback' => [$this, 'rest_bulk_resume'],
            'permission_callback' => function() {
                return current_user_can('manage_options');
            }
        ]);

        // Bulk Sync: Reset
        register_rest_route('youvape-sync/v1', '/bulk/reset', [
            'methods' => 'POST',
            'callback' => [$this, 'rest_bulk_reset'],
            'permission_callback' => function() {
                return current_user_can('manage_options');
            }
        ]);

        // Bulk Sync: Process batch (manual trigger)
        register_rest_route('youvape-sync/v1', '/bulk/process', [
            'methods' => 'POST',
            'callback' => [$this, 'rest_bulk_process'],
            'permission_callback' => function() {
                return current_user_can('manage_options');
            }
        ]);

        // Bulk Sync: Process multiple batches manually
        register_rest_route('youvape-sync/v1', '/bulk/process-manual', [
            'methods' => 'POST',
            'callback' => [$this, 'rest_bulk_process_manual'],
            'permission_callback' => function() {
                return current_user_can('manage_options');
            }
        ]);

        // Bulk Sync: Process DATA batches (customers + products)
        register_rest_route('youvape-sync/v1', '/bulk/process-data', [
            'methods' => 'POST',
            'callback' => [$this, 'rest_bulk_process_data'],
            'permission_callback' => function() {
                return current_user_can('manage_options');
            }
        ]);

        // Bulk Sync: Process ORDERS batches
        register_rest_route('youvape-sync/v1', '/bulk/process-orders', [
            'methods' => 'POST',
            'callback' => [$this, 'rest_bulk_process_orders'],
            'permission_callback' => function() {
                return current_user_can('manage_options');
            }
        ]);

        // Bulk Sync: Process CUSTOMERS batches only
        register_rest_route('youvape-sync/v1', '/bulk/process-customers', [
            'methods' => 'POST',
            'callback' => [$this, 'rest_bulk_process_customers'],
            'permission_callback' => function() {
                return current_user_can('manage_options');
            }
        ]);

        // Bulk Sync: Process PRODUCTS batches only
        register_rest_route('youvape-sync/v1', '/bulk/process-products', [
            'methods' => 'POST',
            'callback' => [$this, 'rest_bulk_process_products'],
            'permission_callback' => function() {
                return current_user_can('manage_options');
            }
        ]);

        // Bulk Sync: Process REFUNDS batches only
        register_rest_route('youvape-sync/v1', '/bulk/process-refunds', [
            'methods' => 'POST',
            'callback' => [$this, 'rest_bulk_process_refunds'],
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
        $total_refunds = $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = 'shop_order_refund'");

        return [
            'success' => true,
            'data' => [
                'queue_state' => $queue_state,
                'totals' => [
                    'customers' => (int) $total_customers,
                    'products' => (int) $total_products,
                    'orders' => (int) $total_orders,
                    'refunds' => (int) $total_refunds
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
     * REST: Bulk Sync - Start
     */
    public function rest_bulk_start($request) {
        if (!class_exists('Youvape_Sync_V2\\Bulk_Sync_Manager')) {
            require_once YOUVAPE_SYNC_V2_PATH . 'includes/class-bulk-sync-manager.php';
        }

        $state = \Youvape_Sync_V2\Bulk_Sync_Manager::start_full_sync();

        return [
            'success' => true,
            'message' => 'Bulk sync started',
            'state' => $state
        ];
    }

    /**
     * REST: Bulk Sync - Pause
     */
    public function rest_bulk_pause($request) {
        if (!class_exists('Youvape_Sync_V2\\Bulk_Sync_Manager')) {
            require_once YOUVAPE_SYNC_V2_PATH . 'includes/class-bulk-sync-manager.php';
        }

        \Youvape_Sync_V2\Bulk_Sync_Manager::pause_sync();

        return [
            'success' => true,
            'message' => 'Bulk sync paused'
        ];
    }

    /**
     * REST: Bulk Sync - Resume
     */
    public function rest_bulk_resume($request) {
        if (!class_exists('Youvape_Sync_V2\\Bulk_Sync_Manager')) {
            require_once YOUVAPE_SYNC_V2_PATH . 'includes/class-bulk-sync-manager.php';
        }

        \Youvape_Sync_V2\Bulk_Sync_Manager::resume_sync();

        return [
            'success' => true,
            'message' => 'Bulk sync resumed'
        ];
    }

    /**
     * REST: Bulk Sync - Reset
     */
    public function rest_bulk_reset($request) {
        if (!class_exists('Youvape_Sync_V2\\Bulk_Sync_Manager')) {
            require_once YOUVAPE_SYNC_V2_PATH . 'includes/class-bulk-sync-manager.php';
        }

        \Youvape_Sync_V2\Bulk_Sync_Manager::reset_sync();

        return [
            'success' => true,
            'message' => 'Bulk sync reset'
        ];
    }

    /**
     * REST: Bulk Sync - Process batch manually
     */
    public function rest_bulk_process($request) {
        if (!class_exists('Youvape_Sync_V2\\Bulk_Sync_Manager')) {
            require_once YOUVAPE_SYNC_V2_PATH . 'includes/class-bulk-sync-manager.php';
        }

        $type = $request->get_param('type'); // 'customers', 'products', 'orders'

        if (!in_array($type, ['customers', 'products', 'orders'])) {
            return [
                'success' => false,
                'error' => 'Invalid type. Must be: customers, products, or orders'
            ];
        }

        $result = \Youvape_Sync_V2\Bulk_Sync_Manager::process_batch($type);

        return $result;
    }

    /**
     * REST: Bulk Sync - Process multiple batches manually (ALL TYPES - DEPRECATED)
     */
    public function rest_bulk_process_manual($request) {
        if (!class_exists('Youvape_Sync_V2\\Bulk_Sync_Manager')) {
            require_once YOUVAPE_SYNC_V2_PATH . 'includes/class-bulk-sync-manager.php';
        }

        $num_batches = $request->get_param('num_batches') ?: 10;
        $batch_size = $request->get_param('batch_size') ?: 100;

        $result = \Youvape_Sync_V2\Bulk_Sync_Manager::process_multiple_batches($num_batches, $batch_size);

        return $result;
    }

    /**
     * REST: Bulk Sync - Process DATA batches (customers + products)
     */
    public function rest_bulk_process_data($request) {
        if (!class_exists('Youvape_Sync_V2\\Bulk_Sync_Manager')) {
            require_once YOUVAPE_SYNC_V2_PATH . 'includes/class-bulk-sync-manager.php';
        }

        $num_batches = $request->get_param('num_batches') ?: 10;
        $batch_size = $request->get_param('batch_size') ?: 100;

        $result = \Youvape_Sync_V2\Bulk_Sync_Manager::process_data_batches($num_batches, $batch_size);

        return $result;
    }

    /**
     * REST: Bulk Sync - Process ORDERS batches
     */
    public function rest_bulk_process_orders($request) {
        if (!class_exists('Youvape_Sync_V2\\Bulk_Sync_Manager')) {
            require_once YOUVAPE_SYNC_V2_PATH . 'includes/class-bulk-sync-manager.php';
        }

        $num_batches = $request->get_param('num_batches') ?: 10;
        $batch_size = $request->get_param('batch_size') ?: 100;

        $result = \Youvape_Sync_V2\Bulk_Sync_Manager::process_orders_batches($num_batches, $batch_size);

        return $result;
    }

    /**
     * REST: Bulk Sync - Process CUSTOMERS batches only
     */
    public function rest_bulk_process_customers($request) {
        if (!class_exists('Youvape_Sync_V2\\Bulk_Sync_Manager')) {
            require_once YOUVAPE_SYNC_V2_PATH . 'includes/class-bulk-sync-manager.php';
        }

        $num_batches = $request->get_param('num_batches') ?: 10;
        $batch_size = $request->get_param('batch_size') ?: 100;

        $result = \Youvape_Sync_V2\Bulk_Sync_Manager::process_customers_batches($num_batches, $batch_size);

        return $result;
    }

    /**
     * REST: Bulk Sync - Process PRODUCTS batches only
     */
    public function rest_bulk_process_products($request) {
        if (!class_exists('Youvape_Sync_V2\\Bulk_Sync_Manager')) {
            require_once YOUVAPE_SYNC_V2_PATH . 'includes/class-bulk-sync-manager.php';
        }

        $num_batches = $request->get_param('num_batches') ?: 10;
        $batch_size = $request->get_param('batch_size') ?: 100;

        $result = \Youvape_Sync_V2\Bulk_Sync_Manager::process_products_batches($num_batches, $batch_size);

        return $result;
    }

    /**
     * REST: Bulk Sync - Process REFUNDS batches only
     */
    public function rest_bulk_process_refunds($request) {
        if (!class_exists('Youvape_Sync_V2\\Bulk_Sync_Manager')) {
            require_once YOUVAPE_SYNC_V2_PATH . 'includes/class-bulk-sync-manager.php';
        }

        $num_batches = $request->get_param('num_batches') ?: 10;
        $batch_size = $request->get_param('batch_size') ?: 100;

        $result = \Youvape_Sync_V2\Bulk_Sync_Manager::process_refunds_batches($num_batches, $batch_size);

        return $result;
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
