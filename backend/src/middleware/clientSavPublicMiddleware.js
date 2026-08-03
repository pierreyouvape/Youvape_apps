const crypto = require('crypto');
const { getClientSavSecret } = require('../utils/clientSavSecret');

/**
 * Middleware de la surface PUBLIQUE de l'espace client SAV
 * (/api/client-sav-public), appelée en server-to-server par le plugin WordPress
 * pour le formulaire « Nous contacter » ouvert aux visiteurs non connectés.
 *
 * Différence essentielle avec clientSavMiddleware :
 *   - il n'y a PAS d'identité à résoudre (le visiteur n'a pas de compte) ;
 *   - le secret prouve seulement que l'appelant est notre WordPress côté
 *     serveur, pas un navigateur.
 *
 * C'est pourquoi cette surface est délibérément séparée et n'expose QUE de la
 * création. Aucune route de lecture ne doit jamais y être ajoutée : sans
 * wp_user_id, il n'y a rien sur quoi scoper, donc rien qu'on puisse laisser
 * lire sans exposer les données d'autrui.
 */

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

const clientSavPublicMiddleware = async (req, res, next) => {
  try {
    const expected = await getClientSavSecret();
    if (!expected) {
      console.error('❌ [Client SAV public] secret non configuré (app_config / .env)');
      return res.status(500).json({ error: 'Service non configuré' });
    }

    const provided = req.headers['x-client-sav-secret'];
    if (!provided || !safeEqual(provided, expected)) {
      console.warn('⚠️ [Client SAV public] Secret invalide');
      return res.status(401).json({ error: 'Non autorisé' });
    }

    next();
  } catch (error) {
    console.error('❌ [Client SAV public] Erreur authentification:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

module.exports = clientSavPublicMiddleware;
