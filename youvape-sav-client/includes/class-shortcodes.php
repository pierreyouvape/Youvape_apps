<?php
/**
 * Shortcodes publics du plugin.
 *
 *   [youvape_sav_form]    formulaire de demande, posable sur n'importe quelle page
 *   [youvape_sav_bouton]  bouton renvoyant vers la page qui porte le formulaire
 *
 * Le formulaire s'adapte à l'état de connexion :
 *   - visiteur connecté     → formulaire complet (3 motifs, ses commandes, ses
 *                             produits), identique à celui de "Mon compte" ;
 *   - visiteur non connecté → nom + email + message + pièces jointes, motif figé
 *                             sur "question avant commande" (le seul qui tienne
 *                             sans identité : ni commande ni produit à autoriser).
 *
 * Un menu WordPress pointe vers une URL, pas vers un shortcode : le montage
 * attendu est donc une page "Nous contacter" contenant [youvape_sav_form], vers
 * laquelle pointe l'entrée de menu.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Youvape_SAV_Shortcodes {

    /** Nom du champ pot-de-miel (doit rester vide : seuls les bots le remplissent). */
    const HONEYPOT_FIELD = 'youvape_sav_site_web';

    /** @var Youvape_SAV_Shortcodes */
    private static $instance = null;

    public static function instance() {
        if (null === self::$instance) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function register() {
        add_shortcode('youvape_sav_form', array($this, 'render_form'));
        add_shortcode('youvape_sav_bouton', array($this, 'render_button'));
        // Traitement du POST public avant tout rendu (POST-redirect-GET).
        add_action('template_redirect', array($this, 'maybe_handle_public_create'));
    }

    /**
     * La page courante porte-t-elle un shortcode du plugin ? Sert à charger les
     * assets dans wp_head plutôt qu'en pied de page (sinon le formulaire
     * s'affiche brièvement sans style).
     *
     * On regarde post_content, mais aussi les métadonnées : les constructeurs de
     * page et les champs personnalisés (ACF) stockent le contenu hors de
     * post_content, et la détection classique passerait à côté.
     *
     * @return bool
     */
    public static function page_has_form() {
        if (!is_singular()) {
            return false;
        }
        $post = get_post();
        if (!$post) {
            return false;
        }

        if (!empty($post->post_content)
            && (has_shortcode($post->post_content, 'youvape_sav_form')
                || has_shortcode($post->post_content, 'youvape_sav_bouton'))) {
            return true;
        }

        // Métadonnées : déjà en cache pour le post courant, le coût est nul.
        foreach ((array) get_post_meta($post->ID) as $values) {
            foreach ((array) $values as $value) {
                if (is_string($value)
                    && (false !== strpos($value, '[youvape_sav_form')
                        || false !== strpos($value, '[youvape_sav_bouton'))) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * URL de la page portant le formulaire, sans les paramètres de retour.
     *
     * On privilégie le permalien : c'est l'URL canonique de la page, propre et
     * indépendante de la structure de permaliens comme des paramètres présents
     * dans la requête courante.
     *
     * @return string
     */
    private static function current_url() {
        if (is_singular()) {
            $permalink = get_permalink();
            if ($permalink) {
                return $permalink;
            }
        }
        return remove_query_arg(
            array('sav_error', 'sav_sent'),
            home_url(add_query_arg(array()))
        );
    }

    /**
     * [youvape_sav_form] — rend le formulaire adapté à l'état de connexion.
     *
     * @return string HTML
     */
    public function render_form() {
        Youvape_SAV_Account_Endpoint::enqueue_front_assets();

        $return_url = self::current_url();
        $error = isset($_GET['sav_error']) ? sanitize_text_field(wp_unslash($_GET['sav_error'])) : null;

        // Confirmation après envoi d'une demande publique.
        if (isset($_GET['sav_sent'])) {
            return $this->capture('public-sent.php', array(
                'return_url' => $return_url,
            ));
        }

        if (is_user_logged_in()) {
            return $this->render_logged_in_form($return_url, $error);
        }

        return $this->capture('public-form.php', array(
            'error'          => $error,
            'action_url'     => $return_url,
            'nonce_field'    => wp_nonce_field('youvape_sav_public', 'youvape_sav_public_nonce', true, false),
            'honeypot_field' => self::HONEYPOT_FIELD,
            'login_url'      => wp_login_url($return_url),
        ));
    }

    /**
     * Formulaire complet pour un client connecté, rendu hors de "Mon compte".
     * Réutilise le même template que l'onglet du compte : un seul formulaire à
     * maintenir.
     */
    private function render_logged_in_form($return_url, $error) {
        $orders = Youvape_SAV_Api_Client::get_orders();
        if (is_wp_error($orders)) {
            $orders = array();
        }

        $reasons = Youvape_SAV_Account_Endpoint::reasons();
        $preselect_reason = isset($_GET['reason']) ? sanitize_key(wp_unslash($_GET['reason'])) : '';
        if (!isset($reasons[$preselect_reason])) {
            $preselect_reason = '';
        }

        return $this->capture('new-ticket.php', array(
            'orders'            => Youvape_SAV_Account_Endpoint::decorate_orders($orders),
            'preselect'         => isset($_GET['order_id']) ? absint($_GET['order_id']) : 0,
            'preselect_reason'  => $preselect_reason,
            'reasons'           => $reasons,
            'withdrawal_notice' => Youvape_SAV_Settings::withdrawal_notice(),
            'withdrawal_days'   => Youvape_SAV_Account_Endpoint::WITHDRAWAL_DAYS,
            'error'             => $error,
            // Hors "Mon compte" : pas de lien retour vers la liste, et le POST
            // revient sur la page courante.
            'list_url'          => '',
            'action_url'        => $return_url,
            'return_url'        => $return_url,
            'nonce_field'       => wp_nonce_field('youvape_sav_create', 'youvape_sav_nonce', true, false),
        ));
    }

    /**
     * [youvape_sav_bouton page="/nous-contacter/" texte="Nous contacter"]
     *
     * @param array $atts
     * @return string HTML
     */
    public function render_button($atts) {
        wp_enqueue_style('youvape-sav-client');

        $atts = shortcode_atts(array(
            'page'  => '',
            'texte' => __('Nous contacter', 'youvape-sav-client'),
        ), $atts, 'youvape_sav_bouton');

        // Sans page indiquée, on renvoie vers l'espace du compte (le visiteur
        // non connecté y trouvera l'écran de connexion WooCommerce).
        $url = $atts['page'] !== ''
            ? $atts['page']
            : (function_exists('wc_get_account_endpoint_url')
                ? Youvape_SAV_Account_Endpoint::new_url()
                : home_url('/'));

        return sprintf(
            '<a class="youvape-sav__cta button" href="%1$s">%2$s</a>',
            esc_url($url),
            esc_html($atts['texte'])
        );
    }

    /**
     * Traite la soumission du formulaire public (visiteur non connecté).
     * POST-redirect-GET : succès → ?sav_sent=1, échec → ?sav_error=...
     */
    public function maybe_handle_public_create() {
        if (empty($_POST['youvape_sav_public_submit'])) {
            return;
        }

        $return_url = isset($_POST['youvape_sav_return'])
            ? esc_url_raw(wp_unslash($_POST['youvape_sav_return']))
            : home_url('/');

        // CSRF. Note : pour un visiteur déconnecté, le nonce WordPress n'est pas
        // lié à une session — il borne surtout la validité dans le temps.
        if (!isset($_POST['youvape_sav_public_nonce'])
            || !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['youvape_sav_public_nonce'])), 'youvape_sav_public')) {
            wp_safe_redirect(add_query_arg('sav_error', rawurlencode(__('Session expirée, merci de renvoyer votre demande.', 'youvape-sav-client')), $return_url));
            exit;
        }

        // Pot-de-miel : champ invisible pour un humain. S'il est rempli, on fait
        // comme si tout s'était bien passé, sans rien créer.
        if (!empty($_POST[self::HONEYPOT_FIELD])) {
            wp_safe_redirect(add_query_arg('sav_sent', '1', $return_url));
            exit;
        }

        $fields = array(
            'name'  => isset($_POST['name']) ? sanitize_text_field(wp_unslash($_POST['name'])) : '',
            'email' => isset($_POST['email']) ? sanitize_email(wp_unslash($_POST['email'])) : '',
            'body'  => isset($_POST['body']) ? sanitize_textarea_field(wp_unslash($_POST['body'])) : '',
        );
        $files = isset($_FILES['attachments']) ? $_FILES['attachments'] : array();

        $result = Youvape_SAV_Api_Client::create_public_ticket($fields, $files);

        if (is_wp_error($result)) {
            wp_safe_redirect(add_query_arg('sav_error', rawurlencode($result->get_error_message()), $return_url));
            exit;
        }

        wp_safe_redirect(add_query_arg('sav_sent', '1', $return_url));
        exit;
    }

    /**
     * Rend un template (surchargeable par le thème) et retourne son HTML —
     * un shortcode doit retourner sa sortie, jamais l'afficher directement.
     *
     * @param string $template
     * @param array  $vars
     * @return string
     */
    private function capture($template, $vars = array()) {
        $theme_path = trailingslashit('woocommerce/youvape-sav') . $template;
        $located    = locate_template(array($theme_path));
        if (!$located) {
            $located = YOUVAPE_SAV_PLUGIN_DIR . 'templates/' . $template;
        }
        if (!file_exists($located)) {
            return '';
        }

        ob_start();
        // extract() contrôlé : $vars est construit par le plugin, pas par
        // l'utilisateur (même pattern que l'onglet Mon Compte).
        extract($vars, EXTR_SKIP);
        include $located;

        return self::neutralize_autop(ob_get_clean());
    }

    /**
     * Supprime les sauts de ligne de la sortie d'un shortcode.
     *
     * WordPress applique `wpautop` au contenu des pages : double saut de ligne
     * → <p>, simple saut de ligne → <br>. Normalement les shortcodes sont
     * développés après ce filtre et y échappent, mais beaucoup de constructeurs
     * de page rendent leurs champs avec `wpautop(do_shortcode(...))` — l'ordre
     * s'inverse et notre HTML indenté se retrouve truffé de paragraphes vides
     * (grands trous verticaux) et de <br> parasites (astérisque du champ
     * obligatoire rejeté à la ligne).
     *
     * Sans aucun saut de ligne, wpautop n'a plus rien à convertir. On remplace
     * par une espace plutôt que par du vide, pour préserver les séparations
     * entre éléments en ligne. Le JS étant dans un fichier externe, il n'y a
     * plus de <script> inline à mutiler ici.
     *
     * @param string $html
     * @return string
     */
    private static function neutralize_autop($html) {
        return trim(preg_replace('/\s*\R\s*/u', ' ', $html));
    }
}
