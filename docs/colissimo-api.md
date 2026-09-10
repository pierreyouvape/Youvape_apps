# API Colissimo — création d'étiquettes (SLS 3.1)

Contrat reconstitué le 10/09/2026 pour le lot 2 du chantier expédition.

**Source** : le plugin Colissimo officiel installé sur le site,
`colissimo-shipping-methods-for-woocommerce` 2.10.0, copie présente sur le VPS dans
`/home/ubuntu/youvape-site/www/releases/2/wp-content/plugins/`. C'est
l'implémentation de référence de La Poste. Fichiers clés :
`includes/label/lpc_label_generation_payload.php` (payload),
`includes/label/lpc_label_generation_outward.php` (orchestration),
`includes/lpc_rest_api.php` (réponse multipart),
`resources/capabilitiesByCountryFR.json` (matrice des pays).

⚠️ Sur cette boutique, le plugin sert à la **sélection des points de retrait au
checkout**, pas à l'étiquetage : jusqu'au lot 2, c'est BMS qui émettait les
étiquettes Colissimo (suivis `6A…`, `8Q…`, `CG…FR` visibles dans BMS). Son code
d'étiquetage n'a donc jamais tourné ici : rien de ce qui suit n'est « validé en
production » tant que `checkGenerateLabel` ne l'a pas confirmé.

