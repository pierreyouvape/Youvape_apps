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

            <!-- Phase 1: Bulk Sync -->
            <div class="card youvape-sync-bulk-section">
                <h2><?php _e('Phase 1: Bulk Sync (Historical Import)', 'youvape-sync-v2'); ?></h2>
                <p><?php _e('Import all historical data from WooCommerce to VPS database.', 'youvape-sync-v2'); ?></p>

                <div id="youvape-bulk-controls" style="margin: 20px 0;">
                    <button type="button" class="button button-primary button-hero" id="youvape-bulk-start">
                        <span class="dashicons dashicons-controls-play"></span>
                        <?php _e('Start Full Sync', 'youvape-sync-v2'); ?>
                    </button>

                    <button type="button" class="button button-secondary" id="youvape-bulk-pause" style="display:none;">
                        <span class="dashicons dashicons-controls-pause"></span>
                        <?php _e('Pause', 'youvape-sync-v2'); ?>
                    </button>

                    <button type="button" class="button button-secondary" id="youvape-bulk-resume" style="display:none;">
                        <span class="dashicons dashicons-controls-play"></span>
                        <?php _e('Resume', 'youvape-sync-v2'); ?>
                    </button>

                    <button type="button" class="button button-secondary" id="youvape-bulk-reset">
                        <span class="dashicons dashicons-image-rotate"></span>
                        <?php _e('Reset', 'youvape-sync-v2'); ?>
                    </button>
                </div>

                <div class="youvape-manual-controls" style="margin: 20px 0; padding: 15px; background: #f0f0f1; border-left: 4px solid #2271b1;">
                    <h3 style="margin-top: 0;"><?php _e('Manual Processing', 'youvape-sync-v2'); ?></h3>
                    <p><?php _e('If automatic cron is not working, use manual processing to sync batches.', 'youvape-sync-v2'); ?></p>

                    <div style="display: flex; gap: 10px; align-items: center;">
                        <button type="button" class="button button-primary" id="youvape-bulk-process-manual">
                            <span class="dashicons dashicons-controls-play"></span>
                            <?php _e('Process 10 Batches', 'youvape-sync-v2'); ?>
                        </button>

                        <label style="margin: 0;">
                            <?php _e('Batch size:', 'youvape-sync-v2'); ?>
                            <input type="number" id="youvape-manual-batch-size" value="100" min="10" max="1000" step="10" style="width: 80px;" />
                        </label>

                        <label style="margin: 0;">
                            <?php _e('Number of batches:', 'youvape-sync-v2'); ?>
                            <input type="number" id="youvape-manual-num-batches" value="10" min="1" max="100" step="1" style="width: 80px;" />
                        </label>
                    </div>

                    <div id="youvape-manual-progress" style="margin-top: 10px; display: none;">
                        <div class="notice notice-info inline">
                            <p><strong><?php _e('Processing...', 'youvape-sync-v2'); ?></strong> <span id="youvape-manual-status"></span></p>
                        </div>
                    </div>
                </div>

                <div id="youvape-bulk-status" style="margin: 20px 0;">
                    <p>
                        <strong><?php _e('Status:', 'youvape-sync-v2'); ?></strong>
                        <span id="youvape-bulk-status-text">
                            <?php
                            $status = isset($queue_state['status']) ? $queue_state['status'] : 'idle';
                            echo '<span class="youvape-status-badge status-' . esc_attr($status) . '">' . esc_html(ucfirst($status)) . '</span>';
                            ?>
                        </span>
                    </p>

                    <p id="youvape-bulk-started-at" style="display:none;">
                        <strong><?php _e('Started at:', 'youvape-sync-v2'); ?></strong>
                        <span id="youvape-bulk-started-time"></span>
                    </p>
                </div>

                <div id="youvape-bulk-progress">
                    <!-- Progress bars will be inserted here by JS -->
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
