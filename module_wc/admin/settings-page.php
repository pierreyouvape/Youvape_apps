<?php
/**
 * Page d'administration du plugin Youvape Sync
 *
 * @package YouvapeSync
 */

if (!defined('ABSPATH')) {
    exit;
}

$settings = youvape_sync()->settings->get_settings();
$batch_status = youvape_sync()->batch_processor->get_import_status();
$queue_size = youvape_sync()->event_listener->get_queue_size();
$validation = youvape_sync()->settings->validate_configuration();

// Compte les totaux
$customer_count = count_users()['avail_roles']['customer'] ?? 0;
$product_count = array_sum((array) wp_count_posts('product'));

// Compte les commandes (compatible HPOS WooCommerce 8.0+)
$order_count = 0;
if (class_exists('Automattic\WooCommerce\Utilities\OrderUtil') &&
    method_exists('Automattic\WooCommerce\Utilities\OrderUtil', 'custom_orders_table_usage_is_enabled') &&
    \Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled()) {
    // HPOS activé
    $order_count = count(wc_get_orders(array(
        'limit' => -1,
        'return' => 'ids',
    )));
} else {
    // Legacy
    global $wpdb;
    $order_count = $wpdb->get_var("
        SELECT COUNT(ID)
        FROM {$wpdb->posts}
        WHERE post_type IN ('shop_order', 'shop_order_placehold')
    ");
}
$order_count = (int) $order_count;
?>

<div class="wrap youvape-sync-admin">
    <h1><?php echo esc_html(get_admin_page_title()); ?></h1>

    <div class="youvape-sync-container">

        <!-- Onglets -->
        <nav class="nav-tab-wrapper">
            <a href="#tab-config" class="nav-tab nav-tab-active" data-tab="config">
                <?php esc_html_e('Configuration', 'youvape-sync'); ?>
            </a>
            <a href="#tab-batch" class="nav-tab" data-tab="batch">
                <?php esc_html_e('Import Historique', 'youvape-sync'); ?>
            </a>
            <a href="#tab-live" class="nav-tab" data-tab="live">
                <?php esc_html_e('Synchro Live', 'youvape-sync'); ?>
            </a>
            <a href="#tab-logs" class="nav-tab" data-tab="logs">
                <?php esc_html_e('Logs', 'youvape-sync'); ?>
            </a>
        </nav>

        <!-- Onglet Configuration -->
        <div id="tab-config" class="tab-content active">
            <h2><?php esc_html_e('Configuration de l\'API', 'youvape-sync'); ?></h2>

            <?php if (!$validation['valid']) : ?>
                <div class="notice notice-error">
                    <p><strong><?php esc_html_e('Erreurs de configuration :', 'youvape-sync'); ?></strong></p>
                    <ul>
                        <?php foreach ($validation['errors'] as $error) : ?>
                            <li><?php echo esc_html($error); ?></li>
                        <?php endforeach; ?>
                    </ul>
                </div>
            <?php endif; ?>

            <form id="youvape-sync-settings-form" class="youvape-sync-form">
                <table class="form-table">
                    <tr>
                        <th scope="row">
                            <label for="api_url"><?php esc_html_e('URL de l\'API', 'youvape-sync'); ?></label>
                        </th>
                        <td>
                            <input type="url" id="api_url" name="api_url" value="<?php echo esc_attr($settings['api_url']); ?>" class="regular-text" required>
                            <p class="description"><?php esc_html_e('Exemple: https://api.youvape.com', 'youvape-sync'); ?></p>
                        </td>
                    </tr>

                    <tr>
                        <th scope="row">
                            <label for="api_key"><?php esc_html_e('Clé API (optionnelle)', 'youvape-sync'); ?></label>
                        </th>
                        <td>
                            <input type="password" id="api_key" name="api_key" value="<?php echo esc_attr($settings['api_key']); ?>" class="regular-text">
                            <p class="description"><?php esc_html_e('Token d\'authentification Bearer si requis par votre API.', 'youvape-sync'); ?></p>
                        </td>
                    </tr>

                    <tr>
                        <th scope="row">
                            <label for="batch_size"><?php esc_html_e('Taille des lots', 'youvape-sync'); ?></label>
                        </th>
                        <td>
                            <input type="number" id="batch_size" name="batch_size" value="<?php echo esc_attr($settings['batch_size']); ?>" min="1" max="100" class="small-text">
                            <p class="description"><?php esc_html_e('Nombre d\'items envoyés par batch (1-100).', 'youvape-sync'); ?></p>
                        </td>
                    </tr>

                    <tr>
                        <th scope="row"><?php esc_html_e('Types de données', 'youvape-sync'); ?></th>
                        <td>
                            <fieldset>
                                <label>
                                    <input type="checkbox" name="enable_customers" <?php checked($settings['enable_customers']); ?>>
                                    <?php esc_html_e('Clients', 'youvape-sync'); ?>
                                    <span class="count">(<?php echo number_format_i18n($customer_count); ?>)</span>
                                </label><br>
                                <label>
                                    <input type="checkbox" name="enable_products" <?php checked($settings['enable_products']); ?>>
                                    <?php esc_html_e('Produits', 'youvape-sync'); ?>
                                    <span class="count">(<?php echo number_format_i18n($product_count); ?>)</span>
                                </label><br>
                                <label>
                                    <input type="checkbox" name="enable_orders" <?php checked($settings['enable_orders']); ?>>
                                    <?php esc_html_e('Commandes', 'youvape-sync'); ?>
                                    <span class="count">(<?php echo number_format_i18n($order_count); ?>)</span>
                                </label>
                            </fieldset>
                        </td>
                    </tr>

                    <tr>
                        <th scope="row"><?php esc_html_e('Restriction horaire', 'youvape-sync'); ?></th>
                        <td>
                            <fieldset>
                                <label>
                                    <input type="checkbox" id="enable_time_restriction" name="enable_time_restriction" <?php checked($settings['enable_time_restriction']); ?>>
                                    <?php esc_html_e('Activer la restriction horaire pour l\'import batch', 'youvape-sync'); ?>
                                </label>
                                <div id="time-restriction-fields" style="margin-top: 10px; <?php echo !$settings['enable_time_restriction'] ? 'display:none;' : ''; ?>">
                                    <label>
                                        <?php esc_html_e('De', 'youvape-sync'); ?>
                                        <input type="time" name="time_start" value="<?php echo esc_attr($settings['time_start']); ?>" class="small-text">
                                    </label>
                                    <label>
                                        <?php esc_html_e('à', 'youvape-sync'); ?>
                                        <input type="time" name="time_end" value="<?php echo esc_attr($settings['time_end']); ?>" class="small-text">
                                    </label>
                                </div>
                                <p class="description"><?php esc_html_e('Limite le traitement batch à une plage horaire spécifique.', 'youvape-sync'); ?></p>
                            </fieldset>
                        </td>
                    </tr>

                    <tr>
                        <th scope="row"><?php esc_html_e('Synchronisation live', 'youvape-sync'); ?></th>
                        <td>
                            <fieldset>
                                <label>
                                    <input type="checkbox" id="live_sync_enabled" name="live_sync_enabled" <?php checked($settings['live_sync_enabled']); ?>>
                                    <?php esc_html_e('Activer la synchro temps réel', 'youvape-sync'); ?>
                                </label>
                                <div id="live-sync-fields" style="margin-top: 10px; <?php echo !$settings['live_sync_enabled'] ? 'display:none;' : ''; ?>">
                                    <label>
                                        <?php esc_html_e('Délai (secondes)', 'youvape-sync'); ?>
                                        <input type="number" name="live_sync_delay" value="<?php echo esc_attr($settings['live_sync_delay']); ?>" min="0" max="3600" class="small-text">
                                    </label>
                                </div>
                                <p class="description"><?php esc_html_e('Synchronise automatiquement les nouveaux événements (clients, produits, commandes).', 'youvape-sync'); ?></p>
                            </fieldset>
                        </td>
                    </tr>
                </table>

                <p class="submit">
                    <button type="button" id="test-connection" class="button">
                        <?php esc_html_e('Tester la connexion', 'youvape-sync'); ?>
                    </button>
                    <button type="submit" class="button button-primary">
                        <?php esc_html_e('Sauvegarder les paramètres', 'youvape-sync'); ?>
                    </button>
                </p>
            </form>

            <div id="connection-test-result"></div>

            <!-- Section Test d'échantillon -->
            <hr style="margin: 40px 0;">

            <h2><?php esc_html_e('Test d\'envoi de données', 'youvape-sync'); ?></h2>
            <p><?php esc_html_e('Envoyez un petit échantillon de données pour tester la connexion et voir le format JSON envoyé.', 'youvape-sync'); ?></p>

            <div class="test-sample-box" style="background: #f0f6fc; border: 1px solid #c3d9ed; border-radius: 4px; padding: 20px; max-width: 600px;">
                <h3 style="margin-top: 0;"><?php esc_html_e('Échantillon de test', 'youvape-sync'); ?></h3>

                <table class="form-table">
                    <tr>
                        <th scope="row"><label for="test_customers_count"><?php esc_html_e('Clients', 'youvape-sync'); ?></label></th>
                        <td>
                            <input type="number" id="test_customers_count" value="5" min="0" max="100" class="small-text">
                            <span class="description"><?php esc_html_e('items', 'youvape-sync'); ?></span>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="test_products_count"><?php esc_html_e('Produits', 'youvape-sync'); ?></label></th>
                        <td>
                            <input type="number" id="test_products_count" value="5" min="0" max="100" class="small-text">
                            <span class="description"><?php esc_html_e('items', 'youvape-sync'); ?></span>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="test_orders_count"><?php esc_html_e('Commandes', 'youvape-sync'); ?></label></th>
                        <td>
                            <input type="number" id="test_orders_count" value="5" min="0" max="100" class="small-text">
                            <span class="description"><?php esc_html_e('items', 'youvape-sync'); ?></span>
                        </td>
                    </tr>
                </table>

                <p class="submit" style="margin: 20px 0 0 0;">
                    <button type="button" id="send-test-sample" class="button button-secondary button-large">
                        <?php esc_html_e('Envoyer l\'échantillon test', 'youvape-sync'); ?>
                    </button>
                    <button type="button" id="reset-test-offsets" class="button button-link-delete" style="margin-left: 20px;">
                        <?php esc_html_e('Réinitialiser les offsets de test', 'youvape-sync'); ?>
                    </button>
                </p>

                <div id="test-sample-result" style="margin-top: 20px;"></div>
            </div>
        </div>

        <!-- Onglet Import Historique -->
        <div id="tab-batch" class="tab-content">
            <h2><?php esc_html_e('Import Historique', 'youvape-sync'); ?></h2>

            <?php if (!$validation['valid']) : ?>
                <div class="notice notice-warning">
                    <p><?php esc_html_e('Veuillez d\'abord configurer l\'API dans l\'onglet Configuration.', 'youvape-sync'); ?></p>
                </div>
            <?php else : ?>

                <div class="batch-import-info">
                    <p><?php esc_html_e('L\'import historique récupère toutes les données existantes dans WooCommerce et les envoie vers votre API.', 'youvape-sync'); ?></p>
                    <p><strong><?php esc_html_e('Ordre d\'import :', 'youvape-sync'); ?></strong> Clients → Produits → Commandes</p>
                </div>

                <div class="batch-import-stats">
                    <div class="stat-box">
                        <h3><?php esc_html_e('Clients', 'youvape-sync'); ?></h3>
                        <p class="stat-number"><?php echo number_format_i18n($customer_count); ?></p>
                    </div>
                    <div class="stat-box">
                        <h3><?php esc_html_e('Produits', 'youvape-sync'); ?></h3>
                        <p class="stat-number"><?php echo number_format_i18n($product_count); ?></p>
                    </div>
                    <div class="stat-box">
                        <h3><?php esc_html_e('Commandes', 'youvape-sync'); ?></h3>
                        <p class="stat-number"><?php echo number_format_i18n($order_count); ?></p>
                    </div>
                </div>

                <?php if ($batch_status && $batch_status['status'] === 'running') : ?>
                    <!-- Import en cours -->
                    <div class="batch-status running">
                        <h3><?php esc_html_e('Import en cours...', 'youvape-sync'); ?></h3>

                        <div class="progress-section">
                            <h4><?php esc_html_e('Clients', 'youvape-sync'); ?></h4>
                            <div class="progress-bar">
                                <div class="progress-fill" id="progress-customers" style="width: 0%"></div>
                            </div>
                            <p class="progress-text">
                                <span id="progress-customers-text">0 / <?php echo number_format_i18n($customer_count); ?></span>
                            </p>
                        </div>

                        <div class="progress-section">
                            <h4><?php esc_html_e('Produits', 'youvape-sync'); ?></h4>
                            <div class="progress-bar">
                                <div class="progress-fill" id="progress-products" style="width: 0%"></div>
                            </div>
                            <p class="progress-text">
                                <span id="progress-products-text">0 / <?php echo number_format_i18n($product_count); ?></span>
                            </p>
                        </div>

                        <div class="progress-section">
                            <h4><?php esc_html_e('Commandes', 'youvape-sync'); ?></h4>
                            <div class="progress-bar">
                                <div class="progress-fill" id="progress-orders" style="width: 0%"></div>
                            </div>
                            <p class="progress-text">
                                <span id="progress-orders-text">0 / <?php echo number_format_i18n($order_count); ?></span>
                            </p>
                        </div>

                        <p class="submit">
                            <button type="button" id="stop-batch" class="button button-secondary">
                                <?php esc_html_e('Arrêter l\'import', 'youvape-sync'); ?>
                            </button>
                        </p>
                    </div>
                <?php else : ?>
                    <!-- Import non démarré -->
                    <p class="submit">
                        <button type="button" id="start-batch" class="button button-primary button-large">
                            <?php esc_html_e('Lancer l\'import historique', 'youvape-sync'); ?>
                        </button>
                    </p>
                <?php endif; ?>

                <?php if ($batch_status && $batch_status['status'] === 'completed') : ?>
                    <div class="notice notice-success">
                        <p><?php esc_html_e('Import terminé avec succès !', 'youvape-sync'); ?></p>
                        <p>
                            <?php
                            printf(
                                esc_html__('Clients: %d | Produits: %d | Commandes: %d', 'youvape-sync'),
                                $batch_status['processed']['customers'],
                                $batch_status['processed']['products'],
                                $batch_status['processed']['orders']
                            );
                            ?>
                        </p>
                    </div>
                <?php endif; ?>

            <?php endif; ?>
        </div>

        <!-- Onglet Synchro Live -->
        <div id="tab-live" class="tab-content">
            <h2><?php esc_html_e('Synchronisation Live', 'youvape-sync'); ?></h2>

            <?php if ($settings['live_sync_enabled']) : ?>
                <div class="notice notice-success inline">
                    <p><?php esc_html_e('✓ Synchro live activée', 'youvape-sync'); ?></p>
                </div>

                <div class="live-sync-stats">
                    <div class="stat-box">
                        <h3><?php esc_html_e('File d\'attente', 'youvape-sync'); ?></h3>
                        <p class="stat-number" id="queue-size"><?php echo number_format_i18n($queue_size); ?></p>
                        <p class="stat-label"><?php esc_html_e('événements en attente', 'youvape-sync'); ?></p>
                    </div>
                    <div class="stat-box">
                        <h3><?php esc_html_e('Délai', 'youvape-sync'); ?></h3>
                        <p class="stat-number"><?php echo number_format_i18n($settings['live_sync_delay']); ?>s</p>
                        <p class="stat-label"><?php esc_html_e('avant envoi', 'youvape-sync'); ?></p>
                    </div>
                </div>

                <h3><?php esc_html_e('Événements surveillés', 'youvape-sync'); ?></h3>
                <ul>
                    <?php if ($settings['enable_customers']) : ?>
                        <li>✓ <?php esc_html_e('Nouveaux clients et modifications', 'youvape-sync'); ?></li>
                    <?php endif; ?>
                    <?php if ($settings['enable_products']) : ?>
                        <li>✓ <?php esc_html_e('Nouveaux produits et modifications', 'youvape-sync'); ?></li>
                    <?php endif; ?>
                    <?php if ($settings['enable_orders']) : ?>
                        <li>✓ <?php esc_html_e('Nouvelles commandes et changements de statut', 'youvape-sync'); ?></li>
                    <?php endif; ?>
                </ul>

            <?php else : ?>
                <div class="notice notice-warning inline">
                    <p><?php esc_html_e('Synchro live désactivée. Activez-la dans la configuration.', 'youvape-sync'); ?></p>
                </div>
            <?php endif; ?>
        </div>

        <!-- Onglet Logs -->
        <div id="tab-logs" class="tab-content">
            <h2><?php esc_html_e('Logs de synchronisation', 'youvape-sync'); ?></h2>

            <p class="submit" style="margin-top: 0; padding-top: 0;">
                <a href="<?php echo esc_url(wp_nonce_url(admin_url('admin-post.php?action=youvape_sync_export_logs'), 'youvape_sync_export_logs')); ?>" class="button button-secondary">
                    <span class="dashicons dashicons-download" style="margin-top: 3px;"></span>
                    <?php esc_html_e('Télécharger les logs (.txt)', 'youvape-sync'); ?>
                </a>
            </p>

            <?php if ($batch_status) : ?>
                <h3><?php esc_html_e('Dernier import batch', 'youvape-sync'); ?></h3>
                <table class="widefat">
                    <tr>
                        <th><?php esc_html_e('Statut', 'youvape-sync'); ?></th>
                        <td><strong><?php echo esc_html($batch_status['status']); ?></strong></td>
                    </tr>
                    <tr>
                        <th><?php esc_html_e('Démarré le', 'youvape-sync'); ?></th>
                        <td><?php echo esc_html($batch_status['started_at']); ?></td>
                    </tr>
                    <?php if (isset($batch_status['completed_at'])) : ?>
                    <tr>
                        <th><?php esc_html_e('Terminé le', 'youvape-sync'); ?></th>
                        <td><?php echo esc_html($batch_status['completed_at']); ?></td>
                    </tr>
                    <?php endif; ?>
                    <tr>
                        <th><?php esc_html_e('Items traités', 'youvape-sync'); ?></th>
                        <td>
                            Clients: <?php echo number_format_i18n($batch_status['processed']['customers']); ?> |
                            Produits: <?php echo number_format_i18n($batch_status['processed']['products']); ?> |
                            Commandes: <?php echo number_format_i18n($batch_status['processed']['orders']); ?>
                        </td>
                    </tr>
                    <?php if (!empty($batch_status['errors'])) : ?>
                    <tr>
                        <th><?php esc_html_e('Erreurs', 'youvape-sync'); ?></th>
                        <td>
                            <details>
                                <summary><?php echo count($batch_status['errors']); ?> erreur(s)</summary>
                                <pre><?php echo esc_html(wp_json_encode($batch_status['errors'], JSON_PRETTY_PRINT)); ?></pre>
                            </details>
                        </td>
                    </tr>
                    <?php endif; ?>
                </table>
            <?php else : ?>
                <p><?php esc_html_e('Aucun import batch effectué pour le moment.', 'youvape-sync'); ?></p>
            <?php endif; ?>
        </div>

    </div>
</div>

<script type="text/javascript">
// Gestion des onglets
jQuery(document).ready(function($) {
    $('.nav-tab').on('click', function(e) {
        e.preventDefault();

        var tab = $(this).data('tab');

        $('.nav-tab').removeClass('nav-tab-active');
        $(this).addClass('nav-tab-active');

        $('.tab-content').removeClass('active');
        $('#tab-' + tab).addClass('active');
    });

    // Toggle time restriction fields
    $('#enable_time_restriction').on('change', function() {
        $('#time-restriction-fields').toggle(this.checked);
    });

    // Toggle live sync fields
    $('#live_sync_enabled').on('change', function() {
        $('#live-sync-fields').toggle(this.checked);
    });
});
</script>
