<?php
/**
 * Client HTTP server-to-server vers l'API Node Youvape (/api/client-sav).
 *
 * Sécurité :
 *  - Le secret partagé (YOUVAPE_SAV_API_SECRET = CLIENT_SAV_SECRET côté backend)
 *    est envoyé dans l'en-tête x-client-sav-secret. Il ne quitte jamais le
 *    serveur : aucun appel n'est fait depuis le navigateur du client.
 *  - L'identité du client est TOUJOURS get_current_user_id() (session WP),
 *    envoyée dans x-wp-user-id. Jamais une valeur fournie par le client.
 *
 * Toutes les méthodes retournent soit les données décodées, soit un objet
 * WP_Error en cas de problème (config manquante, réseau, HTTP != 2xx).
 */

if (!defined('ABSPATH')) {
    exit;
}

class Youvape_SAV_Api_Client {

    /** @var int Timeout des requêtes (secondes) */
    const TIMEOUT = 15;

    /**
     * URL de base de l'API. Priorité : constante wp-config, sinon réglages plugin.
     * Publique : les templates en ont besoin pour préfixer les URLs relatives
     * des pièces jointes (servies par l'API Node, ex. /api/sav/attachments/…).
     * @return string
     */
    public static function api_url() {
        if (defined('YOUVAPE_SAV_API_URL') && YOUVAPE_SAV_API_URL) {
            return YOUVAPE_SAV_API_URL;
        }
        return class_exists('Youvape_SAV_Settings') ? Youvape_SAV_Settings::get('api_url') : '';
    }

    /**
     * Secret partagé. Priorité : constante wp-config, sinon réglages plugin.
     * @return string
     */
    private static function api_secret() {
        if (defined('YOUVAPE_SAV_API_SECRET') && YOUVAPE_SAV_API_SECRET) {
            return YOUVAPE_SAV_API_SECRET;
        }
        return class_exists('Youvape_SAV_Settings') ? Youvape_SAV_Settings::get('api_secret') : '';
    }

    /**
     * GET /api/client-sav/tickets — liste des tickets du client connecté.
     *
     * @return array|WP_Error tableau de tickets, ou WP_Error
     */
    public static function get_tickets() {
        $res = self::request('GET', '/api/client-sav/tickets');
        if (is_wp_error($res)) {
            return $res;
        }
        return isset($res['tickets']) && is_array($res['tickets']) ? $res['tickets'] : array();
    }

    /**
     * GET /api/client-sav/tickets/{id} — détail d'un ticket du client connecté.
     *
     * @param int $id identifiant du ticket
     * @return array|WP_Error le ticket (avec messages), ou WP_Error
     */
    public static function get_ticket($id) {
        $id = (int) $id;
        if ($id <= 0) {
            return new WP_Error('youvape_sav_bad_id', __('Demande invalide.', 'youvape-sav-client'));
        }
        $res = self::request('GET', '/api/client-sav/tickets/' . $id);
        if (is_wp_error($res)) {
            return $res;
        }
        return isset($res['ticket']) && is_array($res['ticket']) ? $res['ticket'] : new WP_Error(
            'youvape_sav_not_found',
            __('Demande introuvable.', 'youvape-sav-client')
        );
    }

    /**
     * GET /api/client-sav/orders — commandes du client (pour sélecteur).
     *
     * @return array|WP_Error
     */
    public static function get_orders() {
        $res = self::request('GET', '/api/client-sav/orders');
        if (is_wp_error($res)) {
            return $res;
        }
        return isset($res['orders']) && is_array($res['orders']) ? $res['orders'] : array();
    }

    /**
     * POST /api/client-sav/tickets — création d'un ticket (multipart, avec PJ).
     *
     * @param array $fields ['subject'=>..,'body'=>..,'order_id'=>..,'product'=>..]
     * @param array $files  fichiers uploadés au format $_FILES['attachments']
     *                      (tableaux name/type/tmp_name/error/size), ou []
     * @return array|WP_Error réponse JSON (avec ticket_id), ou WP_Error
     */
    public static function create_ticket($fields, $files = array()) {
        return self::request_multipart('/api/client-sav/tickets', $fields, $files);
    }

