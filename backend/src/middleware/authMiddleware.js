const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
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

    // Ajouter les informations de l'utilisateur à la requête
    req.user = decoded;

    next();
  } catch (error) {
    console.error('Erreur d\'authentification:', error);
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
};

module.exports = authMiddleware;
