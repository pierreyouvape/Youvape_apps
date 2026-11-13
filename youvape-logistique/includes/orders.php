<?php
/**
 * Expédition et changements de statut des commandes, par le CRUD WooCommerce
 * uniquement (compatible HPOS : jamais get_post_meta / update_post_meta).
 *
 * Un seul colis par commande. Une étiquette refaite (changement d'adresse…)
 * REMPLACE l'envoi : `replace: true` sur order/ship.
 */

if (!defined('ABSPATH')) {
    exit;
}

/** Le statut existe-t-il sur le site ? Retourne null, ou la ligne d'erreur. */
function youvape_logistique_check_registered($status, $echo) {
    if (!youvape_logistique_status_registered($status)) {
        return youvape_logistique_line_error('STATUS_NOT_REGISTERED', sprintf('Le statut « %s » n\'existe pas sur le site.', $status), $echo);
    }
    return null;
}

function youvape_logistique_get_order($order_id) {
    $order = wc_get_order($order_id);
    // Un remboursement (WC_Order_Refund) n'est pas une WC_Order.
    return $order instanceof WC_Order ? $order : null;
}

/** Premier envoi enregistré pour la commande (même « pending »), ou null. */
function youvape_logistique_first_shipment($order_id) {
    global $wpdb;
    $table = youvape_logistique_table('shipments');
    return $wpdb->get_row($wpdb->prepare("SELECT * FROM {$table} WHERE order_id = %d ORDER BY id LIMIT 1", $order_id));
}

/* -------------------------------------------------------------------------
 * order/ship
 * ---------------------------------------------------------------------- */

/**
 * Ligne : { order_id, shipment_id, pickup (défaut false), replace (défaut
 * false), carrier, carrier_label, tracking_number, tracking_url, shipped_at,
 * notify_customer, note }.
 *
 * - Envoi normal : c'est l'app qui a décidé que la commande part. Le plugin
 *   refuse seulement une commande déjà partie (expédiée, retrait, livrée, ou
 *   avec un envoi enregistré) ou à un statut interdit. Elle passe au statut
 *   ship_status (ou pickup_status pour un retrait).
 * - replace : la commande est déjà au statut ship_status. Transporteur et suivi
 *   sont écrasés, le statut ne bouge pas, et le mail d'expédition est renvoyé
 *   si notify_customer (voir youvape_logistique_resend_shipped_mail).
 * - Changements de statut coupés (réglage status_changes_enabled) : seules les
 *   métas et la note sont écrites, quel que soit le statut de la commande (sauf
 *   interdit). Ni statut, ni mail. La règle du colis unique reste appliquée.
 */