Spec officielle : [documentation SLS](https://www.colissimo.fr/doc-colissimo/yaml/en),
[Web Service d'affranchissement (PDF)](https://www.colissimo.entreprise.laposte.fr/sites/default/files/2021-05/spec_ws_affranchissement_FR.pdf).

## Endpoints

| Action | URL | Effet |
|---|---|---|
| `generateLabel` | `POST https://ws.colissimo.fr/sls-ws/SlsServiceWSRest/3.1/generateLabel` | produit l'étiquette, facturée **au dépôt** |
| `checkGenerateLabel` | même base, `/checkGenerateLabel` | **valide la requête, ne produit ni ne facture rien** |

Il n'y a **pas de serveur de test** chez Colissimo. `checkGenerateLabel` en tient
lieu : c'est ce qu'appelle un contrat marqué « test » dans l'app, et
`colissimoAdapter.validateLabel()` pour la répétition avant mise en service.

Pas d'annulation : l'API ne fait que créer. Une étiquette non déposée n'est pas facturée.

## Authentification

Deux modes dans le plugin ; le site est en `lpc_credentials_type = account` :
`contractNumber` + `password` **dans le corps JSON**. Ne jamais journaliser le payload.

Identifiants : `lpc_id_webservices` (906524) et `lpc_pwd_webservices`, table
`hJvjTIOuoptions` de la base MySQL `youvape-site-db-1`. Ils se saisissent dans
l'app, onglet « Contrats API » — jamais en dur, jamais par SQL.

## Requête

```json
{
  "contractNumber": "906524",
  "password": "…",
  "outputFormat": { "x": 0, "y": 0, "outputPrintingType": "PDF_10x15_300dpi" },
  "letter": {
    "service": {
      "productCode": "DOM",
      "depositDate": "2026-09-10",
      "orderNumber": "1259808",
      "commercialName": "EMC",
      "returnTypeChoice": 3,
      "reseauPostal": 1,
      "totalAmount": 790,
      "transportationAmount": 790
    },
    "parcel": { "weight": "0.48", "pickupLocationId": "315300", "nonMachinable": "false" },
    "customsDeclarations": { "…": "cf. CN23" },
    "sender": { "senderParcelRef": "1259808", "address": { "companyName": "…", "line2": "…",
                "countryCode": "FR", "city": "…", "zipCode": "…" } },
    "addressee": { "address": { "companyName": "", "firstName": "…", "lastName": "…",
                   "line2": "…", "line3": "…", "countryCode": "FR", "city": "…",
                   "zipCode": "…", "email": "…", "phoneNumber": "…", "mobileNumber": "…" } }
  },
  "fields": { "field": [ { "key": "OUTPUT_PRINT_TYPE_CN23", "value": "PDF_A4_300dpi" },
                         { "key": "EORI", "value": "…" } ] }
}
```

- `weight` : **kilogrammes, en chaîne, deux décimales**, 0.01 minimum (l'app raisonne en grammes).
- `depositDate` : `AAAA-MM-JJ`, jamais dans le passé — calculée en **heure de Paris** (le VPS est en UTC).
- `reseauPostal` : seulement en `DOS` vers AT, BE, DE, DK, EE, ES, FI, IT, LU, NL, PL.
  `1` = réseau partenaire (bpost en Belgique), `0` = La Poste. Le site est réglé sur
  « partenaire » pour AT, BE, DE, IT, LU.
- `totalAmount` / `transportationAmount` : **centimes**, uniquement avec une CN23.
- `outputPrintingType` : `PDF_A4_300dpi`, `PDF_10x15_300dpi`, `ZPL_10x15_203dpi`… L'app
  **exige un PDF** : c'est lui qu'elle tamponne du numéro de commande et qu'elle
  réimprime. Une étiquette ZPL serait payée puis impossible à enregistrer.

## Codes produit

| Code | Service |
|---|---|
| `DOM` | domicile sans signature |
| `DOS` | domicile avec signature (et « Expert » international) |
| **`HD`** | **point de retrait**, quel que soit le type de point |
| `COM` | outre-mer sans signature |
| `CDS` | outre-mer avec signature |

⚠️ `_lpc_meta_pickUpProductCode` (`PCS`, `CMT`, `BDP`, `A2P`, `BPR`) est le **type de
point**, pas le code produit. Le code produit d'un envoi en relais est toujours `HD`.

⚠️ **Le code produit ne se lit pas dans le mappage.** « Colissimo Domicile » couvre la
France (`DOM`) ET l'outre-mer (`COM`, CN23 obligatoire) sous une seule dénomination.
Le mappage désigne un **service** (`domicile`, `signature`, `relais`) ; l'adaptateur
calcule le code produit service × pays de destination.

### Matrice (extrait de `capabilitiesByCountryFR.json`)

| Destination | Sans signature | Avec signature | Point de retrait | CN23 |
|---|---|---|---|---|
| FR, MC | `DOM` | `DOS` | `HD` | non |
| AD | `DOM` | `DOS` | — | oui |
| BE | `DOM` | `DOS` | `HD` | non |
| DE, LU, NL, AT, ES, IE, IT, PT, CZ, DK, EE, HU, LT, LV, PL, SE, SI, SK, FI | — | `DOS` | `HD` | non |
| BG, CY, GR, HR, MT, RO | — | `DOS` | — | non |
| CH | `DOM` | `DOS` | — | oui |
| GB, NO, et le reste des zones Z2–Z4 hors UE | — | `DOS` | — | oui |
| Outre-mer : BL, GF, GP, MQ, PM, RE, YT, NC, PF, TF, WF | `COM` | `CDS` | — | oui |

Un pays absent est **refusé**, pas deviné. Saint-Martin (MF) est écarté : ses
capacités dépendent d'un calcul intra-DOM.

⚠️ **À trancher par `checkGenerateLabel`** : « Bpost, Colissimo International » vers le
**Luxembourg** part aujourd'hui dans BMS en « Domicile sans signature », alors que la
matrice n'offre que `DOS` pour LU. Mappée sur `domicile`, la dénomination est refusée
vers LU avec un message qui propose « avec signature ».

## Point de retrait (Bpost)

Bpost n'est **pas** une intégration séparée : c'est `HD` sur le contrat Colissimo.
Les points sont réservés par le plugin `lpc` et arrivent en base avec
`relay_point.network = 'colissimo'`, un code à 6 chiffres, un type `PCS`/`CMT`/`BDP`.

Trois contraintes dures (`checkConsistency` du plugin) :
1. `letter.parcel.pickupLocationId` **obligatoire** en `HD` — et **interdit** hors `HD` ;
2. `letter.service.commercialName` obligatoire ;
3. **`mobileNumber` obligatoire** sur le destinataire : bpost prévient le client par SMS.

⚠️ `shipping_phone` est vide sur 100 % des commandes Bpost (0/977 sur 90 jours) ;
`billing_phone` est renseigné partout, et 976/977 sont des mobiles belges
(`^(?:(?:\+|00)32|0)4\d{8}$`), ramenés au format `+324…`.

En point de retrait, l'adresse destinataire devient **celle du point**, son nom en
`companyName` ; le nom du client reste en `firstName` / `lastName`.

## Adresses et caractères

- Noms : **ASCII** (le plugin les passe par `toAscii`).
- Adresse, ville, société : latin-1.
- `line2` et `line3` : **35 caractères**. Ce qui déborde de la rue passe en tête de `line3`.
- Belgique et Suisse : l'étiquette n'imprime pas `line3` — le complément remonte en `line2`.
- Luxembourg : code postal sans le préfixe `L-`.
- Symboles nommés avant tout filtrage (`addressFields.replaceSymbols`) : `Ω` → `ohm`
  (620 libellés produits), `°` / `º` → `o`, `²` → `2`, `€` → `EUR`.

⚠️ Le plugin ne traite qu'une **liste fermée** d'accents (`replaceAccents`) : `Ω`, `°`,
`ñ` y passent en clair et l'API les rejette. L'app, elle, ramène chaque champ à une
liste blanche : un caractère imprévu est écarté, jamais transmis.

## Déclaration douanière (CN23)

Exigée vers l'outre-mer, le Royaume-Uni, la Suisse et les pays hors UE — dans notre
volume, **21 commandes sur 90 jours** (RE, MQ, GP, PF, GF, GB), noyées dans les mêmes
dénominations que la France.

```json
"customsDeclarations": {
  "includeCustomsDeclarations": 1,
  "numberOfCopies": 4,
  "contents": {
    "article": [ { "description": "Cartouche Avata - 0.40 ohm", "quantity": 2, "weight": "0.01",
                   "value": "5.9", "currency": "EUR", "artref": "SKU", "originalIdent": "A",
                   "originCountry": "FR", "hsCode": "85437070" } ],
    "category": { "value": 3 }
  },
  "invoiceNumber": "1258878"
}
```

| Réglage | Valeur actée (Pierre, 08/09/2026) |
|---|---|
| Code SH | `85437070`, tout le catalogue |
| Pays d'origine | `FR`, tout le catalogue |
| Catégorie | `3` = envoi commercial (1 cadeau, 2 échantillon, 4 document, 5 autre, 6 retour) |
| DDP outre-mer (`parcel.ftd`) | non — le client paie les droits |
| EORI | non renseigné ; envoyé seulement s'il l'est |

- `description` : 64 caractères, **sans accent** (« The Colissimo API returns an error
  if there is an accent »). Nom commercial conservé, comme acté.
- `value` : prix **unitaire** payé après remise (`line_total / qty`, calcul en centimes).
  TVA nulle sur toutes nos commandes outre-mer et GB : HT = payé.
- **Packs `woosb`** : on déclare la ligne du pack, qui porte le prix, et on ignore ses
  composants à 0 €. ⚠️ Le plugin fait l'inverse et force chaque composant à 1 € :
  commande 1254235, « Pack 10 Boosters » à 6,58 € aurait été déclaré 10 €.
- **Article offert** (0 €, commande sans pack) : déclaré au plancher (1 €), car l'API
  refuse une valeur nulle. Commande 1240410 : « The Green Oil 100ml ».
- **Port gratuit refusé** : l'API rejette une CN23 sans frais de port (aucun cas sur 180 jours).
- GB : numéro de TVA en `comments`, EORI britannique.

Règle de sélection des lignes : `services/orderCustomsService.js`, commune à tous les
transporteurs.

## Réponse

**Multipart MIME** (MTOM), pas du JSON :

```
--uuid:…
Content-Type: application/json
Content-ID: <jsonInfos>

{"messages":[{"id":"0","type":"INFOS","messageContent":"…"}],
 "labelV31Response":{"parcelNumber":"6A07657471207", …}}
--uuid:…
Content-Type: application/octet-stream
Content-ID: <label>

%PDF-1.4 … (binaire)
--uuid:…
Content-ID: <cn23>

%PDF-1.4 … (binaire, seulement si CN23)
--uuid:…--
```

- Numéro de colis : `jsonInfos.labelV31Response.parcelNumber`.
- Erreur : `jsonInfos.messages[0].id` ≠ `"0"` — **y compris en HTTP 200**.
- Le découpage se fait **sur les octets** : une conversion en chaîne UTF-8 corromprait
  le PDF sans lever d'erreur.
- La CN23 est un **second document** : stockée dans `shipment_labels.cn23_data`,
  téléchargée sous `customs_document_<n°>.pdf` (règle AutoPrint → Brother A4), là où
  l'étiquette part sous `colissimo_<n°>.pdf` (règle AutoPrint → Intermec).

## Libellés BMS

Relevés dans BMS le 10/09/2026. Le libellé **suit le service choisi**, pas le code
produit : une commande « Colissimo Domicile » vers La Réunion (`COM`) y est classée
« Domicile sans signature ».

| Service | `method_code` BMS | Libellé envoyé |
|---|---|---|
| `domicile` | `colissimo_homecl` | La Poste : Colissimo - Domicile sans signature |
| `signature` | `colissimo_homesi` | La Poste : Colissimo - Domicile avec signature |
| `relais` | `colissimo_pickup` | La Poste : Colissimo - Point de retrait |
