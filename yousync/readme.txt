=== YouSync ===
Requires at least: 5.8
Requires PHP: 7.4
Stable tag: 2.0.0

Tient à disposition du serveur Youvape les événements WooCommerce : commandes,
produits, clients et remboursements.

== Installation ==

Mise à jour d'une extension déjà active : remplacer le dossier `yousync`.
Aucune action n'est nécessaire ensuite : l'extension crée sa table au premier
chargement et reprend d'elle-même son état précédent.

== Fonctionnement ==

L'extension enregistre chaque événement dans sa propre table, dans la base du site.
Cette table ne contient aucune donnée client. L'extension ne modifie ni les
commandes, ni les produits, ni les clients, et n'envoie rien vers l'extérieur.

Compatible avec le stockage classique des commandes et avec HPOS.

== Administration ==

Le menu YouSync indique l'état de la file. Il permet de suspendre la livraison, sans
perdre aucun événement, et de rejouer les événements en échec.

== Changelog ==

= 2.0.0 =
* Événements enregistrés dans une table dédiée.
* Reprise automatique de la file de la version précédente.
* Écran d'administration simplifié.
