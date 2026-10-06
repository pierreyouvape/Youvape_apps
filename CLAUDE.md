# CLAUDE.md — Youvape Apps

## Règles absolues

### Interrogation de la base de données
**Toujours interroger la BDD directement sur le VPS via SSH, jamais en local.**

Pattern SSH à utiliser :
```bash
ssh youvape "docker exec youvape_postgres psql -U youvape -d youvape_db -c \"SELECT ...;\""
```

Pour les requêtes longues ou multi-lignes :
```bash
ssh youvape "docker exec -i youvape_postgres psql -U youvape -d youvape_db" <<'SQL'
SELECT ...
FROM ...
WHERE ...;
SQL
```

### Avant tout UPDATE / DELETE / INSERT / DROP
Montrer la requête exacte à l'utilisateur et attendre sa confirmation explicite.

### Statuts WooCommerce valides pour le CA

Le shop utilise des **statuts personnalisés** en plus des statuts natifs WC.

**Statuts à inclure pour le CA** (commandes payées) :
- `wc-completed` — Terminée
- `wc-delivered` — Livrée (statut custom)
- `wc-processing` — En cours
- `wc-awaiting-delivery` — Retrait boutique (statut custom)
- `wc-shipped` — Expédiée (statut custom)
- `wc-being-delivered` — En cours de livraison (statut custom)

**Statuts à exclure** :
- `wc-cancelled` — Annulée
- `wc-pending` — En attente de paiement
- `wc-failed` — Échouée
- `wc-checkout-draft` — Brouillon (panier abandonné)
- `wc-refunded` — Remboursée (déduire le `refund_amount` depuis la table `refunds`)

**Ne jamais filtrer uniquement sur `wc-completed` + `wc-processing`** — `wc-delivered` représente typiquement ~1 000 €/jour de CA invisible sinon.

### Date de référence pour les requêtes financières

Toujours utiliser `COALESCE(paid_date, post_date)` et non `post_date` seul.
`paid_date` = date de paiement réelle (confirmée par Mollie/WC).
`post_date` = date de création de la commande (peut différer du paiement).

```sql
WHERE COALESCE(o.paid_date, o.post_date) >= 'YYYY-MM-DD 00:00:00'
  AND COALESCE(o.paid_date, o.post_date) <  'YYYY-MM-DD 00:00:00'
```

**Idem pour les remboursements** : filtrer sur `refund_date`, pas sur la date de la commande parente.

---

### Dates
WooCommerce stocke en heure Paris locale (CET/CEST), pas UTC.

### Calcul de la TVA (formule exacte Metorik)

La TVA totale d'une commande = TVA produits + TVA livraison :
```sql
SUM(CASE WHEN oi.order_item_type = 'line_item' THEN oi.line_tax ELSE 0 END)   -- TVA produits
+ SUM(CASE WHEN oi.order_item_type = 'tax'       THEN oi.line_tax ELSE 0 END)  -- TVA livraison
```

**Ne jamais utiliser uniquement les `line_item` — ça oublie la TVA sur le transport.**

CA HT (formule exacte app) :
```
taxRatio    = tva / ca_ttc_brut
tvaAjustee  = tva - (remboursements × taxRatio)
caHTNet     = (ca_ttc_brut - remboursements) - tvaAjustee
```
La TVA est ajustée proportionnellement sur les remboursements (un remboursement réduit aussi la TVA collectée).

### Coûts commandes
`order_total_cost` dans `orders` est toujours NULL — pour le coût d'une commande :
```sql
SUM(oi.qty * COALESCE(p.computed_cost, p.wc_cog_cost, 0))
```
via jointure `order_items` → `products`.

### Valeur de stock HT
Le **catalogue fait référence** : `productModel.countForCatalog` → `totalStockValue`, affiché en haut
de `/catalog`. Toute autre page qui affiche une valeur de stock (rapport `/stats/reports`, snapshots,
exports) doit donner **exactement le même chiffre à la date du jour**.

- **Coût unitaire** : toujours `COALESCE(p.computed_cost, p.wc_cog_cost, 0)`. Jamais un `unit_price`
  de bon de commande brut : il est exprimé **au pack** pour les fournisseurs facturés au pack
  (`units_per_qty`, cf. bug du 2026-08-11).
- **Périmètre** (`stockValuationModel.STOCK_VALUE_SCOPE`) : produits `publish`, `simple` suivis en
  stock (`track_stock = true`) + déclinaisons publiées d'un parent `variable` retenu. Packs `woosb`
  exclus (leur coût est déjà porté par les composants), parents `variable` exclus (le stock est sur
  les déclinaisons).
- Le stock non publié ou non suivi est **hors périmètre** — c'est l'objet du rapport hebdo
  `stockDraftReportService`, pas de la valeur d'inventaire.
