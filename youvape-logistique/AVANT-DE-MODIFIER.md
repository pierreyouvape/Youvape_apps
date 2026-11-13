# À LIRE AVANT TOUTE MISE À JOUR DE YOUVAPE-LOGISTIQUE

> ⚠️ **NOTE INTERNE — ne sort JAMAIS du dépôt.** Le zip pour l'agence se fait avec
> `-x '*.md'` (voir §3). Le document destiné à l'agence est `readme.txt`.

## 1. Pourquoi ce plugin

Il remplace ce que BMS écrit aujourd'hui dans WooCommerce, pour le jour où on quitte BMS
(chantier « sortie de BMS », mémoire `chantier-sortie-bms`) :

| Aujourd'hui (BMS) | Demain (ce plugin) |
|---|---|
| Réécrit le stock WC (et la nuit, s'il diffère) | `POST stock/adjust` : des **écarts**, jamais une valeur absolue |
| Passe la commande en « Colis expédié » (`completed`) ou « Retrait boutique » (`awaiting-delivery`), écrit `bms_*` + note | `POST order/ship` : **uniquement les métas `_yv_*`**, plus aucune `bms_*` |
| Le plugin agence `vikings-update-order-status-automatically` passe en « Livrée » | Notre backend suit les colis et pose le statut par `POST order/status` |
| — | `POST order/status` : aussi le nettoyage des statuts figés, avec ou sans mail (`notify_customer`) |
| Case « Restocker » cochée par défaut dans l'admin | Cochée seulement si la commande n'est pas expédiée (`includes/refunds.php`) |

Écrit par nous, déployé par l'agence, **inactif jusqu'au jour de la bascule**.
Version 0.6.0 écrite et testée en préprod le 10/11/2026 (0.5.0 le 05/11, 0.4.0 et 0.3.0 le 02/11, 0.2.0 le 30/10,
après la réunion agence du 29/10). Essais et points encore non prouvés : §10.

⚠️ **Ne jamais appeler `stock/adjust` tant que BMS tourne** : BMS réécrit le stock WC la
nuit s'il diffère du sien, nos écarts seraient effacés (ou pire, comptés deux fois au
retour en arrière). En double marche, le journal est seulement calculé et comparé.

## 2. `git push` ne met PAS à jour la prod

Comme yousync et youvape-loyalty : le site est déployé par **Deployer** depuis le dépôt du
site, géré par l'agence (`/var/www/vhosts/youvape.fr/current -> releases/N`).
**Un plugin déposé à la main sur la prod est effacé au déploiement suivant.**

Déployé par fichiers, le plugin arrive **inactif** : l'activer dans l'admin WordPress le
jour de la bascule. L'activation crée les deux tables (§5).

## 3. Livrer à l'agence

```bash
zip -r youvape-logistique.zip youvape-logistique -x '*.DS_Store' -x '*.md'
unzip -l youvape-logistique.zip   # puis relire CHAQUE fichier listé
```

Le zip doit contenir : `youvape-logistique.php`, `readme.txt`, `includes/*.php`. Jamais ce
fichier (incident du 16/10/2026 avec youvape-loyalty, cf. CLAUDE.md « Livrable pour un tiers »).
Le `readme.txt` (format WordPress, pas `.md` exprès : il doit survivre au `-x '*.md'`) ne
contient aucune info interne : le relire avant chaque envoi.

## 4. Si tu modifies le plugin

- [ ] Incrémenter la version **aux deux endroits** : en-tête `Version:` et
      `YOUVAPE_LOGISTIQUE_VERSION`, + le changelog de `readme.txt`.
- [ ] Changement de schéma → incrémenter `YOUVAPE_LOGISTIQUE_DB_VERSION` : dbDelta est
      relancé au chargement suivant (une mise à jour par fichiers ne relance pas l'activation).
- [ ] **Garder le préfixe `wc-` du namespace.** WooCommerce n'authentifie ses clés que sur
      `/wp-json/wc/…` et `/wp-json/wc-…` (`WC_REST_Authentication::is_request_to_rest_api`) :
      sans lui, la requête arrive anonyme et part en 401.
- [ ] **Jamais `get_post_meta` / `update_post_meta` sur une commande** : le site passera en
      HPOS après BMS. Tout passe par `wc_get_order()` / `update_meta_data()` / `save()`.
      (Les produits restent des posts même en HPOS.)
- [ ] Syntaxe compatible **PHP 7.4** (pas de `match`, `?->`, `str_contains`, arguments nommés…).
      `php -l` : pas de PHP sur le Mac, `ssh youvape 'php -l' < fichier` (PHP 8.2, ne
      détecte donc PAS une syntaxe 8 seulement).
- [ ] Tester sur la copie de test du site (§10) avant tout envoi.

## 5. Tables (créées à l'activation, jamais supprimées)

Pas de `uninstall.php`, exprès : ces tables sont la garantie d'idempotence. Les perdre
permettrait de rejouer des mouvements déjà appliqués. Dates en **UTC**.

- `{prefix}yv_logistique_stock_movements` : `movement_id` UNIQUE, `fingerprint`
  (md5 `product_id|delta`), `product_id`, `stock_product_id` (id réellement modifié),
  `delta`, `reason`, `state` (`pending` / `applied`), `stock_after`, `created_at`, `applied_at`.
- `{prefix}yv_logistique_shipments` : `shipment_id` UNIQUE, `fingerprint`
  (md5 `order_id|status|carrier|tracking_number`), `order_id`, `state`, `status_requested`,
  `status_from`, `status_to`, `carrier`, `carrier_label`, `tracking_number`, `tracking_url`,
  `shipped_at`, `notified`, `created_at`, `applied_at`.

Option `youvape_logistique_settings` (réglages, §7) et `youvape_logistique_db_version`.

**Une ligne restée `pending`** = la requête est morte entre la réservation et la
confirmation (plantage PHP, coupure). L'état réel est inconnu : le plugin répond
`MOVEMENT_PENDING` / `SHIPMENT_PENDING` à chaque renvoi, jamais « déjà fait ». À vérifier à
la main (stock du produit, notes de la commande), puis supprimer la ligne (rejouable) ou
la passer en `applied`.

## 6. Ce qui a été vérifié dans le source (WooCommerce 11.2.1, woosb 8.7.8)

WooCommerce : version de la prod, mesurée le 30/10/2026 (la préprod est en 10.8.1, `GET status`
donne la version réelle). Sources téléchargées depuis wordpress.org : pas d'accès au serveur du site.
Thème, Vikings, WPLoyalty PRO 1.4.3 et Guaranteed Reviews : lus le 30/10/2026 dans la **copie de la
préprod**, en lecture seule, §9. Le code de la prod peut différer de cette copie.

- **`wc_update_product_stock($p, $n, 'increase'|'decrease')`** (`wc-stock-functions.php`) :
  UPDATE relatif `meta_value = meta_value ± N` (data store CPT, `update_product_stock`),
  donc une vente simultanée n'est jamais écrasée. Résout `get_stock_managed_by_id()` (une
  déclinaison au stock géré par le parent → le parent), puis `save()` du produit (statut
  de stock, caches, table lookup) et hooks `woocommerce_product_set_stock` /
  `woocommerce_variation_set_stock` / `woocommerce_updated_product_stock`.
  ⚠️ Il renvoie le stock même pour un produit qui ne le gère pas → `managing_stock()` est
  vérifié AVANT. ⚠️ Le stock renvoyé est **calculé** à partir d'une lecture faite juste
  avant l'UPDATE : si une vente tombe pile au même instant, `stock_after` peut avoir 1 de
  retard. La base, elle, est juste.
