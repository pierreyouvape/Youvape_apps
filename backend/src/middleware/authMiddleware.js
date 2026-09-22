const jwt = require('jsonwebtoken');
const pool = require('../config/database');

/*
 * Comptes encore autorisés, en cache.
 *
 * Un JWT vit 24 h (30 j avec « se souvenir de moi ») : sans ce contrôle, couper
 * l'accès d'un salarié parti ne prendrait effet qu'à l'expiration de son token,
 * et d'ici là tous les routeurs protégés par le seul JWT (stats, clients,
 * commandes…) lui resteraient ouverts.
 *
 * Le cache évite une requête par appel ; 30 s de décalage au pire sur une
 * révocation, ce qui est sans commune mesure avec 30 jours.
 */
const CACHE_TTL_MS = 30_000;
let activeUserIds = null;   // null = jamais chargé
let loadedAt = 0;
let inFlight = null;

async function refreshActiveUsers() {
  if (inFlight) return inFlight;
  inFlight = pool.query('SELECT id FROM users WHERE disabled_at IS NULL')
    .then(({ rows }) => {
      activeUserIds = new Set(rows.map((r) => r.id));
      loadedAt = Date.now();
    })
    .catch((error) => {
      // Base injoignable : on garde la photo précédente plutôt que de
      // déconnecter tout le monde. Les routes taperont la base de toute façon.
      console.error('⚠️  [Auth] Liste des comptes actifs non rafraîchie:', error.message);
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

const authMiddleware = async (req, res, next) => {
  try {
    // Récupérer le token depuis l'en-tête Authorization
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ error: 'Token manquant' });
    }

    // Le token doit être au format "Bearer TOKEN"
    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Format de token invalide' });
    }

    // Vérifier le token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Compte supprimé ou désactivé depuis l'émission du token → plus d'accès.
    if (activeUserIds === null || Date.now() - loadedAt > CACHE_TTL_MS) {
      await refreshActiveUsers();
    }
    if (activeUserIds && !activeUserIds.has(decoded.id)) {
      return res.status(401).json({ error: 'Compte désactivé ou supprimé' });
    }

    // Ajouter les informations de l'utilisateur à la requête
    req.user = decoded;

    next();
  } catch (error) {
    console.error('Erreur d\'authentification:', error);
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
};

module.exports = authMiddleware;
