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

### Modes de livraison

`Mode` ∈ `LCC` · `HOM` · `24R` · `24L` · `XOH`

Correspondance avec nos commandes — **se fier à `orders.relay_point->>'service'`,
pas au libellé `shipping_method`** : ce libellé a déjà changé une fois (« Mondial
Relay 3 à 6 jours ouvrés » remplacé le 03/09/2026 par « Point Relais » et
« Lockers »), et les anciennes commandes portent encore l'ancien.

| `relay_point->>'service'` | `Mode` |
|---|---|
| `mondial_relay_point_relais` | `24R` |
| `mondial_relay_lockers` | `24L` |

⚠️ **`Location` est préfixé du pays du point relais** : `FR-022112`, et non
`022112`. Nos points sont en **FR, BE et LU** — prendre `relay_point->>'country'`,
jamais « FR » en dur. Nos identifiants font 6 chiffres, zéros compris.

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
**le HTTP peut rester 200**, il faut inspecter le corps.

⚠️ `PdfUrl` rend une **URL**, pas du base64. `shipment_labels.pdf_data` stocke du
base64 : l'adaptateur devra télécharger le PDF pour que la réimpression continue de
marcher hors ligne, comme pour la lettre suivie.

## Suivi

Il n'y a **pas** de suivi dans l'API Connect (POST seulement).
`trackingService.trackMondialRelay()` fait un `GET /api/Shipment/{n}` qui répond 405
en permanence et retombe en silence sur un badge « Suivi ». Un vrai statut passerait
par le SOAP `WSI2_TracingColisDetaille` de l'API 1 (enseigne + clé privée).

Lien de suivi client : `ens=LGYOUVAP` obligatoire, cf. `frontend/src/utils/trackingUtils.js`.
