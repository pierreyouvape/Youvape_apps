<?php
/**
 * Plugin Name:       Youvape — Points fidélité
 * Plugin URI:        https://www.youvape.fr
 * Description:       Crédite et retire des points WPLoyalty avec un vrai motif (avoir de retour SAV, avis partagé) et le n° de commande, pour l'app Youvape. L'API REST de WPLoyalty enregistre tout sous le type « REST API », sans motif.
 * Version:           1.0.0
 * Author:            Youvape
 * Text Domain:       youvape-loyalty
 * Requires at least: 6.0
 * Requires PHP:      7.4
 *
 * Routes (authentifiées par les clés WooCommerce — le préfixe « wc- » du
 * namespace est ce qui permet à WooCommerce de les accepter) :
 *   POST /wp-json/wc-youvape-loyalty/v1/points/add
 *   POST /wp-json/wc-youvape-loyalty/v1/points/reduce
 *   GET  /wp-json/wc-youvape-loyalty/v1/status
 *
 * Lire AVANT-DE-MODIFIER.md avant toute mise à jour.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('YOUVAPE_LOYALTY_VERSION', '1.0.0');
define('YOUVAPE_LOYALTY_NAMESPACE', 'wc-youvape-loyalty/v1');

/**
 * Nos types d'action WPLoyalty. Le libellé est ce que montre la colonne
 * « Action name » de l'admin (Customers → Transaction Details).
 */
function youvape_loyalty_types() {
    return array(
        'avoir' => array('action' => 'youvape_avoir', 'label' => 'Avoir retour SAV'),
        'avis'  => array('action' => 'youvape_avis', 'label' => 'Avis partagé'),
    );
}

add_filter('wlr_extra_action_list', function ($action_list) {
    if (!is_array($action_list)) {
        return $action_list;
    }
    foreach (youvape_loyalty_types() as $type) {
        $action_list[$type['action']] = $type['label'];
    }
    return $action_list;
});

/** Les classes et méthodes de WPLoyalty 1.4.3 sur lesquelles on s'appuie. */
function youvape_loyalty_wployalty_ready() {
    return class_exists('\Wlr\App\Helpers\EarnCampaign')
        && class_exists('\Wlr\App\Helpers\Woocommerce')
        && class_exists('\Wlr\App\Models\Users')
        && method_exists('\Wlr\App\Helpers\EarnCampaign', 'addExtraPointAction')
        && method_exists('\Wlr\App\Helpers\Woocommerce', 'getInstance')
        && method_exists('\Wlr\App\Helpers\Woocommerce', 'isBannedUser')
        && method_exists('\Wlr\App\Models\Users', 'getQueryData');
}

function youvape_loyalty_error($code, $message, $status) {
    return new WP_Error($code, $message, array('status' => $status));
}

function youvape_loyalty_can() {
    return current_user_can('manage_woocommerce');
}

function youvape_loyalty_find_user($email) {
    $users = new \Wlr\App\Models\Users();
    return $users->getQueryData(
        array('user_email' => array('operator' => '=', 'value' => $email)),
        '*',
        array(),
        false
    );
}

add_action('rest_api_init', function () {
    $args = array(
        'user_email' => array('required' => true, 'type' => 'string', 'format' => 'email'),
        'points'     => array('required' => true, 'type' => 'integer', 'minimum' => 1),
        'type'       => array('required' => true, 'type' => 'string', 'enum' => array_keys(youvape_loyalty_types())),
        // 180 = taille de `customer_command` dans wlr_earn_campaign_transaction.
        'note'       => array('required' => true, 'type' => 'string', 'minLength' => 1, 'maxLength' => 180),
        'order_id'   => array('required' => false, 'type' => 'integer', 'minimum' => 1),
    );
    register_rest_route(YOUVAPE_LOYALTY_NAMESPACE, '/points/add', array(
        'methods'             => 'POST',
        'callback'            => function (WP_REST_Request $request) {
            return youvape_loyalty_points($request, 'credit');
        },
        'permission_callback' => 'youvape_loyalty_can',
        'args'                => $args,
    ));
    register_rest_route(YOUVAPE_LOYALTY_NAMESPACE, '/points/reduce', array(
        'methods'             => 'POST',
        'callback'            => function (WP_REST_Request $request) {
            return youvape_loyalty_points($request, 'debit');
        },
        'permission_callback' => 'youvape_loyalty_can',
        'args'                => $args,
    ));
    register_rest_route(YOUVAPE_LOYALTY_NAMESPACE, '/status', array(
        'methods'             => 'GET',
        'callback'            => function () {
            return rest_ensure_response(array(
                'version'           => YOUVAPE_LOYALTY_VERSION,
                'wployalty'         => youvape_loyalty_wployalty_ready(),
                'wployalty_version' => defined('WLR_PLUGIN_VERSION') ? WLR_PLUGIN_VERSION : null,
                'action_types'      => youvape_loyalty_types(),
            ));
        },
        'permission_callback' => 'youvape_loyalty_can',
    ));
});

