<?php
/**
 * Page de réglages du plugin (Réglages → Espace client SAV).
 *
 * Permet de saisir l'URL de l'API Node et le secret partagé, sans toucher à
 * wp-config.php. Les valeurs sont stockées dans l'option `youvape_sav_settings`.
 *
 * Priorité de résolution (voir Youvape_SAV_Api_Client) :
 *   1. constantes wp-config (YOUVAPE_SAV_API_URL / YOUVAPE_SAV_API_SECRET) si définies
 *   2. sinon, ces réglages.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Youvape_SAV_Settings {

    const OPTION = 'youvape_sav_settings';

    /** @var Youvape_SAV_Settings */
    private static $instance = null;

    public static function instance() {
        if (null === self::$instance) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function register() {
        add_action('admin_menu', array($this, 'add_menu'));
        add_action('admin_init', array($this, 'register_settings'));
    }

    /** Valeur d'un réglage (option), avec valeur par défaut. */
    public static function get($key, $default = '') {
        $opts = get_option(self::OPTION, array());
        return isset($opts[$key]) && '' !== $opts[$key] ? $opts[$key] : $default;
    }

    /**
     * Consignes légales affichées au client qui choisit le motif « Je souhaite
     * me rétracter ». Modifiable dans les réglages ; le texte ci-dessous n'est
     * qu'un point de départ à valider avec les CGV de la boutique.
     *
     * @return string HTML (déjà filtré wp_kses_post à l'enregistrement)
     */
    public static function default_withdrawal_notice() {
        return
            '<p>' . __('Conformément aux articles L221-18 et suivants du Code de la consommation, vous disposez d\'un délai de <strong>14 jours à compter de la réception de votre commande</strong> pour exercer votre droit de rétractation, sans avoir à motiver votre décision.', 'youvape-sav-client') . '</p>' .
            '<p>' . __('Les produits doivent être retournés complets, non utilisés et dans leur emballage d\'origine. Pour des raisons d\'hygiène et de protection de la santé, les produits descellés après la livraison ne peuvent pas être repris (e-liquides, résistances, drip tips et tout accessoire en contact avec la bouche).', 'youvape-sav-client') . '</p>' .
            '<p>' . __('Les frais de retour restent à votre charge. Le remboursement intervient dans les 14 jours suivant la réception du retour, ou la preuve de son expédition.', 'youvape-sav-client') . '</p>' .
            '<p>' . __('Indiquez ci-dessous la commande et les produits concernés : notre service client vous transmettra la procédure de retour.', 'youvape-sav-client') . '</p>';
    }

    /**
     * Consignes de rétractation à afficher (réglage, ou texte par défaut).
     *
     * @return string HTML
     */
    public static function withdrawal_notice() {
        $custom = self::get('withdrawal_notice');
        return '' !== trim($custom) ? $custom : self::default_withdrawal_notice();
    }

    /**
     * Cle de site Turnstile (publique, rendue dans le formulaire).
     *
     * @return string
     */
    public static function turnstile_site_key() {
        return trim(self::get('turnstile_site_key'));
    }

    /**
     * Cle secrete Turnstile, utilisee uniquement pour l'appel serveur a
     * siteverify. La constante wp-config prime sur l'option, pour les
     * installations qui preferent garder leurs secrets hors base.
     *
     * @return string
     */
    public static function turnstile_secret_key() {
        if (defined('YOUVAPE_SAV_TURNSTILE_SECRET') && YOUVAPE_SAV_TURNSTILE_SECRET) {
            return trim(YOUVAPE_SAV_TURNSTILE_SECRET);
        }
        return trim(self::get('turnstile_secret_key'));
    }

    /**
     * La protection n'est active que si les DEUX cles sont renseignees : une
     * cle de site sans secret afficherait un widget que personne ne verifie,
     * ce qui donnerait une fausse impression de securite.
     *
     * @return bool
     */
    public static function turnstile_enabled() {
        return '' !== self::turnstile_site_key() && '' !== self::turnstile_secret_key();
    }

    public function add_menu() {
        add_options_page(
            __('Espace client SAV', 'youvape-sav-client'),
            __('Espace client SAV', 'youvape-sav-client'),
            'manage_options',
            'youvape-sav-client',
            array($this, 'render_page')
        );
    }

    public function register_settings() {
        register_setting('youvape_sav_group', self::OPTION, array($this, 'sanitize'));
    }

    /** Nettoyage des valeurs avant stockage. */
    public function sanitize($input) {
        $out = array();
        $out['api_url'] = isset($input['api_url']) ? esc_url_raw(trim($input['api_url'])) : '';
        $out['api_secret'] = isset($input['api_secret']) ? trim($input['api_secret']) : '';
        // Turnstile : la cle de site est publique (elle part dans le HTML), la
        // cle secrete ne quitte jamais le serveur.
        $out['turnstile_site_key'] = isset($input['turnstile_site_key'])
            ? sanitize_text_field(trim($input['turnstile_site_key']))
            : '';
        // Champ absent du POST = champ desactive (secret impose par wp-config) :
        // on conserve la valeur stockee au lieu de l'effacer. Une chaine vide
        // explicitement soumise reste, elle, un effacement volontaire.
        $out['turnstile_secret_key'] = isset($input['turnstile_secret_key'])
            ? trim($input['turnstile_secret_key'])
            : self::get('turnstile_secret_key');
        // Texte légal : HTML de contenu autorisé (listes, liens, gras), pas de
        // script — le champ n'est éditable que par un administrateur.
        $out['withdrawal_notice'] = isset($input['withdrawal_notice'])
            ? wp_kses_post(trim($input['withdrawal_notice']))
            : '';
        return $out;
    }

    public function render_page() {
        if (!current_user_can('manage_options')) {
            return;
        }
        $api_url    = self::get('api_url');
        $api_secret = self::get('api_secret');
        // Champ vide = on propose le texte par défaut, pour que l'admin parte
        // d'une base rédigée plutôt que d'une zone blanche.
        $notice     = self::get('withdrawal_notice', self::default_withdrawal_notice());

        // Si des constantes wp-config sont définies, elles priment : on le signale.
        $url_locked    = defined('YOUVAPE_SAV_API_URL') && YOUVAPE_SAV_API_URL;
        $secret_locked = defined('YOUVAPE_SAV_API_SECRET') && YOUVAPE_SAV_API_SECRET;
        $turnstile_site_key   = self::turnstile_site_key();
        $turnstile_locked     = defined('YOUVAPE_SAV_TURNSTILE_SECRET') && YOUVAPE_SAV_TURNSTILE_SECRET;
        $turnstile_secret_key = $turnstile_locked ? '' : self::get('turnstile_secret_key');
        ?>
        <div class="wrap">
            <h1><?php echo esc_html__('Espace client SAV — Réglages', 'youvape-sav-client'); ?></h1>

            <p><?php echo esc_html__('Connexion à l\'application de tickets Youvape. Le secret doit être identique à celui généré dans l\'onglet DANGER de l\'application.', 'youvape-sav-client'); ?></p>

            <form method="post" action="options.php">
                <?php settings_fields('youvape_sav_group'); ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="youvape_sav_api_url"><?php echo esc_html__('URL de l\'API', 'youvape-sav-client'); ?></label></th>
                        <td>
                            <input name="<?php echo esc_attr(self::OPTION); ?>[api_url]" id="youvape_sav_api_url"
                                   type="url" class="regular-text" value="<?php echo esc_attr($api_url); ?>"
                                   placeholder="https://api.youvape.fr" <?php disabled($url_locked); ?> />
                            <?php if ($url_locked) : ?>
                                <p class="description"><?php echo esc_html__('Définie dans wp-config.php (YOUVAPE_SAV_API_URL) — prioritaire.', 'youvape-sav-client'); ?></p>
                            <?php endif; ?>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="youvape_sav_api_secret"><?php echo esc_html__('Secret partagé', 'youvape-sav-client'); ?></label></th>
                        <td>
                            <input name="<?php echo esc_attr(self::OPTION); ?>[api_secret]" id="youvape_sav_api_secret"
                                   type="password" class="regular-text" value="<?php echo esc_attr($api_secret); ?>"
                                   autocomplete="off" <?php disabled($secret_locked); ?> />
                            <button type="button" class="button" onclick="(function(b){var i=document.getElementById('youvape_sav_api_secret');i.type=i.type==='password'?'text':'password';})();">
                                <?php echo esc_html__('Afficher / masquer', 'youvape-sav-client'); ?>
                            </button>
                            <?php if ($secret_locked) : ?>
                                <p class="description"><?php echo esc_html__('Défini dans wp-config.php (YOUVAPE_SAV_API_SECRET) — prioritaire.', 'youvape-sav-client'); ?></p>
                            <?php else : ?>
                                <p class="description"><?php echo esc_html__('Collez ici le secret généré dans l\'onglet DANGER de l\'application.', 'youvape-sav-client'); ?></p>
                            <?php endif; ?>
                        </td>
                    </tr>
                </table>

                <h2><?php echo esc_html__('Anti-spam du formulaire public', 'youvape-sav-client'); ?></h2>
                <p class="description">
                    <?php echo esc_html__('Cloudflare Turnstile protège le formulaire de contact ouvert aux visiteurs non connectés. Sans ces deux clés, seul le pot-de-miel filtre les robots.', 'youvape-sav-client'); ?>
                </p>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="youvape_sav_turnstile_site_key"><?php echo esc_html__('Clé de site', 'youvape-sav-client'); ?></label></th>
                        <td>
                            <input name="<?php echo esc_attr(self::OPTION); ?>[turnstile_site_key]" id="youvape_sav_turnstile_site_key"
                                   type="text" class="regular-text" value="<?php echo esc_attr($turnstile_site_key); ?>"
                                   autocomplete="off" />
                            <p class="description"><?php echo esc_html__('Publique : elle apparaît dans le code du formulaire.', 'youvape-sav-client'); ?></p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="youvape_sav_turnstile_secret_key"><?php echo esc_html__('Clé secrète', 'youvape-sav-client'); ?></label></th>
                        <td>
                            <input name="<?php echo esc_attr(self::OPTION); ?>[turnstile_secret_key]" id="youvape_sav_turnstile_secret_key"
                                   type="password" class="regular-text" value="<?php echo esc_attr($turnstile_secret_key); ?>"
                                   autocomplete="off" <?php disabled($turnstile_locked); ?> />
                            <button type="button" class="button" onclick="(function(){var i=document.getElementById('youvape_sav_turnstile_secret_key');i.type=i.type==='password'?'text':'password';})();">
                                <?php echo esc_html__('Afficher / masquer', 'youvape-sav-client'); ?>
                            </button>
                            <?php if ($turnstile_locked) : ?>
                                <p class="description"><?php echo esc_html__('Définie dans wp-config.php (YOUVAPE_SAV_TURNSTILE_SECRET) — prioritaire.', 'youvape-sav-client'); ?></p>
                            <?php endif; ?>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><?php echo esc_html__('État', 'youvape-sav-client'); ?></th>
                        <td>
                            <?php if (self::turnstile_enabled()) : ?>
                                <span style="color:#046b2d;font-weight:600;">&#10003; <?php echo esc_html__('Protection active', 'youvape-sav-client'); ?></span>
                            <?php else : ?>
                                <span style="color:#b32d2e;font-weight:600;">&#9888; <?php echo esc_html__('Protection inactive — les deux clés sont nécessaires.', 'youvape-sav-client'); ?></span>
                            <?php endif; ?>
                        </td>
                    </tr>
                </table>

                <h2><?php echo esc_html__('Consignes de rétractation', 'youvape-sav-client'); ?></h2>
                <p class="description">
                    <?php echo esc_html__('Texte affiché au client dans le formulaire « Mes demandes » lorsqu\'il choisit le motif « Je souhaite me rétracter ». À faire valider par rapport à vos CGV.', 'youvape-sav-client'); ?>
                </p>
                <?php
                wp_editor(
                    $notice,
                    'youvape_sav_withdrawal_notice',
                    array(
                        'textarea_name' => self::OPTION . '[withdrawal_notice]',
                        'textarea_rows' => 12,
                        'media_buttons' => false,
                        'teeny'         => true,
                    )
                );
                ?>

                <?php submit_button(); ?>
            </form>

            <?php $this->render_shortcodes_help(); ?>
        </div>
        <?php
    }

    /**
     * Pense-bête des shortcodes, affiché sous les réglages.
     *
     * Les shortcodes sont dans des champs en lecture seule et non dans du texte
     * mis en forme : copier depuis un champ de saisie ne rapporte que du texte
     * brut. Coller un shortcode depuis un bloc de code d'une page web embarque
     * sa mise en forme (<pre><code>), ce qui casse l'affichage du formulaire —
     * la police passe en chasse fixe et les sauts de ligne sont rendus tels
     * quels. Ce champ évite le piège.
     */
    private function render_shortcodes_help() {
        $shortcodes = array(
            array(
                'code'  => '[youvape_sav_form]',
                'title' => __('Formulaire de demande', 'youvape-sav-client'),
                'desc'  => __('À placer sur la page « Nous contacter ». Le formulaire s\'adapte seul : un client connecté voit les trois motifs avec ses commandes et ses produits ; un visiteur non connecté saisit son nom, son email et son message.', 'youvape-sav-client'),
            ),
            array(
                'code'  => '[youvape_sav_bouton page="/contact/" texte="Nous contacter"]',
                'title' => __('Bouton vers le formulaire', 'youvape-sav-client'),
                'desc'  => __('Pour renvoyer vers la page du formulaire depuis un autre endroit du site. Les deux attributs sont facultatifs.', 'youvape-sav-client'),
            ),
        );
        ?>
        <hr style="margin:30px 0" />

        <h2><?php echo esc_html__('Shortcodes disponibles', 'youvape-sav-client'); ?></h2>

        <p class="description" style="max-width:760px">
            <?php echo esc_html__('Cliquez dans un champ pour le sélectionner, ou utilisez le bouton Copier. Un menu WordPress pointe vers une URL et non vers un shortcode : placez le formulaire sur une page, puis faites pointer l\'entrée de menu vers cette page.', 'youvape-sav-client'); ?>
        </p>

        <table class="form-table" role="presentation">
            <?php foreach ($shortcodes as $i => $sc) : $id = 'youvape-sav-sc-' . $i; ?>
                <tr>
                    <th scope="row"><label for="<?php echo esc_attr($id); ?>"><?php echo esc_html($sc['title']); ?></label></th>
                    <td>
                        <input type="text" id="<?php echo esc_attr($id); ?>" class="large-text code" readonly
                               value="<?php echo esc_attr($sc['code']); ?>"
                               onclick="this.select();" />
                        <button type="button" class="button" data-youvape-copy="<?php echo esc_attr($id); ?>">
                            <?php echo esc_html__('Copier', 'youvape-sav-client'); ?>
                        </button>
                        <p class="description" style="max-width:700px"><?php echo esc_html($sc['desc']); ?></p>
                    </td>
                </tr>
            <?php endforeach; ?>
        </table>

        <div class="notice notice-warning inline" style="max-width:760px;margin:16px 0">
            <p>
                <strong><?php echo esc_html__('À savoir en collant un shortcode :', 'youvape-sav-client'); ?></strong>
                <?php echo esc_html__('collez-le en texte brut (⌘⇧V sur Mac, Ctrl+Maj+V sur Windows). Un shortcode copié depuis un bloc de code d\'une page web embarque sa mise en forme et se retrouve enfermé dans un bloc préformaté : le formulaire s\'affiche alors en police à chasse fixe, sans retour à la ligne.', 'youvape-sav-client'); ?>
            </p>
        </div>

        <script>
        document.querySelectorAll('[data-youvape-copy]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var input = document.getElementById(btn.getAttribute('data-youvape-copy'));
                if (!input) { return; }
                input.select();
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(input.value);
                } else {
                    document.execCommand('copy');
                }
                var label = btn.textContent;
                btn.textContent = <?php echo wp_json_encode(__('Copié !', 'youvape-sav-client')); ?>;
                setTimeout(function () { btn.textContent = label; }, 1500);
            });
        });
        </script>
        <?php
    }
}
