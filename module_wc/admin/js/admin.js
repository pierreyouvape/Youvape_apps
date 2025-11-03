/**
 * JavaScript pour la page d'administration Youvape Sync
 */

(function($) {
    'use strict';

    // Variables globales
    let batchProcessing = false;
    let batchInterval = null;

    /**
     * Initialisation
     */
    $(document).ready(function() {
        initSettingsForm();
        initConnectionTest();
        initBatchImport();
        checkBatchStatus();
    });

    /**
     * Initialise le formulaire de paramètres
     */
    function initSettingsForm() {
        $('#youvape-sync-settings-form').on('submit', function(e) {
            e.preventDefault();

            const $form = $(this);
            const $submitBtn = $form.find('button[type="submit"]');
            const originalText = $submitBtn.text();

            // Collecte les données
            const settings = {
                api_url: $('#api_url').val(),
                api_key: $('#api_key').val(),
                batch_size: parseInt($('#batch_size').val()),
                enable_customers: $('input[name="enable_customers"]').is(':checked'),
                enable_products: $('input[name="enable_products"]').is(':checked'),
                enable_orders: $('input[name="enable_orders"]').is(':checked'),
                enable_time_restriction: $('input[name="enable_time_restriction"]').is(':checked'),
                time_start: $('input[name="time_start"]').val(),
                time_end: $('input[name="time_end"]').val(),
                live_sync_enabled: $('input[name="live_sync_enabled"]').is(':checked'),
                live_sync_delay: parseInt($('input[name="live_sync_delay"]').val())
            };

            // Désactive le bouton
            $submitBtn.prop('disabled', true).text('Sauvegarde...');

            // Envoie la requête
            $.ajax({
                url: youvapeSyncAdmin.ajax_url,
                type: 'POST',
                data: {
                    action: 'youvape_sync_save_settings',
                    nonce: youvapeSyncAdmin.nonce,
                    settings: settings
                },
                success: function(response) {
                    if (response.success) {
                        showNotice('success', response.data.message);
                    } else {
                        showNotice('error', response.data.message || 'Erreur lors de la sauvegarde.');
                    }
                },
                error: function() {
                    showNotice('error', 'Erreur réseau lors de la sauvegarde.');
                },
                complete: function() {
                    $submitBtn.prop('disabled', false).text(originalText);
                }
            });
        });
    }

    /**
     * Initialise le test de connexion
     */
    function initConnectionTest() {
        $('#test-connection').on('click', function() {
            const $btn = $(this);
            const originalText = $btn.text();

            $btn.prop('disabled', true).html('Test en cours... <span class="youvape-sync-spinner"></span>');

            $.ajax({
                url: youvapeSyncAdmin.ajax_url,
                type: 'POST',
                data: {
                    action: 'youvape_sync_test_connection',
                    nonce: youvapeSyncAdmin.nonce
                },
                success: function(response) {
                    if (response.success) {
                        $('#connection-test-result').html(
                            '<div class="notice notice-success"><p>' +
                            '<span class="status-icon success">✓</span>' +
                            (response.data.message || 'Connexion réussie !') +
                            '</p></div>'
                        );
                    } else {
                        $('#connection-test-result').html(
                            '<div class="notice notice-error"><p>' +
                            '<span class="status-icon error">✕</span>' +
                            (response.data.error || 'Échec de la connexion.') +
                            '</p></div>'
                        );
                    }
                },
                error: function() {
                    $('#connection-test-result').html(
                        '<div class="notice notice-error"><p>' +
                        '<span class="status-icon error">✕</span>' +
                        'Erreur réseau.' +
                        '</p></div>'
                    );
                },
                complete: function() {
                    $btn.prop('disabled', false).text(originalText);
                }
            });
        });

        // Reset des offsets de test
        $('#reset-test-offsets').on('click', function() {
            if (!confirm('Êtes-vous sûr de vouloir réinitialiser les offsets de test ?\n\nCela permettra de renvoyer les mêmes échantillons depuis le début.')) {
                return;
            }

            const $btn = $(this);
            const originalText = $btn.text();

            $btn.prop('disabled', true).html('Réinitialisation... <span class="youvape-sync-spinner"></span>');

            $.ajax({
                url: youvapeSyncAdmin.ajax_url,
                type: 'POST',
                data: {
                    action: 'youvape_sync_reset_test_offsets',
                    nonce: youvapeSyncAdmin.nonce
                },
                success: function(response) {
                    if (response.success) {
                        $('#test-sample-result').html(
                            '<div class="notice notice-success"><p>' +
                            '<span class="status-icon success">✓</span>' +
                            (response.data.message || 'Offsets de test réinitialisés à 0.') +
                            '</p></div>'
                        );
                    } else {
                        $('#test-sample-result').html(
                            '<div class="notice notice-error"><p>' +
                            '<span class="status-icon error">✕</span>' +
                            (response.data.error || 'Échec de la réinitialisation.') +
                            '</p></div>'
                        );
                    }
                },
                error: function() {
                    $('#test-sample-result').html(
                        '<div class="notice notice-error"><p>' +
                        '<span class="status-icon error">✕</span>' +
                        'Erreur réseau.' +
                        '</p></div>'
                    );
                },
                complete: function() {
                    $btn.prop('disabled', false).text(originalText);
                }
            });
        });

        // Test d'échantillon
        $('#send-test-sample').on('click', function() {
            const $btn = $(this);
            const originalText = $btn.text();

            const customers_count = parseInt($('#test_customers_count').val()) || 0;
            const products_count = parseInt($('#test_products_count').val()) || 0;
            const orders_count = parseInt($('#test_orders_count').val()) || 0;

            if (customers_count === 0 && products_count === 0 && orders_count === 0) {
                alert('Veuillez spécifier au moins un type de données à envoyer.');
                return;
            }

            $btn.prop('disabled', true).html('Envoi en cours... <span class="youvape-sync-spinner"></span>');
            $('#test-sample-result').html('');

            $.ajax({
                url: youvapeSyncAdmin.ajax_url,
                type: 'POST',
                data: {
                    action: 'youvape_sync_send_test_sample',
                    nonce: youvapeSyncAdmin.nonce,
                    customers_count: customers_count,
                    products_count: products_count,
                    orders_count: orders_count
                },
                success: function(response) {
                    if (response.success) {
                        let resultHTML = '<div class="notice notice-success"><p>' +
                            '<span class="status-icon success">✓</span>' +
                            (response.data.message || 'Échantillon envoyé avec succès !') +
                            '</p></div>';

                        // Affiche les compteurs
                        if (response.data.counts) {
                            resultHTML += '<div style="margin-top: 15px;"><strong>Items envoyés :</strong><ul>';
                            if (response.data.counts.customers > 0) {
                                resultHTML += '<li>Clients: ' + response.data.counts.customers + '</li>';
                            }
                            if (response.data.counts.products > 0) {
                                resultHTML += '<li>Produits: ' + response.data.counts.products + '</li>';
                            }
                            if (response.data.counts.orders > 0) {
                                resultHTML += '<li>Commandes: ' + response.data.counts.orders + '</li>';
                            }
                            resultHTML += '</ul></div>';
                        }

                        // Bouton pour afficher le JSON
                        resultHTML += '<details style="margin-top: 15px; background: #fff; padding: 10px; border: 1px solid #ccc; border-radius: 4px;">' +
                            '<summary style="cursor: pointer; font-weight: 600;">Voir les données JSON envoyées</summary>' +
                            '<pre style="background: #f6f7f7; padding: 15px; overflow: auto; max-height: 400px; margin-top: 10px; font-size: 12px;">' +
                            JSON.stringify(response.data.results.data_sent, null, 2) +
                            '</pre>' +
                            '</details>';

                        $('#test-sample-result').html(resultHTML);
                    } else {
                        $('#test-sample-result').html(
                            '<div class="notice notice-error"><p>' +
                            '<span class="status-icon error">✕</span>' +
                            (response.data.error || 'Échec de l\'envoi.') +
                            '</p></div>'
                        );
                    }
                },
                error: function() {
                    $('#test-sample-result').html(
                        '<div class="notice notice-error"><p>' +
                        '<span class="status-icon error">✕</span>' +
                        'Erreur réseau.' +
                        '</p></div>'
                    );
                },
                complete: function() {
                    $btn.prop('disabled', false).text(originalText);
                }
            });
        });
    }

    /**
     * Initialise l'import batch
     */
    function initBatchImport() {
        // Démarrage
        $('#start-batch').on('click', function() {
            if (!confirm(youvapeSyncAdmin.strings.confirm_start)) {
                return;
            }

            const $btn = $(this);
            $btn.prop('disabled', true).text('Démarrage...');

            $.ajax({
                url: youvapeSyncAdmin.ajax_url,
                type: 'POST',
                data: {
                    action: 'youvape_sync_start_batch',
                    nonce: youvapeSyncAdmin.nonce
                },
                success: function(response) {
                    if (response.success) {
                        batchProcessing = true;
                        startBatchProcessing();
                        location.reload(); // Recharge pour afficher l'interface de progression
                    } else {
                        showNotice('error', response.data.error || 'Échec du démarrage.');
                        $btn.prop('disabled', false).text('Lancer l\'import historique');
                    }
                },
                error: function() {
                    showNotice('error', 'Erreur réseau.');
                    $btn.prop('disabled', false).text('Lancer l\'import historique');
                }
            });
        });

        // Arrêt
        $('#stop-batch').on('click', function() {
            if (!confirm(youvapeSyncAdmin.strings.confirm_stop)) {
                return;
            }

            const $btn = $(this);
            $btn.prop('disabled', true).text('Arrêt...');

            $.ajax({
                url: youvapeSyncAdmin.ajax_url,
                type: 'POST',
                data: {
                    action: 'youvape_sync_stop_batch',
                    nonce: youvapeSyncAdmin.nonce
                },
                success: function(response) {
                    if (response.success) {
                        stopBatchProcessing();
                        showNotice('success', response.data.message || 'Import arrêté.');
                        setTimeout(function() {
                            location.reload();
                        }, 1500);
                    } else {
                        showNotice('error', response.data.error || 'Échec de l\'arrêt.');
                        $btn.prop('disabled', false).text('Arrêter l\'import');
                    }
                },
                error: function() {
                    showNotice('error', 'Erreur réseau.');
                    $btn.prop('disabled', false).text('Arrêter l\'import');
                }
            });
        });
    }

    /**
     * Vérifie le statut de l'import batch
     */
    function checkBatchStatus() {
        const $batchStatus = $('.batch-status.running');
        if ($batchStatus.length > 0) {
            batchProcessing = true;
            startBatchProcessing();
        }
    }

    /**
     * Démarre le traitement batch (polling)
     */
    function startBatchProcessing() {
        if (batchInterval) {
            clearInterval(batchInterval);
        }

        // Traite immédiatement
        processBatch();

        // Puis toutes les 2 secondes
        batchInterval = setInterval(function() {
            processBatch();
        }, 2000);
    }

    /**
     * Arrête le traitement batch
     */
    function stopBatchProcessing() {
        batchProcessing = false;
        if (batchInterval) {
            clearInterval(batchInterval);
            batchInterval = null;
        }
    }

    /**
     * Traite un lot et met à jour l'affichage
     */
    function processBatch() {
        if (!batchProcessing) {
            return;
        }

        $.ajax({
            url: youvapeSyncAdmin.ajax_url,
            type: 'POST',
            data: {
                action: 'youvape_sync_process_batch',
                nonce: youvapeSyncAdmin.nonce
            },
            success: function(response) {
                if (response.success) {
                    updateProgress(response.data.status);

                    if (response.data.completed) {
                        stopBatchProcessing();
                        showNotice('success', 'Import terminé avec succès !');
                        setTimeout(function() {
                            location.reload();
                        }, 2000);
                    }
                } else {
                    if (!response.data.waiting) {
                        showNotice('error', response.data.error || 'Erreur lors du traitement.');
                        stopBatchProcessing();
                    }
                }
            },
            error: function() {
                showNotice('error', 'Erreur réseau.');
                stopBatchProcessing();
            }
        });
    }

    /**
     * Met à jour les barres de progression
     */
    function updateProgress(status) {
        if (!status || !status.totals || !status.processed) {
            return;
        }

        // Clients
        updateProgressBar('customers', status.processed.customers, status.totals.customers);

        // Produits
        updateProgressBar('products', status.processed.products, status.totals.products);

        // Commandes
        updateProgressBar('orders', status.processed.orders, status.totals.orders);
    }

    /**
     * Met à jour une barre de progression
     */
    function updateProgressBar(type, processed, total) {
        const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;

        $('#progress-' + type).css('width', percentage + '%');
        $('#progress-' + type + '-text').text(
            processed.toLocaleString() + ' / ' + total.toLocaleString() +
            ' (' + percentage + '%)'
        );
    }

    /**
     * Affiche une notice
     */
    function showNotice(type, message) {
        const noticeClass = type === 'success' ? 'notice-success' : 'notice-error';
        const icon = type === 'success' ? '✓' : '✕';
        const iconClass = type === 'success' ? 'success' : 'error';

        const $notice = $('<div class="notice ' + noticeClass + ' is-dismissible"><p>' +
            '<span class="status-icon ' + iconClass + '">' + icon + '</span>' +
            message +
            '</p></div>');

        $('.youvape-sync-admin h1').after($notice);

        // Auto-dismiss après 5 secondes
        setTimeout(function() {
            $notice.fadeOut(function() {
                $(this).remove();
            });
        }, 5000);
    }

    /**
     * Rafraîchit la taille de la queue live
     */
    function refreshQueueSize() {
        $.ajax({
            url: youvapeSyncAdmin.ajax_url,
            type: 'POST',
            data: {
                action: 'youvape_sync_get_status',
                nonce: youvapeSyncAdmin.nonce
            },
            success: function(response) {
                if (response.success && response.data.queue_size !== undefined) {
                    $('#queue-size').text(response.data.queue_size.toLocaleString());
                }
            }
        });
    }

    // Rafraîchit la queue toutes les 10 secondes si on est sur l'onglet live
    setInterval(function() {
        if ($('#tab-live').hasClass('active')) {
            refreshQueueSize();
        }
    }, 10000);

})(jQuery);
