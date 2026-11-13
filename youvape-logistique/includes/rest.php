<?php
/**
 * Routes REST.
 *
 * Les routes d'écriture prennent un LOT et répondent une ligne de résultat
 * par ligne reçue, dans le même ordre (`index`). Jamais de succès global :
 * HTTP 200 veut seulement dire que le lot a été lu, chaque ligne dit ce qui
 * lui est arrivé (applied / already / error / not_processed).
 */

if (!defined('ABSPATH')) {
    exit;
}

function youvape_logistique_can() {
    return current_user_can('manage_woocommerce');
}

function youvape_logistique_error($code, $message, $status, $data = array()) {
    return new WP_Error($code, $message, array_merge($data, array('status' => $status)));
}

add_action('rest_api_init', function () {
    register_rest_route(YOUVAPE_LOGISTIQUE_NAMESPACE, '/status', array(
        'methods'             => 'GET',
        'callback'            => 'youvape_logistique_rest_status',
        'permission_callback' => 'youvape_logistique_can',
    ));
    register_rest_route(YOUVAPE_LOGISTIQUE_NAMESPACE, '/settings', array(
        array(
            'methods'             => 'GET',
            'callback'            => 'youvape_logistique_rest_get_settings',
            'permission_callback' => 'youvape_logistique_can',
        ),
        array(
            'methods'             => 'POST',
            'callback'            => 'youvape_logistique_rest_update_settings',
            'permission_callback' => 'youvape_logistique_can',
        ),
    ));
    register_rest_route(YOUVAPE_LOGISTIQUE_NAMESPACE, '/stock/adjust', array(
        'methods'             => 'POST',
        'callback'            => function (WP_REST_Request $request) {
            return youvape_logistique_run_batch($request, 'movements', array('movement_id'), 'youvape_logistique_stock_adjust_line', true);
        },
        'permission_callback' => 'youvape_logistique_can',
    ));
    register_rest_route(YOUVAPE_LOGISTIQUE_NAMESPACE, '/order/ship', array(
        'methods'             => 'POST',
        'callback'            => function (WP_REST_Request $request) {
            return youvape_logistique_run_batch($request, 'shipments', array('shipment_id', 'order_id'), 'youvape_logistique_ship_line', true);
        },
        'permission_callback' => 'youvape_logistique_can',
    ));
    register_rest_route(YOUVAPE_LOGISTIQUE_NAMESPACE, '/order/status', array(
        'methods'             => 'POST',
        'callback'            => function (WP_REST_Request $request) {
            return youvape_logistique_run_batch($request, 'orders', array('order_id'), 'youvape_logistique_status_line', false);
        },
        'permission_callback' => 'youvape_logistique_can',
    ));
});

/**
 * Exécute un lot ligne par ligne. Au-delà de time_budget secondes, les lignes
 * restantes sont rendues en « not_processed » (à renvoyer) plutôt que de
 * risquer un dépassement du temps PHP qui ferait perdre toutes les réponses.
 */
function youvape_logistique_run_batch(WP_REST_Request $request, $key, $id_keys, $handler, $needs_tables) {
    if (!function_exists('wc_get_order')) {
        return youvape_logistique_error('WOOCOMMERCE_MISSING', 'WooCommerce n\'est pas chargé.', 503);
    }
    if ($needs_tables && !youvape_logistique_tables_ready()) {
        return youvape_logistique_error('TABLES_MISSING', 'Les tables du plugin sont absentes : désactiver puis réactiver le plugin.', 503);
    }

    $settings = youvape_logistique_settings();
    $lines    = $request->get_param($key);
    if (!is_array($lines) || empty($lines) || array_keys($lines) !== range(0, count($lines) - 1)) {
        return youvape_logistique_error('INVALID_BATCH', sprintf('Le corps doit contenir « %s » : une liste non vide de lignes.', $key), 400);
    }
    if (count($lines) > $settings['batch_max']) {
        return youvape_logistique_error('BATCH_TOO_LARGE', sprintf('%d lignes reçues, %d au plus par requête.', count($lines), $settings['batch_max']), 400, array('batch_max' => $settings['batch_max']));
    }

    $start   = microtime(true);
    $counts  = array('applied' => 0, 'already' => 0, 'error' => 0, 'not_processed' => 0);
    $results = array();
    foreach ($lines as $index => $line) {
        $ids = array();
        foreach ($id_keys as $id_key) {
            $ids[$id_key] = youvape_logistique_echo_id($line, $id_key);
        }

        if (microtime(true) - $start > $settings['time_budget']) {
            $result = array_merge($ids, array(
                'result'  => 'not_processed',
                'code'    => 'TIME_BUDGET',
                'message' => 'Temps de requête épuisé avant cette ligne : rien n\'a été fait, la renvoyer.',
            ));
        } else {
            try {
                $result = call_user_func($handler, $line, $settings);
            } catch (\Throwable $e) {
                $result = youvape_logistique_line_error('EXCEPTION', $e->getMessage(), $ids);
            }
        }

        $counts[$result['result']]++;
        $results[] = array_merge(array('index' => $index), $result);
    }

    return rest_ensure_response(array(
        'version'  => YOUVAPE_LOGISTIQUE_VERSION,
        'received' => count($lines),
        'counts'   => $counts,
        'results'  => $results,
    ));
}

