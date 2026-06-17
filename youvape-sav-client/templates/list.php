<?php
/**
 * Template : liste des demandes au service client.
 *
 * Surchargeable depuis le thème : <theme>/woocommerce/youvape-sav/list.php
 *
 * Variables disponibles :
 *   array       $tickets  liste des tickets (id, subject, order_id, created_at,
 *                         updated_at, status_label, message_count)
 *   string|null $error    message d'erreur à afficher, ou null
 */

if (!defined('ABSPATH')) {
    exit;
}

/** Formate une date ISO renvoyée par l'API selon les réglages WP. */
if (!function_exists('youvape_sav_format_date')) {
    function youvape_sav_format_date($iso) {
        if (empty($iso)) {
            return '';
        }
        $ts = strtotime($iso);
        if (!$ts) {
            return '';
        }
        return date_i18n(get_option('date_format'), $ts);
    }
}
?>

<div class="youvape-sav">

    <p class="youvape-sav__actions">
        <a href="<?php echo esc_url(Youvape_SAV_Account_Endpoint::new_url()); ?>" class="button">
            <?php echo esc_html__('Nouvelle demande', 'youvape-sav-client'); ?>
        </a>
    </p>

    <?php if (!empty($error)) : ?>
        <div class="youvape-sav__error woocommerce-error" role="alert">
            <?php echo esc_html__('Impossible de charger vos demandes pour le moment. Merci de réessayer plus tard.', 'youvape-sav-client'); ?>
        </div>
    <?php endif; ?>

    <?php if (empty($tickets)) : ?>

        <?php if (empty($error)) : ?>
            <p class="youvape-sav__empty">
                <?php echo esc_html__('Vous n’avez pas encore de demande au service client.', 'youvape-sav-client'); ?>
            </p>
        <?php endif; ?>

    <?php else : ?>

        <table class="youvape-sav__table woocommerce-orders-table shop_table shop_table_responsive">
            <thead>
                <tr>
                    <th><?php echo esc_html__('Demande', 'youvape-sav-client'); ?></th>
                    <th><?php echo esc_html__('Sujet', 'youvape-sav-client'); ?></th>
                    <th><?php echo esc_html__('Statut', 'youvape-sav-client'); ?></th>
                    <th><?php echo esc_html__('Commande', 'youvape-sav-client'); ?></th>
                    <th><?php echo esc_html__('Mise à jour', 'youvape-sav-client'); ?></th>
                </tr>
            </thead>
            <tbody>
                <?php foreach ($tickets as $ticket) :
                    $id        = isset($ticket['id']) ? (int) $ticket['id'] : 0;
                    $subject   = isset($ticket['subject']) ? (string) $ticket['subject'] : '';
                    $status    = isset($ticket['status_label']) ? (string) $ticket['status_label'] : '';
                    $order_id  = isset($ticket['order_id']) ? (string) $ticket['order_id'] : '';
                    $updated   = isset($ticket['updated_at']) ? $ticket['updated_at'] : (isset($ticket['created_at']) ? $ticket['created_at'] : '');
                    ?>
                    <tr class="youvape-sav__row">
                        <?php $detail_url = Youvape_SAV_Account_Endpoint::ticket_url($id); ?>
                        <td data-title="<?php echo esc_attr__('Demande', 'youvape-sav-client'); ?>">
                            <a href="<?php echo esc_url($detail_url); ?>"><?php echo esc_html('#' . $id); ?></a>
                        </td>
                        <td data-title="<?php echo esc_attr__('Sujet', 'youvape-sav-client'); ?>">
                            <a href="<?php echo esc_url($detail_url); ?>"><?php echo esc_html($subject); ?></a>
                        </td>
                        <td data-title="<?php echo esc_attr__('Statut', 'youvape-sav-client'); ?>">
                            <span class="youvape-sav__status"><?php echo esc_html($status); ?></span>
                        </td>
                        <td data-title="<?php echo esc_attr__('Commande', 'youvape-sav-client'); ?>">
                            <?php echo $order_id ? esc_html('#' . $order_id) : '—'; ?>
                        </td>
                        <td data-title="<?php echo esc_attr__('Mise à jour', 'youvape-sav-client'); ?>">
                            <?php echo esc_html(youvape_sav_format_date($updated)); ?>
                        </td>
                    </tr>
                <?php endforeach; ?>
            </tbody>
        </table>

    <?php endif; ?>

</div>
