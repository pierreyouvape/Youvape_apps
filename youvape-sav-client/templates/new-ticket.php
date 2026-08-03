<?php
/**
 * Template : formulaire de nouvelle demande au service client.
 *
 * Surchargeable depuis le thème : <theme>/woocommerce/youvape-sav/new-ticket.php
 *
 * Le formulaire est piloté par le MOTIF choisi (il n'y a plus de sujet libre) :
 *   - « Une question avant de passer ma commande » → message seul
 *   - « Une difficulté avec un produit »           → commande + produits + message
 *   - « Je souhaite me rétracter »                 → consignes légales, puis
 *                                                    commande + produits + motif
 *
 * Variables disponibles :
 *   array       $orders            commandes du client (wp_order_id, post_date,
 *                                  order_total, post_status, withdrawal_expired,
 *                                  items[])
 *   array       $reasons           motifs (voir Youvape_SAV_Account_Endpoint::reasons)
 *   int         $preselect         wp_order_id à pré-sélectionner (0 = aucune)
 *   string      $preselect_reason  slug de motif à pré-sélectionner ('' = aucun)
 *   string      $withdrawal_notice consignes légales de rétractation (HTML)
 *   int         $withdrawal_days   délai légal de rétractation, en jours
 *   string|null $error             message d'erreur, ou null
 *   string      $list_url          URL de retour vers la liste ('' = pas de lien,
 *                                  cas du shortcode hors "Mon compte")
 *   string      $action_url        URL de soumission du formulaire
 *   string      $return_url        page où revenir en cas d'erreur (optionnel)
 *   string      $nonce_field       HTML du champ nonce (déjà généré)
 */

if (!defined('ABSPATH')) {
    exit;
}

/** Formate un montant selon WooCommerce si dispo. */
if (!function_exists('youvape_sav_price')) {
    function youvape_sav_price($amount) {
        if (function_exists('wc_price')) {
            return wc_price((float) $amount);
        }
        return esc_html(number_format((float) $amount, 2, ',', ' ')) . ' €';
    }
}

// État initial du formulaire : rendu côté serveur pour éviter tout clignotement
// et pour que les champs masqués partent déjà désactivés (ni validés, ni postés).
// Le JS ne fait ensuite que maintenir cet état à jour.
$active_reason = (isset($preselect_reason) && isset($reasons[$preselect_reason]))
    ? $reasons[$preselect_reason]
    : null;

$show_notice   = $active_reason ? !empty($active_reason['notice']) : false;
$show_order    = $active_reason ? !empty($active_reason['order']) : false;
$show_products = $active_reason ? !empty($active_reason['products']) : false;
$show_rest     = (bool) $active_reason;
$body_label    = $active_reason
    ? $active_reason['body_label']
    : __('Votre message', 'youvape-sav-client');
// Facultatif pour la rétractation : le client n'a pas à motiver sa décision.
$body_required = $active_reason ? !empty($active_reason['body_required']) : true;

/** Classe de masquage (voir assets/css/youvape-sav.css). */
$hidden = ' is-hidden';
?>

