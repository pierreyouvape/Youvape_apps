# ⚠️ À LIRE AVANT TOUTE MISE À JOUR DE YOUSYNC

> ⚠️ **NOTE INTERNE — ne sort JAMAIS du dépôt.** Le zip pour l'agence se fait avec
> `-x '*.md'` (voir §9). Le document destiné à l'agence est `readme.txt`.

## 1. `git push` ne met PAS à jour la prod

Le plugin tourne sur un hébergement Plesk séparé, `web1.youvape.drakkar.pro`, déployé
par **Deployer** (`/var/www/vhosts/youvape.fr/current -> releases/N`) à partir du **repo
du site**, géré par l'agence. Toute modification déposée à la main est effacée au
déploiement suivant (arrivé le 05/08/2026). `uploads/` est partagé entre les releases.

Vérifier la version en ligne :

```bash
ssh youvape "ssh youvape@web1.youvape.drakkar.pro \
  'grep -m1 Version: /var/www/vhosts/youvape.fr/current/wp-content/plugins/yousync/yousync.php'"
```

Mesuré le 30/10/2026 : prod en **1.4.2**, WP 7.1.3, WC **11.2.1**, PHP 8.4, MariaDB 10.11,
préfixe de tables `hJvjTIOu`, HPOS en compatibilité (`enabled=no`, `data_sync=yes`),
Cloudflare devant le site. wp-cli : `/opt/plesk/php/8.4/bin/php /usr/local/bin/wp`.

## 2. Ce que fait la 2.0.0

**Polling seul.** Le site n'envoie plus rien : le serveur vient chercher. yousync n'écrit
JAMAIS sur le site (ni stock, ni statut, ni méta) : seulement dans sa propre table.

```
Hook WooCommerce → INSERT dans {prefix}yousync_events
Backend (60 s)   → GET yousync/v2/queue → traite → POST yousync/v2/queue/ack
Backend (15 min) → GET yousync/v2/orders/index → compare à sa base → réimporte
```

| Fichier | Rôle |
|---|---|
| `yousync.php` | Amorçage, version (en-tête ET `YOUSYNC_VERSION`) |
| `includes/class-install.php` | Table, reprise de `queue.json`, journal d'erreur |
| `includes/class-queue.php` | La file : INSERT, lecture, ack, échecs, purge |
| `includes/class-auth.php` | Jeton, HTTPS, renouvellement |
| `includes/class-rest.php` | Les routes |
| `includes/class-hooks-manager.php` | Les hooks : un INSERT, rien d'autre |
| `includes/class-data-fetcher.php` | Le contenu, lu à la livraison |
| `includes/class-admin.php` | Écran : état, pause, échecs à rejouer |

Côté backend : `wcSyncService` (polling), `yousyncClient` (appels au site),
`yousyncTokenService` (renouvellement), `orderReconcileService` (rattrapage),
`utils/yousyncPayload` (contrôle de forme).

## 3. Les règles qui garantissent zéro perte

Ne pas en toucher une sans avoir compris pourquoi elle existe.

- **INSERT seul.** La 1.x lisait puis réécrivait `queue.json` : deux écritures croisées, un
  événement perdu sans trace (commande 1267765, 09/10/2026).
- **Contenu construit à la lecture.** C'est l'état courant, donc rejouable sans risque.
- **Pas de curseur.** On lit `state = pending`. Un identifiant attribué mais pas encore
  validé par MySQL serait sauté par un « id > dernier lu ».
- **Ack par identifiants lus**, et seulement ceux déjà livrés (`attempts > 0`). Une
  modification arrivée après la lecture est une nouvelle ligne : elle repart.
- **Aucune expiration.** Une ligne ne sort que par ack. La purge ne touche que `acked`.
- **Ligne en échec** : après `MAX_ATTEMPTS` (10) lectures sans ack, elle passe en `failed`,
  reste en table, ne consomme plus le lot, déclenche une alerte, et se rejoue depuis l'admin.
  Une nouvelle livraison réussie du même objet solde ses anciens échecs.
- **PHP qui tombe sur un objet** : la ligne est marquée `READING` avant construction.
  Encore marquée au passage suivant, elle seule prend `CRASH_PENALTY`. Sans ça, tout le lot
  de cet objet, dont la réponse est perdue, finirait en échec avec lui.
