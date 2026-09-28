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
const docStore = require('../utils/supplierDocStore');
const { buildClaimMessage } = require('../utils/invoiceClaimMessage');
const invoiceParsers = require('../parsers/invoices');

/**
 * POST /api/supplier-invoices/analyse — lire un document SANS rien enregistrer.
 * Rien n'est écrit en base, aucun fichier n'est conservé.
 */
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
        gapPrice: Number(l.gap_price) || 0,
        gapQty: Number(l.gap_qty) || 0,
        gap: Number(l.gap) || 0,
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
  analyseDocument,
  uploadDocument,
  listDocuments,
  getDocument,
  downloadDocument,
  updateStatus,
  getClaimMessage,
  deleteDocument,
  createPayment,
  listPayments,
  listUnpaid,
  getParsers,
};