- **woosb ne recalcule pas ses packs quand un composant bouge.** Le stock d'un pack est
  calculé **à la lecture** (`WPCleverWoosb_Product::get_stock_quantity`) et réécrit en base
  s'il a dérivé. Seule la visibilité « rupture » du pack suit immédiatement, sur un
  changement de **statut** de stock du composant (`update_stock_status`). Donc correct mais
  paresseux : à vérifier sur la copie de test.
- **Pack woosb avec woosb désactivé** : WC le chargerait comme un produit simple. Le type est
  donc lu en base (`WC_Product_Factory::get_product_type`) → refus `PRODUCT_IS_BUNDLE` même
  dans ce cas.
- **Statut inconnu** : `WC_Abstract_Order::set_status()` le remplace **en silence par
  `pending`**. Chaque statut cible est donc vérifié dans `wc_get_order_statuses()` avant
  (`STATUS_NOT_REGISTERED`) — si le plugin des statuts personnalisés est désactivé,
  `awaiting-delivery` / `delivered` disparaissent.
- **Mails** (`class-wc-emails.php`) : WC branche ses mails sur les hooks de statut, soit en
  envoi immédiat (`send_transactional_email`), soit **différés** (fonction
  `deferred_transactional_emails` : mis en file pendant la requête, envoyés plus tard par
  Action Scheduler — un `pre_wp_mail` seul ne suffirait donc PAS). Voir §9 et
  `includes/silence.php`. `GET status` dit si les mails différés sont actifs.
