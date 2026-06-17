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
        return $out;
    }

    public function render_page() {
        if (!current_user_can('manage_options')) {
            return;
        }
        $api_url    = self::get('api_url');
        $api_secret = self::get('api_secret');

        // Si des constantes wp-config sont définies, elles priment : on le signale.
        $url_locked    = defined('YOUVAPE_SAV_API_URL') && YOUVAPE_SAV_API_URL;
        $secret_locked = defined('YOUVAPE_SAV_API_SECRET') && YOUVAPE_SAV_API_SECRET;
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
                <?php submit_button(); ?>
            </form>
        </div>
        <?php
    }
}
