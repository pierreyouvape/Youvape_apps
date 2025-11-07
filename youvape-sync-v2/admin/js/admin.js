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

            // Update progress (placeholder for Phase 1)
            // For now, just show 0% since we haven't synced anything yet
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
        }
    };

    // Initialize on document ready
    $(document).ready(function() {
        if ($('.youvape-sync-v2-admin').length) {
            YouvapeSync.init();
        }
    });

})(jQuery);
