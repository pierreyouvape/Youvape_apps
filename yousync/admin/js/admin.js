/**
 * YouSync Admin JavaScript
 */

(function($) {
    'use strict';

    const YouSync = {
        init: function() {
            this.bindEvents();
            this.checkApiStatus();
        },

        bindEvents: function() {
            // Dashboard buttons
            $('#yousync-test-connection, #yousync-test-connection-settings').on('click', this.testConnection.bind(this));
            $('#yousync-force-send').on('click', this.forceSend.bind(this));
            $('#yousync-clear-queue').on('click', this.clearQueue.bind(this));
            $('#yousync-refresh-status').on('click', this.refreshStatus.bind(this));

            // Settings form
            $('#yousync-settings-form').on('submit', this.saveSettings.bind(this));

            // Logs
            $('#yousync-log-date').on('change', this.changeLogDate.bind(this));
            $('#yousync-download-log').on('click', this.downloadLog.bind(this));
        },

        /**
         * Test API connection
         */
        testConnection: function(e) {
            e.preventDefault();

            const $button = $(e.currentTarget);
            const $status = $('#yousync-api-status');

            $button.prop('disabled', true);
            $status.html('<span class="yousync-spinner"></span>');

            $.ajax({
                url: yousync.ajaxUrl,
                method: 'POST',
                data: {
                    action: 'yousync_test_connection',
                    nonce: yousync.nonce
                },
                success: function(response) {
                    $button.prop('disabled', false);
                    if (response.success) {
                        $status.html('<span class="success">OK</span>');
                        YouSync.showNotice('Connection successful!', 'success');
                    } else {
                        $status.html('<span class="error">Error</span>');
                        YouSync.showNotice('Connection failed: ' + (response.error || 'Unknown error'), 'error');
                    }
                },
                error: function() {
                    $button.prop('disabled', false);
                    $status.html('<span class="error">Error</span>');
                    YouSync.showNotice('Connection test failed', 'error');
                }
            });
        },

        /**
         * Check API status on load
         */
        checkApiStatus: function() {
            const $status = $('#yousync-api-status');
            if ($status.length === 0) return;

            $status.html('<span class="yousync-spinner"></span>');

            $.ajax({
                url: yousync.ajaxUrl,
                method: 'POST',
                data: {
                    action: 'yousync_test_connection',
                    nonce: yousync.nonce
                },
                success: function(response) {
                    if (response.success) {
                        $status.html('<span class="success">OK</span>');
                    } else {
                        $status.html('<span class="error">Error</span>');
                    }
                },
                error: function() {
                    $status.html('<span class="error">-</span>');
                }
            });
        },

        /**
         * Force send queue
         */
        forceSend: function(e) {
            e.preventDefault();

            const $button = $(e.currentTarget);

            if (!confirm('Send all queued events to VPS now?')) {
                return;
            }

            $button.prop('disabled', true).html('<span class="yousync-spinner"></span> Sending...');

            $.ajax({
                url: yousync.ajaxUrl,
                method: 'POST',
                data: {
                    action: 'yousync_force_send',
                    nonce: yousync.nonce
                },
                success: function(response) {
                    $button.prop('disabled', false).html('<span class="dashicons dashicons-upload"></span> Force Send Now');

                    if (response.success) {
                        YouSync.showNotice(response.message + ' (' + response.count + ' events)', 'success');
                        YouSync.refreshStatus();
                    } else {
                        YouSync.showNotice('Send failed: ' + (response.error || 'Unknown error'), 'error');
                    }
                },
                error: function() {
                    $button.prop('disabled', false).html('<span class="dashicons dashicons-upload"></span> Force Send Now');
                    YouSync.showNotice('Request failed', 'error');
                }
            });
        },

        /**
         * Clear queue
         */
        clearQueue: function(e) {
            e.preventDefault();

            if (!confirm('Are you sure you want to clear the entire queue? This cannot be undone.')) {
                return;
            }

            const $button = $(e.currentTarget);
            $button.prop('disabled', true);

            $.ajax({
                url: yousync.ajaxUrl,
                method: 'POST',
                data: {
                    action: 'yousync_clear_queue',
                    nonce: yousync.nonce
                },
                success: function(response) {
                    $button.prop('disabled', false);

                    if (response.success) {
                        YouSync.showNotice('Queue cleared successfully', 'success');
                        YouSync.refreshStatus();
                    } else {
                        YouSync.showNotice('Failed to clear queue', 'error');
                    }
                },
                error: function() {
                    $button.prop('disabled', false);
                    YouSync.showNotice('Request failed', 'error');
                }
            });
        },

        /**
         * Refresh status
         */
        refreshStatus: function(e) {
            if (e) e.preventDefault();

            $.ajax({
                url: yousync.ajaxUrl,
                method: 'POST',
                data: {
                    action: 'yousync_get_status',
                    nonce: yousync.nonce
                },
                success: function(response) {
                    if (response.success && response.data) {
                        $('#yousync-queue-count').text(response.data.queue.total);
                    }
                }
            });
        },

        /**
         * Save settings
         */
        saveSettings: function(e) {
            e.preventDefault();

            const $form = $(e.currentTarget);
            const $button = $form.find('button[type="submit"]');
            const $status = $('#yousync-settings-status');

            $button.prop('disabled', true);
            $status.html('<span class="yousync-spinner"></span> Saving...');

            const data = {
                action: 'yousync_save_settings',
                nonce: yousync.nonce,
                enabled: $form.find('input[name="enabled"]').is(':checked') ? 1 : 0,
                api_url: $form.find('input[name="api_url"]').val(),
                api_token: $form.find('input[name="api_token"]').val(),
                cron_interval: $form.find('select[name="cron_interval"]').val(),
                batch_size: $form.find('input[name="batch_size"]').val(),
                retry_hours: $form.find('input[name="retry_hours"]').val(),
                sync_orders: $form.find('input[name="sync_orders"]').is(':checked') ? 1 : 0,
                sync_products: $form.find('input[name="sync_products"]').is(':checked') ? 1 : 0,
                sync_customers: $form.find('input[name="sync_customers"]').is(':checked') ? 1 : 0,
                sync_refunds: $form.find('input[name="sync_refunds"]').is(':checked') ? 1 : 0
            };

            $.ajax({
                url: yousync.ajaxUrl,
                method: 'POST',
                data: data,
                success: function(response) {
                    $button.prop('disabled', false);

                    if (response.success) {
                        $status.html('<span class="success">Saved!</span>').addClass('success').removeClass('error');
                        setTimeout(function() {
                            $status.html('');
                        }, 3000);
                    } else {
                        $status.html('<span class="error">Error saving</span>').addClass('error').removeClass('success');
                    }
                },
                error: function() {
                    $button.prop('disabled', false);
                    $status.html('<span class="error">Request failed</span>').addClass('error').removeClass('success');
                }
            });
        },

        /**
         * Change log date
         */
        changeLogDate: function(e) {
            const date = $(e.currentTarget).val();
            window.location.href = window.location.pathname + '?page=yousync-logs&date=' + date;
        },

        /**
         * Download log file
         */
        downloadLog: function(e) {
            e.preventDefault();

            const date = $('#yousync-log-date').val();
            window.location.href = yousync.ajaxUrl + '?action=yousync_download_logs&nonce=' + yousync.nonce + '&date=' + date;
        },

        /**
         * Show notice
         */
        showNotice: function(message, type) {
            const $notice = $('<div class="notice notice-' + type + ' is-dismissible"><p>' + message + '</p></div>');

            $('.yousync-admin h1').after($notice);

            // Auto dismiss after 5 seconds
            setTimeout(function() {
                $notice.fadeOut(function() {
                    $(this).remove();
                });
            }, 5000);
        }
    };

    // Initialize on document ready
    $(document).ready(function() {
        if ($('.yousync-admin').length) {
            YouSync.init();
        }
    });

})(jQuery);
