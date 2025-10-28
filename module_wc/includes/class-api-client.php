<?php
/**
 * API Client - Gère les envois HTTP vers l'API Node.js
 *
 * @package YouvapeSync
 */

if (!defined('ABSPATH')) {
    exit;
}

class Youvape_Sync_API_Client {

    /**
     * URL de base de l'API
     */
    private $api_url;

    /**
     * Clé API pour l'authentification
     */
    private $api_key;

    /**
     * Timeout pour les requêtes HTTP (en secondes)
     */
    private $timeout = 30;

    /**
     * Nombre de tentatives en cas d'échec
     */
    private $max_retries = 3;

    /**
     * Constructeur
     */
    public function __construct() {
        $settings = get_option('youvape_sync_settings', array());
        $this->api_url = isset($settings['api_url']) ? rtrim($settings['api_url'], '/') : '';
        $this->api_key = isset($settings['api_key']) ? $settings['api_key'] : '';
    }

    /**
     * Envoie un batch de clients
     *
     * @param array $customers Tableau de clients
     * @param string $action Type d'action (batch_import ou live_update)
     * @return array Résultat de l'envoi
     */
    public function send_customers($customers, $action = 'batch_import') {
        return $this->send_batch('/api/woo-sync/customers', array(
            'batch' => $customers,
            'action' => $action,
        ));
    }

    /**
     * Envoie un batch de produits
     *
     * @param array $products Tableau de produits
     * @param string $action Type d'action (batch_import ou live_update)
     * @return array Résultat de l'envoi
     */
    public function send_products($products, $action = 'batch_import') {
        return $this->send_batch('/api/woo-sync/products', array(
            'batch' => $products,
            'action' => $action,
        ));
    }

    /**
     * Envoie un batch de commandes
     *
     * @param array $orders Tableau de commandes
     * @param string $action Type d'action (batch_import ou live_update)
     * @return array Résultat de l'envoi
     */
    public function send_orders($orders, $action = 'batch_import') {
        return $this->send_batch('/api/woo-sync/orders', array(
            'batch' => $orders,
            'action' => $action,
        ));
    }

    /**
     * Envoie un batch vers l'API avec gestion des erreurs et retry
     *
     * @param string $endpoint Endpoint de l'API (ex: /api/woo-sync/customers)
     * @param array $data Données à envoyer
     * @return array Résultat de l'envoi
     */
    private function send_batch($endpoint, $data) {
        // Validation
        if (empty($this->api_url)) {
            return array(
                'success' => false,
                'error' => __('URL de l\'API non configurée.', 'youvape-sync'),
                'code' => 'missing_api_url',
            );
        }

        $url = $this->api_url . $endpoint;
        $attempt = 0;
        $last_error = '';

        // Retry avec backoff exponentiel
        while ($attempt < $this->max_retries) {
            $attempt++;

            $response = $this->make_request($url, $data);

            if ($response['success']) {
                return $response;
            }

            $last_error = $response['error'];

            // Si c'est une erreur 4xx (client), on ne retry pas
            if (isset($response['http_code']) && $response['http_code'] >= 400 && $response['http_code'] < 500) {
                break;
            }

            // Backoff exponentiel (1s, 2s, 4s)
            if ($attempt < $this->max_retries) {
                sleep(pow(2, $attempt - 1));
            }
        }

        // Échec après toutes les tentatives
        return array(
            'success' => false,
            'error' => sprintf(
                __('Échec après %d tentatives. Dernière erreur: %s', 'youvape-sync'),
                $this->max_retries,
                $last_error
            ),
            'attempts' => $attempt,
        );
    }

    /**
     * Effectue une requête HTTP POST vers l'API
     *
     * @param string $url URL complète
     * @param array $data Données à envoyer
     * @return array Résultat de la requête
     */
    private function make_request($url, $data) {
        $headers = array(
            'Content-Type' => 'application/json',
        );

        // Ajoute la clé API si configurée
        if (!empty($this->api_key)) {
            $headers['Authorization'] = 'Bearer ' . $this->api_key;
        }

        $args = array(
            'method' => 'POST',
            'timeout' => $this->timeout,
            'headers' => $headers,
            'body' => wp_json_encode($data),
            'sslverify' => true,
        );

        // Log de la requête (en mode debug)
        if (defined('WP_DEBUG') && WP_DEBUG) {
            error_log(sprintf(
                'Youvape Sync: POST %s (batch size: %d)',
                $url,
                count($data['batch'])
            ));
        }

        $response = wp_remote_post($url, $args);

        // Gestion des erreurs WordPress
        if (is_wp_error($response)) {
            return array(
                'success' => false,
                'error' => $response->get_error_message(),
                'code' => $response->get_error_code(),
            );
        }

        $http_code = wp_remote_retrieve_response_code($response);
        $body = wp_remote_retrieve_body($response);
        $decoded_body = json_decode($body, true);

        // Succès (2xx)
        if ($http_code >= 200 && $http_code < 300) {
            return array(
                'success' => true,
                'http_code' => $http_code,
                'data' => $decoded_body,
            );
        }

        // Erreur HTTP
        return array(
            'success' => false,
            'http_code' => $http_code,
            'error' => sprintf(
                __('Erreur HTTP %d: %s', 'youvape-sync'),
                $http_code,
                isset($decoded_body['message']) ? $decoded_body['message'] : wp_remote_retrieve_response_message($response)
            ),
            'response_body' => $decoded_body,
        );
    }

    /**
     * Teste la connexion à l'API
     *
     * @return array Résultat du test
     */
    public function test_connection() {
        if (empty($this->api_url)) {
            return array(
                'success' => false,
                'error' => __('URL de l\'API non configurée.', 'youvape-sync'),
            );
        }

        // Endpoint de test (ping)
        $url = $this->api_url . '/api/woo-sync/ping';

        $headers = array(
            'Content-Type' => 'application/json',
        );

        if (!empty($this->api_key)) {
            $headers['Authorization'] = 'Bearer ' . $this->api_key;
        }

        $args = array(
            'method' => 'GET',
            'timeout' => 10,
            'headers' => $headers,
            'sslverify' => true,
        );

        $response = wp_remote_get($url, $args);

        if (is_wp_error($response)) {
            return array(
                'success' => false,
                'error' => $response->get_error_message(),
            );
        }

        $http_code = wp_remote_retrieve_response_code($response);

        if ($http_code >= 200 && $http_code < 300) {
            return array(
                'success' => true,
                'message' => __('Connexion réussie à l\'API.', 'youvape-sync'),
            );
        }

        return array(
            'success' => false,
            'error' => sprintf(
                __('Erreur HTTP %d', 'youvape-sync'),
                $http_code
            ),
        );
    }

    /**
     * Met à jour l'URL de l'API
     *
     * @param string $url Nouvelle URL
     */
    public function set_api_url($url) {
        $this->api_url = rtrim($url, '/');
    }

    /**
     * Met à jour la clé API
     *
     * @param string $key Nouvelle clé
     */
    public function set_api_key($key) {
        $this->api_key = $key;
    }

    /**
     * Retourne l'URL de l'API
     *
     * @return string
     */
    public function get_api_url() {
        return $this->api_url;
    }

    /**
     * Vérifie si l'API est configurée
     *
     * @return bool
     */
    public function is_configured() {
        return !empty($this->api_url);
    }
}
