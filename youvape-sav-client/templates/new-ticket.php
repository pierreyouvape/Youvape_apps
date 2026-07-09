<?php
/**
 * Template : formulaire de nouvelle demande au service client.
 *
 * Surchargeable depuis le thème : <theme>/woocommerce/youvape-sav/new-ticket.php
 *
 * Variables disponibles :
 *   array       $orders      commandes du client (wp_order_id, post_date,
 *                            order_total, post_status, items[])
 *   int         $preselect   wp_order_id à pré-sélectionner (0 = aucune)
 *   string|null $error       message d'erreur, ou null
 *   string      $list_url    URL de retour vers la liste
 *   string      $action_url  URL de soumission du formulaire
 *   string      $nonce_field HTML du champ nonce (déjà généré)
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

        <div class="form-row form-row-wide">
            <label><?php echo esc_html__('Commande concernée (facultatif)', 'youvape-sav-client'); ?></label>

            <?php if (empty($orders)) : ?>
                <p class="youvape-sav__hint"><?php echo esc_html__('Aucune commande à associer.', 'youvape-sav-client'); ?></p>
            <?php else : ?>
                <div class="youvape-sav__orders" role="radiogroup">

                    <?php
                    // Option "aucune commande"
                    $none_checked = ($preselect <= 0);
                    ?>
                    <label class="youvape-sav__order-card youvape-sav__order-card--none<?php echo $none_checked ? ' is-selected' : ''; ?>">
                        <input type="radio" name="order_id" value="" data-products="[]" <?php checked($none_checked); ?> />
                        <span class="youvape-sav__order-none"><?php echo esc_html__('Aucune commande', 'youvape-sav-client'); ?></span>
                    </label>

                    <?php foreach ((array) $orders as $order) :
                        $oid = isset($order['wp_order_id']) ? (int) $order['wp_order_id'] : 0;
                        if (!$oid) {
                            continue;
                        }
                        $date  = isset($order['post_date']) ? $order['post_date'] : '';
                        $total = isset($order['order_total']) ? $order['order_total'] : 0;
                        $items = isset($order['items']) && is_array($order['items']) ? $order['items'] : array();
                        $checked = ($preselect === $oid);

                        // Liste des produits pour le data-attribute (filtrage JS du dropdown).
                        $product_names = array();
                        foreach ($items as $it) {
                            $name = isset($it['order_item_name']) ? trim((string) $it['order_item_name']) : '';
                            if ($name !== '') {
                                $product_names[] = $name;
                            }
                        }
                        ?>
                        <label class="youvape-sav__order-card<?php echo $checked ? ' is-selected' : ''; ?>">
                            <input type="radio" name="order_id" value="<?php echo esc_attr($oid); ?>"
                                   data-products="<?php echo esc_attr(wp_json_encode(array_values($product_names))); ?>"
                                   <?php checked($checked); ?> />
                            <span class="youvape-sav__order-body">
                                <span class="youvape-sav__order-head">
                                    <strong><?php echo esc_html(sprintf(__('Commande #%s', 'youvape-sav-client'), $oid)); ?></strong>
                                    <span class="youvape-sav__order-meta">
                                        <?php echo $date ? esc_html(date_i18n(get_option('date_format'), strtotime($date))) : ''; ?>
                                        · <?php echo wp_kses_post(youvape_sav_price($total)); ?>
                                    </span>
                                </span>
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

        <p class="form-row form-row-wide youvape-sav__product-row" style="display:none;">
            <label for="youvape-sav-product"><?php echo esc_html__('Produit concerné (facultatif)', 'youvape-sav-client'); ?></label>
            <select id="youvape-sav-product" name="product">
                <option value=""><?php echo esc_html__('— Tous / non précisé —', 'youvape-sav-client'); ?></option>
            </select>
        </p>

        <p class="form-row form-row-wide">
            <label for="youvape-sav-body"><?php echo esc_html__('Votre message', 'youvape-sav-client'); ?> <span class="required">*</span></label>
            <textarea id="youvape-sav-body" name="body" rows="6" maxlength="10000" required></textarea>
        </p>

        <p class="form-row form-row-wide">
            <label for="youvape-sav-files"><?php echo esc_html__('Pièces jointes (facultatif)', 'youvape-sav-client'); ?></label>
            <input type="file" id="youvape-sav-files" name="attachments[]" multiple accept="image/*,.pdf" />
            <span class="youvape-sav__hint"><?php echo esc_html__('Images ou PDF, 25 Mo maximum par fichier.', 'youvape-sav-client'); ?></span>
        </p>

        <p class="form-row">
            <button type="submit" name="youvape_sav_submit" value="1" class="button">
                <?php echo esc_html__('Envoyer ma demande', 'youvape-sav-client'); ?>
            </button>
        </p>

    </form>

    <script>
    (function () {
        var form = document.querySelector('.youvape-sav--new');
        if (!form) { return; }
        var radios = form.querySelectorAll('input[name="order_id"]');
        var productRow = form.querySelector('.youvape-sav__product-row');
        var productSelect = document.getElementById('youvape-sav-product');
        var placeholder = productSelect ? productSelect.querySelector('option').textContent : '';

        function refreshProducts(radio) {
            if (!productSelect) { return; }
            // Reset
            productSelect.innerHTML = '';
            var opt0 = document.createElement('option');
            opt0.value = '';
            opt0.textContent = placeholder;
            productSelect.appendChild(opt0);

            var products = [];
            try { products = JSON.parse(radio.getAttribute('data-products') || '[]'); } catch (e) { products = []; }

            if (products.length === 0) {
                productRow.style.display = 'none';
                return;
            }
            products.forEach(function (name) {
                var o = document.createElement('option');
                o.value = name;
                o.textContent = name;
                productSelect.appendChild(o);
            });
            productRow.style.display = '';
        }

        // Mise en évidence de la carte sélectionnée + maj du dropdown
        function onChange(e) {
            form.querySelectorAll('.youvape-sav__order-card').forEach(function (c) {
                c.classList.remove('is-selected');
            });
            var card = e.target.closest('.youvape-sav__order-card');
            if (card) { card.classList.add('is-selected'); }
            refreshProducts(e.target);
        }

        radios.forEach(function (r) { r.addEventListener('change', onChange); });

        // État initial (commande pré-sélectionnée le cas échéant)
        var checked = form.querySelector('input[name="order_id"]:checked');
        if (checked) { refreshProducts(checked); }
    })();
    </script>

</div>
