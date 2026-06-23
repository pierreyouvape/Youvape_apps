const reportEmailModel = require('../models/reportEmailModel');
const reportEmailService = require('../services/reportEmailService');

// GET /api/reports/email-settings
exports.getSettings = async (req, res) => {
  try {
    const settings = await reportEmailModel.getSettings();
    res.json({ success: true, settings });
  } catch (error) {
    console.error('Error getting report email settings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// PUT /api/reports/email-settings
// body: { daily?: string, weekly?: string, monthly?: string }
exports.updateSettings = async (req, res) => {
  try {
    const body = req.body || {};
    for (const freq of reportEmailModel.FREQUENCIES) {
      if (typeof body[freq] === 'string') {
        await reportEmailModel.setRecipients(freq, body[freq]);
      }
    }
    const settings = await reportEmailModel.getSettings();
    res.json({ success: true, settings });
  } catch (error) {
    console.error('Error updating report email settings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// POST /api/reports/email-settings/test
// body: { frequency: 'daily'|'weekly'|'monthly', email: string }
// Envoie immédiatement le rapport de la fréquence à l'adresse fournie.
exports.sendTest = async (req, res) => {
  try {
    const { frequency, email } = req.body || {};
    if (!reportEmailModel.FREQUENCIES.includes(frequency)) {
      return res.status(400).json({ success: false, error: 'Fréquence invalide' });
    }
    const recipients = reportEmailModel.parseRecipients(email);
    if (recipients.length === 0) {
      return res.status(400).json({ success: false, error: 'Adresse email invalide' });
    }
    const result = await reportEmailService.sendReport(frequency, { recipientsOverride: recipients });
    if (!result.sent) {
      return res.status(500).json({ success: false, error: result.error || 'Échec envoi' });
    }
    res.json({ success: true, recipients });
  } catch (error) {
    console.error('Error sending test report email:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
