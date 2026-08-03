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

    /** Délai légal de rétractation, en jours (sert au marqueur d'information). */
    const WITHDRAWAL_DAYS = 14;

    /** Nombre maximum de produits sélectionnables dans une demande. */
    const MAX_PRODUCTS = 30;

    /** @var Youvape_SAV_Account_Endpoint */
    private static $instance = null;

    /**
     * Motifs de demande proposés au client. Le motif remplace la saisie libre
     * d'un sujet : il pilote l'affichage du formulaire ET les champs exigés.
     *
     * ⚠️ Les slugs sont un contrat avec l'API Node : ils doivent rester
     * identiques à CLIENT_TICKET_REASONS dans backend/src/controllers/
     * clientSavController.js (c'est le backend qui décide du sujet du ticket
     * à partir du slug — le libellé ci-dessous n'est qu'un affichage).
     *
     * Clés de configuration :
     *   label         libellé du choix dans le menu déroulant
     *   order         la commande concernée est obligatoire
     *   products      au moins un produit de la commande est obligatoire
     *   notice        afficher les consignes légales de rétractation
     *   body_label    libellé du champ de texte libre
     *   body_required le texte libre est obligatoire
     *
     * @return array<string,array>
     */
    public static function reasons() {
        return array(
            'question' => array(
                'label'         => __('Une question avant de passer ma commande', 'youvape-sav-client'),
                'order'         => false,
                'products'      => false,
                'notice'        => false,
                'body_label'    => __('Nous vous écoutons', 'youvape-sav-client'),
                'body_required' => true,
            ),
            'produit' => array(
                'label'         => __('Une difficulté avec une commande', 'youvape-sav-client'),
                'order'         => true,
                'products'      => true,
                'notice'        => false,
                'body_label'    => __('Décrivez-nous votre problème', 'youvape-sav-client'),
                'body_required' => true,
            ),
            'retractation' => array(
                'label'         => __('Une demande de rétractation', 'youvape-sav-client'),
                'order'         => true,
                'products'      => true,
                'notice'        => true,
                // Le client n'a pas à motiver sa rétractation (art. L221-18) :
                // le commentaire est donc facultatif.
                'body_label'    => __('Commentaire', 'youvape-sav-client'),
                'body_required' => false,
            ),
        );
    }

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
     * Enregistre le CSS partout, mais ne le charge que là où il sert : page
     * "Mon compte", ou page portant un shortcode du plugin. L'enregistrement
     * inconditionnel permet au shortcode de le réclamer par son seul handle,
     * y compris s'il est rendu par un builder de page.
     */
    public function enqueue_assets() {
        wp_register_style(
            'youvape-sav-client',
            YOUVAPE_SAV_PLUGIN_URL . 'assets/css/youvape-sav.css',
            array(),
            YOUVAPE_SAV_VERSION
        );

        $needed = (function_exists('is_account_page') && is_account_page())
            || (class_exists('Youvape_SAV_Shortcodes') && Youvape_SAV_Shortcodes::page_has_form());

        if ($needed) {
            wp_enqueue_style('youvape-sav-client');
        }
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
     * URL du formulaire de nouvelle demande. Une commande et un motif peuvent
     * être pré-sélectionnés via ?order_id=... et ?reason=...
     *
     * @param int    $order_id commande à pré-sélectionner (0 = aucune)
     * @param string $reason   slug de motif à pré-sélectionner ('' = aucun)
     * @return string
     */
    public static function new_url($order_id = 0, $reason = '') {
        $base = trailingslashit(wc_get_account_endpoint_url(YOUVAPE_SAV_ENDPOINT)) . 'nouvelle';
        $order_id = absint($order_id);
        if ($order_id > 0) {
            $base = add_query_arg('order_id', $order_id, $base);
        }
        $reason = sanitize_key($reason);
        if ($reason && array_key_exists($reason, self::reasons())) {
            $base = add_query_arg('reason', $reason, $base);
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
        $orders = self::decorate_orders($orders);

        // Commande pré-sélectionnée via ?order_id= (aucun bouton ne l'utilise
        // aujourd'hui, mais l'URL reste utilisable, notamment au retour d'erreur).
        $preselect = isset($_GET['order_id']) ? absint($_GET['order_id']) : 0;

        // Motif pré-sélectionné (bouton commande, ou retour d'un POST en échec).
        $reasons = self::reasons();
        $preselect_reason = isset($_GET['reason']) ? sanitize_key(wp_unslash($_GET['reason'])) : '';
        if (!isset($reasons[$preselect_reason])) {
            $preselect_reason = '';
        }

        // Message d'erreur éventuel transmis après un POST en échec.
        $error = isset($_GET['sav_error']) ? sanitize_text_field(wp_unslash($_GET['sav_error'])) : null;

        $this->load_template('new-ticket.php', array(
            'orders'            => $orders,
            'preselect'         => $preselect,
            'preselect_reason'  => $preselect_reason,
            'reasons'           => $reasons,
            'withdrawal_notice' => Youvape_SAV_Settings::withdrawal_notice(),
            'withdrawal_days'   => self::WITHDRAWAL_DAYS,
            'error'             => $error,
            'list_url'          => wc_get_account_endpoint_url(YOUVAPE_SAV_ENDPOINT),
            'action_url'        => self::new_url(),
            'nonce_field'       => wp_nonce_field('youvape_sav_create', 'youvape_sav_nonce', true, false),
        ));
    }

    /**
     * Ajoute à chaque commande l'indicateur `withdrawal_expired` : la commande
     * est livrée depuis plus de WITHDRAWAL_DAYS jours, donc probablement hors
     * délai de rétractation.
     *
     * L'app n'historise pas les changements de statut : pour une commande en
     * 'wc-delivered', `post_modified` (dernière modification) sert de date de
     * livraison approchée. C'est volontairement indicatif — jamais bloquant,
     * c'est le service client qui tranche. Idem pour le décalage horaire :
     * `post_modified` est en heure de Paris et WordPress interprète en UTC,
     * soit ~2 h d'écart, sans effet sur un seuil de 14 jours.
     *
     * Publique : le shortcode [youvape_sav_form] rend le même formulaire hors
     * de "Mon compte" et a besoin des mêmes indicateurs.
     *
     * @param array $orders commandes renvoyées par l'API
     * @return array
     */
    public static function decorate_orders($orders) {
        $limit = self::WITHDRAWAL_DAYS * DAY_IN_SECONDS;
        $now   = time();
        $out   = array();

        foreach ((array) $orders as $order) {
            if (!is_array($order)) {
                continue;
            }
            $order['withdrawal_expired'] = false;

            $status   = isset($order['post_status']) ? (string) $order['post_status'] : '';
            $modified = isset($order['post_modified']) ? (string) $order['post_modified'] : '';
            if ('wc-delivered' === $status && '' !== $modified) {
                $delivered_at = strtotime($modified);
                if ($delivered_at && ($now - $delivered_at) > $limit) {
                    $order['withdrawal_expired'] = true;
                }
            }
            $out[] = $order;
        }
        return $out;
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

        // Formulaire rendu par le shortcode hors "Mon compte" : on renvoie les
        // erreurs sur la page qui le porte, pas sur l'onglet du compte.
        // wp_safe_redirect refuse de toute façon un hôte externe.
        $error_base = isset($_POST['youvape_sav_return'])
            ? esc_url_raw(wp_unslash($_POST['youvape_sav_return']))
            : '';

        // CSRF : nonce obligatoire
        if (!isset($_POST['youvape_sav_nonce'])
            || !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['youvape_sav_nonce'])), 'youvape_sav_create')) {
            wp_safe_redirect(add_query_arg('sav_error', rawurlencode(__('Session expirée, merci de réessayer.', 'youvape-sav-client')), $error_base ? $error_base : self::new_url()));
            exit;
        }

        // Motif : pilote les champs exigés. Slug inconnu = formulaire trafiqué.
        $reasons = self::reasons();
        $reason  = isset($_POST['reason']) ? sanitize_key(wp_unslash($_POST['reason'])) : '';
        if (!isset($reasons[$reason])) {
            wp_safe_redirect(add_query_arg('sav_error', rawurlencode(__('Choisissez le motif de votre demande.', 'youvape-sav-client')), $error_base ? $error_base : self::new_url()));
            exit;
        }
        $config = $reasons[$reason];

        // order_id : absint('') renvoie 0, que l'API interprète comme une commande
        // invalide. On ne transmet donc l'order_id que s'il est strictement
        // positif, sinon chaîne vide.
        $order_id = isset($_POST['order_id']) ? absint($_POST['order_id']) : 0;

        // Produits concernés : plusieurs cases à cocher possibles.
        $products = array();
        if (isset($_POST['products']) && is_array($_POST['products'])) {
            foreach (wp_unslash($_POST['products']) as $product) {
                if (is_array($product)) {
                    continue;
                }
                $product = sanitize_text_field($product);
                if ('' !== $product) {
                    $products[] = $product;
                }
            }
            $products = array_slice(array_values(array_unique($products)), 0, self::MAX_PRODUCTS);
        }

        // Règles du motif, revérifiées ici (le formulaire les applique aussi, mais
        // un POST forgé ne doit pas passer). L'API refait le même contrôle.
        if ($config['order'] && $order_id <= 0) {
            wp_safe_redirect(add_query_arg('sav_error', rawurlencode(__('Sélectionnez la commande concernée.', 'youvape-sav-client')), $error_base ? $error_base : self::new_url(0, $reason)));
            exit;
        }
        if ($config['products'] && empty($products)) {
            wp_safe_redirect(add_query_arg('sav_error', rawurlencode(__('Sélectionnez au moins un produit concerné.', 'youvape-sav-client')), $error_base ? $error_base : self::new_url($order_id, $reason)));
            exit;
        }
        // Motif sans commande : on ignore toute commande/produit qui traînerait
        // dans le POST (champs masqués côté navigateur).
        if (!$config['order']) {
            $order_id = 0;
            $products = array();
        }

        $fields = array(
            'reason'   => $reason,
            'body'     => isset($_POST['body']) ? sanitize_textarea_field(wp_unslash($_POST['body'])) : '',
            'order_id' => $order_id > 0 ? $order_id : '',
            'products' => $products,
        );

        $files = isset($_FILES['attachments']) ? $_FILES['attachments'] : array();

        $result = Youvape_SAV_Api_Client::create_ticket($fields, $files);

        if (is_wp_error($result)) {
            $msg = $result->get_error_message();
            wp_safe_redirect(add_query_arg('sav_error', rawurlencode($msg), $error_base ? $error_base : self::new_url($order_id, $reason)));
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