<div class="youvape-sav youvape-sav--new">

    <?php if (!empty($list_url)) : ?>
        <p class="youvape-sav__back">
            <a href="<?php echo esc_url($list_url); ?>">&larr; <?php echo esc_html__('Retour à mes demandes', 'youvape-sav-client'); ?></a>
        </p>

        <h2><?php echo esc_html__('Nouvelle demande', 'youvape-sav-client'); ?></h2>
    <?php endif; ?>

    <?php if (!empty($error)) : ?>
        <div class="youvape-sav__error woocommerce-error" role="alert">
            <?php echo esc_html($error); ?>
        </div>
    <?php endif; ?>

    <form class="youvape-sav__form" method="post" action="<?php echo esc_url($action_url); ?>" enctype="multipart/form-data">

        <?php echo $nonce_field; // déjà échappé par wp_nonce_field ?>

        <?php if (!empty($return_url)) : ?>
            <?php /* Rendu hors "Mon compte" : où revenir si l'envoi échoue. */ ?>
            <input type="hidden" name="youvape_sav_return" value="<?php echo esc_url($return_url); ?>" />
        <?php endif; ?>

        <p class="form-row form-row-wide">
            <label for="youvape-sav-reason"><?php echo esc_html__('Votre demande concerne :', 'youvape-sav-client'); ?></label>
            <select id="youvape-sav-reason" name="reason" required>
                <option value=""><?php echo esc_html__('— Choisissez un motif —', 'youvape-sav-client'); ?></option>
                <?php foreach ((array) $reasons as $slug => $reason) : ?>
                    <option value="<?php echo esc_attr($slug); ?>"
                            data-order="<?php echo !empty($reason['order']) ? '1' : '0'; ?>"
                            data-products="<?php echo !empty($reason['products']) ? '1' : '0'; ?>"
                            data-notice="<?php echo !empty($reason['notice']) ? '1' : '0'; ?>"
                            data-body-label="<?php echo esc_attr($reason['body_label']); ?>"
                            data-body-required="<?php echo !empty($reason['body_required']) ? '1' : '0'; ?>"
                            <?php selected($preselect_reason, $slug); ?>>
                        <?php echo esc_html($reason['label']); ?>
                    </option>
                <?php endforeach; ?>
            </select>
        </p>

        <!-- Consignes légales de rétractation (motif « Je souhaite me rétracter ») -->
        <div class="youvape-sav__legal<?php echo $show_notice ? '' : $hidden; ?>" data-role="notice">
            <?php echo wp_kses_post($withdrawal_notice); ?>
        </div>

        <!-- Commande concernée -->
        <div class="form-row form-row-wide<?php echo $show_order ? '' : $hidden; ?>" data-role="order">
            <label><?php echo esc_html__('Commande concernée', 'youvape-sav-client'); ?> <span class="required">*</span></label>

            <?php if (empty($orders)) : ?>
                <p class="youvape-sav__hint">
                    <?php echo esc_html__('Aucune commande à associer. Si votre demande ne porte pas sur une commande, choisissez le motif « Une question avant de passer ma commande ».', 'youvape-sav-client'); ?>
                </p>
            <?php else : ?>
                <div class="youvape-sav__orders" role="radiogroup">
                    <?php foreach ((array) $orders as $order) :
                        $oid = isset($order['wp_order_id']) ? (int) $order['wp_order_id'] : 0;
                        if (!$oid) {
                            continue;
                        }
                        $date    = isset($order['post_date']) ? $order['post_date'] : '';
                        $total   = isset($order['order_total']) ? $order['order_total'] : 0;
                        $items   = isset($order['items']) && is_array($order['items']) ? $order['items'] : array();
                        $expired = !empty($order['withdrawal_expired']);
                        $checked = ($preselect === $oid);
                        ?>
                        <label class="youvape-sav__order-card<?php echo $checked ? ' is-selected' : ''; ?>">
                            <input type="radio" name="order_id" value="<?php echo esc_attr($oid); ?>"
                                   data-expired="<?php echo $expired ? '1' : '0'; ?>"
                                   required <?php disabled(!$show_order); ?> <?php checked($checked); ?> />
                            <span class="youvape-sav__order-body">
                                <span class="youvape-sav__order-head">
                                    <strong><?php echo esc_html(sprintf(__('Commande #%s', 'youvape-sav-client'), $oid)); ?></strong>
                                    <span class="youvape-sav__order-meta">
                                        <?php echo $date ? esc_html(date_i18n(get_option('date_format'), strtotime($date))) : ''; ?>
                                        · <?php echo wp_kses_post(youvape_sav_price($total)); ?>
                                    </span>
                                </span>

                                <?php if ($expired) : ?>
                                    <span class="youvape-sav__order-warning<?php echo $show_notice ? '' : $hidden; ?>" data-role="expired-warning">
                                        <?php echo esc_html(sprintf(
                                            /* translators: %d : délai légal de rétractation en jours */
                                            __('Livrée il y a plus de %d jours : le délai de rétractation est probablement dépassé.', 'youvape-sav-client'),
                                            (int) $withdrawal_days
                                        )); ?>
                                    </span>
                                <?php endif; ?>

                                <?php if (!empty($items)) : ?>
                                    <span class="youvape-sav__order-items">
                                        <?php foreach ($items as $it) :
                                            $name = isset($it['order_item_name']) ? (string) $it['order_item_name'] : '';
                                            $img  = isset($it['image_url']) ? (string) $it['image_url'] : '';
                                            $qty  = isset($it['qty']) ? (int) $it['qty'] : 0;
                                            ?>
                                            <span class="youvape-sav__item" title="<?php echo esc_attr($name); ?>">
                                                <?php if ($img) : ?>
                                                    <img src="<?php echo esc_url($img); ?>" alt="" loading="lazy" />
                                                <?php endif; ?>
                                                <span class="youvape-sav__item-name"><?php echo esc_html($name); ?></span>
                                                <?php if ($qty > 1) : ?>
                                                    <span class="youvape-sav__item-qty">×<?php echo esc_html($qty); ?></span>
                                                <?php endif; ?>
                                            </span>
                                        <?php endforeach; ?>
                                    </span>
                                <?php endif; ?>
                            </span>
                        </label>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>
        </div>

        <!-- Produits concernés : cases à cocher de la commande sélectionnée -->
        <div class="form-row form-row-wide<?php echo $show_products ? '' : $hidden; ?>" data-role="products">
            <label><?php echo esc_html__('Produits concernés', 'youvape-sav-client'); ?> <span class="required">*</span></label>
            <span class="youvape-sav__hint"><?php echo esc_html__('Vous pouvez en sélectionner plusieurs.', 'youvape-sav-client'); ?></span>

            <p class="youvape-sav__hint<?php echo ($show_products && $preselect > 0) ? $hidden : ''; ?>" data-role="products-hint">
                <?php echo esc_html__('Sélectionnez d\'abord la commande concernée.', 'youvape-sav-client'); ?>
            </p>

            <?php foreach ((array) $orders as $order) :
                $oid = isset($order['wp_order_id']) ? (int) $order['wp_order_id'] : 0;
                if (!$oid) {
                    continue;
                }
                $items = isset($order['items']) && is_array($order['items']) ? $order['items'] : array();
                if (empty($items)) {
                    continue;
                }
                // Un groupe par commande : seul celui de la commande sélectionnée
                // est visible et actif (les autres sont désactivés, donc non postés).
                $group_visible = ($show_products && $preselect === $oid);
                ?>
                <div class="youvape-sav__products<?php echo $group_visible ? '' : $hidden; ?>" data-order-group="<?php echo esc_attr($oid); ?>">
                    <?php foreach ($items as $index => $it) :
                        $name = isset($it['order_item_name']) ? trim((string) $it['order_item_name']) : '';
                        if ('' === $name) {
                            continue;
                        }
                        $img = isset($it['image_url']) ? (string) $it['image_url'] : '';
                        $qty = isset($it['qty']) ? (int) $it['qty'] : 0;
                        $cb_id = 'youvape-sav-product-' . $oid . '-' . $index;
                        ?>
                        <label class="youvape-sav__product-card" for="<?php echo esc_attr($cb_id); ?>">
                            <input type="checkbox" id="<?php echo esc_attr($cb_id); ?>" name="products[]"
                                   value="<?php echo esc_attr($name); ?>" <?php disabled(!$group_visible); ?> />
                            <?php if ($img) : ?>
                                <img class="youvape-sav__product-thumb" src="<?php echo esc_url($img); ?>" alt="" loading="lazy" />
                            <?php endif; ?>
                            <span class="youvape-sav__product-name">
                                <?php echo esc_html($name); ?>
                                <?php if ($qty > 1) : ?>
                                    <span class="youvape-sav__item-qty">×<?php echo esc_html($qty); ?></span>
                                <?php endif; ?>
                            </span>
                        </label>
                    <?php endforeach; ?>
                </div>
            <?php endforeach; ?>

            <span class="youvape-sav__field-error is-hidden" data-role="products-error" role="alert">
                <?php echo esc_html__('Sélectionnez au moins un produit concerné.', 'youvape-sav-client'); ?>
            </span>
        </div>

        <!-- Message libre : le libellé dépend du motif -->
        <p class="form-row form-row-wide<?php echo $show_rest ? '' : $hidden; ?>" data-role="body">
            <label for="youvape-sav-body">
                <span data-role="body-label"><?php echo esc_html($body_label); ?></span>
                <span class="required<?php echo $body_required ? '' : $hidden; ?>" data-role="body-required">*</span>
            </label>
            <textarea id="youvape-sav-body" name="body" rows="6" maxlength="10000"
                      <?php echo $body_required ? 'required' : ''; ?> <?php disabled(!$show_rest); ?>></textarea>
        </p>

        <p class="form-row form-row-wide<?php echo $show_rest ? '' : $hidden; ?>" data-role="attachments">
            <label for="youvape-sav-files"><?php echo esc_html__('Pièces jointes (facultatif)', 'youvape-sav-client'); ?></label>
            <input type="file" id="youvape-sav-files" name="attachments[]" multiple accept="image/*,.pdf" <?php disabled(!$show_rest); ?> />
            <span class="youvape-sav__hint"><?php echo esc_html__('Images ou PDF, 25 Mo maximum par fichier.', 'youvape-sav-client'); ?></span>
        </p>

        <p class="form-row<?php echo $show_rest ? '' : $hidden; ?>" data-role="submit">
            <button type="submit" name="youvape_sav_submit" value="1" class="button">
                <?php echo esc_html__('Envoyer ma demande', 'youvape-sav-client'); ?>
            </button>
        </p>

    </form>

    <script>
    (function () {
        var root = document.querySelector('.youvape-sav--new');
        if (!root) { return; }
        var form   = root.querySelector('.youvape-sav__form');
        var select = root.querySelector('#youvape-sav-reason');
        if (!form || !select) { return; }

        var HIDDEN = 'is-hidden';
        var noticeRow   = root.querySelector('[data-role="notice"]');
        var orderRow    = root.querySelector('[data-role="order"]');
        var productsRow = root.querySelector('[data-role="products"]');
        var bodyRow     = root.querySelector('[data-role="body"]');
        var bodyLabel   = root.querySelector('[data-role="body-label"]');
        var bodyStar    = root.querySelector('[data-role="body-required"]');
        var bodyInput   = root.querySelector('#youvape-sav-body');
        var filesRow    = root.querySelector('[data-role="attachments"]');
        var submitRow   = root.querySelector('[data-role="submit"]');
        var prodHint    = root.querySelector('[data-role="products-hint"]');
        var prodError   = root.querySelector('[data-role="products-error"]');

        function each(list, fn) { Array.prototype.forEach.call(list || [], fn); }

        /** Affiche/masque un bloc et (dés)active ses champs — un champ masqué
            ne doit ni bloquer la validation HTML, ni partir dans le POST. */
        function show(el, visible) {
            if (!el) { return; }
            el.classList.toggle(HIDDEN, !visible);
            each(el.querySelectorAll('input, select, textarea'), function (field) {
                field.disabled = !visible;
            });
        }

        /** Règles du motif sélectionné, lues sur l'<option>. */
        function currentReason() {
            var opt = select.options[select.selectedIndex];
            if (!opt || !opt.value) { return null; }
            return {
                order:        opt.getAttribute('data-order') === '1',
                products:     opt.getAttribute('data-products') === '1',
                notice:       opt.getAttribute('data-notice') === '1',
                bodyLabel:    opt.getAttribute('data-body-label') || '',
                bodyRequired: opt.getAttribute('data-body-required') === '1'
            };
        }

        function selectedOrderId() {
            var checked = orderRow ? orderRow.querySelector('input[name="order_id"]:checked') : null;
            return checked ? checked.value : '';
        }

        /** N'active que les produits de la commande sélectionnée. */
        function syncProducts(enabled) {
            if (!productsRow) { return; }
            var oid = selectedOrderId();
            var matched = false;

            each(productsRow.querySelectorAll('[data-order-group]'), function (group) {
                var isMatch = enabled && oid !== '' && group.getAttribute('data-order-group') === oid;
                group.classList.toggle(HIDDEN, !isMatch);
                each(group.querySelectorAll('input[type="checkbox"]'), function (cb) {
                    cb.disabled = !isMatch;
                    // Changer de commande ne doit jamais laisser cochés les
                    // produits d'une autre commande.
                    if (!isMatch) { cb.checked = false; }
                });
                if (isMatch) { matched = true; }
            });

            if (prodHint)  { prodHint.classList.toggle(HIDDEN, !enabled || matched); }
            if (prodError) { prodError.classList.add(HIDDEN); }
        }

        /** Applique l'état du formulaire au motif courant. */
        function refresh() {
            var reason = currentReason();
            var chosen = !!reason;

            show(noticeRow, chosen && reason.notice);
            show(orderRow, chosen && reason.order);
            show(productsRow, chosen && reason.products);
            show(bodyRow, chosen);
            show(filesRow, chosen);
            if (submitRow) { submitRow.classList.toggle(HIDDEN, !chosen); }

            // L'avertissement « délai dépassé » ne concerne que la rétractation.
            each(root.querySelectorAll('[data-role="expired-warning"]'), function (el) {
                el.classList.toggle(HIDDEN, !(chosen && reason.notice));
            });

            if (chosen && bodyLabel && reason.bodyLabel) {
                bodyLabel.textContent = reason.bodyLabel;
            }

            // Le texte libre n'est pas obligatoire partout (rétractation). À poser
            // APRÈS show(), qui vient de réactiver le champ.
            if (bodyInput) { bodyInput.required = !!(chosen && reason.bodyRequired); }
            if (bodyStar)  { bodyStar.classList.toggle(HIDDEN, !(chosen && reason.bodyRequired)); }

            // show() vient de (ré)activer toutes les cases : on restreint ensuite
            // à la seule commande sélectionnée.
            syncProducts(chosen && reason.products);
        }

        select.addEventListener('change', refresh);

        // Sélection d'une commande : mise en évidence de la carte + produits.
        if (orderRow) {
            each(orderRow.querySelectorAll('input[name="order_id"]'), function (radio) {
                radio.addEventListener('change', function (e) {
                    each(orderRow.querySelectorAll('.youvape-sav__order-card'), function (card) {
                        card.classList.remove('is-selected');
                    });
                    var card = e.target.closest ? e.target.closest('.youvape-sav__order-card') : null;
                    if (card) { card.classList.add('is-selected'); }
                    var reason = currentReason();
                    syncProducts(!!reason && reason.products);
                });
            });
        }

        if (productsRow) {
            productsRow.addEventListener('change', function () {
                if (prodError) { prodError.classList.add(HIDDEN); }
            });
        }

        // « Au moins une case cochée » n'existe pas en validation HTML native :
        // on le vérifie ici (le plugin et l'API le revérifient de leur côté).
        form.addEventListener('submit', function (e) {
            var reason = currentReason();
            if (!reason || !reason.products || !productsRow) { return; }
            if (!productsRow.querySelector('input[type="checkbox"]:checked')) {
                e.preventDefault();
                if (prodError) { prodError.classList.remove(HIDDEN); }
                productsRow.scrollIntoView({ block: 'center' });
            }
        });

        refresh();
    })();
    </script>

</div>