function youvape_logistique_ship_line($line, $settings) {
    global $wpdb;

    $echo = array(
        'shipment_id' => youvape_logistique_echo_id($line, 'shipment_id'),
        'order_id'    => youvape_logistique_echo_id($line, 'order_id'),
    );
    if (!is_array($line)) {
        return youvape_logistique_line_error('INVALID_LINE', 'La ligne doit être un objet.', $echo);
    }

    $order_id        = youvape_logistique_int(isset($line['order_id']) ? $line['order_id'] : null);
    $shipment_id     = isset($line['shipment_id']) ? $line['shipment_id'] : null;
    $pickup          = isset($line['pickup']) ? $line['pickup'] : false;
    $replace         = isset($line['replace']) ? $line['replace'] : false;
    $carrier         = youvape_logistique_text(isset($line['carrier']) ? $line['carrier'] : null, 64);
    $carrier_label   = youvape_logistique_text(isset($line['carrier_label']) ? $line['carrier_label'] : null, 190);
    $tracking_number = youvape_logistique_text(isset($line['tracking_number']) ? $line['tracking_number'] : null, 190);
    $tracking_url    = isset($line['tracking_url']) ? $line['tracking_url'] : '';
    $note            = youvape_logistique_text(isset($line['note']) ? $line['note'] : null, 1000, true);
    $notify          = isset($line['notify_customer']) ? $line['notify_customer'] : null;

    if ($order_id === null || $order_id <= 0) {
        return youvape_logistique_line_error('INVALID_LINE', 'order_id doit être un entier positif.', $echo);
    }
    if (!youvape_logistique_valid_external_id($shipment_id)) {
        return youvape_logistique_line_error('INVALID_LINE', 'shipment_id manquant ou invalide (1 à 64 caractères parmi A-Z a-z 0-9 . _ : -).', $echo);
    }
    if (!is_bool($pickup) || !is_bool($replace)) {
        return youvape_logistique_line_error('INVALID_LINE', 'pickup et replace valent true ou false.', $echo);
    }
    if ($pickup && $replace) {
        return youvape_logistique_line_error('INVALID_LINE', 'Un retrait boutique n\'a pas d\'étiquette : il ne se remplace pas.', $echo);
    }
    if ($carrier === null || $carrier === '') {
        return youvape_logistique_line_error('INVALID_LINE', 'carrier est obligatoire (64 caractères au plus).', $echo);
    }
    if ($carrier_label === null || $tracking_number === null || $note === null) {
        return youvape_logistique_line_error('INVALID_LINE', 'carrier_label, tracking_number ou note invalide ou trop long (190, 190 et 1000 caractères au plus).', $echo);
    }
    if (!is_bool($notify)) {
        return youvape_logistique_line_error('INVALID_LINE', 'notify_customer est obligatoire et vaut true ou false.', $echo);
    }
    if (!is_string($tracking_url) || strlen($tracking_url) > 2000) {
        return youvape_logistique_line_error('INVALID_LINE', 'tracking_url doit être un texte de 2000 caractères au plus.', $echo);
    }
    if ($tracking_url !== '') {
        $clean_url = esc_url_raw($tracking_url, array('http', 'https'));
        if ($clean_url === '') {
            return youvape_logistique_line_error('INVALID_LINE', 'tracking_url doit être une adresse http(s).', $echo);
        }
        $tracking_url = $clean_url;
    }
    if (isset($line['shipped_at']) && $line['shipped_at'] !== '' && $line['shipped_at'] !== null) {
        $shipped_at = youvape_logistique_parse_datetime($line['shipped_at']);
        if ($shipped_at === null) {
            return youvape_logistique_line_error('INVALID_LINE', 'shipped_at doit être une date ISO 8601 (ex. 2026-10-27T14:05:00+01:00).', $echo);
        }
    } else {
        $shipped_at = new DateTimeImmutable('now', wp_timezone());
    }
    if ($carrier_label === '') {
        $carrier_label = $carrier;
    }

    $target      = $pickup ? $settings['pickup_status'] : $settings['ship_status'];
    $echo        = array('shipment_id' => $shipment_id, 'order_id' => $order_id);
    $fingerprint = md5($order_id . '|' . $target . '|' . ($replace ? 'replace' : 'ship') . '|' . $carrier . '|' . $tracking_number);
    $table       = youvape_logistique_table('shipments');

    $changes = !empty($settings['status_changes_enabled']);
    if ($changes) {
        $refused = youvape_logistique_check_registered($target, $echo);
        if ($refused !== null) {
            return $refused;
        }
    }

    $known = youvape_logistique_known_shipment($shipment_id, $fingerprint, $echo);
    if ($known !== null) {
        return $known;
    }

    if (!youvape_logistique_lock_order($order_id)) {
        return youvape_logistique_line_error('ORDER_LOCKED', 'La commande est en cours de modification par une autre requête : renvoyer la ligne.', $echo);
    }

    $stage = 'checks';
    try {
        $order = youvape_logistique_get_order($order_id);
        if (!$order) {
            return youvape_logistique_line_error('ORDER_NOT_FOUND', sprintf('La commande %d est introuvable.', $order_id), $echo);
        }

        $from  = $order->get_status();
        $first = youvape_logistique_first_shipment($order_id);
        $echo['status_before'] = $from;

        if (in_array($from, youvape_logistique_forbidden_statuses(), true)) {
            return youvape_logistique_line_error('ORDER_NOT_SHIPPABLE', sprintf('La commande %d est au statut « %s », qui ne s\'expédie pas.', $order_id, wc_get_order_status_name($from)), $echo);
        }
        if ($replace) {
            if ($changes && $from !== $target) {
                return youvape_logistique_line_error('ORDER_NOT_SHIPPABLE', sprintf('Remplacer un envoi : la commande %d doit être au statut « %s », elle est au statut « %s ».', $order_id, wc_get_order_status_name($target), wc_get_order_status_name($from)), $echo);
            }
        } elseif ($changes && youvape_logistique_is_shipped_status($from, $settings)) {
            // Statuts coupés : BMS a pu passer la commande en « expédiée » avant nous, ce n'est pas un refus.
            return youvape_logistique_line_error('ORDER_ALREADY_SHIPPED', sprintf('La commande %d est déjà au statut « %s » : pour une nouvelle étiquette, remplacer l\'envoi.', $order_id, wc_get_order_status_name($from)), $echo);
        } elseif ($first) {
            return youvape_logistique_line_error('ORDER_ALREADY_SHIPPED', sprintf('La commande %d a déjà un envoi (%s) : pour une nouvelle étiquette, remplacer l\'envoi.', $order_id, $first->shipment_id), $echo);
        }

        // Réservation de l'envoi.
        $shipped_utc = $shipped_at->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        $inserted    = $wpdb->query($wpdb->prepare(
            "INSERT IGNORE INTO {$table}
               (shipment_id, fingerprint, order_id, state, status_requested, status_from, carrier, carrier_label, tracking_number, tracking_url, shipped_at, notified, created_at)
             VALUES (%s, %s, %d, 'pending', %s, %s, %s, %s, %s, %s, %s, %d, %s)",
            $shipment_id,
            $fingerprint,
            $order_id,
            $target,
            $from,
            $carrier,
            $carrier_label,
            $tracking_number,
            $tracking_url,
            $shipped_utc,
            $notify ? 1 : 0,
            youvape_logistique_now_utc()
        ));
        if ($inserted === false) {
            return youvape_logistique_line_error('DB_ERROR', 'Réservation de l\'envoi impossible : ' . $wpdb->last_error, $echo);
        }
        if ($inserted === 0) {
            $known = youvape_logistique_known_shipment($shipment_id, $fingerprint, $echo);
            return $known !== null ? $known : youvape_logistique_line_error('DB_ERROR', 'Envoi ni réservé ni retrouvé.', $echo);
        }
        $stage = 'reserved';

        $keys = $settings['meta_keys'];
        if ($replace) {
            // Ancien suivi pour la note : le nôtre, ou celui de BMS pour une commande partie avant le plugin.
            $old_label  = $order->get_meta($keys['carrier_label']) ?: $order->get_meta('bms_carrier');
            $old_number = $order->get_meta($keys['tracking_number']) ?: $order->get_meta('bms_tracking_number');
        }
        $order->update_meta_data($keys['carrier'], $carrier);
        $order->update_meta_data($keys['carrier_label'], $carrier_label);
        $order->update_meta_data($keys['tracking_number'], $tracking_number);
        $order->update_meta_data($keys['tracking_url'], $tracking_url);
        $order->update_meta_data($keys['shipped_at'], $shipped_at->setTimezone(wp_timezone())->format('c'));

        if ($changes && !$replace) {
            $order->set_status($target);
        }

        if ($replace) {
            $note_text = sprintf('Suivi remplacé : %s %s → %s %s', $old_label ?: '(aucun)', $old_number ?: '', $carrier_label, $tracking_number !== '' ? $tracking_number : '(sans n° de suivi)');
        } elseif ($tracking_number !== '') {
            $note_text = sprintf('Colis expédié avec le transporteur %s - N° de suivi %s', $carrier_label, $tracking_number);
        } else {
            $note_text = sprintf('Envoi enregistré : %s (sans n° de suivi)', $carrier_label);
        }
        if ($note !== '') {
            $note_text .= "\n" . $note;
        }
        if (!$changes) {
            $note_text .= "\n" . 'Statut inchangé : les changements de statut sont coupés dans le plugin.';
        }
        $note_text .= "\n" . sprintf('Envoi %s%s', $shipment_id, !$notify ? ' — sans mail au client' : ($replace && $changes ? ' — mail d\'expédition renvoyé au client' : ''));

        $write = function () use ($order, $note_text, &$stage) {
            $stage = 'saving';
            $order->save();
            $stage = 'saved';
            $order->add_order_note($note_text, 0, false);
        };
        $mails_blocked = 0;
        $mail_resent   = false;
        if ($notify) {
            $write();
            if ($replace && $changes) {
                // Statut de départ du PREMIER envoi : c'est cette transition qui a envoyé le mail
                // la première fois. Commande partie avant le plugin (BMS) : depuis « En cours ».
                $original_from = $first ? $first->status_from : 'processing';
                youvape_logistique_resend_shipped_mail($order, $original_from, $target);
                $mail_resent = true;
            }
        } else {
            $silent        = youvape_logistique_silently($from, $changes && !$replace ? $target : $from, $write);
            $mails_blocked = $silent['mails_blocked'];
        }

        $to = $order->get_status();
        $wpdb->update(
            $table,
            array('state' => 'applied', 'status_to' => $to, 'applied_at' => youvape_logistique_now_utc()),
            array('shipment_id' => $shipment_id),
            array('%s', '%s', '%s'),
            array('%s')
        );

        return array_merge($echo, array(
            'result'         => 'applied',
            'replaced'       => $replace,
            'status_changes_enabled' => $changes,
            'status_after'   => $to,
            'status_changed' => $from !== $to,
            'notified'       => $notify,
            'mail_resent'    => $mail_resent,
            'mails_blocked'  => $mails_blocked,
        ));
    } catch (\Throwable $e) {
        return youvape_logistique_write_exception($table, 'shipment_id', $shipment_id, $stage, $e, $echo);
    } finally {
        youvape_logistique_unlock_order($order_id);
    }
}

