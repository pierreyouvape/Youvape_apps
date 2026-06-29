<?php
/**
 * Plugin Name: YouVape – WDR Discounted Price in REST API
 * Description: Ajoute le champ `wdr_discounted_price` (prix remisé Woo Discount Rules,
 *              TTC, visiteur, quantité 1) aux réponses de l'API REST WooCommerce
 *              produits et variations. Consommé par le sync nocturne de Youvape_apps
 *              pour alimenter la colonne "Tarif Remisé" du catalogue.
 * Author: YouVape
 * Version: 1.0.0
 *
 * ── Déploiement ──────────────────────────────────────────────────────────────
 * Déposer ce fichier dans :  wp-content/mu-plugins/youvape-wdr-rest-price.php
 * sur la PROD www.youvape.fr (créer le dossier mu-plugins s'il n'existe pas).
 * Les mu-plugins s'activent automatiquement, aucune activation requise.
 *
 * ── Vérification ─────────────────────────────────────────────────────────────
 *   GET /wp-json/wc/v3/products/<ID>?consumer_key=...&consumer_secret=...
 *   → le JSON doit contenir "wdr_discounted_price": 19.92  (ou null si pas de remise)
 * ─────────────────────────────────────────────────────────────────────────────
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('youvape_wdr_compute_discounted_price')) {
    /**
     * Calcule le prix unitaire remisé d'un produit via Woo Discount Rules.
     * Contexte catalogue : visiteur (aucun rôle), quantité 1, hors panier.
     *
     * @param WC_Product $product
     * @return float|null  Prix remisé TTC, ou null si aucune remise applicable.
     */
    function youvape_wdr_compute_discounted_price($product) {
        if (!is_a($product, 'WC_Product')) {
            return null;
        }
        // Les produits variables n'ont pas de prix propre : on remise les variations.
        if ($product->is_type('variable')) {
            return null;
        }

        $price = (float) $product->get_price();
        if ($price <= 0) {
            return null;
        }

        // Filtre exposé par Woo Discount Rules (>= 2.x). Retourne false si pas de remise.
        // Signature : ($price, $product, $quantity, $custom_price, $get_only, $manual_request, $is_cart)
        $discounted = apply_filters(
            'advanced_woo_discount_rules_get_product_discount_price_from_custom_price',
            $price,
            $product,
            1,
            0,
            'discounted_price',
            true,   // manual_request : calcul hors contexte panier
            false   // is_cart : false = affichage catalogue
        );

        if ($discounted === false || !is_numeric($discounted)) {
            return null;
        }
        $discounted = round((float) $discounted, 2);

        // Pas de remise réelle (égal ou supérieur au prix) → null.
        if ($discounted >= $price) {
            return null;
        }
        return $discounted;
    }
}

/**
 * Injecte le champ dans la réponse REST (produits simples/variables ET variations).
 */
$youvape_wdr_rest_inject = function ($response, $product, $request) {
    if (is_a($response, 'WP_REST_Response') && is_a($product, 'WC_Product')) {
        $data = $response->get_data();
        $data['wdr_discounted_price'] = youvape_wdr_compute_discounted_price($product);
        $response->set_data($data);
    }
    return $response;
};

add_filter('woocommerce_rest_prepare_product_object', $youvape_wdr_rest_inject, 20, 3);
add_filter('woocommerce_rest_prepare_product_variation_object', $youvape_wdr_rest_inject, 20, 3);
