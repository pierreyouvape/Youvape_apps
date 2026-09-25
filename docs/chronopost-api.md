# Chronopost — contrat d'API d'étiquetage (lot 3)

Reconstitué le 23/09/2026 depuis les plugins présents sur le site
(`wp-content/plugins/` de la copie sur le VPS) et le WSDL public :

- `wc-multishipping` 3.0.3 — **actif**, réserve les points au checkout
  (`_wms_chronopost_pickup_info`). Étiquetage : `inc/admin/classes/chronopost/chronopost_label.php`.
- `chronopost` 4.2.1 (Adexos, officiel) — **inactif**, référence pour la livraison du samedi
  (`includes/class-chronopost-webservice.php`).
- WSDL, sans authentification : `https://ws.chronopost.fr/shipping-cxf/ShippingServiceWS?wsdl`
  et `https://ws.chronopost.fr/tracking-cxf/TrackingServiceWS?wsdl`.

Aucun des deux plugins n'a émis d'étiquette sur cette boutique : c'était BMS.

## Appels

| Étape | Service | Opération |
|---|---|---|
| Création | ShippingServiceWS | `shippingMultiParcelWithReservationV3` → `reservationNumber`, `resultParcelValue.skybillNumber` |
| PDF | ShippingServiceWS | `getReservedSkybillWithTypeAndMode(reservationNumber, mode)` → `skybill` (base64) |
| Annulation | TrackingServiceWS | `cancelSkybill(accountNumber, password, language, skybillNumber)` |

SOAP document/literal, éléments **non qualifiés**, ordre imposé par `xs:sequence`.
Erreur = `return.errorCode != 0`, en HTTP 200. Une faute SOAP (HTTP 500) signale un champ
refusé par le schéma. Identifiants dans le corps : jamais de log du payload.

Champs obligatoires au schéma : `headerValue.accountNumber`, `headerValue.subAccount`
(0), `*PreAlert` (0), `skybillValue.shipHour`, dimensions `height/length/width` (1 × 1 × 1
comme les plugins).

Annulation : **refusée en réel le 25/09/2026** — code 2 juste après la création (colis pas
encore enregistré), puis code 3 « the parcel isn't candidate to cancel » trois minutes plus tard,
sans aucun événement de suivi (colis XS486930837FR et XR703160663TS, restés actifs). Cause
inconnue : l'app déclare Chronopost non annulable ; annulation dans l'espace Chronopost Pro.

Refus d'identifiants à la création : **code 3 supposé**, pas encore observé — à confirmer
au premier vrai refus. Même règle qu'au lot 2 : on ne réessaie jamais.

## Contrats

| Contrat app | N° de compte | Usage |
|---|---|---|
| `chronopost/2shop` | 84284503 | 2Shop France hors Corse (dénomination « 2Shop ») |
| `chronopost/principal` | 34751303 | tout le reste |

## Produits et service

| Mode | Pays | Produit | Libellé BMS |
|---|---|---|---|
| `relais` | FR (pays du point) | `86` | Chrono Relais FR - Livraison en point relais en France |
| `domicile` | FR, MC | `01` | Chrono 13 - Livraison express à domicile avant 13H |
| `2shop` | FR | `5X` | Chrono 2 Shop Direct - 2Shop Direct |
| `2shop` | UE (DE, IT) | `6B` | Chrono 2 Shop Europe - 2Shop Europe |
| `express` | UE hors FR | `17` | Chrono Express - Livraison express partout dans le monde |

`service` : `0` normal, **`6` livraison le samedi** (Chrono 13 et Chrono Relais seulement),
`337` / `338` pour 2Shop Europe (≤ 3 kg / au-delà).

Samedi : interrupteur du packing visible le jeudi et le vendredi, coché d'office le vendredi,
transmis en `saturdayDelivery`. Sans interrupteur, samedi le vendredi seulement (heure de
Paris). L'étiquette est enregistrée en `86-SAMEDI` / `01-SAMEDI`.

## Point relais

`recipientRef` = code du point (5 caractères alphanumériques, réseau `chronopost`) : c'est lui
qui route le colis. Nom du point en `recipientName`, client en `recipientName2`, adresse du
point. Les commandes créées au back-office n'ont pas de point : il se saisit dans la fiche
commande.

## Format

`mode` = `THE` (PDF thermique 10x15) par défaut ; `PDF` / `SPD` en A4. Pas de ZPL : le numéro
de commande est tamponné sur le PDF. Fichier `chronopost_<n°>.pdf`.

## Bordereau

Aucune API : le plugin officiel fabrique le sien en PDF local. L'app produit son
récapitulatif de remise (préfixe `CH`), un par contrat.

## Répétition

```
node src/scripts/checkChronopostLabels.js [jours]              # à blanc, aucun appel
node src/scripts/checkChronopostLabels.js reel <n°> [--garder]  # UNE étiquette, annulée aussitôt
```
