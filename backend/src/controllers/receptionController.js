const pool = require('../config/database');
const bmsApiModel = require('../models/bmsApiModel');

// Cache court des emplacements BMS. BMS n'expose pas d'endpoint bulk : la seule
// façon de connaître l'emplacement d'un produit est /advanced-stock/product/{sku}/stocks,
// soit un appel par SKU (~150 ms). En parallèle, une commande de 88 lignes se charge
// en ~2,4 s — d'où un endpoint séparé, appelé après l'affichage de l'écran.
const locationCache = new Map(); // sku -> { locations, expiry }
const LOCATION_TTL = 10 * 60 * 1000;

const getLocationCached = async (sku) => {
  const hit = locationCache.get(sku);
  if (hit && Date.now() < hit.expiry) return hit.locations;
  let locations = [];
  try {
    locations = await bmsApiModel.getProductShelfLocations(sku);
  } catch {
    return []; // BMS indisponible : l'emplacement est un confort, jamais un bloquant
  }
  locationCache.set(sku, { locations, expiry: Date.now() + LOCATION_TTL });
  return locations;
};

// Commandes considérées « en attente de réception » : envoyée au fournisseur,
// confirmée, ou partiellement reçue. On exclut 'draft' (pas encore partie) et
// les statuts terminaux.
const PENDING_STATUSES = ['sent', 'confirmed', 'partial'];

/**
 * Toutes les quantités exposées par cette app sont en UNITÉS DE STOCK — celles
 * que l'opérateur compte réellement en scannant. Une ligne de commande n'est pas
 * forcément comptée dans cette unité : chez les fournisseurs « à l'unité » (LCA,
 * Highbuy, Levest, MG Vape) qty_ordered est un nombre de PACKS, et units_per_qty
 * porte le facteur (cf. migration add_units_per_qty_purchase_order_items.sql).
 * D'où la multiplication systématique ci-dessous.
 */
const QTY_EXPECTED = 'poi.qty_ordered * COALESCE(poi.units_per_qty, 1)';
const QTY_RECEIVED = 'poi.qty_received * COALESCE(poi.units_per_qty, 1)';

/**
 * GET /api/reception/orders
 * Liste des commandes en attente de réception.
 * Query : supplier_id, search (n° de commande)
 */
