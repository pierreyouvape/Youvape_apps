<?php
/**
 * Queue Manager - Gère la file d'attente des événements à synchroniser
 */

namespace YouSync;

defined('ABSPATH') || exit;

class Queue_Manager {

    private static $queue_file;

    /**
     * Initialize
     */
    public static function init() {
        self::$queue_file = YOUSYNC_UPLOAD_DIR . 'queue.json';
    }

    /**
     * Add event to queue
     */
    public static function add($type, $action, $wp_id, $data = []) {
        $queue = self::get_queue();

        // Deduplicate: if same type+wp_id exists, update it
        $found = false;
        foreach ($queue as $key => $event) {
            if ($event['type'] === $type && $event['wp_id'] === $wp_id) {
                // Keep the most recent action, merge data
                $queue[$key]['action'] = $action;
                $queue[$key]['data'] = array_merge($event['data'] ?? [], $data);
                $queue[$key]['updated_at'] = current_time('mysql');
                $queue[$key]['attempts'] = 0; // Reset attempts on update
                $found = true;
                break;
            }
        }

        if (!$found) {
            $queue[] = [
                'type' => $type,
                'action' => $action,
                'wp_id' => (int) $wp_id,
                'data' => $data,
                'created_at' => current_time('mysql'),
                'updated_at' => current_time('mysql'),
                'attempts' => 0
            ];
        }

        self::save_queue($queue);

        Logger::log('info', sprintf(
            'Event queued: %s %s #%d',
            $action,
            $type,
            $wp_id
        ));
    }

    /**
     * Get all events from queue
     */
    public static function get_queue() {
        if (!file_exists(self::$queue_file)) {
            return [];
        }

        $content = file_get_contents(self::$queue_file);
        $queue = json_decode($content, true);

        return is_array($queue) ? $queue : [];
    }

    /**
     * Save queue to file
     */
    public static function save_queue($queue) {
        file_put_contents(
            self::$queue_file,
            json_encode($queue, JSON_PRETTY_PRINT),
            LOCK_EX
        );
    }

    /**
     * Get batch of events to process
     */
    public static function get_batch($limit = 50) {
        $queue = self::get_queue();
        $settings = get_option('yousync_settings', []);
        $retry_hours = isset($settings['retry_hours']) ? intval($settings['retry_hours']) : 24;

        $batch = [];
        $now = current_time('timestamp');

        foreach ($queue as $event) {
            // Skip events older than retry_hours
            $created = strtotime($event['created_at']);
            if (($now - $created) > ($retry_hours * 3600)) {
                continue;
            }

            $batch[] = $event;

            if (count($batch) >= $limit) {
                break;
            }
        }

        return $batch;
    }

    /**
     * Remove events from queue after successful send
     */
    public static function remove_events($events) {
        $queue = self::get_queue();

        foreach ($events as $event) {
            foreach ($queue as $key => $queued) {
                if ($queued['type'] === $event['type'] && $queued['wp_id'] === $event['wp_id']) {
                    unset($queue[$key]);
                    break;
                }
            }
        }

        // Re-index array
        $queue = array_values($queue);
        self::save_queue($queue);
    }

    /**
     * Increment attempt count for failed events
     */
    public static function increment_attempts($events) {
        $queue = self::get_queue();

        foreach ($events as $event) {
            foreach ($queue as $key => $queued) {
                if ($queued['type'] === $event['type'] && $queued['wp_id'] === $event['wp_id']) {
                    $queue[$key]['attempts'] = ($queued['attempts'] ?? 0) + 1;
                    break;
                }
            }
        }

        self::save_queue($queue);
    }

    /**
     * Clear expired events (older than retry_hours)
     */
    public static function clear_expired() {
        $queue = self::get_queue();
        $settings = get_option('yousync_settings', []);
        $retry_hours = isset($settings['retry_hours']) ? intval($settings['retry_hours']) : 24;

        $now = current_time('timestamp');
        $expired_count = 0;

        foreach ($queue as $key => $event) {
            $created = strtotime($event['created_at']);
            if (($now - $created) > ($retry_hours * 3600)) {
                Logger::log('warning', sprintf(
                    'Event expired (>%dh): %s %s #%d',
                    $retry_hours,
                    $event['action'],
                    $event['type'],
                    $event['wp_id']
                ));
                unset($queue[$key]);
                $expired_count++;
            }
        }

        if ($expired_count > 0) {
            $queue = array_values($queue);
            self::save_queue($queue);
        }

        return $expired_count;
    }

    /**
     * Get queue count
     */
    public static function count() {
        return count(self::get_queue());
    }

    /**
     * Clear entire queue
     */
    public static function clear() {
        self::save_queue([]);
        Logger::log('info', 'Queue cleared manually');
    }

    /**
     * Get queue stats
     */
    public static function get_stats() {
        $queue = self::get_queue();

        $stats = [
            'total' => count($queue),
            'by_type' => [
                'order' => 0,
                'product' => 0,
                'customer' => 0,
                'refund' => 0
            ],
            'by_action' => [
                'create' => 0,
                'update' => 0,
                'delete' => 0
            ],
            'oldest' => null,
            'newest' => null
        ];

        foreach ($queue as $event) {
            if (isset($stats['by_type'][$event['type']])) {
                $stats['by_type'][$event['type']]++;
            }
            if (isset($stats['by_action'][$event['action']])) {
                $stats['by_action'][$event['action']]++;
            }

            if ($stats['oldest'] === null || $event['created_at'] < $stats['oldest']) {
                $stats['oldest'] = $event['created_at'];
            }
            if ($stats['newest'] === null || $event['created_at'] > $stats['newest']) {
                $stats['newest'] = $event['created_at'];
            }
        }

        return $stats;
    }
}
