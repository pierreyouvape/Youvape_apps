const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '../../logs');

// Crée le dossier logs s'il n'existe pas
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

/**
 * Reçoit les données clients depuis WooCommerce
 * POST /api/sync/customers
 */
const receiveCustomers = async (req, res) => {
  try {
    // Support à la fois 'data' (test) et 'batch' (WooCommerce module)
    const data = req.body.data || req.body.batch;
    const sync_type = req.body.sync_type || req.body.action;
    const timestamp = req.body.timestamp;

    if (!data || !Array.isArray(data)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid data format. Expected array in "data" or "batch" field.'
      });
    }

    // Prépare l'entrée de log
    const logEntry = {
      received_at: new Date().toISOString(),
      sync_type: sync_type || 'unknown',
      wc_timestamp: timestamp,
      count: data.length,
      data: data
    };

    // Écrit dans le fichier customers.json (append)
    const logFile = path.join(LOGS_DIR, 'customers.json');
    let existingData = [];

    if (fs.existsSync(logFile)) {
      const fileContent = fs.readFileSync(logFile, 'utf8');
      if (fileContent.trim()) {
        existingData = JSON.parse(fileContent);
      }
    }

    existingData.push(logEntry);
    fs.writeFileSync(logFile, JSON.stringify(existingData, null, 2));

    console.log(`✓ Customers received: ${data.length} items (${sync_type})`);

    res.json({
      success: true,
      message: `${data.length} customers received`,
      items_count: data.length
    });

  } catch (error) {
    console.error('Error receiving customers:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Reçoit les données produits depuis WooCommerce
 * POST /api/sync/products
 */
const receiveProducts = async (req, res) => {
  try {
    // Support à la fois 'data' (test) et 'batch' (WooCommerce module)
    const data = req.body.data || req.body.batch;
    const sync_type = req.body.sync_type || req.body.action;
    const timestamp = req.body.timestamp;

    if (!data || !Array.isArray(data)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid data format. Expected array in "data" or "batch" field.'
      });
    }

    const logEntry = {
      received_at: new Date().toISOString(),
      sync_type: sync_type || 'unknown',
      wc_timestamp: timestamp,
      count: data.length,
      data: data
    };

    const logFile = path.join(LOGS_DIR, 'products.json');
    let existingData = [];

    if (fs.existsSync(logFile)) {
      const fileContent = fs.readFileSync(logFile, 'utf8');
      if (fileContent.trim()) {
        existingData = JSON.parse(fileContent);
      }
    }

    existingData.push(logEntry);
    fs.writeFileSync(logFile, JSON.stringify(existingData, null, 2));

    console.log(`✓ Products received: ${data.length} items (${sync_type})`);

    res.json({
      success: true,
      message: `${data.length} products received`,
      items_count: data.length
    });

  } catch (error) {
    console.error('Error receiving products:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Reçoit les données commandes depuis WooCommerce
 * POST /api/sync/orders
 */
const receiveOrders = async (req, res) => {
  try {
    // Support à la fois 'data' (test) et 'batch' (WooCommerce module)
    const data = req.body.data || req.body.batch;
    const sync_type = req.body.sync_type || req.body.action;
    const timestamp = req.body.timestamp;

    if (!data || !Array.isArray(data)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid data format. Expected array in "data" or "batch" field.'
      });
    }

    const logEntry = {
      received_at: new Date().toISOString(),
      sync_type: sync_type || 'unknown',
      wc_timestamp: timestamp,
      count: data.length,
      data: data
    };

    const logFile = path.join(LOGS_DIR, 'orders.json');
    let existingData = [];

    if (fs.existsSync(logFile)) {
      const fileContent = fs.readFileSync(logFile, 'utf8');
      if (fileContent.trim()) {
        existingData = JSON.parse(fileContent);
      }
    }

    existingData.push(logEntry);
    fs.writeFileSync(logFile, JSON.stringify(existingData, null, 2));

    console.log(`✓ Orders received: ${data.length} items (${sync_type})`);

    res.json({
      success: true,
      message: `${data.length} orders received`,
      items_count: data.length
    });

  } catch (error) {
    console.error('Error receiving orders:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Télécharge les logs d'un type spécifique
 * GET /api/sync/logs/:type
 */
const downloadLogs = async (req, res) => {
  try {
    const { type } = req.params;

    if (!['customers', 'products', 'orders'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid type. Must be: customers, products, or orders'
      });
    }

    const logFile = path.join(LOGS_DIR, `${type}.json`);

    if (!fs.existsSync(logFile)) {
      return res.status(404).json({
        success: false,
        error: `No logs found for ${type}`
      });
    }

    // Envoie le fichier en téléchargement
    res.download(logFile, `${type}_logs_${Date.now()}.json`);

  } catch (error) {
    console.error('Error downloading logs:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Récupère les stats des logs (nombre d'entrées)
 * GET /api/sync/stats
 */
const getStats = async (req, res) => {
  try {
    const stats = {
      customers: 0,
      products: 0,
      orders: 0
    };

    for (const type of ['customers', 'products', 'orders']) {
      const logFile = path.join(LOGS_DIR, `${type}.json`);
      if (fs.existsSync(logFile)) {
        const fileContent = fs.readFileSync(logFile, 'utf8');
        if (fileContent.trim()) {
          const data = JSON.parse(fileContent);
          // Compte le nombre total d'items reçus
          stats[type] = data.reduce((sum, entry) => sum + (entry.count || 0), 0);
        }
      }
    }

    res.json({ success: true, stats });

  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Supprime tous les logs (pour reset)
 * DELETE /api/sync/logs
 */
const clearLogs = async (req, res) => {
  try {
    for (const type of ['customers', 'products', 'orders']) {
      const logFile = path.join(LOGS_DIR, `${type}.json`);
      if (fs.existsSync(logFile)) {
        fs.unlinkSync(logFile);
      }
    }

    console.log('✓ All logs cleared');

    res.json({
      success: true,
      message: 'All logs cleared successfully'
    });

  } catch (error) {
    console.error('Error clearing logs:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Endpoint de test de connexion (ping)
 * GET /api/sync/ping
 */
const ping = async (req, res) => {
  res.json({
    success: true,
    message: 'API is reachable',
    timestamp: new Date().toISOString()
  });
};

module.exports = {
  receiveCustomers,
  receiveProducts,
  receiveOrders,
  downloadLogs,
  getStats,
  clearLogs,
  ping
};