/**
 * Renvoie le mail d'expédition après une étiquette refaite.
 *
 * Le statut ne change pas, donc aucun mail ne part tout seul. On rejoue le hook
 * de TRANSITION d'origine ({from}_to_{to}), pas le hook de statut ({to}) : ce
 * dernier relancerait aussi tout ce qui suit un passage en « expédiée »
 * (facturation, capture du paiement…). Sur le site actuel, seul le prestataire
 * de mails écoute cette transition. Lié au prestataire ACTUEL, comme
 * youvape_logistique_silent_hosts().
 */
function youvape_logistique_resend_shipped_mail($order, $from, $to) {
    do_action('woocommerce_order_status_' . $from . '_to_' . $to, $order->get_id(), $order);
}

/**
 * Exception pendant une écriture de commande : selon l'étape atteinte, la
 * réservation est supprimée (rien d'écrit), laissée en attente (état
 * incertain) ou confirmée (commande enregistrée, la suite a échoué).
 */
function youvape_logistique_write_exception($table, $key, $id, $stage, $e, $echo) {
    global $wpdb;
    if ($stage === 'checks' || $stage === 'reserved') {
        if ($stage === 'reserved') {
            $wpdb->delete($table, array($key => $id), array('%s'));
        }
        return youvape_logistique_line_error('EXCEPTION', 'Erreur avant toute écriture, la ligne peut être renvoyée : ' . $e->getMessage(), $echo);
    }
    if ($stage === 'saved') {
        $wpdb->update($table, array('state' => 'applied', 'applied_at' => youvape_logistique_now_utc()), array($key => $id), array('%s', '%s'), array('%s'));
        return array_merge($echo, array(
            'result'  => 'applied',
            'warning' => 'Commande enregistrée, mais une erreur a suivi (note de commande, mail ?) : ' . $e->getMessage(),
        ));
    }
    return youvape_logistique_line_error('EXCEPTION_AFTER_WRITE', 'Erreur pendant l\'enregistrement de la commande : vérifier la commande à la main. ' . $e->getMessage(), $echo);
}

