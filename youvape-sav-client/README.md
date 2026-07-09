# Youvape — Espace client SAV (`youvape-sav-client`)

Plugin WordPress qui ajoute un onglet **« Mes demandes »** dans le compte WooCommerce,
permettant au client connecté de consulter ses tickets SAV.

Les tickets vivent dans l'application Node Youvape (PostgreSQL). **Ce plugin n'écrit
rien dans la base WordPress** : il appelle l'API Node `/api/client-sav` en
**server-to-server**.

## Architecture

```
Navigateur client → WordPress (ce plugin, PHP côté serveur) → API Node /api/client-sav → PostgreSQL
```

- L'identité du client est toujours `get_current_user_id()` (session WordPress),
  jamais une valeur fournie par le navigateur.
- L'appel à l'API est authentifié par un **secret partagé** envoyé en en-tête
  (`x-client-sav-secret`), qui ne quitte jamais le serveur.

## Configuration

Deux façons, par ordre de priorité :

### 1. Via l'interface (recommandé, aucun fichier à toucher)

Après activation, aller dans **Réglages → Espace client SAV** et renseigner :
- **URL de l'API** : ex. `https://api.youvape.fr`
- **Secret partagé** : à générer dans l'application de tickets, onglet
  **SAV → Paramètres → DANGER** (bouton « Générer un secret »), puis le coller ici.

Le secret est le même des deux côtés : généré/stocké dans l'app (table `app_config`),
collé dans le plugin (option WordPress). Pas besoin d'éditer `wp-config.php` ni le `.env`.

### 2. Via wp-config.php (optionnel, prioritaire si défini)

```php
define('YOUVAPE_SAV_API_URL', 'https://api.youvape.fr');
define('YOUVAPE_SAV_API_SECRET', 'le-meme-secret-que-le-backend');
```

Si ces constantes existent, elles priment sur les réglages de l'interface (les
champs correspondants sont alors verrouillés dans la page de réglages).

## Installation

1. Copier le dossier `youvape-sav-client/` dans `wp-content/plugins/`.
2. Renseigner les constantes dans `wp-config.php` (ci-dessus).
3. Activer le plugin (l'activation rafraîchit les permaliens pour l'URL
   `/mon-compte/mes-demandes/`).

> Si l'onglet renvoie une 404, aller dans **Réglages → Permaliens** et cliquer
> « Enregistrer » pour forcer le flush des rewrite rules.

## Surcharge des templates (thème)

Le template de la liste peut être surchargé depuis le thème actif :

```
<theme>/woocommerce/youvape-sav/list.php
```

## Changelog

- **0.1.5** — Fix « Commande invalide » à la création quand « Aucune commande »
  est sélectionné (`order_id` vide n'est plus transmis comme `0`).
- **0.1.4** — Heures des messages affichées dans le fuseau du site (les dates API
  sont en UTC) ; affichage des pièces jointes dans le fil du ticket côté client.
- **0.1.3** — Radio de sélection agrandi et coloré, aligné à gauche sur la même
  ligne que le titre de la commande (mise en page en grille).
- **0.1.2** — Zone de sélection des commandes scrollable (hauteur fixe) pour
  gérer les clients ayant beaucoup de commandes.
- **0.1.1** — Sélecteur de commande en cartes (vignettes produits, total, date) ;
  dropdown « produit concerné » filtré sur la commande sélectionnée (JS).
- **0.1.0** — Version initiale : liste, détail, création, réponse, réglages.

## État

- **Lot 1** (actuel) : onglet + liste des demandes en lecture seule.
- Lots suivants : détail/fil de discussion, création de demande (+ depuis une
  commande), réponse du client.

## Arborescence

```
youvape-sav-client/
├── youvape-sav-client.php          # bootstrap, constantes, (dés)activation
├── includes/
│   ├── class-api-client.php        # appels server-to-server vers l'API Node
│   └── class-account-endpoint.php  # onglet Mon Compte + endpoint + rendu
├── templates/
│   └── list.php                    # liste des demandes (surchargeable)
├── assets/css/youvape-sav.css
└── README.md
```
