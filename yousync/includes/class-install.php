<?php
/**
 * Install - Table des événements, et reprise de l'ancienne file.
 *
 * Le plugin se met à jour par dépôt de fichiers sur une extension déjà active : le
 * hook d'activation ne tourne PAS. Tout passe donc par un contrôle de version au
 * chargement, sous verrou MySQL, pour ne jamais s'exécuter deux fois en parallèle.
 */

namespace YouSync;

defined('ABSPATH') || exit;

class Install {

    const DB_VERSION = '1';
    const VERSION_OPTION = 'yousync_db_version';
    const RETRY_TRANSIENT = 'yousync_upgrade_retry';
    const LOCK_WAIT_SECONDS = 5;

    /**
     * Nom de la table
     */
    public static function table() {
        global $wpdb;
        return $wpdb->prefix . 'yousync_events';
    }

    /**
     * Installe ou met à jour, une seule fois.
     */
    public static function maybe_upgrade() {
        if (get_option(self::VERSION_OPTION) === self::DB_VERSION) {
            return;
        }
        if (get_transient(self::RETRY_TRANSIENT)) {
            return;
        }

        global $wpdb;
        $lock = $wpdb->prefix . 'yousync_upgrade';
        if ((int) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, %d)', $lock, self::LOCK_WAIT_SECONDS)) !== 1) {
            return;
        }

        try {
            // Relu directement en base : une autre requête vient peut-être de finir.
            $current = $wpdb->get_var($wpdb->prepare(
                "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s",
                self::VERSION_OPTION
            ));
            if ($current === self::DB_VERSION) {
                return;
            }

            if (!self::create_table()) {
                self::log_error('Table des événements absente après création.');
                set_transient(self::RETRY_TRANSIENT, 1, 5 * MINUTE_IN_SECONDS);
                return;
            }

            Auth::import_legacy_token();
            self::migrate_settings();
            wp_clear_scheduled_hook('yousync_process_queue');
            self::import_legacy_queue();

            update_option(self::VERSION_OPTION, self::DB_VERSION, true);

            // Une ancienne requête encore en cours peut réécrire la file juste après.
            if (!wp_next_scheduled('yousync_legacy_sweep')) {
                wp_schedule_single_event(time() + 10 * MINUTE_IN_SECONDS, 'yousync_legacy_sweep');
            }
        } finally {
            $wpdb->query($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock));
        }
    }

    /**
     * Crée la table. Aucune donnée client : identifiants, type, action, état, dates.
     * Le contenu est construit à la lecture.
     *
     * @return bool la table existe
     */
    public static function create_table() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';

        $table = self::table();
        $charset = $wpdb->get_charset_collate();

        // dbDelta exige deux espaces après PRIMARY KEY et une colonne par ligne.
        dbDelta("CREATE TABLE {$table} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  object_type varchar(10) NOT NULL,
  action varchar(10) NOT NULL,
  wp_id bigint(20) unsigned NOT NULL,
  parent_id bigint(20) unsigned NOT NULL DEFAULT 0,
  state varchar(10) NOT NULL DEFAULT 'pending',
  attempts smallint(5) unsigned NOT NULL DEFAULT 0,
  last_code varchar(40) DEFAULT NULL,
  created_at datetime NOT NULL,
  acked_at datetime DEFAULT NULL,
  failed_at datetime DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY state_id (state,id),
  KEY object_state (object_type,wp_id,state),
  KEY state_acked (state,acked_at)
) ENGINE=InnoDB {$charset};");

        return $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($table))) === $table;
    }

    /**
     * Réglages de la 1.x : l'adresse d'envoi disparaît avec l'envoi, et une
     * synchro désactivée devient une pause (les événements s'enregistrent).
     */
    private static function migrate_settings() {
        $settings = get_option('yousync_settings', []);
        if (!is_array($settings)) {
            return;
        }

        if (array_key_exists('enabled', $settings) && empty($settings['enabled'])) {
            update_option(Queue::PAUSE_OPTION, 1, false);
        }
        if (array_key_exists('api_url', $settings)) {
            unset($settings['api_url']);
            update_option('yousync_settings', $settings);
        }
    }

    /**
     * Reprend ce qui reste dans queue.json puis supprime le dossier de la 1.x. Le
     * renommage est atomique : deux passages ne peuvent pas traiter le même fichier.
     * Un doublon est sans conséquence, le contenu est relu à la livraison.
     */
    public static function import_legacy_queue() {
        $dir = trailingslashit(wp_upload_dir()['basedir']) . 'yousync/';
        if (!is_dir($dir)) {
            return;
        }

        $file = $dir . 'queue.json';
        $claimed = $file . '.importing';

        if (is_file($file) && !@rename($file, $claimed)) {
            self::log_error('Ancienne file non reprise : renommage impossible.');
            return;
        }

        if (is_file($claimed)) {
            $events = json_decode((string) file_get_contents($claimed), true);
            if (!is_array($events)) {
                // Fichier abîmé : on le laisse, le rattrapage retrouve les commandes.
                self::log_error('Ancienne file illisible, laissée en place.');
                return;
            }

            foreach ($events as $event) {
                if (is_array($event) && isset($event['type'], $event['wp_id'])) {
                    Queue::add((string) $event['type'], (string) ($event['action'] ?? 'update'), (int) $event['wp_id']);
                }
            }
            @unlink($claimed);
        }

        foreach (array_merge(glob($dir . 'logs/*.log') ?: [], [$dir . 'logs/.htaccess', $dir . 'logs/index.php', $dir . '.htaccess', $dir . 'index.php']) as $path) {
            if (is_file($path)) {
                @unlink($path);
            }
        }
        @rmdir($dir . 'logs');
        @rmdir($dir);
    }

    /**
     * Journal d'erreur de WooCommerce. Jamais de donnée client.
     */
    public static function log_error($message) {
        if (function_exists('wc_get_logger')) {
            wc_get_logger()->error($message, ['source' => 'yousync']);
        }
    }
}