- **Demande d'avis native** (`Internal/OrderReviews/Scheduler`, mail désactivé par défaut) :
  programmée au passage en `completed` (le verrou 2 l'empêche en mode muet) et **annulée** au
  passage `completed → delivered`. `delivered` n'en déclenche donc jamais. La demande d'avis
  réelle du site est Guaranteed Reviews, §9.
- **Note de transition** : `set_status()` + `save()` ajoute « Statut de la commande modifié
  de X à Y. », précédé du texte passé à `set_status`.
- **`woocommerce_restock_refunded_items`** : lu uniquement par `html-order-items.php`, défaut
  `true`, sans la commande en paramètre. L'API (`restock_items`) n'est pas concernée. Cette vue
  est incluse à 11 endroits : la page (`$theorder` posé par `WC_Meta_Box_Order_Items::output` sur
  l'écran classique et `PageController` sur HPOS) et 10 Ajax, dont `load_order_items` rappelé après
  un remboursement. Ces Ajax rejouent le filtre sans `$theorder`, mais tous reçoivent `order_id`.
  **Règle** (`includes/refunds.php`) : cochée si le statut n'est ni expédiée, ni retrait, ni livrée, ni interdit, sans ligne
  dans la table des colis (même `pending`) et sans `bms_tracking_number` ; décochée sinon, et si
  la commande est introuvable. Pas un réglage. L'équipe peut toujours changer la case à la main.
- **Notifications « retour en stock »** (WC 10.x, `Internal/StockNotifications`) : si elles
  sont activées, un écart positif via `stock/adjust` les déclenche comme un ajustement admin.
  Voulu.

## 7. Réglages (`GET` / `POST settings`)

Tous modifiables depuis l'app du VPS (`/settings`, onglet « Paramètres WooCommerce »). `POST` = mise à
jour **partielle** (seules les clés envoyées changent) ; une seule erreur et rien n'est enregistré. Une
clé enregistrée qui n'existe plus (réglages de la 0.1.0 et de la 0.2.0) est ignorée à la lecture et
disparaît au prochain enregistrement.

| Clé | Défaut | Rôle |
|---|---|---|
| `status_changes_enabled` | `false` | **Interrupteur.** Coupé : le plugin écrit les métas et la note, mais ne change aucun statut et n'envoie aucun mail ; `order/status` répond `STATUS_CHANGES_DISABLED`. À activer le jour de la sortie de BMS |
| `stock_changes_enabled` | `false` | **Interrupteur.** Coupé : `stock/adjust` refuse toutes les lignes (`STOCK_CHANGES_DISABLED`), rien n'est réservé ni appliqué. À activer seulement quand BMS ne gère plus le stock |
| `ship_status` | `completed` | Posé quand l'expédition est confirmée (« Colis expédié ») |
| `pickup_status` | `awaiting-delivery` | Posé pour un retrait boutique |
| `delivered_status` | `delivered` | Posé à la livraison. Différent des deux précédents |
| `meta_keys` | `{carrier: _yv_carrier, carrier_label: _yv_carrier_label, tracking_number: _yv_tracking_number, tracking_url: _yv_tracking_url, shipped_at: _yv_shipped_at}` | Noms **pas encore validés par l'agence**. ⚠️ `yousync/includes/class-data-fetcher.php` et `wcOrderImportService.js` lisent `_yv_carrier_label` et `_yv_tracking_number` en dur : les renommer viderait `orders.shipping_carrier` |
| `batch_max` | `100` (1–200) | Lignes par requête |
| `time_budget` | `20` (5–60 s) | Au-delà, les lignes restantes reviennent en `not_processed` |

**Modèle des statuts (02/11/2026, 0.4.0) : le plugin ne sait pas ce qui est « à expédier ».** Les
commandes arrivent par yousync et c'est l'app qui décide lesquelles partent : le réglage « statuts à
expédier » vit chez nous (`app_config.wc_to_ship_statuses`, défaut `processing`), dans le même onglet
de l'app que les trois statuts ci-dessus (« la gestion des statuts dans un sens comme dans l'autre »,
Pierre). Le plugin ne pose que trois statuts et ne refuse que les reculs et les statuts interdits :
- **expédier** (`order/ship`, ou `order/status` étape `shipped`/`pickup`) : depuis tout statut qui
  n'est ni interdit, ni déjà expédiée, retrait boutique ou livrée (ni avec un envoi enregistré) ;
- **livrer** (`order/status` étape `delivered`) : depuis tout statut qui n'est pas interdit. Couvre le
  suivi et le nettoyage des 137 `being-delivered` figées ;
- **jamais de recul** : « livrée » ne redescend pas, « expédiée » ne devient pas « retrait ».

La 0.3.0 avait un réglage `ship_from_statuses` dans le plugin : retiré, il est ignoré s'il reste enregistré.

**Interrupteur des statuts (05/11/2026, Pierre) :** les métas `_yv_*` ne gênent pas BMS, qui ne lit et
n'écrit que ses `bms_*`. Le plugin peut donc tourner en prod pendant que BMS pose les statuts, pour un
premier essai à la main, à condition de ne changer aucun statut. Le réglage est **dans le plugin**
(c'est lui qui refuse, même si l'app se trompait) et se règle depuis l'écran de l'app. Coupé :
- `order/ship` accepte une commande à tout statut non interdit (BMS a pu la passer en « expédiée »
  avant nous), écrit les 5 métas et la note (« Statut inchangé : les changements de statut sont coupés
  dans le plugin »), sans statut ni mail ; la règle du colis unique reste (second envoi refusé sauf
  `replace`, qui écrase sans renvoyer de mail) ;
- `order/status` est refusé (`STATUS_CHANGES_DISABLED`).
⚠️ yousync et `wcOrderImportService` lisent `_yv_*` AVANT `bms_*` : dès qu'une commande porte nos métas,
le transporteur et le suivi de l'app viennent d'elles. Libellés et n° identiques à BMS obligatoires.
La case « Restocker » ne dépend pas de l'interrupteur (choix de Pierre).

**Interrupteur du stock (10/11/2026, Pierre) :** même logique pour `stock/adjust`, sinon le plugin
entrerait en conflit avec BMS, qui réécrit le stock WC chaque nuit. Coupé (défaut), chaque ligne
répond `STOCK_CHANGES_DISABLED`, rien n'est réservé : le mouvement pourra être renvoyé plus tard.

À l'écran (`/settings` → Paramètres WooCommerce), les deux interrupteurs forment la section **« Action
sur WooCommerce »**, entre la connexion au site et les statuts des commandes : pour chacun, « État :
Activé / Coupé » (le réglage ENREGISTRÉ, donc ce que fait le plugin maintenant) puis une case au libellé
fixe (« Autoriser le plugin à … »), qui ne prend effet qu'à l'enregistrement.

Garde-fous : la livraison a son propre statut. Côté app, un statut « à expédier » ne peut pas être
l'un des trois statuts posés par le plugin (la commande tournerait en rond) : l'écran le refuse.

**Statuts interdits en dur**, nulle part dans les réglages : `refunded, cancelled, failed, pending,
checkout-draft, trash, draft, auto-draft`. Un passage en « annulée » fait remettre le stock par WC :
il ne doit jamais se faire en silence par ce plugin. Statuts toujours **sans** le préfixe `wc-`.
L'écran ne propose que les statuts déclarés sur le site, sans les interdits.

- `on-hold` n'est pas « à expédier » par défaut côté app (paiement non confirmé).
- `shipped` n'est déclaré nulle part dans la copie de la préprod.
- ⚠️ `being-delivered` s'affiche **« Préparation en cours »** sur le site : à ne pas utiliser pour un
  colis en transit.
- ⚠️ Statut natif de retour : **aucun** dans WooCommerce. `wc-return-approved` (3 commandes) et
  `wc-return-cancelled` (1) viennent d'un ancien plugin disparu (02/11/2026).

## 8. Contrat des routes (`/wp-json/wc-youvape-logistique/v1/…`)

Authentification : clés WooCommerce (lecture/écriture) d'un compte ayant
`manage_woocommerce`, comme `youvape-loyalty` (`consumer_key` / `consumer_secret`). Ce sont celles
du site visé, à créer sur ce site : celles de la prod ne marchent pas sur la copie de test.

### Enveloppe commune des routes d'écriture

Requête : `{ "<clé du lot>": [ ligne, ligne, … ] }` — 1 à `batch_max` lignes.

| HTTP | Code | Cas |
|---|---|---|
| 200 | — | Le lot a été lu. **Lire chaque ligne.** |
| 400 | `INVALID_BATCH` | Clé du lot absente, vide ou pas une liste |
| 400 | `BATCH_TOO_LARGE` | Plus de `batch_max` lignes (`data.batch_max`) |
| 401 / 403 | `woocommerce_rest_…` / `rest_forbidden` | Clés invalides ou sans `manage_woocommerce` |
| 404 | `rest_no_route` | Plugin absent **ou inactif** |
| 503 | `TABLES_MISSING` / `WOOCOMMERCE_MISSING` | Tables absentes (désactiver/réactiver) |

Réponse 200 :

```json
{
  "version": "0.4.0",
  "received": 3,
  "counts": { "applied": 1, "already": 1, "error": 1, "not_processed": 0 },
  "results": [ { "index": 0, "result": "applied", … }, … ]
}
```

`result` d'une ligne :
- `applied` : fait maintenant (éventuellement avec `warning` : fait, mais une erreur a suivi) ;
- `already` : déjà fait par une requête précédente, rien n'a bougé ;
- `error` : `code` + `message`, voir chaque route ;
- `not_processed` : `TIME_BUDGET`, rien n'a été fait, **renvoyer la ligne**.

⚠️ **Client d'écriture (à écrire)** : la réponse arrive APRÈS `time_budget` (mesuré : 27 s pour un budget
de 20 s), et le plugin continue d'écrire si l'app raccroche. Délai HTTP des écritures ≥ `time_budget` + 30 s
(pas les 15 s de `logistiqueService`, faits pour status/settings). Délai dépassé ou réponse perdue = **renvoyer
le lot avec les MÊMES `movement_id` / `shipment_id`** : ce qui est passé revient `already`, jamais doublé.

