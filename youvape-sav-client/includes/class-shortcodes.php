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

    /**
     * Paramètre d'URL portant la page de retour après connexion.
     *
     * WooCommerce redirige après connexion vers `$_POST['redirect']` s'il est
     * présent, sinon vers le référent, sinon vers « Mon compte »
     * (class-wc-form-handler.php). Son gabarit de connexion n'émet pas ce champ ;
     * on l'injecte donc via `woocommerce_login_form_end`, en le lisant depuis ce
     * paramètre. Le référent ne conviendrait pas : au moment du POST, il pointe
     * sur la page « Mon compte » elle-même, pas sur le formulaire de contact.
     */
    const REDIRECT_ARG = 'youvape_sav_redirect';

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
        // Retour au formulaire après connexion OU inscription depuis Mon compte.
        add_action('woocommerce_login_form_end', array($this, 'inject_redirect_field'));
        add_action('woocommerce_register_form_end', array($this, 'inject_redirect_field'));
        // Priorité tardive : le thème enfant force la redirection vers le panier
        // en priorité 10, sans tenir compte de la destination calculée. On repasse
        // après lui, mais seulement si le visiteur vient de notre formulaire.
        add_filter('woocommerce_login_redirect', array($this, 'filter_redirect'), 99);
        add_filter('woocommerce_registration_redirect', array($this, 'filter_redirect'), 99);
    }

    /**
     * Ramène le visiteur sur le formulaire après connexion ou inscription.
     *
     * On ne se repose pas sur le champ `redirect` de WooCommerce : le thème
     * enfant écrase la destination via `woocommerce_login_redirect` pour envoyer
     * tout le monde au panier. On porte donc notre propre champ et on repasse
     * après lui — sans champ, ce filtre est transparent et le comportement
     * habituel de la boutique est intact.
     *
     * @param string $redirect destination calculée en amont
     * @return string
     */
    public function filter_redirect($redirect) {
        if (empty($_POST[self::REDIRECT_ARG])) {
            return $redirect;
        }
        $target = wp_validate_redirect(
            esc_url_raw(wp_unslash($_POST[self::REDIRECT_ARG])),
            ''
        );
        return $target ? $target : $redirect;
    }

    /**
     * Reporte la page de retour de l'URL vers un champ caché, dans les
     * formulaires de connexion et d'inscription de WooCommerce.
     *
     * Champ à notre nom plutôt que le `redirect` de WooCommerce : ce dernier est
     * écrasé par le thème (voir filter_redirect). Le nôtre traverse intact.
     *
     * `wp_validate_redirect` avec un repli vide écarte toute URL hors du site :
     * ce paramètre venant de l'URL, il ne doit pas pouvoir servir de redirection
     * ouverte vers un domaine tiers.
     */
    public function inject_redirect_field() {
        if (empty($_GET[self::REDIRECT_ARG])) {
            return;
        }
        $target = wp_validate_redirect(
            esc_url_raw(wp_unslash($_GET[self::REDIRECT_ARG])),
            ''
        );
        if (!$target) {
            return;
        }
        printf(
            '<input type="hidden" name="%s" value="%s" />',
            esc_attr(self::REDIRECT_ARG),
            esc_url($target)
        );
    }

    /**
     * URL de connexion : la page « Mon compte » de WooCommerce, et non
     * wp-login.php — un client n'a pas à voir l'écran d'administration
     * WordPress. On y joint la page de retour.
     *
     * @param string $return_url page à retrouver une fois connecté
     * @return string
     */
    private static function login_url($return_url) {
        if (!function_exists('wc_get_page_permalink')) {
            return wp_login_url($return_url);
        }
        $myaccount = wc_get_page_permalink('myaccount');
        if (!$myaccount) {
            return wp_login_url($return_url);
        }
        // add_query_arg n'encode pas la valeur : à faire nous-mêmes.
        return add_query_arg(self::REDIRECT_ARG, rawurlencode($return_url), $myaccount);
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

        // Turnstile : uniquement sur le formulaire public. Un client connecte est
        // deja authentifie, lui imposer un controle anti-robot n'apporte rien.
        $turnstile_site_key = Youvape_SAV_Settings::turnstile_enabled()
            ? Youvape_SAV_Settings::turnstile_site_key()
            : '';
        if ('' !== $turnstile_site_key) {
            // Version null : Cloudflare sert un point d'entree stable, un ?ver=
            // ne ferait que casser leur mise en cache.
            wp_enqueue_script(
                'cloudflare-turnstile',
                'https://challenges.cloudflare.com/turnstile/v0/api.js',
                array(),
                null,
                true
            );
        }

        return $this->capture('public-form.php', array(
            'error'              => $error,
            'action_url'         => $return_url,
            'nonce_field'        => wp_nonce_field('youvape_sav_public', 'youvape_sav_public_nonce', true, false),
            'honeypot_field'     => self::HONEYPOT_FIELD,
            'login_url'          => self::login_url($return_url),
            'turnstile_site_key' => $turnstile_site_key,
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

        // Cloudflare Turnstile. Le pot-de-miel ne suffit plus : le formulaire
        // etait utilise comme relais d'envoi par des robots, ce qui expose le
        // domaine d'envoi a une mise en liste noire.
        $turnstile_error = self::verify_turnstile();
        if (null !== $turnstile_error) {
            wp_safe_redirect(add_query_arg('sav_error', rawurlencode($turnstile_error), $return_url));
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
     * Verifie le jeton Turnstile aupres de Cloudflare.
     *
     * Choix assume : on echoue FERME. Si Cloudflare est injoignable, la demande
     * est refusee avec une invitation a reessayer, plutot que laissee passer.
     * Laisser passer en cas de panne rouvrirait exactement la breche qu'on
     * ferme — et un robot n'a qu'a provoquer l'erreur pour en profiter.
     *
     * @return string|null message d'erreur a afficher, ou null si tout va bien
     */
    private static function verify_turnstile() {
        if (!Youvape_SAV_Settings::turnstile_enabled()) {
            return null; // Non configure : on s'en remet au seul pot-de-miel.
        }

        $token = isset($_POST['cf-turnstile-response'])
            ? sanitize_text_field(wp_unslash($_POST['cf-turnstile-response']))
            : '';
        if ('' === $token) {
            return __('Merci de valider le contrôle anti-robot avant d\'envoyer votre demande.', 'youvape-sav-client');
        }

        $body = array(
            'secret'   => Youvape_SAV_Settings::turnstile_secret_key(),
            'response' => $token,
        );
        $remote_ip = self::client_ip();
        if ('' !== $remote_ip) {
            $body['remoteip'] = $remote_ip;
        }

        $response = wp_remote_post(
            'https://challenges.cloudflare.com/turnstile/v0/siteverify',
            array('timeout' => 10, 'body' => $body)
        );

        if (is_wp_error($response)) {
            return __('La vérification anti-robot n\'a pas abouti, merci de réessayer dans un instant.', 'youvape-sav-client');
        }

        $data = json_decode(wp_remote_retrieve_body($response), true);
        if (!is_array($data) || empty($data['success'])) {
            return __('Le contrôle anti-robot a échoué. Rechargez la page et renvoyez votre demande.', 'youvape-sav-client');
        }

        return null;
    }

    /**
     * IP du visiteur, transmise a Cloudflare pour affiner la verification.
     *
     * Le site est servi derriere Cloudflare : REMOTE_ADDR est alors l'IP du
     * proxy, jamais celle du visiteur. CF-Connecting-IP porte la vraie. On ne
     * fait confiance a cet en-tete que pour ce seul usage (parametre optionnel
     * de siteverify) : il n'est ni journalise, ni utilise pour une decision.
     *
     * @return string
     */
    private static function client_ip() {
        $candidates = array('HTTP_CF_CONNECTING_IP', 'REMOTE_ADDR');
        foreach ($candidates as $key) {
            if (empty($_SERVER[$key])) {
                continue;
            }
            $ip = trim(wp_unslash($_SERVER[$key]));
            if (filter_var($ip, FILTER_VALIDATE_IP)) {
                return $ip;
            }
        }
        return '';
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
