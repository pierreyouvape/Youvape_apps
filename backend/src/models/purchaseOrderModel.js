const pool = require('../config/database');
const bmsApiModel = require('./bmsApiModel');
const parserRegistry = require('../parsers');
const { normalizeVerifiedPrice } = require('../utils/verifiedPrice');

// Warehouse ID principal BMS (Entrepot)
const BMS_WAREHOUSE_ID = 270;

// Erreurs d'envoi BMS que l'utilisateur peut lever lui-même : à chaque code
// correspond le drapeau à renvoyer sur /send-bms pour forcer l'envoi en l'état.
// Toute erreur ABSENTE de cette table reste bloquante (vraie anomalie).
const BMS_DECIDABLE_ERRORS = {
  BMS_MISSING_PRODUCTS: { skip_missing: true },   // produits pas encore créés dans BMS
  BMS_TOTAL_MISMATCH: { ignore_total_mismatch: true } // commande partielle vs document
};

const purchaseOrderModel = {
  BMS_DECIDABLE_ERRORS,

  // Drapeaux de renvoi si l'erreur est « décidable », sinon null
  bmsRetryFlags: (error) => BMS_DECIDABLE_ERRORS[error?.code] || null,

  // Générer un numéro de commande
  generateOrderNumber: async () => {
    const result = await pool.query('SELECT generate_po_number() as order_number');
    return result.rows[0].order_number;
  },

  // Récupérer toutes les commandes
  getAll: async (filters = {}) => {
    let query = `
      SELECT
        po.*,
        s.name as supplier_name,
        s.code as supplier_code,
        u.email as created_by_email,
        COALESCE(SUM(poi.qty_ordered), 0) as total_qty_ordered,
        COALESCE(SUM(poi.qty_received), 0) as total_qty_received
      FROM purchase_orders po
      JOIN suppliers s ON po.supplier_id = s.id
      LEFT JOIN users u ON po.created_by = u.id
      LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
      WHERE 1=1
    `;
    const values = [];
    let paramIndex = 1;

    if (filters.supplier_id) {
      query += ` AND po.supplier_id = $${paramIndex++}`;
      values.push(filters.supplier_id);
    }

    if (filters.status) {
      query += ` AND po.status = $${paramIndex++}`;
      values.push(filters.status);
    }

    if (filters.exclude_status && filters.exclude_status.length > 0) {
      const placeholders = filters.exclude_status.map(() => `$${paramIndex++}`).join(', ');
      query += ` AND po.status NOT IN (${placeholders})`;
      values.push(...filters.exclude_status);
    }

    if (filters.from_date) {
      query += ` AND po.created_at >= $${paramIndex++}`;
      values.push(filters.from_date);
    }

    if (filters.to_date) {
      query += ` AND po.created_at <= $${paramIndex++}`;
      values.push(filters.to_date);
    }

    if (filters.search) {
      query += ` AND (po.order_number ILIKE $${paramIndex} OR po.bms_reference ILIKE $${paramIndex})`;
      values.push(`%${filters.search}%`);
      paramIndex++;
    }

    query += ' GROUP BY po.id, s.name, s.code, u.email ORDER BY po.created_at DESC';

    if (filters.limit) {
      query += ` LIMIT $${paramIndex++}`;
      values.push(filters.limit);
    }

    const result = await pool.query(query, values);
    return result.rows;
  },

  // Récupérer une commande par ID avec ses lignes
  getById: async (id) => {
    const orderQuery = `
      SELECT
        po.*,
        s.name as supplier_name,
        s.code as supplier_code,
        s.email as supplier_email,
        u.email as created_by_email
      FROM purchase_orders po
      JOIN suppliers s ON po.supplier_id = s.id
      LEFT JOIN users u ON po.created_by = u.id
      WHERE po.id = $1
    `;
    const orderResult = await pool.query(orderQuery, [id]);

    if (orderResult.rows.length === 0) {
      return null;
    }

    const itemsQuery = `
      SELECT
        poi.*,
        p.sku as product_sku,
        p.post_title as current_product_name,
        p.stock as current_stock,
        p.product_type as product_type
      FROM purchase_order_items poi
      LEFT JOIN products p ON poi.product_id = p.id
      WHERE poi.purchase_order_id = $1
      ORDER BY poi.id
    `;
    const itemsResult = await pool.query(itemsQuery, [id]);

    return {
      ...orderResult.rows[0],
      items: itemsResult.rows
    };
  },

  // Créer une commande
  create: async (data, userId) => {
    const client = await pool.connect();
    // Avertissement d'envoi BMS remonté au front sans annuler la création locale
    let bmsWarning = null;
    let bmsSkipped = [];
    try {
      await client.query('BEGIN');

      // Utiliser le numéro fourni (import PDF) ou en générer un
      const orderNumber = data.order_number || await purchaseOrderModel.generateOrderNumber();

      // Fournisseur « à l'unité » : ses lignes sont comptées en PACKS (qty_ordered =
      // nb de packs, unit_price = prix du pack, cf. pdfImportModel qui force packQty=1).
      // On mémorise le conditionnement sur la ligne (units_per_qty) pour que les
      // calculs de stock retrouvent les unités individuelles.
      const supplierCodeResult = await client.query(
        'SELECT code FROM suppliers WHERE id = $1',
        [data.supplier_id]
      );
      const orderInPacks = parserRegistry.skipsPackQty(supplierCodeResult.rows[0]?.code);

      // Créer la commande localement
      const orderQuery = `
        INSERT INTO purchase_orders (
          order_number, supplier_id, status, notes, created_by, order_date, invoice_total_ht
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `;
      const orderResult = await client.query(orderQuery, [
        orderNumber,
        data.supplier_id,
        data.status || 'draft',
        data.notes || null,
        userId,
        data.order_date || new Date().toISOString().split('T')[0],
        data.invoice_total_ht != null ? parseFloat(data.invoice_total_ht) : null,
      ]);
      const order = orderResult.rows[0];

      // Récupérer les SKUs des produits pour les items
      const itemsWithSku = [];
      let totalItems = 0;
      let totalQty = 0;
      let totalAmount = 0;

      if (data.items && data.items.length > 0) {
        for (const item of data.items) {
          // Ligne remise (item_type = 'discount') : pas de product_id, insertion directe
          if (item.item_type === 'discount') {
            const discountQuery = `
              INSERT INTO purchase_order_items (
                purchase_order_id, item_type, product_name, unit_price, qty_ordered
              )
              VALUES ($1, 'discount', $2, $3, 1)
              RETURNING *
            `;
            const insertedDiscount = await client.query(discountQuery, [
              order.id,
              item.product_name,
              item.unit_price,
            ]);
            itemsWithSku.push(insertedDiscount.rows[0]);
            // Les remises comptent dans totalAmount (unit_price déjà négatif)
            if (item.unit_price) {
              totalAmount += parseFloat(item.unit_price);
            }
            continue;
          }

          // Récupérer le produit interne (product_id peut être wp_product_id ou id interne).
          // L'import PDF envoie un wp_product_id : on le prioritise, sinon un wp_product_id
          // qui coïncide avec l'id interne d'un AUTRE produit (collision) matche le mauvais
          // produit et fait insérer un SKU erroné → 500 opaque côté BMS.
          const productResult = await client.query(
            `SELECT p.id, p.sku, p.wc_cog_cost, ps.pack_qty
             FROM products p
             LEFT JOIN product_suppliers ps ON ps.product_id = p.id AND ps.supplier_id = $2
             WHERE p.wp_product_id = $1 OR p.id = $1
             ORDER BY CASE WHEN p.wp_product_id = $1 THEN 0 ELSE 1 END
             LIMIT 1`,
            [item.product_id, data.supplier_id]
          );
          const product = productResult.rows[0];
          if (!product) {
            throw new Error(`Produit introuvable pour product_id=${item.product_id}`);
          }
          const internalProductId = product.id;
          const sku = product.sku || null;
          const packQty = parseInt(product.pack_qty) || 1;
          // Si unit_price est fourni (meme 0), l'utiliser. Sinon fallback sur wc_cog_cost.
          // 'unit_price' in item permet de distinguer "non fourni" de "explicitement null" (import PDF sans prix)
          const unitPrice = ('unit_price' in item && item.unit_price !== undefined)
            ? item.unit_price
            : (product?.wc_cog_cost || 0);

          const discountPercent = ('discount_percent' in item && item.discount_percent !== undefined)
            ? parseFloat(item.discount_percent) || 0
            : 0;

          const itemQuery = `
            INSERT INTO purchase_order_items (
              purchase_order_id, product_id, supplier_sku, product_name,
              qty_ordered, unit_price, discount_percent, stock_before, theoretical_need, supposed_need,
              units_per_qty
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
          `;
          const insertedItem = await client.query(itemQuery, [
            order.id,
            internalProductId,
            item.supplier_sku || sku || null,
            item.product_name,
            item.qty_ordered,
            unitPrice || null,
            discountPercent,
            item.stock_before || null,
            item.theoretical_need || null,
            item.supposed_need || null,
            orderInPacks ? packQty : 1
          ]);

          itemsWithSku.push({
            ...insertedItem.rows[0],
            sku: sku,
            unit_price: unitPrice,
            discount_percent: discountPercent,
            pack_qty: packQty
          });

          totalItems++;
          totalQty += item.qty_ordered;
          if (unitPrice) {
            const netPrice = unitPrice * (1 - discountPercent / 100);
            totalAmount += item.qty_ordered * netPrice;
          }
        }

        // Mettre à jour les totaux
        await client.query(`
          UPDATE purchase_orders
          SET total_items = $2, total_qty = $3, total_amount = $4
          WHERE id = $1
        `, [order.id, totalItems, totalQty, totalAmount]);
      }

      // Enregistrer les nouvelles associations supplier_sku (import PDF, matching manuel)
      // Stocké sur le produit exact (variation ou simple), pas le parent
      if (data.new_supplier_skus && data.new_supplier_skus.length > 0) {
        for (const entry of data.new_supplier_skus) {
          // Résoudre wp_product_id vers id interne (sans remonter au parent)
          const resolveResult = await client.query(
            'SELECT id FROM products WHERE id = $1 OR wp_product_id = $1 LIMIT 1',
            [entry.product_id]
          );
          const productId = resolveResult.rows[0]?.id || entry.product_id;

          // Upsert : ne met a jour QUE le supplier_sku, sans ecraser prix/pack_qty existants
          await client.query(`
            INSERT INTO product_suppliers (supplier_id, product_id, supplier_sku)
            VALUES ($1, $2, $3)
            ON CONFLICT (product_id, supplier_id) DO UPDATE SET
              supplier_sku = EXCLUDED.supplier_sku,
              updated_at = CURRENT_TIMESTAMP
          `, [data.supplier_id, productId, entry.supplier_sku]);
        }
      }

      // Si send_to_bms est true, créer la commande dans BMS
      if (data.send_to_bms) {
        // Récupérer les credentials BMS de l'utilisateur connecté (si configurés)
        const userCreds = await client.query(
          'SELECT bms_email, bms_password FROM users WHERE id = $1', [userId]
        );
        const bmsCreds = userCreds.rows[0]?.bms_email
          ? { email: userCreds.rows[0].bms_email, password: userCreds.rows[0].bms_password }
          : null;

        // L'échec de l'envoi BMS ne doit PAS annuler la création de la commande locale :
        // sinon un seul produit absent de BMS fait perdre tout le travail d'import. On
        // committe la commande et on remonte l'erreur en avertissement, à l'utilisateur
        // de décider (créer le produit dans BMS, ou renvoyer sans lui via skip_missing).
        try {
          const bmsResult = await purchaseOrderModel.createInBMS(
            client,
            order,
            data.supplier_id,
            itemsWithSku,
            bmsCreds,
            {
              skipMissingSkus: !!data.skip_missing_bms_products,
              skipTotalCheck: !!data.ignore_total_mismatch
            }
          );

          if (bmsResult.bms_po_id) {
            await client.query(
              'UPDATE purchase_orders SET bms_po_id = $2, status = $3 WHERE id = $1',
              [order.id, bmsResult.bms_po_id, 'sent']
            );
          }
          bmsSkipped = bmsResult.skipped_items || [];
        } catch (bmsError) {
          // Échec « décidable » (produits absents de BMS, écart avec le total du
          // document) : la commande locale reste valide, on la conserve et on laisse
          // l'utilisateur trancher. Les autres échecs (erreur BMS, garde-fou
          // structurel pack_qty) signalent une commande erronée → annulation.
          const retryFlags = purchaseOrderModel.bmsRetryFlags(bmsError);
          if (!retryFlags) throw bmsError;
          console.error('Envoi BMS échoué à la création (commande conservée):', bmsError.message);
          bmsWarning = {
            message: bmsError.message,
            code: bmsError.code,
            missing_skus: bmsError.missingSkus || null,
            totals: bmsError.totals || null,
            retry_flags: retryFlags,
            // Rien à envoyer si AUCUN produit n'est commandable dans BMS
            can_send_anyway: bmsError.code !== 'BMS_MISSING_PRODUCTS' || bmsError.sendableCount > 0
          };
        }
      }

      await client.query('COMMIT');

      const created = await purchaseOrderModel.getById(order.id);
      if (bmsWarning) created.bms_error = bmsWarning;
      if (bmsSkipped.length > 0) created.bms_skipped_items = bmsSkipped;
      return created;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // Créer la commande dans BMS
  // options.skipMissingSkus  : envoi partiel assumé — les produits absents du catalogue
  //                             BMS sont retirés du payload au lieu de bloquer la commande.
  // options.skipTotalCheck   : écart avec le total du document fournisseur assumé
  //                             (commande volontairement partielle / quantités ajustées).
  createInBMS: async (client, order, supplierId, items, bmsCredentials = null, options = {}) => {
    // Récupérer le bms_id du fournisseur
    const supplierResult = await client.query(
      'SELECT bms_id, name, code FROM suppliers WHERE id = $1',
      [supplierId]
    );
    const supplier = supplierResult.rows[0];

    if (!supplier?.bms_id) {
      throw new Error(`Le fournisseur n'a pas d'ID BMS associé. Synchronisez les fournisseurs depuis BMS d'abord.`);
    }

    // Fournisseur « à l'unité » (Highbuy, LCA, MG Vape, Levest) : la facture est déjà
    // en prix unitaire / quantités unitaires. Neutraliser pack_qty (=1) pour NE PAS
    // re-multiplier le prix par le conditionnement catalogue (bug ×10 : 7,90 → 79,00).
    const skipPackQty = parserRegistry.skipsPackQty(supplier.code);

    // Préparer les items pour BMS (seuls les produits avec SKU)
    // Sémantique BMS (vérifiée en prod) :
    //   - Le champ `qty` POSTÉ est en UNITÉS ; BMS stocke qty_packs = qty_postée / pack_qty.
    //   - `price` est le prix DU PACK ; total ligne = qty_packs × price.
    // Deux conventions de stockage local selon le fournisseur :
    //   - Normaux : qty_ordered = UNITÉS, unit_price = prix PAR UNITÉ
    //       → qty = qty_ordered (déjà en unités) ; price = unit_price × pack_qty (prix pack).
    //   - « À l'unité » (skipPackQty : Highbuy, LCA…) : la facture est AU PACK,
    //     qty_ordered = nb de PACKS et unit_price = prix DU PACK
    //       → qty = qty_ordered × pack_qty (packs → unités, car BMS re-divise) ;
    //         price = unit_price tel quel (déjà un prix pack ; ne PAS ×pack_qty = bug ×10).
    // pack_qty est toujours envoyé (conditionnement / réception).
    const bmsItems = items
      .filter(item => item.sku)
      .map(item => {
        const discountPercent = parseFloat(item.discount_percent) || 0;
        const packQty = parseInt(item.pack_qty) || 1;
        const qtyBase = parseInt(item.qty_ordered) || 0;
        const bmsItem = {
          sku: item.sku,
          qty: skipPackQty ? qtyBase * packQty : qtyBase,
          price: Math.round((parseFloat(item.unit_price) || 0) * (skipPackQty ? 1 : packQty) * 100) / 100,
          pack_qty: packQty,
          name: item.product_name,
          supplier_sku: item.supplier_sku || null
        };
        if (discountPercent > 0) {
          bmsItem.discount_percent = discountPercent;
        }
        return bmsItem;
      });

    if (bmsItems.length === 0) {
      throw new Error('Aucun produit avec SKU valide pour créer la commande BMS');
    }

    // Bloquer si des articles n'ont pas de prix
    const itemsSansPrix = bmsItems.filter(i => !i.price || i.price === 0);
    if (itemsSansPrix.length > 0) {
      const refs = itemsSansPrix.map(i => i.supplier_sku || i.sku).join(', ');
      throw new Error(
        `${itemsSansPrix.length} article(s) sans prix unitaire : ${refs}. Renseignez leurs prix dans la commande avant d'envoyer à BMS.`
      );
    }

    // ── GARDE-FOU A (structurel, sans dépendance) : la qty postée doit être un
    // multiple de pack_qty. BMS stocke qty_packs = qty / pack_qty ; une qty non
    // divisible est arrondie et corrompt le montant (cause des bugs Highbuy ×10 /
    // qty). Un payload correct est TOUJOURS divisible (qty = nb_packs × pack_qty).
    const nonDivisible = bmsItems.filter(i => (i.pack_qty || 1) > 1 && (i.qty % i.pack_qty !== 0));
    if (nonDivisible.length > 0) {
      const refs = nonDivisible.map(i => `${i.supplier_sku || i.sku} (qty ${i.qty} / pack ${i.pack_qty})`).join(', ');
      throw new Error(
        `Envoi BMS bloqué : quantité non multiple du conditionnement pour : ${refs}. ` +
        `Cela fausserait le montant BMS. Vérifiez les quantités/pack_qty.`
      );
    }

    // ── GARDE-FOU B (réconciliation facture) : le total du payload BMS doit rester
    // du même ordre que le total HT produits lu sur le document fournisseur. Total
    // ligne BMS = (qty / pack_qty) × price. Rattrape les corruptions de facteur
    // (prefill ×pack_qty, qty ×10, pack offre compté 1 au lieu de 3…).
    // Tolérance large (10 %) ET NON serrée, car ces documents sont des PRO FORMA :
    // le tarif définitif est celui appliqué dans BMS après la vraie facture, donc un
    // écart de prix de quelques % est normal et ne doit pas bloquer l'envoi.
    // Le détail ligne à ligne est signalé en amont, dans l'écran d'import.
    // Ignoré si le document n'a pas de total (parseur sans extraction).
    const invoiceTotal = order.invoice_total_ht != null ? parseFloat(order.invoice_total_ht) : null;
    if (invoiceTotal != null && invoiceTotal > 0) {
      const payloadTotal = bmsItems.reduce(
        (sum, i) => sum + (i.qty / (i.pack_qty || 1)) * i.price, 0
      );
      const diff = Math.abs(payloadTotal - invoiceTotal);
      const tolerance = Math.max(invoiceTotal * 0.10, 0.50); // 10 % ou 0,50 €
      // L'écart n'est PAS forcément une anomalie : commander une partie seulement du
      // document (lignes retirées, quantités ajustées) le produit légitimement. On ne
      // bloque donc plus : on remonte une erreur « décidable » que l'utilisateur peut
      // lever en connaissance de cause (options.skipTotalCheck).
      if (diff > tolerance && !options.skipTotalCheck) {
        const err = new Error(
          `Le total de la commande (${payloadTotal.toFixed(2)} € HT) ne correspond pas au total ` +
          `du document fournisseur (${invoiceTotal.toFixed(2)} € HT), écart ${diff.toFixed(2)} €.\n\n` +
          `C'est normal si vous n'avez pas repris toutes les lignes du document ou si vous avez ` +
          `ajusté des quantités. Sinon, l'écart trahit une quantité ou un conditionnement erroné ` +
          `(pas une révision de tarif) — vérifiez les lignes signalées en rouge à l'import.`
        );
        err.code = 'BMS_TOTAL_MISMATCH';
        err.totals = {
          payload_total: Math.round(payloadTotal * 100) / 100,
          invoice_total: Math.round(invoiceTotal * 100) / 100,
          diff: Math.round(diff * 100) / 100
        };
        throw err;
      }
    }

    // Créer la commande dans BMS
    const bmsOrderData = {
      reference: order.order_number,
      status: 'expected',
      supplier_id: supplier.bms_id,
      warehouse_id: BMS_WAREHOUSE_ID,
      items: bmsItems
    };

    console.log('Creating BMS order:', JSON.stringify(bmsOrderData, null, 2));

    let bmsResponse;
    let skippedItems = [];
    try {
      bmsResponse = await bmsApiModel.createPurchaseOrder(bmsOrderData, bmsCredentials);
    } catch (error) {
      // Sur 500 générique, diagnostiquer les SKU non commandables dans BMS avant de remonter
      // l'erreur brute — évite d'avoir "An error occurred" sans savoir quoi corriger.
      //
      // IMPORTANT : ne PAS tester le rattachement au fournisseur. Un produit peut exister dans BMS
      // sans être lié au fournisseur de la commande (souvent lié à un autre fournisseur) et BMS
      // l'accepte quand même dans une commande d'achat (il résout le product_id via le SKU).
      // Le vrai déclencheur du 500 est un SKU que BMS ne peut pas résoudre en fiche catalogue
      // commandable. On le détecte via /advanced-stock/product/{sku}/stocks
      // (200 = commandable, 400 "Produit ... non trouvé" = non commandable).
      let recovered = false;
      if (error.message.includes('500')) {
        const checks = await Promise.all(
          bmsItems.map(item =>
            bmsApiModel.apiCall(`/advanced-stock/product/${encodeURIComponent(item.sku)}/stocks`)
            .then(() => ({ item, exists: true }))
            // 400 "non trouvé" = non commandable ; toute autre erreur (réseau, auth) ne doit pas bloquer.
            .catch(err => ({ item, exists: !/non trouv/i.test(err.message || '') }))
          )
        );
        const missing = checks.filter(c => !c.exists).map(c => c.item);
        if (missing.length > 0) {
          // Distinguer "supprimé dans BMS" de "jamais créé". BMS ne supprime pas réellement un
          // produit : il renomme son SKU en "<sku>_deleted". On interroge /supplier/products pour
          // repérer ce cas et donner le bon geste (restaurer plutôt que recréer).
          const classified = await Promise.all(
            missing.map(item =>
              bmsApiModel.apiCall(`/supplier/products?sku=${encodeURIComponent(item.sku)}`)
                .then(r => ({
                  item,
                  deleted: (r?.data ?? []).some(row => row.sku === `${item.sku}_deleted`)
                }))
                .catch(() => ({ item, deleted: false }))
            )
          );
          const anyDeleted = classified.some(c => c.deleted);
          const lines = classified.map(c => {
            const etat = c.deleted ? 'SUPPRIMÉ dans BMS → à restaurer' : 'absent du catalogue BMS → à créer';
            return `  • "${c.item.name}" (SKU : ${c.item.sku}, réf fournisseur : ${c.item.supplier_sku || '—'}) — ${etat}`;
          }).join('\n');
          const details = classified.map(c => ({
            sku: c.item.sku,
            name: c.item.name,
            supplier_sku: c.item.supplier_sku || null,
            deleted: c.deleted
          }));

          // Envoi partiel assumé par l'utilisateur : on retire les produits non commandables
          // et on renvoie la commande telle quelle. Les lignes restent dans la commande locale
          // (traçabilité / réception) ; elles ne partent simplement pas dans BMS.
          if (options.skipMissingSkus) {
            const missingSkus = new Set(missing.map(i => i.sku));
            const remaining = bmsItems.filter(i => !missingSkus.has(i.sku));
            if (remaining.length === 0) {
              throw new Error(
                `Aucun produit de cette commande n'est commandable dans BMS :\n${lines}\n\n` +
                `Créez-les dans BMS avant d'envoyer la commande.`
              );
            }
            console.log(
              `Envoi BMS partiel : ${missing.length} produit(s) non commandable(s) exclu(s) — ` +
              `${[...missingSkus].join(', ')}`
            );
            try {
              bmsResponse = await bmsApiModel.createPurchaseOrder(
                { ...bmsOrderData, items: remaining },
                bmsCredentials
              );
            } catch (retryError) {
              throw purchaseOrderModel.enrichBmsItemError(retryError, remaining);
            }
            skippedItems = details;
            recovered = true;

            // Trace durable de l'envoi partiel : les lignes exclues seront écrasées dans
            // purchase_order_items à la prochaine syncFromBMS (elle remplace les items par
            // ceux de BMS), mais `notes` n'est pas touché par la sync.
            await client.query(`
              UPDATE purchase_orders
              SET notes = CASE WHEN notes IS NULL OR notes = '' THEN $2 ELSE notes || E'\n' || $2 END,
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = $1
            `, [
              order.id,
              `[Envoi BMS partiel du ${new Date().toISOString().split('T')[0]} : ` +
              `${details.length} produit(s) non envoyé(s), absents du catalogue BMS — ` +
              `${details.map(d => d.sku).join(', ')}]`
            ]);
          } else {
            // Erreur "décidable" : le front propose d'envoyer quand même sans ces produits.
            const err = new Error(
              `${classified.length} produit(s) non commandable(s) dans BMS :\n${lines}\n\n` +
              (anyDeleted
                ? 'Restaurez (ou recréez) ces produits dans BMS puis renvoyez la commande,'
                : 'Créez ces produits dans BMS puis renvoyez la commande,') +
              ` ou envoyez la commande sans ${classified.length > 1 ? 'ces produits' : 'ce produit'}.`
            );
            err.code = 'BMS_MISSING_PRODUCTS';
            err.missingSkus = details;
            err.sendableCount = bmsItems.length - missing.length;
            throw err;
          }
        }
      }
      if (!recovered) {
        throw purchaseOrderModel.enrichBmsItemError(error, bmsItems);
      }
    }
    console.log('BMS response:', JSON.stringify(bmsResponse, null, 2));

    return {
      bms_po_id: bmsResponse.id || null,
      bms_reference: bmsResponse.reference || null,
      skipped_items: skippedItems
    };
  },

  // Réécrit une erreur de validation BMS de la forme "items.<index>.<champ>" en
  // identifiant le produit concerné (SKU, nom, référence fournisseur), pour que
  // l'utilisateur sache immédiatement quelle ligne corriger, quel que soit le fournisseur.
  enrichBmsItemError: (error, bmsItems) => {
    const match = error.message?.match(/BMS API error: \d+ - (\{.*\})/s);
    if (!match) return error;

    let parsed;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      return error;
    }

    const fieldErrors = parsed?.errors;
    if (!fieldErrors || typeof fieldErrors !== 'object') return error;

    const byIndex = new Map();
    for (const [field, messages] of Object.entries(fieldErrors)) {
      const fieldMatch = field.match(/^items\.(\d+)\./);
      if (!fieldMatch) continue;

      const index = parseInt(fieldMatch[1], 10);
      const item = bmsItems[index];
      if (!item) continue;

      if (!byIndex.has(index)) {
        byIndex.set(index, {
          label: `"${item.name}" (SKU ${item.sku}${item.supplier_sku ? `, réf. fournisseur ${item.supplier_sku}` : ''})`,
          details: new Set()
        });
      }
      const detail = Array.isArray(messages) ? messages.join(' ') : String(messages);
      byIndex.get(index).details.add(detail);
    }

    if (byIndex.size === 0) return error;

    const lines = [...byIndex.values()].map(
      ({ label, details }) => `${label} : ${[...details].join(' ')}`
    );

    return new Error(
      `Erreur BMS, produit(s) à corriger dans la commande avant l'envoi : ${lines.join(' | ')}`
    );
  },

  // Mettre à jour une commande (fournisseur, notes, date, lignes)
  update: async (id, data) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Mettre à jour les champs de la commande
      const fields = [];
      const values = [id];
      let paramIndex = 2;

      if (data.supplier_id !== undefined) {
        fields.push(`supplier_id = $${paramIndex++}`);
        values.push(data.supplier_id);
      }
      if (data.notes !== undefined) {
        fields.push(`notes = $${paramIndex++}`);
        values.push(data.notes);
      }
      if (data.order_date !== undefined) {
        fields.push(`order_date = $${paramIndex++}`);
        values.push(data.order_date);
      }
      if (data.expected_date !== undefined) {
        fields.push(`expected_date = $${paramIndex++}`);
        values.push(data.expected_date);
      }

      if (fields.length > 0) {
        fields.push(`updated_at = CURRENT_TIMESTAMP`);
        await client.query(
          `UPDATE purchase_orders SET ${fields.join(', ')} WHERE id = $1`,
          values
        );
      }

      // Mettre à jour les lignes existantes
      if (data.items) {
        // Fournisseur de la commande (après une éventuelle réaffectation ci-dessus) :
        // sert à savoir si les nouvelles lignes se comptent en packs (units_per_qty)
        const supplierResult = await client.query(
          `SELECT s.id, s.code
           FROM purchase_orders po
           JOIN suppliers s ON s.id = po.supplier_id
           WHERE po.id = $1`,
          [id]
        );
        const orderSupplier = supplierResult.rows[0] || null;

        for (const item of data.items) {
          if (item._delete) {
            await client.query(
              'DELETE FROM purchase_order_items WHERE id = $1 AND purchase_order_id = $2',
              [item.id, id]
            );
          } else if (item.id) {
            // Mise à jour d'une ligne existante
            await client.query(`
              UPDATE purchase_order_items
              SET qty_ordered = $1, unit_price = $2, updated_at = CURRENT_TIMESTAMP
              WHERE id = $3 AND purchase_order_id = $4
            `, [item.qty_ordered, item.unit_price ?? null, item.id, id]);
          } else {
            // Nouvelle ligne — units_per_qty selon le fournisseur de la commande
            // (« à l'unité » ⇒ qty_ordered en packs, cf. create/syncFromBMS)
            const productResult = await client.query(
              `SELECT p.id, p.sku, ps.pack_qty
               FROM products p
               LEFT JOIN product_suppliers ps ON ps.product_id = p.id AND ps.supplier_id = $2
               WHERE p.wp_product_id = $1 OR p.id = $1
               ORDER BY CASE WHEN p.wp_product_id = $1 THEN 0 ELSE 1 END
               LIMIT 1`,
              [item.product_id, orderSupplier?.id || null]
            );
            const product = productResult.rows[0];
            if (!product) continue;

            const unitsPerQty = parserRegistry.skipsPackQty(orderSupplier?.code)
              ? Math.max(parseInt(product.pack_qty) || 1, 1)
              : 1;

            await client.query(`
              INSERT INTO purchase_order_items (
                purchase_order_id, product_id, supplier_sku, product_name,
                qty_ordered, unit_price, qty_received, units_per_qty
              ) VALUES ($1, $2, $3, $4, $5, $6, 0, $7)
            `, [
              id,
              product.id,
              item.supplier_sku || product.sku || null,
              item.product_name,
              item.qty_ordered,
              item.unit_price ?? null,
              unitsPerQty
            ]);
          }
        }

        // Recalculer les totaux
        const totalsResult = await client.query(`
          SELECT
            COUNT(*) FILTER (WHERE item_type IS DISTINCT FROM 'discount') as total_items,
            COALESCE(SUM(qty_ordered) FILTER (WHERE item_type IS DISTINCT FROM 'discount'), 0) as total_qty,
            COALESCE(SUM(qty_ordered * COALESCE(unit_price, 0)), 0) as total_amount
          FROM purchase_order_items
          WHERE purchase_order_id = $1
        `, [id]);

        const t = totalsResult.rows[0];
        await client.query(`
          UPDATE purchase_orders
          SET total_items = $2, total_qty = $3, total_amount = $4, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `, [id, t.total_items, t.total_qty, t.total_amount]);
      }

      await client.query('COMMIT');
      return purchaseOrderModel.getById(id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // Mettre à jour le statut d'une commande
  updateStatus: async (id, status, additionalData = {}) => {
    let query = `
      UPDATE purchase_orders
      SET status = $2, updated_at = CURRENT_TIMESTAMP
    `;
    const values = [id, status];
    let paramIndex = 3;

    if (status === 'sent' && !additionalData.order_date) {
      query += `, order_date = CURRENT_TIMESTAMP`;
    }

    if (additionalData.order_date) {
      query += `, order_date = $${paramIndex++}`;
      values.push(additionalData.order_date);
    }

    if (additionalData.expected_date) {
      query += `, expected_date = $${paramIndex++}`;
      values.push(additionalData.expected_date);
    }

    if (status === 'received') {
      query += `, received_date = CURRENT_TIMESTAMP`;
    }

    if (additionalData.notes) {
      query += `, notes = $${paramIndex++}`;
      values.push(additionalData.notes);
    }

    query += ' WHERE id = $1 RETURNING *';

    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // Mettre à jour les quantités reçues
  updateReceivedQty: async (orderId, itemId, qtyReceived) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Mettre à jour la ligne
      await client.query(`
        UPDATE purchase_order_items
        SET qty_received = $3, updated_at = CURRENT_TIMESTAMP
        WHERE purchase_order_id = $1 AND id = $2
      `, [orderId, itemId, qtyReceived]);

      // Vérifier si toutes les lignes sont reçues
      const checkQuery = `
        SELECT
          COUNT(*) as total_items,
          COUNT(*) FILTER (WHERE qty_received >= qty_ordered) as received_items,
          COUNT(*) FILTER (WHERE qty_received > 0 AND qty_received < qty_ordered) as partial_items
        FROM purchase_order_items
        WHERE purchase_order_id = $1
      `;
      const checkResult = await client.query(checkQuery, [orderId]);
      const { total_items, received_items, partial_items } = checkResult.rows[0];

      // Mettre à jour le statut de la commande
      let newStatus;
      if (received_items == total_items) {
        newStatus = 'received';
      } else if (received_items > 0 || partial_items > 0) {
        newStatus = 'partial';
      }

      if (newStatus) {
        await client.query(`
          UPDATE purchase_orders
          SET status = $2, updated_at = CURRENT_TIMESTAMP
          ${newStatus === 'received' ? ', received_date = CURRENT_TIMESTAMP' : ''}
          WHERE id = $1
        `, [orderId, newStatus]);
      }

      await client.query('COMMIT');

      return purchaseOrderModel.getById(orderId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // Supprimer une commande (seulement si draft)
  delete: async (id) => {
    // Supprimer les items d'abord (FK)
    await pool.query('DELETE FROM purchase_order_items WHERE purchase_order_id = $1', [id]);
    const result = await pool.query(`
      DELETE FROM purchase_orders
      WHERE id = $1
      RETURNING *
    `, [id]);
    return result.rows[0];
  },

  // Récupérer les commandes en cours pour un produit (pour calculer "en arrivage")
  // qty_ordered/qty_received sont exprimés en UNITÉS de stock (× units_per_qty
  // pour les lignes comptées en packs, cf. migration add_units_per_qty_*)
  getPendingForProduct: async (productId) => {
    const query = `
      SELECT
        poi.qty_ordered * COALESCE(poi.units_per_qty, 1) AS qty_ordered,
        poi.qty_received * COALESCE(poi.units_per_qty, 1) AS qty_received,
        po.order_number,
        po.status,
        po.expected_date
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.purchase_order_id = po.id
      WHERE poi.product_id = $1
        AND po.status IN ('sent', 'confirmed', 'shipped', 'partial')
    `;
    const result = await pool.query(query, [productId]);
    return result.rows;
  },

  // Calculer le total en arrivage pour un produit
  getIncomingQty: async (productId) => {
    const query = `
      SELECT COALESCE(SUM((poi.qty_ordered - poi.qty_received) * COALESCE(poi.units_per_qty, 1)), 0) as incoming_qty
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.purchase_order_id = po.id
      WHERE poi.product_id = $1
        AND po.status IN ('sent', 'confirmed', 'shipped', 'partial')
    `;
    const result = await pool.query(query, [productId]);
    return parseInt(result.rows[0].incoming_qty) || 0;
  },

  // ==================== SYNC BMS ====================

  /**
   * Synchroniser les commandes fournisseur depuis BMS
   * - Filtre incremental par created_at >= last_sync_at
   * - Déduplication par bms_po_id (ON CONFLICT)
   * - Met à jour product_suppliers (prix achat + fournisseur) depuis les items
   */
  syncFromBMS: async () => {
    // 1. Lire la date du dernier import
    const configResult = await pool.query(
      "SELECT config_value FROM app_config WHERE config_key = 'bms_last_po_sync_at'"
    );
    const lastSyncAt = configResult.rows[0]?.config_value || '2000-01-01T00:00:00.000Z';

    // 2. Récupérer toutes les commandes BMS
    const allOrders = await bmsApiModel.getPurchaseOrders();

    // Ensemble des ids BMS actuellement existants (liste complète, avant filtre incrémental).
    // Sert à réconcilier les suppressions : une commande absente de cet ensemble a été
    // supprimée côté BMS (l'annulation, elle, reste renvoyée avec status='cancelled').
    const existingBmsIds = new Set(allOrders.map(o => parseInt(o.id)).filter(Number.isFinite));

    // Filtrer : commandes créées OU mises à jour >= dernière sync
    const lastSyncDate = new Date(lastSyncAt);
    const orders = allOrders.filter(o => {
      const created = o.created_at ? new Date(o.created_at) : null;
      const updated = o.updated_at ? new Date(o.updated_at) : null;
      return (created && created >= lastSyncDate) || (updated && updated >= lastSyncDate);
    });

    // 2bis. Réconcilier les suppressions BMS : toute commande locale liée à BMS,
    // encore dans un statut non terminé, dont l'id n'existe plus côté BMS, est
    // marquée 'cancelled' pour ne plus être comptée « en attente / en arrivage ».
    // Garde-fou : ne rien faire si la liste BMS est vide (échec/API partielle).
    let reconciled = 0;
    if (existingBmsIds.size > 0) {
      const reconcileResult = await pool.query(`
        UPDATE purchase_orders
        SET status = 'cancelled',
            notes = COALESCE(notes, '') || ' [auto: supprimée de BMS le ' || to_char(CURRENT_DATE, 'YYYY-MM-DD') || ']',
            updated_at = CURRENT_TIMESTAMP
        WHERE bms_po_id IS NOT NULL
          AND status IN ('draft', 'sent', 'confirmed', 'shipped', 'partial')
          AND NOT (bms_po_id = ANY($1::int[]))
        RETURNING id
      `, [Array.from(existingBmsIds)]);
      reconciled = reconcileResult.rowCount;
    }

    if (orders.length === 0) {
      return { total: 0, created: 0, updated: 0, skipped: 0, reconciled, orders: [] };
    }

    // 3. Charger le mapping bms_id → supplier local (en une seule requête)
    const suppliersResult = await pool.query(
      'SELECT id, bms_id, code FROM suppliers WHERE bms_id IS NOT NULL'
    );
    const supplierByBmsId = new Map(suppliersResult.rows.map(s => [s.bms_id, s.id]));
    // Fournisseurs « à l'unité » (Highbuy, LCA…) : leur PO BMS a un prix DÉJÀ unitaire
    // et une qty DÉJÀ en unités. Ne PAS appliquer la désambiguïsation prix pack /
    // qty × pack_qty ci-dessous, qui diviserait le prix par pack_qty (bug ÷10 : le
    // 7,90 relu deviendrait 0,79). Set des supplier_id locaux concernés.
    const skipPackQtySupplierIds = new Set(
      suppliersResult.rows.filter(s => parserRegistry.skipsPackQty(s.code)).map(s => s.id)
    );

    // 4. Charger le mapping sku → product.id local (en une seule requête)
    //    wc_cog_cost sert d'ancre pour désambiguïser la convention de prix BMS
    //    (prix par unité vs prix par pack), cf. insertion des items ci-dessous.
    const productsResult = await pool.query(`
      SELECT p.id, p.sku, p.product_type, p.wc_cog_cost
      FROM products p
      WHERE p.sku IS NOT NULL AND p.sku != '' AND p.post_status = 'publish'
    `);
    const productBySku = new Map(productsResult.rows.map(p => [p.sku, p.id]));
    const wcogBySku = new Map(
      productsResult.rows
        .filter(p => p.wc_cog_cost != null && parseFloat(p.wc_cog_cost) > 0)
        .map(p => [p.sku, parseFloat(p.wc_cog_cost)])
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let created = 0;
      let updated = 0;
      let skipped = 0;
      const results = [];

      // Mapping statut BMS → statut local
      const statusMap = {
        draft: 'draft',
        confirmed: 'confirmed',
        expected: 'confirmed', // Attendu = en attente de réception
        cancelled: 'cancelled',
        partial: 'partial',
        shipped: 'shipped'
      };

      for (const bmsOrder of orders) {
        const supplierId = supplierByBmsId.get(bmsOrder.supplier_id);
        if (!supplierId) {
          skipped++;
          continue; // Fournisseur BMS inconnu localement
        }

        const bmsReference = String(bmsOrder.reference);
        const items = bmsOrder.items || [];

        // Calculer les totaux réels (qty × qty_pack) pour déterminer le statut
        const totalOrdered = items.reduce((s, i) => s + (parseInt(i.qty) || 0) * (parseInt(i.qty_pack) || 1), 0);
        const totalReceived = items.reduce((s, i) => s + (parseInt(i.qty_received) || 0) * (parseInt(i.qty_pack) || 1), 0);

        let status;
        if (bmsOrder.status === 'complete') {
          // BMS considère la commande terminée (close), même si certains articles
          // n'ont pas été réceptionnés : on reflète fidèlement ce statut "Terminée"
          // plutôt que de le déduire des quantités reçues.
          status = 'completed';
        } else if (bmsOrder.status === 'expected') {
          // Attendu sans aucune réception → confirmed, avec réception partielle → partial
          status = totalReceived > 0 ? 'partial' : 'confirmed';
        } else {
          status = statusMap[bmsOrder.status] || 'sent';
        }

        // Upsert de la commande
        const orderQuery = `
          INSERT INTO purchase_orders (
            order_number, supplier_id, status,
            bms_po_id, bms_reference,
            order_date, expected_date, received_date,
            total_items, total_qty, total_amount,
            notes, verified
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          ON CONFLICT (bms_po_id) DO UPDATE SET
            status = EXCLUDED.status,
            bms_reference = EXCLUDED.bms_reference,
            expected_date = EXCLUDED.expected_date,
            received_date = EXCLUDED.received_date,
            total_items = EXCLUDED.total_items,
            total_qty = EXCLUDED.total_qty,
            total_amount = EXCLUDED.total_amount,
            verified = EXCLUDED.verified,
            updated_at = CURRENT_TIMESTAMP
          RETURNING id, (xmax = 0) AS inserted
        `;
        const totalQty = items.reduce((s, i) => s + (parseInt(i.qty) || 0), 0);
        const totalAmount = parseFloat(bmsOrder.grandtotal) || 0;

        // Pour les commandes complètes, updated_at BMS est la meilleure approximation de la date de réception
        const receivedDate = (bmsOrder.status === 'complete' && bmsOrder.updated_at) ? bmsOrder.updated_at : null;

        const orderResult = await client.query(orderQuery, [
          `BMS-${bmsOrder.id}`,             // order_number (basé sur l'id BMS, toujours unique)
          supplierId,                       // supplier_id
          status,                           // status
          bmsOrder.id,                      // bms_po_id
          bmsReference,                     // bms_reference
          bmsOrder.created_at || null,      // order_date (date de création de la commande)
          bmsOrder.eta || null,             // expected_date
          receivedDate,                     // received_date (updated_at BMS si complete)
          items.length,                     // total_items
          totalQty,                         // total_qty
          totalAmount,                      // total_amount
          bmsOrder.private_comments || null,// notes
          // BMS renvoie verified = 1/0 (number) au niveau commande ; null si absent
          bmsOrder.verified == null ? null : !!Number(bmsOrder.verified) // verified
        ]);

        const { id: poId, inserted } = orderResult.rows[0];

        if (inserted) {
          created++;
        } else {
          updated++;
          // Supprimer les anciens items pour les remplacer
          await client.query('DELETE FROM purchase_order_items WHERE purchase_order_id = $1', [poId]);
        }

        // Insérer les items
        for (const item of items) {
          const productId = productBySku.get(item.sku) || null; // NULL si SKU inconnu, on garde quand même la ligne
          const priceRaw = parseFloat(item.price) || null;
          const qtyPack = parseInt(item.qty_pack) || 1;
          const bmsQty = parseInt(item.qty) || 0;
          const bmsQtyRecv = parseInt(item.qty_received) || 0;

          // BMS est INCOHÉRENT sur la convention de prix quand qty_pack > 1 :
          //  - certains fournisseurs (ex. Curieux) envoient item.price = prix du PACK
          //    et item.qty en PACKS  → prix unitaire = price / qty_pack, unités = qty × qty_pack
          //  - d'autres (ex. Cosmer) envoient item.price = prix UNITAIRE
          //    et item.qty en UNITÉS → stocker tel quel
          // Aucun champ BMS ne les distingue de façon fiable. La convention DOMINANTE
          // est « prix du pack » (~95 % des lignes) → c'est le défaut. On ne bascule en
          // « prix unitaire » QUE si wc_cog_cost le désigne NETTEMENT (au moins ~2× plus
          // proche, marge ln2). wc_cog_cost n'est utilisé QUE comme départage grossier
          // (jamais comme valeur de coût — le coût stocké reste le prix d'achat BMS) :
          // une imprécision de wc_cog (remises sur facture) ne peut donc pas faire
          // basculer une décision, qui n'arrive que sur un écart franc (5-10×).
          // Le montant total (qty × price) est identique dans les deux interprétations.
          // BMS compte TOUJOURS en packs : les unités physiques d'une ligne valent
          // qty × qty_pack (cf. totalOrdered/totalReceived ci-dessus et createInBMS).
          // Quand on ne convertit pas qty_ordered (prix laissé au pack), la ligne
          // reste comptée en packs : units_per_qty porte alors le facteur, pour que
          // les calculs de stock (arrivages, besoins) retrouvent les unités.
          let unitPrice, qtyOrdered, qtyReceived, unitsPerQty;
          if (priceRaw === null || qtyPack <= 1 || skipPackQtySupplierIds.has(supplierId)) {
            unitPrice = priceRaw;               // pas d'ambiguïté (ou fournisseur « à l'unité »)
            qtyOrdered = bmsQty;
            qtyReceived = bmsQtyRecv;
            unitsPerQty = qtyPack;
          } else {
            const unitAsIs  = priceRaw;             // interprétation « prix déjà unitaire »
            const unitAsPack = priceRaw / qtyPack;  // interprétation « prix du pack »
            const wcog = wcogBySku.get(item.sku);
            let usePack = true; // défaut : convention dominante « prix du pack »
            if (wcog) {
              const dPack = Math.abs(Math.log(unitAsPack / wcog));
              const dAsIs = Math.abs(Math.log(unitAsIs / wcog));
              // Basculer en prix unitaire seulement si nettement plus proche du coût connu
              if (dAsIs + Math.LN2 < dPack) usePack = false;
            }
            if (usePack) {
              unitPrice = unitAsPack;
              qtyOrdered = bmsQty * qtyPack;
              qtyReceived = bmsQtyRecv * qtyPack;
              unitsPerQty = 1;                  // qty_ordered déjà converti en unités
            } else {
              unitPrice = unitAsIs;
              qtyOrdered = bmsQty;
              qtyReceived = bmsQtyRecv;
              unitsPerQty = qtyPack;
            }
          }

          await client.query(`
            INSERT INTO purchase_order_items (
              purchase_order_id, product_id, supplier_sku,
              product_name, qty_ordered, qty_received, unit_price, units_per_qty
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [
            poId,
            productId,
            item.supplier_sku || item.sku || null,
            item.name || null,
            qtyOrdered,
            qtyReceived,
            unitPrice,
            Math.max(parseInt(unitsPerQty) || 1, 1)
          ]);

        }

        results.push({
          id: poId,
          bms_po_id: bmsOrder.id,
          reference: bmsReference,
          supplier: bmsOrder.supplier_name,
          action: inserted ? 'created' : 'updated'
        });
      }

      // 5. Mettre à jour la date du dernier import (maintenant)
      await client.query(`
        INSERT INTO app_config (config_key, config_value)
        VALUES ('bms_last_po_sync_at', $1)
        ON CONFLICT (config_key) DO UPDATE SET config_value = $1, updated_at = CURRENT_TIMESTAMP
      `, [new Date().toISOString()]);

      await client.query('COMMIT');

      return {
        total: orders.length,
        created,
        updated,
        skipped,
        reconciled,
        orders: results
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Récupérer la date du dernier import BMS
   */
  getLastBmsSyncAt: async () => {
    const result = await pool.query(
      "SELECT config_value FROM app_config WHERE config_key = 'bms_last_po_sync_at'"
    );
    const val = result.rows[0]?.config_value;
    return val === '2000-01-01T00:00:00.000Z' ? null : val;
  },

  /**
   * Récupérer la date du dernier import réceptions BMS
   */
  getLastBmsReceptionSyncAt: async () => {
    const result = await pool.query(
      "SELECT config_value FROM app_config WHERE config_key = 'bms_last_reception_sync_at'"
    );
    const val = result.rows[0]?.config_value;
    return val === '2000-01-01T00:00:00.000Z' ? null : val;
  },

  /**
   * Synchroniser les réceptions depuis BMS
   * Pour chaque réception BMS :
   * - Retrouve la commande locale via bms_reference
   * - Met à jour qty_received sur chaque ligne via SKU
   * - Met à jour received_date et status (received/partial)
   */
  syncReceptionsFromBMS: async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Récupérer la date du dernier import réceptions
      const configResult = await client.query(
        "SELECT config_value FROM app_config WHERE config_key = 'bms_last_reception_sync_at'"
      );
      const lastSyncAt = configResult.rows[0]?.config_value || '2000-01-01T00:00:00.000Z';

      // 2. Récupérer toutes les réceptions BMS
      const allReceptions = await bmsApiModel.getReceptions();

      // 3. Filtrer par date (incrémental)
      const receptions = allReceptions.filter(r =>
        !r.created_at || new Date(r.created_at) >= new Date(lastSyncAt)
      );

      // 4. Charger toutes les commandes locales avec leur bms_reference (non-ambigus uniquement)
      // On exclut les bms_reference qui apparaissent plusieurs fois
      const poResult = await client.query(`
        SELECT id, bms_reference, status
        FROM purchase_orders
        WHERE bms_reference IS NOT NULL
          AND bms_po_id IS NOT NULL
          AND bms_reference IN (
            SELECT bms_reference FROM purchase_orders GROUP BY bms_reference HAVING COUNT(*) = 1
          )
      `);
      const orderByRef = new Map(poResult.rows.map(r => [r.bms_reference, r]));

      // 5. Charger les produits (sku → product_id) pour les lignes de commande
      const productsResult = await client.query(
        'SELECT wp_product_id as id, sku FROM products WHERE sku IS NOT NULL AND sku != \'\''
      );
      const productBySku = new Map(productsResult.rows.map(r => [r.sku, r.id]));

      let processed = 0;
      let skipped = 0;
      let updatedOrders = 0;

      for (const reception of receptions) {
        const bmsRef = reception.purchase_order;
        const order = orderByRef.get(bmsRef);

        if (!order) {
          skipped++;
          continue; // Commande inconnue ou référence ambiguë
        }

        const orderId = order.id;
        const receptionDate = reception.created_at || null;
        const items = reception.items || [];

        // Mettre à jour qty_received pour chaque ligne de réception
        for (const rItem of items) {
          const productId = productBySku.get(rItem.sku);
          if (!productId) continue;

          // Additionner les quantités reçues (une commande peut avoir plusieurs réceptions partielles)
          await client.query(`
            UPDATE purchase_order_items
            SET qty_received = LEAST(qty_ordered, qty_received + $1)
            WHERE purchase_order_id = $2 AND product_id = $3
          `, [parseInt(rItem.qty) || 0, orderId, productId]);
        }

        // Recalculer le statut de la commande
        const itemsResult = await client.query(`
          SELECT
            SUM(qty_ordered) as total_ordered,
            SUM(qty_received) as total_received
          FROM purchase_order_items
          WHERE purchase_order_id = $1
        `, [orderId]);

        const totalOrdered = parseInt(itemsResult.rows[0]?.total_ordered) || 0;
        const totalReceived = parseInt(itemsResult.rows[0]?.total_received) || 0;

        let newStatus = order.status;
        if (totalReceived >= totalOrdered && totalOrdered > 0) {
          newStatus = 'received';
        } else if (totalReceived > 0) {
          newStatus = 'partial';
        }

        // Mettre à jour le statut et la date de réception
        if (newStatus !== order.status || receptionDate) {
          await client.query(`
            UPDATE purchase_orders
            SET
              status = $1,
              received_date = COALESCE(received_date, $2),
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
          `, [newStatus, receptionDate, orderId]);
          updatedOrders++;
        }

        processed++;
      }

      // 6. Mettre à jour la date du dernier import réceptions
      await client.query(`
        INSERT INTO app_config (config_key, config_value)
        VALUES ('bms_last_reception_sync_at', $1)
        ON CONFLICT (config_key) DO UPDATE SET config_value = $1, updated_at = CURRENT_TIMESTAMP
      `, [new Date().toISOString()]);

      await client.query('COMMIT');

      return {
        total: receptions.length,
        processed,
        skipped,
        updatedOrders
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // Historique des commandes pour un produit chez un fournisseur
  getByProductAndSupplier: async (productId, supplierId) => {
    const query = `
      SELECT
        po.id as order_id,
        po.order_number,
        po.bms_reference,
        po.order_date,
        po.status,
        poi.qty_ordered,
        poi.qty_received,
        poi.unit_price
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.purchase_order_id = po.id
      WHERE poi.product_id = $1
        AND po.supplier_id = $2
      ORDER BY po.order_date DESC NULLS LAST, po.created_at DESC
    `;
    const result = await pool.query(query, [productId, supplierId]);
    return result.rows;
  },

  /**
   * Dernier tarif VALIDÉ (commande vérifiée) par produit, pour un fournisseur.
   * Utilisé à l'import pour proposer le dernier prix réellement validé plutôt
   * que computed_cost/wc_cog_cost (souvent obsolète).
   *
   * productIds = liste de wp_product_id (cf. /products/search qui renvoie le
   * wp_product_id en `id`, et la page d'import qui l'utilise partout). On résout
   * wp_product_id → products.id avant de joindre les lignes de commande. On ne
   * retient que les commandes verified = true et les prix > 0. Retourne, par
   * wp_product_id fourni, la ligne la plus récente.
   *
   * IMPORTANT — convention pack, DÉPEND DU FOURNISSEUR (cf. createInBMS) :
   *   - skipPackQty (Highbuy, LCA…) : createInBMS envoie price = unit_price tel quel
   *     → le prefill doit renvoyer LE PRIX DU PACK. Comme poi.unit_price de ces
   *     commandes peut être corrompu (÷pack_qty par d'anciennes syncs), on prend
   *     supplier_price (vrai prix pack catalogue) en priorité, sinon unit_price×pack.
   *   - fournisseurs normaux (JoshNoa…) : createInBMS envoie price = unit_price ×
   *     pack_qty → le prefill doit renvoyer LE PRIX PAR UNITÉ (= poi.unit_price tel
   *     quel). Renvoyer le prix pack ici donnerait price ×pack_qty en trop (bug :
   *     24,50 €/pack de 5 → 122,50 € envoyé à BMS).
   *
   * @returns {Object} map { [wpProductId]: { unit_price, order_date, bms_reference } }
   */
  getLastVerifiedPrices: async (supplierId, productIds) => {
    if (!Array.isArray(productIds) || productIds.length === 0) return {};

    // skipPackQty (Highbuy, LCA…) : renvoyer le prix DU PACK ; normaux (JoshNoa…) :
    // renvoyer le prix PAR UNITÉ (cf. doc ci-dessus, dépend de createInBMS).
    const supRes = await pool.query('SELECT code FROM suppliers WHERE id = $1', [supplierId]);
    const supplierCode = supRes.rows[0]?.code;

    const query = `
      SELECT DISTINCT ON (p.wp_product_id)
        p.wp_product_id AS input_id,
        poi.unit_price,
        ps.pack_qty,
        ps.supplier_price,
        po.order_date,
        po.bms_reference
      FROM products p
      JOIN purchase_order_items poi ON poi.product_id = p.id
      JOIN purchase_orders po ON po.id = poi.purchase_order_id
      LEFT JOIN product_suppliers ps
        ON ps.product_id = p.id AND ps.supplier_id = $1
      WHERE p.wp_product_id = ANY($2::bigint[])
        AND po.supplier_id = $1
        AND po.verified = true
        AND poi.unit_price IS NOT NULL
        AND poi.unit_price > 0
      ORDER BY p.wp_product_id, po.order_date DESC NULLS LAST, po.id DESC
    `;

    const ids = productIds.map(id => parseInt(id)).filter(Number.isFinite);
    if (ids.length === 0) return {};

    const result = await pool.query(query, [supplierId, ids]);
    const map = {};
    for (const row of result.rows) {
      // Conversion pack/unité mutualisée avec la colonne « Tarif achat » des Besoins.
      const price = normalizeVerifiedPrice({
        supplierCode,
        unitPrice: row.unit_price,
        packQty: row.pack_qty,
        supplierPrice: row.supplier_price,
      });
      if (price == null) continue;
      map[row.input_id] = {
        unit_price: price,
        order_date: row.order_date,
        bms_reference: row.bms_reference,
      };
    }
    return map;
  }
};

module.exports = purchaseOrderModel;
