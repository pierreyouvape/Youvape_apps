/**
 * BMS API Model - BoostMyShop myFulfillment API
 * Documentation: https://fr3.myfulfillment.boostmyshop.com/swagger/
 */

const BMS_API_URL = 'https://fr3.myfulfillment.boostmyshop.com/api';
const BMS_USERNAME = process.env.BMS_USERNAME || 'pierre.youvape@gmail.com';
const BMS_PASSWORD = process.env.BMS_PASSWORD || 'pedrito723@';

let cachedToken = null;
let tokenExpiry = null;

const bmsApiModel = {
  /**
   * Obtenir un token d'authentification BMS
   * Le token est mis en cache pour éviter les appels répétés
   */
  getToken: async () => {
    // Vérifier si on a un token valide en cache (expire après 1h par sécurité)
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
      return cachedToken;
    }

    const response = await fetch(`${BMS_API_URL}/auth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: BMS_USERNAME,
        password: BMS_PASSWORD
      })
    });

    if (!response.ok) {
      throw new Error(`BMS Auth failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    cachedToken = data.token;
    tokenExpiry = Date.now() + (60 * 60 * 1000); // 1 heure

    return cachedToken;
  },

  /**
   * Faire un appel API authentifié à BMS
   */
  apiCall: async (endpoint, method = 'GET', body = null) => {
    const token = await bmsApiModel.getToken();

    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${BMS_API_URL}${endpoint}`, options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`BMS API error: ${response.status} - ${errorText}`);
    }

    return response.json();
  },

  // ==================== FOURNISSEURS ====================

  /**
   * Récupérer tous les fournisseurs depuis BMS
   */
  getSuppliers: async () => {
    const data = await bmsApiModel.apiCall('/supplier/suppliers');
    return data.data || [];
  },

  // ==================== BONS DE COMMANDE ====================

  /**
   * Récupérer les bons de commande depuis BMS (toutes les pages)
   * L'API retourne toujours 100 entrées même sur la dernière page (boucle),
   * donc on se base uniquement sur meta.total pour stopper.
   */
  getPurchaseOrders: async () => {
    const limit = 100;
    let page = 1;
    let allOrders = [];

    const firstPage = await bmsApiModel.apiCall(`/supplier/purchase-orders?page=1&limit=${limit}`);
    const total = firstPage.meta?.total || 0;
    allOrders = firstPage.data || [];

    const totalPages = Math.ceil(total / limit);
    for (page = 2; page <= totalPages; page++) {
      const data = await bmsApiModel.apiCall(`/supplier/purchase-orders?page=${page}&limit=${limit}`);
      allOrders = allOrders.concat(data.data || []);
    }

    // Déduplication par id (l'API remplit la dernière page avec des doublons)
    const seen = new Set();
    return allOrders.filter(o => {
      if (seen.has(o.id)) return false;
      seen.add(o.id);
      return true;
    });
  },

  /**
   * Créer un bon de commande dans BMS
   */
  createPurchaseOrder: async (orderData) => {
    return bmsApiModel.apiCall('/supplier/purchase-orders', 'POST', orderData);
  },

  // ==================== RECEPTIONS ====================

  /**
   * Récupérer les réceptions depuis BMS
   */
  getReceptions: async () => {
    const data = await bmsApiModel.apiCall('/supplier/receptions');
    return data.data || [];
  },

  /**
   * Récupérer les produits attendus (en attente de réception)
   */
  getExpectedProducts: async () => {
    const data = await bmsApiModel.apiCall('/supplier/purchase-orders/items/expected');
    return data.data || [];
  },

  // ==================== PRODUITS FOURNISSEUR ====================

  /**
   * Récupérer les produits d'un fournisseur BMS
   */
  getSupplierProducts: async (supplierId = null, sku = null) => {
    let endpoint = '/supplier/products';
    const params = [];
    if (supplierId) params.push(`supplier_id=${supplierId}`);
    if (sku) params.push(`sku=${sku}`);
    if (params.length > 0) endpoint += '?' + params.join('&');

    const data = await bmsApiModel.apiCall(endpoint);
    return data.data || [];
  },

  // ==================== ENTREPOTS ====================

  /**
   * Récupérer les entrepôts BMS
   */
  getWarehouses: async () => {
    const data = await bmsApiModel.apiCall('/advanced-stock/warehouse');
    return data.data || [];
  },

  // ==================== STOCKS ====================

  /**
   * Récupérer le stock d'un produit par SKU
   */
  getProductStock: async (sku) => {
    const data = await bmsApiModel.apiCall(`/advanced-stock/product/${encodeURIComponent(sku)}/stocks`);
    return data;
  },

  // ==================== TRANSPORTEURS ====================

  /**
   * Récupérer les transporteurs BMS
   */
  getCarriers: async () => {
    const data = await bmsApiModel.apiCall('/tms/carrier');
    return data.data || [];
  }
};

module.exports = bmsApiModel;
