<?php
/**
 * Admin - Pages d'administration
 */

namespace YouSync;

defined('ABSPATH') || exit;

class Admin {

    /**
     * Initialize admin
     */
    public static function init() {
        add_action('admin_menu', [__CLASS__, 'add_menu']);
        add_action('admin_enqueue_scripts', [__CLASS__, 'enqueue_assets']);
        add_action('wp_ajax_yousync_test_connection', [__CLASS__, 'ajax_test_connection']);
        add_action('wp_ajax_yousync_force_send', [__CLASS__, 'ajax_force_send']);
        add_action('wp_ajax_yousync_clear_queue', [__CLASS__, 'ajax_clear_queue']);
        add_action('wp_ajax_yousync_download_logs', [__CLASS__, 'ajax_download_logs']);
        add_action('wp_ajax_yousync_get_status', [__CLASS__, 'ajax_get_status']);
        add_action('wp_ajax_yousync_save_settings', [__CLASS__, 'ajax_save_settings']);
    }

    /**
     * Add admin menu
     */
    public static function add_menu() {
        add_menu_page(
            'YouSync',
            'YouSync',
            'manage_woocommerce',
            'yousync',
            [__CLASS__, 'render_dashboard'],
            'dashicons-update',
            56
        );

        add_submenu_page(
            'yousync',
            'Dashboard',
            'Dashboard',
            'manage_woocommerce',
            'yousync',
            [__CLASS__, 'render_dashboard']
        );

        add_submenu_page(
            'yousync',
            'Settings',
            'Settings',
            'manage_woocommerce',
            'yousync-settings',
            [__CLASS__, 'render_settings']
        );

        add_submenu_page(
            'yousync',
            'Logs',
            'Logs',
            'manage_woocommerce',
            'yousync-logs',
            [__CLASS__, 'render_logs']
        );
    }

    /**
     * Enqueue admin assets
     */
    public static function enqueue_assets($hook) {
        if (strpos($hook, 'yousync') === false) {
            return;
        }

        wp_enqueue_style(
            'yousync-admin',
            YOUSYNC_URL . 'admin/css/admin.css',
            [],
            YOUSYNC_VERSION
        );

        wp_enqueue_script(
            'yousync-admin',
            YOUSYNC_URL . 'admin/js/admin.js',
            ['jquery'],
            YOUSYNC_VERSION,
            true
        );

        wp_localize_script('yousync-admin', 'yousync', [
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('yousync_nonce')
        ]);
    }