Codes communs : `INVALID_LINE` (champ manquant/invalide, rien fait), `EXCEPTION` (erreur
avant toute écriture, renvoyable), `DB_ERROR`.

### `POST stock/adjust` — `{ "movements": [...] }`

Ligne : `{ movement_id: "≤64 [A-Za-z0-9._:-]", product_id: int, delta: int ≠ 0 (|delta| ≤ 1e6), reason: "≤190" }`

`applied` / `already` : `{ movement_id, product_id, delta, stock_product_id, stock_after }`
(+ `applied_at` pour `already`). `stock_product_id` ≠ `product_id` quand la déclinaison
a son stock géré par le parent.

| Code | Cas | Renvoyable ? |
|---|---|---|
| `PRODUCT_NOT_FOUND` | Pas un produit | non |
| `PRODUCT_TRASHED` | Dans la corbeille | non |
| `PRODUCT_IS_BUNDLE` | Pack woosb : stock calculé, on n'y touche jamais | non |
| `PRODUCT_IS_VARIABLE_PARENT` | Parent variable : envoyer la déclinaison | non |
| `STOCK_NOT_MANAGED` | Le produit (ou la boutique) ne gère pas le stock | non |
| `MOVEMENT_ID_CONFLICT` | `movement_id` déjà utilisé avec un autre `product_id`/`delta` | non — bug côté app |
| `MOVEMENT_PENDING` | Réservé jamais confirmé : état inconnu (§5) | non — vérifier à la main |
| `STOCK_UPDATE_FAILED` | WC n'a rien écrit, réservation supprimée | oui |
| `STOCK_CHANGES_DISABLED` | Interrupteur du stock coupé : rien n'a été fait | oui, une fois activé |

Le stock peut passer sous zéro : c'est appliqué (réalité physique) et `stock_after` le montre.
Chaque écart déclenche aussi un `save()` du produit, donc un événement yousync.

### `POST order/ship` — `{ "shipments": [...] }`

