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
- **Surface d'affichage limitée à « Mon compte »** : le plugin n'accroche aucun
  hook des emails transactionnels WooCommerce (`woocommerce_email_*`) ni des
  pages de commande. Le CSS n'est chargé que sur `is_account_page()`.
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

### 3. Consignes de rétractation

**Réglages → Espace client SAV** contient aussi l'éditeur des **consignes de
rétractation**, affichées au client qui choisit le motif « Je souhaite me
rétracter ». Un texte par défaut est proposé ; **il doit être relu et validé au
regard des CGV de la boutique** avant mise en production.

## Formulaire de demande — motifs

Le client ne saisit pas de sujet : il choisit un **motif**, qui pilote les champs
affichés et exigés. Le sujet du ticket est déduit du motif **côté API** (le slug
est le contrat entre le plugin et `CLIENT_TICKET_REASONS` dans
`backend/src/controllers/clientSavController.js`).

| Slug | Motif (formulaire) | Commande | Produits | Champ texte |
|---|---|---|---|---|
| `question` | Une question avant de passer ma commande | — | — | Nous vous écoutons *(obligatoire)* |
| `produit` | Une difficulté avec une commande | obligatoire | obligatoire, multiple | Décrivez-nous votre problème *(obligatoire)* |
| `retractation` | Une demande de rétractation | obligatoire | obligatoire, multiple | Commentaire *(facultatif)* |

Le commentaire est **facultatif pour la rétractation** : le client n'a pas à
motiver sa décision (art. L221-18). La commande et les produits suffisent alors à
constituer la demande.

Le **libellé du motif** (colonne ci-dessus) est ce que voit le client dans le
formulaire ; le **sujet du ticket**, lui, sert d'**objet aux emails** envoyés au
client et est donc rédigé différemment. Il est défini côté API uniquement :

| Slug | Sujet du ticket / objet des emails | `request_reason` stocké |
|---|---|---|
| `question` | Votre question au service client YouVape | `question_avant_commande` |
| `produit` | Votre demande d'assistance YouVape | `difficulté_avec_une_commande` |
| `retractation` | Votre demande de rétractation YouVape | `demande_de_rétractation` |

`request_reason` alimente la colonne du même nom dans `sav_tickets`, déjà
affichée dans le détail du ticket côté app agent (le slug y est humanisé).

Les règles de chaque motif sont vérifiées **trois fois** : par le formulaire (JS),
par le plugin à la réception du POST, puis par l'API. Un POST forgé ne peut donc
pas créer une demande incomplète, ni rattacher la commande d'un autre client.

Pour le motif `retractation`, les commandes livrées depuis plus de 14 jours sont
signalées comme probablement hors délai — **information seulement, jamais un
blocage**. L'app n'historisant pas les changements de statut, la date de
livraison est approchée par `post_modified` des commandes en `wc-delivered`.

## Installation

1. Copier le dossier `youvape-sav-client/` dans `wp-content/plugins/`.
2. Renseigner les constantes dans `wp-config.php` (ci-dessus).
3. Activer le plugin (l'activation rafraîchit les permaliens pour l'URL
   `/mon-compte/mes-demandes/`).

> Si l'onglet renvoie une 404, aller dans **Réglages → Permaliens** et cliquer
> « Enregistrer » pour forcer le flush des rewrite rules.

## Surcharge des templates (thème)

Chaque template peut être surchargé depuis le thème actif :

```
<theme>/woocommerce/youvape-sav/list.php
<theme>/woocommerce/youvape-sav/detail.php
<theme>/woocommerce/youvape-sav/new-ticket.php
```

## Shortcodes

```
[youvape_sav_form]                                          formulaire de demande
[youvape_sav_bouton page="/nous-contacter/" texte="Nous contacter"]   bouton
```

Un menu WordPress pointe vers une **URL**, pas vers un shortcode. Le montage
attendu est donc : une page « Nous contacter » contenant `[youvape_sav_form]`,
vers laquelle pointe l'entrée de menu.

Le formulaire s'adapte à l'état de connexion :

| Visiteur | Ce qu'il voit | Où va la réponse |
|---|---|---|
| **Connecté** | formulaire complet : 3 motifs, ses commandes, ses produits | email **et** espace « Mes demandes » |
| **Non connecté** | nom, email, message, pièces jointes — motif figé sur « question avant commande » | email uniquement |

Le visiteur non connecté n'a ni commande ni produit à sélectionner : sans
identité vérifiée, il n'y a rien à autoriser. La demande est en **écriture
seule**, aucun fil n'est consultable.

