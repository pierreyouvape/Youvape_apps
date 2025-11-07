<?php
/**
 * Settings Page
 */

namespace Youvape_Sync_V2\Admin;

defined('ABSPATH') || exit;

class Settings {

    /**
     * Render the settings page
     */
    public function render() {
        // Handle form submission
        if (isset($_POST['youvape_sync_v2_save_settings'])) {
            check_admin_referer('youvape_sync_v2_settings');
            $this->save_settings();
        }

        $settings = get_option('youvape_sync_v2_settings', []);
        $defaults = [
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

        $settings = wp_parse_args($settings, $defaults);

        ?>
        <div class="wrap youvape-sync-v2-settings">
            <h1><?php _e('Youvape Sync v2 - Settings', 'youvape-sync-v2'); ?></h1>

            <?php if (isset($_GET['updated'])): ?>
                <div class="notice notice-success is-dismissible">
                    <p><?php _e('Settings saved successfully.', 'youvape-sync-v2'); ?></p>
                </div>
            <?php endif; ?>

            <form method="post" action="">
                <?php wp_nonce_field('youvape_sync_v2_settings'); ?>

                <!-- API Settings -->
                <div class="card">
                    <h2><?php _e('API Configuration', 'youvape-sync-v2'); ?></h2>

                    <table class="form-table">
                        <tr>
                            <th scope="row">
                                <label for="api_url"><?php _e('VPS API URL', 'youvape-sync-v2'); ?></label>
                            </th>
                            <td>
                                <input type="url"
                                       id="api_url"
                                       name="api_url"
                                       value="<?php echo esc_attr($settings['api_url']); ?>"
                                       class="regular-text"
                                       placeholder="http://54.37.156.233:3000/api">
                                <p class="description">
                                    <?php _e('The base URL of your VPS API (e.g., http://54.37.156.233:3000/api)', 'youvape-sync-v2'); ?>
                                </p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">
                                <label for="api_token"><?php _e('API Token', 'youvape-sync-v2'); ?></label>
                            </th>
                            <td>
                                <input type="text"
                                       id="api_token"
                                       name="api_token"
                                       value="<?php echo esc_attr($settings['api_token']); ?>"
                                       class="regular-text">
                                <p class="description">
                                    <?php _e('Authentication token for API requests', 'youvape-sync-v2'); ?>
                                </p>
                            </td>
                        </tr>
                    </table>
                </div>

                <!-- Sync Settings -->
                <div class="card">
                    <h2><?php _e('Synchronization Settings', 'youvape-sync-v2'); ?></h2>

                    <table class="form-table">
                        <tr>
                            <th scope="row">
                                <label for="batch_size"><?php _e('Batch Size', 'youvape-sync-v2'); ?></label>
                            </th>
                            <td>
                                <input type="number"
                                       id="batch_size"
                                       name="batch_size"
                                       value="<?php echo esc_attr($settings['batch_size']); ?>"
                                       min="100"
                                       max="1000"
                                       step="50">
                                <p class="description">
                                    <?php _e('Number of items to sync per batch (100-1000, default: 500)', 'youvape-sync-v2'); ?>
                                </p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">
                                <label for="timeout"><?php _e('HTTP Timeout', 'youvape-sync-v2'); ?></label>
                            </th>
                            <td>
                                <input type="number"
                                       id="timeout"
                                       name="timeout"
                                       value="<?php echo esc_attr($settings['timeout']); ?>"
                                       min="30"
                                       max="300"
                                       step="10">
                                <span><?php _e('seconds', 'youvape-sync-v2'); ?></span>
                                <p class="description">
                                    <?php _e('Timeout for HTTP requests to VPS (default: 60s)', 'youvape-sync-v2'); ?>
                                </p>
                            </td>
                        </tr>
                    </table>
                </div>

                <!-- Time Restrictions -->
                <div class="card">
                    <h2><?php _e('Time Restrictions', 'youvape-sync-v2'); ?></h2>

                    <table class="form-table">
                        <tr>
                            <th scope="row">
                                <?php _e('Enable Time Restrictions', 'youvape-sync-v2'); ?>
                            </th>
                            <td>
                                <label>
                                    <input type="checkbox"
                                           id="time_restrictions_enabled"
                                           name="time_restrictions_enabled"
                                           value="1"
                                           <?php checked($settings['time_restrictions_enabled'], true); ?>>
                                    <?php _e('Only run sync during specified hours', 'youvape-sync-v2'); ?>
                                </label>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">
                                <label for="time_restrictions_start"><?php _e('Start Time', 'youvape-sync-v2'); ?></label>
                            </th>
                            <td>
                                <input type="time"
                                       id="time_restrictions_start"
                                       name="time_restrictions_start"
                                       value="<?php echo esc_attr($settings['time_restrictions_start']); ?>">
                                <p class="description">
                                    <?php _e('Start time for sync operations (e.g., 02:00)', 'youvape-sync-v2'); ?>
                                </p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">
                                <label for="time_restrictions_end"><?php _e('End Time', 'youvape-sync-v2'); ?></label>
                            </th>
                            <td>
                                <input type="time"
                                       id="time_restrictions_end"
                                       name="time_restrictions_end"
                                       value="<?php echo esc_attr($settings['time_restrictions_end']); ?>">
                                <p class="description">
                                    <?php _e('End time for sync operations (e.g., 06:00)', 'youvape-sync-v2'); ?>
                                </p>
                            </td>
                        </tr>
                    </table>
                </div>

                <!-- Queue Settings -->
                <div class="card">
                    <h2><?php _e('Queue Settings', 'youvape-sync-v2'); ?></h2>

                    <table class="form-table">
                        <tr>
                            <th scope="row">
                                <?php _e('Enable Queues', 'youvape-sync-v2'); ?>
                            </th>
                            <td>
                                <label>
                                    <input type="checkbox"
                                           name="queues_enabled[customers]"
                                           value="1"
                                           <?php checked($settings['queues_enabled']['customers'], true); ?>>
                                    <?php _e('Customers', 'youvape-sync-v2'); ?>
                                </label><br>
                                <label>
                                    <input type="checkbox"
                                           name="queues_enabled[products]"
                                           value="1"
                                           <?php checked($settings['queues_enabled']['products'], true); ?>>
                                    <?php _e('Products', 'youvape-sync-v2'); ?>
                                </label><br>
                                <label>
                                    <input type="checkbox"
                                           name="queues_enabled[orders]"
                                           value="1"
                                           <?php checked($settings['queues_enabled']['orders'], true); ?>>
                                    <?php _e('Orders', 'youvape-sync-v2'); ?>
                                </label>
                                <p class="description">
                                    <?php _e('Select which queues should be processed during sync', 'youvape-sync-v2'); ?>
                                </p>
                            </td>
                        </tr>
                    </table>
                </div>

                <p class="submit">
                    <button type="submit" name="youvape_sync_v2_save_settings" class="button button-primary">
                        <?php _e('Save Settings', 'youvape-sync-v2'); ?>
                    </button>
                </p>
            </form>
        </div>
        <?php
    }

    /**
     * Save settings
     */
    private function save_settings() {
        $settings = [
            'api_url' => isset($_POST['api_url']) ? esc_url_raw($_POST['api_url']) : '',
            'api_token' => isset($_POST['api_token']) ? sanitize_text_field($_POST['api_token']) : '',
            'batch_size' => isset($_POST['batch_size']) ? absint($_POST['batch_size']) : 500,
            'timeout' => isset($_POST['timeout']) ? absint($_POST['timeout']) : 60,
            'time_restrictions_enabled' => isset($_POST['time_restrictions_enabled']),
            'time_restrictions_start' => isset($_POST['time_restrictions_start']) ? sanitize_text_field($_POST['time_restrictions_start']) : '02:00',
            'time_restrictions_end' => isset($_POST['time_restrictions_end']) ? sanitize_text_field($_POST['time_restrictions_end']) : '06:00',
            'queues_enabled' => [
                'customers' => isset($_POST['queues_enabled']['customers']),
                'products' => isset($_POST['queues_enabled']['products']),
                'orders' => isset($_POST['queues_enabled']['orders'])
            ]
        ];

        // Validate batch size range
        if ($settings['batch_size'] < 100) {
            $settings['batch_size'] = 100;
        }
        if ($settings['batch_size'] > 1000) {
            $settings['batch_size'] = 1000;
        }

        update_option('youvape_sync_v2_settings', $settings);

        // Redirect with success message
        wp_safe_redirect(add_query_arg('updated', '1', wp_get_referer()));
        exit;
    }
}