    /**
     * Render dashboard page
     */
    public static function render_dashboard() {
        $settings = get_option('yousync_settings', []);
        $last_sync = get_option('yousync_last_sync', []);
        $queue_stats = Queue_Manager::get_stats();
        $recent_logs = Logger::get_recent(10);
        ?>
        <div class="wrap yousync-admin">
            <h1><span class="dashicons dashicons-update"></span> YouSync Dashboard</h1>

            <!-- Status Cards -->
            <div class="yousync-cards">
                <div class="yousync-card <?php echo empty($settings['enabled']) ? 'status-off' : 'status-on'; ?>">
                    <h3>Sync Status</h3>
                    <p class="yousync-big-number">
                        <?php echo empty($settings['enabled']) ? 'OFF' : 'ON'; ?>
                    </p>
                    <p class="yousync-subtitle">
                        <?php if (!empty($settings['enabled'])): ?>
                            Every <?php echo intval($settings['cron_interval'] ?? 1); ?> min
                        <?php else: ?>
                            Disabled
                        <?php endif; ?>
                    </p>
                </div>

                <div class="yousync-card">
                    <h3>Queue</h3>
                    <p class="yousync-big-number" id="yousync-queue-count">
                        <?php echo $queue_stats['total']; ?>
                    </p>
                    <p class="yousync-subtitle">events pending</p>
                </div>

                <div class="yousync-card">
                    <h3>Last Sync</h3>
                    <p class="yousync-big-number">
                        <?php
                        if (!empty($last_sync['time'])) {
                            echo human_time_diff(strtotime($last_sync['time']), current_time('timestamp'));
                        } else {
                            echo '-';
                        }
                        ?>
                    </p>
                    <p class="yousync-subtitle">
                        <?php
                        if (!empty($last_sync['success'])) {
                            echo '<span class="success">Success</span>';
                        } elseif (isset($last_sync['success'])) {
                            echo '<span class="error">Failed</span>';
                        } else {
                            echo 'Never';
                        }
                        ?>
                    </p>
                </div>

                <div class="yousync-card">
                    <h3>API Status</h3>
                    <p class="yousync-big-number" id="yousync-api-status">-</p>
                    <p class="yousync-subtitle">
                        <button type="button" class="button button-small" id="yousync-test-connection">
                            Test Connection
                        </button>
                    </p>
                </div>
            </div>

            <!-- Queue Details -->
            <div class="yousync-section">
                <h2>Queue Details</h2>
                <table class="widefat">
                    <thead>
                        <tr>
                            <th>Type</th>
                            <th>Count</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>Orders</td>
                            <td><?php echo $queue_stats['by_type']['order']; ?></td>
                        </tr>
                        <tr>
                            <td>Products</td>
                            <td><?php echo $queue_stats['by_type']['product']; ?></td>
                        </tr>
                        <tr>
                            <td>Customers</td>
                            <td><?php echo $queue_stats['by_type']['customer']; ?></td>
                        </tr>
                        <tr>
                            <td>Refunds</td>
                            <td><?php echo $queue_stats['by_type']['refund']; ?></td>
                        </tr>
                    </tbody>
                </table>

                <div class="yousync-actions">
                    <button type="button" class="button button-primary" id="yousync-force-send">
                        <span class="dashicons dashicons-upload"></span> Force Send Now
                    </button>
                    <button type="button" class="button" id="yousync-clear-queue">
                        <span class="dashicons dashicons-trash"></span> Clear Queue
                    </button>
                    <button type="button" class="button" id="yousync-refresh-status">
                        <span class="dashicons dashicons-update"></span> Refresh
                    </button>
                </div>
            </div>

            <!-- Recent Logs -->
            <div class="yousync-section">
                <h2>Recent Activity</h2>
                <div class="yousync-logs-container">
                    <?php if (empty($recent_logs)): ?>
                        <p class="description">No recent activity</p>
                    <?php else: ?>
                        <table class="widefat striped">
                            <thead>
                                <tr>
                                    <th>Time</th>
                                    <th>Level</th>
                                    <th>Message</th>
                                </tr>
                            </thead>
                            <tbody>
                                <?php foreach ($recent_logs as $log): ?>
                                    <tr class="log-<?php echo esc_attr($log['level']); ?>">
                                        <td><?php echo esc_html($log['time']); ?></td>
                                        <td><span class="log-level"><?php echo esc_html($log['level']); ?></span></td>
                                        <td><?php echo esc_html($log['message']); ?></td>
                                    </tr>
                                <?php endforeach; ?>
                            </tbody>
                        </table>
                    <?php endif; ?>
                </div>
                <p><a href="<?php echo admin_url('admin.php?page=yousync-logs'); ?>">View all logs &rarr;</a></p>
            </div>
        </div>
        <?php
    }

