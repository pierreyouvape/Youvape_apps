<?php
/**
 * Plugin Name: YouSync
 * Plugin URI: https://youvape.fr
 * Description: Enregistre les événements WooCommerce (commandes, produits, clients, remboursements) et les tient à disposition du serveur Youvape. Ne modifie rien sur le site.
 * Version: 2.0.0
 * Author: Youvape
 * Author URI: https://youvape.fr
 * Text Domain: yousync
 * Requires at least: 5.8
 * Requires PHP: 7.4
 * WC requires at least: 6.0
 * WC tested up to: 11.2
 */

defined('ABSPATH') || exit;

// Déclarer la compatibilité HPOS (High-Performance Order Storage)
add_action('before_woocommerce_init', function() {
    if (class_exists(\Automattic\WooCommerce\Utilities\FeaturesUtil::class)) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', __FILE__, true);
    }
});

// Define plugin constants
define('YOUSYNC_VERSION', '2.0.0');
define('YOUSYNC_FILE', __FILE__);
define('YOUSYNC_PATH', plugin_dir_path(__FILE__));
define('YOUSYNC_URL', plugin_dir_url(__FILE__));

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

// Initialize plugin
add_action('plugins_loaded', function() {
    if (!class_exists('WooCommerce')) {
        add_action('admin_notices', function() {
            echo '<div class="error"><p><strong>YouSync</strong> nécessite WooCommerce pour fonctionner.</p></div>';
        });
        return;
    }

    // Une mise à jour par fichiers ne relance pas l'activation : le schéma et la
    // reprise de l'ancienne file se vérifient à chaque chargement.
    \YouSync\Install::maybe_upgrade();

    \YouSync\Hooks_Manager::init();
    \YouSync\Admin::init();
}, 20);

add_action('rest_api_init', ['\YouSync\Rest', 'register_routes']);

add_action('init', function() {
    if (!wp_next_scheduled('yousync_purge')) {
        wp_schedule_event(time() + HOUR_IN_SECONDS, 'daily', 'yousync_purge');
    }
});

add_action('yousync_purge', ['\YouSync\Queue', 'purge']);
add_action('yousync_legacy_sweep', ['\YouSync\Install', 'import_legacy_queue']);

register_activation_hook(__FILE__, ['\YouSync\Install', 'maybe_upgrade']);

register_deactivation_hook(__FILE__, function() {
    wp_clear_scheduled_hook('yousync_purge');
    wp_clear_scheduled_hook('yousync_legacy_sweep');
});
