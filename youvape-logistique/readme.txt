=== Youvape — Logistique ===
Contributors: youvape
Requires at least: 6.0
Requires PHP: 7.4
Requires Plugins: woocommerce
WC requires at least: 10.0
Stable tag: 0.6.0
License: Propriétaire — usage réservé à youvape.fr

Mises à jour de stock, expédition et statuts des commandes, envoyées par l'app interne Youvape.

== Description ==

Ce plugin ajoute des routes REST à WooCommerce, utilisées par l'app interne de Youvape
pour :

* ajuster le stock des produits par écarts (+N / −N), sans jamais écraser une vente
  passée au même moment ;
* marquer des commandes comme expédiées (statut, transporteur, numéro et lien de suivi,
  note de commande), avec ou sans mail au client ;
* changer le statut de commandes, avec ou sans mail au client, y compris le passage en
  « Livrée ».

Deux interrupteurs, réglés depuis l'app et coupés par défaut, décident de ce que le plugin a le
droit de faire : changer le statut des commandes, et modifier le stock. Coupés, il écrit seulement
le suivi sur la commande (métas et note), sans changer son statut, sans envoyer de mail et sans
toucher au stock : il peut être activé pendant qu'un autre outil gère encore statuts et stock.

Les routes ne sont accessibles qu'aux administrateurs de la boutique. Le plugin n'ajoute
rien sur le site public : ni page, ni gabarit, ni script, ni feuille de style, ni tâche
planifiée.

= Données écrites sur les commandes =

À chaque expédition, sur la commande concernée, le plugin écrit uniquement ces métas :

* `_yv_carrier` : code du transporteur ;
* `_yv_carrier_label` : libellé du transporteur ;
* `_yv_tracking_number` : numéro de suivi ;
* `_yv_tracking_url` : lien de suivi complet, simple adresse (pas de HTML) ;
* `_yv_shipped_at` : date d'expédition.

Une commande n'a qu'un colis. Quand une étiquette est refaite, ces métas sont remplacées, une note
de commande garde l'ancien suivi, et le mail d'expédition peut être renvoyé au client.
Le plugin n'écrit aucune méta `bms_*`.

= À prévoir de votre côté avant l'activation =

* Le thème, le thème enfant et `vikings-paypal-check` doivent lire `_yv_*`, avec repli sur `bms_*`
  pour les commandes déjà expédiées. Dans le thème, `TrackingHelper` alimente le suivi client et
  les mails Probance : sans cette adaptation, le mail « Colis expédié » partirait sans numéro
  de suivi.
* `vikings-update-order-status-automatically` est à couper le jour de la bascule : le passage en
  « Livrée » sera fait par l'app.

= Envois sans mail =

Quand un changement est demandé sans mail, le plugin bloque, le temps de ce changement, les mails
WooCommerce et les appels aux prestataires actuels du site : Probance et Guaranteed Reviews.
Si l'un de ces prestataires change, prévenez-nous : le plugin devra être mis à jour.

= Écran de remboursement =

Dans l'admin, sur l'écran de remboursement d'une commande, la case « Restocker les articles
remboursés » est cochée si la commande n'est pas encore expédiée, et décochée sinon. Elle reste
modifiable à la main.

= Ce que le plugin ne touche pas =

* Aucune donnée existante n'est modifiée à l'activation.
* Aucune commande ni aucun stock ne change tant que l'app ne l'a pas demandé.
* Les packs (WPC Product Bundles) ne sont jamais ajustés : leur stock reste calculé par
  leur plugin.
* Le décompte du stock à la vente, les remboursements et le paiement restent ceux de
  WooCommerce.

== Installation ==

1. Déposer le dossier `youvape-logistique` dans `wp-content/plugins/`.
2. Le plugin arrive **inactif**, et doit le rester : nous vous indiquerons le jour de son
   activation.
3. À l'activation, il crée deux tables (journal des ajustements de stock et des colis) et
   deux options. Rien d'autre.

Compatible avec le stockage des commandes haute performance (HPOS) de WooCommerce.

== Désinstallation ==

La désactivation ne supprime rien. Les deux tables sont conservées volontairement : elles
garantissent qu'un même ajustement ou un même colis n'est jamais appliqué deux fois.

== Changelog ==

= 0.6.0 =
* Interrupteur des mouvements de stock, coupé par défaut.

= 0.5.0 =
* Interrupteur des changements de statut, coupé par défaut : seul le suivi est écrit.

= 0.4.0 =
* Le plugin ne pose que trois statuts : expédiée, retrait boutique, livrée. Quelles commandes
  partent est décidé par l'app.

= 0.3.0 =
* Statuts réglés en quatre choix : à expédier, expédiée, retrait boutique, livrée.
* Un seul colis par commande ; une étiquette refaite remplace l'envoi et peut renvoyer le mail.
* Plus de méta `_yv_shipments`.

= 0.2.0 =
* Seules les métas `_yv_*` sont écrites, plus aucune méta `bms_*`.
* Le changement de statut peut prévenir le client, ou non, à chaque demande.
* Passage en « Livrée » possible depuis l'app.
* Les envois sans mail bloquent aussi les appels aux prestataires de mails et d'avis.
* Case « Restocker » cochée seulement si la commande n'est pas expédiée.

= 0.1.0 =
* Première version.
