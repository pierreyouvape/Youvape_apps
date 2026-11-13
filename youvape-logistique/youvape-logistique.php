<?php
/**
 * Plugin Name:          Youvape — Logistique
 * Plugin URI:           https://www.youvape.fr
 * Description:          Ajustements de stock par écarts, expédition et changements de statut des commandes, envoyés par lots depuis l'app Youvape. Chaque ligne est idempotente et reçoit son propre résultat.
 * Version:              0.6.0
 * Author:               Youvape
 * Text Domain:          youvape-logistique
 * Requires at least:    6.0
 * Requires PHP:         7.4
 * Requires Plugins:     woocommerce
 * WC requires at least: 10.0
 *
 * Routes (accès réservé aux comptes ayant le droit manage_woocommerce) :
 *   GET  /wp-json/wc-youvape-logistique/v1/status
 *   GET  /wp-json/wc-youvape-logistique/v1/settings
 *   POST /wp-json/wc-youvape-logistique/v1/settings
 *   POST /wp-json/wc-youvape-logistique/v1/stock/adjust
 *   POST /wp-json/wc-youvape-logistique/v1/order/ship
 *   POST /wp-json/wc-youvape-logistique/v1/order/status
 *
 * Lire AVANT-DE-MODIFIER.md avant toute mise à jour.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('YOUVAPE_LOGISTIQUE_VERSION', '0.6.0');
// Version du schéma des tables : l'incrémenter relance dbDelta au chargement suivant.
define('YOUVAPE_LOGISTIQUE_DB_VERSION', '1');
// Le préfixe « wc- » est obligatoire : ne pas le changer.
define('YOUVAPE_LOGISTIQUE_NAMESPACE', 'wc-youvape-logistique/v1');
define('YOUVAPE_LOGISTIQUE_DIR', plugin_dir_path(__FILE__));

require_once YOUVAPE_LOGISTIQUE_DIR . 'includes/install.php';
require_once YOUVAPE_LOGISTIQUE_DIR . 'includes/settings.php';
require_once YOUVAPE_LOGISTIQUE_DIR . 'includes/helpers.php';
require_once YOUVAPE_LOGISTIQUE_DIR . 'includes/silence.php';
require_once YOUVAPE_LOGISTIQUE_DIR . 'includes/stock.php';
require_once YOUVAPE_LOGISTIQUE_DIR . 'includes/orders.php';
require_once YOUVAPE_LOGISTIQUE_DIR . 'includes/refunds.php';
require_once YOUVAPE_LOGISTIQUE_DIR . 'includes/rest.php';

// Toutes les lectures et écritures de commande passent par le CRUD WooCommerce.
add_action('before_woocommerce_init', function () {
    if (class_exists('\Automattic\WooCommerce\Utilities\FeaturesUtil')) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', __FILE__, true);
    }
});

register_activation_hook(__FILE__, 'youvape_logistique_install');

// Une mise à jour par fichiers ne relance pas l'activation : le schéma est vérifié à chaque chargement.
add_action('plugins_loaded', 'youvape_logistique_maybe_upgrade');
