<?php
/**
 * Template : détail d'une demande au service client (fil de discussion).
 *
 * Surchargeable depuis le thème : <theme>/woocommerce/youvape-sav/detail.php
 *
 * Variables disponibles :
 *   array|null  $ticket    le ticket (id, subject, description, order_id,
 *                          status_label, created_at, updated_at, messages[])
 *                          ou null en cas d'erreur
 *   string|null $error        message d'erreur, ou null
 *   string      $list_url     URL de retour vers la liste
 *   string      $reply_action URL de soumission de la réponse
 *   string      $reply_nonce  HTML du champ nonce de réponse (déjà généré)
 *   int         $ticket_id    identifiant du ticket courant
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('youvape_sav_format_datetime')) {
    function youvape_sav_format_datetime($iso) {
        if (empty($iso)) {
            return '';
        }
        $ts = strtotime($iso);
        if (!$ts) {
            return '';
        }
        $format = get_option('date_format') . ' ' . get_option('time_format');
        // Les dates de l'API sont en UTC (suffixe Z). wp_date() applique le
        // fuseau du site ; date_i18n() sur un timestamp explicite reste en GMT.
        if (function_exists('wp_date')) {
            return wp_date($format, $ts);
        }
        return date_i18n($format, $ts + (int) (get_option('gmt_offset') * HOUR_IN_SECONDS));
    }
}

/**
 * Résout l'URL publique d'une pièce jointe. L'API renvoie une URL relative
 * (ex. /api/sav/attachments/123/uuid_photo.jpg) qu'il faut préfixer par la
 * base de l'API Node pour être atteignable depuis le navigateur du client.
 */
if (!function_exists('youvape_sav_attachment_url')) {
    function youvape_sav_attachment_url($url) {
        $url = (string) $url;
        if ($url === '') {
            return '';
        }
        // URL déjà absolue : on la garde telle quelle.
        if (preg_match('#^https?://#i', $url)) {
            return $url;
        }
        $base = class_exists('Youvape_SAV_Api_Client')
            ? rtrim(Youvape_SAV_Api_Client::api_url(), '/')
            : '';
        return $base . '/' . ltrim($url, '/');
    }
}
?>

