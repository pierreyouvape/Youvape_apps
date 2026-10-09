/**
 * API du contrôle des factures fournisseur.
 *
 * LIRE ET ENREGISTRER SONT DEUX GESTES SÉPARÉS (Pierre, 28/09/2026). `/analyse`
 * lit le document et rend le tableau d'écarts sans rien écrire ni conserver ;
 * seul `POST /` enregistre, quand l'acheteur a vu le résultat et l'a validé.
 * Essayer une facture ne doit pas polluer le classeur.
 *
 * Le doublon est signalé DEUX FOIS : à la lecture, pour prévenir avant même de
 * regarder le tableau, et au moment d'enregistrer, où il bloque vraiment. Le
 * second contrôle est le seul qui protège — entre les deux, quelqu'un d'autre a
 * pu déposer la même facture. Un doublon en base, c'est un double paiement en
 * puissance.
 */

const supplierInvoiceService = require('../services/supplierInvoiceService');
const supplierDocumentModel = require('../models/supplierDocumentModel');
const supplierVoucherModel = require('../models/supplierVoucherModel');
const fs = require('fs');
const docStore = require('../utils/supplierDocStore');
const lifecycleModel = require('../models/orderLifecycleModel');
const { buildClaimMessage } = require('../utils/invoiceClaimMessage');
const invoiceParsers = require('../parsers/invoices');

/**
 * POST /api/supplier-invoices/analyse — lire un document SANS rien enregistrer.
 * Rien n'est écrit en base, aucun fichier n'est conservé.
 */
/**
 * POST /api/supplier-invoices/apply-tariffs — inscrire le tarif relevé ET
 * corriger la commande qu'il vient de payer.
 *
 * Écrit dans NOTRE base, jamais chez BMS : l'API BoostMyShop n'expose aucune
 * route d'écriture sur les prix fournisseur (son Swagger n'en déclare que treize
 * au total, dont une seule côté achats — créer un bon de commande), et le `price`
 * de ses associations n'entre dans aucun de nos chiffres (cf. CLAUDE.md).
 *
 * Les deux écritures vont ensemble parce qu'elles répondent à la même question :
 * ce que cette marchandise a coûté. `supplier_refs.pack_price` le dit à la
 * prochaine commande, `purchase_order_items.unit_price` à celle qui vient d'être
 * payée — donc au FIFO, qui lit le prix de la commande et jamais celui de la
 * facture. Il y a eu un geste pour chacune pendant une journée : le plus faible
 * n'avait aucun cas à lui, puisque ce tableau ne s'affiche que commande en main.
 */
async function applyTariffs(req, res) {
  try {
    const supplierId = parseInt(req.body.supplier_id, 10);
    const orderId = parseInt(req.body.order_id, 10);
    if (!Number.isFinite(supplierId)) {
      return res.status(400).json({ error: 'Fournisseur manquant' });
    }
    if (!Number.isFinite(orderId)) {
      return res.status(400).json({ error: 'Commande manquante' });
    }
    const tariffs = Array.isArray(req.body.tariffs) ? req.body.tariffs : [];
    if (tariffs.length === 0) {
      return res.status(400).json({ error: 'Aucun tarif à appliquer' });
    }

    const result = await supplierDocumentModel.applyTariffs(supplierId, orderId, tariffs);
    const recontroles = await recontrolerFacturesDe(orderId);
    return res.json({ ...result, recontroles });
  } catch (error) {
    console.error('[supplier-invoices] application des tarifs :', error.message);
    return res.status(error.status || 500).json({ error: error.message || 'Erreur serveur' });
  }
}

/**
 * Recontrôler les factures DÉJÀ ENREGISTRÉES d'une commande dont on vient de
 * changer un tarif.
 *
 * Leurs lignes sont figées à l'enregistrement, et le message au commercial se
 * construit à partir d'elles. F2610415970 : enregistrée à 12h16m17, les Dojo
 * passées au tarif négocié de 3,00 € trente secondes plus tard depuis l'écran
 * de contrôle — le message réclamait encore contre 2,90 € et 2,83 €. Un échec
 * ici (PDF introuvable…) ne fait pas échouer le tarif, déjà inscrit.
 */
