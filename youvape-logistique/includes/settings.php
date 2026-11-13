<?php
/**
 * Réglages, stockés dans une seule option et modifiables par la route
 * POST settings. Les valeurs par défaut vivent ici ; l'option ne garde que
 * ce qui a été enregistré, complété par ces défauts à la lecture.
 *
 * Trois statuts, ceux que le plugin POSE :
 * - ship_status      : quand l'expédition est confirmée ;
 * - pickup_status    : pour un retrait boutique ;
 * - delivered_status : à la livraison.
 * Quelles commandes sont « à expédier » ne regarde pas le plugin : c'est l'app
 * qui en décide, à partir des commandes qu'elle importe.
 *
 * Deux interrupteurs, coupés par défaut, pour faire tourner le plugin en prod
 * pendant que BMS gère encore statuts et stock :
 * - status_changes_enabled : coupé, le plugin écrit les métas d'expédition
 *   mais ne change AUCUN statut et n'envoie aucun mail ;
 * - stock_changes_enabled : coupé, le plugin refuse tout mouvement de stock
 *   (BMS réécrit le stock chaque nuit, nos écarts seraient effacés).
 *
 * Statuts toujours écrits SANS le préfixe « wc- ».
 */

if (!defined('ABSPATH')) {
    exit;
}

define('YOUVAPE_LOGISTIQUE_OPTION', 'youvape_logistique_settings');

function youvape_logistique_default_settings() {
    return array(
        // Métas écrites sur la commande à l'expédition (un seul colis par commande).
        'meta_keys'          => array(
            'carrier'         => '_yv_carrier',
            'carrier_label'   => '_yv_carrier_label',
            'tracking_number' => '_yv_tracking_number',
            'tracking_url'    => '_yv_tracking_url',
            'shipped_at'      => '_yv_shipped_at',
        ),
        'ship_status'        => 'completed',
        'pickup_status'      => 'awaiting-delivery',
        'delivered_status'   => 'delivered',
        'status_changes_enabled' => false,
        'stock_changes_enabled'  => false,
        // Lignes par requête, et temps au-delà duquel les lignes restantes sont rendues sans être traitées.
        'batch_max'          => 100,
        'time_budget'        => 20,
    );
}

/**
 * Statuts interdits partout, comme cible et comme départ, quels que soient les
 * réglages. Passer une commande en « annulée » remet son stock : ce passage ne
 * doit jamais pouvoir se faire en silence par ce plugin.
 */
function youvape_logistique_forbidden_statuses() {
    return array('refunded', 'cancelled', 'failed', 'pending', 'checkout-draft', 'trash', 'draft', 'auto-draft');
}

function youvape_logistique_single_status_keys() {
    return array('ship_status', 'pickup_status', 'delivered_status');
}

/** Les statuts que pose le plugin, sans doublon. */
function youvape_logistique_configured_statuses($settings) {
    $statuses = array();
    foreach (youvape_logistique_single_status_keys() as $key) {
        $statuses[] = $settings[$key];
    }
    return array_values(array_unique($statuses));
}

/** Expédiée, retrait boutique ou livrée : la commande est déjà partie. */
function youvape_logistique_is_shipped_status($status, $settings) {
    return in_array($status, youvape_logistique_configured_statuses($settings), true);
}

/**
 * Réglages effectifs : enregistrés, complétés par les défauts. Une liste
 * enregistrée REMPLACE la liste par défaut (jamais de fusion d'index). Une clé
 * enregistrée qui n'existe plus dans les défauts (réglages des versions
 * précédentes) est ignorée, et disparaît au prochain enregistrement.
 */
function youvape_logistique_settings() {
    $defaults = youvape_logistique_default_settings();
    $saved    = get_option(YOUVAPE_LOGISTIQUE_OPTION, array());
    if (!is_array($saved)) {
        return $defaults;
    }
    $settings = $defaults;
    foreach ($defaults as $key => $default) {
        if (!array_key_exists($key, $saved)) {
            continue;
        }
        if ($key === 'meta_keys') {
            if (is_array($saved[$key])) {
                foreach ($default as $sub => $unused) {
                    if (isset($saved[$key][$sub]) && is_string($saved[$key][$sub]) && $saved[$key][$sub] !== '') {
                        $settings[$key][$sub] = $saved[$key][$sub];
                    }
                }
            }
        } elseif (gettype($saved[$key]) === gettype($default)) {
            $settings[$key] = $saved[$key];
        }
    }
    return $settings;
}

