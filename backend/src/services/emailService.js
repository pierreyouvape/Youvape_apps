const axios = require('axios');
const pool = require('../config/database');
const emailConfigModel = require('../models/emailConfigModel');
const emailSentTrackingModel = require('../models/emailSentTrackingModel');
const { sendAlert } = require('./alertService');

// Anti-spam: alerte une seule fois tant que l'API Probance est down
let emailApiAlerted = false;

const emailService = {
  // Fonction principale pour traiter les emails à envoyer
  processEmails: async () => {
    try {
      console.log('📧 Démarrage du processus d\'envoi d\'emails...');

      // Récupérer la configuration
      const config = await emailConfigModel.get();

      if (!config) {
        console.log('⚠️ Aucune configuration d\'email trouvée');
        return { processed: 0, sent: 0, errors: 0 };
      }

      if (!config.enabled) {
        console.log('⏸️ Système d\'emails désactivé');
        return { processed: 0, sent: 0, errors: 0 };
      }

      // Récupérer les commandes éligibles (avis récompensés dont la commande n'a pas encore reçu d'email)
      const query = `
        SELECT r.order_id, r.customer_email, COUNT(*) as reviews_count, MIN(r.rewarded_at) as first_rewarded
        FROM reviews r
        WHERE r.rewarded = true
          AND r.order_id IS NOT NULL
          AND r.order_id != ''
          AND r.customer_email IS NOT NULL
          AND r.customer_email != ''
          AND NOT EXISTS (
            SELECT 1 FROM email_sent_tracking est
            WHERE est.order_id = r.order_id
          )
        GROUP BY r.order_id, r.customer_email
        ORDER BY MIN(r.rewarded_at) ASC
      `;

      const result = await pool.query(query);
      const eligibleOrders = result.rows;

      console.log(`📊 ${eligibleOrders.length} commandes éligibles pour l'envoi d'email`);

      let processed = 0;
      let sent = 0;
      let errors = 0;

      for (const order of eligibleOrders) {
        processed++;

        // Double check: Vérifier que l'email n'a pas déjà été envoyé
        const alreadySent = await emailSentTrackingModel.exists(order.order_id);

        if (alreadySent) {
          console.log(`⚠️ Email déjà envoyé pour la commande ${order.order_id}, on passe au suivant`);
          continue;
        }

        // Envoyer l'email via l'API Probance
        const emailResult = await emailService.sendEmail(
          config,
          order.customer_email,
          order.order_id,
          order.reviews_count
        );

        if (emailResult.success) {
          sent++;
          emailApiAlerted = false; // API OK — reset flag
          console.log(`✅ Email envoyé avec succès pour la commande ${order.order_id} (${order.reviews_count} avis récompensés)`);
        } else {
          errors++;
          console.log(`❌ Échec de l'envoi pour la commande ${order.order_id}: ${emailResult.error}`);
        }
      }

      // Alerter si des erreurs (une seule fois tant que l'API est down)
      if (errors > 0 && !emailApiAlerted) {
        emailApiAlerted = true;
        sendAlert(
          `Emails Probance: ${errors} echec(s) sur ${processed} commandes`,
          `Le processus d'envoi d'emails automatique a rencontre des erreurs.\n\n${errors} email(s) n'ont pas pu etre envoyes sur ${processed} traites.\n\nVerifiez que l'API Probance est accessible et que le token est valide.`
        );
      }

      console.log(`📧 Processus terminé: ${processed} traités, ${sent} envoyés, ${errors} erreurs`);

      return { processed, sent, errors };

    } catch (error) {
      console.error('❌ Erreur dans processEmails:', error);
      sendAlert(
        `Emails Probance: erreur fatale`,
        `Erreur inattendue dans le processus d'envoi d'emails automatique.\n\nErreur: ${error.message}`
      );
      return { processed: 0, sent: 0, errors: 1, error: error.message };
    }
  },

  // Fonction pour envoyer un email via l'API Probance
  sendEmail: async (config, email, order_id, reviews_count) => {
    try {
      // Construire l'URL de l'API avec le token
      const apiUrl = `${config.probance_url}?token=${config.probance_token}`;

      // Préparer le body selon le format Probance
      const requestBody = {
        campaign_external_id: config.campaign_external_id,
        recipients: [
          {
            contact_id: "email",
            email: email
          }
        ]
      };

      // Appel API
      const response = await axios.post(apiUrl, requestBody, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });

      // Enregistrer dans le tracking
      await emailSentTrackingModel.create({
        order_id: order_id,
        customer_email: email,
        reviews_count: reviews_count
      });

      return {
        success: true,
        status: response.status,
        data: response.data
      };

    } catch (error) {
      console.error('Erreur lors de l\'envoi d\'email:', error.message);

      return {
        success: false,
        error: error.message,
        details: error.response?.data
      };
    }
  },

  // Tester la connexion à l'API Probance
  testConnection: async (config, testEmail) => {
    try {
      // Construire l'URL de l'API avec le token
      const apiUrl = `${config.probance_url}?token=${config.probance_token}`;

      // Préparer le body de test
      const requestBody = {
        campaign_external_id: config.campaign_external_id,
        recipients: [
          {
            contact_id: "email",
            email: testEmail
          }
        ]
      };

      // Appel API
      const response = await axios.post(apiUrl, requestBody, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });

      return {
        success: true,
        status: response.status,
        message: `Email de test envoyé avec succès à ${testEmail}`,
        data: response.data
      };

    } catch (error) {
      const status = error.response?.status;
      const errorData = error.response?.data;

      return {
        success: false,
        status: status,
        error: status === 401 ? 'Token invalide - Vérifiez votre token Probance' :
               status === 404 ? 'URL API introuvable - Vérifiez l\'URL Probance' :
               status === 400 ? 'Paramètres invalides - Vérifiez campaign_external_id' :
               error.message,
        details: errorData
      };
    }
  }
};

module.exports = emailService;
