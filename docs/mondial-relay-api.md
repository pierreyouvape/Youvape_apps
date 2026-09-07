# API Mondial Relay — création d'étiquettes

Contrat reconstitué le 07/09/2026 pour le lot 1 du chantier expédition.
La spec officielle (`web-service-dual-carrier-v-271.pdf`) est sur `mondialrelay.fr`,
**inaccessible par programme** : Cloudflare renvoie une page de défi à curl comme à
WebFetch. Ce document tient lieu de référence ; le recouper avec le PDF officiel si
vous y avez accès depuis un navigateur.

## Les deux API du compte

Le portail Mondial Relay expose deux jeux d'identifiants distincts (écran
« Paramétrage des API, FTP, EDI ») :

| | API 1 (SOAP, historique) | **API 2 (Connect, celle qu'on utilise)** |
|---|---|---|
| Production | `api.mondialrelay.com/WebService.asmx` | `connect-api.mondialrelay.com/api/Shipment` |
| Test | même URL, enseigne `TTMRSDBX` | `connect-api-sandbox.mondialrelay.com/api/shipment` |
| Identifiants | Code Enseigne + clé privée | Connexion API + mot de passe API |

Enseigne de production : `LGYOUVAP`, marque `LG`, code marque numérique `62`.
Enseigne de test : `TTMRSDBX`, marque `TT`, code numérique `99`.

⚠️ **Les identifiants de test ne créent pas d'expéditions valides** et peuvent
changer sans préavis — ils servent à valider une intégration, pas à expédier.

## Requête

`POST https://connect-api.mondialrelay.com/api/shipment`
`Content-Type: application/xml`

⚠️ **Aucune authentification HTTP.** Ni Basic, ni en-tête `X-Brand-Id` : les
identifiants voyagent **dans le corps XML** (`Context`). C'est ce qui rend toute
sonde HTTP inutile pour valider des identifiants — `GET /api/shipment` répond 405
y compris avec des identifiants bidon (constaté le 07/09/2026).

⚠️ **Requête en XML, réponse en JSON** (sérialisation .NET, clés suffixées `Field`).

```xml
<ShipmentCreationRequest xmlns="http://www.example.org/Request">
  <Context>
    <Login>LGYOUVAP@business-api.mondialrelay.com</Login>
    <Password>…</Password>
    <CustomerId>LGYOUVAP</CustomerId>
    <Culture>fr-FR</Culture>
    <VersionAPI>1.0</VersionAPI>
  </Context>
  <OutputOptions>
    <OutputFormat>A4</OutputFormat>      <!-- 10x15 | A4 | A5 -->
    <OutputType>PdfUrl</OutputType>      <!-- ZplCode | PdfUrl | IplCode -->
  </OutputOptions>
  <ShipmentsList>
    <Shipment>
      <OrderNo>1258938</OrderNo>
      <CustomerNo>…</CustomerNo>
      <ParcelCount>1</ParcelCount>
      <CollectionMode Mode="CCC"/>
      <DeliveryMode Mode="24R" Location="FR-022112"/>
      <Parcels>
        <Parcel>
          <Content>…</Content>
          <Weight Value="480" Unit="gr"/>
        </Parcel>
      </Parcels>
      <Sender><Address>…</Address></Sender>
      <Recipient><Address>…</Address></Recipient>
    </Shipment>
  </ShipmentsList>
</ShipmentCreationRequest>
```

`DeliveryMode` et `CollectionMode` portent leurs valeurs en **attributs**, pas en
éléments. Idem pour `Weight`, `Length`, `Width`, `Depth`.

### Modes de livraison — **vérifié sur le sandbox le 07/09/2026**

`Mode` ∈ `LCC` · `HOM` · `24R` · `24L` · `XOH`. Tout autre code renvoie l'erreur
`10024 « Le produit de livraison n'est pas autorisé »` : ce sont les seuls produits
auxquels le contrat donne droit (22 codes plausibles essayés, tous refusés).

| Mode | Ce que c'est | Location |
|---|---|---|
| **`24R`** | **Point Relais L — le produit à utiliser** | obligatoire |
| `24L` | Point Relais **XL** (variante de TAILLE) | obligatoire, et le point doit être XL |
| `LCC` | Livraison à l'enseigne | **refuse** tout point de retrait (`10074`) |
| `HOM` | Domicile | exige les dimensions du colis (`10106`) |
| `XOH` | D+1 | — |

⚠️ **`24L` n'est PAS le mode « locker ».** C'est une variante de taille. Un point
Relais Standard comme une Consigne s'y font refuser :
`10075 « Le type de point de retrait <type> n'est pas compatible avec le produit
Point Relais XL »`. Seuls les points eux-mêmes XL l'acceptent.

⚠️ **`24R` couvre les consignes (lockers) aussi bien que les points relais.**
Vérifié sur des codes réels tirés de nos commandes : `FR-016834` et `FR-028548`
(service `mondial_relay_lockers`) passent en `24R`. **Les deux modes de livraison
du site — Point Relais et Lockers — se traduisent donc par le même `24R`.**

Certains points renvoient `10055 « Le plan de tri est introuvable »` : la
combinaison produit / pays / code postal destinataire / point n'est pas desservie.
Ce n'est pas une erreur de code, c'est un refus métier — à remonter tel quel au
préparateur, qui devra faire choisir un autre point.

### Routage : ne pas déduire, mapper

⚠️ **Ne pas router sur `relay_point->>'service'`** : le champ est renseigné par
yousync et se trompe déjà — 256 commandes portent le réseau `mondial_relay` alors
que le libellé WooCommerce dit « Bpost Relais », et Colissimo n'a jamais de
`service`. S'y fier enverrait des colis Bpost chez Mondial Relay.

⚠️ **Ne pas router sur le libellé en dur non plus** : « Mondial Relay 3 à 6 jours
ouvrés » a été remplacé le 03/09/2026 par « Point Relais » et « Lockers ». Un
libellé nouveau doit produire une alerte, pas une étiquette au hasard.

Le routage passe par une table de correspondance **dénomination WooCommerce →
transporteur**, éditable dans les réglages de l'app. Une dénomination inconnue
bloque le packing avec un message demandant à un responsable de la mapper. Les
modes sans étiquette API (« Retrait Magasin », 284 commandes/90 j) doivent y être
déclarés explicitement comme « pas d'étiquette », sans quoi l'alerte se déclenche
tous les jours et les préparateurs apprennent à l'ignorer.

### Contraintes de champs (schéma officiel)

| Champ | Contrainte |
|---|---|
| `CustomerId` | max 8, `^[0-9A-Z]{2}[0-9A-Z ]{4,6}$` |
| `OrderNo` | max 15, `[0-9A-Z_-]` — **majuscules uniquement** |
| `CustomerNo` | max 9, `[0-9A-Z]` |
| `ParcelCount` | 1 à 2 chiffres |
| `Content` | max 40 |
| `Weight` | `Unit="gr"` — **des grammes**, comme `orderWeightService` |
| `Location` | max 10, `[0-9A-Z-]` |
| `City` | max 30, lettres/espaces/tirets — **pas de chiffres** |
| `PostCode` | max 10 |
| `Streetname` | max 40 |
| `HouseNo` | max 10 |
| `CountryCode` | 2 majuscules |
| `Title` | `Mr` ou `Mme`, optionnel |
| `Title`+`Firstname`+`Lastname` | **≤ 32 au total** |
| `Streetname`+`HouseNo` | **≤ 40 au total** |

Les deux contraintes de longueur combinée sont le piège : chacun des champs passe
isolément, c'est la somme qui est refusée.

## Réponse

```
shipmentsListField[0].shipmentNumberField                    → n° d'expédition (8 chiffres)
shipmentsListField[0].labelListField.labelField.outputField  → URL du PDF (OutputType=PdfUrl)
statusListField[].levelField / .messageField                 → erreurs
```

Une erreur se lit dans `statusListField` avec un `levelField` contenant `error` —
**le HTTP reste 200**, vérifié : toutes les erreurs ci-dessus sont arrivées en 200.
Un succès porte `codeField = "0"`.

⚠️ **La réponse renvoie le mot de passe en clair** dans `contextField.passwordField`.
Ne jamais journaliser la réponse brute — la caviarder avant tout `console.log`.

⚠️ `PdfUrl` rend une **URL**, pas du base64. `shipment_labels.pdf_data` stocke du
base64 : l'adaptateur devra télécharger le PDF pour que la réimpression continue de
marcher hors ligne, comme pour la lettre suivie.

## Suivi

Il n'y a **pas** de suivi dans l'API Connect (POST seulement).
`trackingService.trackMondialRelay()` fait un `GET /api/Shipment/{n}` qui répond 405
en permanence et retombe en silence sur un badge « Suivi ». Un vrai statut passerait
par le SOAP `WSI2_TracingColisDetaille` de l'API 1 (enseigne + clé privée).

Lien de suivi client : `ens=LGYOUVAP` obligatoire, cf. `frontend/src/utils/trackingUtils.js`.