/**
 * Crédit ou débit, par le même appel que l'admin WPLoyalty et sa propre API
 * (`addExtraPointAction`), mais sous notre type d'action et avec le motif.
 *
 * Le motif part dans trois champs : `customer_command` (colonne commentaire
 * de l'admin), `customer_note` (historique du client dans « Mon compte ») et
 * `note` (journal interne).
 */
function youvape_loyalty_points(WP_REST_Request $request, $trans_type) {
    try {
        if (!youvape_loyalty_wployalty_ready()) {
            return youvape_loyalty_error('wployalty_missing', 'WPLoyalty est absent, désactivé ou incompatible (classes attendues introuvables).', 503);
        }

        $email     = sanitize_email($request['user_email']);
        $requested = (int) $request['points'];
        $types     = youvape_loyalty_types();
        $action    = $types[$request['type']]['action'];
        $note      = sanitize_text_field($request['note']);
        $order_id  = (int) $request['order_id'];
        if ($note === '') {
            return youvape_loyalty_error('note_empty', 'Le motif est vide.', 400);
        }

        if (\Wlr\App\Helpers\Woocommerce::getInstance()->isBannedUser($email)) {
            return youvape_loyalty_error('banned', sprintf('%s est banni du programme de fidélité.', $email), 403);
        }

        $user    = youvape_loyalty_find_user($email);
        $balance = isset($user->points) ? (int) $user->points : 0;
        $points  = $requested;
        if ($trans_type === 'debit') {
            if (empty($user)) {
                return youvape_loyalty_error('customer_not_found', sprintf('%s est inconnu de WPLoyalty.', $email), 404);
            }
            if ($balance <= 0) {
                return youvape_loyalty_error('no_points', sprintf('%s n\'a plus aucun point.', $email), 409);
            }
            // Jamais sous 0 : on retire ce qui reste, la réponse le dit.
            $points = min($requested, $balance);
        }

        $action_data = array(
            'user_email'          => $email,
            'action_type'         => $action,
            'points'              => $points,
            'action_process_type' => $trans_type === 'credit' ? 'earn_point' : 'reduce_point',
            'note'                => $note,
            'customer_note'       => $note,
            'customer_command'    => $note,
            'order_id'            => $order_id,
        );
        if (empty($user)) {
            $action_data['referral_code'] = '';
        }

        $helper = new \Wlr\App\Helpers\EarnCampaign();
        if (!$helper->addExtraPointAction($action, $points, $action_data, $trans_type, false, true)) {
            return youvape_loyalty_error('wployalty_failed', 'WPLoyalty a refusé l\'opération (voir son journal).', 500);
        }

        $after = youvape_loyalty_find_user($email);
        return rest_ensure_response(array(
            'success'     => true,
            'points'      => $points,
            'requested'   => $requested,
            'balance'     => isset($after->points) ? (int) $after->points : null,
            'action_type' => $action,
            'order_id'    => $order_id,
            // Le n° est enregistré même si la commande n'existe plus : on le signale seulement.
            'order_found' => $order_id > 0 && function_exists('wc_get_order') ? (bool) wc_get_order($order_id) : null,
            'version'     => YOUVAPE_LOYALTY_VERSION,
        ));
    } catch (\Throwable $e) {
        return youvape_loyalty_error('youvape_loyalty_exception', 'Erreur pendant l\'appel à WPLoyalty : ' . $e->getMessage(), 500);
    }
}
