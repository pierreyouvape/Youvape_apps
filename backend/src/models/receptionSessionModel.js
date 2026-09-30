/**
 * Une réception, de son ouverture à son envoi dans BMS.
 *
 * TOUT EST COMPTÉ EN PIÈCES, jamais en packs. C'est la règle qui gouverne ce
 * fichier, et elle vient d'un piège vérifié sur BMS le 29/09/2026 : la route
 * POST /v2/purchase-orders/{id}/receive ajoute au stock le nombre qu'on lui
 * envoie, LITTÉRALEMENT, mais le compare au `qty` de la ligne, qui est un
 * nombre de PACKS. Sur une ligne « 1 pack de 5 », envoyer 1 met une seule pièce
 * en stock, solde la ligne, et passe le bon de commande entier en « complete ».
 * Quatre pièces sur cinq manquent, et rien ne le signale.
 *
 * BMS n'a aucun garde-fou : il a accepté sans broncher une réception de 5 sur
 * une ligne commandée à 1. Le contrôle est donc entièrement de notre côté.
 *
 * L'autre contrainte : la route exige l'identifiant de LA LIGNE CHEZ BMS, ni le
 * SKU ni le produit. On le relève à l'ouverture de la session, quand on lit la
 * commande dans BMS, et on le garde — sans lui, rien ne part.
 */

const pool = require('../config/database');
const bmsApiModel = require('./bmsApiModel');

/** Unités de stock attendues sur une ligne : la commande peut compter en packs. */
const UNITS_EXPECTED = 'poi.qty_ordered * COALESCE(poi.units_per_qty, 1)';

/**
 * La session en cours d'une commande, avec son comptage. `null` s'il n'y en a
 * pas — l'écran en ouvre alors une nouvelle.
 */
async function getOpenSession(purchaseOrderId, db = pool) {
  const { rows } = await db.query(
    `SELECT s.*, u.name AS started_by_name
       FROM reception_sessions s
       LEFT JOIN users u ON u.id = s.started_by
      WHERE s.purchase_order_id = $1 AND s.status = 'counting'`,
    [purchaseOrderId],
  );
  if (rows.length === 0) return null;

  const session = rows[0];
  const { rows: counts } = await db.query(
    `SELECT c.purchase_order_item_id, c.bms_line_id, c.units_counted
       FROM reception_counts c WHERE c.session_id = $1`,
    [session.id],
  );
  return { ...session, counts };
}

/**
 * Ouvre une session, ou rend celle déjà ouverte.
 *
 * L'ouverture lit la commande DANS BMS pour relever l'identifiant de chaque
 * ligne. Lire la copie locale ne suffirait pas : elle ne porte pas ces
 * identifiants, et une ligne ajoutée dans BMS depuis la dernière synchro serait
 * invisible.
 */
async function openSession(purchaseOrderId, userId, db = pool) {
  const existante = await getOpenSession(purchaseOrderId, db);
  if (existante) return existante;

  const { rows: commandes } = await db.query(
    'SELECT id, bms_po_id FROM purchase_orders WHERE id = $1',
    [purchaseOrderId],
  );
  const commande = commandes[0];
  if (!commande) throw new Error('Commande introuvable');

  const lignesBms = await fetchBmsLines(commande.bms_po_id);

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: [session] } = await client.query(
      `INSERT INTO reception_sessions (purchase_order_id, started_by)
       VALUES ($1, $2) RETURNING *`,
      [purchaseOrderId, userId || null],
    );

    const { rows: lignes } = await client.query(
      `SELECT poi.id, poi.supplier_sku, poi.product_id, ${UNITS_EXPECTED} AS units_expected
         FROM purchase_order_items poi
        WHERE poi.purchase_order_id = $1`,
      [purchaseOrderId],
    );

    for (const l of lignes) {
      await client.query(
        `INSERT INTO reception_counts (session_id, purchase_order_item_id, bms_line_id, units_counted)
         VALUES ($1, $2, $3, 0)`,
        [session.id, l.id, matchBmsLine(l, lignesBms)],
      );
    }

    await client.query('COMMIT');
    return getOpenSession(purchaseOrderId, db);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Les lignes de la commande telles que BMS les voit, avec leurs identifiants. */
