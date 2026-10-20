# À LIRE AVANT TOUTE MISE À JOUR DE YOUVAPE-LOYALTY

## 1. Pourquoi ce plugin

L'API REST de WPLoyalty PRO (`wc/v3/wployalty/customers/points/add|reduce`) enregistre
tout crédit sous le type d'action `rest_api` et **ignore tout motif** (vérifié le
15/10/2026 : `note`, `comment`, `reason`, `action_type`… sans effet). Le site a traduit ce
type en « Points attribués après votre avis partagé » : un avoir de retour SAV s'affichait
donc comme une récompense d'avis.

Ce plugin appelle la même fonction que l'admin et que l'API WPLoyalty
(`EarnCampaign::addExtraPointAction`), mais sous nos propres types :

| `type` envoyé | Type WPLoyalty | « Action name » dans l'admin |
|---|---|---|
| `avoir` | `youvape_avoir` | Avoir retour SAV |
| `avis` | `youvape_avis` | Avis partagé |

Le motif (`note`) est visible dans l'admin (Customers → client → Transaction Details) et dans
l'historique « Mon compte » du client. `order_id` remplit la colonne ORDER NO.

Si le plugin est désactivé, ces lignes afficheront « - » comme nom d'action (le libellé
vient du filtre `wlr_extra_action_list` déclaré ici).

## 2. `git push` ne met PAS à jour la prod

Comme yousync (voir `yousync/AVANT-DE-MODIFIER.md`), le site est déployé par **Deployer**
depuis le **dépôt du site**, géré par l'agence :

```
/var/www/vhosts/youvape.fr/current -> releases/N
```

> **Un plugin déposé à la main sur la prod est effacé au déploiement suivant.**
> Chaque version passe par l'agence : leur envoyer `youvape-loyalty.zip`.

Générer le zip (depuis la racine de ce dépôt) :

```bash
zip -r youvape-loyalty.zip youvape-loyalty -x '*.DS_Store' -x '*.md'
```

⚠️ **Ce fichier n'entre JAMAIS dans le zip** (`-x '*.md'`) : c'est une note interne (serveur,
chemins, SSH, emplacement des clés). Il est parti dans le 1er zip du 16/10, l'agence l'a
relevé le 20/10 — le zip a été refait sans lui.

## 3. Vérifier la version en ligne

Fichier sur le serveur :

```bash
ssh youvape "ssh youvape@web1.youvape.drakkar.pro \
  'grep -m1 Version: /var/www/vhosts/youvape.fr/current/wp-content/plugins/youvape-loyalty/youvape-loyalty.php'"
```

Ou par l'API (clés WooCommerce de `rewards_config`) — c'est aussi ce que fait le bouton
« Tester la connexion » de l'app Récompense Avis :

```
GET https://www.youvape.fr/wp-json/wc-youvape-loyalty/v1/status?consumer_key=…&consumer_secret=…
→ { "version": "1.0.0", "wployalty": true, "wployalty_version": "1.4.3", … }
```

## 4. Si tu modifies le plugin

- [ ] Incrémenter la version **aux deux endroits** : l'en-tête `Version:` et la constante
      `YOUVAPE_LOYALTY_VERSION` (sinon WordPress ne voit pas la mise à jour).
- [ ] **Garder le préfixe `wc-` du namespace.** WooCommerce n'authentifie ses clés que sur
      les namespaces `wc/…` et `wc-…` (`WC_REST_Authentication::is_wc_namespace`) : sans lui,
      la requête arrive anonyme et part en 401.
- [ ] Une nouvelle version de WPLoyalty peut changer `addExtraPointAction` : relire
      `App/Helpers/Base.php` de la version installée. Le plugin renvoie 503
      `wployalty_missing` si une classe ou méthode attendue disparaît.
- [ ] Tester d'abord en préprod, puis en prod **uniquement** sur `test-wployalty@example.com`.

## 5. Côté app

`backend/src/services/loyaltyService.js` appelle ces routes pour les **Retours** et les
**récompenses d'avis** (depuis le 20/10/2026). Tant que le plugin n'est pas installé ou pas
activé (404 `rest_no_route`), il retombe sur l'API WPLoyalty d'origine.

⚠️ Déployé par fichiers (Deployer), le plugin arrive **inactif** : l'activer dans l'admin.

⚠️ L'API WPLoyalty d'origine répond **HTTP 200 avec `success: false`** quand elle échoue
(client inconnu, solde insuffisant…) : le repli lit `success`, jamais le seul statut HTTP.

## 6. Réponses du plugin

| Statut | Code | Cas |
|---|---|---|
| 200 | — | `{ success, points, requested, balance, action_type, order_id, order_found, version }` |
| 400 | `rest_invalid_param` / `note_empty` | paramètre manquant ou invalide |
| 401 / 403 | `woocommerce_rest_…` / `rest_forbidden` | clés invalides ou sans `manage_woocommerce` |
| 403 | `banned` | client banni du programme |
| 404 | `customer_not_found` | `reduce` sur un e-mail inconnu de WPLoyalty |
| 409 | `no_points` | `reduce` sur un solde à 0 |
| 500 | `wployalty_failed` / `youvape_loyalty_exception` | WPLoyalty a refusé, ou exception |
| 503 | `wployalty_missing` | WPLoyalty absent ou incompatible |

`reduce` ne descend jamais sous 0 : il retire au plus le solde, `points` dit ce qui a
réellement été retiré (`requested` ce qui était demandé).
`add` sur un e-mail inconnu crée le client fidélité, comme l'API WPLoyalty.