/** Résultat d'un shipment_id déjà présent dans le journal, ou null s'il est inconnu. */
function youvape_logistique_known_shipment($shipment_id, $fingerprint, $echo) {
    global $wpdb;
    $table = youvape_logistique_table('shipments');
    $row   = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$table} WHERE shipment_id = %s", $shipment_id));
    if (!$row) {
        return null;
    }
    if ($row->fingerprint !== $fingerprint) {
        return youvape_logistique_line_error('SHIPMENT_ID_CONFLICT', sprintf(
            'shipment_id déjà utilisé pour un autre envoi (commande %d, suivi « %s »).',
            (int) $row->order_id,
            $row->tracking_number
        ), $echo);
    }
    if ($row->state !== 'applied') {
        return youvape_logistique_line_error('SHIPMENT_PENDING', 'Envoi réservé mais jamais confirmé (requête interrompue ?) : vérifier la commande à la main avant toute action.', $echo);
    }
    return array_merge($echo, array(
        'result'        => 'already',
        'status_before' => $row->status_from,
        'status_after'  => $row->status_to,
        'applied_at'    => $row->applied_at,
    ));
}

/* -------------------------------------------------------------------------
 * order/status
 * ---------------------------------------------------------------------- */

/**
 * Ligne : { order_id, step, notify_customer, note }.
 * step = « shipped » (ship_status), « pickup » (pickup_status) ou « delivered »
 * (delivered_status). Le plugin ne refuse que les reculs et les statuts interdits :
 * - shipped / pickup : depuis tout statut qui n'est ni expédiée, ni retrait,
 *   ni livrée (c'est l'app qui sait si la commande est à expédier) ;
 * - delivered : depuis tout statut qui n'est pas interdit.
 * « Livrée » ne redescend jamais, « expédiée » ne devient pas « retrait ».
 * notify_customer = true : changement normal, tout ce que WooCommerce et les
 * plugins déclenchent s'exécute. false : muet (includes/silence.php).
 */
