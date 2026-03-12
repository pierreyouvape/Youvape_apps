const pool = require('../config/database');
const https = require('https');

// Cache token en mémoire
let tokenCache = { token: null, expiresAt: 0 };

// Récupérer une config app_config
const getConfig = async (key) => {
  const result = await pool.query('SELECT config_value FROM app_config WHERE config_key = $1', [key]);
  return result.rows[0]?.config_value || null;
};

// Obtenir un token OAuth2 (cache 1h)
const getToken = async () => {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt > now + 60000) {
    return tokenCache.token;
  }

  const tokenUrl = await getConfig('laposte_token_url');
  const clientId = await getConfig('laposte_client_id');
  const clientSecret = await getConfig('laposte_client_secret');

  if (!tokenUrl || !clientId || !clientSecret) {
    throw new Error('Configuration La Poste manquante (token_url, client_id, client_secret)');
  }

  const body = `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;

  const data = await httpRequest(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  tokenCache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in * 1000)
  };

  console.log('[LaPoste] Token obtenu, expire dans', data.expires_in, 's');
  return data.access_token;
};

// Helper HTTP request (node natif, pas de dépendance)
const httpRequest = (url, options) => {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = https.request(reqOptions, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 400) {
            const err = new Error(`HTTP ${res.statusCode}: ${JSON.stringify(parsed)}`);
            err.statusCode = res.statusCode;
            err.body = parsed;
            reject(err);
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Réponse non-JSON (HTTP ${res.statusCode}): ${body.substring(0, 500)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Timeout La Poste API'));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
};

// Générer une étiquette Lettre Suivie
const generateLabel = async (req, res) => {
  try {
    const { orderNumber } = req.params;

    // Charger la commande pour l'adresse destinataire
    const orderResult = await pool.query(`
      SELECT
        wp_order_id,
        shipping_first_name, shipping_last_name, shipping_company,
        shipping_address_1,
        shipping_city, shipping_postcode, shipping_country,
        shipping_phone, billing_email, order_total
      FROM orders
      WHERE wp_order_id = $1
    `, [orderNumber]);

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    const order = orderResult.rows[0];

    // Calculer le poids total approximatif (en grammes) — fallback 100g
    const weight = 100;

    // Récupérer les configs
    const [apiUrl, contractNumber, custAccNumber, custInvoice, senderEmail, senderPhone, senderName, senderAddress, senderZipcode, senderTown] = await Promise.all([
      getConfig('laposte_api_url'),
      getConfig('laposte_contract_number'),
      getConfig('laposte_cust_acc_number'),
      getConfig('laposte_cust_invoice'),
      getConfig('laposte_sender_email'),
      getConfig('laposte_sender_phone'),
      getConfig('laposte_sender_name'),
      getConfig('laposte_sender_address'),
      getConfig('laposte_sender_zipcode'),
      getConfig('laposte_sender_town')
    ]);

    if (!apiUrl || !contractNumber || !custAccNumber || !custInvoice) {
      return res.status(500).json({ error: 'Configuration La Poste incomplète' });
    }

    // Obtenir le token
    const token = await getToken();

    // Construire le payload
    const payload = {
      order: {
        custPurchaseOrderNumber: `WC-${orderNumber}`,
        invoicing: {
          contractNumber,
          custAccNumber,
          custInvoice
        },
        offer: {
          offerCode: '3125',
          masterOutputOptions: {
            visualFormatCode: 'rollA'
          },
          products: [{
            productCode: 'K7',
            productOptions: {
              weight,
              deliveryTrackingFlag: true
            },
            sender: {
              email: senderEmail || 'contact@youvape.fr',
              phone: senderPhone || '0499782453',
              address: {
                name1: senderName || 'SARL EMC',
                add4: senderAddress || '580 avenue de l aube rouge',
                zipcode: senderZipcode || '34170',
                town: senderTown || 'Castelnau le lez',
                countryCode: '250'
              }
            },
            receiver: {
              email: order.billing_email || '',
              phone: order.shipping_phone || '',
              address: {
                name1: `${order.shipping_first_name || ''} ${order.shipping_last_name || ''}`.trim(),
                ...(order.shipping_company && { add2: order.shipping_company }),
                add4: order.shipping_address_1 || '',
                zipcode: order.shipping_postcode || '',
                town: order.shipping_city || '',
                countryCode: '250'
              }
            }
          }]
        }
      }
    };

    const jsonBody = JSON.stringify(payload);
    console.log('[LaPoste] Appel API pour commande', orderNumber);

    const data = await httpRequest(`${apiUrl}/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: jsonBody
    });

    // Extraire les infos
    const trackingId = data.order?.offer?.products?.[0]?.smartdata?.itemId || null;
    const visualOutput = data.order?.offer?.visualOutput || null;
    const orderId = data.order?.orderId || null;

    if (!visualOutput) {
      console.error('[LaPoste] Pas de visualOutput dans la réponse:', JSON.stringify(data).substring(0, 500));
      return res.status(500).json({ error: 'Pas de PDF dans la réponse La Poste' });
    }

    console.log('[LaPoste] Étiquette générée — orderId:', orderId, 'tracking:', trackingId);

    res.json({
      success: true,
      orderId,
      trackingId,
      pdfBase64: visualOutput,
      orderNumber
    });

  } catch (error) {
    console.error('[LaPoste] Erreur generateLabel:', error.message);

    // Si token expiré, invalider le cache
    if (error.statusCode === 401) {
      tokenCache = { token: null, expiresAt: 0 };
    }

    res.status(error.statusCode || 500).json({
      error: 'Erreur génération étiquette La Poste',
      details: error.body || error.message
    });
  }
};

module.exports = {
  generateLabel
};
