<?php
/**
 * Écran de remboursement de l'admin : la case « Restocker les articles
 * remboursés » suit l'état de la commande. COCHÉE si la commande n'est pas
 * encore expédiée (on la rembourse pour l'annuler, l'article est en rayon),
 * DÉCOCHÉE sinon. L'équipe peut toujours la changer à la main.
 *
 * Le filtre n'est lu que par cet écran (html-order-items.php), et il ne reçoit
 * pas la commande. Un remboursement par l'API passe restock_items
 * explicitement et n'est pas concerné.
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * La commande de l'écran. À l'affichage de la page, $theorder est posé sur les
 * deux écrans (classique et HPOS). Les 10 Ajax qui réaffichent le tableau,
 * dont le rechargement après un remboursement, n'ont pas $theorder mais
 * reçoivent tous order_id : WooCommerce a contrôlé le jeton et les droits
 * avant d'inclure la vue.
 */
function youvape_logistique_refund_screen_order() {
    global $theorder;
    if (wp_doing_ajax()) {
        $order_id = isset($_POST['order_id']) ? absint($_POST['order_id']) : 0;
        return $order_id > 0 ? youvape_logistique_get_order($order_id) : null;
    }
    return $theorder instanceof WC_Order ? $theorder : null;
}

/**
 * Pas encore expédiée : ni expédiée, ni retrait boutique, ni livrée, ni à un
 * statut interdit ; aucun colis dans notre table (même « pending ») ; pas de
 * suivi BMS pour les anciennes commandes.
 * En cas de doute, non : une remise en stock oubliée se rattrape, une remise en
 * trop fait survendre.
 */
function youvape_logistique_restock_by_default($order) {
    if (!$order || !youvape_logistique_tables_ready()) {
        return false;
    }
    $status = $order->get_status();
    if (youvape_logistique_is_shipped_status($status, youvape_logistique_settings())
        || in_array($status, youvape_logistique_forbidden_statuses(), true)) {
        return false;
    }
    if (!empty($order->get_meta('bms_tracking_number'))) {
        return false;
    }
    global $wpdb;
    $table = youvape_logistique_table('shipments');
    return !$wpdb->get_var($wpdb->prepare("SELECT 1 FROM {$table} WHERE order_id = %d LIMIT 1", $order->get_id()));
}

add_filter('woocommerce_restock_refunded_items', function ($checked) {
    return youvape_logistique_restock_by_default(youvape_logistique_refund_screen_order());
});
