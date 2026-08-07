<?php
/**
 * Relais des pièces jointes SAV.
 *
 * Les fichiers sont stockés côté application Node et servis par
 * `apps.youvape.fr/api/sav/attachments/…`. Cette adresse ne doit JAMAIS
 * apparaître dans le navigateur d'un client : ni dans un `src`, ni dans un lien,
 * ni dans le code source de la page.
 *
 * Le fichier est donc récupéré par WordPress en server-to-server (avec le secret
 * partagé) puis renvoyé au navigateur depuis le domaine de la boutique. Le
 * client ne voit qu'une URL en `vps.youvape.fr` / `youvape.fr`.
 *
 * Contrôle d'accès : le visiteur doit être connecté ET le ticket demandé doit
 * lui appartenir — ce que l'API vérifie déjà, puisque `get_ticket()` est scopé
 * sur le `wp_user_id` de la session. Un ticket qui n'est pas le sien renvoie une
 * erreur, donc aucun fichier n'est servi. On vérifie en plus que le fichier
 * demandé fait bien partie de CE ticket, pour qu'un identifiant deviné ne donne
 * pas accès à autre chose.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Youvape_SAV_Attachment_Proxy {

    /** Paramètre d'URL déclenchant le relais. */
    const QUERY_FLAG = 'youvape_sav_file';

    /** @var Youvape_SAV_Attachment_Proxy */
    private static $instance = null;

    public static function instance() {
        if (null === self::$instance) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function register() {
        add_action('template_redirect', array($this, 'maybe_serve'), 0);
    }

    /**
     * URL publique d'une pièce jointe, servie par la boutique.
     *
     * Deux identifiants de ticket, et ce n'est pas un doublon :
     *   - `t` : le ticket AFFICHÉ, celui dont on vérifie qu'il appartient au
     *           visiteur ;
     *   - `p` : le ticket sous lequel le fichier est physiquement rangé.
     *
     * Les deux diffèrent dès qu'un agent réutilise une image d'une autre
     * demande dans sa réponse — cas courant d'un message type. Vérifier
     * l'appartenance de `p` reviendrait à exiger du client qu'il possède la
     * demande d'un autre : le refus serait systématique.
     *
     * @param int    $view_ticket_id ticket consulté (contrôle d'accès)
     * @param int    $path_ticket_id ticket de rangement du fichier
     * @param string $filename
     * @return string
     */
    public static function url($view_ticket_id, $path_ticket_id, $filename) {
        return add_query_arg(
            array(
                self::QUERY_FLAG => 1,
                't'              => absint($view_ticket_id),
                'p'              => absint($path_ticket_id),
                'f'              => rawurlencode($filename),
            ),
            home_url('/')
        );
    }

    /**
     * Extrait le nom de fichier d'une URL de pièce jointe de l'API.
     * Accepte l'URL absolue comme le chemin relatif.
     *
     * @param string $url
     * @return array{0:int,1:string}|null [ticket_id, filename] ou null
     */
    public static function parse_api_url($url) {
        if (!is_string($url) || $url === '') {
            return null;
        }
        if (!preg_match('#/api/sav/attachments/(\d+)/([^"\'\s?\#/]+)#', $url, $m)) {
            return null;
        }
        return array((int) $m[1], rawurldecode($m[2]));
    }

    /**
     * Réécrit toutes les URLs de pièces jointes d'un HTML vers le relais.
     * Utilisé sur le corps des messages, où l'agent peut avoir inséré des images.
     *
     * @param string $html
     * @param int    $view_ticket_id ticket dans lequel ce HTML est affiché
     * @return string
     */
    public static function rewrite_html($html, $view_ticket_id) {
        if (!is_string($html) || $html === '') {
            return (string) $html;
        }
        $view_ticket_id = absint($view_ticket_id);
        return preg_replace_callback(
            '#https?://[^"\'\s]*?/api/sav/attachments/(\d+)/([^"\'\s?\#/]+)#i',
            function ($m) use ($view_ticket_id) {
                return esc_url_raw(self::url($view_ticket_id, (int) $m[1], rawurldecode($m[2])));
            },
            $html
        );
    }

    /**
     * Sert le fichier si la requête courante est une demande de relais.
     */
    public function maybe_serve() {
        if (empty($_GET[self::QUERY_FLAG])) {
            return;
        }

        $view_ticket_id = isset($_GET['t']) ? absint($_GET['t']) : 0;
        // Ticket de rangement du fichier ; identique au ticket affiché dans le
        // cas courant, différent quand l'agent réutilise une image d'une autre
        // demande.
        $path_ticket_id = isset($_GET['p']) ? absint($_GET['p']) : $view_ticket_id;
        $filename  = isset($_GET['f']) ? wp_unslash($_GET['f']) : '';
        // Pas de séparateur de chemin : on ne sert que des fichiers du ticket.
        $filename  = str_replace(array('/', '\\', "\0"), '', $filename);

        if (!$view_ticket_id || !$path_ticket_id || $filename === '' || !is_user_logged_in()) {
            $this->deny();
        }

        // Appartenance : l'API ne renvoie le ticket que s'il est au client
        // connecté. On contrôle le ticket AFFICHÉ — c'est lui que le visiteur a
        // le droit de voir.
        $ticket = Youvape_SAV_Api_Client::get_ticket($view_ticket_id);
        if (is_wp_error($ticket) || empty($ticket)) {
            $this->deny();
        }

        // Le fichier doit être cité dans CE ticket (pièce jointe d'un message ou
        // image insérée dans un corps) : un nom deviné ne suffit pas, et on ne
        // peut pas aspirer un fichier d'une autre demande. C'est ce contrôle,
        // et non le chemin de rangement, qui borne réellement l'accès.
        if (!$this->ticket_references_file($ticket, $filename)) {
            $this->deny();
        }

        $file = Youvape_SAV_Api_Client::fetch_attachment($path_ticket_id, $filename);
        if (is_wp_error($file) || empty($file['body'])) {
            $this->deny(404);
        }

        nocache_headers();
        header('Content-Type: ' . $file['content_type']);
        header('Content-Length: ' . strlen($file['body']));
        // Affichage en ligne, jamais téléchargement automatique.
        header('Content-Disposition: inline; filename="' . rawurlencode($filename) . '"');
        header('X-Content-Type-Options: nosniff');
        // Cache privé : la pièce jointe ne doit pas être mise en cache par un
        // intermédiaire partagé (CDN, proxy d'entreprise).
        header('Cache-Control: private, max-age=600');
        echo $file['body']; // phpcs:ignore WordPress.Security.EscapeOutput
        exit;
    }

    /**
     * Le fichier est-il référencé par ce ticket ?
     *
     * @param array  $ticket
     * @param string $filename
     * @return bool
     */
    private function ticket_references_file($ticket, $filename) {
        $messages = isset($ticket['messages']) && is_array($ticket['messages'])
            ? $ticket['messages'] : array();

        foreach ($messages as $message) {
            // Pièces jointes déclarées
            $attachments = isset($message['attachments']) && is_array($message['attachments'])
                ? $message['attachments'] : array();
            foreach ($attachments as $att) {
                $url = isset($att['url']) ? (string) $att['url'] : '';
                if ($url !== '' && false !== strpos($url, $filename)) {
                    return true;
                }
            }
            // Images insérées dans le corps du message
            $body = isset($message['body']) ? (string) $message['body'] : '';
            if ($body !== '' && false !== strpos($body, $filename)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Refus silencieux : pas de message qui révélerait l'existence du fichier.
     *
     * @param int $code
     */
    private function deny($code = 403) {
        status_header($code);
        nocache_headers();
        exit;
    }
}
