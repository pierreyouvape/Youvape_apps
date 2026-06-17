<?php
/**
 * Bouton "Ouvrir une demande" sur les commandes du client (Mon Compte).
 *
 * - Liste des commandes : ajoute une action de ligne.
 * - Détail d'une commande : ajoute un bouton sous le tableau.
 *
 * Le bouton pointe vers le formulaire de nouvelle demande avec la commande
 * pré-sélectionnée (Youvape_SAV_Account_Endpoint::new_url($order_id)).
 */

if (!defined('ABSPATH')) {
    exit;
}

class Youvape_SAV_Order_Button {

    /** @var Youvape_SAV_Order_Button */
    private static $instance = null;

    public static function instance() {
        if (null === self::$instance) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function register() {
        add_filter('woocommerce_my_account_my_orders_actions', array($this, 'add_list_action'), 10, 2);
        add_action('woocommerce_order_details_after_order_table', array($this, 'add_detail_button'), 20);
    }

    /**
     * Action sur la ligne de commande (liste des commandes).
     *
     * @param array    $actions
     * @param WC_Order $order
     * @return array
     */
    public function add_list_action($actions, $order) {
        if (!$order instanceof WC_Order) {
            return $actions;
        }
        $actions['youvape_sav'] = array(
            'url'  => Youvape_SAV_Account_Endpoint::new_url($order->get_id()),
            'name' => __('Ouvrir une demande', 'youvape-sav-client'),
        );
        return $actions;
    }

    /**
     * Bouton sous le détail d'une commande.
     *
     * @param WC_Order $order
     */
    public function add_detail_button($order) {
        if (!$order instanceof WC_Order) {
            return;
        }
        // N'afficher que pour le propriétaire de la commande (sécurité d'affichage ;
        // l'autorisation réelle est revérifiée côté API à la création).
        if (get_current_user_id() !== (int) $order->get_customer_id()) {
            return;
        }
        printf(
            '<p class="youvape-sav__order-action"><a href="%1$s" class="button">%2$s</a></p>',
            esc_url(Youvape_SAV_Account_Endpoint::new_url($order->get_id())),
            esc_html__('Ouvrir une demande au service client', 'youvape-sav-client')
        );
    }
}
