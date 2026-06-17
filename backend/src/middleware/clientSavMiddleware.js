const crypto = require('crypto');
const pool = require('../config/database');
const { getClientSavSecret } = require('../utils/clientSavSecret');

/**
 * Middleware d'authentification pour la surface API "espace client SAV"
 * (/api/client-sav), appelée en server-to-server par le plugin WordPress
 * `youvape-sav-client`.
 *
 * Modèle de confiance :
 *  - Le secret partagé (CLIENT_SAV_SECRET) prouve que l'appelant est bien notre
 *    plugin WordPress côté serveur, et PAS un navigateur. Le secret ne transite
 *    jamais par le navigateur du client.
 *  - Le wp_user_id est fourni par le plugin à partir de get_current_user_id()
 *    côté PHP (session WordPress), jamais d'un champ POST contrôlable par le
 *    client. Comme le canal est authentifié par le secret, on peut faire
 *    confiance à ce wp_user_id.
 *  - On résout ici l'identité interne (customers.id) à partir du wp_user_id et
 *    on la pose sur req.clientCustomerId / req.clientWpUserId. Les contrôleurs
 *    DOIVENT scoper toutes leurs requêtes sur ces valeurs (jamais sur un id
 *    venu du corps de la requête).
 *
 * Le wp_user_id est lu dans l'en-tête `x-wp-user-id` (préféré) ou, à défaut,
 * dans le corps (req.body.wp_user_id) pour les POST.
 */

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  // timingSafeEqual exige des buffers de même longueur : on compare d'abord la
  // longueur (information non sensible) puis le contenu en temps constant.
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

const clientSavMiddleware = async (req, res, next) => {
  try {
    // Secret lu depuis app_config (configurable via l'onglet DANGER), repli .env.
    const expected = await getClientSavSecret();
    if (!expected) {
      console.error('❌ [Client SAV] secret non configuré (app_config / .env)');
      return res.status(500).json({ error: 'Service non configuré' });
    }

    // 1. Secret partagé (prouve que l'appelant est le plugin WP côté serveur)
    const provided = req.headers['x-client-sav-secret'];
    if (!provided || !safeEqual(provided, expected)) {
      console.warn('⚠️ [Client SAV] Secret invalide');
      return res.status(401).json({ error: 'Non autorisé' });
    }

    // 2. Identité du client : wp_user_id issu de la session WordPress côté PHP
    const rawWpUserId = req.headers['x-wp-user-id'] ?? req.body?.wp_user_id;
    const wpUserId = parseInt(rawWpUserId, 10);
    if (!Number.isInteger(wpUserId) || wpUserId <= 0) {
      return res.status(400).json({ error: 'wp_user_id manquant ou invalide' });
    }

    // 3. Résolution de l'identité interne (customers.id) — clé de scoping
    const result = await pool.query(
      'SELECT id, wp_user_id, email FROM customers WHERE wp_user_id = $1 LIMIT 1',
      [wpUserId]
    );
    if (result.rows.length === 0) {
      // Compte WordPress sans fiche client interne : aucun ticket à exposer.
      return res.status(404).json({ error: 'Client introuvable' });
    }

    const customer = result.rows[0];
    req.clientCustomerId = customer.id;       // customers.id (clé interne de scoping)
    req.clientWpUserId   = customer.wp_user_id; // wp_user_id (commandes)
    req.clientEmail      = customer.email || null;

    next();
  } catch (error) {
    console.error('❌ [Client SAV] Erreur authentification:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

module.exports = clientSavMiddleware;
