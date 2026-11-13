<?php
/**
 * Exécuter un changement de commande SANS qu'aucun mail ne parte.
 *
 * Quatre verrous, posés le temps du callback puis retirés :
 *
 * 1. WooCommerce branche ses mails transactionnels sur les hooks de statut
 *    (`woocommerce_order_status_{to}`, `…_{from}_to_{to}`), y compris ceux
 *    que d'autres plugins déclarent par le filtre `woocommerce_email_actions`
 *    (statuts personnalisés). Le callback est soit `send_transactional_email`
 *    (envoi immédiat), soit `queue_transactional_email` (mails différés : mis
 *    en file pendant la requête, envoyés plus tard par Action Scheduler).
 *    On le débranche de ces hooks : rien n'est envoyé ni mis en file.
 * 2. `woocommerce_email_enabled_{id}` répond « non » pour tous les mails
 *    WooCommerce enregistrés : couvre un plugin qui appellerait directement
 *    `$email->trigger()`, et empêche la programmation de la demande d'avis
 *    (le planificateur ne programme rien si le mail est désactivé).
 * 3. `pre_wp_mail` court-circuite tout `wp_mail()` de la requête pendant le
 *    callback, quel que soit le plugin qui l'appelle.
 * 4. `pre_http_request` intercepte les appels aux prestataires qui écrivent
 *    aux clients par leur propre API (youvape_logistique_silent_hosts) : ils
 *    ne passent par aucun des trois verrous précédents.
 *
 * Non couvert : un plugin qui programmerait lui-même un envoi asynchrone sur
 * ce changement de statut, ou un prestataire absent de la liste du verrou 4.
 *
 * Retourne array('value' => retour du callback, 'mails_blocked' => n).
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Prestataires ACTUELS du site qui écrivent aux clients sans passer par
 * WordPress : mails transactionnels et invitations à laisser un avis.
 * Cette liste suit les prestataires : en cas de changement, la mettre à jour,
 * sinon un envoi « sans mail » écrira quand même au client.
 */
function youvape_logistique_silent_hosts() {
    return array('probancemail.com', 'guaranteed-reviews.com');
}

function youvape_logistique_is_silent_host($url) {
    $host = strtolower((string) wp_parse_url($url, PHP_URL_HOST));
    foreach (youvape_logistique_silent_hosts() as $silent) {
        if ($host === $silent || substr($host, -strlen('.' . $silent)) === '.' . $silent) {
            return true;
        }
    }
    return false;
}

function youvape_logistique_silently($from, $to, callable $callback) {
    $hooks = array('woocommerce_order_status_' . $to);
    if ($from !== '' && $from !== $to) {
        $hooks[] = 'woocommerce_order_status_' . $from . '_to_' . $to;
    }

    // 1. Débrancher les mails transactionnels de WooCommerce.
    $removed = array();
    foreach ($hooks as $hook) {
        foreach (array('queue_transactional_email', 'send_transactional_email') as $method) {
            $callback_ref = array('WC_Emails', $method);
            $priority     = has_action($hook, $callback_ref);
            if ($priority !== false) {
                remove_action($hook, $callback_ref, $priority);
                $removed[] = array($hook, $callback_ref, $priority);
            }
        }
    }

    // 2. Tous les mails WooCommerce désactivés.
    // Fermeture propre au plugin : la retirer ne retire jamais le filtre d'un autre.
    $disable          = function () {
        return false;
    };
    $disabled_filters = array();
    if (function_exists('WC') && WC()->mailer()) {
        foreach (WC()->mailer()->get_emails() as $email) {
            if (is_object($email) && !empty($email->id)) {
                $filter = 'woocommerce_email_enabled_' . $email->id;
                add_filter($filter, $disable, PHP_INT_MAX);
                $disabled_filters[] = $filter;
            }
        }
    }

    // 3. Aucun wp_mail().
    $blocked     = 0;
    $mail_filter = function ($return) use (&$blocked) {
        $blocked++;
        return false;
    };
    add_filter('pre_wp_mail', $mail_filter, PHP_INT_MAX);

    // 4. Aucun appel aux prestataires. Un faux succès, et non une erreur : sur un
    //    échec, l'intégration du thème se rabat sur le mail WooCommerce et le laisse
    //    réactivé pour le reste de la requête, donc pour les lignes suivantes du lot.
    $http_filter = function ($pre, $args, $url) use (&$blocked) {
        if ($pre !== false || !youvape_logistique_is_silent_host($url)) {
            return $pre;
        }
        $blocked++;
        return array(
            'headers'  => array(),
            'body'     => '',
            'response' => array('code' => 200, 'message' => 'OK'),
            'cookies'  => array(),
            'filename' => null,
        );
    };
    add_filter('pre_http_request', $http_filter, PHP_INT_MAX, 3);

    try {
        $value = $callback();
    } finally {
        remove_filter('pre_http_request', $http_filter, PHP_INT_MAX);
        remove_filter('pre_wp_mail', $mail_filter, PHP_INT_MAX);
        foreach ($disabled_filters as $filter) {
            remove_filter($filter, $disable, PHP_INT_MAX);
        }
        // WooCommerce les déclare avec 10 arguments acceptés.
        foreach ($removed as $item) {
            add_action($item[0], $item[1], $item[2], 10);
        }
    }

    return array('value' => $value, 'mails_blocked' => $blocked);
}
