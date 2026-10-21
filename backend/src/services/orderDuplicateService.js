/**
 * Doublons probables de commandes clients — détection et ticket SAV.
 *
 * Le constat (16/10/2026, cas Karim ABDALLAH 1269290/1269291) : le client paie,
 * ne revient pas sur la page de confirmation (3D Secure validé dans l'app de sa
 * banque, onglet du checkout rouvert…), retrouve son panier plein — WooCommerce
 * ne le vide que sur cette page — et repaie la même commande sans le savoir.
 * Sur les doublons de 2026, la page de confirmation de la 1re commande ne
 * s'était presque jamais affichée (6/21), contre 98 % des paiements carte.
 *
 * Doublon probable = deux commandes PAYÉES, même email de facturation, mêmes
 * articles (produit ou déclinaison × quantité), moins d'une heure d'écart.
 * Calibré sur l'historique : 33 paires à moins de 30 min, aucune entre 30 et
 * 60 min ; à montant égal mais articles différents, ce sont des changements de
 * saveur, pas des doublons. Les commandes à 0 € (renvois SAV) sont écartées.
 *
 * Chaque paire est enregistrée une fois (`order_duplicates`) et ouvre un ticket
 * SAV « nouveau », rattaché à la seconde commande, avec une note privée — sans
 * mail au client. Tant que ce ticket n'est pas résolu, la seconde commande est
 * exclue des règles de vague du Picking (décision Pierre du 21/10/2026) ; le
 * Picking et le Packing affichent l'alerte sur les deux (orderDuplicateModel).
 */

const pool = require('../config/database');
const { createTicket } = require('../models/pickingPackingModel');
const { PAID_STATUSES } = require('../models/orderDuplicateModel');

const WINDOW = '1 hour';

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const euros = (v) => `${Number(v || 0).toFixed(2).replace('.', ',')} €`;

/**
 * Les paires (première, seconde) dont la SECONDE commande a été créée dans la
 * période. Une seconde commande n'est rattachée qu'à la plus ancienne commande
 * identique : un triplé donne (1, 2) et (1, 3).
 *
 * Dates WooCommerce = heure de Paris (cf. CLAUDE.md), d'où `since`/`until` en
 * heure de Paris. Sans `since` : les dernières 24 h.
 *
 * @param {{ since?: string, until?: string, withRefunded?: boolean }} [period] - dates
 *   'YYYY-MM-DD[ HH:MI]' ; `withRefunded` (rejeu de l'historique seulement) garde
 *   les commandes remboursées depuis — le cron, lui, ne veut que les doublons à traiter.
 * @returns {Promise<Array<{ firstOrderId: string, secondOrderId: string }>>}
 */
const findPairs = async ({ since = null, until = null, withRefunded = false } = {}) => {
  const { rows } = await pool.query(
    `WITH bounds AS (
       SELECT COALESCE($2::timestamp, (NOW() AT TIME ZONE 'Europe/Paris') - interval '24 hours') AS since,
              COALESCE($3::timestamp, (NOW() AT TIME ZONE 'Europe/Paris') + interval '1 day') AS until
     ),
     cand AS (
       SELECT o.wp_order_id, lower(trim(o.billing_email)) AS email, o.post_date
         FROM orders o, bounds b
        WHERE o.post_status = ANY($1::text[])
          AND o.order_total > 0
          AND COALESCE(trim(o.billing_email), '') <> ''
          AND o.post_date >= b.since - interval '${WINDOW}'
          AND o.post_date < b.until
     ),
     sig AS (
       SELECT c.*,
              (SELECT string_agg(COALESCE(NULLIF(oi.variation_id, 0), oi.product_id) || 'x' || oi.qty, ','
                                 ORDER BY COALESCE(NULLIF(oi.variation_id, 0), oi.product_id), oi.qty)
                 FROM order_items oi
                WHERE oi.wp_order_id = c.wp_order_id AND oi.order_item_type = 'line_item') AS items
         FROM cand c
     )
     SELECT DISTINCT ON (s2.wp_order_id)
            s1.wp_order_id::text AS first_order_id, s2.wp_order_id::text AS second_order_id
       FROM sig s2
       JOIN sig s1 ON s1.email = s2.email
                  AND s1.items = s2.items
                  AND s1.wp_order_id < s2.wp_order_id
                  AND s1.post_date >= s2.post_date - interval '${WINDOW}'
       , bounds b
      WHERE s2.post_date >= b.since
        AND s2.items IS NOT NULL
      ORDER BY s2.wp_order_id, s1.wp_order_id`,
    [withRefunded ? [...PAID_STATUSES, 'wc-refunded'] : PAID_STATUSES, since, until]
  );
  return rows.map(r => ({ firstOrderId: r.first_order_id, secondOrderId: r.second_order_id }));
};

