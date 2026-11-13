<?php
/**
 * Outils communs aux routes : résultats par ligne, lecture stricte des champs,
 * verrou par commande.
 */

if (!defined('ABSPATH')) {
    exit;
}

/** Une ligne refusée ou en échec. */
function youvape_logistique_line_error($code, $message, $extra = array()) {
    return array_merge($extra, array(
        'result'  => 'error',
        'code'    => $code,
        'message' => $message,
    ));
}

/** Entier strict : int, ou texte d'entier (« 12 », « -3 »). Sinon null. */
function youvape_logistique_int($value) {
    if (is_int($value)) {
        return $value;
    }
    if (is_string($value) && preg_match('/^-?\d{1,18}$/', $value)) {
        return (int) $value;
    }
    if (is_float($value) && floor($value) === $value && abs($value) < 1e15) {
        return (int) $value;
    }
    return null;
}

/** Identifiant fourni par l'app (movement_id, shipment_id). */
function youvape_logistique_valid_external_id($value) {
    return is_string($value) && preg_match('/^[A-Za-z0-9._:\-]{1,64}$/', $value);
}

/** Texte optionnel, nettoyé, de $max caractères au plus. null si invalide. */
function youvape_logistique_text($value, $max, $multiline = false) {
    if ($value === null) {
        return '';
    }
    if (!is_string($value) && !is_int($value)) {
        return null;
    }
    $value = $multiline ? sanitize_textarea_field((string) $value) : sanitize_text_field((string) $value);
    return mb_strlen($value) <= $max ? $value : null;
}

/** Ce qui identifie la ligne dans la réponse, même si la ligne est invalide. */
function youvape_logistique_echo_id($line, $key) {
    if (is_array($line) && isset($line[$key]) && is_scalar($line[$key])) {
        return $line[$key];
    }
    return null;
}

/**
 * Date ISO 8601. Sans fuseau, elle est lue dans le fuseau du site.
 * Retourne un DateTimeImmutable ou null.
 */
function youvape_logistique_parse_datetime($value) {
    if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+\-]\d{2}:?\d{2})?$/', $value)) {
        return null;
    }
    try {
        return new DateTimeImmutable($value, wp_timezone());
    } catch (\Exception $e) {
        return null;
    }
}

function youvape_logistique_now_utc() {
    return gmdate('Y-m-d H:i:s');
}

/**
 * Verrou MySQL nommé par commande : deux requêtes sur la même commande
 * s'attendent au lieu d'écraser la liste des colis l'une de l'autre.
 */
function youvape_logistique_lock_order($order_id) {
    global $wpdb;
    return (string) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 10)', youvape_logistique_lock_name($order_id))) === '1';
}

function youvape_logistique_unlock_order($order_id) {
    global $wpdb;
    $wpdb->query($wpdb->prepare('SELECT RELEASE_LOCK(%s)', youvape_logistique_lock_name($order_id)));
}

function youvape_logistique_lock_name($order_id) {
    global $wpdb;
    // 64 caractères au plus pour MySQL ; le préfixe distingue deux sites sur la même base.
    return substr('yvl_' . md5(DB_NAME . $wpdb->prefix) . '_' . (int) $order_id, 0, 64);
}