- **Objet disparu** : marqueur `gone`, jamais sauté. Le backend ne propage AUCUNE suppression
  de commande ni de client (notre base est une archive). Un remboursement disparu est retiré.
  Un produit n'est déclaré disparu que si son post n'existe plus : `wc_get_product` rend
  aussi `false` quand la classe du type manque, et neutraliserait son stock chez nous.
- **Hooks toujours branchés.** La pause suspend la LIVRAISON, jamais l'enregistrement. Plus
  de cases par type ni de « Clear Queue » : c'étaient des façons de perdre des événements.
- **`woocommerce_after_order_object_save`** : `woocommerce_update_order` part AVANT
  `save_items()` (vérifié dans WC 11.2.1). Seul ce hook voit les lignes à jour.
- **`woocommerce_delete_order_refund`** : `woocommerce_refund_deleted` ne part que de l'admin.

## 4. Rattrapage (`orderReconcileService`)

Toutes les 15 min sur 3 h, et à 4h40 sur 5 jours. Ne dépend PAS de BMS. Compare présence,
statut ET date (la 1272634 a changé de statut sans changer de date). Ignore ce qui a bougé
depuis moins de 10 min et ce qui a un événement en attente (`pending`). Toute trouvaille est
réimportée par `wcOrderImportService` et signalée : c'est un trou de yousync.

Si la route du plugin ne répond pas, repli sur `wc/v3/orders`, **bridé** car il charge chaque
commande côté site : 30 min au plus entre deux passes, 100 commandes par page, 25 pages, 1,5 s
entre les pages. C'est aussi ce qui fait tourner le rattrapage tant que le plugin est en 1.4.

Limite : il couvre les commandes et leurs remboursements. Les produits sont repris par le cron
de 3h (`productDbSyncService`). Un client perdu n'est pas rattrapé. Un remboursement supprimé
n'est pas retiré par le rattrapage (reprise en ajout seulement, exprès).

## 5. Jeton

- Dédié à yousync, 32 octets aléatoires. Le site n'en garde que le **SHA-256** (`yousync_auth`).
  Empreinte rapide voulue : rien à deviner, contrairement à un mot de passe.
- Reprise à la mise à jour depuis `yousync_settings.api_token`, sans action de l'agence. La
  valeur en clair **reste** jusqu'au premier renouvellement : c'est elle qui permet le retour
  en 1.4. Le premier renouvellement l'efface.
- Côté app : `app_config.wc_sync_wp_token`, jamais renvoyé au front. `YOUSYNC_TOKEN` du `.env`
  ne sert plus (il était lu par `webhookController`, supprimé).
- Uniquement dans l'en-tête `X-YouSync-Token`. Le backend refuse d'envoyer si l'adresse n'est
  pas en https (le refus du plugin arriverait après coup), et ne suit aucune redirection
  (axios garde les en-têtes personnalisés).
- Réponses : 401 jeton faux, 503 jeton absent (`yousync_token_missing`), 403 hors HTTPS,
  404 route absente.

**Renouvellement** (`/settings`, onglet WooCommerce, admin) : voir l'en-tête de
`yousyncTokenService.js`. Le site garde l'ancien 15 min. Un 401 avec un jeton en attente fait
adopter ce dernier par le polling : aucune étape interrompue ne coupe la synchro.
La route est en `wc-yousync/v1` : **garder le préfixe `wc-`**, WooCommerce n'authentifie
ses clés que sur `wc/…` et `wc-…`.

**Ce qu'un attaquant muni du jeton pourrait faire :**
- Lire ce qui est **en attente** dans la file (commandes modifiées, avec adresses et emails),
  et l'index des commandes (identifiant, statut, date). Pas plus : aucune route ne lit un objet
  choisi par l'appelant.
- Acquitter des lignes déjà livrées, donc en priver le backend. Le rattrapage retrouve les
  commandes par l'index ou, si la route est compromise, par l'API WooCommerce, avec une autre clé.

