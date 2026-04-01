/**
 * BMS API Model - BoostMyShop myFulfillment API
 * Documentation: https://fr3.myfulfillment.boostmyshop.com/swagger/
 */

const BMS_API_URL = 'https://fr3.myfulfillment.boostmyshop.com/api';
const BMS_USERNAME = process.env.BMS_USERNAME || 'pierre.youvape@gmail.com';
const BMS_PASSWORD = process.env.BMS_PASSWORD || 'pedrito723@';

// Cache de tokens par email (clé = email, valeur = { token, expiry })
const tokenCache = new Map();

const bmsApiModel = {
  /**
   * Obtenir un token BMS pour un utilisateur donné (ou les credentials par défaut)
   */
  getToken: async (email = null, password = null) => {
    const username = email || BMS_USERNAME;
    const pwd = password || BMS_PASSWORD;
    const cacheKey = username;

    const cached = tokenCache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) {
      return cached.token;
    }

    const response = await fetch(`${BMS_API_URL}/auth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: username,
        password: pwd
      })
    });

    if (!response.ok) {
      throw new Error(`BMS Auth failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    tokenCache.set(cacheKey, {
      token: data.token,
      expiry: Date.now() + (60 * 60 * 1000) // 1 heure
    });

    return data.token;
  },

  /**
   * Faire un appel API authentifié à BMS (credentials par défaut)
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

  /**
   * Faire un appel API authentifié à BMS avec des credentials spécifiques
   */
  apiCallAs: async (email, password, endpoint, method = 'GET', body = null) => {
    const token = await bmsApiModel.getToken(email, password);

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
   * Récupérer tous les fournisseurs depuis BMS (toutes les pages)
   */
  getSuppliers: async () => {
    const limit = 100;
    let offset = 0;
    let allSuppliers = [];

    const firstPage = await bmsApiModel.apiCall(`/supplier/suppliers?offset=0&limit=${limit}`);
    const total = firstPage.meta?.total || 0;
    allSuppliers = firstPage.data || [];

    for (offset = limit; offset < total; offset += limit) {
      const data = await bmsApiModel.apiCall(`/supplier/suppliers?offset=${offset}&limit=${limit}`);
      allSuppliers = allSuppliers.concat(data.data || []);
    }

    return allSuppliers;
  },

  // ==================== BONS DE COMMANDE ====================

  /**
   * Récupérer les bons de commande depuis BMS (toutes les pages)
   * La pagination BMS utilise offset+limit (pas page+limit).
   */
  getPurchaseOrders: async () => {
    const limit = 100;
    let offset = 0;
    let allOrders = [];

    const firstPage = await bmsApiModel.apiCall(`/supplier/purchase-orders?offset=0&limit=${limit}`);
    const total = firstPage.meta?.total || 0;
    allOrders = firstPage.data || [];

    for (offset = limit; offset < total; offset += limit) {
      const data = await bmsApiModel.apiCall(`/supplier/purchase-orders?offset=${offset}&limit=${limit}`);
      allOrders = allOrders.concat(data.data || []);
    }

    return allOrders;
  },

  /**
   * Créer un bon de commande dans BMS
   */
  createPurchaseOrder: async (orderData, bmsCredentials = null) => {
    if (bmsCredentials) {
      return bmsApiModel.apiCallAs(bmsCredentials.email, bmsCredentials.password, '/supplier/purchase-orders', 'POST', orderData);
    }
    return bmsApiModel.apiCall('/supplier/purchase-orders', 'POST', orderData);
  },

  // ==================== RECEPTIONS ====================

  /**
   * Récupérer les réceptions depuis BMS (toutes les pages)
   */
  getReceptions: async () => {
    const limit = 100;
    let offset = 0;
    let allReceptions = [];

    const firstPage = await bmsApiModel.apiCall(`/supplier/receptions?offset=0&limit=${limit}`);
    const total = firstPage.meta?.total || 0;
    allReceptions = firstPage.data || [];

    for (offset = limit; offset < total; offset += limit) {
      const data = await bmsApiModel.apiCall(`/supplier/receptions?offset=${offset}&limit=${limit}`);
      allReceptions = allReceptions.concat(data.data || []);
    }

    return allReceptions;
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
   * Récupérer les produits d'un fournisseur BMS (toutes les pages)
   * Si sku est fourni, retourne directement (pas de pagination nécessaire).
   */
  getSupplierProducts: async (supplierId = null, sku = null) => {
    const baseParams = [];
    if (supplierId) baseParams.push(`supplier_id=${supplierId}`);
    if (sku) baseParams.push(`sku=${sku}`);

    // Avec un SKU précis, pas besoin de paginer
    if (sku) {
      const endpoint = '/supplier/products?' + baseParams.join('&');
      const data = await bmsApiModel.apiCall(endpoint);
      return data.data || [];
    }

    // Sans SKU : pagination complète
    const limit = 100;
    let offset = 0;
    let allProducts = [];

    const firstPage = await bmsApiModel.apiCall(`/supplier/products?${baseParams.join('&')}&offset=0&limit=${limit}`);
    const total = firstPage.meta?.total || 0;
    allProducts = firstPage.data || [];

    for (offset = limit; offset < total; offset += limit) {
      const data = await bmsApiModel.apiCall(`/supplier/products?${baseParams.join('&')}&offset=${offset}&limit=${limit}`);
      allProducts = allProducts.concat(data.data || []);
    }

    return allProducts;
  },

  // ==================== CATALOGUE PRODUITS ====================

  /**
   * Récupérer tous les produits du catalogue BMS (toutes les pages)
   * Retourne les infos produit dont le champ barcode
   */
  getCatalogProducts: async () => {
    const limit = 100;
    let offset = 0;
    let allProducts = [];

    const firstPage = await bmsApiModel.apiCall(`/catalog-product/products?offset=0&limit=${limit}`);
    const total = firstPage.meta?.total || 0;
    allProducts = firstPage.data || [];

    for (offset = limit; offset < total; offset += limit) {
      const data = await bmsApiModel.apiCall(`/catalog-product/products?offset=${offset}&limit=${limit}`);
      allProducts = allProducts.concat(data.data || []);
    }

    return allProducts;
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
