<?php
/**
 * Queue - File des événements, dans une table du site.
 *
 * Les règles qui garantissent qu'aucun événement ne se perd :
 *   - un événement est un INSERT, jamais une lecture suivie d'une réécriture ;
 *   - le contenu est construit à la livraison : c'est l'état courant, donc rejouable ;
 *   - la lecture se fait sur `state = pending`, jamais à partir d'un curseur : un
 *     identifiant attribué mais pas encore validé en base ne peut pas être sauté ;
 *   - l'ack porte sur des identifiants lus. Une modification arrivée entre la lecture
 *     et l'ack est une NOUVELLE ligne : elle n'est pas couverte, elle repartira ;
 *   - une ligne ne sort que par ack. Rien n'expire. La purge ne touche que `acked`.
 */

namespace YouSync;

defined('ABSPATH') || exit;

class Queue {

    const PAUSE_OPTION = 'yousync_paused';
    const LAST_POLL_OPTION = 'yousync_last_poll';

    const STATE_PENDING = 'pending';
    const STATE_ACKED = 'acked';
    const STATE_FAILED = 'failed';

    const TYPES = ['order', 'product', 'customer', 'refund'];
    const ACTIONS = ['create', 'update', 'delete'];

    const MAX_ATTEMPTS = 10;
    const CRASH_PENALTY = 3;
    const CODE_READING = 'READING';
    const BATCH_SIZE = 50;
    const SCAN_LIMIT = 500;
    const ACK_MAX_IDS = 2000;
    const TIME_BUDGET_SECONDS = 20;
    const MAX_RESPONSE_BYTES = 5242880;
    const FAILED_SAMPLE = 10;
    const RETENTION_DAYS = 14;
    const PURGE_CHUNK = 5000;
    const PURGE_MAX_CHUNKS = 20;

    /**
     * Enregistre un événement. Doit rester un simple INSERT : il tourne pendant le
     * passage d'une commande.
     */
    public static function add($type, $action, $wp_id, $parent_id = 0) {
        global $wpdb;

        $wp_id = (int) $wp_id;
        if ($wp_id <= 0 || !in_array($type, self::TYPES, true) || !in_array($action, self::ACTIONS, true)) {
            return false;
        }

        $row = [
            'object_type' => $type,
            'action' => $action,
            'wp_id' => $wp_id,
            'parent_id' => (int) $parent_id,
            'state' => self::STATE_PENDING,
            'created_at' => current_time('mysql', true),
        ];
        $formats = ['%s', '%s', '%d', '%d', '%s', '%s'];

        $inserted = $wpdb->insert(Install::table(), $row, $formats);
        if ($inserted === false) {
            // Table pas encore créée : possible dans la seconde qui suit une mise à jour.
            Install::create_table();
            $inserted = $wpdb->insert(Install::table(), $row, $formats);
        }
        if ($inserted === false) {
            Install::log_error(sprintf('Événement non enregistré : %s #%d', $type, $wp_id));
            return false;
        }

        return true;
    }

    public static function is_paused() {
        return (bool) get_option(self::PAUSE_OPTION);
    }

    public static function set_paused($paused) {
        update_option(self::PAUSE_OPTION, $paused ? 1 : 0, false);
    }