<div class="youvape-sav youvape-sav--detail">

    <p class="youvape-sav__back">
        <a href="<?php echo esc_url($list_url); ?>">&larr; <?php echo esc_html__('Retour à mes demandes', 'youvape-sav-client'); ?></a>
    </p>

    <?php if (!empty($error) || empty($ticket)) : ?>

        <div class="youvape-sav__error woocommerce-error" role="alert">
            <?php echo esc_html__('Cette demande est introuvable ou indisponible.', 'youvape-sav-client'); ?>
        </div>

    <?php else :
        $subject  = isset($ticket['subject']) ? (string) $ticket['subject'] : '';
        $status   = isset($ticket['status_label']) ? (string) $ticket['status_label'] : '';
        $order_id = isset($ticket['order_id']) ? (string) $ticket['order_id'] : '';
        $created  = isset($ticket['created_at']) ? $ticket['created_at'] : '';
        $messages = isset($ticket['messages']) && is_array($ticket['messages']) ? $ticket['messages'] : array();
        ?>

        <header class="youvape-sav__detail-head">
            <h2 class="youvape-sav__subject"><?php echo esc_html($subject); ?></h2>
            <p class="youvape-sav__meta">
                <span class="youvape-sav__status"><?php echo esc_html($status); ?></span>
                <?php if ($order_id) : ?>
                    <span class="youvape-sav__order">
                        <?php echo esc_html(sprintf(__('Commande #%s', 'youvape-sav-client'), $order_id)); ?>
                    </span>
                <?php endif; ?>
                <?php if ($created) : ?>
                    <span class="youvape-sav__date">
                        <?php echo esc_html(sprintf(__('Ouverte le %s', 'youvape-sav-client'), youvape_sav_format_datetime($created))); ?>
                    </span>
                <?php endif; ?>
            </p>
        </header>

        <?php if (empty($messages)) : ?>

            <p class="youvape-sav__empty">
                <?php echo esc_html__('Aucun message pour le moment.', 'youvape-sav-client'); ?>
            </p>

        <?php else : ?>

            <ol class="youvape-sav__thread">
                <?php foreach ($messages as $message) :
                    $is_agent = !empty($message['is_agent']);
                    $from     = isset($message['from']) ? (string) $message['from'] : '';
                    $date     = isset($message['date']) ? $message['date'] : '';
                    // body = HTML (éditeur riche). wp_kses_post = whitelist HTML
                    // sûre de WordPress (anti-XSS), adaptée à du contenu de message.
                    $body     = isset($message['body']) ? wp_kses_post($message['body']) : '';
                    $attachments = (isset($message['attachments']) && is_array($message['attachments']))
                        ? $message['attachments'] : array();
                    $row_class = $is_agent ? 'youvape-sav__msg--agent' : 'youvape-sav__msg--customer';
                    ?>
                    <li class="youvape-sav__msg <?php echo esc_attr($row_class); ?>">
                        <div class="youvape-sav__msg-head">
                            <span class="youvape-sav__msg-from"><?php echo esc_html($from); ?></span>
                            <?php if ($date) : ?>
                                <span class="youvape-sav__msg-date"><?php echo esc_html(youvape_sav_format_datetime($date)); ?></span>
                            <?php endif; ?>
                        </div>
                        <div class="youvape-sav__msg-body"><?php echo $body; // déjà filtré par wp_kses_post ?></div>
                        <?php if (!empty($attachments)) : ?>
                            <ul class="youvape-sav__msg-attachments">
                                <?php foreach ($attachments as $att) :
                                    $att_url  = youvape_sav_attachment_url(isset($att['url']) ? $att['url'] : '');
                                    if (!$att_url) {
                                        continue;
                                    }
                                    $att_name = '';
                                    if (!empty($att['original_name'])) {
                                        $att_name = (string) $att['original_name'];
                                    } elseif (!empty($att['filename'])) {
                                        $att_name = (string) $att['filename'];
                                    } else {
                                        $att_name = __('Pièce jointe', 'youvape-sav-client');
                                    }
                                    $att_mime = isset($att['mime']) ? (string) $att['mime'] : '';
                                    $is_image = (strpos($att_mime, 'image/') === 0);
                                    ?>
                                    <li class="youvape-sav__msg-attachment">
                                        <a href="<?php echo esc_url($att_url); ?>" target="_blank" rel="noopener noreferrer">
                                            <?php if ($is_image) : ?>
                                                <img src="<?php echo esc_url($att_url); ?>" alt="<?php echo esc_attr($att_name); ?>" class="youvape-sav__msg-attachment-thumb" loading="lazy" />
                                            <?php else : ?>
                                                <span class="youvape-sav__msg-attachment-icon" aria-hidden="true">📎</span>
                                            <?php endif; ?>
                                            <span class="youvape-sav__msg-attachment-name"><?php echo esc_html($att_name); ?></span>
                                        </a>
                                    </li>
                                <?php endforeach; ?>
                            </ul>
                        <?php endif; ?>
                    </li>
                <?php endforeach; ?>
            </ol>

        <?php endif; ?>

        <form class="youvape-sav__form youvape-sav__reply" method="post" action="<?php echo esc_url($reply_action); ?>" enctype="multipart/form-data">
            <?php echo $reply_nonce; // déjà échappé par wp_nonce_field ?>
            <input type="hidden" name="ticket_id" value="<?php echo esc_attr($ticket_id); ?>" />

            <h3><?php echo esc_html__('Répondre', 'youvape-sav-client'); ?></h3>

            <p class="form-row form-row-wide">
                <label for="youvape-sav-reply-body" class="screen-reader-text"><?php echo esc_html__('Votre réponse', 'youvape-sav-client'); ?></label>
                <textarea id="youvape-sav-reply-body" name="body" rows="5" maxlength="10000" required
                          placeholder="<?php echo esc_attr__('Votre réponse…', 'youvape-sav-client'); ?>"></textarea>
            </p>

            <p class="form-row form-row-wide">
                <label for="youvape-sav-reply-files"><?php echo esc_html__('Pièces jointes (facultatif)', 'youvape-sav-client'); ?></label>
                <input type="file" id="youvape-sav-reply-files" name="attachments[]" multiple accept="image/*,.pdf" />
            </p>

            <p class="form-row">
                <button type="submit" name="youvape_sav_reply_submit" value="1" class="button">
                    <?php echo esc_html__('Envoyer', 'youvape-sav-client'); ?>
                </button>
            </p>
        </form>

    <?php endif; ?>

</div>
