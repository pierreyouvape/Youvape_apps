<?php
/**
 * Settings - Gère la configuration du plugin
 *
 * @package YouvapeSync
 */

if (!defined('ABSPATH')) {
    exit;
}

class Youvape_Sync_Settings {

    /**
     * Nom de l'option
     */
    const OPTION_NAME = 'youvape_sync_settings';

    /**
     * Constructeur
     */
    public function __construct() {
        add_action('admin_init', array($this, 'register_settings'));
        add_action('wp_ajax_youvape_sync_save_settings', array($this, 'ajax_save_settings'));
        add_action('wp_ajax_youvape_sync_test_connection', array($this, 'ajax_test_connection'));
    }

    /**
     * Enregistre les paramètres
     */
    public function register_settings() {
        register_setting('youvape_sync_settings_group', self::OPTION_NAME, array(
            'type' => 'array',
            'sanitize_callback' => array($this, 'sanitize_settings'),
        ));
    }

    /**
     * Sanitize les paramètres
     *
     * @param array $input Données entrées
     * @return array Données sanitizées
     */
    public function sanitize_settings($input) {
        $sanitized = array();

        // URL de l'API
        if (isset($input['api_url'])) {
            $sanitized['api_url'] = esc_url_raw($input['api_url']);
        }

        // Clé API
        if (isset($input['api_key'])) {
            $sanitized['api_key'] = sanitize_text_field($input['api_key']);
        }

        // Batch size
        if (isset($input['batch_size'])) {
            $batch_size = intval($input['batch_size']);
            $sanitized['batch_size'] = max(1, min(100, $batch_size)); // Entre 1 et 100
        }

        // Time restriction
        $sanitized['enable_time_restriction'] = isset($input['enable_time_restriction']) ? (bool) $input['enable_time_restriction'] : false;

        if (isset($input['time_start'])) {
            $sanitized['time_start'] = sanitize_text_field($input['time_start']);
        }

        if (isset($input['time_end'])) {
            $sanitized['time_end'] = sanitize_text_field($input['time_end']);
        }

        // Types de données activés
        $sanitized['enable_customers'] = isset($input['enable_customers']) ? (bool) $input['enable_customers'] : false;
        $sanitized['enable_products'] = isset($input['enable_products']) ? (bool) $input['enable_products'] : false;
        $sanitized['enable_orders'] = isset($input['enable_orders']) ? (bool) $input['enable_orders'] : false;

        // Live sync
        $sanitized['live_sync_enabled'] = isset($input['live_sync_enabled']) ? (bool) $input['live_sync_enabled'] : false;

        if (isset($input['live_sync_delay'])) {
            $delay = intval($input['live_sync_delay']);
            $sanitized['live_sync_delay'] = max(0, min(3600, $delay)); // Entre 0 et 3600 secondes (1h)
        }

        return $sanitized;
    }

    /**
     * AJAX: Sauvegarde les paramètres
     */
    public function ajax_save_settings() {
        check_ajax_referer('youvape_sync_nonce', 'nonce');

        if (!current_user_can('manage_options')) {
            wp_send_json_error(array('message' => __('Permissions insuffisantes.', 'youvape-sync')));
        }

        $settings = isset($_POST['settings']) ? $_POST['settings'] : array();
        $sanitized = $this->sanitize_settings($settings);

        update_option(self::OPTION_NAME, $sanitized);

        wp_send_json_success(array(
            'message' => __('Paramètres sauvegardés avec succès.', 'youvape-sync'),
            'settings' => $sanitized,
        ));
    }

    /**
     * AJAX: Teste la connexion à l'API
     */
    public function ajax_test_connection() {
        check_ajax_referer('youvape_sync_nonce', 'nonce');

        if (!current_user_can('manage_options')) {
            wp_send_json_error(array('message' => __('Permissions insuffisantes.', 'youvape-sync')));
        }

        $api_client = new Youvape_Sync_API_Client();
        $result = $api_client->test_connection();

        if ($result['success']) {
            wp_send_json_success($result);
        } else {
            wp_send_json_error($result);
        }
    }

    /**
     * Retourne tous les paramètres
     *
     * @return array
     */
    public function get_settings() {
        $defaults = array(
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
            'live_sync_delay' => 60,
        );

        $settings = get_option(self::OPTION_NAME, array());

        return wp_parse_args($settings, $defaults);
    }

    /**
     * Retourne un paramètre spécifique
     *
     * @param string $key Clé du paramètre
     * @param mixed $default Valeur par défaut
     * @return mixed
     */
    public function get_setting($key, $default = null) {
        $settings = $this->get_settings();
        return isset($settings[$key]) ? $settings[$key] : $default;
    }

    /**
     * Met à jour un paramètre
     *
     * @param string $key Clé du paramètre
     * @param mixed $value Valeur
     * @return bool
     */
    public function update_setting($key, $value) {
        $settings = $this->get_settings();
        $settings[$key] = $value;

        return update_option(self::OPTION_NAME, $settings);
    }

    /**
     * Réinitialise les paramètres aux valeurs par défaut
     *
     * @return bool
     */
    public function reset_settings() {
        return delete_option(self::OPTION_NAME);
    }

    /**
     * Vérifie si la configuration est valide
     *
     * @return array Résultat de validation
     */
    public function validate_configuration() {
        $settings = $this->get_settings();
        $errors = array();

        if (empty($settings['api_url'])) {
            $errors[] = __('URL de l\'API non configurée.', 'youvape-sync');
        }

        if (!filter_var($settings['api_url'], FILTER_VALIDATE_URL)) {
            $errors[] = __('URL de l\'API invalide.', 'youvape-sync');
        }

        if (!$settings['enable_customers'] && !$settings['enable_products'] && !$settings['enable_orders']) {
            $errors[] = __('Aucun type de données activé pour la synchronisation.', 'youvape-sync');
        }

        if ($settings['enable_time_restriction']) {
            if (empty($settings['time_start']) || empty($settings['time_end'])) {
                $errors[] = __('Plage horaire incomplète.', 'youvape-sync');
            }
        }

        return array(
            'valid' => empty($errors),
            'errors' => $errors,
        );
    }

    /**
     * Retourne des statistiques sur la configuration
     *
     * @return array
     */
    public function get_config_stats() {
        $settings = $this->get_settings();
        $batch_status = get_option('youvape_sync_batch_status', false);
        $queue = get_option('youvape_sync_live_queue', array());

        return array(
            'api_configured' => !empty($settings['api_url']),
            'api_url' => $settings['api_url'],
            'batch_size' => $settings['batch_size'],
            'live_sync_enabled' => $settings['live_sync_enabled'],
            'live_sync_delay' => $settings['live_sync_delay'],
            'time_restriction_enabled' => $settings['enable_time_restriction'],
            'types_enabled' => array(
                'customers' => $settings['enable_customers'],
                'products' => $settings['enable_products'],
                'orders' => $settings['enable_orders'],
            ),
            'batch_import_running' => $batch_status && $batch_status['status'] === 'running',
            'live_queue_size' => count($queue),
        );
    }
}
