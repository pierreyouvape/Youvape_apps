# Prompt — Calculs CA & TVA YouVape

Colle ce prompt dans Claude Code pour obtenir des chiffres identiques à WooCommerce et comptablement exacts.

---

## Contexte

Tu travailles sur la base de données PostgreSQL de YouVape, accessible via SSH sur le VPS.
La BDD est un **miroir exact et temps réel de WooCommerce** (vérifié : 4 277/4 277 IDs identiques sur avril 2026).
Les écarts observés avec Metorik viennent de Metorik, pas de la BDD.

---

## Connexion

```bash
ssh youvape "docker exec -i youvape_postgres psql -U youvape -d youvape_db" <<'SQL'
-- ta requête ici
SQL
```

L'alias `youvape` pointe sur `ubuntu@54.37.156.233` (clé `~/.ssh/id_ed25519`).

---

## Règle 1 — Statuts WooCommerce valides pour le CA

Le shop utilise des **statuts personnalisés** en plus des statuts natifs WC.

**À INCLURE** :
```sql
post_status IN ('wc-completed', 'wc-delivered', 'wc-processing', 'wc-awaiting-delivery')
```

| Statut | Label |
|---|---|
| `wc-completed` | Terminée |
| `wc-delivered` | Livrée (statut custom) |
| `wc-processing` | En cours |
| `wc-awaiting-delivery` | Retrait boutique (statut custom) |

**À EXCLURE** : `wc-cancelled`, `wc-pending`, `wc-failed`, `wc-checkout-draft`

⚠️ Ne jamais filtrer uniquement sur `wc-completed` + `wc-processing` — `wc-delivered` représente ~1 000 €/jour de CA invisible sinon.

---

## Règle 2 — Calcul de la TVA (formule exacte)

La TVA totale = **TVA produits + TVA livraison**.
La TVA livraison est dans `line_tax` des items de type `tax`, pas dans les `line_item`.

```sql
SUM(CASE WHEN oi.order_item_type = 'line_item' THEN oi.line_tax ELSE 0 END)  -- TVA produits
+ SUM(CASE WHEN oi.order_item_type = 'tax'      THEN oi.line_tax ELSE 0 END) -- TVA livraison
```

⚠️ Utiliser uniquement `line_item` sous-estime la TVA (oublie la TVA transport).

---

## Règle 3 — Pays sans TVA

Ces destinations sont facturées à **0% TVA** (line_tax = 0, HT = TTC) :
- `MQ` — Martinique
- `RE` — Réunion
- `GB` — Royaume-Uni
- `PF` — Polynésie française

Pour tous les autres pays : TVA = 20%.

---

## Règle 4 — Formule CA (calquée sur Metorik)

```
CA TTC  = SUM(order_total)
TVA     = SUM(line_item.line_tax) + SUM(tax_item.line_tax)
Remboursements = SUM(refunds.refund_amount) sur les commandes de la période
CA HT   = CA TTC - TVA - Remboursements
```

---

## Requête officielle CA mensuel

```sql
WITH taxes AS (
  SELECT o.wp_order_id,
    SUM(CASE WHEN oi.order_item_type = 'line_item' THEN oi.line_tax ELSE 0 END)
    + SUM(CASE WHEN oi.order_item_type = 'tax'      THEN oi.line_tax ELSE 0 END) AS tva_totale
  FROM orders o
  JOIN order_items oi ON oi.wp_order_id = o.wp_order_id
  WHERE o.post_date >= 'YYYY-MM-01 00:00:00'
    AND o.post_date <  'YYYY-MM-01 00:00:00'  -- mois suivant
    AND o.post_status IN ('wc-completed','wc-delivered','wc-processing','wc-awaiting-delivery')
  GROUP BY o.wp_order_id
),
remboursements AS (
  SELECT o.wp_order_id, COALESCE(SUM(r.refund_amount), 0) AS total_refund
  FROM orders o
  LEFT JOIN refunds r ON r.wp_order_id = o.wp_order_id
  WHERE o.post_date >= 'YYYY-MM-01 00:00:00'
    AND o.post_date <  'YYYY-MM-01 00:00:00'  -- mois suivant
    AND o.post_status IN ('wc-completed','wc-delivered','wc-processing','wc-awaiting-delivery')
  GROUP BY o.wp_order_id
)
SELECT
  COUNT(DISTINCT o.id)                                                           AS nb_commandes,
  ROUND(SUM(o.order_total), 2)                                                   AS ca_ttc,
  ROUND(SUM(t.tva_totale), 2)                                                    AS tva,
  ROUND(SUM(r.total_refund), 2)                                                  AS remboursements,
  ROUND(SUM(o.order_total) - SUM(t.tva_totale) - SUM(r.total_refund), 2)        AS ca_ht
FROM orders o
JOIN taxes t        ON t.wp_order_id = o.wp_order_id
JOIN remboursements r ON r.wp_order_id = o.wp_order_id
WHERE o.post_date >= 'YYYY-MM-01 00:00:00'
  AND o.post_date <  'YYYY-MM-01 00:00:00'  -- mois suivant
  AND o.post_status IN ('wc-completed','wc-delivered','wc-processing','wc-awaiting-delivery');
```

**Exemple avril 2026** → remplace les deux dates par `'2026-04-01 00:00:00'` et `'2026-05-01 00:00:00'`.

---

## Règles générales

- **Dates** : WooCommerce stocke en heure Paris locale (CET/CEST), pas UTC.
- **Coût d'une commande** : `order_total_cost` est toujours NULL. Calculer via `SUM(oi.qty * COALESCE(p.computed_cost, p.wc_cog_cost, 0))`.
- **Doute sur une table** : introspecter avec `\d+ nom_table` plutôt qu'inventer.
- **Avant tout UPDATE / DELETE / INSERT** : montrer la requête et attendre confirmation.