async function recontrolerFacturesDe(orderId) {
  const faits = [];
  for (const id of await supplierDocumentModel.listDocumentIdsForOrder(orderId)) {
    try {
      const document = await supplierDocumentModel.getDocument(id);
      if (!document || (document.orders[0] || {}).id !== orderId) continue;
      const analysis = await reanalyse(document);
      await supplierDocumentModel.replaceLines(id, analysis.comparison, undefined, analysis.vouchersUsed);
      faits.push({ id, number: document.number });
    } catch (e) {
      console.error(`[supplier-invoices] recontrôle du document ${id} :`, e.message);
    }
  }
  return faits;
}

/** GET /api/supplier-invoices/orders — commandes à proposer au rapprochement. */
async function listCandidateOrders(req, res) {
  try {
    const supplierId = parseInt(req.query.supplier_id, 10);
    if (!Number.isFinite(supplierId)) {
      return res.status(400).json({ error: 'Fournisseur manquant' });
    }
    const orders = await supplierDocumentModel.listCandidateOrders(supplierId, req.query.q);
    return res.json(orders);
  } catch (error) {
    console.error('[supplier-invoices] commandes candidates :', error.message);
    return res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
}

async function analyseDocument(req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Aucun fichier reçu' });
    }
    const supplierId = parseInt(req.body.supplier_id, 10);
    if (!Number.isFinite(supplierId)) {
      return res.status(400).json({ error: 'Fournisseur manquant' });
    }
    const orderId = req.body.order_id ? parseInt(req.body.order_id, 10) : null;

    const analysis = await supplierInvoiceService.analyseInvoice({
      buffer: req.file.buffer,
      supplierId,
      orderId: Number.isFinite(orderId) ? orderId : null,
    });

    if (!analysis.invoice.number) {
      return res.status(422).json({
        error: "Numéro de document illisible : ce fichier n'est probablement pas une facture de ce fournisseur",
      });
    }

    // Prévenir avant que l'acheteur lise tout le tableau pour rien.
    const duplicate = await supplierDocumentModel.findExisting(supplierId, analysis.invoice.number);

    return res.json({ ...analysis, duplicate });
  } catch (error) {
    console.error('[supplier-invoices] lecture :', error.message);
    return res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
}

/** POST /api/supplier-invoices — enregistrer une facture ou un avoir. */
async function uploadDocument(req, res) {
  let stored = null;
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Aucun fichier reçu' });
    }
    const supplierId = parseInt(req.body.supplier_id, 10);
    if (!Number.isFinite(supplierId)) {
      return res.status(400).json({ error: 'Fournisseur manquant' });
    }
    const orderId = req.body.order_id ? parseInt(req.body.order_id, 10) : null;

    const analysis = await supplierInvoiceService.analyseInvoice({
      buffer: req.file.buffer,
      supplierId,
      orderId: Number.isFinite(orderId) ? orderId : null,
    });

    if (!analysis.invoice.number) {
      return res.status(422).json({
        error: "Numéro de document illisible : ce fichier n'est probablement pas une facture de ce fournisseur",
      });
    }

    stored = docStore.saveDocument({
      supplierId,
      buffer: req.file.buffer,
      originalName: req.file.originalname,
    });

    const saved = await supplierDocumentModel.createDocument({
      supplier: analysis.supplier,
      invoice: analysis.invoice,
      order: analysis.order,
      comparison: analysis.comparison,
      filePath: stored.filePath,
      originalName: stored.originalName,
      matchedBy: analysis.matchedBy,
      userId: req.user && req.user.id,
      vouchersUsed: analysis.vouchersUsed || [],
    });

    if (saved.duplicate) {
      // Le fichier vient d'être écrit pour rien : on le retire, la pièce de
      // référence reste celle du premier dépôt.
      docStore.removeDocument(stored.filePath);
      return res.status(409).json({
        error: `La facture ${analysis.invoice.number} de ${analysis.supplier.name} est déjà enregistrée`,
        existing: saved.existing,
      });
    }

    return res.status(201).json({
      document: saved.document,
      supplier: analysis.supplier,
      invoice: analysis.invoice,
      order: analysis.order,
      matchedBy: analysis.matchedBy,
      needsManualOrder: analysis.needsManualOrder,
      comparison: analysis.comparison,
      differences: analysis.differences,
    });
  } catch (error) {
    if (stored) docStore.removeDocument(stored.filePath);
    console.error('[supplier-invoices] dépôt :', error.message);
    return res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
}

