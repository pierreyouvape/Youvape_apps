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
      `SELECT poi.id, poi.supplier_sku, poi.product_id, p.sku AS product_sku,
              ${UNITS_EXPECTED} AS units_expected
         FROM purchase_order_items poi
         LEFT JOIN products p ON p.id = poi.product_id
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
/**
 * Rapproche une de nos lignes de la ligne correspondante chez BMS.
 *
 * SANS CET IDENTIFIANT, RIEN NE PART : la route de réception désigne les lignes
 * par leur id chez BMS, et une ligne non rapprochée fait échouer toute la
 * réception.
 *
 * Le rapprochement se faisait sur la référence fournisseur, puis sur le
 * `product_id`. Les deux pouvaient échouer ENSEMBLE, et l'ont fait sur le bon
 * 121232 (commande interne Castelnau, 01/10/2026) :
 *   • BMS renvoie `supplier_sku: null` sur une commande sans référence
 *     fournisseur — rien à comparer ;
 *   • `b.productId` est l'identifiant du produit CHEZ BMS (3 972 906), comparé
 *     à notre `product_id` INTERNE. Deux espaces d'identifiants distincts : ce
 *     test ne pouvait jamais réussir, il n'a jamais rapproché une seule ligne.
 *
 * C'est le SKU qui identifie le produit de part et d'autre, et c'est donc lui
 * qui fait foi. Trois tentatives, de la plus précise à la plus tolérante.
 */
function matchBmsLine(ligne, lignesBms) {
  // 1. La référence fournisseur, quand les deux côtés en ont une.
  if (ligne.supplier_sku) {
    const parRef = lignesBms.find(
      (b) => b.supplierSku && norm(b.supplierSku) === norm(ligne.supplier_sku),
    );
    if (parRef) return parRef.id;
  }

  // 2. Le SKU du produit — la clé partagée, stable des deux côtés.
  if (ligne.product_sku) {
    const parSku = lignesBms.find((b) => b.sku && norm(b.sku) === norm(ligne.product_sku));
    if (parSku) return parSku.id;
  }

  // 3. Notre colonne `supplier_sku` contre le SKU de BMS : la synchro y recopie
  //    le SKU du produit quand la commande n'a pas de référence fournisseur.
  if (ligne.supplier_sku) {
    const parSkuRecopie = lignesBms.find(
      (b) => b.sku && norm(b.sku) === norm(ligne.supplier_sku),
    );
    if (parSkuRecopie) return parSkuRecopie.id;
  }

  return null;
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
// Les quatre motifs d'un manquant. Les trois premiers désignent le fournisseur ;
// `erreur_saisie` désigne NOUS — une ligne commandée par erreur, une quantité mal
// saisie. Rien à réclamer, et surtout pas de relance à lui envoyer.
const MOTIFS = ['reliquat', 'solde', 'manquant', 'erreur_saisie'];

/**
 * Ce que BMS peut encore accepter, ligne par ligne. Fonction PURE, pour être
 * éprouvée : elle décide ce qui entre en stock, et une erreur ici se paie en
 * marchandise fantôme ou en pièces perdues.
 *
 * `restant` = attendu − déjà reçu, en PIÈCES de bout en bout. Une ligne soldée
 * (restant ≤ 0) ne part pas du tout : l'envoyer à zéro n'apprendrait rien à BMS
 * et ferait croire à une réception.
 */
function plafonnerEnvoi(lignes) {
  const envoye = new Map();
  const nonEnvoyes = [];
  const items = [];
  for (const l of lignes) {
    const restant = Number(l.units_expected) - Number(l.units_received);
    const qty = Math.max(0, Math.min(l.units_counted, restant));
    if (qty < l.units_counted) {
      nonEnvoyes.push({
        ref: l.supplier_sku,
        product: l.product_name,
        comptees: l.units_counted,
        envoyees: qty,
        refusees: l.units_counted - qty,
      });
    }
    envoye.set(l.purchase_order_item_id, qty);
    if (qty > 0) items.push({ id: Number(l.bms_line_id), qty });
  }
  return { items, envoye, nonEnvoyes };
}

/**
 * Motifs reçus de l'écran :
 * { [purchase_order_item_id]: 'reliquat'|'solde'|'manquant'|'erreur_saisie' }.
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
            poi.supplier_sku, poi.product_name, ${UNITS_EXPECTED} AS units_expected,
            COALESCE(poi.units_received, 0) AS units_received
       FROM reception_counts c
       JOIN purchase_order_items poi ON poi.id = c.purchase_order_item_id
      WHERE c.session_id = $1
      ORDER BY poi.id`,
    [sessionId],
  );
  const lignes = toutes.filter((l) => l.units_counted > 0);

  if (lignes.length === 0) throw new Error('Aucune pièce comptée : il n\'y a rien à réceptionner');

  // Manquant et surplus se jugent sur ce qui RESTE à recevoir, comme à l'écran,
  // pas sur le total commandé : à la 2e réception d'une commande (lignes
  // ajoutées après coup, reliquat), les lignes déjà soldées sont comptées à
  // zéro et ne manquent pas. Le total les déclarait manquantes, l'écran ne
  // proposait aucun motif pour elles, et la validation était impossible
  // (XKVGXPIDD, 07/10/2026).
  const restantDe = (l) => Math.max(0, Number(l.units_expected) - Number(l.units_received));
  const manquants = toutes.filter((l) => l.units_counted < restantDe(l));
  const surplus = toutes.filter((l) => l.units_counted > restantDe(l));

  // Le motif est exigé ICI et pas seulement à l'écran : l'API est la porte, et
  // une réception envoyée par un autre chemin perdrait l'explication du manquant.
  const sansMotif = manquants.filter((l) => !motifsParItem.has(l.purchase_order_item_id));
  if (sansMotif.length > 0) {
    throw new Error(
      'Il manque un motif (reliquat, soldé, manquant ou erreur de saisie) pour : '
      + sansMotif.map((l) => l.supplier_sku || l.product_name || `ligne ${l.purchase_order_item_id}`).join(', '),
    );
  }

  const sansLien = lignes.filter((l) => !l.bms_line_id);
  if (sansLien.length > 0) {
    // Le message disait « pas d'équivalent dans BMS » en listant des SKU, ce qui
    // se lit « ces SKU n'existent pas » — et envoyait chercher du côté du
    // catalogue alors que les produits sont bien là. Ce qui manque, c'est
    // l'identifiant de LA LIGNE chez BMS, et « Recharger depuis BMS » le pose.
    throw new Error(
      'Ces lignes ne sont pas encore rattachées à leur ligne dans BMS, la réception ne peut pas '
      + 'partir : ' + sansLien.map((l) => l.supplier_sku || l.product_name || `ligne ${l.purchase_order_item_id}`).join(', ')
      + '.\n\nLes produits existent bien — c\'est le lien avec la commande BMS qui manque. '
      + 'Cliquez sur « Recharger depuis BMS » : il rapproche les lignes sans toucher à votre comptage.',
    );
  }

  const { rows: commandes } = await db.query(
    'SELECT bms_po_id FROM purchase_orders WHERE id = $1',
    [session.purchase_order_id],
  );
  const bmsPoId = (commandes[0] || {}).bms_po_id;
  if (!bmsPoId) throw new Error('Cette commande n\'existe pas dans BMS');

  // L'ENVOI EST ATOMIQUE, ET C'EST LÀ QUE TOUT SE JOUE.
  //
  // BMS accepte une sur-réception tant que la ligne n'a rien reçu : le bon de
  // commande était faux, le magasinier a raison. Mais dès qu'une réception a
  // déjà eu lieu, un dépassement lui fait rejeter TOUT LE LOT d'un coup
  // (500, « Unique constraint violation found ») — quarante lignes justes
  // perdues pour une seule en trop, et un comptage d'une heure avec.
  //
  // On ne prédit pas sa règle, on ne la devine pas : on tente ce qui a été
  // compté, et s'il refuse, on replie sur ce qu'il peut encore prendre. Le
  // premier appel n'ayant rien écrit, ce repli ne double aucune réception.
  const envoiDemande = lignes.map((l) => ({ id: Number(l.bms_line_id), qty: l.units_counted }));
  const envoye = new Map(lignes.map((l) => [l.purchase_order_item_id, l.units_counted]));
  const nonEnvoyes = [];
  let reponse;
  try {
    reponse = await bmsApiModel.apiCall(
      `/v2/purchase-orders/${bmsPoId}/receive`, 'POST', { items: envoiDemande },
    );
  } catch (e) {
    if (!/unique constraint/i.test(e.message)) throw e;

    const repli = plafonnerEnvoi(lignes);
    nonEnvoyes.push(...repli.nonEnvoyes);
    for (const [itemId, qty] of repli.envoye) envoye.set(itemId, qty);

    if (repli.items.length === 0) {
      throw new Error(
        'BMS a refusé la réception : ces lignes sont déjà soldées chez lui et ne peuvent plus '
        + 'rien recevoir. Le comptage est conservé — vérifiez avec un responsable avant de recommencer.',
      );
    }

    console.warn(`[reception] BMS a refusé le dépassement sur ${bmsPoId}, envoi plafonné : `
      + nonEnvoyes.map((n) => `${n.ref} ${n.envoyees}/${n.comptees}`).join(', '));

    try {
      reponse = await bmsApiModel.apiCall(
        `/v2/purchase-orders/${bmsPoId}/receive`, 'POST', { items: repli.items },
      );
    } catch (e2) {
      // Le repli lui-même a échoué : rien n'est parti, rien n'est enregistré, et
      // l'erreur brute de BMS n'apprendrait rien au magasinier.
      throw new Error(
        'BMS a refusé la réception, même ramenée à ce qu\'il restait à recevoir '
        + `(${e2.message}). Rien n'a été enregistré et le comptage est conservé : `
        + 'rechargez depuis BMS, ses quantités ont probablement changé de son côté.',
      );
    }
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const l of lignes) {
      // Ce qui est PARTI, pas ce qui a été compté : quand BMS a plafonné, les
      // deux diffèrent, et c'est le stock qui aurait menti.
      const parti = envoye.get(l.purchase_order_item_id) || 0;
      await client.query(
        'UPDATE reception_counts SET units_sent = $3 WHERE session_id = $1 AND purchase_order_item_id = $2',
        [sessionId, l.purchase_order_item_id, parti],
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
        [l.purchase_order_item_id, parti],
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
    expected: restantDe(l),
    ecart: l.units_counted - restantDe(l),
    motif: motifsParItem.get(l.purchase_order_item_id) || null,
  });

  const resultat = {
    sent: lignes.map((l) => ({
      ...decrire(l),
      over: l.units_counted > restantDe(l),
      units_sent: envoye.get(l.purchase_order_item_id) || 0,
    })),
    missing: manquants.map(decrire),
    over: surplus.map(decrire),
    notSent: nonEnvoyes,
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
      nonEnvoyes,
    });
  } catch (e) {
    console.error('[reception] mail d\'écart non envoyé :', e.message);
  }

  return resultat;
}