    /**
     * Render settings page
     */
    public static function render_settings() {
        $settings = get_option('yousync_settings', []);
        ?>
        <div class="wrap yousync-admin">
            <h1><span class="dashicons dashicons-admin-settings"></span> YouSync Settings</h1>

            <form id="yousync-settings-form">
                <table class="form-table">
                    <tr>
                        <th scope="row">Enable Sync</th>
                        <td>
                            <label>
                                <input type="checkbox" name="enabled" value="1"
                                    <?php checked(!empty($settings['enabled'])); ?>>
                                Enable real-time synchronization
                            </label>
                            <p class="description">When enabled, changes will be queued and sent to VPS automatically.</p>
                        </td>
                    </tr>

                    <tr>
                        <th scope="row">VPS API URL</th>
                        <td>
                            <input type="url" name="api_url" class="regular-text"
                                value="<?php echo esc_attr($settings['api_url'] ?? ''); ?>"
                                placeholder="http://54.37.156.233:3000/api/webhook/sync">
                            <p class="description">The webhook endpoint on your VPS.</p>
                        </td>
                    </tr>

                    <tr>
                        <th scope="row">API Token</th>
                        <td>
                            <input type="text" name="api_token" class="regular-text"
                                value="<?php echo esc_attr($settings['api_token'] ?? ''); ?>"
                                placeholder="Enter your API token">
                            <p class="description">Token for authenticating requests to VPS.</p>
                        </td>
                    </tr>

                    <tr>
                        <th scope="row">Sync Interval</th>
                        <td>
                            <select name="cron_interval">
                                <option value="1" <?php selected(($settings['cron_interval'] ?? 1), 1); ?>>Every 1 minute</option>
                                <option value="2" <?php selected(($settings['cron_interval'] ?? 1), 2); ?>>Every 2 minutes</option>
                                <option value="5" <?php selected(($settings['cron_interval'] ?? 1), 5); ?>>Every 5 minutes</option>
                            </select>
                            <p class="description">How often to send queued events to VPS.</p>
                        </td>
                    </tr>

                    <tr>
                        <th scope="row">Batch Size</th>
                        <td>
                            <input type="number" name="batch_size" class="small-text"
                                value="<?php echo intval($settings['batch_size'] ?? 50); ?>"
                                min="10" max="200" step="10">
                            <p class="description">Maximum events to send per batch (10-200).</p>
                        </td>
                    </tr>

                    <tr>
                        <th scope="row">Retry Duration</th>
                        <td>
                            <input type="number" name="retry_hours" class="small-text"
                                value="<?php echo intval($settings['retry_hours'] ?? 24); ?>"
                                min="1" max="72" step="1"> hours
                            <p class="description">How long to keep failed events before discarding.</p>
                        </td>
                    </tr>
                </table>

                <h2>Sync Types</h2>
                <table class="form-table">
                    <tr>
                        <th scope="row">Orders</th>
                        <td>
                            <label>
                                <input type="checkbox" name="sync_orders" value="1"
                                    <?php checked(!empty($settings['sync_orders'])); ?>>
                                Sync orders (new, status changes, updates)
                            </label>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">Products</th>
                        <td>
                            <label>
                                <input type="checkbox" name="sync_products" value="1"
                                    <?php checked(!empty($settings['sync_products'])); ?>>
                                Sync products (create, update, stock, delete)
                            </label>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">Customers</th>
                        <td>
                            <label>
                                <input type="checkbox" name="sync_customers" value="1"
                                    <?php checked(!empty($settings['sync_customers'])); ?>>
                                Sync customers (new, updates)
                            </label>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">Refunds</th>
                        <td>
                            <label>
                                <input type="checkbox" name="sync_refunds" value="1"
                                    <?php checked(!empty($settings['sync_refunds'])); ?>>
                                Sync refunds
                            </label>
                        </td>
                    </tr>
                </table>

                <p class="submit">
                    <button type="submit" class="button button-primary">Save Settings</button>
                    <button type="button" class="button" id="yousync-test-connection-settings">Test Connection</button>
                    <span id="yousync-settings-status"></span>
                </p>
            </form>
        </div>
        <?php
    }

    /**
     * Render logs page
     */
    public static function render_logs() {
        $log_files = Logger::get_log_files();
        $selected_date = isset($_GET['date']) ? sanitize_text_field($_GET['date']) : current_time('Y-m-d');
        $logs = Logger::get_logs($selected_date);
        $logs_size = Logger::get_logs_size();
        ?>
        <div class="wrap yousync-admin">
            <h1><span class="dashicons dashicons-list-view"></span> YouSync Logs</h1>

            <div class="yousync-logs-header">
                <div class="yousync-logs-info">
                    <p>
                        <strong>Total logs size:</strong> <?php echo Logger::format_bytes($logs_size); ?>
                        | <strong>Files:</strong> <?php echo count($log_files); ?>
                        | <strong>Retention:</strong> 30 days
                    </p>
                </div>

                <div class="yousync-logs-actions">
                    <select id="yousync-log-date">
                        <?php foreach ($log_files as $file): ?>
                            <option value="<?php echo esc_attr($file['date']); ?>"
                                <?php selected($file['date'], $selected_date); ?>>
                                <?php echo esc_html($file['date']); ?>
                                (<?php echo Logger::format_bytes($file['size']); ?>)
                            </option>
                        <?php endforeach; ?>
                    </select>
                    <button type="button" class="button" id="yousync-download-log">
                        <span class="dashicons dashicons-download"></span> Download
                    </button>
                </div>
            </div>

            <div class="yousync-logs-content">
                <?php if (empty($logs)): ?>
                    <p class="description">No logs for this date.</p>
                <?php else: ?>
                    <table class="widefat striped">
                        <thead>
                            <tr>
                                <th width="80">Time</th>
                                <th width="80">Level</th>
                                <th>Message</th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php foreach (array_reverse($logs) as $log): ?>
                                <tr class="log-<?php echo esc_attr($log['level']); ?>">
                                    <td><?php echo esc_html($log['time']); ?></td>
                                    <td><span class="log-level log-level-<?php echo esc_attr($log['level']); ?>"><?php echo esc_html(strtoupper($log['level'])); ?></span></td>
                                    <td><?php echo esc_html($log['message']); ?></td>
                                </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                <?php endif; ?>
            </div>
        </div>
        <?php
    }

