<?php
/**
 * Admin Page - Main Dashboard
 */

namespace Youvape_Sync_V2\Admin;

defined('ABSPATH') || exit;

class Admin_Page {

    /**
     * Render the admin page
     */
    public function render() {
        global $wpdb;

        // Get current status
        $queue_state = get_option('youvape_sync_v2_queue_state', []);
        $settings = get_option('youvape_sync_v2_settings', []);

        // Count totals
        $total_customers = $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->users}");
        $total_products = $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = 'product' AND post_status = 'publish'");
        $total_orders = $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = 'shop_order'");

        ?>
        <div class="wrap youvape-sync-v2-admin">
            <h1>
                <span class="dashicons dashicons-update"></span>
                <?php _e('Youvape Sync v2', 'youvape-sync-v2'); ?>
            </h1>

            <div class="youvape-sync-notices">
                <?php if (empty($settings['api_url'])): ?>
                    <div class="notice notice-warning">
                        <p>
                            <strong><?php _e('Configuration Required:', 'youvape-sync-v2'); ?></strong>
                            <?php _e('Please configure your API URL and token in', 'youvape-sync-v2'); ?>
                            <a href="<?php echo admin_url('admin.php?page=youvape-sync-v2-settings'); ?>">
                                <?php _e('Settings', 'youvape-sync-v2'); ?>
                            </a>
                        </p>
                    </div>
                <?php endif; ?>
            </div>

            <!-- Phase 0: Test Explorer -->
            <div class="card youvape-sync-test-section">
                <h2><?php _e('Phase 0: Test & Exploration', 'youvape-sync-v2'); ?></h2>
                <p><?php _e('Test the synchronization by fetching RAW data from WordPress and sending to VPS.', 'youvape-sync-v2'); ?></p>

                <div style="margin-bottom: 15px;">
                    <label for="youvape-product-id">
                        <strong><?php _e('Product ID (optional):', 'youvape-sync-v2'); ?></strong>
                    </label>
                    <input type="number"
                           id="youvape-product-id"
                           placeholder="<?php _e('Leave empty for last product', 'youvape-sync-v2'); ?>"
                           style="width: 200px; margin-left: 10px;">
                    <p class="description">
                        <?php _e('Enter a product ID to test a specific product (simple or variable). Leave empty to test the last product.', 'youvape-sync-v2'); ?>
                    </p>
                </div>

                <button type="button" class="button button-primary button-large" id="youvape-run-test">
                    <span class="dashicons dashicons-search"></span>
                    <?php _e('Test un item de chaque', 'youvape-sync-v2'); ?>
                </button>

                <div id="youvape-test-results" style="display: none; margin-top: 20px;">
                    <div class="youvape-test-loading" style="display: none;">
                        <span class="spinner is-active"></span>
                        <span><?php _e('Testing...', 'youvape-sync-v2'); ?></span>
                    </div>

                    <div id="youvape-test-content"></div>
                </div>
            </div>

            <!-- Current Status -->
            <div class="card youvape-sync-status-section">
                <h2><?php _e('Sync Status', 'youvape-sync-v2'); ?></h2>

                <table class="widefat">
                    <thead>
                        <tr>
                            <th><?php _e('Type', 'youvape-sync-v2'); ?></th>
                            <th><?php _e('Total', 'youvape-sync-v2'); ?></th>
                            <th><?php _e('Synced', 'youvape-sync-v2'); ?></th>
                            <th><?php _e('Progress', 'youvape-sync-v2'); ?></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><strong><?php _e('Customers', 'youvape-sync-v2'); ?></strong></td>
                            <td><?php echo number_format($total_customers); ?></td>
                            <td><span class="youvape-synced-count" data-type="customers">-</span></td>
                            <td>
                                <div class="youvape-progress-bar">
                                    <div class="youvape-progress-fill" data-type="customers" style="width: 0%"></div>
                                </div>
                            </td>
                        </tr>
                        <tr>
                            <td><strong><?php _e('Products', 'youvape-sync-v2'); ?></strong></td>
                            <td><?php echo number_format($total_products); ?></td>
                            <td><span class="youvape-synced-count" data-type="products">-</span></td>
                            <td>
                                <div class="youvape-progress-bar">
                                    <div class="youvape-progress-fill" data-type="products" style="width: 0%"></div>
                                </div>
                            </td>
                        </tr>
                        <tr>
                            <td><strong><?php _e('Orders', 'youvape-sync-v2'); ?></strong></td>
                            <td><?php echo number_format($total_orders); ?></td>
                            <td><span class="youvape-synced-count" data-type="orders">-</span></td>
                            <td>
                                <div class="youvape-progress-bar">
                                    <div class="youvape-progress-fill" data-type="orders" style="width: 0%"></div>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>

                <div style="margin-top: 20px;">
                    <p>
                        <strong><?php _e('Active Queue:', 'youvape-sync-v2'); ?></strong>
                        <span id="youvape-active-queue">
                            <?php echo isset($queue_state['active_queue']) ? $queue_state['active_queue'] : __('None', 'youvape-sync-v2'); ?>
                        </span>
                    </p>
                    <p>
                        <strong><?php _e('Last Run:', 'youvape-sync-v2'); ?></strong>
                        <span id="youvape-last-run">
                            <?php echo isset($queue_state['last_run']) ? $queue_state['last_run'] : __('Never', 'youvape-sync-v2'); ?>
                        </span>
                    </p>
                </div>

                <div style="margin-top: 20px;">
                    <button type="button" class="button button-secondary" id="youvape-force-sync" disabled>
                        <span class="dashicons dashicons-controls-play"></span>
                        <?php _e('Force Sync (Phase 1)', 'youvape-sync-v2'); ?>
                    </button>
                    <button type="button" class="button button-secondary" id="youvape-refresh-status">
                        <span class="dashicons dashicons-update"></span>
                        <?php _e('Refresh Status', 'youvape-sync-v2'); ?>
                    </button>
                </div>
            </div>

            <!-- Recent Logs -->
            <div class="card youvape-sync-logs-section">
                <h2><?php _e('Recent Logs', 'youvape-sync-v2'); ?></h2>
                <div id="youvape-logs-container">
                    <p class="description"><?php _e('Loading logs...', 'youvape-sync-v2'); ?></p>
                </div>
            </div>
        </div>
        <?php
    }
}
