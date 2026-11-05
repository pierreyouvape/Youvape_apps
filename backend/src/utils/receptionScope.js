/**
 * Quelles commandes sont encore « à réceptionner » — partagé par l'écran
 * Réception (`receptionController`) et le filtre « Actives » de la liste des
 * commandes (`purchaseOrderModel.findAll`). Les deux doivent dire la même
 * chose : le 05/11/2026, LCA 364512 (785 pièces attendues, close à tort par BMS)
 * était à l'écran Réception mais absente des commandes actives.
 *
 * Fragments SQL : la commande s'appelle `po`.
 */

/**
 * Une commande reste à réceptionner tant qu'il lui manque des pièces — MÊME SI
 * BMS la dit terminée.
 *
 * Ce garde-fou vient d'un piège vérifié le 29/09/2026. BMS solde une ligne dès
 * que son `qty_received` atteint son `qty`, or `qty` compte des PACKS et le
 * `qty_received` que nous écrivons compte des PIÈCES. Sur une ligne « 4 lots de
 * 10 », recevoir 4 pièces suffit à ce que BMS déclare la ligne complète, puis la
 * commande « complete ». La synchro recopiait fidèlement ce statut, la commande
 * disparaissait de l'écran de réception, et les 36 pièces restantes n'avaient
 * plus aucun moyen d'y être enregistrées.
 *
 * On se fie donc à NOTRE décompte, qui est en pièces de bout en bout : une
 * commande déjà touchée par une réception et à qui il manque des pièces reste
 * visible, quoi qu'en dise BMS.
 *
 * SAUF si elle a été soldée chez nous (`closed_locally_at`) : le reste a reçu un
 * motif (manquant, soldé, erreur de saisie), on n'attend plus rien. Sans cette
 * condition, toutes les commandes soldées avec un manquant revenaient à l'écran
 * (14 sur 25 le 05/11/2026), et celle qu'on cherchait (LCA 364512) s'y noyait.
 */
const RECEPTION_INCOMPLETE = `
  po.closed_locally_at IS NULL
  AND EXISTS (SELECT 1 FROM reception_sessions rs WHERE rs.purchase_order_id = po.id)
  AND EXISTS (
    SELECT 1 FROM purchase_order_items x
     WHERE x.purchase_order_id = po.id
       AND x.qty_ordered * COALESCE(x.units_per_qty, 1)
           > COALESCE(x.units_received, 0)
  )`;

/**
 * Le symétrique du garde-fou ci-dessus, et il manquait.
 *
 * `RECEPTION_INCOMPLETE` ne fait qu'AJOUTER des commandes à la liste : il rattrape
 * celles que BMS solde à tort. Le cas inverse existe aussi — BMS dit `expected`
 * alors que nous avons tout compté — et rien ne le traitait. Constaté le
 * 30/09/2026 sur IJSBUKTLI : 90 pièces commandées, 90 reçues, et la commande
 * revenait indéfiniment à l'écran parce qu'une de ses lignes était restée en lots
 * chez BMS (40 reçus comparés à 4 commandés, donc jamais soldée de leur point de vue).
 *
 * Dès qu'on a compté une commande, NOTRE décompte fait autorité dans les DEUX
 * sens. Tant qu'on ne l'a jamais comptée, on suit le statut BMS.
 */
const RECEPTION_TERMINEE = `
  EXISTS (SELECT 1 FROM reception_sessions rs WHERE rs.purchase_order_id = po.id)
  AND NOT EXISTS (
    SELECT 1 FROM purchase_order_items x
     WHERE x.purchase_order_id = po.id
       AND x.qty_ordered * COALESCE(x.units_per_qty, 1)
           > COALESCE(x.units_received, 0)
  )`;

module.exports = { RECEPTION_INCOMPLETE, RECEPTION_TERMINEE };
