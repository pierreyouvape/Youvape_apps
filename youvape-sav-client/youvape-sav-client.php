<?php
/**
 * Plugin Name:       Youvape — Espace client SAV
 * Plugin URI:        https://www.youvape.fr
 * Description:        Ajoute un onglet "Mes demandes au service client" dans le compte WooCommerce, permettant au client connecté de consulter et gérer ses tickets SAV. Les tickets vivent dans l'app Node Youvape ; ce plugin communique avec elle en server-to-server (aucune écriture en base WordPress).
 * Version:           0.1.0
 * Author:            Youvape
 * Text Domain:       youvape-sav-client
 * Requires at least: 6.0
 * Requires PHP:      7.4
 *
 * Configuration requise (à définir dans wp-config.php) :
 *   define('YOUVAPE_SAV_API_URL', 'https://api.youvape.fr');  // base de l'API Node
 *   define('YOUVAPE_SAV_API_SECRET', '...');                  // = CLIENT_SAV_SECRET du backend
 */

if (!defined('ABSPATH')) {
    exit; // Pas d'accès direct
}

define('YOUVAPE_SAV_VERSION', '0.1.0');
define('YOUVAPE_SAV_PLUGIN_FILE', __FILE__);
define('YOUVAPE_SAV_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('YOUVAPE_SAV_PLUGIN_URL', plugin_dir_url(__FILE__));

// Slug de l'endpoint WooCommerce (URL : /mon-compte/mes-demandes/)
if (!defined('YOUVAPE_SAV_ENDPOINT')) {
    define('YOUVAPE_SAV_ENDPOINT', 'mes-demandes');
}

require_once YOUVAPE_SAV_PLUGIN_DIR . 'includes/class-settings.php';
require_once YOUVAPE_SAV_PLUGIN_DIR . 'includes/class-api-client.php';
require_once YOUVAPE_SAV_PLUGIN_DIR . 'includes/class-account-endpoint.php';
require_once YOUVAPE_SAV_PLUGIN_DIR . 'includes/class-order-button.php';

/**
 * Initialisation : on n'active la logique que si WooCommerce est présent.
 */
function youvape_sav_init() {
    // La page de réglages est toujours disponible (configuration possible même
    // avant que tout soit en place).
    Youvape_SAV_Settings::instance()->register();

    if (!class_exists('WooCommerce')) {
        add_action('admin_notices', function () {
            echo '<div class="notice notice-error"><p>'
                . esc_html__('Youvape — Espace client SAV nécessite WooCommerce pour l\'onglet « Mes demandes ».', 'youvape-sav-client')
                . '</p></div>';
        });
        return;
    }
    Youvape_SAV_Account_Endpoint::instance()->register();
    Youvape_SAV_Order_Button::instance()->register();
}
add_action('plugins_loaded', 'youvape_sav_init');

/**
 * Activation : enregistrer l'endpoint puis flush des rewrite rules pour que
 * l'URL /mon-compte/mes-demandes/ soit reconnue immédiatement.
 */
function youvape_sav_activate() {
    add_rewrite_endpoint(YOUVAPE_SAV_ENDPOINT, EP_ROOT | EP_PAGES);
    flush_rewrite_rules();
}
register_activation_hook(__FILE__, 'youvape_sav_activate');

/**
 * Désactivation : flush pour nettoyer la rewrite rule de l'endpoint.
 */
function youvape_sav_deactivate() {
    flush_rewrite_rules();
}
register_deactivation_hook(__FILE__, 'youvape_sav_deactivate');
