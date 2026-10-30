<?php
/**
 * Admin - État de la file, pause, et lignes en échec à rejouer.
 */

namespace YouSync;

defined('ABSPATH') || exit;

class Admin {

    const CAPABILITY = 'manage_woocommerce';
    const PAGE = 'yousync';

    /**
     * Initialize admin
     */
    public static function init() {
        add_action('admin_menu', [__CLASS__, 'add_menu']);
        add_action('admin_enqueue_scripts', [__CLASS__, 'enqueue_assets']);
        add_action('admin_post_yousync_set_pause', [__CLASS__, 'handle_set_pause']);
        add_action('admin_post_yousync_replay_failed', [__CLASS__, 'handle_replay_failed']);
    }

    /**
     * Add admin menu
     */
    public static function add_menu() {
        add_menu_page('YouSync', 'YouSync', self::CAPABILITY, self::PAGE, [__CLASS__, 'render_dashboard'], 'dashicons-update', 56);
    }

    /**
     * Enqueue admin assets
     */
    public static function enqueue_assets($hook) {
        if (strpos($hook, self::PAGE) === false) {
            return;
        }

        wp_enqueue_style('yousync-admin', YOUSYNC_URL . 'admin/css/admin.css', [], YOUSYNC_VERSION);
    }

    /**
     * Render dashboard page
     */
    public static function render_dashboard() {
        if (!current_user_can(self::CAPABILITY)) {
            wp_die(esc_html__('Accès refusé.', 'yousync'));
        }

        $stats = Queue::stats();
        $paused = Queue::is_paused();
        $failed_rows = Queue::failed_rows();
        $last_poll = (int) get_option(Queue::LAST_POLL_OPTION);
        ?>
        <div class="wrap yousync-admin">
            <h1><span class="dashicons dashicons-update"></span> YouSync</h1>

            <?php if (isset($_GET['yousync_done'])): ?>
                <div class="notice notice-success is-dismissible"><p>Opération effectuée.</p></div>
            <?php endif; ?>

            <div class="yousync-cards">
                <div class="yousync-card <?php echo $paused ? 'status-off' : 'status-on'; ?>">
                    <h3>Livraison</h3>
                    <p class="yousync-big-number"><?php echo $paused ? 'En pause' : 'Active'; ?></p>
                    <p class="yousync-subtitle">Les événements s'enregistrent dans tous les cas.</p>
                </div>
                <div class="yousync-card">
                    <h3>En attente</h3>
                    <p class="yousync-big-number"><?php echo esc_html((string) (int) $stats['pending']); ?></p>
                    <p class="yousync-subtitle">
                        <?php echo $stats['oldest_pending_at'] ? 'Depuis ' . esc_html($stats['oldest_pending_at']) . ' UTC' : 'File vide'; ?>
                    </p>
                </div>
                <div class="yousync-card">
                    <h3>En échec</h3>
                    <p class="yousync-big-number"><?php echo esc_html((string) (int) $stats['failed']); ?></p>
                    <p class="yousync-subtitle">À rejouer une fois la cause corrigée.</p>
                </div>
                <div class="yousync-card">
                    <h3>Dernier passage du serveur</h3>
                    <p class="yousync-big-number"><?php echo $last_poll ? esc_html(human_time_diff($last_poll)) : '-'; ?></p>
                    <p class="yousync-subtitle">Le serveur vient chercher les événements.</p>
                </div>
            </div>

            <div class="yousync-section">
                <h2>Pause</h2>
                <p class="description">La pause suspend la livraison. Rien n'est perdu : tout repart à la reprise.</p>
                <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                    <input type="hidden" name="action" value="yousync_set_pause">
                    <input type="hidden" name="paused" value="<?php echo $paused ? '0' : '1'; ?>">
                    <?php wp_nonce_field('yousync_set_pause'); ?>
                    <button type="submit" class="button button-primary">
                        <?php echo $paused ? 'Reprendre la livraison' : 'Mettre en pause'; ?>
                    </button>
                </form>
            </div>

            <div class="yousync-section">
                <h2>Événements en échec</h2>
                <?php if (empty($failed_rows)): ?>
                    <p class="description">Aucun.</p>
                <?php else: ?>
                    <table class="widefat striped">
                        <thead>
                            <tr>
                                <th>Type</th>
                                <th>Identifiant</th>
                                <th>Action</th>
                                <th>Essais</th>
                                <th>Code</th>
                                <th>Date (UTC)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php foreach ($failed_rows as $row): ?>
                                <tr>
                                    <td><?php echo esc_html($row->object_type); ?></td>
                                    <td><?php echo esc_html($row->wp_id); ?></td>
                                    <td><?php echo esc_html($row->action); ?></td>
                                    <td><?php echo esc_html($row->attempts); ?></td>
                                    <td><?php echo esc_html($row->last_code); ?></td>
                                    <td><?php echo esc_html($row->created_at); ?></td>
                                </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="yousync-actions">
                        <input type="hidden" name="action" value="yousync_replay_failed">
                        <?php wp_nonce_field('yousync_replay_failed'); ?>
                        <button type="submit" class="button">Rejouer les événements en échec</button>
                    </form>
                <?php endif; ?>
            </div>
        </div>
        <?php
    }

    /**
     * Mettre en pause ou reprendre
     */
    public static function handle_set_pause() {
        self::guard('yousync_set_pause');
        Queue::set_paused(!empty($_POST['paused']));
        self::back();
    }

    /**
     * Rejouer les lignes en échec
     */
    public static function handle_replay_failed() {
        self::guard('yousync_replay_failed');
        Queue::replay_failed();
        self::back();
    }

    private static function guard($action) {
        if (!current_user_can(self::CAPABILITY)) {
            wp_die(esc_html__('Accès refusé.', 'yousync'));
        }
        check_admin_referer($action);
    }

    private static function back() {
        wp_safe_redirect(add_query_arg(['page' => self::PAGE, 'yousync_done' => 1], admin_url('admin.php')));
        exit;
    }
}