/** GET /api/supplier-invoices — liste filtrable. */
async function listDocuments(req, res) {
  try {
    const rows = await supplierDocumentModel.listDocuments({
      supplierId: req.query.supplier_id ? parseInt(req.query.supplier_id, 10) : null,
      status: req.query.status || null,
      paymentStatus: req.query.payment_status || null,
      docType: req.query.doc_type || null,
      from: req.query.from || null,
      to: req.query.to || null,
      search: req.query.q || null,
      limit: Math.min(parseInt(req.query.limit, 10) || 100, 500),
      offset: parseInt(req.query.offset, 10) || 0,
    });
    return res.json(rows);
  } catch (error) {
    console.error('[supplier-invoices] liste :', error.message);
    return res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
}

/** GET /api/supplier-invoices/:id — document, lignes gelées, règlements. */
async function getDocument(req, res) {
  try {
    const document = await supplierDocumentModel.getDocument(parseInt(req.params.id, 10));
    if (!document) return res.status(404).json({ error: 'Document introuvable' });
    return res.json(document);
  } catch (error) {
    console.error('[supplier-invoices] détail :', error.message);
    return res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
}

/**
 * GET /api/supplier-invoices/:id/file — le PDF d'origine.
 * Retéléchargeable autant de fois que voulu : c'est la pièce comptable.
 */
async function downloadDocument(req, res) {
  try {
    const document = await supplierDocumentModel.getDocument(parseInt(req.params.id, 10));
    if (!document) return res.status(404).json({ error: 'Document introuvable' });

    const absolute = docStore.resolveDocument(document.file_path);
    if (!absolute) {
      return res.status(410).json({ error: 'Le fichier de ce document est introuvable sur le serveur' });
    }

    const analysis = document.analysis || {};
    const name = analysis.originalName
      || `${document.doc_type === 'credit_note' ? 'avoir' : 'facture'}-${docStore.safeBasename(document.number)}.pdf`;
    return res.download(absolute, name);
  } catch (error) {
    console.error('[supplier-invoices] téléchargement :', error.message);
    return res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
}

/** PUT /api/supplier-invoices/:id/status */
async function updateStatus(req, res) {
  try {
    const document = await supplierDocumentModel.updateStatus(parseInt(req.params.id, 10), req.body.status);
    if (!document) return res.status(404).json({ error: 'Document introuvable' });
    return res.json(document);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Erreur serveur' });
  }
}

/**
 * GET /api/supplier-invoices/:id/claim — le message à copier-coller.
 * Reconstruit depuis les lignes GELÉES, pas depuis la commande d'aujourd'hui :
 * c'est l'écart constaté au contrôle qu'on réclame, même si la commande a été
 * corrigée depuis.
 */
async function getClaimMessage(req, res) {
  try {
    const document = await supplierDocumentModel.getDocument(parseInt(req.params.id, 10));
    if (!document) return res.status(404).json({ error: 'Document introuvable' });

    const comparison = {
      lines: document.lines.map((l) => ({
        ref: l.supplier_sku,
        label: l.label,
        verdict: l.verdict,
        material: l.material,
        qtyOrdered: l.expected_qty == null ? null : Number(l.expected_qty),
        qtyInvoiced: l.qty == null ? null : Number(l.qty),
        expectedUnitPrice: l.expected_unit_price == null ? null : Number(l.expected_unit_price),
        invoicedUnitPrice: l.qty && Number(l.qty) !== 0 ? Number(l.line_total_ht) / Number(l.qty) : null,
        invoicedTotal: Number(l.line_total_ht) || 0,
        gapPrice: Number(l.gap_price) || 0,
        gapQty: Number(l.gap_qty) || 0,
        gap: Number(l.gap) || 0,
        // L'écart RÉEL de la ligne, remise de pied comprise : c'est lui qu'on
        // réclame quand la facture ne compte pas dans la même unité que la
        // commande (un carton de 5 contre 5 pièces).
        netGap: l.net_gap == null ? null : Number(l.net_gap),
        // Ce qui reste dû après la remise de pied. Absent des documents
        // enregistrés avant le 01/10/2026 : on retombe alors sur le brut, seule
        // chose qu'on savait à l'époque.
        residualGapPrice: l.residual_gap_price == null ? null : Number(l.residual_gap_price),
      })),
    };

    const message = buildClaimMessage({
      comparison,
      invoice: { number: document.number },
      order: { reference: (document.orders[0] || {}).bms_reference },
      supplier: { name: document.supplier_name, contactName: document.contact_name },
      senderName: (req.user && req.user.name) || null,
    });

    return res.json(message);
  } catch (error) {
    console.error('[supplier-invoices] réclamation :', error.message);
    return res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
}

/**
 * Rejouer l'analyse d'un document enregistré contre l'état ACTUEL de BMS, à
 * partir du PDF conservé. Partagé par le re-contrôle et l'application des
 * tarifs, pour que les deux lisent la facture de la même façon.
 */
async function reanalyse(document) {
  if (!document.file_path) {
    const e = new Error('Le fichier d\'origine n\'est plus disponible');
    e.status = 422;
    throw e;
  }
  const chemin = docStore.resolveDocument(document.file_path);
  if (!chemin || !fs.existsSync(chemin)) {
    const e = new Error('Le fichier d\'origine est introuvable sur le disque');
    e.status = 422;
    throw e;
  }
  return supplierInvoiceService.analyseInvoice({
    buffer: fs.readFileSync(chemin),
    supplierId: document.supplier_id,
    orderId: (document.orders[0] || {}).id || null,
    documentId: document.id,
  });
}

/**
 * POST /api/supplier-invoices/:id/recheck — rejouer l'analyse contre BMS.
 *
 * Après correction d'une commande dans BMS, les constats gelés à
 * l'enregistrement ne valent plus. On relit le PDF conservé et on rejoue la
 * comparaison sur l'état actuel.
 */
async function recheckDocument(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const document = await supplierDocumentModel.getDocument(id);
    if (!document) return res.status(404).json({ error: 'Document introuvable' });

    const analysis = await reanalyse(document);
    await supplierDocumentModel.replaceLines(id, analysis.comparison, undefined, analysis.vouchersUsed);
    const rafraichi = await supplierDocumentModel.getDocument(id);
    return res.json({ document: rafraichi, differences: analysis.differences, tariffs: analysis.tariffs });
  } catch (error) {
    console.error('[supplier-invoices] re-contrôle :', error.message);
    return res.status(error.status || 500).json({ error: error.message || 'Erreur serveur' });
  }
}

/**
 * POST /api/supplier-invoices/:id/apply-tariffs — accepter le tarif facturé
 * sur les lignes en écart de tarif d'un document DÉJÀ enregistré.
 *
 * Le bouton « Appliquer » n'existait que sur l'écran d'import : une facture
 * enregistrée sans l'avoir fait gardait son écart à vie, et « Re-contrôler »
 * le retrouvait à chaque fois puisque BMS restait au prix commandé
 * (JoshNoa V3/2026/38291, Mix&Go 3,12 → 3,49 € et 4,10 → 4,35 €). Même geste
 * qu'à l'import — prix réel chez nous, report sur la commande et chez BMS —
 * puis re-contrôle pour que l'écart disparaisse de l'écran.
 */
async function applyDocumentTariffs(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const document = await supplierDocumentModel.getDocument(id);
    if (!document) return res.status(404).json({ error: 'Document introuvable' });
    const orderId = (document.orders[0] || {}).id;
    if (!orderId) return res.status(422).json({ error: 'Aucune commande rattachée à ce document' });

    const analysis = await reanalyse(document);
    // Seulement les lignes que l'écran annonce en écart de tarif : un arrondi
    // ou un conditionnement ne se « corrige » pas d'ici.
    const cle = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const enEcart = new Set((analysis.comparison?.lines || [])
      .filter((l) => ['price', 'qty_price'].includes(l.verdict))
      .map((l) => cle(l.ref)));
    const tarifs = (analysis.tariffs || []).filter((t) => enEcart.has(cle(t.ref)));
    if (tarifs.length === 0) {
      return res.status(422).json({ error: 'Aucun tarif à appliquer : BMS est peut-être déjà à jour, essaie « Re-contrôler »' });
    }

    const result = await supplierDocumentModel.applyTariffs(
      document.supplier_id,
      orderId,
      tarifs.map((t) => ({ ref: t.ref, realPrice: t.realPrice, packQty: t.packQty })),
    );

    const apres = await reanalyse(document);
    await supplierDocumentModel.replaceLines(id, apres.comparison, undefined, apres.vouchersUsed);
    const rafraichi = await supplierDocumentModel.getDocument(id);
    return res.json({ ...result, document: rafraichi });
  } catch (error) {
    console.error('[supplier-invoices] tarifs du document :', error.message);
    return res.status(error.status || 500).json({ error: error.message || 'Erreur serveur' });
  }
}

/**
 * GET /api/supplier-invoices/orders/:orderId/lifecycle
 * « La marchandise est-elle arrivée ? » — la question qu'on se pose avant de
 * régler une facture, et à laquelle il fallait jusqu'ici changer d'application.
 */
async function getOrderLifecycle(req, res) {
  try {
    const fil = await lifecycleModel.getLifecycle(parseInt(req.params.orderId, 10));
    if (!fil) return res.status(404).json({ error: 'Commande introuvable' });
    return res.json(fil);
  } catch (error) {
    console.error('[supplier-invoices] fil de vie :', error.message);
    return res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
}

/** DELETE /api/supplier-invoices/:id — retirer un dépôt erroné. */
async function deleteDocument(req, res) {
  try {
    const removed = await supplierDocumentModel.deleteDocument(parseInt(req.params.id, 10));
    if (!removed) return res.status(404).json({ error: 'Document introuvable' });
    if (removed.file_path) docStore.removeDocument(removed.file_path);
    return res.json({ deleted: true });
  } catch (error) {
    console.error('[supplier-invoices] suppression :', error.message);
    return res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
}

/* ─── Bons de réduction à valoir ──────────────────────────────────────────── */

/**
 * GET /api/supplier-invoices/vouchers?supplier_id=&status=open|consumed
 * Ce qu'on nous doit encore en bons, et ce qui a déjà été déduit.
 */
async function listVouchers(req, res) {
  try {
    const rows = await supplierVoucherModel.listVouchers({
      supplierId: req.query.supplier_id ? parseInt(req.query.supplier_id, 10) : null,
      status: req.query.status || null,
    });
    return res.json(rows);
  } catch (error) {
    console.error('[supplier-invoices] bons :', error.message);
    return res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
}

/** POST /api/supplier-invoices/:id/vouchers — le fournisseur promet un bon pour cette facture. */
async function createVoucher(req, res) {
  try {
    const voucher = await supplierVoucherModel.createVoucher(parseInt(req.params.id, 10), {
      amountHt: req.body.amount_ht,
      code: req.body.code,
      coveredRefs: req.body.covered_refs,
      note: req.body.note,
      userId: req.user && req.user.id,
    });
    return res.status(201).json(voucher);
  } catch (error) {
    console.error('[supplier-invoices] création de bon :', error.message);
    return res.status(error.status || 500).json({ error: error.message || 'Erreur serveur' });
  }
}

/** PUT /api/supplier-invoices/vouchers/:voucherId — typiquement, saisir le code reçu. */
async function updateVoucher(req, res) {
  try {
    const voucher = await supplierVoucherModel.updateVoucher(parseInt(req.params.voucherId, 10), {
      amountHt: req.body.amount_ht,
      code: req.body.code,
      coveredRefs: req.body.covered_refs,
      note: req.body.note,
    });
    if (!voucher) return res.status(404).json({ error: 'Bon introuvable' });
    return res.json(voucher);
  } catch (error) {
    console.error('[supplier-invoices] modification de bon :', error.message);
    return res.status(error.status || 500).json({ error: error.message || 'Erreur serveur' });
  }
}

/**
 * Inscrire des tarifs SAISIS À LA MAIN sur la commande d'un document : réf.
 * fournisseur, ligne de commande chez nous, ligne BMS (`applyTariffs`).
 *
 * `prices` : [{ ref, price }], `price` dans l'unité de la ligne de commande BMS
 * (celle de la colonne « Tarif commandé »). Le conditionnement est relu sur la
 * commande BMS d'aujourd'hui : c'est lui qui dit à quelle unité le prix se
 * rapporte. Une ligne facturée au carton quand la commande compte en pièces est
 * refusée — on ne saurait pas à quelle unité le prix saisi se rapporte.
 */
async function inscrireTarifsSaisis(document, orderId, prices) {
  const demandes = (Array.isArray(prices) ? prices : [])
    .map((p) => ({ ref: String(p.ref || '').trim(), price: Number(String(p.price).replace(',', '.')) }))
    .filter((p) => p.ref);
  if (demandes.length === 0) return { erreur: 'Aucun tarif à inscrire' };
  const invalides = demandes.filter((p) => !(p.price > 0));
  if (invalides.length) return { erreur: `Tarif invalide pour ${invalides.map((p) => p.ref).join(', ')}` };

  const analysis = await reanalyse(document);
  const cle = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const lignes = new Map((analysis.comparison?.lines || []).filter((l) => l.ref).map((l) => [cle(l.ref), l]));

  const tarifs = [];
  const refuses = [];
  for (const d of demandes) {
    const l = lignes.get(cle(d.ref));
    if (!l || l.expectedUnitPrice == null) {
      refuses.push({ ref: d.ref, reason: 'ligne absente de la commande' });
    } else if (l.unitMismatch) {
      refuses.push({ ref: d.ref, reason: 'facturé dans une autre unité que la commande : à corriger dans BMS' });
    } else {
      tarifs.push({ ref: l.ref, realPrice: Math.round(d.price * 10000) / 10000, packQty: l.orderPackQty || 1 });
    }
  }

  const result = tarifs.length
    ? await supplierDocumentModel.applyTariffs(document.supplier_id, orderId, tarifs)
    : { applied: [], skipped: [] };
  return { tarifs, refuses, result };
}

/**
 * POST /api/supplier-invoices/:id/agreed-prices
 * body : { prices: [{ ref, price }] }
 *
 * Le tarif de la commande BMS était FAUX, et c'est lui qui sert de référence au
 * contrôle. LCA F2610415977 : les cartouches Dojo sont négociées à 3,00 € la
 * pièce, BMS les portait à 2,50 € ou 2,80 € selon les commandes, et LCA facture
 * 3,436 €. Contre 2,80 €, l'écart réclamé était faux ; contre 3,00 €, c'est le
 * bon. On inscrit donc le tarif convenu (réf. fournisseur, commande chez nous et
 * dans BMS), puis le contrôle est rejoué : l'écart qui reste, facturé − convenu,
 * est celui que porte le message au commercial.
 */
async function applyAgreedPrices(req, res) {
  try {
    const document = await supplierDocumentModel.getDocument(parseInt(req.params.id, 10));
    if (!document) return res.status(404).json({ error: 'Document introuvable' });
    const orderId = (document.orders[0] || {}).id;
    if (!orderId) return res.status(422).json({ error: 'Aucune commande rattachée à ce document' });

    const { refuses, result, erreur } = await inscrireTarifsSaisis(document, orderId, req.body.prices);
    if (erreur) return res.status(400).json({ error: erreur });

    const apres = await reanalyse(document);
    await supplierDocumentModel.replaceLines(document.id, apres.comparison, undefined, apres.vouchersUsed);
    const rafraichi = await supplierDocumentModel.getDocument(document.id);
    return res.json({ ...result, skipped: [...refuses, ...(result.skipped || [])], document: rafraichi });
  } catch (error) {
    console.error('[supplier-invoices] tarifs convenus :', error.message);
    return res.status(error.status || 500).json({ error: error.message || 'Erreur serveur' });
  }
}

/**
 * POST /api/supplier-invoices/vouchers/:voucherId/apply-prices
 * body : { prices: [{ ref, price }] } — `price` dans l'unité de la ligne de
 * commande BMS (celle de la colonne « Tarif commandé »).
 *
 * Le pendant d'« Appliquer le tarif facturé », pour le cas inverse : le tarif
 * facturé était FAUX, le fournisseur l'a reconnu par un bon, et c'est le BON
 * tarif qu'il faut inscrire. Sur LVP F2610289037, les cartouches Dojo 10 mg
 * étaient commandées à 3,05 € dans BMS — le prix erroné — et 2,88 € pour les
 * 20 mg, quand le fournisseur reconnaît 2,90 € pour toutes. Laissés tels quels,
 * ces prix valorisaient le stock au mauvais coût et pré-remplissaient la
 * commande suivante à 3,05 €.
 *
 * Mêmes trois écritures que l'autre bouton (réf. fournisseur, ligne de commande,
 * ligne BMS), puis le bon est étendu aux références corrigées : une fois BMS au
 * bon tarif, l'écart facturé réapparaît sur ces lignes, et c'est le bon qui le
 * rend.
 */
async function applyVoucherPrices(req, res) {
  try {
    const voucher = await supplierVoucherModel.getVoucher(parseInt(req.params.voucherId, 10));
    if (!voucher) return res.status(404).json({ error: 'Bon introuvable' });
    const document = await supplierDocumentModel.getDocument(voucher.source_document_id);
    if (!document) return res.status(404).json({ error: 'Facture du bon introuvable' });
    const orderId = (document.orders[0] || {}).id;
    if (!orderId) return res.status(422).json({ error: 'Aucune commande rattachée à cette facture' });

    const { tarifs, refuses, result, erreur } = await inscrireTarifsSaisis(document, orderId, req.body.prices);
    if (erreur) return res.status(400).json({ error: erreur });

    // Seules les références vraiment corrigées rejoignent le bon — écrites comme
    // sur la facture, puisque c'est à ses lignes que le bon se compare (la base
    // peut écrire la même réf. avec une autre casse ou d'autres espaces).
    const cle = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const corrigees = new Set((result.applied || []).filter((a) => a.orderLine && a.orderLine.price != null)
      .map((a) => cle(a.ref)));
    await supplierVoucherModel.addCoveredRefs(
      voucher.id,
      tarifs.filter((t) => corrigees.has(cle(t.ref))).map((t) => t.ref),
    );

    const apres = await reanalyse(document);
    await supplierDocumentModel.replaceLines(document.id, apres.comparison, undefined, apres.vouchersUsed);
    const rafraichi = await supplierDocumentModel.getDocument(document.id);
    return res.json({ ...result, skipped: [...refuses, ...(result.skipped || [])], document: rafraichi });
  } catch (error) {
    console.error('[supplier-invoices] tarifs du bon :', error.message);
    return res.status(error.status || 500).json({ error: error.message || 'Erreur serveur' });
  }
}

/** DELETE /api/supplier-invoices/vouchers/:voucherId */
async function deleteVoucher(req, res) {
  try {
    const removed = await supplierVoucherModel.deleteVoucher(parseInt(req.params.voucherId, 10));
    if (!removed) return res.status(404).json({ error: 'Bon introuvable' });
    return res.json({ deleted: true });
  } catch (error) {
    console.error('[supplier-invoices] suppression de bon :', error.message);
    return res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
}

/* ─── Règlements ──────────────────────────────────────────────────────────── */

/** POST /api/supplier-invoices/payments — un règlement et ce qu'il solde. */
async function createPayment(req, res) {
  try {
    const { supplier_id, method, paid_at, amount, reference, notes, allocations } = req.body;
    const payment = await supplierDocumentModel.createPayment({
      supplierId: parseInt(supplier_id, 10),
      method,
      paidAt: paid_at,
      amount,
      reference,
      notes,
      allocations: (allocations || []).map((a) => ({
        documentId: parseInt(a.document_id, 10),
        amount: Number(a.amount),
      })),
      userId: req.user && req.user.id,
    });
    return res.status(201).json(payment);
  } catch (error) {
    console.error('[supplier-invoices] règlement :', error.message);
    return res.status(400).json({ error: error.message || 'Erreur serveur' });
  }
}

/**
 * DELETE /api/supplier-invoices/payments/:id — supprimer un règlement.
 *
 * Il n'y avait aucun moyen d'en défaire un : un essai, une erreur de montant ou
 * un relevé saisi deux fois restaient là pour toujours, et quatre règlements de
 * test du 28/09/2026 traînaient dans la liste sans plus aucune facture en face.
 * Les factures qu'il soldait redeviennent dues du même mouvement.
 */
async function deletePayment(req, res) {
  try {
    const payment = await supplierDocumentModel.deletePayment(parseInt(req.params.id, 10));
    if (!payment) return res.status(404).json({ error: 'Règlement introuvable' });
    return res.json({ deleted: true, payment });
  } catch (error) {
    console.error('[supplier-invoices] suppression de règlement :', error.message);
    return res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
}

async function listPayments(req, res) {
  try {
    const rows = await supplierDocumentModel.listPayments({
      supplierId: req.query.supplier_id ? parseInt(req.query.supplier_id, 10) : null,
      method: req.query.method || null,
      from: req.query.from || null,
      to: req.query.to || null,
      limit: Math.min(parseInt(req.query.limit, 10) || 100, 500),
    });
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
}

/** GET /api/supplier-invoices/unpaid — ce qui reste à régler, et depuis quand. */
async function listUnpaid(req, res) {
  try {
    const rows = await supplierDocumentModel.listUnpaid({
      supplierId: req.query.supplier_id ? parseInt(req.query.supplier_id, 10) : null,
    });
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
}

/** GET /api/supplier-invoices/parsers — fournisseurs dont on sait lire les factures. */
async function getParsers(req, res) {
  return res.json({ suppliers: invoiceParsers.availableInvoiceParsers() });
}

module.exports = {
  getOrderLifecycle,
  recheckDocument,
  applyDocumentTariffs,
  applyTariffs,
  listCandidateOrders,
  analyseDocument,
  uploadDocument,
  listDocuments,
  getDocument,
  downloadDocument,
  updateStatus,
  getClaimMessage,
  deleteDocument,
  createPayment,
  deletePayment,
  listPayments,
  listUnpaid,
  getParsers,
  listVouchers,
  createVoucher,
  updateVoucher,
  deleteVoucher,
  applyVoucherPrices,
  applyAgreedPrices,
};