function youvape_logistique_normalize_status($status) {
    if (!is_string($status)) {
        return '';
    }
    $status = strtolower(trim($status));
    return strpos($status, 'wc-') === 0 ? substr($status, 3) : $status;
}

/** Le statut est-il enregistré sur le site ? WooCommerce passe en « pending » un statut inconnu. */
function youvape_logistique_status_registered($status) {
    return function_exists('wc_get_order_statuses') && array_key_exists('wc-' . $status, wc_get_order_statuses());
}

/** Un statut saisi : retourne le statut normalisé, ou un message d'erreur dans $error. */
function youvape_logistique_clean_status($value, $key, &$error) {
    $status = is_string($value) ? youvape_logistique_normalize_status($value) : '';
    if (!preg_match('/^[a-z0-9_\-]{1,40}$/', $status)) {
        $error = sprintf('%s : statut invalide.', $key);
        return null;
    }
    if (in_array($status, youvape_logistique_forbidden_statuses(), true)) {
        $error = sprintf('%s : le statut « %s » est interdit par le plugin.', $key, $status);
        return null;
    }
    return $status;
}

/**
 * Valide une mise à jour PARTIELLE. Retourne
 * array('settings' => réglages complets, 'errors' => [], 'warnings' => []).
 * Une seule erreur et rien n'est enregistré.
 */
function youvape_logistique_validate_settings($input) {
    $settings = youvape_logistique_settings();
    $defaults = youvape_logistique_default_settings();
    $errors   = array();
    $warnings = array();

    if (!is_array($input)) {
        return array('settings' => $settings, 'errors' => array('Le corps doit être un objet JSON.'), 'warnings' => array());
    }

    foreach ($input as $key => $value) {
        if (!array_key_exists($key, $defaults)) {
            $errors[] = sprintf('Réglage inconnu : %s.', $key);
            continue;
        }

        if ($key === 'meta_keys') {
            if (!is_array($value)) {
                $errors[] = sprintf('%s doit être un objet.', $key);
                continue;
            }
            foreach ($value as $sub => $meta_key) {
                if (!array_key_exists($sub, $defaults[$key])) {
                    $errors[] = sprintf('%s.%s : clé inconnue.', $key, $sub);
                } elseif (!is_string($meta_key) || !preg_match('/^[A-Za-z0-9_\-]{1,191}$/', $meta_key)) {
                    $errors[] = sprintf('%s.%s : nom de méta invalide (lettres, chiffres, _ et -, 191 caractères au plus).', $key, $sub);
                } else {
                    $settings[$key][$sub] = $meta_key;
                }
            }
            continue;
        }

        if (in_array($key, youvape_logistique_single_status_keys(), true)) {
            $error  = null;
            $status = youvape_logistique_clean_status($value, $key, $error);
            if ($status === null) {
                $errors[] = $error;
            } else {
                $settings[$key] = $status;
            }
            continue;
        }

        switch ($key) {
            case 'status_changes_enabled':
            case 'stock_changes_enabled':
                if (!is_bool($value)) {
                    $errors[] = sprintf('%s doit valoir true ou false.', $key);
                } else {
                    $settings[$key] = $value;
                }
                break;

            case 'batch_max':
                if (!is_int($value) || $value < 1 || $value > 200) {
                    $errors[] = 'batch_max doit être un entier entre 1 et 200.';
                } else {
                    $settings[$key] = $value;
                }
                break;

            case 'time_budget':
                if (!is_int($value) || $value < 5 || $value > 60) {
                    $errors[] = 'time_budget doit être un entier entre 5 et 60 (secondes).';
                } else {
                    $settings[$key] = $value;
                }
                break;
        }
    }

    if (in_array($settings['delivered_status'], array($settings['ship_status'], $settings['pickup_status']), true)) {
        $errors[] = 'delivered_status : la livraison doit avoir son propre statut.';
    }
    if (count(array_unique($settings['meta_keys'])) !== count($settings['meta_keys'])) {
        $errors[] = 'meta_keys : deux usages portent le même nom de méta.';
    }

    foreach (youvape_logistique_configured_statuses($settings) as $status) {
        if (!youvape_logistique_status_registered($status)) {
            $warnings[] = sprintf('« %s » n\'est pas un statut enregistré sur le site (refusé tant qu\'il ne l\'est pas).', $status);
        }
    }

    return array('settings' => $settings, 'errors' => $errors, 'warnings' => $warnings);
}
