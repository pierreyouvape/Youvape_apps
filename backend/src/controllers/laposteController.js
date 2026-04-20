const pool = require('../config/database');
const https = require('https');
const zlib = require('zlib');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const bmsApiModel = require('../models/bmsApiModel');
const { sendAlert } = require('../services/alertService');

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

// Helper HTTP request avec support gzip
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

    console.log(`[LaPoste HTTP] ${reqOptions.method} ${url}`);

    const req = https.request(reqOptions, (res) => {
      const encoding = res.headers['content-encoding'];
      console.log(`[LaPoste HTTP] Status: ${res.statusCode}, Content-Encoding: ${encoding || 'none'}, Content-Type: ${res.headers['content-type'] || 'unknown'}`);

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        let buffer = Buffer.concat(chunks);

        const processBody = (bodyBuffer) => {
          const bodyStr = bodyBuffer.toString('utf8');
          try {
            const parsed = JSON.parse(bodyStr);
            if (res.statusCode >= 400) {
              console.error(`[LaPoste HTTP] Erreur ${res.statusCode}:`, JSON.stringify(parsed).substring(0, 500));
              const err = new Error(`HTTP ${res.statusCode}: ${JSON.stringify(parsed)}`);
              err.statusCode = res.statusCode;
              err.body = parsed;
              reject(err);
            } else {
              console.log(`[LaPoste HTTP] Réponse OK, taille: ${bodyStr.length} chars`);
              resolve(parsed);
            }
          } catch (e) {
            console.error(`[LaPoste HTTP] Parse JSON échoué, taille buffer: ${bodyBuffer.length}, début: ${bodyStr.substring(0, 100)}`);
            reject(new Error(`Réponse non-JSON (HTTP ${res.statusCode}): ${bodyStr.substring(0, 200)}`));
          }
        };

        if (encoding === 'gzip') {
          zlib.gunzip(buffer, (err, decoded) => {
            if (err) {
              console.error('[LaPoste HTTP] Erreur décompression gzip:', err.message);
              reject(new Error('Erreur décompression gzip'));
            } else {
              processBody(decoded);
            }
          });
        } else if (encoding === 'deflate') {
          zlib.inflate(buffer, (err, decoded) => {
            if (err) {
              console.error('[LaPoste HTTP] Erreur décompression deflate:', err.message);
              reject(new Error('Erreur décompression deflate'));
            } else {
              processBody(decoded);
            }
          });
        } else {
          processBody(buffer);
        }
      });
    });

    req.on('error', (err) => {
      console.error('[LaPoste HTTP] Erreur réseau:', err.message);
      reject(err);
    });
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

