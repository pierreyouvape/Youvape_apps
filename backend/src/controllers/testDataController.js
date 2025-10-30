const testDataService = require('../services/testDataService');
const syncController = require('./syncController');

/**
 * Génère des données de test et les importe
 * POST /api/test/generate
 */
const generateTestData = async (req, res) => {
  try {
    const { customers = 0, products = 0, orders = 0 } = req.body;

    // Valide les entrées
    if (customers < 0 || customers > 100 || products < 0 || products > 100 || orders < 0 || orders > 100) {
      return res.status(400).json({
        success: false,
        error: 'Les quantités doivent être entre 0 et 100'
      });
    }

    if (customers === 0 && products === 0 && orders === 0) {
      return res.status(400).json({
        success: false,
        error: 'Veuillez spécifier au moins un type de données à générer'
      });
    }

    // Génère les données de test
    const testData = await testDataService.generateTestData({
      customers,
      products,
      orders
    });

    // Importe les données générées dans la base de données
    const importResults = {
      customers: { inserted: 0, updated: 0 },
      products: { inserted: 0, updated: 0 },
      orders: { inserted: 0, updated: 0 }
    };

    // Import des clients
    if (testData.customers && Array.isArray(testData.customers)) {
      const customersReq = {
        body: {
          data: testData.customers,
          sync_type: 'test_data',
          timestamp: new Date().toISOString()
        }
      };

      const customersRes = {
        json: (data) => {
          if (data.success) {
            importResults.customers.inserted = data.inserted || 0;
            importResults.customers.updated = data.updated || 0;
          }
        },
        status: () => ({ json: () => {} })
      };

      await syncController.receiveCustomers(customersReq, customersRes);
    }

    // Import des produits
    if (testData.products && Array.isArray(testData.products)) {
      const productsReq = {
        body: {
          data: testData.products,
          sync_type: 'test_data',
          timestamp: new Date().toISOString()
        }
      };

      const productsRes = {
        json: (data) => {
          if (data.success) {
            importResults.products.inserted = data.inserted || 0;
            importResults.products.updated = data.updated || 0;
          }
        },
        status: () => ({ json: () => {} })
      };

      await syncController.receiveProducts(productsReq, productsRes);
    }

    // Import des commandes
    if (testData.orders && Array.isArray(testData.orders)) {
      const ordersReq = {
        body: {
          data: testData.orders,
          sync_type: 'test_data',
          timestamp: new Date().toISOString()
        }
      };

      const ordersRes = {
        json: (data) => {
          if (data.success) {
            importResults.orders.inserted = data.inserted || 0;
            importResults.orders.updated = data.updated || 0;
          }
        },
        status: () => ({ json: () => {} })
      };

      await syncController.receiveOrders(ordersReq, ordersRes);
    }

    console.log(`✓ Test data generated and imported: ${customers} customers, ${products} products, ${orders} orders`);

    res.json({
      success: true,
      message: 'Données de test générées et importées avec succès',
      counts: {
        customers: testData.customers ? testData.customers.length : 0,
        products: testData.products ? testData.products.length : 0,
        orders: testData.orders ? (testData.orders.error ? 0 : testData.orders.length) : 0
      },
      import_results: importResults,
      offsets: {
        previous: testData.offsets_used,
        new: testData.new_offsets
      },
      errors: {
        orders: testData.orders?.error || null
      }
    });

  } catch (error) {
    console.error('Error generating test data:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Récupère les offsets actuels
 * GET /api/test/offsets
 */
const getOffsets = async (req, res) => {
  try {
    const offsets = await testDataService.getOffsets();

    res.json({
      success: true,
      offsets: offsets
    });

  } catch (error) {
    console.error('Error getting offsets:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Reset tous les offsets à 0
 * DELETE /api/test/offsets
 */
const resetOffsets = async (req, res) => {
  try {
    await testDataService.resetOffsets();

    console.log('✓ Test data offsets reset to 0');

    res.json({
      success: true,
      message: 'Offsets de test réinitialisés à 0'
    });

  } catch (error) {
    console.error('Error resetting offsets:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Supprime toutes les données de test
 * DELETE /api/test/data
 */
const deleteAllTestData = async (req, res) => {
  try {
    const pool = require('../config/database');

    // Supprime toutes les données (attention, ceci supprime TOUTES les données!)
    // On pourrait ajouter un flag "is_test" dans les tables pour ne supprimer que les données de test
    await pool.query('DELETE FROM order_coupons');
    await pool.query('DELETE FROM order_items');
    await pool.query('DELETE FROM orders');
    await pool.query('DELETE FROM products');
    await pool.query('DELETE FROM customers');

    // Reset les offsets
    await testDataService.resetOffsets();

    console.log('✓ All test data deleted and offsets reset');

    res.json({
      success: true,
      message: 'Toutes les données de test ont été supprimées et les offsets réinitialisés'
    });

  } catch (error) {
    console.error('Error deleting test data:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

module.exports = {
  generateTestData,
  getOffsets,
  resetOffsets,
  deleteAllTestData
};