async function fetchBmsLines(bmsPoId) {
  if (!bmsPoId) return [];
  const data = await bmsApiModel.apiCall(`/supplier/purchase-orders/${bmsPoId}`);
  const po = data.data || data;
  return (po.items || []).map((i) => ({
    id: i.id,
    sku: i.sku,
    supplierSku: i.supplier_sku,
    productId: i.product_id,
  }));
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Rapproche une de nos lignes de celle de BMS.
 *
 * Par la référence fournisseur d'abord, par le SKU ensuite : c'est l'ordre déjà
 * retenu pour le contrôle de facture, et pour la même raison — la référence du
 * document fait foi avant toute déduction.
 */
function matchBmsLine(ligne, lignesBms) {
  if (ligne.supplier_sku) {
    const parRef = lignesBms.find((b) => norm(b.supplierSku) === norm(ligne.supplier_sku));
    if (parRef) return parRef.id;
  }
  const parProduit = lignesBms.find((b) => b.productId && b.productId === ligne.product_id);
  return parProduit ? parProduit.id : null;
}

/**
 * Enregistre le comptage d'une ligne, en PIÈCES.
 *
 * Appelé à chaque scan : c'est ce qui rend la session reprenable. L'écran garde
 * son compteur en mémoire pour rester instantané, la base suit derrière.
 */
async function setCount(sessionId, itemId, unitsCounted, db = pool) {
  const units = Math.max(0, parseInt(unitsCounted, 10) || 0);
  const { rows } = await db.query(
    `UPDATE reception_counts
        SET units_counted = $3, updated_at = CURRENT_TIMESTAMP
      WHERE session_id = $1 AND purchase_order_item_id = $2
      RETURNING purchase_order_item_id, units_counted`,
    [sessionId, itemId, units],
  );
  if (rows.length === 0) throw new Error('Ligne absente de cette réception');
  return rows[0];
}

/**
 * Envoie la réception à BMS, puis fige ce qui est parti.
 *
 * TROIS GARDE-FOUS, parce que BMS n'en a aucun.
 *
 * 1. Rien ne part sans identifiant de ligne BMS. Une ligne non rapprochée est
 *    refusée avant tout envoi, pas ignorée en silence.
 * 2. On n'envoie QUE des pièces, et on le dit dans les commentaires plutôt que
 *    de faire confiance à qui relira. Convertir en packs remettrait le piège du
 *    29/09/2026 (envoyer 1 pour un pack de 5 solde la ligne avec une pièce).
 * 3. La sur-réception est signalée, jamais bloquée : BMS l'accepte, et un
 *    magasinier qui compte plus que commandé a souvent raison — c'est le bon de
 *    commande qui était faux. Mais il doit le voir.
 *
 * L'envoi n'est PAS rejouable : aucune route BMS ne sait annuler une réception.
 * La session passe donc en `validated` dans la même transaction, et la réponse
 * de BMS est conservée telle quelle — c'est la seule preuve de ce qui est parti.
 */
const MOTIFS = ['reliquat', 'solde', 'manquant'];

/**
 * Motifs reçus de l'écran : { [purchase_order_item_id]: 'reliquat'|'solde'|'manquant' }.
 * Normalisés et refusés s'ils sont inconnus — une valeur libre passerait la
 * contrainte de colonne en NULL et le manquant perdrait son explication.
 */
function normaliserMotifs(motifs) {
  const propre = new Map();
  for (const [itemId, valeur] of Object.entries(motifs || {})) {
    const id = parseInt(itemId, 10);
    const v = String(valeur || '').trim().toLowerCase();
    if (!Number.isFinite(id) || v === '') continue;
    if (!MOTIFS.includes(v)) throw new Error(`Motif inconnu : « ${valeur} »`);
    propre.set(id, v);
  }
  return propre;
}

async function validateSession(sessionId, userId, motifs = {}, db = pool) {
  const motifsParItem = normaliserMotifs(motifs);
  const { rows: sessions } = await db.query(
    'SELECT * FROM reception_sessions WHERE id = $1',
    [sessionId],
  );
  const session = sessions[0];
  if (!session) throw new Error('Réception introuvable');
  if (session.status !== 'counting') {
    throw new Error(`Cette réception est déjà ${session.status === 'validated' ? 'validée' : 'abandonnée'}`);
  }

  // TOUTES les lignes, y compris celles comptées à zéro : un article entièrement
  // manquant n'a rien à envoyer à BMS, mais il a un motif à donner et un mail à
  // déclencher. Ne lire que `units_counted > 0` le rendait invisible.
  const { rows: toutes } = await db.query(
    `SELECT c.purchase_order_item_id, c.bms_line_id, c.units_counted,
            poi.supplier_sku, poi.product_name, ${UNITS_EXPECTED} AS units_expected
       FROM reception_counts c
       JOIN purchase_order_items poi ON poi.id = c.purchase_order_item_id
      WHERE c.session_id = $1
      ORDER BY poi.id`,
    [sessionId],
  );
  const lignes = toutes.filter((l) => l.units_counted > 0);

  if (lignes.length === 0) throw new Error('Aucune pièce comptée : il n\'y a rien à réceptionner');

  const manquants = toutes.filter((l) => l.units_counted < Number(l.units_expected));
  const surplus = toutes.filter((l) => l.units_counted > Number(l.units_expected));

  // Le motif est exigé ICI et pas seulement à l'écran : l'API est la porte, et
  // une réception envoyée par un autre chemin perdrait l'explication du manquant.
  const sansMotif = manquants.filter((l) => !motifsParItem.has(l.purchase_order_item_id));
  if (sansMotif.length > 0) {
    throw new Error(
      'Il manque un motif (reliquat, soldé ou manquant) pour : '
      + sansMotif.map((l) => l.supplier_sku || l.product_name || `ligne ${l.purchase_order_item_id}`).join(', '),
    );
  }

  const sansLien = lignes.filter((l) => !l.bms_line_id);
  if (sansLien.length > 0) {
    throw new Error(
      'Ces lignes n\'ont pas d\'équivalent dans BMS, la réception ne peut pas partir : '
      + sansLien.map((l) => l.supplier_sku || l.product_name || `ligne ${l.purchase_order_item_id}`).join(', '),
    );
  }

  const { rows: commandes } = await db.query(
    'SELECT bms_po_id FROM purchase_orders WHERE id = $1',
    [session.purchase_order_id],
  );
  const bmsPoId = (commandes[0] || {}).bms_po_id;
  if (!bmsPoId) throw new Error('Cette commande n\'existe pas dans BMS');

  // `qty` est un nombre de PIÈCES. Voir l'en-tête du fichier.
  const reponse = await bmsApiModel.apiCall(
    `/v2/purchase-orders/${bmsPoId}/receive`,
    'POST',
    { items: lignes.map((l) => ({ id: Number(l.bms_line_id), qty: l.units_counted })) },
  );

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const l of lignes) {
      await client.query(
        'UPDATE reception_counts SET units_sent = units_counted WHERE session_id = $1 AND purchase_order_item_id = $2',
        [sessionId, l.purchase_order_item_id],
      );
      // LES PIÈCES S'AJOUTENT AUX PIÈCES. Sans détour, sans division.
      //
      // Cette requête convertissait les pièces comptées en unités de ligne —
      // `pièces / units_per_qty` — et les deux colonnes étant des entiers,
      // PostgreSQL tronquait : 23 pièces sur une ligne « par 5 » n'en
      // enregistraient que 20, et les 3 autres disparaissaient du stock comme du
      // coût de revient sans que rien ne le signale.
      //
      // `units_received` compte donc en pièces, l'unité dans laquelle on reçoit.
      // `qty_received` reste tenue à jour dans l'unité de la ligne, parce que la
      // synchro BMS l'écrit et la relit, et qu'elle sert à dire qu'une ligne est
      // soldée — mais elle n'est plus ce sur quoi on compte, et c'est pour ça
      // qu'on peut l'arrondir sans rien perdre.
      await client.query(
        `UPDATE purchase_order_items
            SET units_received = COALESCE(units_received, 0) + $2,
                qty_received = ROUND(
                  (COALESCE(units_received, 0) + $2)::numeric
                  / GREATEST(COALESCE(units_per_qty, 1), 1)
                ),
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [l.purchase_order_item_id, l.units_counted],
      );
    }
    // Les motifs des manquants, dans la même transaction que le comptage qu'ils
    // expliquent : ils ne valent que rapportés à ce qui est parti.
    for (const [itemId, motif] of motifsParItem) {
      await client.query(
        'UPDATE reception_counts SET motif = $3 WHERE session_id = $1 AND purchase_order_item_id = $2',
        [sessionId, itemId, motif],
      );
    }
    await client.query(
      `UPDATE reception_sessions
          SET status = 'validated', validated_by = $2, validated_at = CURRENT_TIMESTAMP,
              bms_response = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [sessionId, userId || null, JSON.stringify(reponse)],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    // L'envoi BMS, lui, a bien eu lieu et ne s'annule pas : on le dit.
    throw new Error(
      `La réception est PARTIE dans BMS mais n'a pas pu être enregistrée chez nous (${e.message}). `
      + 'Ne pas la renvoyer : le stock BMS est déjà à jour.',
    );
  }

  const decrire = (l) => ({
    ref: l.supplier_sku,
    product: l.product_name,
    units: l.units_counted,
    expected: Number(l.units_expected),
    ecart: l.units_counted - Number(l.units_expected),
    motif: motifsParItem.get(l.purchase_order_item_id) || null,
  });

  const resultat = {
    sent: lignes.map((l) => ({ ...decrire(l), over: l.units_counted > Number(l.units_expected) })),
    missing: manquants.map(decrire),
    over: surplus.map(decrire),
    bmsResponse: reponse,
  };

  // Les mails partent APRÈS le commit, et leur échec ne défait rien : la
  // marchandise est en stock, la réception est faite. Prévenir est utile, pas
  // critique — une panne SMTP ne doit pas faire croire à un échec de réception.
  try {
    const { previenirEcarts } = require('../services/receptionEmailService');
    await previenirEcarts({
      purchaseOrderId: session.purchase_order_id,
      manquants: resultat.missing,
      surplus: resultat.over,
    });
  } catch (e) {
    console.error('[reception] mail d\'écart non envoyé :', e.message);
  }

  return resultat;
}

/** Abandonne une session : le comptage est perdu, la commande repart à neuf. */
async function abandonSession(sessionId, db = pool) {
  const { rows } = await db.query(
    `UPDATE reception_sessions SET status = 'abandoned', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status = 'counting' RETURNING id`,
    [sessionId],
  );
  return rows.length > 0;
}

/**
 * Recharge les lignes depuis BMS, et complète la session.
 *
 * Deux façons d'ajouter un article existent, et celle-ci est la seconde. Quand
 * la ligne est créée depuis l'écran, `addLine` s'en charge de bout en bout. Ce
 * chemin-ci reprend tout le reste : ce qui a été ajouté dans l'interface de BMS
 * par quelqu'un d'autre, ou pendant que la session était ouverte.
 *
 * Il sert aussi de rattrapage quand la synchro BMS a laissé une commande en
 * réception de côté : elle ne remplace pas les lignes d'une session qui compte
 * (ça emporterait le comptage, cf. purchaseOrderModel.syncFromBMS), donc c'est
 * ici qu'on va chercher ce que BMS a de neuf.
 *
 * Ce qui remonte : les lignes que BMS a et que nous n'avons pas (insérées
 * localement), et les identifiants de ligne manquants (re-rapprochés). Rien
 * n'est supprimé : une ligne retirée de BMS mais déjà comptée chez nous ne doit
 * pas s'évaporer avec le comptage.
 */
async function refreshFromBms(sessionId, db = pool) {
  const { rows: sessions } = await db.query(
    'SELECT * FROM reception_sessions WHERE id = $1',
    [sessionId],
  );
  const session = sessions[0];
  if (!session) throw new Error('Réception introuvable');
  if (session.status !== 'counting') throw new Error('Cette réception n\'est plus en cours');

  const { rows: commandes } = await db.query(
    'SELECT id, bms_po_id FROM purchase_orders WHERE id = $1',
    [session.purchase_order_id],
  );
  const commande = commandes[0];
  if (!commande || !commande.bms_po_id) throw new Error('Cette commande n\'existe pas dans BMS');

  const lignesBms = await fetchBmsLinesFull(commande.bms_po_id);
  const client = await db.connect();
  let ajoutees = 0;
  let rapprochees = 0;

  try {
    await client.query('BEGIN');

    const { rows: locales } = await client.query(
      `SELECT poi.id, poi.supplier_sku, poi.product_id, p.sku
         FROM purchase_order_items poi
         LEFT JOIN products p ON p.id = poi.product_id
        WHERE poi.purchase_order_id = $1`,
      [session.purchase_order_id],
    );

    for (const b of lignesBms) {
      const deja = locales.find((l) => (
        (l.supplier_sku && norm(l.supplier_sku) === norm(b.supplierSku))
        || (l.sku && norm(l.sku) === norm(b.sku))
      ));
      if (deja) continue;

      // Le produit chez nous, retrouvé par son SKU — c'est la clé que BMS et
      // nous partageons.
      const { rows: produits } = await client.query(
        'SELECT id, post_title FROM products WHERE sku = $1 LIMIT 1',
        [b.sku],
      );
      const produit = produits[0];
      if (!produit) continue; // Produit inconnu de notre catalogue : on ne l'invente pas.

      // qty × qty_pack = pièces, l'invariant de toute l'app.
      const { rows: [ligne] } = await client.query(
        `INSERT INTO purchase_order_items (
           purchase_order_id, product_id, supplier_sku, product_name,
           qty_ordered, unit_price, units_per_qty
         ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          session.purchase_order_id, produit.id, b.supplierSku || null,
          b.name || produit.post_title, b.qty, b.price, b.packQty,
        ],
      );
      await client.query(
        `INSERT INTO reception_counts (session_id, purchase_order_item_id, bms_line_id, units_counted)
         VALUES ($1, $2, $3, 0)
         ON CONFLICT (session_id, purchase_order_item_id) DO NOTHING`,
        [sessionId, ligne.id, b.id],
      );
      ajoutees += 1;
    }

    // Lignes déjà connues mais jamais rapprochées : on réessaie.
    const { rows: orphelines } = await client.query(
      `SELECT c.purchase_order_item_id, poi.supplier_sku, poi.product_id
         FROM reception_counts c
         JOIN purchase_order_items poi ON poi.id = c.purchase_order_item_id
        WHERE c.session_id = $1 AND c.bms_line_id IS NULL`,
      [sessionId],
    );
    for (const o of orphelines) {
      const id = matchBmsLine(o, lignesBms);
      if (!id) continue;
      await client.query(
        'UPDATE reception_counts SET bms_line_id = $3 WHERE session_id = $1 AND purchase_order_item_id = $2',
        [sessionId, o.purchase_order_item_id, id],
      );
      rapprochees += 1;
    }

    // Une ligne de la commande jamais entrée dans la session — ajoutée à la main
    // en base, ou insérée par une synchro depuis le dernier chargement.
    const { rowCount: recuperees } = await client.query(
      `INSERT INTO reception_counts (session_id, purchase_order_item_id, bms_line_id, units_counted)
       SELECT $1, poi.id, NULL, 0
         FROM purchase_order_items poi
        WHERE poi.purchase_order_id = $2
          AND NOT EXISTS (
            SELECT 1 FROM reception_counts c
             WHERE c.session_id = $1 AND c.purchase_order_item_id = poi.id)`,
      [sessionId, session.purchase_order_id],
    );

    await client.query('COMMIT');
    return { added: ajoutees, matched: rapprochees, recovered: recuperees };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Les lignes BMS avec tout ce qu'il faut pour en créer une chez nous. */
async function fetchBmsLinesFull(bmsPoId) {
  const data = await bmsApiModel.apiCall(`/supplier/purchase-orders/${bmsPoId}`);
  const po = data.data || data;
  return (po.items || []).map((i) => ({
    id: i.id,
    sku: i.sku,
    supplierSku: i.supplier_sku,
    productId: i.product_id,
    name: i.name,
    qty: parseInt(i.qty, 10) || 0,
    packQty: parseInt(i.qty_pack, 10) || 1,
    price: i.price == null ? null : parseFloat(i.price),
  }));
}

/**
 * L'identifiant BMS d'un produit, retrouvé par son SKU.
 *
 * `/supplier/products?sku=…` renvoie les associations fournisseur × produit, et
 * c'est le seul endroit où lire le `product_id` de BMS : nous ne le stockons
 * pas. Avec le fournisseur, c'est une ligne ; sans lui, toutes celles qui
 * portent ce SKU — n'importe laquelle donne le même `product_id`, puisqu'il
 * désigne le produit et non l'association.
 */
async function trouverProduitBms(sku, bmsSupplierId) {
  const parFournisseur = bmsSupplierId
    ? await bmsApiModel.getSupplierProducts(bmsSupplierId, sku)
    : [];
  const trouve = parFournisseur.length > 0
    ? parFournisseur
    : await bmsApiModel.getSupplierProducts(null, sku);

  const productId = trouve[0]?.product_id;
  if (!productId) {
    throw new Error(
      `BMS ne connaît aucun produit portant le SKU ${sku}. `
      + 'Créez-le dans BMS avant de l\'ajouter à la commande.',
    );
  }
  return productId;
}

/**
 * Ajoute un article à la commande, dans BMS puis chez nous, et l'ouvre au
 * comptage.
 *
 * On croyait ce chemin fermé : l'API v1 ne sait pas toucher aux lignes d'un bon
 * de commande, et il fallait passer par l'interface de BMS. La v2 le sait
 * (POST /v2/purchase-orders/{id}/items), ce qui évite au magasinier d'aller
 * ouvrir BMS avec un carton dans les bras.
 *
 * ET LE BON PEUT ÊTRE TERMINÉ. Vérifié le 30/09/2026 : BMS accepte une ligne
 * neuve sur un bon qu'il dit `complete`, sans le rouvrir. C'est le cas qui
 * comptait — on s'aperçoit d'un article oublié APRÈS avoir soldé la commande,
 * pas avant. L'écran de réception s'y rend par « Réceptionner » depuis la
 * commande, la liste des réceptions ne montrant que les bons en attente.
 *
 * La ligne est créée en PIÈCES avec un conditionnement de 1, comme toutes les
 * autres : c'est la seule forme où le stock de BMS et ses compteurs s'accordent.
 */
async function addLine(sessionId, { productId, qty, unitPrice }, db = pool) {
  const { rows: sessions } = await db.query(
    'SELECT * FROM reception_sessions WHERE id = $1', [sessionId],
  );
  const session = sessions[0];
  if (!session) throw new Error('Réception introuvable');
  if (session.status !== 'counting') throw new Error('Cette réception n\'est plus en cours');

  const pieces = Math.max(1, parseInt(qty, 10) || 1);

  const { rows: produits } = await db.query(
    `SELECT p.id, p.sku, p.post_title, ps.supplier_price
       FROM products p
       LEFT JOIN product_suppliers ps ON ps.product_id = p.id AND ps.supplier_id = (
         SELECT supplier_id FROM purchase_orders WHERE id = $2)
      WHERE p.id = $1 OR p.wp_product_id = $1
      ORDER BY CASE WHEN p.wp_product_id = $1 THEN 0 ELSE 1 END
      LIMIT 1`,
    [productId, session.purchase_order_id],
  );
  const produit = produits[0];
  if (!produit) throw new Error('Produit introuvable');
  if (!produit.sku) throw new Error('Ce produit n\'a pas de SKU : BMS ne peut pas le référencer');

  const { rows: commandes } = await db.query(
    `SELECT po.bms_po_id, s.bms_id AS bms_supplier_id
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.id = $1`,
    [session.purchase_order_id],
  );
  const bmsPoId = (commandes[0] || {}).bms_po_id;
  if (!bmsPoId) throw new Error('Cette commande n\'existe pas dans BMS');

  // Le prix : celui du lien fournisseur à défaut d'autre chose. Une ligne
  // ajoutée à la réception n'a pas été négociée — le contrôle de facture
  // corrigera.
  const prix = unitPrice != null && unitPrice !== ''
    ? parseFloat(unitPrice)
    : (produit.supplier_price != null ? parseFloat(produit.supplier_price) : 0);

  // BMS DÉSIGNE UN PRODUIT PAR SON `product_id`, JAMAIS PAR SON SKU.
  //
  // Envoyer le SKU — ce que faisait cette fonction — est refusé sans appel :
  // 400 « The field 'sku' is read-only ». Le SKU d'une ligne n'est que le reflet
  // du produit, pas ce qui le désigne. Vérifié le 30/09/2026 sur une commande
  // ouverte ET une commande terminée, et l'ordre des champs du payload n'y
  // change rien : c'est bien `product_id` qui manquait.
  //
  // Il n'est stocké nulle part chez nous, d'où cette recherche. Par le
  // fournisseur d'abord, qui est le cas normal ; à défaut sans lui, car un
  // produit absent du catalogue BMS de CE fournisseur reste commandable — c'est
  // même la situation où l'on ajoute une ligne oubliée.
  const bmsProductId = await trouverProduitBms(
    produit.sku, (commandes[0] || {}).bms_supplier_id,
  );

  const creee = await bmsApiModel.apiCall(
    `/v2/purchase-orders/${bmsPoId}/items`, 'POST',
    { product_id: bmsProductId, qty: pieces, qty_pack: 1, price: Math.round(prix * 10000) / 10000 },
  );
  const ligneBms = creee.data || creee;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: [ligne] } = await client.query(
      `INSERT INTO purchase_order_items (
         purchase_order_id, product_id, supplier_sku, product_name,
         qty_ordered, unit_price, units_per_qty
       ) VALUES ($1, $2, $3, $4, $5, $6, 1) RETURNING id`,
      [session.purchase_order_id, produit.id, ligneBms.supplier_sku || null,
       produit.post_title, pieces, prix],
    );
    await client.query(
      `INSERT INTO reception_counts (session_id, purchase_order_item_id, bms_line_id, units_counted)
       VALUES ($1, $2, $3, 0)`,
      [sessionId, ligne.id, ligneBms.id || null],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw new Error(
      `La ligne est CRÉÉE dans BMS mais pas chez nous (${e.message}). `
      + 'Utilisez « Recharger depuis BMS » pour la reprendre.',
    );
  }

  return getOpenSession(session.purchase_order_id, db);
}

module.exports = {
  addLine,
  refreshFromBms,
  fetchBmsLinesFull,
  validateSession,
  abandonSession,
  getOpenSession,
  openSession,
  setCount,
  fetchBmsLines,
  matchBmsLine,
  UNITS_EXPECTED,
};
