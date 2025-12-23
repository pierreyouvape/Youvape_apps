<?php
/**
 * Sync Sender - Envoie les événements au VPS
 */

namespace YouSync;

defined('ABSPATH') || exit;

class Sync_Sender {

    /**
     * Process queue and send to VPS
     */
    public static function process_queue() {
        $settings = get_option('yousync_settings', []);

        if (empty($settings['api_url']) || empty($settings['api_token'])) {
            Logger::error('API URL or token not configured');
            return false;
        }

        // Clear expired events first
        Queue_Manager::clear_expired();

        // Get batch
        $batch_size = isset($settings['batch_size']) ? intval($settings['batch_size']) : 50;
        $events = Queue_Manager::get_batch($batch_size);

        if (empty($events)) {
            return true; // Nothing to process
        }

        Logger::info(sprintf('Processing %d events from queue', count($events)));

        // Send to VPS
        $result = self::send_events($events);

        if ($result['success']) {
            // Remove successful events from queue
            Queue_Manager::remove_events($events);
            Logger::success(sprintf('Successfully sent %d events to VPS', count($events)));

            // Update last sync time
            update_option('yousync_last_sync', [
                'time' => current_time('mysql'),
                'count' => count($events),
                'success' => true
            ]);

            return true;
        } else {
            // Increment attempts for failed events
            Queue_Manager::increment_attempts($events);
            Logger::error(sprintf('Failed to send events: %s', $result['error']));

            // Update last sync time
            update_option('yousync_last_sync', [
                'time' => current_time('mysql'),
                'count' => count($events),
                'success' => false,
                'error' => $result['error']
            ]);

            return false;
        }
    }

    /**
     * Send events to VPS
     *
     * @param array $events
     * @return array ['success' => bool, 'error' => string|null, 'response' => array|null]
     */
    public static function send_events($events) {
        $settings = get_option('yousync_settings', []);

        $payload = [
            'token' => $settings['api_token'],
            'events' => array_map(function($event) {
                return [
                    'type' => $event['type'],
                    'action' => $event['action'],
                    'wp_id' => $event['wp_id'],
                    'data' => $event['data']
                ];
            }, $events),
            'timestamp' => current_time('c'),
            'source' => 'yousync'
        ];

        $response = wp_remote_post($settings['api_url'], [
            'method' => 'POST',
            'timeout' => 30,
            'headers' => [
                'Content-Type' => 'application/json',
                'X-YouSync-Token' => $settings['api_token']
            ],
            'body' => json_encode($payload)
        ]);

        if (is_wp_error($response)) {
            return [
                'success' => false,
                'error' => $response->get_error_message(),
                'response' => null
            ];
        }

        $code = wp_remote_retrieve_response_code($response);
        $body = wp_remote_retrieve_body($response);
        $data = json_decode($body, true);

        if ($code >= 200 && $code < 300) {
            return [
                'success' => true,
                'error' => null,
                'response' => $data
            ];
        } else {
            $error_message = isset($data['error']) ? $data['error'] : "HTTP {$code}";
            return [
                'success' => false,
                'error' => $error_message,
                'response' => $data
            ];
        }
    }

    /**
     * Test connection to VPS
     *
     * @return array
     */
    public static function test_connection() {
        $settings = get_option('yousync_settings', []);

        if (empty($settings['api_url']) || empty($settings['api_token'])) {
            return [
                'success' => false,
                'error' => 'API URL or token not configured'
            ];
        }

        // Try to reach the health endpoint
        $health_url = rtrim($settings['api_url'], '/');
        $health_url = preg_replace('/\/webhook.*$/', '/health', $health_url);

        $response = wp_remote_get($health_url, [
            'timeout' => 10,
            'headers' => [
                'X-YouSync-Token' => $settings['api_token']
            ]
        ]);

        if (is_wp_error($response)) {
            return [
                'success' => false,
                'error' => $response->get_error_message()
            ];
        }

        $code = wp_remote_retrieve_response_code($response);

        if ($code >= 200 && $code < 300) {
            return [
                'success' => true,
                'message' => 'Connection successful'
            ];
        } else {
            return [
                'success' => false,
                'error' => "HTTP {$code}"
            ];
        }
    }

    /**
     * Force send queue now (manual trigger)
     *
     * @return array
     */
    public static function force_send() {
        $settings = get_option('yousync_settings', []);

        if (empty($settings['api_url']) || empty($settings['api_token'])) {
            return [
                'success' => false,
                'error' => 'API not configured'
            ];
        }

        $count = Queue_Manager::count();
        if ($count === 0) {
            return [
                'success' => true,
                'message' => 'Queue is empty',
                'count' => 0
            ];
        }

        Logger::info('Force send triggered manually');

        $success = self::process_queue();

        return [
            'success' => $success,
            'message' => $success ? 'Events sent successfully' : 'Failed to send events',
            'count' => $count
        ];
    }
}