/** Ce que la note du ticket dit des deux commandes. */
const loadOrders = async (ids) => {
  const { rows } = await pool.query(
    `SELECT o.wp_order_id, o.billing_email, o.billing_first_name, o.billing_last_name, o.billing_phone,
            o.order_total, o.payment_method_title, o.shipping_method, o.post_date,
            to_char(o.post_date, 'DD/MM/YYYY HH24:MI:SS') AS created_label,
            to_char(o.paid_date, 'HH24:MI:SS') AS paid_label,
            (SELECT string_agg(oi.qty || ' × ' || oi.order_item_name, '|' ORDER BY oi.id)
               FROM order_items oi
              WHERE oi.wp_order_id = o.wp_order_id AND oi.order_item_type = 'line_item') AS items
       FROM orders o
      WHERE o.wp_order_id = ANY($1::bigint[])`,
    [ids]
  );
  return new Map(rows.map(r => [String(r.wp_order_id), r]));
};

const buildNote = (first, second) => {
  const minutes = Math.max(0, Math.round((new Date(second.post_date) - new Date(first.post_date)) / 60000));
  const gap = minutes < 1 ? 'moins d\'une minute' : `${minutes} min`;
  const describe = (o) => `Commande n°${o.wp_order_id} — créée le ${o.created_label}`
    + `${o.paid_label ? `, payée à ${o.paid_label}` : ''} — ${euros(o.order_total)}`
    + `${o.payment_method_title ? ` (${o.payment_method_title})` : ''}`;
  const items = String(second.items || '').split('|').filter(Boolean);

  return `<p><strong>Doublon probable détecté automatiquement.</strong></p>`
    + `<p>Le client a payé deux commandes identiques à ${escapeHtml(gap)} d'écart :</p>`
    + `<ul><li>${escapeHtml(describe(first))}</li><li>${escapeHtml(describe(second))}</li></ul>`
    + `<p>Articles (identiques dans les deux) :</p><ul>${items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
    + `<p>Cause habituelle : après le paiement, le client n'est pas revenu sur la page de confirmation, `
    + `a retrouvé son panier plein et a cru que sa première commande n'était pas passée.</p>`
    + `<p><strong>À faire :</strong> appeler le client. Doublon confirmé : rembourser la commande `
    + `n°${escapeHtml(second.wp_order_id)}. Le client veut bien les deux : passer ce ticket en Résolu.</p>`
    + `<p>Tant que ce ticket n'est pas résolu, la commande n°${escapeHtml(second.wp_order_id)} est exclue `
    + `des règles de vague du Picking (vague manuelle possible).</p>`;
};

/** Ouvre le ticket d'une paire enregistrée ; une erreur est notée pour le passage suivant. */
const openTicket = async (row) => {
  try {
    const orders = await loadOrders([row.first_order_id, row.second_order_id]);
    const first = orders.get(String(row.first_order_id));
    const second = orders.get(String(row.second_order_id));
    if (!first || !second) throw new Error('commande introuvable');
    const subject = `Doublon probable : commandes ${first.wp_order_id} et ${second.wp_order_id}`;
    const ticket = await createTicket(second, subject, buildNote(first, second), 'Détection des doublons');
    await pool.query('UPDATE order_duplicates SET ticket_id = $2, ticket_error = NULL WHERE id = $1', [row.id, ticket.id]);
    return ticket.id;
  } catch (error) {
    await pool.query('UPDATE order_duplicates SET ticket_error = $2 WHERE id = $1', [row.id, error.message]);
    console.error('[Doublons] Ticket non créé pour', row.second_order_id, error.message);
    return null;
  }
};

let running = false;

/**
 * Passage du cron : enregistre les nouvelles paires des dernières 24 h et
 * ouvre leurs tickets ; retente les tickets en échec du dernier jour.
 */
const run = async () => {
  if (running) return { skipped: true };
  running = true;
  try {
    const pairs = await findPairs();
    const fresh = [];
    for (const p of pairs) {
      const { rows: [row] } = await pool.query(
        `INSERT INTO order_duplicates (first_order_id, second_order_id)
         VALUES ($1, $2)
         ON CONFLICT (second_order_id) DO NOTHING
         RETURNING id, first_order_id, second_order_id`,
        [p.firstOrderId, p.secondOrderId]
      );
      if (row) fresh.push(row);
    }
    const { rows: retry } = await pool.query(
      `SELECT id, first_order_id, second_order_id FROM order_duplicates
        WHERE ticket_id IS NULL AND ticket_error IS NOT NULL AND detected_at > NOW() - interval '1 day'`
    );

    let tickets = 0;
    for (const row of [...fresh, ...retry]) {
      if (await openTicket(row)) tickets++;
    }
    if (fresh.length || retry.length) {
      console.log(`[Doublons] ${fresh.length} nouveau(x) doublon(s), ${tickets} ticket(s) ouvert(s)`);
    }
    return { detected: fresh.length, retried: retry.length, tickets };
  } finally {
    running = false;
  }
};

module.exports = { findPairs, run };