    /**
     * Lit la file et construit les événements à livrer, regroupés par objet.
     *
     * @param int $batch_size nombre d'objets au plus
     * @return array événements
     */
    public static function read($batch_size = self::BATCH_SIZE) {
        global $wpdb;
        $table = Install::table();

        self::fail_exhausted();

        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT id, object_type, action, wp_id, parent_id, created_at
               FROM {$table}
              WHERE state = %s
              ORDER BY id ASC
              LIMIT %d",
            self::STATE_PENDING,
            self::SCAN_LIMIT
        ));

        $has_failed = self::count_state(self::STATE_FAILED) > 0;
        $started = microtime(true);
        $bytes = 0;
        $events = [];

        foreach (self::group_rows($rows, $batch_size) as $group) {
            if (microtime(true) - $started > self::TIME_BUDGET_SECONDS || $bytes > self::MAX_RESPONSE_BYTES) {
                break;
            }

            // Noté AVANT de construire : un objet qui fait tomber PHP (mémoire, erreur
            // fatale d'une extension) reste marqué, et sera seul pénalisé au passage
            // suivant. Sans ça, il entraînerait tout son lot, dont la réponse est perdue.
            self::start_reading($group['ids']);

            try {
                $event = self::build_event($group);
                $encoded = wp_json_encode($event);
                if ($encoded === false) {
                    self::set_code($group['ids'], 'JSON_ERROR');
                    continue;
                }
                self::finish_reading($group['ids']);
            } catch (\Throwable $e) {
                self::set_code($group['ids'], 'READ_ERROR');
                Install::log_error(sprintf('Lecture impossible : %s #%d', $group['type'], $group['wp_id']));
                continue;
            }

            // Une livraison réussie couvre aussi les anciens échecs du même objet.
            if ($has_failed) {
                $event['ids'] = array_merge($event['ids'], self::failed_ids($group['type'], $group['wp_id']));
            }

            $bytes += strlen($encoded);
            $events[] = $event;
        }

        return $events;
    }

    /**
     * Regroupe les lignes par objet, dans l'ordre d'arrivée. La dernière action fait
     * foi : le contenu étant lu à la livraison, un seul envoi suffit.
     *
     * @param array $rows lignes de la table
     * @param int $batch_size nombre d'objets au plus
     * @return array groupes
     */
    public static function group_rows($rows, $batch_size) {
        $groups = [];

        foreach ($rows as $row) {
            $key = $row->object_type . ':' . $row->wp_id;

            if (!isset($groups[$key])) {
                if (count($groups) >= $batch_size) {
                    continue;
                }
                $groups[$key] = [
                    'type' => $row->object_type,
                    'wp_id' => (int) $row->wp_id,
                    'parent_id' => 0,
                    'action' => $row->action,
                    'ids' => [],
                    'created_at' => $row->created_at,
                ];
            }

            $groups[$key]['ids'][] = (int) $row->id;
            $groups[$key]['action'] = $row->action;
            if ((int) $row->parent_id > 0) {
                $groups[$key]['parent_id'] = (int) $row->parent_id;
            }
        }

        return array_values($groups);
    }

    /**
     * Construit le contenu d'un événement. Objet disparu : un marqueur explicite,
     * jamais un événement sauté.
     */
    private static function build_event($group) {
        $data = Data_Fetcher::get($group['type'], $group['wp_id']);
        $gone = $data === null;

        // Une déclinaison ou un produit dont la classe manque rend aussi `null`. Le
        // déclarer disparu effacerait son stock chez nous : seul le post fait foi.
        if ($gone && $group['type'] === 'product' && get_post($group['wp_id'])) {
            throw new \RuntimeException('Produit présent mais illisible');
        }

        $action = $group['action'];
        if ($gone) {
            $action = 'delete';
        } elseif ($action === 'delete') {
            $action = 'update';
        }

        return [
            'ids' => $group['ids'],
            'type' => $group['type'],
            'action' => $action,
            'wp_id' => $group['wp_id'],
            'parent_id' => $group['parent_id'],
            'gone' => $gone,
            'data' => $data,
            'created_at' => $group['created_at'],
        ];
    }

    /**
     * Enregistre l'acquittement du serveur. Ne couvre que des lignes déjà livrées
     * (`attempts > 0`) : un identifiant jamais lu ne peut pas sortir de la file.
     *
     * @param array $acked identifiants traités
     * @param array $failed [['ids' => [...], 'code' => 'CODE'], ...]
     * @return array|\WP_Error
     */
    public static function acknowledge($acked, $failed) {
        global $wpdb;
        $table = Install::table();

        $acked_ids = self::clean_ids($acked);
        $failed_lines = [];
        $total = count($acked_ids);

        foreach (is_array($failed) ? $failed : [] as $line) {
            if (!is_array($line)) {
                continue;
            }
            $ids = self::clean_ids($line['ids'] ?? []);
            $total += count($ids);
            if ($ids) {
                $failed_lines[] = ['ids' => $ids, 'code' => self::clean_code($line['code'] ?? '')];
            }
        }

        if ($total > self::ACK_MAX_IDS) {
            return new \WP_Error('yousync_ack_too_large', 'Trop d\'identifiants.', ['status' => 400]);
        }

        $done = 0;
        if ($acked_ids) {
            $placeholders = implode(',', array_fill(0, count($acked_ids), '%d'));
            $done = (int) $wpdb->query($wpdb->prepare(
                "UPDATE {$table}
                    SET state = %s, acked_at = %s, last_code = NULL
                  WHERE id IN ({$placeholders})
                    AND state IN (%s, %s)
                    AND attempts > 0",
                array_merge(
                    [self::STATE_ACKED, current_time('mysql', true)],
                    $acked_ids,
                    [self::STATE_PENDING, self::STATE_FAILED]
                )
            ));
        }

        foreach ($failed_lines as $line) {
            self::set_code($line['ids'], $line['code']);
        }

        return ['acked' => $done, 'failed' => count($failed_lines)];
    }

    /**
     * Après trop d'essais, une ligne sort du chemin : elle reste, ne consomme plus le
     * lot, et attend qu'on la rejoue.
     */
    private static function fail_exhausted() {
        global $wpdb;
        $table = Install::table();

        // Encore marquée « en lecture » : PHP est tombé dessus au passage précédent.
        $wpdb->query($wpdb->prepare(
            "UPDATE {$table}
                SET attempts = attempts + %d, last_code = %s
              WHERE state = %s AND last_code = %s",
            self::CRASH_PENALTY,
            'READ_CRASH',
            self::STATE_PENDING,
            self::CODE_READING
        ));

        $wpdb->query($wpdb->prepare(
            "UPDATE {$table}
                SET state = %s, failed_at = %s, last_code = COALESCE(last_code, %s)
              WHERE state = %s AND attempts >= %d",
            self::STATE_FAILED,
            current_time('mysql', true),
            'TOO_MANY_ATTEMPTS',
            self::STATE_PENDING,
            self::MAX_ATTEMPTS
        ));
    }

    private static function start_reading($ids) {
        global $wpdb;
        $table = Install::table();
        $placeholders = implode(',', array_fill(0, count($ids), '%d'));

        $wpdb->query($wpdb->prepare(
            "UPDATE {$table} SET attempts = attempts + 1, last_code = %s WHERE id IN ({$placeholders})",
            array_merge([self::CODE_READING], $ids)
        ));
    }

    private static function finish_reading($ids) {
        global $wpdb;
        $table = Install::table();
        $placeholders = implode(',', array_fill(0, count($ids), '%d'));

        $wpdb->query($wpdb->prepare(
            "UPDATE {$table} SET last_code = NULL WHERE id IN ({$placeholders})",
            $ids
        ));
    }

    private static function set_code($ids, $code) {
        global $wpdb;
        $table = Install::table();
        $placeholders = implode(',', array_fill(0, count($ids), '%d'));

        $wpdb->query($wpdb->prepare(
            "UPDATE {$table} SET last_code = %s WHERE id IN ({$placeholders}) AND state <> %s",
            array_merge([$code], $ids, [self::STATE_ACKED])
        ));
    }

    private static function failed_ids($type, $wp_id) {
        global $wpdb;
        $table = Install::table();

        return array_map('intval', $wpdb->get_col($wpdb->prepare(
            "SELECT id FROM {$table} WHERE object_type = %s AND wp_id = %d AND state = %s",
            $type,
            $wp_id,
            self::STATE_FAILED
        )));
    }

    private static function clean_ids($ids) {
        if (!is_array($ids)) {
            return [];
        }
        $clean = array_filter(array_map('intval', array_filter($ids, 'is_numeric')), function($id) {
            return $id > 0;
        });
        return array_values(array_unique($clean));
    }

    /**
     * Un code, jamais un message : rien de ce qui arrive ici ne doit pouvoir porter
     * une donnée client dans la table.
     */
    private static function clean_code($code) {
        return is_string($code) && preg_match('/^[A-Z0-9_]{1,40}$/', $code) ? $code : 'UNKNOWN';
    }

    public static function count_state($state) {
        global $wpdb;
        $table = Install::table();

        return (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$table} WHERE state = %s", $state));
    }

    /**
     * État de la file, sans donnée client.
     */
    public static function stats() {
        global $wpdb;
        $table = Install::table();

        $failed = self::count_state(self::STATE_FAILED);
        $sample = [];
        if ($failed > 0) {
            $rows = $wpdb->get_results($wpdb->prepare(
                "SELECT object_type, wp_id, last_code FROM {$table} WHERE state = %s ORDER BY id DESC LIMIT %d",
                self::STATE_FAILED,
                self::FAILED_SAMPLE
            ));
            foreach ($rows as $row) {
                $sample[] = ['type' => $row->object_type, 'wp_id' => (int) $row->wp_id, 'code' => $row->last_code ?: 'UNKNOWN'];
            }
        }

        return [
            'pending' => self::count_state(self::STATE_PENDING),
            'failed' => $failed,
            'oldest_pending_at' => $wpdb->get_var($wpdb->prepare(
                "SELECT created_at FROM {$table} WHERE state = %s ORDER BY id ASC LIMIT 1",
                self::STATE_PENDING
            )),
            'failed_sample' => $sample,
        ];
    }

    /**
     * Lignes en échec, pour l'écran d'administration.
     */
    public static function failed_rows($limit = 100) {
        global $wpdb;
        $table = Install::table();

        return $wpdb->get_results($wpdb->prepare(
            "SELECT id, object_type, action, wp_id, attempts, last_code, created_at, failed_at
               FROM {$table} WHERE state = %s ORDER BY id DESC LIMIT %d",
            self::STATE_FAILED,
            (int) $limit
        ));
    }

    /**
     * Remet les lignes en échec dans la file.
     */
    public static function replay_failed() {
        global $wpdb;
        $table = Install::table();

        return (int) $wpdb->query($wpdb->prepare(
            "UPDATE {$table} SET state = %s, attempts = 0, failed_at = NULL, last_code = NULL WHERE state = %s",
            self::STATE_PENDING,
            self::STATE_FAILED
        ));
    }

    /**
     * Parmi ces commandes, lesquelles ont un événement en attente ?
     *
     * @param array $order_ids
     * @return array identifiants, en clés
     */
    public static function pending_orders($order_ids) {
        global $wpdb;
        $table = Install::table();

        if (empty($order_ids)) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($order_ids), '%d'));
        $ids = $wpdb->get_col($wpdb->prepare(
            "SELECT DISTINCT wp_id FROM {$table}
              WHERE object_type = %s AND state = %s AND wp_id IN ({$placeholders})",
            array_merge(['order', self::STATE_PENDING], array_map('intval', $order_ids))
        ));

        return array_flip(array_map('intval', $ids));
    }

    /**
     * Efface les lignes acquittées depuis longtemps. JAMAIS une ligne non acquittée.
     */
    public static function purge() {
        global $wpdb;
        $table = Install::table();
        $limit_date = gmdate('Y-m-d H:i:s', time() - self::RETENTION_DAYS * DAY_IN_SECONDS);

        for ($i = 0; $i < self::PURGE_MAX_CHUNKS; $i++) {
            $deleted = (int) $wpdb->query($wpdb->prepare(
                "DELETE FROM {$table} WHERE state = %s AND acked_at < %s LIMIT %d",
                self::STATE_ACKED,
                $limit_date,
                self::PURGE_CHUNK
            ));
            if ($deleted < self::PURGE_CHUNK) {
                break;
            }
        }
    }
}
