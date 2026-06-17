<?php
/**
 * Onglet "Mes demandes au service client" dans Mon Compte WooCommerce.
 *
 * - Enregistre l'endpoint /mon-compte/mes-demandes/
 * - Ajoute l'entrée de menu dans le compte
 * - Rend le contenu via un template surchargeable par le thème
 *   (woocommerce/youvape-sav/list.php), à la manière WooCommerce.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Youvape_SAV_Account_Endpoint {

    /** @var Youvape_SAV_Account_Endpoint */
    private static $instance = null;

    public static function instance() {
        if (null === self::$instance) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Branche tous les hooks WooCommerce/WordPress.
     */
    public function register() {
        add_action('init', array($this, 'add_endpoint'));
        add_filter('query_vars', array($this, 'add_query_var'), 0);
        add_filter('woocommerce_account_menu_items', array($this, 'add_menu_item'));
        add_action('woocommerce_account_' . YOUVAPE_SAV_ENDPOINT . '_endpoint', array($this, 'render'));
        add_action('wp_enqueue_scripts', array($this, 'enqueue_assets'));
        // Traitement des POST avant tout rendu (POST-redirect-GET).
        add_action('template_redirect', array($this, 'maybe_handle_create'));
        add_action('template_redirect', array($this, 'maybe_handle_reply'));
    }

    public function add_endpoint() {
        add_rewrite_endpoint(YOUVAPE_SAV_ENDPOINT, EP_ROOT | EP_PAGES);
    }

    public function add_query_var($vars) {
        $vars[] = YOUVAPE_SAV_ENDPOINT;
        return $vars;
    }

    /**
     * Insère "Mes demandes" dans le menu, juste avant "Se déconnecter".
     */
    public function add_menu_item($items) {
        $new = array();
        foreach ($items as $key => $label) {
            if ('customer-logout' === $key) {
                $new[YOUVAPE_SAV_ENDPOINT] = __('Mes demandes', 'youvape-sav-client');
            }
            $new[$key] = $label;
        }
        // Filet de sécurité si l'item logout n'existe pas (thèmes custom)
        if (!isset($new[YOUVAPE_SAV_ENDPOINT])) {
            $new[YOUVAPE_SAV_ENDPOINT] = __('Mes demandes', 'youvape-sav-client');
        }
        return $new;
    }

    /**
     * Charge le CSS uniquement sur la page Mon Compte.
     */
    public function enqueue_assets() {
        if (!function_exists('is_account_page') || !is_account_page()) {
            return;
        }
        wp_enqueue_style(
            'youvape-sav-client',
            YOUVAPE_SAV_PLUGIN_URL . 'assets/css/youvape-sav.css',
            array(),
            YOUVAPE_SAV_VERSION
        );
    }

    /**
     * Rendu de l'onglet. WooCommerce passe la "valeur" de l'endpoint :
     *   /mon-compte/mes-demandes/      → $value vide   → liste
     *   /mon-compte/mes-demandes/42/   → $value = "42" → détail du ticket 42
     *
     * @param string $value segment d'URL après l'endpoint
     */
    public function render($value = '') {
        $value = is_string($value) ? trim($value, '/') : '';

        if ('nouvelle' === $value) {
            $this->render_new();
            return;
        }

        $ticket_id = absint($value);
        if ($ticket_id > 0) {
            $this->render_detail($ticket_id);
        } else {
            $this->render_list();
        }
    }

    /**
     * Vue liste : tickets du client. Template surchargeable list.php.
     */
    private function render_list() {
        $tickets = Youvape_SAV_Api_Client::get_tickets();
        $error   = null;
        if (is_wp_error($tickets)) {
            $error   = $tickets->get_error_message();
            $tickets = array();
        }
        $this->load_template('list.php', array(
            'tickets' => $tickets,
            'error'   => $error,
        ));
    }

    /**
     * Vue détail : fil d'un ticket. Template surchargeable detail.php.
     *
     * @param int $ticket_id
     */
    private function render_detail($ticket_id) {
        $ticket = Youvape_SAV_Api_Client::get_ticket($ticket_id);
        $error  = null;
        if (is_wp_error($ticket)) {
            $error  = $ticket->get_error_message();
            $ticket = null;
        }
        // Erreur éventuelle remontée après un POST de réponse en échec.
        if (!$error && isset($_GET['sav_error'])) {
            $error = sanitize_text_field(wp_unslash($_GET['sav_error']));
        }
        $this->load_template('detail.php', array(
            'ticket'      => $ticket,
            'error'       => $error,
            'list_url'    => wc_get_account_endpoint_url(YOUVAPE_SAV_ENDPOINT),
            'reply_action'=> self::ticket_url($ticket_id),
            'reply_nonce' => wp_nonce_field('youvape_sav_reply_' . $ticket_id, 'youvape_sav_reply_nonce', true, false),
            'ticket_id'   => $ticket_id,
        ));
    }

    /**
     * URL de la vue détail d'un ticket (utilisée par le template liste).
     *
     * @param int $ticket_id
     * @return string
     */
    public static function ticket_url($ticket_id) {
        $base = wc_get_account_endpoint_url(YOUVAPE_SAV_ENDPOINT);
        return trailingslashit($base) . absint($ticket_id);
    }

    /**
     * URL du formulaire de nouvelle demande. Une commande peut être
     * pré-sélectionnée via le paramètre ?order_id=...
     *
     * @param int $order_id  commande à pré-sélectionner (0 = aucune)
     * @return string
     */
    public static function new_url($order_id = 0) {
        $base = trailingslashit(wc_get_account_endpoint_url(YOUVAPE_SAV_ENDPOINT)) . 'nouvelle';
        $order_id = absint($order_id);
        if ($order_id > 0) {
            $base = add_query_arg('order_id', $order_id, $base);
        }
        return $base;
    }

    /**
     * Vue formulaire de création. Charge les commandes du client pour le
     * sélecteur. Template surchargeable new-ticket.php.
     */
    private function render_new() {
        $orders = Youvape_SAV_Api_Client::get_orders();
        if (is_wp_error($orders)) {
            $orders = array();
        }

        // Commande pré-sélectionnée (depuis le bouton "Ouvrir une demande").
        $preselect = isset($_GET['order_id']) ? absint($_GET['order_id']) : 0;

        // Message d'erreur éventuel transmis après un POST en échec.
        $error = isset($_GET['sav_error']) ? sanitize_text_field(wp_unslash($_GET['sav_error'])) : null;

        $this->load_template('new-ticket.php', array(
            'orders'     => $orders,
            'preselect'  => $preselect,
            'error'      => $error,
            'list_url'   => wc_get_account_endpoint_url(YOUVAPE_SAV_ENDPOINT),
            'action_url' => self::new_url(),
            'nonce_field' => wp_nonce_field('youvape_sav_create', 'youvape_sav_nonce', true, false),
        ));
    }

    /**
     * Traite la soumission du formulaire de création (POST-redirect-GET).
     * Vérifie le nonce, relaie à l'API, puis redirige (succès → détail du
     * ticket créé ; échec → formulaire avec message).
     */
    public function maybe_handle_create() {
        if (empty($_POST['youvape_sav_submit'])) {
            return;
        }
        if (!is_user_logged_in()) {
            return;
        }
        // CSRF : nonce obligatoire
        if (!isset($_POST['youvape_sav_nonce'])
            || !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['youvape_sav_nonce'])), 'youvape_sav_create')) {
            wp_safe_redirect(add_query_arg('sav_error', rawurlencode(__('Session expirée, merci de réessayer.', 'youvape-sav-client')), self::new_url()));
            exit;
        }

        $fields = array(
            'subject'  => isset($_POST['subject']) ? sanitize_text_field(wp_unslash($_POST['subject'])) : '',
            'body'     => isset($_POST['body']) ? sanitize_textarea_field(wp_unslash($_POST['body'])) : '',
            'order_id' => isset($_POST['order_id']) ? absint($_POST['order_id']) : '',
            'product'  => isset($_POST['product']) ? sanitize_text_field(wp_unslash($_POST['product'])) : '',
        );

        $files = isset($_FILES['attachments']) ? $_FILES['attachments'] : array();

        $result = Youvape_SAV_Api_Client::create_ticket($fields, $files);

        if (is_wp_error($result)) {
            $msg = $result->get_error_message();
            wp_safe_redirect(add_query_arg('sav_error', rawurlencode($msg), self::new_url($fields['order_id'] ? $fields['order_id'] : 0)));
            exit;
        }

        $ticket_id = isset($result['ticket_id']) ? absint($result['ticket_id']) : 0;
        $dest = $ticket_id > 0 ? self::ticket_url($ticket_id) : wc_get_account_endpoint_url(YOUVAPE_SAV_ENDPOINT);
        wp_safe_redirect($dest);
        exit;
    }

    /**
     * Traite la soumission d'une réponse à un ticket existant
     * (POST-redirect-GET, nonce vérifié).
     */
    public function maybe_handle_reply() {
        if (empty($_POST['youvape_sav_reply_submit'])) {
            return;
        }
        if (!is_user_logged_in()) {
            return;
        }

        $ticket_id = isset($_POST['ticket_id']) ? absint($_POST['ticket_id']) : 0;
        if ($ticket_id <= 0) {
            return;
        }

        // CSRF : nonce lié à ce ticket
        if (!isset($_POST['youvape_sav_reply_nonce'])
            || !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['youvape_sav_reply_nonce'])), 'youvape_sav_reply_' . $ticket_id)) {
            wp_safe_redirect(add_query_arg('sav_error', rawurlencode(__('Session expirée, merci de réessayer.', 'youvape-sav-client')), self::ticket_url($ticket_id)));
            exit;
        }

        $fields = array(
            'body' => isset($_POST['body']) ? sanitize_textarea_field(wp_unslash($_POST['body'])) : '',
        );
        $files = isset($_FILES['attachments']) ? $_FILES['attachments'] : array();

        $result = Youvape_SAV_Api_Client::reply_ticket($ticket_id, $fields, $files);

        if (is_wp_error($result)) {
            wp_safe_redirect(add_query_arg('sav_error', rawurlencode($result->get_error_message()), self::ticket_url($ticket_id)));
            exit;
        }

        wp_safe_redirect(self::ticket_url($ticket_id));
        exit;
    }

    /**
     * Charge un template en privilégiant la surcharge du thème.
     *
     * @param string $template nom de fichier (ex. list.php)
     * @param array  $vars     variables exposées au template
     */
    private function load_template($template, $vars = array()) {
        // 1. Surcharge thème : <theme>/woocommerce/youvape-sav/<template>
        $theme_path = trailingslashit('woocommerce/youvape-sav') . $template;
        $located    = locate_template(array($theme_path));

        // 2. Repli : template fourni par le plugin
        if (!$located) {
            $located = YOUVAPE_SAV_PLUGIN_DIR . 'templates/' . $template;
        }

        if (!file_exists($located)) {
            return;
        }

        // extract() volontaire et contrôlé : $vars est construit par le plugin,
        // pas par l'utilisateur. Permet au template d'utiliser $tickets, $error.
        extract($vars, EXTR_SKIP);
        include $located;
    }
}
