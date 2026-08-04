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

    /** Liste déroulante des commandes (absente si le client n'en a aucune). */
    function orderSelect() {
        return root.querySelector('#youvape-sav-order');
    }

    function selectedOrderId() {
        var select = orderSelect();
        return select ? select.value : '';
    }

    /** La commande choisie est-elle hors délai de rétractation ? */
    function selectedOrderExpired() {
        var select = orderSelect();
        if (!select || !select.value) { return false; }
        var opt = select.options[select.selectedIndex];
        return !!opt && opt.getAttribute('data-expired') === '1';
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

        // L'avertissement « délai dépassé » ne concerne que la rétractation, et
        // seulement si la commande choisie est effectivement hors délai.
        var showExpired = chosen && reason.notice && selectedOrderExpired();
        each(root.querySelectorAll('[data-role="expired-warning"]'), function (el) {
            el.classList.toggle(HIDDEN, !showExpired);
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

    // Changement de commande : on remet à jour la liste des produits et
    // l'avertissement de délai. `refresh()` fait les deux.
    if (orderSelect()) {
        orderSelect().addEventListener('change', refresh);
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
