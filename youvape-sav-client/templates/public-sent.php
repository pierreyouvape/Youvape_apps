<?php
/**
 * Template : confirmation affichée après l'envoi d'une demande publique.
 *
 * Surchargeable depuis le thème : <theme>/woocommerce/youvape-sav/public-sent.php
 *
 * Le visiteur n'ayant pas de compte, il n'y a pas de fil à lui ouvrir : on
 * confirme sur place et la suite se passe par email.
 *
 * Variables disponibles :
 *   string $return_url URL de la page portant le formulaire
 */

if (!defined('ABSPATH')) {
    exit;
}
?>

<div class="youvape-sav youvape-sav--public">
    <div class="youvape-sav__sent" role="status">
        <strong><?php echo esc_html__('Votre demande a bien été envoyée.', 'youvape-sav-client'); ?></strong>
        <p>
            <?php echo esc_html__('Vous allez recevoir un accusé de réception par email. Notre service client vous répondra à cette même adresse.', 'youvape-sav-client'); ?>
        </p>
        <p>
            <a href="<?php echo esc_url($return_url); ?>"><?php echo esc_html__('Envoyer une autre demande', 'youvape-sav-client'); ?></a>
        </p>
    </div>
</div>