**Ce qui l'en empêche d'aller plus loin :** il ne peut rien écrire sur le site, ne peut pas
renouveler le jeton (clé WooCommerce obligatoire), ne peut pas acquitter une ligne jamais
livrée, et il n'y a plus aucune route d'ingestion chez nous : même avec le jeton, il ne peut
rien injecter dans notre base. Une fuite se traite par « Renouveler le jeton ».

**Avec la clé WooCommerce**, en revanche, il a le site : elle est bien plus sensible que ce jeton.

## 6. Contrat des routes

Toutes les réponses : `Cache-Control: no-store, private`. Routes masquées de l'index REST.

| Route | Accès |
|---|---|
| `GET yousync/v2/queue` | Jeton |
| `POST yousync/v2/queue/ack` | Jeton |
| `GET yousync/v2/orders/index?since=&page=&per_page=` | Jeton |
| `GET yousync/v2/health` | Jeton |
| `POST wc-yousync/v1/token` | Clé WC + `manage_woocommerce` |

`GET queue` :
```
{ success, version, paused, events: [{ ids, type, action, wp_id, parent_id, gone, data, created_at }],
  stats: { pending, failed, oldest_pending_at, failed_sample: [{ type, wp_id, code }] } }
```
`POST queue/ack` : `{ acked: [ids], failed: [{ ids, code }] }`, 2000 identifiants au plus.
`code` = `[A-Z0-9_]{1,40}`, sinon `UNKNOWN` : jamais un message, il pourrait porter une donnée
client. Codes : `INVALID_PAYLOAD`, `DB_<sqlstate>`, `PROCESSING_ERROR` (backend) ;
`READ_ERROR`, `JSON_ERROR`, `READ_CRASH`, `TOO_MANY_ATTEMPTS` (plugin).

`GET orders/index` : `{ success, paused, orders: [{ id, status, date_modified, pending }], page,
pages, total }`, 200 par page, 14 jours au plus. Lecture par `wc_get_orders`. Dates en heure
du site, comme `orders.post_modified`.

⚠️ **Les statuts personnalisés (`delivered`, `awaiting-delivery`…) sont déclarés par le thème.**
`wp eval --skip-themes` ne les liste pas. En REST le thème est chargé : à confirmer en préprod.

## 7. Moindre donnée

La table ne contient que identifiants, type, action, dates, état. Retirés du flux le 30/10/2026,
car lus nulle part chez nous : `billing_company`, `customer_note`, `user_agent`,
`mollie_customer_id`, `mollie_payment_instructions` ; pour un client, tout sauf nom, email et
dates ; pour un produit, `description`, `short_description`, `permalink`. Les colonnes
existantes (`attribution_user_agent`…) gardent leur historique et ne sont plus alimentées.

Le contenu reçu est traité comme non fiable : `utils/yousyncPayload.js` refuse la ligne entière
et cite le champ, jamais sa valeur.

## 8. Transporteur et marques

- **Transporteur** : `_yv_carrier_label` + `_yv_tracking_number`, repli sur `bms_carrier` +
  `bms_tracking_number` **par paire**, dans `Data_Fetcher::get_shipment` ET
  `wcOrderImportService.shipmentOf`. Noms = réglage `meta_keys` de youvape-logistique, valeurs
  par défaut : s'il change, changer les deux.
- **Marques** : conserver le correctif parent/enfant de `get_product()`. Revenir à `$brands[0]`
  viderait les sous-marques (voir CLAUDE.md, 14/08/2026). `brandMapService.js` reste : il couvre
  aussi les sous-marques retirées dans WordPress et les produits modifiés sans événement.

## 9. Mettre à jour le plugin

- [ ] Version aux deux endroits (en-tête + `YOUSYNC_VERSION`), `Stable tag` + changelog de `readme.txt`.
- [ ] Changement de table → incrémenter `Install::DB_VERSION`.
- [ ] Déployé par fichiers sur un plugin **déjà actif** : le hook d'activation ne tourne PAS.
      Tout passe par `Install::maybe_upgrade`, sous `GET_LOCK`.
- [ ] Syntaxe PHP 7.4. `backend/tests/yousync-plugin/run.sh [version]` : banc de la file dans un
      conteneur PHP jetable sur le VPS (⚠️ disque à 96 % : `docker rmi` après).