    /**
     * POST /api/client-sav/tickets/{id}/reply — réponse du client (multipart).
     *
     * @param int   $id    identifiant du ticket
     * @param array $fields ['body' => ...]
     * @param array $files  $_FILES['attachments'] ou []
     * @return array|WP_Error
     */
    public static function reply_ticket($id, $fields, $files = array()) {
        $id = (int) $id;
        if ($id <= 0) {
            return new WP_Error('youvape_sav_bad_id', __('Demande invalide.', 'youvape-sav-client'));
        }
        return self::request_multipart('/api/client-sav/tickets/' . $id . '/reply', $fields, $files);
    }

    /**
     * Effectue la requête HTTP authentifiée vers l'API Node.
     *
     * @param string     $method GET|POST...
     * @param string     $path   chemin commençant par /
     * @param array|null $body   corps JSON (POST), ou null
     * @return array|WP_Error réponse JSON décodée, ou WP_Error
     */
    private static function request($method, $path, $body = null) {
        // 1. Configuration présente ?
        $api_url = self::api_url();
        $api_secret = self::api_secret();
        if (!$api_url || !$api_secret) {
            return new WP_Error(
                'youvape_sav_config',
                __('Espace client SAV non configuré (URL ou secret API manquant).', 'youvape-sav-client')
            );
        }

        // 2. Client connecté ? (l'identité vient de la session WP, jamais du client)
        $user_id = get_current_user_id();
        if (!$user_id) {
            return new WP_Error(
                'youvape_sav_not_logged_in',
                __('Vous devez être connecté.', 'youvape-sav-client')
            );
        }

        $url = rtrim($api_url, '/') . $path;

        $args = array(
            'method'  => $method,
            'timeout' => self::TIMEOUT,
            'headers' => array(
                'x-client-sav-secret' => $api_secret,
                'x-wp-user-id'        => (string) $user_id,
                'Accept'              => 'application/json',
            ),
        );

        if (null !== $body) {
            $args['headers']['Content-Type'] = 'application/json';
            $args['body'] = wp_json_encode($body);
        }

        $response = wp_remote_request($url, $args);

        // 3. Erreur réseau / transport
        if (is_wp_error($response)) {
            return $response;
        }

        $code = (int) wp_remote_retrieve_response_code($response);
        $raw  = wp_remote_retrieve_body($response);
        $data = json_decode($raw, true);

        // 4. Statut HTTP non 2xx
        if ($code < 200 || $code >= 300) {
            $message = is_array($data) && isset($data['error'])
                ? $data['error']
                : sprintf(__('Erreur API (%d).', 'youvape-sav-client'), $code);
            return new WP_Error('youvape_sav_http_' . $code, $message, array('status' => $code));
        }

        // 5. Réponse non JSON
        if (null === $data && '' !== trim((string) $raw)) {
            return new WP_Error(
                'youvape_sav_bad_json',
                __('Réponse inattendue du service.', 'youvape-sav-client')
            );
        }

        return is_array($data) ? $data : array();
    }

