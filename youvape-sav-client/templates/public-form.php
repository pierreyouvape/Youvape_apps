<?php
/**
 * Template : formulaire de contact pour un visiteur NON connecté.
 *
 * Surchargeable depuis le thème : <theme>/woocommerce/youvape-sav/public-form.php
 *
 * Volontairement réduit au motif « question avant commande » : sans identité
 * vérifiée, on ne peut ni proposer les commandes du visiteur ni lui ouvrir un
 * fil de discussion. La réponse du service client arrive par email.
 *
 * Variables disponibles :
 *   string|null $error          message d'erreur, ou null
 *   string      $action_url     URL de soumission (page courante)
 *   string      $nonce_field    HTML du champ nonce (déjà généré)
 *   string      $honeypot_field nom du champ pot-de-miel
 *   string      $login_url      URL de connexion, retour sur cette page
 */

if (!defined('ABSPATH')) {
    exit;
}
?>

<div class="youvape-sav youvape-sav--public">

    <?php if (!empty($error)) : ?>
        <div class="youvape-sav__error woocommerce-error" role="alert">
            <?php echo esc_html($error); ?>
        </div>
    <?php endif; ?>

    <p class="youvape-sav__hint youvape-sav__login-hint">
        <?php
        printf(
            /* translators: %s : lien de connexion */
            esc_html__('Déjà client ? %s pour retrouver vos commandes et suivre vos demandes.', 'youvape-sav-client'),
            '<a href="' . esc_url($login_url) . '">' . esc_html__('Connectez-vous', 'youvape-sav-client') . '</a>'
        );
        ?>
    </p>

    <form class="youvape-sav__form" method="post" action="<?php echo esc_url($action_url); ?>" enctype="multipart/form-data">

        <?php echo $nonce_field; // déjà échappé par wp_nonce_field ?>
        <input type="hidden" name="youvape_sav_return" value="<?php echo esc_url($action_url); ?>" />

        <p class="form-row form-row-wide">
            <label for="youvape-sav-name"><?php echo esc_html__('Votre nom', 'youvape-sav-client'); ?></label>
            <input type="text" id="youvape-sav-name" name="name" maxlength="100" required autocomplete="name" />
        </p>

        <p class="form-row form-row-wide">
            <label for="youvape-sav-email"><?php echo esc_html__('Votre adresse email', 'youvape-sav-client'); ?></label>
            <input type="email" id="youvape-sav-email" name="email" maxlength="200" required autocomplete="email" />
            <span class="youvape-sav__hint"><?php echo esc_html__('C\'est à cette adresse que nous vous répondrons.', 'youvape-sav-client'); ?></span>
        </p>

        <p class="form-row form-row-wide">
            <label for="youvape-sav-body"><?php echo esc_html__('Nous vous écoutons', 'youvape-sav-client'); ?></label>
            <textarea id="youvape-sav-body" name="body" rows="6" maxlength="10000" required></textarea>
        </p>

        <p class="form-row form-row-wide">
            <label for="youvape-sav-files"><?php echo esc_html__('Pièces jointes (facultatif)', 'youvape-sav-client'); ?></label>
            <input type="file" id="youvape-sav-files" name="attachments[]" multiple accept="image/*,.pdf" />
            <span class="youvape-sav__hint"><?php echo esc_html__('Images ou PDF, 25 Mo maximum par fichier.', 'youvape-sav-client'); ?></span>
        </p>

        <?php /* Pot-de-miel : invisible et hors tabulation, donc jamais rempli
                 par un humain. S'il l'est, la demande est ignorée en silence. */ ?>
        <div class="youvape-sav__hp" aria-hidden="true">
            <label for="<?php echo esc_attr($honeypot_field); ?>"><?php echo esc_html__('Ne remplissez pas ce champ', 'youvape-sav-client'); ?></label>
            <input type="text" id="<?php echo esc_attr($honeypot_field); ?>" name="<?php echo esc_attr($honeypot_field); ?>" tabindex="-1" autocomplete="off" />
        </div>

        <p class="form-row">
            <button type="submit" name="youvape_sav_public_submit" value="1" class="button">
                <?php echo esc_html__('Envoyer ma demande', 'youvape-sav-client'); ?>
            </button>
        </p>

    </form>

</div>