    /* ============================================
     * AJAX HANDLERS
     * ============================================ */

    /**
     * AJAX: Test connection
     */
    public static function ajax_test_connection() {
        check_ajax_referer('yousync_nonce', 'nonce');

        if (!current_user_can('manage_woocommerce')) {
            wp_send_json_error('Permission denied');
        }

        $result = Sync_Sender::test_connection();
        wp_send_json($result);
    }

    /**
     * AJAX: Force send
     */
    public static function ajax_force_send() {
        check_ajax_referer('yousync_nonce', 'nonce');

        if (!current_user_can('manage_woocommerce')) {
            wp_send_json_error('Permission denied');
        }

        $result = Sync_Sender::force_send();
        wp_send_json($result);
    }

    /**
     * AJAX: Clear queue
     */
    public static function ajax_clear_queue() {
        check_ajax_referer('yousync_nonce', 'nonce');

        if (!current_user_can('manage_woocommerce')) {
            wp_send_json_error('Permission denied');
        }

        Queue_Manager::clear();
        wp_send_json_success('Queue cleared');
    }

    /**
     * AJAX: Download logs
     */
    public static function ajax_download_logs() {
        check_ajax_referer('yousync_nonce', 'nonce');

        if (!current_user_can('manage_woocommerce')) {
            wp_die('Permission denied');
        }

        $date = isset($_GET['date']) ? sanitize_text_field($_GET['date']) : current_time('Y-m-d');
        $content = Logger::get_file_content($date);

        if ($content === false) {
            wp_die('Log file not found');
        }

        header('Content-Type: text/plain');
        header('Content-Disposition: attachment; filename="yousync-' . $date . '.log"');
        header('Content-Length: ' . strlen($content));
        echo $content;
        exit;
    }

    /**
     * AJAX: Get status
     */
    public static function ajax_get_status() {
        check_ajax_referer('yousync_nonce', 'nonce');

        if (!current_user_can('manage_woocommerce')) {
            wp_send_json_error('Permission denied');
        }

        wp_send_json_success([
            'queue' => Queue_Manager::get_stats(),
            'last_sync' => get_option('yousync_last_sync', [])
        ]);
    }

    /**
     * AJAX: Save settings
     */
    public static function ajax_save_settings() {
        check_ajax_referer('yousync_nonce', 'nonce');

        if (!current_user_can('manage_woocommerce')) {
            wp_send_json_error('Permission denied');
        }

        $settings = [
            'enabled' => !empty($_POST['enabled']),
            'api_url' => sanitize_url($_POST['api_url'] ?? ''),
            'api_token' => sanitize_text_field($_POST['api_token'] ?? ''),
            'cron_interval' => intval($_POST['cron_interval'] ?? 1),
            'batch_size' => max(10, min(200, intval($_POST['batch_size'] ?? 50))),
            'retry_hours' => max(1, min(72, intval($_POST['retry_hours'] ?? 24))),
            'sync_orders' => !empty($_POST['sync_orders']),
            'sync_products' => !empty($_POST['sync_products']),
            'sync_customers' => !empty($_POST['sync_customers']),
            'sync_refunds' => !empty($_POST['sync_refunds'])
        ];

        update_option('yousync_settings', $settings);

        // Reschedule cron with new interval
        $timestamp = wp_next_scheduled('yousync_process_queue');
        if ($timestamp) {
            wp_unschedule_event($timestamp, 'yousync_process_queue');
        }
        if ($settings['enabled']) {
            wp_schedule_event(time(), 'yousync_interval', 'yousync_process_queue');
        }

        Logger::info('Settings updated');

        wp_send_json_success('Settings saved');
    }
}
