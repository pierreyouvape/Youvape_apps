/**
 * Youvape Sync v2 - Admin JavaScript
 */

(function($) {
    'use strict';

    const YouvapeSync = {
        init: function() {
            this.bindEvents();
            this.loadStatus();
            this.loadLogs();
        },

        bindEvents: function() {
            $('#youvape-run-test').on('click', this.runTest.bind(this));
            $('#youvape-refresh-status').on('click', this.loadStatus.bind(this));
            $('#youvape-force-sync').on('click', this.forceSync.bind(this));

            // Bulk Sync controls
            $('#youvape-bulk-start').on('click', this.bulkStart.bind(this));
            $('#youvape-bulk-pause').on('click', this.bulkPause.bind(this));
            $('#youvape-bulk-resume').on('click', this.bulkResume.bind(this));
            $('#youvape-bulk-reset').on('click', this.bulkReset.bind(this));
            $('#youvape-bulk-process-manual').on('click', this.bulkProcessManual.bind(this));
            $('#youvape-bulk-process-data').on('click', this.bulkProcessData.bind(this));
            $('#youvape-bulk-process-orders').on('click', this.bulkProcessOrders.bind(this));
        },

        /**
         * Run Phase 0 test
         */
        runTest: function(e) {
            e.preventDefault();

            const $button = $(e.currentTarget);
            const $results = $('#youvape-test-results');
            const $loading = $('.youvape-test-loading');
            const $content = $('#youvape-test-content');
            const productId = $('#youvape-product-id').val();

            // Show loading
            $button.prop('disabled', true);
            $results.show();
            $loading.show();
            $content.empty();

            // Prepare data
            const data = {};
            if (productId) {
                data.product_id = productId;
            }

            // Make API request
            $.ajax({
                url: youvapeSyncV2.restUrl + 'test',
                method: 'POST',
                data: data,
                beforeSend: function(xhr) {
                    xhr.setRequestHeader('X-WP-Nonce', youvapeSyncV2.nonce);
                },
                success: function(response) {
                    $loading.hide();
                    $button.prop('disabled', false);
                    YouvapeSync.renderTestResults(response, $content);
                },
                error: function(xhr) {
                    $loading.hide();
                    $button.prop('disabled', false);
                    $content.html('<div class="notice notice-error"><p>Error: ' + xhr.responseText + '</p></div>');
                }
            });
        },

        /**
         * Render test results
         */
        renderTestResults: function(results, $container) {
            let html = '<div class="youvape-test-results-content">';

            if (!results.success) {
                html += '<div class="notice notice-error"><p><strong>Test Failed:</strong> ' + results.errors.join(', ') + '</p></div>';
            } else {
                html += '<div class="notice notice-success"><p><strong>Test Completed Successfully</strong></p></div>';
            }

            // Customer results
            if (results.customer) {
                html += this.renderItemResults('Customer', results.customer);
            }

            // Product results
            if (results.product) {
                html += this.renderItemResults('Product', results.product);
            }

            // Order results
            if (results.order) {
                html += this.renderItemResults('Order', results.order);
            }

            // VPS Response
            if (results.vps_response) {
                html += '<div class="youvape-test-item">';
                html += '<h3>VPS Response</h3>';

                if (results.vps_response.success) {
                    html += '<div class="notice notice-success inline"><p>✓ VPS responded successfully</p></div>';
                } else {
                    html += '<div class="notice notice-error inline"><p>✗ VPS error: ' + (results.vps_response.error || 'Unknown error') + '</p></div>';
                }

                html += '<details>';
                html += '<summary>View Full Response</summary>';
                html += '<pre>' + JSON.stringify(results.vps_response, null, 2) + '</pre>';
                html += '</details>';

                html += '</div>';
            }

            html += '</div>';

            $container.html(html);
        },

        /**
         * Render individual item results
         */
        renderItemResults: function(type, item) {
            let html = '<div class="youvape-test-item">';

            // Add product type indicator if available
            let title = type + ' (WP ID: ' + item.wp_id;
            if (item.product_type) {
                title += ' - Type: ' + item.product_type;
            }
            title += ')';

            html += '<h3>' + title + '</h3>';

            // RAW data only (open by default)
            html += '<details open>';
            html += '<summary><strong>RAW WordPress Data (sent to VPS)</strong></summary>';

            // Remove 'type' and 'wp_id' from display (already shown in title)
            const displayData = Object.assign({}, item);
            delete displayData.type;
            delete displayData.wp_id;

            html += '<pre>' + JSON.stringify(displayData, null, 2) + '</pre>';
            html += '</details>';

            html += '</div>';

            return html;
        },

        /**
         * Load sync status
         */
        loadStatus: function() {
            $.ajax({
                url: youvapeSyncV2.restUrl + 'status',
                method: 'GET',
                beforeSend: function(xhr) {
                    xhr.setRequestHeader('X-WP-Nonce', youvapeSyncV2.nonce);
                },
                success: function(response) {
                    if (response.success && response.data) {
                        YouvapeSync.updateStatus(response.data);
                    }
                }
            });
        },

        /**
         * Update status display
         */
        updateStatus: function(data) {
            const queueState = data.queue_state || {};
            const totals = data.totals || {};

            // Update active queue
            $('#youvape-active-queue').text(queueState.active_queue || 'None');

            // Update last run
            $('#youvape-last-run').text(queueState.last_run || 'Never');

            // Update bulk sync UI
            if (queueState && Object.keys(queueState).length > 0) {
                this.updateBulkUI(queueState);
            }
        },

        /**
         * Load logs
         */
        loadLogs: function() {
            $.ajax({
                url: youvapeSyncV2.restUrl + 'logs',
                method: 'GET',
                beforeSend: function(xhr) {
                    xhr.setRequestHeader('X-WP-Nonce', youvapeSyncV2.nonce);
                },
                success: function(response) {
                    if (response.success && response.data) {
                        YouvapeSync.renderLogs(response.data);
                    }
                }
            });
        },

        /**
         * Render logs
         */
        renderLogs: function(logs) {
            const $container = $('#youvape-logs-container');

            if (!logs || logs.length === 0) {
                $container.html('<p class="description">No logs yet.</p>');
                return;
            }

            let html = '<table class="widefat striped">';
            html += '<thead><tr>';
            html += '<th>Timestamp</th>';
            html += '<th>Level</th>';
            html += '<th>Message</th>';
            html += '</tr></thead>';
            html += '<tbody>';

            logs.forEach(function(log) {
                const levelClass = 'log-level-' + log.level;
                html += '<tr class="' + levelClass + '">';
                html += '<td>' + log.timestamp + '</td>';
                html += '<td><span class="log-level-badge">' + log.level + '</span></td>';
                html += '<td>' + log.message + '</td>';
                html += '</tr>';
            });

            html += '</tbody></table>';

            $container.html(html);
        },

        /**
         * Force sync (Phase 1)
         */
        forceSync: function(e) {
            e.preventDefault();

            alert('Force sync will be available in Phase 1');
        },

        /**
         * Bulk Sync: Start
         */
        bulkStart: function(e) {
            e.preventDefault();

            if (!confirm('Start full historical sync? This will import all customers, products, and orders.')) {
                return;
            }

            const $button = $(e.currentTarget);
            $button.prop('disabled', true).text('Starting...');

            $.ajax({
                url: youvapeSyncV2.restUrl + 'bulk/start',
                method: 'POST',
                beforeSend: function(xhr) {
                    xhr.setRequestHeader('X-WP-Nonce', youvapeSyncV2.nonce);
                },
                success: function(response) {
                    $button.prop('disabled', false).text('Start Full Sync');

                    if (response.success) {
                        alert('Bulk sync started! Processing will continue in background.');
                        YouvapeSync.loadStatus();
                        YouvapeSync.updateBulkUI(response.state);
                    } else {
                        alert('Error: ' + (response.message || 'Unknown error'));
                    }
                },
                error: function(xhr) {
                    $button.prop('disabled', false).text('Start Full Sync');
                    alert('Error starting sync: ' + xhr.responseText);
                }
            });
        },

        /**
         * Bulk Sync: Pause
         */
        bulkPause: function(e) {
            e.preventDefault();

            $.ajax({
                url: youvapeSyncV2.restUrl + 'bulk/pause',
                method: 'POST',
                beforeSend: function(xhr) {
                    xhr.setRequestHeader('X-WP-Nonce', youvapeSyncV2.nonce);
                },
                success: function(response) {
                    if (response.success) {
                        alert('Bulk sync paused');
                        YouvapeSync.loadStatus();
                    }
                },
                error: function(xhr) {
                    alert('Error pausing sync: ' + xhr.responseText);
                }
            });
        },

        /**
         * Bulk Sync: Resume
         */
        bulkResume: function(e) {
            e.preventDefault();

            $.ajax({
                url: youvapeSyncV2.restUrl + 'bulk/resume',
                method: 'POST',
                beforeSend: function(xhr) {
                    xhr.setRequestHeader('X-WP-Nonce', youvapeSyncV2.nonce);
                },
                success: function(response) {
                    if (response.success) {
                        alert('Bulk sync resumed');
                        YouvapeSync.loadStatus();
                    }
                },
                error: function(xhr) {
                    alert('Error resuming sync: ' + xhr.responseText);
                }
            });
        },

        /**
         * Bulk Sync: Reset
         */
        bulkReset: function(e) {
            e.preventDefault();

            if (!confirm('Reset bulk sync? This will clear all progress and start from scratch.')) {
                return;
            }

            $.ajax({
                url: youvapeSyncV2.restUrl + 'bulk/reset',
                method: 'POST',
                beforeSend: function(xhr) {
                    xhr.setRequestHeader('X-WP-Nonce', youvapeSyncV2.nonce);
                },
                success: function(response) {
                    if (response.success) {
                        alert('Bulk sync reset');
                        YouvapeSync.loadStatus();
                    }
                },
                error: function(xhr) {
                    alert('Error resetting sync: ' + xhr.responseText);
                }
            });
        },

        /**
         * Bulk Sync: Process DATA (customers + products)
         */
        bulkProcessData: function(e) {
            e.preventDefault();

            const numBatches = parseInt($('#youvape-manual-num-batches').val()) || 10;
            const batchSize = parseInt($('#youvape-manual-batch-size').val()) || 100;

            if (!confirm('Process ' + numBatches + ' batches of ' + batchSize + ' items each?\n\nThis will process CUSTOMERS and PRODUCTS only.\nTotal: ~' + (numBatches * batchSize * 2) + ' items.')) {
                return;
            }

            const $button = $(e.currentTarget);
            const $progress = $('#youvape-manual-progress');
            const $status = $('#youvape-manual-status');

            $button.prop('disabled', true);
            $progress.show();
            $status.text('Processing customers and products...');

            $.ajax({
                url: youvapeSyncV2.restUrl + 'bulk/process-data',
                method: 'POST',
                data: {
                    num_batches: numBatches,
                    batch_size: batchSize
                },
                beforeSend: function(xhr) {
                    xhr.setRequestHeader('X-WP-Nonce', youvapeSyncV2.nonce);
                },
                success: function(response) {
                    $button.prop('disabled', false);

                    if (response.success) {
                        const total = response.total_processed || 0;
                        const results = response.results || {};

                        let message = 'Processed ' + total + ' items total:\n';
                        if (results.customers) {
                            message += '- Customers: ' + results.customers.items_processed + ' items in ' + results.customers.batches_processed + ' batches\n';
                        }
                        if (results.products) {
                            message += '- Products: ' + results.products.items_processed + ' items in ' + results.products.batches_processed + ' batches';
                        }

                        $status.html('<strong style="color: green;">Success!</strong> ' + message.replace(/\n/g, '<br>'));

                        // Reload status to update progress bars
                        setTimeout(function() {
                            YouvapeSync.loadStatus();
                            $progress.hide();
                        }, 3000);
                    } else {
                        $status.html('<strong style="color: red;">Error:</strong> ' + (response.error || 'Unknown error'));
                    }
                },
                error: function(xhr) {
                    $button.prop('disabled', false);
                    $status.html('<strong style="color: red;">Error:</strong> ' + xhr.responseText);
                }
            });
        },

        /**
         * Bulk Sync: Process ORDERS
         */
        bulkProcessOrders: function(e) {
            e.preventDefault();

            const numBatches = parseInt($('#youvape-manual-num-batches').val()) || 10;
            const batchSize = parseInt($('#youvape-manual-batch-size').val()) || 100;

            if (!confirm('Process ' + numBatches + ' batches of ' + batchSize + ' items each?\n\nThis will process ORDERS only.\nTotal: ~' + (numBatches * batchSize) + ' items.\n\n⚠️ Make sure you have processed CUSTOMERS and PRODUCTS first!')) {
                return;
            }

            const $button = $(e.currentTarget);
            const $progress = $('#youvape-manual-progress');
            const $status = $('#youvape-manual-status');

            $button.prop('disabled', true);
            $progress.show();
            $status.text('Processing orders...');

            $.ajax({
                url: youvapeSyncV2.restUrl + 'bulk/process-orders',
                method: 'POST',
                data: {
                    num_batches: numBatches,
                    batch_size: batchSize
                },
                beforeSend: function(xhr) {
                    xhr.setRequestHeader('X-WP-Nonce', youvapeSyncV2.nonce);
                },
                success: function(response) {
                    $button.prop('disabled', false);

                    if (response.success) {
                        const total = response.total_processed || 0;
                        const results = response.results || {};

                        let message = 'Processed ' + total + ' orders in ' + (results.orders ? results.orders.batches_processed : 0) + ' batches';

                        $status.html('<strong style="color: green;">Success!</strong> ' + message);

                        // Reload status to update progress bars
                        setTimeout(function() {
                            YouvapeSync.loadStatus();
                            $progress.hide();
                        }, 3000);
                    } else {
                        $status.html('<strong style="color: red;">Error:</strong> ' + (response.error || 'Unknown error'));
                    }
                },
                error: function(xhr) {
                    $button.prop('disabled', false);
                    $status.html('<strong style="color: red;">Error:</strong> ' + xhr.responseText);
                }
            });
        },

        /**
         * Bulk Sync: Process Manual (DEPRECATED - ALL TYPES)
         */
        bulkProcessManual: function(e) {
            e.preventDefault();

            const numBatches = parseInt($('#youvape-manual-num-batches').val()) || 10;
            const batchSize = parseInt($('#youvape-manual-batch-size').val()) || 100;

            if (!confirm('Process ' + numBatches + ' batches of ' + batchSize + ' items each?\n\nThis will process approximately ' + (numBatches * batchSize * 3) + ' total items (customers + products + orders).')) {
                return;
            }

            const $button = $(e.currentTarget);
            const $progress = $('#youvape-manual-progress');
            const $status = $('#youvape-manual-status');

            $button.prop('disabled', true);
            $progress.show();
            $status.text('Starting...');

            $.ajax({
                url: youvapeSyncV2.restUrl + 'bulk/process-manual',
                method: 'POST',
                data: {
                    num_batches: numBatches,
                    batch_size: batchSize
                },
                beforeSend: function(xhr) {
                    xhr.setRequestHeader('X-WP-Nonce', youvapeSyncV2.nonce);
                },
                success: function(response) {
                    $button.prop('disabled', false);

                    if (response.success) {
                        const total = response.total_processed || 0;
                        const results = response.results || {};

                        let message = 'Processed ' + total + ' items total:\n';
                        if (results.customers) {
                            message += '- Customers: ' + results.customers.items_processed + ' items in ' + results.customers.batches_processed + ' batches\n';
                        }
                        if (results.products) {
                            message += '- Products: ' + results.products.items_processed + ' items in ' + results.products.batches_processed + ' batches\n';
                        }
                        if (results.orders) {
                            message += '- Orders: ' + results.orders.items_processed + ' items in ' + results.orders.batches_processed + ' batches';
                        }

                        $status.html('<strong style="color: green;">Success!</strong> ' + message.replace(/\n/g, '<br>'));

                        // Reload status to update progress bars
                        setTimeout(function() {
                            YouvapeSync.loadStatus();
                            $progress.hide();
                        }, 3000);
                    } else {
                        $status.html('<strong style="color: red;">Error:</strong> ' + (response.error || 'Unknown error'));
                    }
                },
                error: function(xhr) {
                    $button.prop('disabled', false);
                    $status.html('<strong style="color: red;">Error:</strong> ' + xhr.responseText);
                }
            });
        },

        /**
         * Update Bulk UI based on state
         */
        updateBulkUI: function(state) {
            const status = state.status || 'idle';

            // Update status badge
            $('#youvape-bulk-status-text').html('<span class="youvape-status-badge status-' + status + '">' + status.charAt(0).toUpperCase() + status.slice(1) + '</span>');

            // Show/hide buttons
            if (status === 'running') {
                $('#youvape-bulk-start').hide();
                $('#youvape-bulk-pause').show();
                $('#youvape-bulk-resume').hide();
            } else if (status === 'paused') {
                $('#youvape-bulk-start').hide();
                $('#youvape-bulk-pause').hide();
                $('#youvape-bulk-resume').show();
            } else {
                $('#youvape-bulk-start').show();
                $('#youvape-bulk-pause').hide();
                $('#youvape-bulk-resume').hide();
            }

            // Show started time
            if (state.started_at) {
                $('#youvape-bulk-started-at').show();
                $('#youvape-bulk-started-time').text(state.started_at);
            }

            // Update progress bars
            this.updateBulkProgress(state);
        },

        /**
         * Update Bulk Progress Bars
         */
        updateBulkProgress: function(state) {
            const types = ['customers', 'products', 'orders'];
            let html = '';

            types.forEach(function(type) {
                const total = state[type + '_total'] || 0;
                const synced = state[type + '_synced'] || 0;
                const offset = state[type + '_offset'] || 0;
                const percent = total > 0 ? Math.round((synced / total) * 100) : 0;

                html += '<div class="youvape-bulk-progress-item" style="margin-bottom: 15px;">';
                html += '<div style="display: flex; justify-content: space-between; margin-bottom: 5px;">';
                html += '<strong>' + type.charAt(0).toUpperCase() + type.slice(1) + '</strong>';
                html += '<span>' + synced.toLocaleString() + ' / ' + total.toLocaleString() + ' (' + percent + '%)</span>';
                html += '</div>';
                html += '<div class="youvape-progress-bar" style="background: #e0e0e0; height: 25px; border-radius: 3px; overflow: hidden;">';
                html += '<div class="youvape-progress-fill" style="background: #2271b1; height: 100%; width: ' + percent + '%; transition: width 0.3s;"></div>';
                html += '</div>';
                html += '</div>';
            });

            $('#youvape-bulk-progress').html(html);
        }
    };

    // Initialize on document ready
    $(document).ready(function() {
        if ($('.youvape-sync-v2-admin').length) {
            YouvapeSync.init();
        }
    });

})(jQuery);