function youvape_logistique_rest_status() {
    $settings = youvape_logistique_settings();

    $hpos = null;
    if (class_exists('\Automattic\WooCommerce\Utilities\OrderUtil')) {
        $hpos = \Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled();
    }
    $deferred = null;
    if (class_exists('\Automattic\WooCommerce\Utilities\FeaturesUtil')) {
        try {
            $deferred = (bool) apply_filters(
                'woocommerce_defer_transactional_emails',
                \Automattic\WooCommerce\Utilities\FeaturesUtil::feature_is_enabled('deferred_transactional_emails')
            );
        } catch (\Throwable $e) {
            $deferred = null;
        }
    }

    $statuses = array();
    foreach (youvape_logistique_configured_statuses($settings) as $status) {
        $statuses[$status] = array(
            'registered' => youvape_logistique_status_registered($status),
            'label'      => function_exists('wc_get_order_status_name') ? wc_get_order_status_name($status) : null,
        );
    }

    return rest_ensure_response(array(
        'version'                  => YOUVAPE_LOGISTIQUE_VERSION,
        'woocommerce_version'      => defined('WC_VERSION') ? WC_VERSION : null,
        'hpos_enabled'             => $hpos,
        'hpos_sync_enabled'        => get_option('woocommerce_custom_orders_table_data_sync_enabled') === 'yes',
        'deferred_emails'          => $deferred,
        'stock_management_enabled' => get_option('woocommerce_manage_stock') === 'yes',
        'woosb_active'             => defined('WOOSB_VERSION'),
        'woosb_version'            => defined('WOOSB_VERSION') ? WOOSB_VERSION : null,
        'db_version'               => get_option('youvape_logistique_db_version', null),
        'tables_ready'             => youvape_logistique_tables_ready(),
        'status_changes_enabled'   => !empty($settings['status_changes_enabled']),
        'stock_changes_enabled'    => !empty($settings['stock_changes_enabled']),
        'batch_max'                => $settings['batch_max'],
        'time_budget'              => $settings['time_budget'],
        'statuses'                 => $statuses,
    ));
}

function youvape_logistique_rest_get_settings() {
    return rest_ensure_response(array(
        'settings'            => youvape_logistique_settings(),
        'defaults'            => youvape_logistique_default_settings(),
        'forbidden_statuses'  => youvape_logistique_forbidden_statuses(),
        'registered_statuses' => function_exists('wc_get_order_statuses') ? wc_get_order_statuses() : array(),
    ));
}

/** Mise à jour PARTIELLE : seules les clés envoyées changent. Une erreur et rien n'est enregistré. */
function youvape_logistique_rest_update_settings(WP_REST_Request $request) {
    $input = $request->get_json_params();
    if (!is_array($input) || empty($input)) {
        return youvape_logistique_error('INVALID_SETTINGS', 'Le corps doit être un objet JSON contenant au moins un réglage.', 400);
    }

    $checked = youvape_logistique_validate_settings($input);
    if (!empty($checked['errors'])) {
        return youvape_logistique_error('INVALID_SETTINGS', 'Réglages refusés, rien n\'a été enregistré.', 400, array('errors' => $checked['errors']));
    }

    update_option(YOUVAPE_LOGISTIQUE_OPTION, $checked['settings']);
    return rest_ensure_response(array(
        'settings' => youvape_logistique_settings(),
        'warnings' => $checked['warnings'],
    ));
}
