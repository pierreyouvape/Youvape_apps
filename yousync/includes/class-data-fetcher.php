<?php
/**
 * Data Fetcher - Récupère les données complètes depuis WordPress/WooCommerce
 */

namespace YouSync;

defined('ABSPATH') || exit;

class Data_Fetcher {

    /**
     * Get full order data
     *
     * @param int $order_id
     * @return array|null
     */
    public static function get_order($order_id) {
        $order = wc_get_order($order_id);
        if (!$order) {
            return null;
        }

        // Get customer
        $customer_id = $order->get_customer_id();

        // Get order items
        $items = [];
        foreach ($order->get_items() as $item) {
            $product = $item->get_product();
            $items[] = [
                'product_id' => $item->get_product_id(),
                'variation_id' => $item->get_variation_id(),
                'name' => $item->get_name(),
                'quantity' => $item->get_quantity(),
                'subtotal' => floatval($item->get_subtotal()),
                'total' => floatval($item->get_total()),
                'tax' => floatval($item->get_total_tax()),
                'sku' => $product ? $product->get_sku() : null
            ];
        }

        // Get shipping
        $shipping_items = [];
        $shipping_method = null;
        foreach ($order->get_items('shipping') as $item) {
            $shipping_items[] = [
                'method_id' => $item->get_method_id(),
                'method_title' => $item->get_method_title(),
                'total' => floatval($item->get_total())
            ];
            // Récupérer la première méthode de livraison
            if ($shipping_method === null) {
                $shipping_method = $item->get_method_title();
            }
        }

        // Get BMS shipping data (carrier and tracking)
        $shipping_carrier = $order->get_meta('bms_carrier');
        $tracking_number = $order->get_meta('bms_tracking_number');

        // Get coupons
        $coupons = [];
        foreach ($order->get_coupon_codes() as $code) {
            $coupons[] = $code;
        }

        return [
            'wp_order_id' => $order->get_id(),
            'order_number' => $order->get_order_number(),
            'status' => $order->get_status(),
            'currency' => $order->get_currency(),
            'total' => floatval($order->get_total()),
            'subtotal' => floatval($order->get_subtotal()),
            'total_tax' => floatval($order->get_total_tax()),
            'shipping_total' => floatval($order->get_shipping_total()),
            'discount_total' => floatval($order->get_discount_total()),
            'payment_method' => $order->get_payment_method(),
            'payment_method_title' => $order->get_payment_method_title(),
            'customer_id' => $customer_id ?: null,
            'customer_email' => $order->get_billing_email(),
            'billing_first_name' => $order->get_billing_first_name(),
            'billing_last_name' => $order->get_billing_last_name(),
            'billing_company' => $order->get_billing_company(),
            'billing_address_1' => $order->get_billing_address_1(),
            'billing_address_2' => $order->get_billing_address_2(),
            'billing_city' => $order->get_billing_city(),
            'billing_postcode' => $order->get_billing_postcode(),
            'billing_country' => $order->get_billing_country(),
            'billing_phone' => $order->get_billing_phone(),
            'shipping_first_name' => $order->get_shipping_first_name(),
            'shipping_last_name' => $order->get_shipping_last_name(),
            'shipping_address_1' => $order->get_shipping_address_1(),
            'shipping_address_2' => $order->get_shipping_address_2(),
            'shipping_city' => $order->get_shipping_city(),
            'shipping_postcode' => $order->get_shipping_postcode(),
            'shipping_country' => $order->get_shipping_country(),
            'customer_note' => $order->get_customer_note(),
            'date_created' => $order->get_date_created() ? $order->get_date_created()->format('Y-m-d H:i:s') : null,
            'date_modified' => $order->get_date_modified() ? $order->get_date_modified()->format('Y-m-d H:i:s') : null,
            'date_completed' => $order->get_date_completed() ? $order->get_date_completed()->format('Y-m-d H:i:s') : null,
            'date_paid' => $order->get_date_paid() ? $order->get_date_paid()->format('Y-m-d H:i:s') : null,
            'items' => $items,
            'shipping' => $shipping_items,
            'shipping_method' => $shipping_method,
            'shipping_carrier' => $shipping_carrier ?: null,
            'tracking_number' => $tracking_number ?: null,
            'coupons' => $coupons
        ];
    }

