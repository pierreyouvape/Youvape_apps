<?php
/**
 * Auth - Contrôle d'accès aux routes.
 */

namespace YouSync;

defined('ABSPATH') || exit;

class Auth {

    const OPTION = 'yousync_auth';
    const HEADER = 'X-YouSync-Token';
    const GRACE_SECONDS = 900;

    /**
     * Reprend l'accès de la version précédente.
     */
    public static function import_legacy_token() {
        if (get_option(self::OPTION)) {
            return;
        }

        $settings = get_option('yousync_settings', []);
        if (is_array($settings) && !empty($settings['api_token']) && is_string($settings['api_token'])) {
            update_option(self::OPTION, ['hash' => hash('sha256', $settings['api_token'])], false);
        }
    }

    /**
     * La requête est-elle en HTTPS ?
     */
    public static function is_https() {
        if (is_ssl()) {
            return true;
        }
        return isset($_SERVER['HTTP_X_FORWARDED_PROTO'])
            && strtolower((string) $_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https';
    }

    /**
     * permission_callback des routes de lecture.
     *
     * @param \WP_REST_Request $request
     * @return true|\WP_Error
     */
    public static function check_request($request) {
        if (!self::is_https()) {
            return new \WP_Error('yousync_https_required', 'HTTPS obligatoire.', ['status' => 403]);
        }

        $auth = get_option(self::OPTION, []);
        if (!is_array($auth) || empty($auth['hash'])) {
            return new \WP_Error('yousync_token_missing', 'Accès non configuré.', ['status' => 503]);
        }

        $presented = (string) $request->get_header(self::HEADER);
        if ($presented !== '' && self::matches($auth, hash('sha256', $presented))) {
            return true;
        }

        return new \WP_Error('yousync_bad_token', 'Accès refusé.', ['status' => 401]);
    }

    /**
     * Accès courant, ou précédent pendant le délai de bascule.
     */
    private static function matches($auth, $hash) {
        $current = hash_equals($auth['hash'], $hash);
        $previous = !empty($auth['previous_hash'])
            && !empty($auth['previous_until'])
            && (int) $auth['previous_until'] > time()
            && hash_equals($auth['previous_hash'], $hash);

        return $current || $previous;
    }

    /**
     * Remplace l'accès, avec un délai de bascule. Rejouable sans effet de bord.
     *
     * @param mixed $token
     * @return true|\WP_Error
     */
    public static function rotate($token) {
        if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/', $token)) {
            return new \WP_Error('yousync_invalid_token', 'Jeton invalide.', ['status' => 400]);
        }

        $auth = get_option(self::OPTION, []);
        $auth = is_array($auth) ? $auth : [];
        $hash = hash('sha256', $token);

        if (!empty($auth['hash']) && hash_equals($auth['hash'], $hash)) {
            return true;
        }
        if (!empty($auth['previous_until']) && (int) $auth['previous_until'] > time()) {
            return new \WP_Error('yousync_rotation_in_progress', 'Renouvellement déjà en cours.', ['status' => 409]);
        }

        update_option(self::OPTION, [
            'hash' => $hash,
            'previous_hash' => $auth['hash'] ?? '',
            'previous_until' => time() + self::GRACE_SECONDS,
        ], false);

        $settings = get_option('yousync_settings', []);
        if (is_array($settings) && array_key_exists('api_token', $settings)) {
            unset($settings['api_token']);
            update_option('yousync_settings', $settings);
        }

        return true;
    }
}
