<?php
/**
 * Écarts de stock (jamais de valeur absolue).
 *
 * Ligne : { movement_id, product_id, delta (entier ≠ 0), reason }.
 * Refusé en bloc (STOCK_CHANGES_DISABLED) tant que l'interrupteur
 * stock_changes_enabled est coupé.
 *
 * Ordre des opérations, pour qu'un mouvement ne s'applique jamais deux fois :
 * 1. movement_id déjà connu → « already » (ou conflit / état incertain) ;
 * 2. contrôles du produit (aucune trace laissée par un refus) ;
 * 3. réservation de la ligne (INSERT IGNORE sur la clé unique) : 0 ligne
 *    insérée = une autre requête l'a prise entre-temps ;
 * 4. wc_update_product_stock() : UPDATE relatif en SQL
 *    (meta_value = meta_value ± N), donc sans écraser une vente simultanée ;
 * 5. ligne passée en « applied ».
 * Échec AVANT l'UPDATE : la réservation est supprimée, le mouvement pourra
 * être renvoyé. Échec APRÈS : la ligne reste comptée comme appliquée.
 */

if (!defined('ABSPATH')) {
    exit;
}

function youvape_logistique_stock_adjust_line($line, $settings = null) {
    global $wpdb;

    $echo = array('movement_id' => youvape_logistique_echo_id($line, 'movement_id'));
    if (!is_array($line)) {
        return youvape_logistique_line_error('INVALID_LINE', 'La ligne doit être un objet.', $echo);
    }
    // Interrupteur coupé : rien n'est réservé ni appliqué, le mouvement pourra être renvoyé.
    if ($settings === null) {
        $settings = youvape_logistique_settings();
    }
    if (empty($settings['stock_changes_enabled'])) {
        return youvape_logistique_line_error('STOCK_CHANGES_DISABLED', 'Les mouvements de stock sont coupés dans les réglages du plugin : rien n\'a bougé.', $echo);
    }

    $movement_id = isset($line['movement_id']) ? $line['movement_id'] : null;
    $product_id  = youvape_logistique_int(isset($line['product_id']) ? $line['product_id'] : null);
    $delta       = youvape_logistique_int(isset($line['delta']) ? $line['delta'] : null);
    $reason      = youvape_logistique_text(isset($line['reason']) ? $line['reason'] : null, 190);

    if (!youvape_logistique_valid_external_id($movement_id)) {
        return youvape_logistique_line_error('INVALID_LINE', 'movement_id manquant ou invalide (1 à 64 caractères parmi A-Z a-z 0-9 . _ : -).', $echo);
    }
    if ($product_id === null || $product_id <= 0) {
        return youvape_logistique_line_error('INVALID_LINE', 'product_id doit être un entier positif.', $echo);
    }
    if ($delta === null || $delta === 0 || abs($delta) > 1000000) {
        return youvape_logistique_line_error('INVALID_LINE', 'delta doit être un entier non nul (au plus 1 000 000 en valeur absolue).', $echo);
    }
    if ($reason === null || $reason === '') {
        return youvape_logistique_line_error('INVALID_LINE', 'reason est obligatoire (190 caractères au plus).', $echo);
    }

    $echo        = array('movement_id' => $movement_id, 'product_id' => $product_id, 'delta' => $delta);
    $table       = youvape_logistique_table('stock_movements');
    $fingerprint = md5($product_id . '|' . $delta);

    // 1. Déjà connu ?
    $known = youvape_logistique_known_movement($movement_id, $fingerprint, $echo);
    if ($known !== null) {
        return $known;
    }

    // 2. Contrôles du produit. Le type est lu en base : un pack woosb reste
    //    reconnu même si woosb est désactivé (il serait alors chargé comme simple).
    $type    = WC_Product_Factory::get_product_type($product_id);
    $product = $type ? wc_get_product($product_id) : false;
    if (!$product) {
        return youvape_logistique_line_error('PRODUCT_NOT_FOUND', sprintf('Le produit %d est introuvable.', $product_id), $echo);
    }
    if ($product->get_status() === 'trash') {
        return youvape_logistique_line_error('PRODUCT_TRASHED', sprintf('Le produit %d est dans la corbeille.', $product_id), $echo);
    }
    if ($type === 'woosb') {
        return youvape_logistique_line_error('PRODUCT_IS_BUNDLE', sprintf('Le produit %d est un pack : son stock est calculé à partir de ses composants, on n\'y touche pas.', $product_id), $echo);
    }
    if ($type === 'variable') {
        return youvape_logistique_line_error('PRODUCT_IS_VARIABLE_PARENT', sprintf('Le produit %d est un parent variable : envoyer la déclinaison.', $product_id), $echo);
    }
    if (!$product->managing_stock()) {
        $message = get_option('woocommerce_manage_stock') === 'yes'
            ? sprintf('Le produit %d ne gère pas son stock.', $product_id)
            : 'La gestion de stock est désactivée sur la boutique (WooCommerce → Réglages → Produits → Inventaire).';
        return youvape_logistique_line_error('STOCK_NOT_MANAGED', $message, $echo);
    }
    $stock_product_id         = (int) $product->get_stock_managed_by_id();
    $echo['stock_product_id'] = $stock_product_id;

    // 3. Réservation.
    $inserted = $wpdb->query($wpdb->prepare(
        "INSERT IGNORE INTO {$table} (movement_id, fingerprint, product_id, stock_product_id, delta, reason, state, created_at)
         VALUES (%s, %s, %d, %d, %d, %s, 'pending', %s)",
        $movement_id,
        $fingerprint,
        $product_id,
        $stock_product_id,
        $delta,
        $reason,
        youvape_logistique_now_utc()
    ));
    if ($inserted === false) {
        return youvape_logistique_line_error('DB_ERROR', 'Réservation du mouvement impossible : ' . $wpdb->last_error, $echo);
    }
    if ($inserted === 0) {
        $known = youvape_logistique_known_movement($movement_id, $fingerprint, $echo);
        return $known !== null ? $known : youvape_logistique_line_error('DB_ERROR', 'Mouvement ni réservé ni retrouvé.', $echo);
    }

    // 4. Application. Le hook part juste après l'UPDATE SQL : il dit si le stock a bougé.
    $written = false;
    $watcher = function ($id) use ($stock_product_id, &$written) {
        if ((int) $id === $stock_product_id) {
            $written = true;
        }
    };
    add_action('woocommerce_updated_product_stock', $watcher);

    $warning = null;
    $after   = null;
    try {
        $after = wc_update_product_stock($product, abs($delta), $delta > 0 ? 'increase' : 'decrease');
    } catch (\Throwable $e) {
        $warning = $e->getMessage();
    } finally {
        remove_action('woocommerce_updated_product_stock', $watcher);
    }

    if (!$written) {
        $wpdb->delete($table, array('movement_id' => $movement_id), array('%s'));
        $message = $warning !== null ? 'Erreur avant la mise à jour du stock : ' . $warning : 'WooCommerce n\'a pas mis à jour le stock.';
        return youvape_logistique_line_error('STOCK_UPDATE_FAILED', $message . ' Rien n\'a été appliqué, le mouvement peut être renvoyé.', $echo);
    }

    // 5. Confirmation.
    $stock_after = is_numeric($after) ? (float) $after : null;
    $wpdb->update(
        $table,
        array('state' => 'applied', 'stock_after' => $stock_after, 'applied_at' => youvape_logistique_now_utc()),
        array('movement_id' => $movement_id),
        array('%s', '%f', '%s'), // wpdb écrit NULL pour une valeur null, quel que soit le format.
        array('%s')
    );

    $result = array_merge($echo, array(
        'result'      => 'applied',
        'stock_after' => $stock_after,
    ));
    if ($warning !== null) {
        // Le stock a bougé, mais un hook (cache, plugin) a échoué ensuite.
        $result['warning'] = 'Stock mis à jour, mais une erreur a suivi : ' . $warning;
    }
    return $result;
}

/**
 * Résultat d'un movement_id déjà présent dans le journal, ou null s'il est inconnu.
 */
function youvape_logistique_known_movement($movement_id, $fingerprint, $echo) {
    global $wpdb;
    $table = youvape_logistique_table('stock_movements');
    $row   = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$table} WHERE movement_id = %s", $movement_id));
    if (!$row) {
        return null;
    }
    if ($row->fingerprint !== $fingerprint) {
        return youvape_logistique_line_error('MOVEMENT_ID_CONFLICT', sprintf(
            'movement_id déjà utilisé pour un autre mouvement (produit %d, delta %d).',
            (int) $row->product_id,
            (int) $row->delta
        ), $echo);
    }
    if ($row->state !== 'applied') {
        return youvape_logistique_line_error('MOVEMENT_PENDING', 'Mouvement réservé mais jamais confirmé (requête interrompue ?) : vérifier le stock à la main avant toute action.', $echo);
    }
    return array_merge($echo, array(
        'result'           => 'already',
        'stock_product_id' => (int) $row->stock_product_id,
        'stock_after'      => $row->stock_after !== null ? (float) $row->stock_after : null,
        'applied_at'       => $row->applied_at,
    ));
}
