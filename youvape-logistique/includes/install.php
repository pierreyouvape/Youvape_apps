<?php
/**
 * Tables du plugin.
 *
 * Elles servent de journal et de garde-fou d'idempotence : un movement_id ou un
 * shipment_id déjà connu n'est jamais appliqué une seconde fois. Elles ne sont
 * JAMAIS supprimées (pas de uninstall.php) : les perdre permettrait de rejouer
 * des mouvements déjà appliqués.
 *
 * Dates en UTC.
 */

if (!defined('ABSPATH')) {
    exit;
}

function youvape_logistique_table($name) {
    global $wpdb;
    return $wpdb->prefix . 'yv_logistique_' . $name;
}

function youvape_logistique_install() {
    global $wpdb;
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';

    $charset   = $wpdb->get_charset_collate();
    $movements = youvape_logistique_table('stock_movements');
    $shipments = youvape_logistique_table('shipments');

    // dbDelta exige deux espaces après PRIMARY KEY et une colonne par ligne.
    dbDelta("CREATE TABLE {$movements} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  movement_id varchar(64) NOT NULL,
  fingerprint char(32) NOT NULL,
  product_id bigint(20) unsigned NOT NULL,
  stock_product_id bigint(20) unsigned NOT NULL DEFAULT 0,
  delta int(11) NOT NULL,
  reason varchar(190) NOT NULL DEFAULT '',
  state varchar(10) NOT NULL DEFAULT 'pending',
  stock_after double DEFAULT NULL,
  created_at datetime NOT NULL,
  applied_at datetime DEFAULT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY movement_id (movement_id),
  KEY product_id (product_id)
) {$charset};");

    dbDelta("CREATE TABLE {$shipments} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  shipment_id varchar(64) NOT NULL,
  fingerprint char(32) NOT NULL,
  order_id bigint(20) unsigned NOT NULL,
  state varchar(10) NOT NULL DEFAULT 'pending',
  status_requested varchar(40) NOT NULL DEFAULT '',
  status_from varchar(40) NOT NULL DEFAULT '',
  status_to varchar(40) NOT NULL DEFAULT '',
  carrier varchar(64) NOT NULL DEFAULT '',
  carrier_label varchar(190) NOT NULL DEFAULT '',
  tracking_number varchar(190) NOT NULL DEFAULT '',
  tracking_url text,
  shipped_at datetime DEFAULT NULL,
  notified tinyint(1) NOT NULL DEFAULT 0,
  created_at datetime NOT NULL,
  applied_at datetime DEFAULT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY shipment_id (shipment_id),
  KEY order_id (order_id)
) {$charset};");

    // Enregistrée même en cas d'échec : sinon dbDelta serait relancé à chaque page du site.
    // Une table manquante se voit dans GET status (tables_ready) et les routes répondent
    // TABLES_MISSING ; désactiver puis réactiver relance la création.
    youvape_logistique_tables_ready(true);
    update_option('youvape_logistique_db_version', YOUVAPE_LOGISTIQUE_DB_VERSION);
}

function youvape_logistique_maybe_upgrade() {
    if (get_option('youvape_logistique_db_version') !== YOUVAPE_LOGISTIQUE_DB_VERSION) {
        youvape_logistique_install();
    }
}

/**
 * Les deux tables existent-elles ? Le résultat est gardé pour la requête.
 */
function youvape_logistique_tables_ready($refresh = false) {
    static $ready = null;
    if ($ready === null || $refresh) {
        global $wpdb;
        $ready = true;
        foreach (array('stock_movements', 'shipments') as $name) {
            $table = youvape_logistique_table($name);
            if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($table))) !== $table) {
                $ready = false;
            }
        }
    }
    return $ready;
}
