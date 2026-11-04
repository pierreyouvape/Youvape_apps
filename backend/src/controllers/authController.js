const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { secondsUntilPdaCutoff } = require('../utils/pdaSession');
const { normalizeBadge, createFailureLimiter } = require('../utils/badgeLogin');
const pool = require('../config/database');

const badgeFailures = createFailureLimiter();

const authController = {
  // Inscription
  register: async (req, res) => {
    try {
      const { email, password, name } = req.body;

      // Validation
      if (!email || !password || !name) {
        return res.status(400).json({ error: 'Nom, email et mot de passe requis' });
      }

      if (password.length < 6) {
        return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
      }

      // Vérifier si l'email existe déjà
      const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      if (existingUser.rows.length > 0) {
        return res.status(409).json({ error: 'Cet email est déjà utilisé' });
      }

      // Hasher le mot de passe
      const hashedPassword = await bcrypt.hash(password, 10);

      // Insérer l'utilisateur
      const result = await pool.query(
        'INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING id, email, name, created_at',
        [email, hashedPassword, name]
      );

      res.status(201).json({
        message: 'Utilisateur créé avec succès',
        user: result.rows[0]
      });

    } catch (error) {
      console.error('Erreur lors de l\'inscription:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Connexion
  login: async (req, res) => {
    try {
      const { email, password } = req.body;

      // Validation
      if (!email || !password) {
        return res.status(400).json({ error: 'Email et mot de passe requis' });
      }

      // Récupérer l'utilisateur
      const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      
      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
      }

      const user = result.rows[0];

      // Vérifier le mot de passe
      const validPassword = await bcrypt.compare(password, user.password);
      
      if (!validPassword) {
        return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
      }

      // Compte désactivé (départ d'un salarié, cf. app Gestion employé) : la
      // ligne est conservée pour l'historique, mais elle n'ouvre plus l'app.
      if (user.disabled_at) {
        return res.status(403).json({ error: 'Ce compte est désactivé' });
      }

      // Générer le token JWT. Depuis un PDA ou un poste de préparation, la
      // session se ferme ce soir 19h30 (ils changent de mains) ; ailleurs,
      // durée habituelle.
      const { rememberMe, device } = req.body;
      const expiresIn = device === 'pda' || device === 'station'
        ? secondsUntilPdaCutoff()
        : (rememberMe ? '30d' : '24h');
      const token = jwt.sign(
        { id: user.id, email: user.email, name: user.name },
        process.env.JWT_SECRET,
        { expiresIn }
      );

      res.json({
        message: 'Connexion réussie',
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name
        }
      });

    } catch (error) {
      console.error('Erreur lors de la connexion:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Connexion du PDA par le badge employé (Gestion employé → Code barre).
  // Toujours une session PDA : fermée ce soir 19h30, quel que soit l'appareil.
  badgeLogin: async (req, res) => {
    const ip = req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.ip || 'inconnue';
    try {
      if (badgeFailures.isBlocked(ip)) {
        return res.status(429).json({ error: 'Trop d\'essais, réessayez dans quelques minutes ou connectez-vous par identifiant' });
      }

      const badge = normalizeBadge(req.body?.barcode);
      if (!badge) {
        badgeFailures.recordFailure(ip);
        return res.status(400).json({ error: 'Ce code n\'est pas un badge employé' });
      }

      const { rows } = await pool.query(
        `SELECT e.active AS employee_active, u.id, u.email, u.name, u.disabled_at
           FROM employees e
           LEFT JOIN users u ON u.id = e.user_id
          WHERE e.barcode = $1`,
        [badge]
      );
      const row = rows[0];
      if (!row) {
        badgeFailures.recordFailure(ip);
        return res.status(401).json({ error: 'Badge inconnu' });
      }
      if (!row.employee_active || row.disabled_at) {
        badgeFailures.recordFailure(ip);
        return res.status(403).json({ error: 'Ce compte est désactivé' });
      }
      if (!row.id) {
        badgeFailures.recordFailure(ip);
        return res.status(403).json({ error: 'Badge sans compte : le relier à un compte dans Gestion employé' });
      }

      const token = jwt.sign(
        { id: row.id, email: row.email, name: row.name },
        process.env.JWT_SECRET,
        { expiresIn: secondsUntilPdaCutoff() }
      );
      res.json({
        message: 'Connexion réussie',
        token,
        user: { id: row.id, email: row.email, name: row.name }
      });
    } catch (error) {
      console.error('Erreur lors de la connexion par badge:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
};

module.exports = authController;