- **Contrôle** : `node src/scripts/checkStockValuation.js` (le cron de 23h55 le fait chaque nuit et
  alerte par mail en cas d'écart).

### Références fournisseur (`supplier_refs`, depuis le 11/09/2026)

- Un produit (simple ou déclinaison) peut avoir **plusieurs réfs chez un même fournisseur** :
  unité, pack de 50, pack de 100, promo 4+1… chacune avec son `pack_qty` et son `pack_price`
  (prix HT **du pack**).
- Une réf d'un fournisseur désigne **un seul produit** (index unique sur la réf normalisée).
  La remapper sur un autre produit la **déplace**, après confirmation à l'écran (409 `REF_TAKEN`).
- `product_suppliers` reste le **lien** produit × fournisseur (principal, pack et prix de
  l'association BMS) : `UNIQUE(product_id, supplier_id)` est conservé exprès, ~15 requêtes
  joignent sur ce couple. **Ne jamais lire `product_suppliers.supplier_sku`** (colonne figée).
- Jamais de réf sur un parent variable, jamais recopiée d'une déclinaison à l'autre : on ne
  commande jamais un parent.
- Les besoins portent sur le **produit**, pas sur une réf.

### Contrôle de facture : l'écart d'une ligne est son écart RÉEL (01/10/2026)

Trois chiffres par ligne, et il ne faut jamais les confondre (`utils/invoiceCompare.js`) :

| Champ | Ce qu'il compare | Où il sert |
|---|---|---|
| `gap` | montant **brut** de la facture − montant de la commande | explication secondaire |
| `discountShare` | part de la **remise de pied** imputée à la ligne | `effectiveUnitCost`, donc le tarif |
| `netGap` | `gap − discountShare` : ce que la ligne a **vraiment** coûté en trop | **la colonne « Écart total »** |

- **`netGap` est additif** : la somme de la colonne vaut l'`Écart` affiché en haut de l'écran.
  La remise est donc répartie **au centime** (le reliquat d'arrondi va à la plus grosse ligne),
  et la remise qu'on n'a pas su imputer garde sa propre ligne dans le tableau.
- **Appliquer un tarif fait tomber `netGap` à zéro** — l'écran rejoue l'analyse après chaque
  application, sans quoi il affichait encore un écart déjà corrigé.
- ⚠️ **Un fournisseur peut facturer au BRUT une commande portée au NET.** LVP facture le XROS
  6,17 € et retire ses −20 % (`RSPV20`) au pied ; la commande, elle, porte 4,94 €. La ligne
  affichait « Écart total +12,30 € » à côté d'un « Écart unitaire −0,0044 € » : deux chiffres
  justes, illisibles ensemble (F2610287890).
- **Une remise CIBLÉE n'explique QUE ses lignes**, à hauteur de ce qu'elle leur a versé. Seule
  une remise **globale** (ou de périmètre illisible) se concentre au prorata sur les
  dépassements — prudence assumée côté Cosmer / GFC. Mélanger les deux régimes prenait à Pierre
  pour donner à Paul : 3,48 € de « résiduel » sur des XROS payés au prix commandé (qui partaient
  tels quels au commercial) et 1,43 € « expliqués par la remise » sur un Dojo que RSPV20 exclut.
- Le message de réclamation ne reprend que le **résidu** après imputation, jamais le brut.
- ⚠️ **Un fournisseur peut facturer AU CARTON ce que la commande compte en PIÈCES, avec une
  hausse de tarif par-dessus.** Le rapport des quantités est entier (`packFactor`) mais le
  montant ne retombe pas : ce n'est ni un manquant ni « Quantité et tarif ». Ces lignes
  (`unitMismatch`) se lisent **à la pièce**, la seule unité commune — `gapQty = 0`, tout
  l'écart en tarif. JoshNoa V3/2026/37644 : 1 × 25,96 € pour un carton de 5 contre 5 pièces
  à 4,50 € donnait « 21,46 € réclamables + 18,00 € de manquants » pour **3,46 €** de trop.
  Le message au commercial dit en clair ce qu'il a converti, et **aucun bouton de tarif** ne
  s'affiche : on ne sait pas à quelle unité le `pack_qty` de la réf se rapporte.
- Le message se copie depuis l'écran de contrôle **et** depuis la facture rouverte
  (`DocumentPanel`) : une facture se contrôle un jour et s'écrit le lendemain.

### Commandes d'achat : la sémantique BMS (vérifiée le 29/09/2026)

Trois allers-retours en production ont établi ceci. Rien n'en est devinable à la lecture
du code de BMS, et chaque écart a coûté de l'argent faux sur une commande réelle.

**BMS ne connaît plus que des PIÈCES, depuis le 30/09/2026.** Il refusait le
conditionnement qu'on lui envoyait à la création — il appliquait toujours celui du
catalogue et divisait la `qty` postée par lui. On a supprimé la division à sa source :
les **804 associations produit × fournisseur sont passées à `pack_qty = 1`**. Le
conditionnement vit désormais chez nous (`product_suppliers.pack_qty` pour le catalogue,
`supplier_refs.pack_qty` par référence), et ne voyage plus jusqu'à BMS.

Règle unique de `buildBmsItems`, pour tous les fournisseurs et tous les chemins
(création manuelle, import PDF, besoins) :

```
qty   = le nombre de PIÈCES
price = le prix d'UNE PIÈCE, sur QUATRE décimales
```

Quatre décimales : arrondir au centime perd de l'argent sur un lot de 200.
⚠️ **Remettre `price` au prix du lot multiplierait chaque montant par le conditionnement**
— 174 € au lieu de 17,40 €, mesuré en août. Les valeurs d'origine (conditionnement ET prix) des 804 associations sont
dans `bms_supplier_items_packqty_backup_20260930` (clé = l'id BMS de l'association) si la
bascule devait être défaite. `product_suppliers_packqty_backup_20260930` ne couvre que les
752 associations que nous mirrorons localement — 52 existent chez BMS seulement.

**Le `price` des associations BMS n'a PAS été divisé, et ne doit pas l'être en masse.**
Le champ n'est pas homogène : au 30/09/2026, sur les 804, **663 portaient le prix DU LOT**,
**43 le prix À LA PIÈCE** et 91 n'avaient aucun coût de référence chez nous. Deux
associations LCA voisines le montrent — `9736-9850` à 7,50 € (le lot de 5) et `9736-9852`
à 1,50 € (la pièce), pour le même coût unitaire de 1,50 €. Une division par `pack_qty`
corromprait donc les 43 déjà justes et jouerait à pile ou face sur les 91 autres.
Ce prix **n'entre dans aucun de nos chiffres** (nos commandes portent leur propre prix,
le FIFO lit `purchase_order_items.unit_price`) : il ne compte que pour qui créerait une
commande depuis l'interface BMS. Le jour où on voudra l'assainir, ce sera au cas par cas
depuis `supplier_refs.pack_price`, jamais par une règle unique.

⚠️ **Ne pas confondre avec le `price` des LIGNES DE COMMANDE BMS, qui lui compte.**
Deux champs, deux rôles, et les confondre a coûté un aller-retour le 30/09/2026 :

| Champ | Où | Rôle |
|---|---|---|
| `price` de l'**association** | `/supplier/products` | N'entre dans aucun de nos chiffres (ci-dessus) |
| `price` de la **ligne de commande** | `/supplier/purchase-orders/{id}` | **Référence du contrôle de facture** |

Le contrôle de facture ne lit PAS notre `purchase_order_items` pour ses colonnes
« Tarif BMS » et « Commande HT » : il interroge `/supplier/purchase-orders/{id}`
**à l'instant** (parti pris assumé, cf. `supplierInvoiceService.fetchOrderLines`).
Un tarif corrigé chez nous sans être reporté là-bas ne change donc rien à l'écran,
et l'écart réapparaît à la facture suivante. `supplierDocumentModel.applyTariffs`
fait les trois écritures : `supplier_refs.pack_price`, `purchase_order_items.unit_price`
et la ligne BMS.

⚠️ **`/v2/purchase-orders/{id}/items` pagine à DIX sans le dire.** Seul `meta.total`
trahit le reste. Toujours passer par `bmsApiModel.getPurchaseOrderItems`, qui pagine —
un appel nu laissait la moitié d'une commande de vingt références en lots, donc autant
de compteurs de réception faux, en silence.

**Conséquence de la bascule** : BMS n'est plus une source de conditionnement. Une
association *nouvellement* créée par `syncProductSuppliersFromBMS` hérite désormais de
`pack_qty = 1` — le conditionnement réel doit venir de chez nous (`supplier_refs`, import
de facture ou saisie). Les associations existantes sont intactes : cette synchro est un
INSERT seul (`ON CONFLICT DO NOTHING`), elle n'a jamais écrasé une liaison en place.

**Après création, les lignes sont remises en pièces.** `PUT /v2/purchase-orders/{id}/items/{itemId}`
accepte `qty`, `qty_pack` et `price` (absent du Swagger, la v1 ne le sait pas) :
`normalizeBmsLines` repasse chaque ligne en `qty_pack: 1`, prix ramené à la pièce sur
**4 décimales** (arrondir au centime perd de l'argent sur un lot de 200). Avec ce
conditionnement, pièces et lots se confondent — stock, compteur de réception, pourcentage
reçu et valorisation tombent tous juste d'un coup. Un échec de normalisation ne fait pas
échouer l'envoi : la commande existe, simplement présentée en lots.

**La réception se compte et s'envoie en PIÈCES, jamais en packs.**
`POST /v2/purchase-orders/{id}/receive` ajoute au stock le nombre envoyé, littéralement,
mais le compare au `qty` de la ligne. `items[].id` est l'identifiant de **la ligne chez
BMS**, ni le SKU ni le produit — relevé à l'ouverture de la session, sans lui rien ne part.
**BMS n'a aucun garde-fou** (il accepte une réception de 5 sur une ligne commandée à 1) :
les trois contrôles sont entièrement de notre côté, dans `receptionSessionModel`.

**On ne se fie jamais au statut BMS pour dire qu'une commande est reçue.** Il solde une
ligne dès que son `qty_received` atteint son `qty` — comparaison packs contre pièces. C'est
NOTRE décompte, en pièces de bout en bout, qui décide (`RECEPTION_INCOMPLETE`).

**`POST /v2/purchase-orders/{id}/items` sait ajouter une ligne** à un bon existant (v2
seulement). Toujours en pièces avec `qty_pack: 1`. Préférer ce chemin à un ajustement de
stock : la marchandise garde son prix d'achat et son lien au fournisseur.

- **BMS désigne un produit par `product_id`, JAMAIS par son SKU.** Envoyer `sku` est refusé
  sans appel : `400 {"errors":{"sku":["The field 'sku' is read-only."]}}`. Le SKU d'une
  ligne n'est que le reflet du produit. L'ordre des champs du payload n'y change rien
  (vérifié le 30/09/2026 sur bon ouvert ET terminé).
- **Nous ne stockons pas ce `product_id`** : le lire avec `/supplier/products?sku=…`, qui
  renvoie les associations fournisseur × produit. N'importe laquelle donne le même
  `product_id` — il désigne le produit, pas l'association.
- **Le bon peut être TERMINÉ.** BMS accepte une ligne neuve sur un bon `complete`, sans le
  rouvrir (vérifié le 30/09/2026 sur le bon 121413). C'est le cas qui compte : on s'aperçoit
  d'un article oublié après avoir soldé la commande. On y accède par « Réceptionner » depuis
  la commande — la liste des réceptions ne montre que les bons en attente.
- **`DELETE /v2/purchase-orders/{id}/items/{itemId}`** existe et fonctionne (utile pour
  défaire un essai).

**Ne jamais remplacer les lignes d'une commande en cours de réception.**
`reception_counts.purchase_order_item_id` est `ON DELETE CASCADE` : un `DELETE` sur
`purchase_order_items` emporte le comptage **en silence**. `syncFromBMS` saute donc le
remplacement des lignes quand une session est en `counting` (et le compte dans
`preserved`) ; la réception reprend ce que BMS a de neuf par « Recharger depuis BMS »,
qui ajoute et rapproche sans jamais supprimer.

**Non-régression** : `cd backend && npm test` → `tests/bmsPayload.test.js` rejoue les quatre
cas réels et pose l'invariant qui les aurait tous attrapés — *l'argent envoyé doit toujours
égaler l'argent commandé*. **À lancer après toute modif du payload BMS.**

### Le catalogue d'un fournisseur se prouve (recherche produits des achats)

`GET /api/purchases/products/search` répond « ce produit est-il à ce fournisseur ? » —
et **la présence d'une ligne `product_suppliers` ne le prouve pas**.
`supplierModel.syncProductSuppliersFromBMS` recopie les associations **déclarées par BMS**,
souvent sans prix : ce que le fournisseur *pourrait* fournir, pas ce qu'on lui a acheté.
534 produits sur 2688 étaient dans ce cas pour LCA seul.

**Trois preuves, une seule suffit** — c'est la définition de `catalogueExpr` :
1. une **référence** chez ce fournisseur (`supplier_refs`) ;
2. une ligne de commande **déjà passée** chez lui (`purchase_order_items` → `purchase_orders`) ;
3. un lien `product_suppliers` **tarifé** (`supplier_price IS NOT NULL`).

Réfs et historique portent sur le **produit exact** (jamais un parent variable, on ne
commande pas un parent) ; le lien tarifé garde le repli sur le parent, car c'est là que
`product_suppliers` stocke les associations des variables.

- **`all_suppliers=1`** ouvre la recherche à tout le catalogue, sans rien perdre de
  l'enrichissement (réfs, conditionnements, dernier tarif retenu). Nécessaire : un produit
  fraîchement créé n'est rattaché à personne, et on doit pouvoir commander ailleurs un
  article vu moins cher. Dans `CreateOrderPage`, c'est la case « Chercher dans tout le
  catalogue » — **fermée par défaut**.
- **`in_supplier_catalogue`** est renvoyé sur chaque ligne dès qu'un `supplier_id` est
  donné, et les produits du fournisseur sont **triés en premier**. Proposer un produit
  jamais commandé là est légitime ; le proposer **sans le dire** ne l'est pas — l'écran le
  marque « jamais commandé ici ».
- **Ne jamais « réparer » ça en supprimant les liens vides** : la donnée BMS est juste,
  c'est la prendre pour une preuve d'achat qui était faux.

### Bundles WooCommerce (woosb)

Les produits de type `woosb` (packs) génèrent **deux lignes** dans `order_items` :
1. Le bundle lui-même (ex: Pack 10 Boosters) avec le prix réel
2. Chaque composant (ex: Booster unitaire) avec `line_total = 0.00€` et la quantité incluse

**Conséquence :** quand on compte les unités d'un produit simple, les unités vendues via bundle sont **déjà incluses** (à 0€). Ne jamais additionner les deux.

**Règle :** pour toute question sur les volumes d'un produit, toujours vérifier d'abord si ce produit est composant d'un bundle avec une requête sur un cas concret avant de conclure.

### Doutes sur une table/colonne
Introspecter avec `\d+ nom_table` plutôt qu'inventer.

### Modifier le plugin yousync
**Lire `yousync/AVANT-DE-MODIFIER.md` avant toute mise à jour du module.**

`git push` ne met PAS à jour la prod : le plugin tourne sur un hébergement
Plesk séparé déployé par Deployer (`current -> releases/N`) à partir du repo
du site, géré côté agence. Toute modif déposée à la main y est effacée au
déploiement suivant — c'est déjà arrivé (correctif posé le 03/08/2026, effacé
le 05/08).

Ce repo est en **1.4.1**, la prod en **1.4.0**. L'écart = le correctif marques
parent/enfant dans `get_product()`. Une nouvelle version repartie de la 1.4.0
réintroduirait le bug : le conserver, et faire passer la version par le repo
du site.

Le bug est neutralisé côté backend en attendant
(`backend/src/services/brandMapService.js`) — ne pas supprimer ce service en
même temps qu'une mise à jour du plugin.

---

## Connexion VPS

- **Alias SSH** : `youvape` (configuré dans `~/.ssh/config`)
- **IP** : 54.37.156.233
- **User** : ubuntu
- **Clé** : `~/.ssh/id_ed25519`

---

## Sécurité

### Authentification des routes API
La plupart des routeurs de données (`stats, customers, products, orders, brands,
categories, analysis, reports, shipping, payment, tariffs, transporteurs,
competitors, chronopost, colissimo, lettre-suivie, mondial-relay`) sont protégés
par `authMiddleware` (JWT) **au point de montage dans `server.js`**
(`app.use('/api/x', authMiddleware, xRoutes)`). Le front attache le token à
**chaque** requête via un intercepteur axios global (`main.jsx`) — donc tout
nouvel appel de lecture est authentifié sans effort. Les appels `fetch()`
(hors axios) doivent poser le header à la main.

**Routeurs volontairement NON couverts par le JWT utilisateur** (ne pas casser) :
- `/api/auth` (login public)
- `/api/sync` + `/api/woo-sync` (ingestion YouSync depuis WordPress — **pas d'auth
  aujourd'hui, à sécuriser via un secret partagé, pas un JWT utilisateur**)
- `/api/webhook` (a son propre `verifyToken`)
- `/api/client-sav` (a son propre middleware `CLIENT_SAV_SECRET`)
- routeurs déjà auto-authentifiés (`reviews, rewards, emails, users, settings,
  purchases, packing, laposte, preferences, financier, sav`)

**Règle** : tout nouveau routeur exposant des données doit être monté avec
`authMiddleware` dans `server.js`, sauf s'il est appelé par un système externe
(alors : secret dédié).

## Bugs corrigés — historique

### 2026-09-29 — Commander et réceptionner sans ouvrir BMS (`eaba186` → `34cbef8`)
**Fichiers** : `purchaseOrderModel.js`, `receptionSessionModel.js`, `receptionController.js`,
`orderLifecycleModel.js`, `purchasesController.js`, `CreateOrderPage.jsx`, `ReceptionApp.jsx`,
`OrdersTab.jsx`, `tests/bmsPayload.test.js`

Le cycle complet — commander, recevoir, contrôler la facture — depuis l'app. Les règles
établies sont dans « Commandes d'achat : la sémantique BMS » ci-dessus ; ici les pièges.

- **Un troisième chemin vers une commande**. Il en existait deux (besoins calculés, import
  PDF) et aucun ne convenait pour commander deux références précises. `NeedsTab` V1 ne
  contenait d'ailleurs aucun `axios.post` : il ne savait pas créer de commande.
- **La recherche produits n'est PAS restreinte au fournisseur choisi** (`all_suppliers=1`).
  Restreindre est un bon réflexe pour compléter une commande, un mauvais pour en créer une :
  un produit fraîchement créé n'est rattaché à personne et restait introuvable. Le
  fournisseur **enrichit** les résultats (ses réfs, leurs packs, le dernier tarif retenu),
  il ne filtre plus. Marque et sous-marque sont cherchables — elles vivent sur le **parent
  variable**, d'où les quatre colonnes ajoutées.
- **Le prix boucle la boucle** : il part du dernier tarif **retenu** sur une facture
  contrôlée (`supplier_refs.price_retained_at`), signalé en vert. Ce qui a été réellement
  payé, pas un souvenir.
- **Le champ « Par » est redevenu modifiable le 06/10/2026** (`75f6c2e`). Il était verrouillé
  tant que BMS imposait le conditionnement du catalogue ; depuis la bascule du 30/09/2026
  (associations à `pack_qty = 1`), `buildBmsItems` envoie `quantité × lot` pièces au prix du
  lot ÷ lot, donc le lot choisi ne diverge plus de BMS. Changer le lot garde le **prix de la
  pièce** (le prix saisi est celui du lot). Application groupée quantité/lot/prix aux lignes
  cochées (tout, aucune, par marque).
- **Piège `packChoisi`** : un conditionnement n'était retenu que s'il valait **plus de 1**,
  donc une ligne « par 1 » retombait sur le catalogue — 5 pièces commandées parties en 25.
  `packChoisi` distingue désormais « non fourni » (`null`) de « fourni à 1 ».
- **Réception partielle** : BMS passait la commande en `complete` après 4 pièces sur 40, elle
  **disparaissait** de l'écran de réception et les 36 restantes n'avaient plus aucun moyen
  d'y être enregistrées. Corrigé par `RECEPTION_INCOMPLETE` (notre décompte fait autorité).
- **`esbuild` ne remplace pas ESLint** : il prend une fonction appelée mais non définie pour
  une variable globale. ESLint, configuré dans le projet, a trouvé `supplier_sku` écrit deux
  fois dans le payload (la seconde écrasant la première) et un `handleScan` sans sa
  dépendance `compterCarton` — le scan aurait gardé une **session figée**, le comptage
  cessant d'être enregistré sans que rien ne le signale. **Lancer `npx eslint` sur les
  fichiers touchés**, pas seulement un build.

### 2026-10-02 — Date de réception = dernière modification BMS (`commit 2e59852`)
**Fichiers** : `bmsApiModel.js` (`getReceptionDatesByReference`), `purchaseOrderModel.js` (`syncFromBMS`),
`scripts/backfillReceivedDates.js`

- **Symptôme** : `purchase_orders.received_date` recopiait `updated_at` du bon BMS terminé, qui
  bouge à chaque retouche (S313016 reçue à 12h34, affichée 16h11 après un tarif corrigé ;
  S300761 reçue le 09/07, datée du 26/08).
- **Correctif** : date de la **dernière** réception du journal BMS `/supplier/receptions`
  (clé = référence du PO, + nom du fournisseur pour les quelques références en double).
  Aucune date tant que la commande n'est pas `completed`. Ne jamais revenir à `updated_at`.
- **Rattrapage** appliqué le 02/10/2026 : 880 commandes corrigées. `received_date` date aussi
  les lots FIFO (`computedCostModel`, `stockValuationModel`).

### 2026-09-30 — La synchro BMS effaçait un comptage de réception en cours
**Fichiers** : `purchaseOrderModel.js` (`syncFromBMS`), `cronService.js`, `purchasesController.js`

- **Symptôme** (trouvé à la relecture, pas en production) : une session de réception
  perdait toutes ses lignes, puis refusait de se valider sur « Aucune pièce comptée »,
  sans rien dire de la cause.
- **Cause** : `syncFromBMS` remplace les lignes d'une commande mise à jour
  (`DELETE FROM purchase_order_items` puis `INSERT`), et
  `reception_counts.purchase_order_item_id` est `ON DELETE CASCADE` → le comptage part avec
  les lignes. Le cron tourne `30 9-19 * * 1-5` et une commande en réception est `expected`
  chez BMS, donc toujours dans le périmètre : un comptage commencé à 10h15 était perdu à
  10h30. Exactement ce que la session en base devait empêcher.
- **Correctif** : le remplacement des lignes est sauté quand une `reception_sessions` est en
  `counting`. L'en-tête reste synchronisé (statut, dates, totaux), compté dans `preserved`
  et dit dans les journaux du cron comme dans la réponse de la synchro manuelle.
- **Contrepartie assumée** : pendant un comptage, une ligne ajoutée dans BMS ne remonte plus
  toute seule. C'est « Recharger depuis BMS » qui la reprend — il ajoute et rapproche sans
  jamais supprimer, et le message de la synchro manuelle y renvoie.

### 2026-08-31 — Import fournisseur : des lignes disparaissaient sans un mot
**Fichiers** : `parsers/revoluteParser.js`, `parsers/etastyParser.js`,
`parsers/cigaccessParser.js`, `models/parseAudit.js`, `models/pdfImportModel.js`,
`ImportPdfPage.jsx`, `tests/parsers.test.js`

- **Symptôme** : une ligne de la facture n'arrivait jamais dans la commande. Aucune
  erreur, aucun total incohérent — le contrôle de total retombait sur la **somme des
  lignes parsées**, donc cohérent par construction. Trois cas réels :
  Revolute FA020464 (REF2665, 60,00 € HT), e.tasty FA072725 (54,40 € HT),
  CigAccess FA128317 (160,32 € HT, **et** sa référence recopiée sur la ligne suivante).
- **Causes** : saut de page (le mobilier de page se colle devant le 1er article de la
  page suivante, la référence n'est plus en tête de bloc) ; colonne « Prix de base »
  à `--` chez CigAccess, qui faisait échouer la détection de ligne de prix.
- **Garde-fou universel** : `models/parseAudit.js` → `findUnparsedRows()` relit le
  document à la recherche de la signature `PRIX € QTÉ TOTAL €` **vérifiant
  QTÉ × PRIX = TOTAL** (l'égalité s'auto-valide) et signale en rouge, dans l'écran
  d'import, toute ligne qui n'a produit aucun item. Indépendant du fournisseur : il
  couvre aussi les parseurs jamais testés.
- **Réconciliation de total** : un parseur peut exposer `invoiceProductTotalHT` +
  `invoiceProductTotalIsGross` (total « Total produits » IMPRIMÉ, brut). Sans ce
  second drapeau, pas de comparaison : « Montant HT » inclut parfois port et remises,
  et une alerte qui crie au loup ne protège plus de rien.
- **Non-régression** : `cd backend && npm test` rejoue les 3 factures réelles
  (fixtures = texte brut figé de pdf-parse). **À lancer après toute modif de parseur.**

### 2026-08-20 — Valeur de stock du rapport stats désalignée du catalogue (`commit 9ecb1ed`)
**Fichiers** : `stockValuationModel.js`, `cronService.js`, `ReportsTab.jsx`,
`scripts/checkStockValuation.js`, `scripts/recomputeStockValuationSnapshots.js`

- **Symptôme** : la « Valeur de stock » de `/stats/reports` était très supérieure à celle du
  catalogue à la même date.
- **Causes (3, cumulatives)** :
  1. `units_per_qty` ignoré — `stockValuationModel` était le **seul** consommateur de
     `purchase_order_items` à ne pas l'appliquer : lots FIFO `units_per_qty` fois trop petits ET prix
     **du pack** appliqué à chaque unité (cf. Booster Nicotine 100VG : 22,50 €/u au lieu de 0,23 €).
     Les lots trop petits étaient en plus intégralement consommés par le pointeur de ventes → repli
     sur « prix du dernier lot » = dernier prix de pack.
  2. Statuts de vente en **liste noire** au lieu de la liste blanche des 6 statuts payés → pointeur
     FIFO décalé par les statuts custom (même bug que le 2026-07-29 sur `computedCostModel`).
  3. Périmètre différent du catalogue : tous les produits ayant du stock (brouillons, privés, non
     suivis) au lieu des seuls publiés/suivis.
- **Correctif** : `stockValuationModel` aligné sur le catalogue — même périmètre
  (`STOCK_VALUE_SCOPE`), même coût courant à la date du jour, lots ramenés à l'unité, liste blanche.
  Les dates passées gardent le coût d'époque (PMP FIFO borné à la date), mais avec exactement les
  mêmes entrées que `computedCostModel`.
- **Garde-fou** : le cron de snapshot (23h55) compare rapport et catalogue et alerte par mail au-delà
  d'un centime d'écart. Vérification manuelle : `node src/scripts/checkStockValuation.js`.
- **Rattrapage** : `node src/scripts/recomputeStockValuationSnapshots.js --apply` recalcule les
  snapshots déjà pris avec l'ancienne formule (ils passent en `method = 'recomputed'`, affichés
  « Reconstruit » — leurs quantités redeviennent approximatives).

### 2026-08-14 — Sous-marques vidées par yousync (`commit 2c5b07b`)
Un produit portant à la fois le terme `pwb-brand` parent (« Eliquid France »)
et son enfant (« Fruizee Max ») revenait avec `sub_brand` **vide** : yousync
1.4.0 déduit la marque avec `$brands[0]`, qui est le parent. La sous-marque
était écrasée en base à chaque édition du produit et n'apparaissait nulle part
dans l'app (20 des 24 produits Fruizee Max étaient concernés).

Le correctif plugin (1.4.1) ne tient pas : les déploiements Deployer du site
l'effacent. La correction vit donc dans le backend —
`backend/src/services/brandMapService.js` reconstruit produit →
marque/sous-marque depuis la taxonomie `pwb-brand` via l'API REST WP v2
(`wc/v3` n'expose pas les taxonomies custom), réaligne `products` toutes les
heures et restaure la sous-marque avant chaque upsert produit.

Premier passage : 2159 produits analysés, 77 corrigés, 34 vidés (sous-marques
retirées dans WordPress, valeurs périmées en base).

Voir `yousync/AVANT-DE-MODIFIER.md`.


### 2026-08-11 — Achats : arrivages comptés en packs (`commit b41501d`)
**Fichiers** : `purchaseOrderModel.js`, `productModel.js`, `needsCalculationModel.js`, `productsController.js`, `OrdersTab.jsx`

- **Règle à connaître** : `purchase_order_items` a **deux unités de compte**. Pour les
  fournisseurs « à l'unité » (`parserRegistry.skipsPackQty` : LCA, Highbuy, Levest,
  MG Vape), `qty_ordered` = nombre de **PACKS** et `unit_price` = prix **DU PACK** ;
  ailleurs, `qty_ordered` = unités et `unit_price` = prix unitaire. Dans les deux cas
  `qty_ordered × unit_price` = montant de la ligne (invariant), d'où la survie du bug.
- **Symptôme** : un pack de 10 LCA (BMS PO 118531, `#REF12575-41110` : qty 1 ×
  qty_pack 10 à 8,70 €) apparaissait « 1 pièce en arrivage » au lieu de 10 — les
  6 requêtes d'arrivage sommaient `qty_ordered - qty_received` comme des unités.
- **Correctif** : colonne `purchase_order_items.units_per_qty` = nombre d'unités de
  stock par `qty_ordered` (1 par défaut, `qty_pack` pour les lignes en packs),
  renseignée à la synchro BMS, à la création et à l'édition de commande.
  **Tout calcul de stock doit faire `(qty_ordered - qty_received) × units_per_qty`.**
- **Rattrapage** : jamais via `product_suppliers.pack_qty` (= conditionnement COURANT
  du catalogue, pas celui de la commande passée : les vieilles lignes boosters LCA,
  déjà en unités, deviennent des packs de 200). Utiliser
  `node backend/scripts/backfillUnitsPerQty.js [--all] [--apply]`, qui tranche ligne à
  ligne en comparant la quantité locale à la commande BMS d'origine.
- **Sémantique BMS** : ce qui était écrit ici (« `qty` est un nombre de packs ») décrivait
  ce que BMS **stocke**, pas ce qu'il **accepte** — et confondre les deux a coûté les bugs
  du 29/09/2026. Voir la règle absolue « Commandes d'achat : la sémantique BMS » ci-dessus.

### 2026-07-29 — Sécurité : exposition de données sans authentification (`commit 1bbf603`)
**Fichiers** : `server.js`, `permissionMiddleware.js`, `main.jsx`, `CustomerAutocomplete.jsx`

- **Faille** : ~15 routeurs (dont `customers`, `orders`, `products`, `stats`…)
  n'appliquaient aucun `authMiddleware` → `GET /api/customers/stats-list` renvoyait
  emails clients + historique d'achat **sans token**, en clair sur l'IP publique.
- **Correctif backend** : `authMiddleware` ajouté au montage dans `server.js` (voir
  section Sécurité pour la liste + exclusions).
- **Correctif frontend** : intercepteur axios global (`main.jsx`) attachant le token
  à toutes les requêtes (beaucoup d'appels de lecture ne le posaient pas) ; fix du
  `fetch()` de `CustomerAutocomplete` (SAV) qui ne l'envoyait pas.
- **`permissionMiddleware`** : renvoyait 500 au lieu de 401 quand `req.user` absent.
- **Reste à faire** : sécuriser `/api/sync` + `/api/woo-sync` (ingestion WordPress)
  via un secret partagé — actuellement sans auth.


### 2026-07-29 — Stats : paniers abandonnés comptés comme ventes (`commits 9590b14, 5bd7a26`)
**Fichiers** : `productModel.js`, `customerModel.js`, `categoriesController.js`, `ProductsStatsTab.jsx`

- **Cause racine** : filtrage par statut incohérent dans toute l'app stats. Plusieurs requêtes utilisaient une **liste noire incomplète** `NOT IN ('wc-failed','wc-cancelled')`, laissant passer `wc-checkout-draft` (3 546 paniers abandonnés, dont 3 532 rattachés à de vrais clients ≈ 157 k€ fantômes), `wc-pending` et `wc-refunded`.
- **Onglet Produits** (`productModel.getStatsList`, `item_base`) : `qty_sold`/CA/marge gonflés. Ex. Puff Falcon X 60 j = 213 → **148** (Metorik : 144). Corrigé aussi `getVariationsForStats` (détail par variation) et `getStatsCountries` (filtre pays).
- **Onglet Clients** (`customerModel`) : `order_count`/`total_spent`/dates/coût/marge/commandes-par-mois incluaient les paniers abandonnés. Ex. client 20728 : 17 cmd / 619 € → **0 / 0** (toutes ses "commandes" étaient des drafts).
- **Onglet Catégories** (`categoriesController.VALID_ORDER_STATUSES`) : contenait le statut **fantôme `wc-wms_cp_delivered`** et **oubliait `wc-shipped` + `wc-awaiting-delivery`** (sous-comptage).
- **Correctif** : partout, liste blanche des 6 statuts payés (`wc-completed, wc-delivered, wc-processing, wc-awaiting-delivery, wc-shipped, wc-being-delivered`), cohérente avec Financier/Analyse.
- **Règle** : pour toute stat de ventes/CA, **toujours filtrer en liste blanche des 6 statuts payés**, jamais en liste noire (le shop a des statuts custom + `wc-checkout-draft` très volumineux).
- **Choix assumé** : la tab Produits reste sur `post_date` (pas `paid_date`) car elle est cross-checkée contre Metorik qui indexe sur la date de commande ; l'écart `paid_date`/`post_date` > 1 j ne concerne que ~0,4 % des commandes.
- **Bonus** : `ProductsStatsTab` préremplissait les dates du sélecteur perso via `toISOString()` (UTC → veille en soirée), remplacé par `localFmt`.

**Audit VPS complémentaire (même jour)** — 3 autres foyers du même bug trouvés et corrigés :
- **Onglet Marques** (`brandsController.VALID_ORDER_STATUSES`, 7 requêtes) : identique à Catégories (statut fantôme `wc-wms_cp_delivered` + oubli `wc-shipped`/`wc-awaiting-delivery`). → 6 statuts payés.
- **Dashboard `statsService`** (KPIs, top produits/clients, CA par pays/catégorie via `statsRoutes`) : liste blanche à 4 statuts, oubliait `wc-shipped` + `wc-being-delivered` (137 cmd / 6 k€ latents). → 6 statuts.
- **Coût PMP FIFO** (`computedCostModel.recalculateAll`) : le "total vendu" consommant les lots FIFO utilisait `NOT IN (cancelled,refunded,failed,on-hold,pending)` sans exclure `wc-checkout-draft` → **2 267 produits/3 631 (62 %)** avaient un total vendu gonflé (25 262 unités fantômes, pire cas +6 437), décalant le pointeur FIFO et faussant `computed_cost` (donc toutes les marges). → 6 statuts payés. Recalcul auto via cron (`5,35 9-19 * * 1-5`).
- **Vérifiés OK** : `stockValuationModel` (exclut bien checkout-draft), `financierController`, `ordersController`/`reportsController` (liste noire complète), `customerResolver` + `reimportIncompleteOrders` (maintenance/identité, sans impact chiffres).

### 2026-05-22 — Besoins achats : alignement ATUM (`commits b85d907 → fb35b10`)
**Fichiers** : `NeedsTab.jsx`, `needsCalculationModel.js`

- **Formule ATUM** : remplacement de `theoreticalSafety = max_order_qty + fifteenDaysSales` par `dailyRate = salesInPeriod / periodDays` → besoin uniquement si `stockWillLast < leadTime + coverage`. Élimine les faux positifs (produits sans ventes récentes).
- **Fenêtre 31 jours** : alignement sur ATUM "Sales last 31 days" (au lieu de 30j). Inclure le jour courant (les commandes du jour sont valides).
- **Migration localStorage** : quand on change une valeur par défaut sauvegardée côté client, toujours prévoir la migration dans `loadSavedFilters()` — sinon les utilisateurs existants gardent l'ancienne valeur.
- **lead_time_days** ajouté au raw data backend pour calcul de la cible.
- **Colonne "Stock j."** ajoutée (jours de stock restants, équivalent ATUM "Stock will last days").
- **Statuts needsCalculationModel** : ajout `wc-awaiting-delivery`, `wc-shipped`, `wc-being-delivered` (x7 requêtes).

---

### 2026-05-22 — Dates temps réel (`commit 968bf4e`)
**Fichiers** : `ProductsStatsTab.jsx`, `NeedsTab.jsx`

- `ProductsStatsTab` utilisait `toISOString()` (UTC) → en heure Paris, donnait **la veille** comme date de fin. Remplacé par formatage local.
- Mode jours et mois : inclure le jour/mois en cours pour des données temps réel.

---

### 2026-05-22 — Statuts fallback incomplets purchases/stats/analysis (`commit fdcaabb`)
**Fichiers** : `productStatsService.js`, `reportsController.js`, `analysisController.js`

- `productStatsService` : ajout `wc-awaiting-delivery`, suppression `wc-wms_cp_delivered` (inexistant en BDD).
- `reportsController` : fallback par défaut `wc-completed + wc-delivered` → 6 statuts valides (x2 occurrences).
- `analysisController` : fallback manquait `wc-shipped` et `wc-being-delivered`.

---

### 2026-05-22 — Statuts incomplets sur toutes les pages (`commit ee8810a`)
**Fichiers** : `productModel.js`, `customerModel.js`, `advancedFilterService.js`, `paymentController.js`

- 28 occurrences de `wc-completed` seul (ou sets incomplets) remplacées par les 6 statuts valides sur l'ensemble du backend.
- Pages corrigées : `/products/:id` (stats, top clients), `/customers` + `/customers/:id` (total_spent, order_count), recherche avancée clients, calcul frais paiement (suppression `wc-pending`).

---

### 2026-05-22 — Ventes 30j catalogue (`commit 5fe9080`)
**Fichier** : `backend/src/models/productModel.js`

- La requête ventes 30j filtraient sur `wc-expediee` (statut inexistant) et omettait `wc-delivered`, `wc-awaiting-delivery`, `wc-shipped`, `wc-being-delivered`. Résultat : 0 ventes affichées pour tous les produits.
- Corrigé avec les 6 statuts valides identiques au reste de l'app.

---

### 2026-05-21 — Export PDF & envoi BMS (`commit 385cce1`)
**Fichiers** : `purchasesController.js`, `purchaseOrderModel.js`, `OrdersTab.jsx`

- **Fix crash export CSV** : `total_amount` retourné par PostgreSQL est une string (type `numeric`). Correction : `parseFloat(order.total_amount).toFixed(2)`.
- **Messages d'erreur** : tous les `catch` du `purchasesController` renvoyaient `'Erreur serveur'` en dur. Corrigé en `error.message || 'Erreur serveur'` pour afficher la vraie cause.
- **Validation avant envoi BMS** : si des articles n'ont pas de `unit_price`, le backend bloque avec un message listant les SKUs concernés au lieu de laisser BMS retourner une 500 opaque.
- **Frontend** : la réponse d'erreur sur l'export est un `Blob` (responseType blob). Ajout d'une lecture `Blob → JSON` pour extraire et afficher le message réel.

> **Règle déployement** : le backend et le frontend sont dans des images Docker — modifier les fichiers sources ne suffit pas. Il faut **rebuilder les images** (`docker compose build`) et relancer les containers.

---

## Sources de vérité
- `docs/DATABASE.md` — schéma des 34 tables
- `docs/ARCHITECTURE.md` — infra, backend, frontend
- `docs/BUSINESS_LOGIC.md` — logique métier
- `.claude/api-routes.md` — routes API