- [ ] Livrer :
      ```bash
      zip -r yousync.zip yousync -x '*.DS_Store' -x '*.md'
      unzip -l yousync.zip   # puis relire CHAQUE fichier listé
      ```
      Contenu attendu : `yousync.php`, `readme.txt`, `includes/*.php`, `admin/css/admin.css`.
      **L'envoi à l'agence passe par Pierre.** Aucune info interne : ni serveur, ni chemin, ni
      outil de déploiement, ni emplacement ou fonctionnement du jeton, ni exemple d'appel.

## 10. Déployer la 2.0.0 (ordre)

1. **Backend d'abord.** Il parle v2 et v1 : `rest_no_route` en v2 = il reste en v1, et le
   rattrapage tourne par l'API WooCommerce. Rien ne change pour le site.
2. **Plugin ensuite**, par l'agence. Au premier chargement : table créée, jeton repris, cron
   `yousync_process_queue` déprogrammé, `queue.json` repris sous verrou, `uploads/yousync/`
   supprimé. Le backend passe seul en v2 (au plus 5 min).
3. **Contrôles** : version en ligne ; `/settings` affiche « Protocole v2 » ;
   `uploads/yousync/` absent ; la file se vide ; aucune alerte `READ_*`.
4. **Plus tard**, quand tout est stable : « Renouveler le jeton », puis retirer `YOUSYNC_TOKEN`
   du `.env` et des `.env.bak*` du VPS.

**Retour arrière** : redéployer la 1.4.2 (tant que le jeton n'a pas été renouvelé, le clair est
encore là). Le backend revient seul en v1. Les lignes en attente restent en table ; le
rattrapage reprend les commandes modifiées pendant ce temps.

**Préprod** : le polling de PROD ne doit JAMAIS la viser, sinon des commandes de test entrent
dans notre base. Aucune écriture vers elle depuis l'app : `wc_sync_wp_url` n'est plus modifiable.

## 11. Tests préprod (non faits : préprod non touchée à la demande de Pierre)

Le banc couvre la file et le jeton, pas WooCommerce. Préprod en WC 10.8.1, prod en 11.2.1 :
les hooks ont été vérifiés dans le source 11.2.1, pas exécutés.

Lire sans importer (ne jamais brancher le polling de prod) :
`curl -H "X-YouSync-Token: <jeton de préprod>" <site>/wp-json/yousync/v2/queue`

- [ ] Mise à jour par fichiers sur le plugin actif : table créée une fois, `queue.json` repris
      puis supprimé, jeton repris (route répond), cron `yousync_process_queue` absent.
- [ ] Commande passée : lignes `create`/`update` en table, contenu complet à la lecture, lignes
      de commande et taxes présentes.
- [ ] `/orders/index` : `delivered`, `awaiting-delivery`, `completed` présents ; brouillons absents.
- [ ] Remboursement partiel admin : événement, `order_tax` présent ; suppression : marqueur `gone`.
- [ ] Produit variable modifié, stock changé, produit supprimé définitivement : `gone`.
- [ ] Compte client supprimé avec un événement en attente : `gone`, le lot n'est pas bloqué.
- [ ] **Serveur coupé 48 h** (aucune lecture) : commandes passées, rien ne sort de la table ;
      à la reprise, tout part, dans l'ordre, sans expiration.
- [ ] **Commandes et acks simultanés** : 20 commandes en parallèle pendant des lectures/acks en
      boucle : autant d'objets livrés que créés, aucune ligne `pending` orpheline.
- [ ] **Jeton faux → 401, sans jeton → 401, HTTP → refus, option `yousync_auth` vidée → 503.**
- [ ] `is_ssl()` réellement vrai sur une requête REST, derrière le proxy.
- [ ] **Rattrapage** : supprimer à la main la ligne d'événement d'une commande, attendre : la
      comparaison la retrouve et alerte.
- [ ] Pause : événements enregistrés, rien de livré, reprise sans perte ; `Rejouer` fonctionne.
- [ ] Renouvellement : deux jetons acceptés 15 min, puis seul le nouveau ; clair effacé.
- [ ] Le tout avec le site passé en **HPOS**, source de lecture changée.
- [ ] Bloqueur Cloudflare : confirmer que `yousync/v2/*` et `wc-yousync/v1/*` passent comme la v1.