    /**
     * Requête POST multipart/form-data (champs + fichiers), authentifiée.
     * Construit le corps multipart à la main car wp_remote_post n'encode pas
     * nativement des fichiers.
     *
     * @param string $path
     * @param array  $fields champs simples (clé => valeur scalaire)
     * @param array  $files  structure $_FILES['attachments'] (multiple), ou []
     * @return array|WP_Error
     */
    private static function request_multipart($path, $fields, $files) {
        // Mêmes garde-fous que request() : config + identité serveur.
        $api_url = self::api_url();
        $api_secret = self::api_secret();
        if (!$api_url || !$api_secret) {
            return new WP_Error(
                'youvape_sav_config',
                __('Espace client SAV non configuré (URL ou secret API manquant).', 'youvape-sav-client')
            );
        }
        $user_id = get_current_user_id();
        if (!$user_id) {
            return new WP_Error('youvape_sav_not_logged_in', __('Vous devez être connecté.', 'youvape-sav-client'));
        }

        $boundary = wp_generate_password(24, false);
        $eol = "\r\n";
        $body = '';

        // Champs simples
        foreach ((array) $fields as $name => $value) {
            if (is_array($value)) {
                continue;
            }
            $body .= '--' . $boundary . $eol;
            $body .= 'Content-Disposition: form-data; name="' . $name . '"' . $eol . $eol;
            $body .= $value . $eol;
        }

        // Fichiers : champ "attachments" (multiple). On normalise la structure
        // $_FILES (qui est "colonne par colonne" quand le name est attachments[]).
        $normalized = self::normalize_files($files);
        foreach ($normalized as $file) {
            if (!empty($file['error']) || empty($file['tmp_name']) || !is_uploaded_file($file['tmp_name'])) {
                continue;
            }
            $content = file_get_contents($file['tmp_name']);
            if (false === $content) {
                continue;
            }
            $fname = sanitize_file_name($file['name']);
            $type  = $file['type'] ? $file['type'] : 'application/octet-stream';
            $body .= '--' . $boundary . $eol;
            $body .= 'Content-Disposition: form-data; name="attachments"; filename="' . $fname . '"' . $eol;
            $body .= 'Content-Type: ' . $type . $eol . $eol;
            $body .= $content . $eol;
        }

        $body .= '--' . $boundary . '--' . $eol;

        $url = rtrim($api_url, '/') . $path;
        $response = wp_remote_post($url, array(
            'timeout' => self::TIMEOUT,
            'headers' => array(
                'x-client-sav-secret' => $api_secret,
                'x-wp-user-id'        => (string) $user_id,
                'Accept'              => 'application/json',
                'Content-Type'        => 'multipart/form-data; boundary=' . $boundary,
            ),
            'body' => $body,
        ));

        if (is_wp_error($response)) {
            return $response;
        }

        $code = (int) wp_remote_retrieve_response_code($response);
        $raw  = wp_remote_retrieve_body($response);
        $data = json_decode($raw, true);

        if ($code < 200 || $code >= 300) {
            $message = is_array($data) && isset($data['error'])
                ? $data['error']
                : sprintf(__('Erreur API (%d).', 'youvape-sav-client'), $code);
            return new WP_Error('youvape_sav_http_' . $code, $message, array('status' => $code));
        }

        return is_array($data) ? $data : array();
    }

    /**
     * Normalise $_FILES pour un champ multiple "attachments[]" en une liste de
     * fichiers individuels [{name,type,tmp_name,error,size}, ...].
     *
     * @param array $files
     * @return array
     */
    private static function normalize_files($files) {
        if (empty($files) || empty($files['name'])) {
            return array();
        }
        // Cas multiple : chaque clé est un tableau indexé.
        if (is_array($files['name'])) {
            $out = array();
            $count = count($files['name']);
            for ($i = 0; $i < $count; $i++) {
                $out[] = array(
                    'name'     => isset($files['name'][$i]) ? $files['name'][$i] : '',
                    'type'     => isset($files['type'][$i]) ? $files['type'][$i] : '',
                    'tmp_name' => isset($files['tmp_name'][$i]) ? $files['tmp_name'][$i] : '',
                    'error'    => isset($files['error'][$i]) ? $files['error'][$i] : UPLOAD_ERR_NO_FILE,
                    'size'     => isset($files['size'][$i]) ? $files['size'][$i] : 0,
                );
            }
            return $out;
        }
        // Cas fichier unique
        return array($files);
    }
}
