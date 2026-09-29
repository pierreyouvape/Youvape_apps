/**
 * Le fil de vie d'une commande : ce qu'on a commandé, reçu, facturé, payé.
 *
 * Trois apps se partagent ce cycle — Achats passe la commande, Réception compte
 * la marchandise, Factures contrôle et règle — et chacune ne voyait que son
 * bout. Or les questions qui se posent vraiment traversent les trois :
 *
 *   • « Cette facture, la marchandise est-elle arrivée ? » avant de payer.
 *   • « Cette livraison, la facture est-elle là ? » à la réception.
 *
 * D'où cette lecture unique, que les deux écrans interrogent. Rien n'est
 * recalculé ici : on rassemble ce que chaque table sait déjà.
 */

const pool = require('../config/database');

/** Unités de stock d'une ligne : la commande peut compter en packs. */
const UNITS = 'poi.qty_ordered * COALESCE(poi.units_per_qty, 1)';

async function getLifecycle(purchaseOrderId, db = pool) {
  const { rows: commandes } = await db.query(
    `SELECT po.id, po.bms_po_id, po.bms_reference, po.order_number, po.status,
            po.order_date, po.total_amount, s.id AS supplier_id, s.name AS supplier_name,
            COUNT(poi.id)::int                                   AS nb_lines,
            COALESCE(SUM(${UNITS}), 0)::int                      AS units_ordered,
            COALESCE(SUM(poi.qty_received * COALESCE(poi.units_per_qty, 1)), 0)::int AS units_received
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
      WHERE po.id = $1
      GROUP BY po.id, s.id`,
    [purchaseOrderId],
  );
  const order = commandes[0];
  if (!order) return null;

  // Les réceptions passées par l'app. Celles faites directement dans BMS n'y
  // figurent pas — c'est `units_received` de la commande qui fait foi pour le
  // total, pas la somme des sessions.
  const { rows: receptions } = await db.query(
    `SELECT r.id, r.status, r.started_at, r.validated_at,
            u.name AS validated_by_name,
            COALESCE(SUM(c.units_sent), 0)::int    AS units_sent,
            COALESCE(SUM(c.units_counted), 0)::int AS units_counted,
            COUNT(c.id) FILTER (WHERE c.units_counted > 0)::int AS nb_lines
       FROM reception_sessions r
       LEFT JOIN reception_counts c ON c.session_id = r.id
       LEFT JOIN users u ON u.id = r.validated_by
      WHERE r.purchase_order_id = $1
      GROUP BY r.id, u.name
      ORDER BY r.started_at DESC`,
    [purchaseOrderId],
  );

  const { rows: documents } = await db.query(
    `SELECT d.id, d.number, d.doc_type, d.doc_date, d.total_ht, d.total_ttc, d.status,
            b.payment_status, b.remaining_amount, b.effective_due_date
       FROM supplier_document_orders o
       JOIN supplier_documents d ON d.id = o.document_id
       LEFT JOIN supplier_document_balances b ON b.document_id = d.id
      WHERE o.purchase_order_id = $1
      ORDER BY d.doc_date DESC`,
    [purchaseOrderId],
  );

  return {
    order,
    receptions,
    documents,
    // Les trois réponses que l'écran cherche, déjà tranchées : un écran ne
    // devrait pas avoir à réinterpréter des statuts pour dire « c'est arrivé ».
    summary: {
      fullyReceived: order.units_ordered > 0 && order.units_received >= order.units_ordered,
      partiallyReceived: order.units_received > 0 && order.units_received < order.units_ordered,
      invoiced: documents.some((d) => d.doc_type === 'invoice'),
      // Réglé quand aucune facture ne laisse de reste à payer.
      settled: documents.length > 0
        && documents.filter((d) => d.doc_type === 'invoice')
          .every((d) => d.payment_status === 'paid'),
      openSession: receptions.find((r) => r.status === 'counting') || null,
    },
  };
}

module.exports = { getLifecycle };