function youvape_logistique_status_line($line, $settings) {
    $echo = array('order_id' => youvape_logistique_echo_id($line, 'order_id'));
    if (!is_array($line)) {
        return youvape_logistique_line_error('INVALID_LINE', 'La ligne doit être un objet.', $echo);
    }

    $steps = array(
        'shipped'   => $settings['ship_status'],
        'pickup'    => $settings['pickup_status'],
        'delivered' => $settings['delivered_status'],
    );
    $order_id = youvape_logistique_int(isset($line['order_id']) ? $line['order_id'] : null);
    $step     = isset($line['step']) ? $line['step'] : null;
    $note     = youvape_logistique_text(isset($line['note']) ? $line['note'] : null, 1000, true);
    $notify   = isset($line['notify_customer']) ? $line['notify_customer'] : null;

    if ($order_id === null || $order_id <= 0) {
        return youvape_logistique_line_error('INVALID_LINE', 'order_id doit être un entier positif.', $echo);
    }
    if (!is_string($step) || !array_key_exists($step, $steps)) {
        return youvape_logistique_line_error('INVALID_LINE', 'step vaut « shipped », « pickup » ou « delivered ».', $echo);
    }
    if (!is_bool($notify)) {
        return youvape_logistique_line_error('INVALID_LINE', 'notify_customer est obligatoire et vaut true ou false.', $echo);
    }
    if ($note === null) {
        return youvape_logistique_line_error('INVALID_LINE', 'note invalide ou trop longue (1000 caractères au plus).', $echo);
    }

    $status  = $steps[$step];
    $echo    = array('order_id' => $order_id, 'step' => $step);
    if (empty($settings['status_changes_enabled'])) {
        return youvape_logistique_line_error('STATUS_CHANGES_DISABLED', 'Les changements de statut sont coupés dans les réglages du plugin : rien n\'a changé.', $echo);
    }
    $refused = youvape_logistique_check_registered($status, $echo);
    if ($refused !== null) {
        return $refused;
    }

    if (!youvape_logistique_lock_order($order_id)) {
        return youvape_logistique_line_error('ORDER_LOCKED', 'La commande est en cours de modification par une autre requête : renvoyer la ligne.', $echo);
    }

    $stage = 'checks';
    try {
        $order = youvape_logistique_get_order($order_id);
        if (!$order) {
            return youvape_logistique_line_error('ORDER_NOT_FOUND', sprintf('La commande %d est introuvable.', $order_id), $echo);
        }

        $from = $order->get_status();
        $echo['status_before'] = $from;
        if ($from === $status) {
            return array_merge($echo, array('result' => 'already', 'status_after' => $from));
        }
        $allowed = !in_array($from, youvape_logistique_forbidden_statuses(), true)
            && ($step === 'delivered' || !youvape_logistique_is_shipped_status($from, $settings));
        if (!$allowed) {
            return youvape_logistique_line_error('ORDER_NOT_ELIGIBLE', sprintf(
                'La commande %d est au statut « %s » : ce changement serait un recul, ou ce statut ne se modifie pas ici.',
                $order_id,
                wc_get_order_status_name($from)
            ), $echo);
        }

        // WooCommerce ajoute « Statut modifié de … à … » après ce texte.
        $prefix = $notify ? $note : trim('Changement de statut sans mail au client. ' . $note);
        $order->set_status($status, $prefix);

        $write = function () use ($order, &$stage) {
            $stage = 'saving';
            $order->save();
            $stage = 'saved';
        };
        $mails_blocked = 0;
        if ($notify) {
            $write();
        } else {
            $silent        = youvape_logistique_silently($from, $status, $write);
            $mails_blocked = $silent['mails_blocked'];
        }

        $to = $order->get_status();
        return array_merge($echo, array(
            'result'         => 'applied',
            'status_after'   => $to,
            'status_changed' => $from !== $to,
            'notified'       => $notify,
            'mails_blocked'  => $mails_blocked,
        ));
    } catch (\Throwable $e) {
        if ($stage === 'saved') {
            return array_merge($echo, array('result' => 'applied', 'warning' => 'Statut enregistré, mais une erreur a suivi : ' . $e->getMessage()));
        }
        if ($stage === 'saving') {
            return youvape_logistique_line_error('EXCEPTION_AFTER_WRITE', 'Erreur pendant l\'enregistrement de la commande : vérifier son statut à la main. ' . $e->getMessage(), $echo);
        }
        return youvape_logistique_line_error('EXCEPTION', 'Erreur avant toute écriture, la ligne peut être renvoyée : ' . $e->getMessage(), $echo);
    } finally {
        youvape_logistique_unlock_order($order_id);
    }
}