// Ajouter le numéro de commande sur le PDF en bas à gauche
const addOrderNumberToPdf = async (pdfBase64, orderNumber) => {
  const pdfBytes = Buffer.from(pdfBase64, 'base64');
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page = pdfDoc.getPages()[0];

  page.drawText(`#${orderNumber}`, {
    x: 10,
    y: 10,
    size: 9,
    font
  });

  const modifiedBytes = await pdfDoc.save();
  return Buffer.from(modifiedBytes).toString('base64');
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

    // Vérifier qu'il n'existe pas déjà une étiquette active pour cette commande
    const existingLabel = await pool.query(
      `SELECT id, tracking_id, created_at FROM laposte_labels WHERE order_number = $1 AND status = 'active' LIMIT 1`,
      [orderNumber]
    );
    if (existingLabel.rows.length > 0) {
      const existing = existingLabel.rows[0];
      return res.status(409).json({
        error: 'Une étiquette active existe déjà pour cette commande',
        trackingId: existing.tracking_id,
        labelId: existing.id,
        createdAt: existing.created_at
      });
    }

    // Poids fixe 20g pour toutes les étiquettes
    const weight = 20;

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
        custPurchaseOrderNumber: orderNumber,
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
                name1: senderName || 'SAS EMC',
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
    console.log('[LaPoste] Appel API pour commande', orderNumber, '— destinataire:',
      `${order.shipping_first_name} ${order.shipping_last_name}`,
      order.shipping_postcode, order.shipping_city);

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

    // Ajouter le numéro de commande sur le PDF (bas gauche)
    const modifiedPdf = await addOrderNumberToPdf(visualOutput, orderNumber);

    console.log('[LaPoste] Étiquette générée — orderId:', orderId, 'tracking:', trackingId);

    // Sauvegarder en BDD
    await pool.query(
      `INSERT INTO laposte_labels (order_number, tracking_id, laposte_order_id, packed_by) VALUES ($1, $2, $3, $4)`,
      [orderNumber, trackingId, orderId, req.user?.id || null]
    );

    // Confirmer l'expédition dans BMS (non bloquant)
    if (trackingId) {
      try {
        await bmsApiModel.apiCall(`/sales/order/${orderNumber}/ship?ref=true`, 'POST', {
          tracking: {
            title: 'La poste - Courrier suivi (port payé)',
            tracking_number: trackingId
          }
        });
        console.log('[BMS] Expédition confirmée pour commande', orderNumber, 'tracking:', trackingId);
      } catch (bmsError) {
        console.error('[BMS] Erreur confirmation expédition commande', orderNumber, ':', bmsError.message);
        sendAlert(
          `BUG VPS : commande N°${orderNumber} non confirmee en expedition BMS`,
          `Bonjour,\n\nL'expedition de la commande N°${orderNumber} avec le numero de suivi : ${trackingId} n'a pas pu etre confirmee a BMS pour la raison suivante :\n\n${bmsError.message}\n\nPensez a corriger cela.`
        );
      }
    }

    res.json({
      success: true,
      orderId,
      trackingId,
      pdfBase64: modifiedPdf,
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

// Lister les étiquettes
const listLabels = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT l.id, l.order_number, l.tracking_id, l.laposte_order_id, l.status, l.created_at, l.cancelled_at,
              u.name AS packer_name
       FROM laposte_labels l
       LEFT JOIN users u ON u.id = l.packed_by
       ORDER BY l.created_at DESC
       LIMIT 100`
    );

    const now = new Date();
    const labels = result.rows.map(label => {
      const createdAt = new Date(label.created_at);
      const daysDiff = (now - createdAt) / (1000 * 60 * 60 * 24);
      const sameMonth = createdAt.getMonth() === now.getMonth() && createdAt.getFullYear() === now.getFullYear();
      const cancellable = label.status === 'active' && daysDiff <= 7 && sameMonth;

      return { ...label, cancellable };
    });

    res.json(labels);
  } catch (error) {
    console.error('[LaPoste] Erreur listLabels:', error.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// Annuler une étiquette
const cancelLabel = async (req, res) => {
  try {
    const { id } = req.params;

    // Récupérer l'étiquette
    const labelResult = await pool.query(
      'SELECT * FROM laposte_labels WHERE id = $1', [id]
    );

    if (labelResult.rows.length === 0) {
      return res.status(404).json({ error: 'Étiquette introuvable' });
    }

    const label = labelResult.rows[0];

    if (label.status !== 'active') {
      return res.status(400).json({ error: 'Étiquette déjà annulée' });
    }

    // Vérifier les conditions d'annulation
    const now = new Date();
    const createdAt = new Date(label.created_at);
    const daysDiff = (now - createdAt) / (1000 * 60 * 60 * 24);
    const sameMonth = createdAt.getMonth() === now.getMonth() && createdAt.getFullYear() === now.getFullYear();

    if (daysDiff > 7 || !sameMonth) {
      return res.status(400).json({ error: 'Délai d\'annulation dépassé (7 jours max, même mois)' });
    }

    // Appeler l'API La Poste pour annuler
    const apiUrl = await getConfig('laposte_api_url');
    const token = await getToken();

    const cancelPayload = JSON.stringify({ orderId: label.laposte_order_id });

    const data = await httpRequest(`${apiUrl}/orders/cancel`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: cancelPayload
    });

    console.log('[LaPoste] Annulation demandée pour orderId:', label.laposte_order_id, 'résultat:', JSON.stringify(data).substring(0, 300));

    // Mettre à jour en BDD
    await pool.query(
      `UPDATE laposte_labels SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1`,
      [id]
    );

    res.json({ success: true, cancelResult: data });

  } catch (error) {
    console.error('[LaPoste] Erreur cancelLabel:', error.message);
    res.status(error.statusCode || 500).json({
      error: 'Erreur annulation étiquette',
      details: error.body || error.message
    });
  }
};

module.exports = {
  generateLabel,
  listLabels,
  cancelLabel
};
