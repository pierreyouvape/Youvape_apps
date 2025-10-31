<?php
/**
 * Plugin Name: Youvape Sync
 * Plugin URI: https://youvape.com
 * Description: Synchronise les données WooCommerce (clients, produits, commandes) vers l'API Node.js externe. Import historique par lots + synchro temps réel.
 * Version: 1.2.0
 * Author: Youvape
 * Author URI: https://youvape.com
 * Text Domain: youvape-sync
 * Domain Path: /languages
 * Requires at least: 5.8
 * Requires PHP: 7.4
 * WC requires at least: 5.0
 * WC tested up to: 8.0
 *
 * @package YouvapeSync
 */

// Si accédé directement, on quitte
if (!defined('ABSPATH')) {
    exit;
}

// Constantes du plugin
define('YOUVAPE_SYNC_VERSION', '1.2.0');
define('YOUVAPE_SYNC_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('YOUVAPE_SYNC_PLUGIN_URL', plugin_dir_url(__FILE__));
define('YOUVAPE_SYNC_PLUGIN_BASENAME', plugin_basename(__FILE__));

/**
 * Classe principale du plugin Youvape Sync
 */
class Youvape_Sync {

    /**
     * Instance unique du plugin (Singleton)
     */
    private static $instance = null;

    /**
     * API Client
     */
    public $api_client;

    /**
     * Batch Processor
     */
    public $batch_processor;

    /**
     * Event Listener
     */
    public $event_listener;

    /**
     * Settings
     */
    public $settings;

    /**
     * Retourne l'instance unique du plugin
     */
    public static function instance() {
        if (is_null(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Constructeur
     */
    private function __construct() {
        $this->init_hooks();
        $this->load_dependencies();
        $this->init_components();
    }

    /**
     * Initialise les hooks WordPress
     */
    private function init_hooks() {
        // Activation / Désactivation
        register_activation_hook(__FILE__, array($this, 'activate'));
        register_deactivation_hook(__FILE__, array($this, 'deactivate'));

        // Init
        add_action('plugins_loaded', array($this, 'check_dependencies'));
        add_action('init', array($this, 'load_textdomain'));

        // Admin
        if (is_admin()) {
            add_action('admin_menu', array($this, 'add_admin_menu'));
            add_action('admin_enqueue_scripts', array($this, 'enqueue_admin_assets'));
        }

        // AJAX endpoints pour l'import batch
        add_action('wp_ajax_youvape_sync_start_batch', array($this, 'ajax_start_batch'));
        add_action('wp_ajax_youvape_sync_process_batch', array($this, 'ajax_process_batch'));
        add_action('wp_ajax_youvape_sync_get_status', array($this, 'ajax_get_status'));
        add_action('wp_ajax_youvape_sync_stop_batch', array($this, 'ajax_stop_batch'));
        add_action('wp_ajax_youvape_sync_send_test_sample', array($this, 'ajax_send_test_sample'));

        // Export des logs
        add_action('admin_post_youvape_sync_export_logs', array($this, 'export_logs'));
    }

    /**
     * Charge les dépendances
     */
    private function load_dependencies() {
        require_once YOUVAPE_SYNC_PLUGIN_DIR . 'includes/class-api-client.php';
        require_once YOUVAPE_SYNC_PLUGIN_DIR . 'includes/class-batch-processor.php';
        require_once YOUVAPE_SYNC_PLUGIN_DIR . 'includes/class-event-listener.php';
        require_once YOUVAPE_SYNC_PLUGIN_DIR . 'includes/class-settings.php';
    }

    /**
     * Initialise les composants
     */
    private function init_components() {
        $this->api_client = new Youvape_Sync_API_Client();
        $this->batch_processor = new Youvape_Sync_Batch_Processor($this->api_client);
        $this->event_listener = new Youvape_Sync_Event_Listener($this->api_client);
        $this->settings = new Youvape_Sync_Settings();
    }

    /**
     * Vérifie que WooCommerce est actif
     */
    public function check_dependencies() {
        if (!class_exists('WooCommerce')) {
            add_action('admin_notices', array($this, 'woocommerce_missing_notice'));
            deactivate_plugins(YOUVAPE_SYNC_PLUGIN_BASENAME);
            return;
        }
    }

    /**
     * Notice si WooCommerce est manquant
     */
    public function woocommerce_missing_notice() {
        ?>
        <div class="notice notice-error">
            <p><?php esc_html_e('Youvape Sync nécessite WooCommerce pour fonctionner. Veuillez installer et activer WooCommerce.', 'youvape-sync'); ?></p>
        </div>
        <?php
    }

    /**
     * Charge les traductions
     */
    public function load_textdomain() {
        load_plugin_textdomain('youvape-sync', false, dirname(YOUVAPE_SYNC_PLUGIN_BASENAME) . '/languages');
    }

    /**
     * Ajoute le menu admin
     */
    public function add_admin_menu() {
        add_menu_page(
            __('Youvape Sync', 'youvape-sync'),
            __('Youvape Sync', 'youvape-sync'),
            'manage_options',
            'youvape-sync',
            array($this, 'render_admin_page'),
            'dashicons-update',
            56
        );
    }

    /**
     * Affiche la page admin
     */
    public function render_admin_page() {
        require_once YOUVAPE_SYNC_PLUGIN_DIR . 'admin/settings-page.php';
    }

    /**
     * Enqueue des assets admin
     */
    public function enqueue_admin_assets($hook) {
        if ($hook !== 'toplevel_page_youvape-sync') {
            return;
        }

        wp_enqueue_style(
            'youvape-sync-admin',
            YOUVAPE_SYNC_PLUGIN_URL . 'admin/css/admin.css',
            array(),
            YOUVAPE_SYNC_VERSION
        );

        wp_enqueue_script(
            'youvape-sync-admin',
            YOUVAPE_SYNC_PLUGIN_URL . 'admin/js/admin.js',
            array('jquery'),
            YOUVAPE_SYNC_VERSION,
            true
        );

        wp_localize_script('youvape-sync-admin', 'youvapeSyncAdmin', array(
            'ajax_url' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('youvape_sync_nonce'),
            'strings' => array(
                'confirm_start' => __('Êtes-vous sûr de vouloir lancer l\'import historique ?', 'youvape-sync'),
                'confirm_stop' => __('Êtes-vous sûr de vouloir arrêter l\'import en cours ?', 'youvape-sync'),
            ),
        ));
    }

    /**
     * AJAX: Démarre un import batch
     */
    public function ajax_start_batch() {
        check_ajax_referer('youvape_sync_nonce', 'nonce');

        if (!current_user_can('manage_options')) {
            wp_send_json_error(array('message' => __('Permissions insuffisantes.', 'youvape-sync')));
        }

        $result = $this->batch_processor->start_batch_import();

        if ($result['success']) {
            wp_send_json_success($result);
        } else {
            wp_send_json_error($result);
        }
    }

    /**
     * AJAX: Traite un lot (appelé en boucle par le frontend)
     */
    public function ajax_process_batch() {
        check_ajax_referer('youvape_sync_nonce', 'nonce');

        if (!current_user_can('manage_options')) {
            wp_send_json_error(array('message' => __('Permissions insuffisantes.', 'youvape-sync')));
        }

        $result = $this->batch_processor->process_next_batch();

        if ($result['success']) {
            wp_send_json_success($result);
        } else {
            wp_send_json_error($result);
        }
    }

    /**
     * AJAX: Récupère le statut de l'import
     */
    public function ajax_get_status() {
        check_ajax_referer('youvape_sync_nonce', 'nonce');

        if (!current_user_can('manage_options')) {
            wp_send_json_error(array('message' => __('Permissions insuffisantes.', 'youvape-sync')));
        }

        $status = $this->batch_processor->get_import_status();
        wp_send_json_success($status);
    }

    /**
     * AJAX: Arrête l'import en cours
     */
    public function ajax_stop_batch() {
        check_ajax_referer('youvape_sync_nonce', 'nonce');

        if (!current_user_can('manage_options')) {
            wp_send_json_error(array('message' => __('Permissions insuffisantes.', 'youvape-sync')));
        }

        $result = $this->batch_processor->stop_batch_import();

        if ($result['success']) {
            wp_send_json_success($result);
        } else {
            wp_send_json_error($result);
        }
    }

    /**
     * AJAX: Envoie un échantillon de test
     */
    public function ajax_send_test_sample() {
        check_ajax_referer('youvape_sync_nonce', 'nonce');

        if (!current_user_can('manage_options')) {
            wp_send_json_error(array('message' => __('Permissions insuffisantes.', 'youvape-sync')));
        }

        $customers_count = isset($_POST['customers_count']) ? intval($_POST['customers_count']) : 5;
        $products_count = isset($_POST['products_count']) ? intval($_POST['products_count']) : 5;
        $orders_count = isset($_POST['orders_count']) ? intval($_POST['orders_count']) : 5;

        $result = $this->batch_processor->send_test_sample($customers_count, $products_count, $orders_count);

        if ($result['success']) {
            wp_send_json_success($result);
        } else {
            wp_send_json_error($result);
        }
    }

    /**
     * Exporte les logs en fichier texte téléchargeable
     */
    public function export_logs() {
        // Vérification sécurité
        if (!current_user_can('manage_options')) {
            wp_die(__('Permissions insuffisantes.', 'youvape-sync'));
        }

        check_admin_referer('youvape_sync_export_logs');

        // Récupère les données
        $batch_status = get_option('youvape_sync_batch_status', false);
        $settings = get_option('youvape_sync_settings', array());
        $queue = get_option('youvape_sync_live_queue', array());

        // Génère le contenu du fichier
        $content = "=== YOUVAPE SYNC - EXPORT DES LOGS ===\n";
        $content .= "Date d'export: " . current_time('Y-m-d H:i:s') . "\n";
        $content .= "Version du plugin: " . YOUVAPE_SYNC_VERSION . "\n\n";

        // Configuration
        $content .= "--- CONFIGURATION ---\n";
        $content .= "URL API: " . ($settings['api_url'] ?? 'Non configurée') . "\n";
        $content .= "Batch size: " . ($settings['batch_size'] ?? 25) . "\n";
        $content .= "Types activés: ";
        $content .= ($settings['enable_customers'] ?? false ? "Clients " : "");
        $content .= ($settings['enable_products'] ?? false ? "Produits " : "");
        $content .= ($settings['enable_orders'] ?? false ? "Commandes " : "");
        $content .= "\n";
        $content .= "Synchro live: " . ($settings['live_sync_enabled'] ?? false ? "Activée" : "Désactivée") . "\n";
        $content .= "Délai synchro live: " . ($settings['live_sync_delay'] ?? 60) . "s\n";
        $content .= "Restriction horaire: " . ($settings['enable_time_restriction'] ?? false ? "Activée (" . ($settings['time_start'] ?? '00:00') . " - " . ($settings['time_end'] ?? '00:00') . ")" : "Désactivée") . "\n\n";

        // Statut import batch
        if ($batch_status) {
            $content .= "--- DERNIER IMPORT BATCH ---\n";
            $content .= "Statut: " . ($batch_status['status'] ?? 'Inconnu') . "\n";
            $content .= "Démarré le: " . ($batch_status['started_at'] ?? 'N/A') . "\n";
            if (isset($batch_status['completed_at'])) {
                $content .= "Terminé le: " . $batch_status['completed_at'] . "\n";
            }
            if (isset($batch_status['stopped_at'])) {
                $content .= "Arrêté le: " . $batch_status['stopped_at'] . "\n";
            }
            $content .= "Type actuel: " . ($batch_status['current_type'] ?? 'N/A') . "\n";
            $content .= "Offset actuel: " . ($batch_status['current_offset'] ?? 0) . "\n\n";

            // Totaux
            $content .= "Totaux à importer:\n";
            $content .= "  - Clients: " . ($batch_status['totals']['customers'] ?? 0) . "\n";
            $content .= "  - Produits: " . ($batch_status['totals']['products'] ?? 0) . "\n";
            $content .= "  - Commandes: " . ($batch_status['totals']['orders'] ?? 0) . "\n\n";

            // Traités
            $content .= "Items traités:\n";
            $content .= "  - Clients: " . ($batch_status['processed']['customers'] ?? 0) . "\n";
            $content .= "  - Produits: " . ($batch_status['processed']['products'] ?? 0) . "\n";
            $content .= "  - Commandes: " . ($batch_status['processed']['orders'] ?? 0) . "\n\n";

            // Erreurs
            if (!empty($batch_status['errors'])) {
                $content .= "Erreurs (" . count($batch_status['errors']) . "):\n";
                foreach ($batch_status['errors'] as $i => $error) {
                    $content .= "\nErreur #" . ($i + 1) . ":\n";
                    $content .= "  Type: " . ($error['type'] ?? 'N/A') . "\n";
                    $content .= "  Offset: " . ($error['offset'] ?? 'N/A') . "\n";
                    $content .= "  Message: " . ($error['error'] ?? 'N/A') . "\n";
                    $content .= "  Date: " . ($error['time'] ?? 'N/A') . "\n";
                }
                $content .= "\n";
            } else {
                $content .= "Aucune erreur.\n\n";
            }
        } else {
            $content .= "--- DERNIER IMPORT BATCH ---\n";
            $content .= "Aucun import batch effectué.\n\n";
        }

        // Queue live
        $content .= "--- SYNCHRO LIVE ---\n";
        $content .= "Taille de la queue: " . count($queue) . " événement(s)\n";
        if (!empty($queue)) {
            $content .= "\nÉvénements en attente:\n";
            foreach ($queue as $key => $item) {
                $content .= "  - " . $item['type'] . " #" . $item['item_id'];
                $content .= " (prévu à " . date('Y-m-d H:i:s', $item['send_at']) . ")\n";
            }
        }
        $content .= "\n";

        // Informations système
        $content .= "--- INFORMATIONS SYSTÈME ---\n";
        $content .= "WordPress: " . get_bloginfo('version') . "\n";
        $content .= "WooCommerce: " . (defined('WC_VERSION') ? WC_VERSION : 'Non installé') . "\n";
        $content .= "PHP: " . phpversion() . "\n";
        $content .= "URL du site: " . get_site_url() . "\n";
        $content .= "\n=== FIN DES LOGS ===\n";

        // Headers pour le téléchargement
        $filename = 'youvape-sync-logs-' . date('Y-m-d-His') . '.txt';
        header('Content-Type: text/plain; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Content-Length: ' . strlen($content));
        header('Cache-Control: no-cache, no-store, must-revalidate');
        header('Pragma: no-cache');
        header('Expires: 0');

        echo $content;
        exit;
    }

    /**
     * Activation du plugin
     */
    public function activate() {
        // Initialise les options par défaut
        $default_settings = array(
            'api_url' => '',
            'api_key' => '',
            'batch_size' => 25,
            'enable_time_restriction' => false,
            'time_start' => '02:00',
            'time_end' => '06:00',
            'enable_customers' => true,
            'enable_products' => true,
            'enable_orders' => true,
            'live_sync_enabled' => true,
            'live_sync_delay' => 60, // 1 minute
        );

        if (!get_option('youvape_sync_settings')) {
            add_option('youvape_sync_settings', $default_settings);
        }

        // Log l'activation
        error_log('Youvape Sync: Plugin activé');
    }

    /**
     * Désactivation du plugin
     */
    public function deactivate() {
        // Arrête tout import en cours
        delete_option('youvape_sync_batch_status');

        // Log la désactivation
        error_log('Youvape Sync: Plugin désactivé');
    }
}

/**
 * Retourne l'instance principale du plugin
 */
function youvape_sync() {
    return Youvape_Sync::instance();
}

// Démarre le plugin
youvape_sync();
