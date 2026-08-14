# ⚠️ À LIRE AVANT TOUTE MISE À JOUR DE YOUSYNC

## 1. `git push` ne met PAS à jour la prod

Le plugin tourne sur un hébergement Plesk séparé, `web1.youvape.drakkar.pro`,
déployé par **Deployer** :

```
/var/www/vhosts/youvape.fr/current -> releases/N
```

Chaque déploiement du site crée une nouvelle release à partir du **repo du
site** (géré côté agence/Drakkar), pas depuis ce repo-ci. Conséquence :

> **Toute modification déposée à la main sur la prod (scp, édition directe)
> est effacée au déploiement suivant.**

Vérifier la version réellement en ligne :

```bash
ssh youvape "ssh youvape@web1.youvape.drakkar.pro \
  'grep -m1 Version: /var/www/vhosts/youvape.fr/current/wp-content/plugins/yousync/yousync.php'"
```

## 2. Ce repo est en avance sur la prod

| | version | correctif marques parent/enfant |
|---|---|---|
| Ce repo (`yousync/`) | **1.4.1** | ✅ présent |
| Prod (release courante) | **1.4.0** | ❌ absent *(constaté le 14/08/2026)* |

L'écart porte sur `includes/class-data-fetcher.php`, méthode `get_product()`.
Le code 1.4.0 déduit la marque avec `$brands[0]` : quand un produit porte à la
fois le terme `pwb-brand` **parent** (« Eliquid France ») et son **enfant**
(« Fruizee Max »), le parent sort en premier et le plugin envoie `sub_brand`
**vide**, ce qui écrase la sous-marque en base à chaque édition du produit.

La 1.4.1 parcourt tous les termes et retient celui qui a un parent — résultat
indépendant de l'ordre.

Historique : le correctif a été posé sur la prod le 03/08/2026 puis effacé par
les releases 185 (05/08) et 186 (06/08). C'est bien le scénario du point 1.

## 3. Si tu mets à jour le module

- [ ] **Conserver le correctif parent/enfant** dans `get_product()`. Une
      nouvelle version repartie de la 1.4.0 réintroduirait le bug.
- [ ] Faire passer la nouvelle version par le **repo du site** (agence), sinon
      elle ne survivra pas au déploiement suivant.
- [ ] Re-vérifier la version en ligne après le déploiement du site
      (commande du point 1).

## 4. En attendant, le bug est neutralisé côté backend

`backend/src/services/brandMapService.js` (commit `2c5b07b`, 14/08/2026)
reconstruit produit → marque/sous-marque depuis la taxonomie `pwb-brand` via
l'API REST WordPress, répare la table `products` (cron horaire) et restaure la
sous-marque avant chaque upsert produit.

**Ne pas le supprimer en même temps qu'une mise à jour du plugin.** Il reste
sans effet si la prod repasse un jour en 1.4.1 : il recalcule alors la même
valeur que le plugin. Il couvre aussi ce que le plugin ne couvre pas — les
sous-marques retirées dans WordPress, et les produits modifiés sans webhook.