/**
 * L'HISTORIQUE DES RÉCEPTIONS D'UNE COMMANDE — pour Commandes fournisseur.
 *
 * Le motif d'un manquant était écrit et jamais relu : on imposait au magasinier
 * de choisir un motif pour l'archiver aussitôt. C'est ici
 * qu'il se consulte, là où l'acheteur regarde déjà sa commande, et pas dans une
 * boîte mail.
 *
 * Trois choses par ligne, qui répondent à trois questions différentes :
 *   attendu / compté  → le magasinier a-t-il tout trouvé ?
 *   compté / envoyé   → BMS a-t-il tout pris ? (il refuse un dépassement sur
 *                        une ligne déjà réceptionnée : l'écart est de la
 *                        marchandise présente et absente du stock)
 *   motif             → pourquoi il manque, donc quoi faire.
 */
async function historiqueReceptions(purchaseOrderId, db = pool) {
  const { rows: sessions } = await db.query(
    `SELECT r.id, r.status, r.started_at, r.validated_at,
            COALESCE(ud.name, ud.email) AS ouverte_par,
            COALESCE(uv.name, uv.email) AS validee_par,
            COALESCE(SUM(c.units_counted), 0)::int AS total_compte,
            COALESCE(SUM(c.units_sent), 0)::int    AS total_envoye
       FROM reception_sessions r
       LEFT JOIN reception_counts c ON c.session_id = r.id
       LEFT JOIN users ud ON ud.id = r.started_by
       LEFT JOIN users uv ON uv.id = r.validated_by
      WHERE r.purchase_order_id = $1
      GROUP BY r.id, ud.name, ud.email, uv.name, uv.email
      ORDER BY r.started_at DESC`,
    [purchaseOrderId],
  );
  if (sessions.length === 0) return [];

  const { rows: lignes } = await db.query(
    `SELECT c.session_id, c.units_counted, c.units_sent, c.motif,
            poi.supplier_sku, poi.product_name,
            ${UNITS_EXPECTED} AS units_expected
       FROM reception_counts c
       JOIN purchase_order_items poi ON poi.id = c.purchase_order_item_id
      WHERE c.session_id = ANY($1::int[])
      ORDER BY poi.id`,
    [sessions.map((s) => s.id)],
  );

  return sessions.map((s) => {
    // SEULE UNE SESSION VALIDÉE A DES MANQUANTS.
    //
    // Une session abandonnée n'a rien compté : présenter ses lignes comme
    // « manquantes » accuserait le fournisseur d'un abandon de comptage. Vu sur
    // la session 10 d'IJSBUKTLI, qui affichait 7 manquants sans motif alors
    // qu'elle n'avait jamais servi.
    const deLaSession = s.status === 'validated'
      ? lignes.filter((l) => l.session_id === s.id)
      : [];
    return {
      ...s,
      manquants: deLaSession
        .filter((l) => l.units_counted < Number(l.units_expected))
        .map((l) => ({
          ref: l.supplier_sku, product: l.product_name,
          expected: Number(l.units_expected), units: l.units_counted,
          manque: Number(l.units_expected) - l.units_counted, motif: l.motif,
        })),
      surplus: deLaSession
        .filter((l) => l.units_counted > Number(l.units_expected))
        .map((l) => ({
          ref: l.supplier_sku, product: l.product_name,
          expected: Number(l.units_expected), units: l.units_counted,
          enTrop: l.units_counted - Number(l.units_expected),
        })),
      // Compté mais refusé par BMS : présent en entrepôt, absent du stock.
      refuses: deLaSession
        .filter((l) => l.units_sent !== null && l.units_sent < l.units_counted)
        .map((l) => ({
          ref: l.supplier_sku, product: l.product_name,
          comptees: l.units_counted, envoyees: l.units_sent,
          refusees: l.units_counted - l.units_sent,
        })),
    };
  });
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
      `SELECT c.purchase_order_item_id, poi.supplier_sku, poi.product_id, p.sku AS product_sku
         FROM reception_counts c
         JOIN purchase_order_items poi ON poi.id = c.purchase_order_item_id
         LEFT JOIN products p ON p.id = poi.product_id
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

  let productId = trouve[0]?.product_id;

  // `/supplier/products` ne connaît que les produits RATTACHÉS à un
  // fournisseur : une fiche tout juste créée dans BMS n'y figure pas, alors
  // qu'elle est commandable (cas réel : Le Dragon d'Enfer 50ml, LCA 360161,
  // 07/10/2026). Et `/v2/products` ignore un filtre sur le SKU. Il filtre en
  // revanche sur `external_id`, que l'intégration WooCommerce construit ainsi :
  //   simple    : <id produit sur 8>_00000000
  //   variation : <id parent sur 8>_<id variation sur 8>
  if (!productId) {
    const { rows } = await pool.query(
      `SELECT wp_product_id, wp_parent_id FROM products
        WHERE sku = $1 AND wp_product_id IS NOT NULL`,
      [sku],
    );
    const pad = (v) => String(v).padStart(8, '0');
    for (const p of rows) {
      const externalId = p.wp_parent_id
        ? `${pad(p.wp_parent_id)}_${pad(p.wp_product_id)}`
        : `${pad(p.wp_product_id)}_00000000`;
      const res = await bmsApiModel.apiCall(
        `/v2/products?filters[external_id]=${encodeURIComponent(externalId)}`,
      );
      // Le SKU doit correspondre : on ne se fie pas au seul calcul d'identifiant.
      const produit = (res.data || []).find((x) => String(x.sku) === String(sku));
      if (produit) { productId = produit.id; break; }
    }
  }

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
  plafonnerEnvoi,
  trouverProduitBms,
  historiqueReceptions,
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
