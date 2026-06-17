<?php
/**
 * Template : formulaire de nouvelle demande au service client.
 *
 * Surchargeable depuis le thème : <theme>/woocommerce/youvape-sav/new-ticket.php
 *
 * Variables disponibles :
 *   array       $orders      commandes du client (wp_order_id, post_date, ...)
 *   int         $preselect   wp_order_id à pré-sélectionner (0 = aucune)
 *   string|null $error       message d'erreur, ou null
 *   string      $list_url    URL de retour vers la liste
 *   string      $action_url  URL de soumission du formulaire
 *   string      $nonce_field HTML du champ nonce (déjà généré)
 */

if (!defined('ABSPATH')) {
    exit;
}
?>

<div class="youvape-sav youvape-sav--new">

    <p class="youvape-sav__back">
        <a href="<?php echo esc_url($list_url); ?>">&larr; <?php echo esc_html__('Retour à mes demandes', 'youvape-sav-client'); ?></a>
    </p>

    <h2><?php echo esc_html__('Nouvelle demande', 'youvape-sav-client'); ?></h2>

    <?php if (!empty($error)) : ?>
        <div class="youvape-sav__error woocommerce-error" role="alert">
            <?php echo esc_html($error); ?>
        </div>
    <?php endif; ?>

    <form class="youvape-sav__form" method="post" action="<?php echo esc_url($action_url); ?>" enctype="multipart/form-data">

        <?php echo $nonce_field; // déjà échappé par wp_nonce_field ?>

        <p class="form-row form-row-wide">
            <label for="youvape-sav-subject"><?php echo esc_html__('Sujet', 'youvape-sav-client'); ?> <span class="required">*</span></label>
            <input type="text" id="youvape-sav-subject" name="subject" maxlength="150" required
                   value="<?php echo isset($_POST['subject']) ? esc_attr(wp_unslash($_POST['subject'])) : ''; ?>" />
        </p>

        <p class="form-row form-row-wide">
            <label for="youvape-sav-order"><?php echo esc_html__('Commande concernée (facultatif)', 'youvape-sav-client'); ?></label>
            <select id="youvape-sav-order" name="order_id">
                <option value=""><?php echo esc_html__('— Aucune commande —', 'youvape-sav-client'); ?></option>
                <?php foreach ((array) $orders as $order) :
                    $oid = isset($order['wp_order_id']) ? (int) $order['wp_order_id'] : 0;
                    if (!$oid) {
                        continue;
                    }
                    $date = isset($order['post_date']) ? $order['post_date'] : '';
                    $label = sprintf(
                        /* translators: 1: order number 2: order date */
                        __('Commande #%1$s du %2$s', 'youvape-sav-client'),
                        $oid,
                        $date ? date_i18n(get_option('date_format'), strtotime($date)) : ''
                    );
                    ?>
                    <option value="<?php echo esc_attr($oid); ?>" <?php selected($preselect, $oid); ?>>
                        <?php echo esc_html($label); ?>
                    </option>
                <?php endforeach; ?>
            </select>
        </p>

        <p class="form-row form-row-wide">
            <label for="youvape-sav-product"><?php echo esc_html__('Produit concerné (facultatif)', 'youvape-sav-client'); ?></label>
            <input type="text" id="youvape-sav-product" name="product" maxlength="200"
                   placeholder="<?php echo esc_attr__('Ex. nom du produit concerné', 'youvape-sav-client'); ?>"
                   value="<?php echo isset($_POST['product']) ? esc_attr(wp_unslash($_POST['product'])) : ''; ?>" />
        </p>

        <p class="form-row form-row-wide">
            <label for="youvape-sav-body"><?php echo esc_html__('Votre message', 'youvape-sav-client'); ?> <span class="required">*</span></label>
            <textarea id="youvape-sav-body" name="body" rows="6" maxlength="10000" required></textarea>
        </p>

        <p class="form-row form-row-wide">
            <label for="youvape-sav-files"><?php echo esc_html__('Pièces jointes (facultatif)', 'youvape-sav-client'); ?></label>
            <input type="file" id="youvape-sav-files" name="attachments[]" multiple
                   accept="image/*,.pdf" />
            <span class="youvape-sav__hint"><?php echo esc_html__('Images ou PDF, 25 Mo maximum par fichier.', 'youvape-sav-client'); ?></span>
        </p>

        <p class="form-row">
            <button type="submit" name="youvape_sav_submit" value="1" class="button">
                <?php echo esc_html__('Envoyer ma demande', 'youvape-sav-client'); ?>
            </button>
        </p>

    </form>

</div>