    /**
     * Get full product data
     *
     * @param int $product_id
     * @return array|null
     */
    public static function get_product($product_id) {
        $product = wc_get_product($product_id);
        if (!$product) {
            return null;
        }

        $data = [
            'wp_product_id' => $product->get_id(),
            'parent_id' => $product->get_parent_id(),
            'type' => $product->get_type(),
            'name' => $product->get_name(),
            'slug' => $product->get_slug(),
            'sku' => $product->get_sku(),
            'status' => $product->get_status(),
            'description' => $product->get_description(),
            'short_description' => $product->get_short_description(),
            'price' => floatval($product->get_price()),
            'regular_price' => floatval($product->get_regular_price()),
            'sale_price' => $product->get_sale_price() ? floatval($product->get_sale_price()) : null,
            'on_sale' => $product->is_on_sale(),
            'stock_quantity' => $product->get_stock_quantity(),
            'stock_status' => $product->get_stock_status(),
            'manage_stock' => $product->get_manage_stock(),
            'weight' => $product->get_weight(),
            'length' => $product->get_length(),
            'width' => $product->get_width(),
            'height' => $product->get_height(),
            'tax_status' => $product->get_tax_status(),
            'tax_class' => $product->get_tax_class(),
            'date_created' => $product->get_date_created() ? $product->get_date_created()->format('Y-m-d H:i:s') : null,
            'date_modified' => $product->get_date_modified() ? $product->get_date_modified()->format('Y-m-d H:i:s') : null,
            'image_url' => wp_get_attachment_url($product->get_image_id()) ?: null,
            'permalink' => get_permalink($product->get_id())
        ];

        // Get brand
        $brands = wp_get_post_terms($product->get_id(), 'pwb-brand', ['fields' => 'all']);
        if (!is_wp_error($brands) && !empty($brands)) {
            $brand = $brands[0];
            $data['brand'] = $brand->name;
            if ($brand->parent) {
                $parent_brand = get_term($brand->parent, 'pwb-brand');
                if ($parent_brand && !is_wp_error($parent_brand)) {
                    $data['brand'] = $parent_brand->name;
                    $data['sub_brand'] = $brand->name;
                }
            }
        }

        // Get category
        $categories = wp_get_post_terms($product->get_id(), 'product_cat', ['fields' => 'all']);
        if (!is_wp_error($categories) && !empty($categories)) {
            $cat = $categories[0];
            $data['category'] = $cat->name;
            if ($cat->parent) {
                $parent_cat = get_term($cat->parent, 'product_cat');
                if ($parent_cat && !is_wp_error($parent_cat)) {
                    $data['category'] = $parent_cat->name;
                    $data['sub_category'] = $cat->name;
                }
            }
        }

        // Get attributes for variations
        if ($product->is_type('variation')) {
            $data['attributes'] = $product->get_variation_attributes();
        }

        // Get children for variable products
        if ($product->is_type('variable')) {
            $data['variations'] = $product->get_children();
        }

        return $data;
    }

    /**
     * Get full customer data
     *
     * @param int $customer_id
     * @return array|null
     */
    public static function get_customer($customer_id) {
        $customer = new \WC_Customer($customer_id);
        if (!$customer->get_id()) {
            return null;
        }

        $user = get_user_by('id', $customer_id);

        return [
            'wp_customer_id' => $customer->get_id(),
            'email' => $customer->get_email(),
            'first_name' => $customer->get_first_name(),
            'last_name' => $customer->get_last_name(),
            'display_name' => $customer->get_display_name(),
            'username' => $user ? $user->user_login : null,
            'billing_first_name' => $customer->get_billing_first_name(),
            'billing_last_name' => $customer->get_billing_last_name(),
            'billing_company' => $customer->get_billing_company(),
            'billing_address_1' => $customer->get_billing_address_1(),
            'billing_address_2' => $customer->get_billing_address_2(),
            'billing_city' => $customer->get_billing_city(),
            'billing_postcode' => $customer->get_billing_postcode(),
            'billing_country' => $customer->get_billing_country(),
            'billing_phone' => $customer->get_billing_phone(),
            'billing_email' => $customer->get_billing_email(),
            'shipping_first_name' => $customer->get_shipping_first_name(),
            'shipping_last_name' => $customer->get_shipping_last_name(),
            'shipping_company' => $customer->get_shipping_company(),
            'shipping_address_1' => $customer->get_shipping_address_1(),
            'shipping_address_2' => $customer->get_shipping_address_2(),
            'shipping_city' => $customer->get_shipping_city(),
            'shipping_postcode' => $customer->get_shipping_postcode(),
            'shipping_country' => $customer->get_shipping_country(),
            'date_created' => $customer->get_date_created() ? $customer->get_date_created()->format('Y-m-d H:i:s') : null,
            'date_modified' => $customer->get_date_modified() ? $customer->get_date_modified()->format('Y-m-d H:i:s') : null,
            'orders_count' => $customer->get_order_count(),
            'total_spent' => floatval($customer->get_total_spent())
        ];
    }

    /**
     * Get full refund data
     *
     * @param int $refund_id
     * @return array|null
     */
    public static function get_refund($refund_id) {
        $refund = wc_get_order($refund_id);
        if (!$refund || $refund->get_type() !== 'shop_order_refund') {
            return null;
        }

        return [
            'wp_refund_id' => $refund->get_id(),
            'wp_order_id' => $refund->get_parent_id(),
            'refund_amount' => floatval($refund->get_amount()),
            'refund_reason' => $refund->get_reason(),
            'refund_date' => $refund->get_date_created() ? $refund->get_date_created()->format('Y-m-d H:i:s') : null,
            'refunded_by' => $refund->get_refunded_by()
        ];
    }
}
