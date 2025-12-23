<?php
/**
 * Logger - Gestion des logs en fichiers texte
 */

namespace YouSync;

defined('ABSPATH') || exit;

class Logger {

    private static $logs_dir;

    /**
     * Initialize
     */
    public static function init() {
        self::$logs_dir = YOUSYNC_UPLOAD_DIR . 'logs/';
    }

    /**
     * Log a message
     *
     * @param string $level info|warning|error|success
     * @param string $message
     */
    public static function log($level, $message) {
        $date = current_time('Y-m-d');
        $time = current_time('H:i:s');
        $file = self::$logs_dir . 'sync-' . $date . '.log';

        $line = sprintf(
            "[%s] [%s] %s\n",
            $time,
            strtoupper($level),
            $message
        );

        file_put_contents($file, $line, FILE_APPEND | LOCK_EX);
    }

    /**
     * Log info message
     */
    public static function info($message) {
        self::log('info', $message);
    }

    /**
     * Log warning message
     */
    public static function warning($message) {
        self::log('warning', $message);
    }

    /**
     * Log error message
     */
    public static function error($message) {
        self::log('error', $message);
    }

    /**
     * Log success message
     */
    public static function success($message) {
        self::log('success', $message);
    }

    /**
     * Get logs for a specific date
     *
     * @param string $date YYYY-MM-DD format
     * @return array
     */
    public static function get_logs($date = null) {
        if ($date === null) {
            $date = current_time('Y-m-d');
        }

        $file = self::$logs_dir . 'sync-' . $date . '.log';

        if (!file_exists($file)) {
            return [];
        }

        $content = file_get_contents($file);
        $lines = explode("\n", trim($content));

        $logs = [];
        foreach ($lines as $line) {
            if (empty($line)) continue;

            // Parse log line: [HH:MM:SS] [LEVEL] Message
            if (preg_match('/^\[(\d{2}:\d{2}:\d{2})\] \[(\w+)\] (.+)$/', $line, $matches)) {
                $logs[] = [
                    'time' => $matches[1],
                    'level' => strtolower($matches[2]),
                    'message' => $matches[3]
                ];
            }
        }

        return $logs;
    }

    /**
     * Get recent logs (last N entries)
     *
     * @param int $limit
     * @return array
     */
    public static function get_recent($limit = 50) {
        $logs = self::get_logs();
        return array_slice(array_reverse($logs), 0, $limit);
    }

    /**
     * Get available log files
     *
     * @return array
     */
    public static function get_log_files() {
        $files = glob(self::$logs_dir . 'sync-*.log');
        $result = [];

        foreach ($files as $file) {
            $filename = basename($file);
            if (preg_match('/sync-(\d{4}-\d{2}-\d{2})\.log/', $filename, $matches)) {
                $result[] = [
                    'date' => $matches[1],
                    'filename' => $filename,
                    'size' => filesize($file),
                    'path' => $file
                ];
            }
        }

        // Sort by date descending
        usort($result, function($a, $b) {
            return strcmp($b['date'], $a['date']);
        });

        return $result;
    }

    /**
     * Get log file content for download
     *
     * @param string $date
     * @return string|false
     */
    public static function get_file_content($date) {
        $file = self::$logs_dir . 'sync-' . $date . '.log';

        if (!file_exists($file)) {
            return false;
        }

        return file_get_contents($file);
    }

    /**
     * Cleanup old log files (older than X days)
     *
     * @param int $days
     * @return int Number of files deleted
     */
    public static function cleanup_old_logs($days = 30) {
        $files = glob(self::$logs_dir . 'sync-*.log');
        $deleted = 0;
        $cutoff = strtotime("-{$days} days");

        foreach ($files as $file) {
            $filename = basename($file);
            if (preg_match('/sync-(\d{4}-\d{2}-\d{2})\.log/', $filename, $matches)) {
                $file_date = strtotime($matches[1]);
                if ($file_date < $cutoff) {
                    unlink($file);
                    $deleted++;
                }
            }
        }

        if ($deleted > 0) {
            self::info(sprintf('Cleaned up %d old log file(s)', $deleted));
        }

        return $deleted;
    }

    /**
     * Get logs directory size
     *
     * @return int Size in bytes
     */
    public static function get_logs_size() {
        $size = 0;
        $files = glob(self::$logs_dir . '*.log');

        foreach ($files as $file) {
            $size += filesize($file);
        }

        return $size;
    }

    /**
     * Format bytes to human readable
     *
     * @param int $bytes
     * @return string
     */
    public static function format_bytes($bytes) {
        $units = ['B', 'KB', 'MB', 'GB'];
        $i = 0;

        while ($bytes >= 1024 && $i < count($units) - 1) {
            $bytes /= 1024;
            $i++;
        }

        return round($bytes, 2) . ' ' . $units[$i];
    }
}