## Rattachement d'une demande à un compte créé plus tard

Une demande déposée sans compte est enregistrée sans `customer_id`. Le jour où
la personne crée un compte avec la **même adresse email**, la demande apparaît
dans son espace « Mes demandes » : le rattachement se fait à la lecture, sans
traitement différé ni migration. Le même mécanisme fait remonter les demandes
Gravity Forms.

⚠️ L'email n'étant pas vérifié, une demande déposée avec l'adresse d'un client
apparaîtra dans l'espace de ce client. Aucune donnée n'est exposée à l'auteur de
la demande — la réponse part à l'adresse saisie, donc au titulaire réel. C'est le
comportement de Gravity Forms, conservé volontairement.

## Changelog

- **0.3.4** — La commande concernée se choisit dans un **menu déroulant** simple
  (n° de commande, date, montant) au lieu de cartes détaillées à cocher. Les
  produits restent en cases à cocher, le choix multiple étant nécessaire.
  L'avertissement de délai de rétractation s'affiche sous la liste, et
  uniquement si la commande choisie est effectivement hors délai.
- **0.3.3** — Les shortcodes sont rappelés dans **Réglages → Espace client SAV**,
  dans des champs en lecture seule avec bouton « Copier » : copier depuis un
  champ de saisie ne rapporte que du texte brut, ce qui évite de coller un
  shortcode enfermé dans un bloc de code.
- **0.3.2** — Le module ne dépend plus de la typographie de son conteneur : un
  ancêtre en chasse fixe (`<pre>`, bloc HTML d'un constructeur de page) ne peut
  plus imposer sa police ni empêcher les retours à la ligne (texte légal qui
  débordait). Champs, `<select>` et bouton d'envoi ont désormais un style
  autonome, surchargeable via `.youvape-sav`.
- **0.3.1** — Correctif d'affichage dans les constructeurs de page : la sortie
  des shortcodes ne contient plus de saut de ligne, ce qui empêche `wpautop`
  d'y injecter des paragraphes vides (grands trous verticaux) et des `<br>`
  parasites. Le JS du formulaire passe dans un fichier externe, et la détection
  des shortcodes couvre aussi les métadonnées (ACF / page builders) pour que
  les assets partent dans le `<head>`.
- **0.3.0** — Formulaire public pour les visiteurs non connectés via les
  shortcodes `[youvape_sav_form]` et `[youvape_sav_bouton]`, avec pièces jointes
  et pot-de-miel. Le formulaire complet est désormais affichable hors de « Mon
  compte ». Les demandes publiques et Gravity Forms deviennent visibles dans
  « Mes demandes », y compris rétroactivement par email.
- **0.2.2** — Suppression des boutons « Ouvrir une demande » sur la liste et le
  détail des commandes (`/mon-compte/orders`, `/mon-compte/view-order/…`). Le
  plugin ne s'accroche plus qu'à l'espace « Mon compte » : plus aucun hook sur
  les pages de commande.
- **0.2.1** — Libellés : « Votre demande concerne : » (sans astérisque, le champ
  bloque déjà la suite), « Une difficulté avec une commande », « Une demande de
  rétractation ». Le commentaire de rétractation devient **facultatif**.
  Encadré des consignes légales en gris.
- **0.2.0** — Le sujet libre est remplacé par un **motif** (menu déroulant à 3
  choix) qui pilote le formulaire : commande et produits masqués pour une simple
  question, obligatoires pour une difficulté produit ou une rétractation ;
  sélection **multiple** des produits (cases à cocher au lieu du dropdown) ;
  consignes légales de rétractation éditables en réglages ; avertissement
  « délai de 14 jours probablement dépassé » sur les commandes livrées.
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
│   ├── class-account-endpoint.php  # onglet Mon Compte + endpoint + motifs + rendu
│   ├── class-shortcodes.php        # [youvape_sav_form] / [youvape_sav_bouton]
│   └── class-settings.php          # Réglages (API, secret, consignes rétractation)
├── templates/
│   ├── list.php                    # liste des demandes (surchargeable)
│   ├── detail.php                  # fil de discussion + réponse (surchargeable)
│   ├── new-ticket.php              # formulaire piloté par le motif (surchargeable)
│   ├── public-form.php             # formulaire visiteur non connecté (surchargeable)
│   └── public-sent.php             # confirmation d'envoi public (surchargeable)
├── assets/css/youvape-sav.css
└── README.md
```