exports.getPendingOrders = async (req, res) => {
  try {
    const { supplier_id, search } = req.query;
    const params = [PENDING_STATUSES];
    const conds = ['po.status = ANY($1)'];

    if (supplier_id) {
      params.push(parseInt(supplier_id));
      conds.push(`po.supplier_id = $${params.length}`);
    }
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      conds.push(`(po.order_number ILIKE $${params.length} OR po.bms_reference ILIKE $${params.length})`);
    }

    const result = await pool.query(`
      SELECT
        po.id, po.order_number, po.bms_po_id, po.status,
        po.order_date, po.expected_date,
        s.id AS supplier_id, s.name AS supplier_name,
        COUNT(poi.id)::int                                  AS nb_lines,
        COALESCE(SUM(${QTY_EXPECTED}), 0)::int              AS qty_expected,
        COALESCE(SUM(${QTY_RECEIVED}), 0)::int              AS qty_received
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
      WHERE ${conds.join(' AND ')}
      GROUP BY po.id, s.id, s.name
      ORDER BY po.expected_date NULLS LAST, po.order_date DESC
    `, params);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error getPendingOrders:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /api/reception/suppliers
 * Fournisseurs ayant au moins une commande à réceptionner (pour le filtre).
 */
exports.getSuppliersWithPending = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.id, s.name, COUNT(DISTINCT po.id)::int AS nb_orders
      FROM suppliers s
      JOIN purchase_orders po ON po.supplier_id = s.id
      WHERE po.status = ANY($1)
      GROUP BY s.id, s.name
      ORDER BY s.name
    `, [PENDING_STATUSES]);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error getSuppliersWithPending:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /api/reception/orders/:id
 * Détail d'une commande + ses lignes, codes-barres inclus.
 *
 * Les codes-barres sont embarqués volontairement : le comptage se fait à la
 * douchette, donc la résolution d'un scan doit être instantanée et hors ligne
 * plutôt qu'un aller-retour réseau par bip.
 */
exports.getOrderDetail = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    if (!Number.isFinite(orderId)) {
      return res.status(400).json({ success: false, error: 'Identifiant invalide' });
    }

    const orderResult = await pool.query(`
      SELECT po.id, po.order_number, po.bms_po_id, po.bms_reference, po.status,
             po.order_date, po.expected_date, po.notes,
             s.id AS supplier_id, s.name AS supplier_name, s.code AS supplier_code
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.id = $1
    `, [orderId]);

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Commande introuvable' });
    }
    const order = orderResult.rows[0];

    const itemsResult = await pool.query(`
      SELECT
        poi.id, poi.product_id, poi.supplier_sku, poi.product_name,
        poi.units_per_qty,
        ${QTY_EXPECTED}::int AS qty_expected,
        ${QTY_RECEIVED}::int AS qty_received,
        p.wp_product_id, p.sku, p.post_title, p.image_url, p.stock,
        COALESCE(ps.pack_qty, 1) AS pack_qty
      FROM purchase_order_items poi
      LEFT JOIN products p ON p.id = poi.product_id
      LEFT JOIN product_suppliers ps
             ON ps.product_id = poi.product_id AND ps.supplier_id = $2
      WHERE poi.purchase_order_id = $1
      ORDER BY COALESCE(p.post_title, poi.product_name)
    `, [orderId, order.supplier_id]);

    // Codes-barres de tous les produits de la commande, en une requête
    const productIds = itemsResult.rows.map(r => r.product_id).filter(Boolean);
    const barcodesByProduct = new Map();
    if (productIds.length > 0) {
      const bc = await pool.query(
        'SELECT product_id, barcode, type, quantity FROM product_barcodes WHERE product_id = ANY($1)',
        [productIds]
      );
      for (const row of bc.rows) {
        if (!barcodesByProduct.has(row.product_id)) barcodesByProduct.set(row.product_id, []);
        barcodesByProduct.get(row.product_id).push({
          barcode: row.barcode,
          type: row.type,
          quantity: row.quantity,
        });
      }
    }

    const items = itemsResult.rows.map(row => {
      const barcodes = barcodesByProduct.get(row.product_id) || [];
      const packQty = parseInt(row.pack_qty) || 1;
      // Ambiguïté : le produit est acheté au carton mais tous ses codes connus sont
      // typés « unité ». Le code scanné peut donc être celui du carton — c'est le
      // seul cas où l'opérateur doit trancher (et sa réponse est enregistrée).
      const ambiguous = packQty > 1
        && barcodes.length > 0
        && barcodes.every(b => b.type === 'unit');

      return {
        id: row.id,
        product_id: row.product_id,
        wp_product_id: row.wp_product_id,
        sku: row.sku,
        supplier_sku: row.supplier_sku,
        name: row.post_title || row.product_name,
        image_url: row.image_url,
        stock: row.stock,
        qty_expected: row.qty_expected,
        qty_received: row.qty_received,
        qty_remaining: Math.max(0, (row.qty_expected || 0) - (row.qty_received || 0)),
        units_per_qty: parseInt(row.units_per_qty) || 1,
        pack_qty: packQty,
        barcodes,
        ambiguous,
      };
    });

    res.json({ success: true, data: { order, items } });
  } catch (error) {
    console.error('Error getOrderDetail:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /api/reception/orders/:id/locations
 * Emplacements en entrepôt des articles d'une commande : { [item_id]: "C 4-3" }.
 *
 * Endpoint séparé du détail à dessein — il dépend de BMS (un appel par SKU), donc
 * l'écran s'affiche immédiatement et la colonne se remplit ensuite. Une panne BMS
 * laisse la colonne vide au lieu de bloquer la réception.
 */
exports.getOrderLocations = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    if (!Number.isFinite(orderId)) {
      return res.status(400).json({ success: false, error: 'Identifiant invalide' });
    }

    const { rows } = await pool.query(`
      SELECT poi.id, p.sku
      FROM purchase_order_items poi
      JOIN products p ON p.id = poi.product_id
      WHERE poi.purchase_order_id = $1 AND p.sku IS NOT NULL AND p.sku <> ''
    `, [orderId]);

    const locations = {};
    await Promise.all(rows.map(async ({ id, sku }) => {
      const locs = await getLocationCached(sku);
      if (locs.length > 0) {
        // Plusieurs entrepôts possibles (Entrepot, SAV Josh, SAV LCA) : on les
        // affiche tous, l'opérateur doit savoir si le produit est éclaté.
        locations[id] = locs.map(l => l.location).join(' · ');
      }
    }));

    res.json({ success: true, data: locations });
  } catch (error) {
    console.error('Error getOrderLocations:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