**Un seul colis par commande** (02/11/2026 : on n'envoie jamais deux colis). Une étiquette refaite
(changement d'adresse…) **remplace** l'envoi avec `replace: true`.

Ligne :
```
order_id         int, obligatoire
shipment_id      "≤64 [A-Za-z0-9._:-]", obligatoire, unique chez nous
pickup           true = retrait boutique (pickup_status) ; défaut false (ship_status)
replace          true = remplacer l'envoi d'une commande déjà expédiée ; défaut false
carrier          code, obligatoire (≤64)
carrier_label    ≤190, défaut = carrier — écrit TEL QUEL dans _yv_carrier_label
tracking_number  ≤190, peut être vide (retrait entrepôt)
tracking_url     lien complet, simple adresse http(s) (pas de HTML), construit par
                 l'app : le plugin ne le fabrique pas. Peut être vide
shipped_at       ISO 8601 ; sans fuseau = heure de Paris ; défaut = maintenant
notify_customer  true|false, OBLIGATOIRE (pas de défaut, exprès)
note             ≤1000, ajoutée à la note de commande
```

- **Envoi normal** : commande ni interdite, ni déjà partie, sans aucun envoi enregistré (c'est l'app
  qui a décidé qu'elle part). Elle passe à `ship_status` (ou `pickup_status`).
- **`replace`** : commande déjà à `ship_status` (un retrait ne se remplace pas). Les 5 métas sont
  écrasées, le statut ne bouge pas, note « Suivi remplacé : ancien → nouveau ». Avec
  `notify_customer: true`, le **mail d'expédition est renvoyé** : le plugin rejoue le hook de
  TRANSITION d'origine (`woocommerce_order_status_{départ du premier envoi}_to_{ship_status}`, départ
  = `processing` pour une commande partie avant le plugin). Pas le hook de statut :
  il relancerait VosFactures et la capture Mollie. Sur le site actuel, seul Probance écoute cette
  transition : lié au prestataire ACTUEL, comme le verrou 4 du §9.

`applied` : `{ shipment_id, order_id, replaced, status_before, status_after, status_changed,
notified, mail_resent, mails_blocked }`.
`already` : `{ shipment_id, order_id, status_before, status_after, applied_at }`.

| Code | Cas | Renvoyable ? |
|---|---|---|
| `STATUS_NOT_REGISTERED` | Statut réglé inconnu du site (WC l'aurait mis en `pending`) | non |
| `ORDER_NOT_FOUND` | Pas une commande (un remboursement n'en est pas une) | non |
| `ORDER_ALREADY_SHIPPED` | Déjà expédiée (statut ou envoi enregistré) : utiliser `replace` | non |
| `ORDER_NOT_SHIPPABLE` | Statut qui ne s'expédie pas, ou `replace` sur une commande pas à `ship_status` | non |
| `ORDER_LOCKED` | Autre requête sur la même commande (verrou MySQL 10 s) | oui |
| `SHIPMENT_ID_CONFLICT` | `shipment_id` déjà utilisé pour un autre envoi | non — bug côté app |
| `SHIPMENT_PENDING` | Réservé jamais confirmé (§5) | non — vérifier à la main |
| `EXCEPTION_AFTER_WRITE` | Erreur pendant le `save()` : état inconnu | non — vérifier à la main |

Écrit sur la commande : les 5 métas `meta_keys`, **et aucune `bms_*`**. Note privée : « Colis expédié
avec le transporteur {label} - N° de suivi {n} » (ou « Envoi enregistré : {label} (sans n° de
suivi) », ou « Suivi remplacé : … »), + `note`, + « Envoi {shipment_id} » suivi de « — sans mail au
client » ou « — mail d'expédition renvoyé au client ».

**Côté app, à respecter :**
- `carrier_label` = **exactement** les libellés d'aujourd'hui, car `detectCarrier()` et nos stats
  lisent `orders.shipping_carrier` : « Mondial Relay - Point Relais »,
  « La Poste : Colissimo - Domicile sans signature », « La Poste : Colissimo - Domicile avec
  signature », « La Poste : Colissimo - Point de retrait », « Chrono Relais FR - Livraison en
  point relais en France », « Chrono 2 Shop Direct - 2Shop Direct », « Chrono 13 - Livraison
  express à domicile avant 13H », « La poste - Courrier suivi (port payé) », « Store Pickup -
  Entrepot »… (relevé dans `orders.shipping_carrier` le 27/10/2026).
- Lien Mondial Relay : **`ens=LGYOUVAP`** obligatoire (mémoire `mondial-relay-suivi`) — le
  plugin écrit l'URL reçue, il ne la construit pas.
- Retrait entrepôt : `pickup: true`, `carrier_label: "Store Pickup - Entrepot"`, suivi vide.

### `POST order/status` — `{ "orders": [...] }`

Ligne : `{ order_id: int, step: "shipped"|"pickup"|"delivered", notify_customer: true|false, note: "≤1000" }`.
L'app ne nomme plus de statut : `step` désigne `ship_status`, `pickup_status` ou `delivered_status`.
`notify_customer` est **obligatoire**, sans défaut, comme sur `order/ship` :
- `true` : changement normal, tout ce que WooCommerce et les plugins déclenchent s'exécute ;
- `false` : muet (§9).

Règles : voir le modèle du §7. Déjà au statut demandé = `already`, et rien n'est envoyé.

`applied` : `{ order_id, step, status_before, status_after, status_changed, notified, mails_blocked }`.

Codes : `STATUS_NOT_REGISTERED`, `ORDER_NOT_FOUND`, `ORDER_LOCKED`, `EXCEPTION_AFTER_WRITE`, et
`ORDER_NOT_ELIGIBLE` (recul, ou statut interdit).
Note : « {note} Statut de la commande modifié de X à Y. », précédée de « Changement de statut sans
mail au client. » seulement avec `notify_customer: false`.

### `GET status`

`{ version, woocommerce_version, hpos_enabled, hpos_sync_enabled, deferred_emails,
stock_management_enabled, woosb_active, woosb_version, db_version, tables_ready,
batch_max, time_budget, statuses: { slug: { registered, label } } }`

### `GET settings` / `POST settings`

`GET` → `{ settings, defaults, forbidden_statuses, registered_statuses }`.
`POST` (objet partiel) → `{ settings, warnings }` ; 400 `INVALID_SETTINGS` avec
`data.errors` (liste) si une seule valeur est refusée. Un statut non enregistré sur le site
est accepté avec un **warning** (il sera refusé à l'usage tant qu'il ne l'est pas).

## 9. Mails : comment `notify_customer: false` est garanti

Les mails clients du site partent par **Probance**, une API HTTP, et pas par `wp_mail` (thème
`includes/ProbanceIntegration.php`, `WcProbanceEmail`) : 7 314 « expédié », 7 039 « livré » et 177
« prêt en retrait » dans les journaux de la copie. Des fermetures anonymes sur les hooks de statut
appellent `wp_remote_post`.

`includes/silence.php`, le temps du `save()` et de la note, puis tout est rebranché :
1. `WC_Emails::queue_transactional_email` et `send_transactional_email` débranchés de
   `woocommerce_order_status_{to}` et `…_{from}_to_{to}` → aucun mail WC envoyé **ni mis en
   file** (mode différé), y compris ceux des statuts personnalisés déclarés via
   `woocommerce_email_actions` ;
2. `woocommerce_email_enabled_{id}` = false pour tous les mails WC enregistrés → couvre un
   `$email->trigger()` direct et la programmation de la demande d'avis ;
3. `pre_wp_mail` = false → aucun `wp_mail()` de la requête ;
4. `pre_http_request` → fausse réponse 200 pour les hôtes de `youvape_logistique_silent_hosts()`.

⚠️ **Le verrou 4 est lié aux prestataires ACTUELS du site** : `probancemail.com` (mails
transactionnels) et `guaranteed-reviews.com` (invitations à laisser un avis). La liste est écrite
dans le code, pas dans un réglage. Si le site change de prestataire, la mettre à jour : sinon
`notify_customer: false` écrira quand même au client, sans aucune erreur.

Un faux **succès**, pas une erreur : sur un échec, `WcProbanceEmail::handleEmail` réactive le mail
WooCommerce par un `__return_true` qui resterait actif pour les lignes suivantes du lot.
`mails_blocked` compte les tentatives bloquées par les verrous 3 et 4.

**Contrepartie** : Guaranteed Reviews pose `_wcsag_order_sent` sans lire la réponse. Une commande
passée en muet ne recevra donc **jamais** d'invitation à laisser un avis.

**Non couvert** : un plugin qui programme lui-même un envoi asynchrone (cron, Action Scheduler)
sur le changement de statut ; un prestataire absent de la liste ; Guaranteed Reviews en mode
`use_old_orders_method`, où ses commandes partent par un export périodique et non sur le changement
de statut (réglage en base, non lu).

### Ce que déclenche chaque passage (copie de la préprod)

| Passage | Mail Probance, si notifié |
|---|---|
| `processing` ou `on-hold` → `completed` | « Colis expédié » |
| `completed` → `delivered` | « Livrée » |
| → `awaiting-delivery` | « Prêt en retrait » |
| Tout autre passage vers `delivered` | **Aucun**, même avec `notify_customer: true` |

Le hook du thème `woocommerce_order_status_wc-being-delivered_to_delivered` ne part jamais : le
statut y porte à tort le préfixe `wc-`.

**Dépendent du passage par `completed`**, à signaler par le futur écran de mapping : une commande
livrée sans être passée par `completed` (par exemple `being-delivered → delivered` au nettoyage, ou
un retrait boutique) saute le mail « Livrée », l'action VosFactures
(facture émise ou marquée payée, `firmlet_completed`) et la capture Mollie
(`shipAndCaptureOrderAtMollie`).

**Non bloqués par le mode muet, car ce ne sont pas des mails :**
- **Points WPLoyalty** : `updatePoints` sur `woocommerce_order_status_changed` (priorité 1000), code
  identique en PRO 1.4.3, seul le mail de points est bloqué. Le crédit se fait si le statut est dans
  `wlr_earning_status` (réglage en base, à vérifier). ⚠️ **Le nettoyage muet créditera donc des points
  sur les vieilles commandes qui n'en ont pas encore reçu** (`_wlr_points_earned_status` absent) :
  137 `being-delivered` et 10 `awaiting-delivery` au 30/10/2026.
- **Tracker PayPal** (`vikings-paypal-check`), s'il y a un n° de suivi.
- **VosFactures et capture Mollie**, sur `completed`.

## 10. À tester sur la copie de test du site (pas encore disponible)

⚠️ La préprod garde ses connexions réelles (mémoire `preprod-sorties-reelles`) : bloquer les sorties.

**Passage en « Livrée » sans Probance, 13/11/2026** (commande 1264178, Probance BRANCHÉ pour le test : en préprod
`PROBANCE_INTEGRATION_ENABLED = 0`, l'intégration a été instanciée dans le seul processus wp-cli, clé réelle, comme
le fait le thème — sans ça le test ne prouve rien, et les essais des 02/11 et 05/11 ne prouvaient donc rien sur Probance) :
- En cours → Livrée : aucun crochet Probance (le thème n'en a que sur `completed_to_delivered`), aucun appel ;
- Terminée → Livrée : Probance traite `order_delivered` (campagne RT-435828) et appelle `/rest/v2/send` →
  **intercepté** (`mails_blocked: 1`, aucune trace réseau alors que pixel.wp.com et VosFactures en laissent) ;
  Probance écrit « Email sent successfully » : c'est la fausse réponse 200, voulue (§9) ;
- sonde directe sur `https://www.probancemail.com/rest/v2/send/?token=FAUX` : dans le mode muet 200 vide, 0 requête
  réseau ; hors mode muet 401 réel, 1 requête ;
- aucune tâche Action Scheduler créée ; réglage `status_changes_enabled` remis à `false`.
⚠️ Piège de mesure : un mouchard `pre_http_request` à `PHP_INT_MAX` ajouté AVANT l'appel tourne avant le verrou
(même priorité, ordre d'ajout) et dit « pas bloqué » à tort. Juger sur `http_api_debug` (seuls les vrais appels).
Effets qui NE sont PAS bloqués, à savoir pour traiter les vieilles commandes :
- **WPLoyalty crédite les points à « Livrée »** (`wlr_earning_status = delivered`), une fois par commande : une
  commande jamais livrée les reçoit à ce moment, sans mail (le mail de points passe par wp_mail/Probance, bloqués) ;
- **VosFactures ne marque la facture payée qu'à « Terminée »** (`woocommerce_order_status_completed`) : une commande
  En cours envoyée directement en Livrée garde une facture impayée. Passer par `step: shipped` puis `delivered`,
  tous deux `notify_customer: false` (Probance « expédiée » de processing → completed bloqué de la même façon).

**Passé en 0.6.0 sur WooCommerce 11.2.1 le 10/11/2026** (produit simple 1245340, stock 5) : interrupteur du
stock **coupé** (clé absente de l'option = défaut) → `STOCK_CHANGES_DISABLED`, stock inchangé, aucune ligne au
journal ; **allumé** → +1 `applied` (6), rejeu `already` (6), −1 `applied` (5) ; réglages remis tels quels
(les deux interrupteurs coupés). Écran « Action sur WooCommerce » relu par Pierre.

**Passé en 0.5.0 sur WooCommerce 11.2.1 le 05/11/2026** (préprod mise à jour le 03/11, commandes à 0 €
1239791 et 1239553 de pierre.merle.723@, remises « En cours » pour l'essai) :
- interrupteur **coupé** : expédition → métas + note « Statut inchangé », statut `processing` gardé ;
  rejeu `already` ; second envoi `ORDER_ALREADY_SHIPPED` ; `replace` sans changement de statut ;
  `order/status` → `STATUS_CHANGES_DISABLED` ; `replace` sur une commande déjà livrée (cas « BMS est passé
  avant ») accepté, statut inchangé ;
- interrupteur **coché** : `processing → completed`, second envoi refusé, `replace` avec mail renvoyé,
  livraison muette (`mails_blocked` = 1), recul refusé, puis `shipped` et `delivered` avec mail sur la
  commande dont le suivi avait été écrit statuts coupés ;
- interrupteur remis **coupé** (défaut) ; stock (écart, rejeu, simultanéité, refus, pack) et règle
  « Restocker » identiques à la 10.8.1.
En 11.2.1, WooCommerce note lui-même chaque mail envoyé (« E-mail « … » envoyé. »).

**Passé en préprod le 02/11/2026** (0.4.0, WC 10.8.1, commande de test 1264178, appels réels depuis le
VPS par les routes, clés de la préprod) : expédition `processing → completed` avec les 5 métas et la
note ; envoi rejoué → `already` ; second envoi sans `replace` → `ORDER_ALREADY_SHIPPED` ; `replace`
→ suivi écrasé, note « Suivi remplacé », statut inchangé, transition rejouée ; étape `delivered` →
`delivered`, points WPLoyalty crédités (886 + 200, donc `delivered` est bien dans `wlr_earning_status`) ;
recul (`shipped` sur une livrée) → `ORDER_NOT_ELIGIBLE` ; expédier une livrée → `ORDER_ALREADY_SHIPPED`.
Le même jour : **`stock/adjust`** (accu 6011 : +2, rejeu `already`, conflit, −2, deux écarts
simultanés +3/−3 → stock final juste ; refus pack, parent variable, inexistant, écart nul ; composant
d'un pack −10 → le pack relu passe de 1095 à 1094, puis revient) ; **mode muet** sur étape `shipped`,
`replace` et étape `delivered` (statuts, notes « sans mail au client », `mails_blocked` = 0 : les
verrous 1-2 coupent les mails WC avant `wp_mail`) ; **case « Restocker »**, règle exécutée dans les
deux contextes (page avec `$theorder`, Ajax avec `order_id`) : cochée seulement sur une `processing`
sans suivi, décochée sur livrée, `processing` avec suivi BMS, retrait, `completed`, Ajax sans commande.
**Non prouvé** : la réception réelle des mails (Probance muet en préprod depuis le 28/10 ; l'absence de
mail en mode muet se vérifie dans Mailpit), l'affichage de la case dans le navigateur, les écrans HPOS
(site pas en HPOS), un lot de 100 expéditions (le lot de 200 mouvements de stock est passé, plus bas).
Déclinaison au stock géré par le parent : **cas qui n'existe pas chez nous** (Pierre, 10/11 ; en préprod les
6 déclinaisons sans stock propre ont un parent sans stock non plus) — le code le gère quand même. Effet de bord observé : VosFactures a émis une vraie facture au passage « En cours »
et l'a marquée payée au passage « Terminée ».

- [ ] Activation : les 2 tables existent, `GET status` → `tables_ready: true`, versions.
- [ ] Mails différés actifs ou non sur le site (`GET status.deferred_emails`).
- [ ] `stock/adjust` simple (+ et −), rejoué → `already`, même id autre delta → conflit.
- [ ] Déclinaison au stock géré par le parent → `stock_product_id` = parent.
- [ ] Pack woosb refusé ; composant d'un pack ajusté → le stock du pack suit-il à la
      lecture (fiche produit, API) ? Sa visibilité « rupture » ?
- [ ] Deux `stock/adjust` en parallèle + une commande passée en même temps : stock final juste.
- [ ] `order/ship` `notify_customer: false` sur `processing` → `completed` : **aucun mail**
      (client ET admin), aussi avec mails différés activés ; aucune demande d'avis programmée
      (méta `_wc_review_request_scheduled_at` absente) ; files Action Scheduler
      `woocommerce-emails` vides ; **aucun envoi dans le journal `probance`** et `mails_blocked` ≥ 1.
- [ ] Même commande : aucun appel à Guaranteed Reviews, `_wcsag_order_sent` posée.
- [ ] Lot mêlant `notify_customer` false puis true : la ligne suivante part normalement, en un seul mail.
- [ ] Même chose vers `awaiting-delivery` (statut personnalisé : quel plugin le déclare,
      envoie-t-il un mail par son propre chemin ?).
- [ ] `notify_customer: true` → le mail « Colis expédié » part normalement.
- [ ] 2ᵉ envoi sans `replace` sur une commande `completed` → `ORDER_ALREADY_SHIPPED`, rien ne change.
- [ ] `replace: true`, `notify_customer: true` : métas écrasées, statut inchangé, note « Suivi
      remplacé », **un** mail « Colis expédié » Probance avec le nouveau suivi, rien d'autre
      (VosFactures, Mollie, points). Aussi sur une commande partie avant le plugin (suivi `bms_*`).
- [ ] `replace: true`, `notify_customer: false` : aucun mail, note « sans mail au client ».
- [ ] `replace: true` sur une commande `processing` → `ORDER_NOT_SHIPPABLE`.
- [ ] Le thème, une fois adapté, affiche le suivi depuis `_yv_*`, et le mail « Colis expédié »
      contient le n° et le lien.
- [ ] `completed` → `delivered`, `notify_customer: true` : mail « Livrée » Probance, points WPLoyalty.
- [ ] Même passage, `notify_customer: false` : aucun mail, points WPLoyalty crédités, note
      « sans mail au client », demande d'avis (Guaranteed Reviews) non envoyée.
- [ ] `notify_customer` absent sur `order/status` → `INVALID_LINE`, rien ne change.
- [ ] Étape `delivered` sur une commande `processing` : passe (c'est l'app qui décide), sans mail « Livrée ».
- [ ] Étape `delivered` sur une `being-delivered` : passe, sans mail « Livrée » (hook Probance mal nommé).
- [ ] Étape `shipped` sur une `delivered` → `ORDER_NOT_ELIGIBLE` : aucun recul.
- [ ] Réglage d'un statut non déclaré : warning à l'enregistrement, puis `STATUS_NOT_REGISTERED` à l'usage.
- [ ] Réglages : livraison = expédition → refusé, rien d'enregistré. Côté app : un statut « à expédier »
      qui est aussi un statut posé par le plugin → l'écran refuse d'enregistrer.
- [ ] Commande remboursée / annulée → `ORDER_NOT_SHIPPABLE`.
- [ ] Case « Restocker », sur les écrans **classique ET HPOS** : cochée sur une commande `processing`
      sans colis, décochée sur une commande expédiée (colis du plugin), sur une ancienne avec
      `bms_tracking_number`, sur un retrait entrepôt. Vérifier aussi après un remboursement partiel,
      qui recharge le tableau en Ajax.
- [ ] Le tout une fois le site passé en **HPOS** (avec et sans synchro de compatibilité).
- [ ] Lot de 100 commandes (`order/ship`) : durée réelle (ajuster `batch_max` / `time_budget`).
- [x] **Lot de 200 mouvements de stock, 10/11/2026** (préprod, appel HTTP depuis le conteneur backend avec la
      connexion de l'app) : à `batch_max` 100 → 400 `BATCH_TOO_LARGE` ; à 200 → 139 `applied` + 61 `not_processed`
      (`TIME_BUDGET`) en 27,2 s, soit ≈ 7 lignes/s ; rejeu → 61 `applied` + 139 `already`. Le conteneur a été
      recréé (déploiement d'une autre session) pendant le −1 : le plugin avait déjà appliqué 158 lignes sans que
      l'app reçoive la réponse ; le renvoi a donné 158 `already` + 42 `applied`. Stocks des 200 produits identiques
      au départ, journal 200 +1 / 200 −1, réglages remis (stock coupé, `batch_max` 100).
      → 100 lignes ≈ 14 s : tient dans le budget de 20 s, garder 100 par défaut.

## 11. Côté app et prérequis de la bascule

**Fait** : réglages et connexion au site depuis `/settings`, onglet « Paramètres WooCommerce »
(`backend/src/services/logistiqueService.js`, connexion dans `app_config.logistique_connection`),
lecture de `_yv_*` avec repli sur `bms_*` dans yousync et `wcOrderImportService.js`.

**À écrire** : le client des routes d'écriture, sur le modèle de `loyaltyService.js` : 404
`rest_no_route` = plugin absent ou inactif. **Toujours lire `results[]` ligne par ligne**, jamais le
seul HTTP 200 (leçon WPLoyalty : HTTP 200 + `success: false`). Renvoyer les `not_processed` et
`ORDER_LOCKED` ; signaler à un humain les `*_PENDING`, `*_CONFLICT`, `EXCEPTION_AFTER_WRITE`.

**Avant d'activer le plugin :**
- [ ] Connexion de l'app sur la **prod**, avec des clés de la prod : elle a pu rester sur la copie de test.
- [ ] Agence : lire `_yv_*` avec repli sur `bms_*` dans `TrackingHelper` du thème (**sans ça, le mail
      « Colis expédié » part sans n° de suivi**), le thème enfant et `vikings-paypal-check`.
- [ ] Notre suivi des colis en service **avant** de couper `vikings-update-order-status-automatically` :
      sinon plus rien ne passe en Livrée, donc plus de points. Mondial Relay n'a aujourd'hui aucun
      statut de suivi qui fonctionne.
- [ ] Panneau Zendesk (`Zendesk/youvape-dashboard/assets/sidebar.html`) : il ne lit que `bms_*`.
