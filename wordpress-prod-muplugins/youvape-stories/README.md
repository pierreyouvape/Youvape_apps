# youvape-stories — lecteur de stories du site

Remplace le widget Join Stories (contrat terminé le 01/12/2026). Les vidéos sont
envoyées, compressées et publiées depuis l'app **/stories** de Youvape_apps
(apps.youvape.fr) ; ce dossier contient la partie **site**.

## Contenu

| Fichier | Rôle |
|---|---|
| `assets/yv-stories.js` | Lecteur sans dépendance (~10 Ko) : bulles, carrousel de cartes, lecteur plein écran |
| `assets/yv-stories.css` | Styles, couleurs réglables par variables CSS (`--yvs-accent`, `--yvs-ring`…) |
| `preview/index.html` | Page d'aperçu en ligne : https://videos.youvape.fr/stories/preview/index.html |

**Intégration au site (20/10/2026)** : mu-plugin `youvape-stories.php` dans le dépôt du
site (GitLab `git.tilvalhall.fr:TVL/youvape-v2`, branche `feature-youvape-stories`),
qui embarque une COPIE de `assets/` : toute modification du lecteur ici doit y être
reportée (le site déploie sa propre copie). Restent à faire : pages `/videos/<slug>`,
sitemap vidéo, attribution des commandes.

## Données publiées (contrat)

« Publier sur le site » dans /stories écrit sur `https://videos.youvape.fr` :

- `stories/index.json` — tout en un fichier, cache 60 s :
  - `stories` : slug → `{ title, description, format, duration, video, poster, thumb, gif, cta }`
  - `widgets` : slug → `{ title, layout: "bubbles" | "cards", stories: [slugs dans l'ordre] }`
  - `products` : `wp_product_id` (parent ou simple) → `[slugs de widgets]`
  - `pages` : chemin (`/youvape-awards`) → `[slugs de widgets]`
- `stories/widgets/<slug>.json` — un widget déplié (stories complètes).

Les fichiers vidéo sont versionnés (`story.v2.mp4`) et servis en cache immuable :
ne jamais réécrire une URL publiée, des e-mails Probance déjà envoyés y pointent.

## Utilisation du lecteur

```html
<link rel="stylesheet" href=".../yv-stories.css">
<script src=".../yv-stories.js" defer></script>
<div id="yvs-aerox"></div>
<script>
  // widget = index.widgets[slug] déplié : YVStories.expand(index, slug)
  YVStories.mount(document.getElementById('yvs-aerox'), widget, { siteUrl: 'https://www.youvape.fr' });
</script>
```

- Rendu serveur : générer le même HTML que `renderBubbles` / `renderCards`
  (attribut `data-yvs-index` sur chaque élément), puis `YVStories.bind(conteneur, widget)`.
- `#story=<slug>` dans l'adresse ouvre directement une story (`YVStories.openFromHash`).
- Statistiques : `YVStories.configure({ collectUrl: 'https://apps.youvape.fr/api/stories-collect' })`
  envoie les événements par lots (sendBeacon) à Youvape_apps, qui les affiche dans
  /stories. Aucune donnée personnelle (identifiant d'onglet aléatoire, pas d'IP
  conservée). `source` vaut `email` tout seul quand l'adresse porte `utm_medium=email`.
- Le lecteur émet aussi `yvstories:event` sur `window`
  (`impression`, `open`, `view`, `progress` 25/50/75/100, `seek`, `cta_click`, `close`).
  Un saut en avant n'émet PAS les paliers `progress` sautés (le taux de lecture
  complète ne doit compter que ce qui a été regardé).
- Navigation : tap gauche / droite = vidéo précédente / suivante ; boutons
  visibles « −10 s / lecture-pause / +10 s » ; barre de lecture en bas (glisser
  ou toucher) ; clavier ← → = ±10 s, ↑ ↓ = vidéo
  précédente / suivante, Espace = pause, Échap = fermer.

## Points d'intégration WordPress

- ⚠️ **Cache des .js / .css** : la zone Cloudflare youvape.fr impose aux
  navigateurs un cache de **6 mois** sur les `.js` et `.css`
  (`max-age=16070400`, quel que soit l'en-tête envoyé — constaté le 13/10/2026).
  Toujours charger le lecteur avec un numéro de version qui change à chaque
  modification, sinon les visiteurs gardent l'ancien lecteur :
  `wp_enqueue_script('yv-stories', $url, [], filemtime($path), true)` (même chose
  pour la feuille de style). L'aperçu publie des noms à empreinte
  (`tools/upload-preview.js`).

- **WP Rocket** : exclure `yv-stories.js` du « Retarder l'exécution JavaScript »,
  sinon le premier tap sur une bulle ne fait rien.
- Retirer le `preconnect` / `preload` vers `youvape.my.join-stories.com` (le
  `scripts/product.js` qu'il précharge répond déjà AccessDenied).
- Bouton d'action : `cta.url` si renseigné, sinon `/?post_type=product&p=<product_id>`.

## Testé (13/10/2026)

Parcours réel sous WebKit (profil iPhone 14) : ouverture au clic, lecture avec
le son, barre de progression, fermeture par Échap, événements émis, aucune
erreur JavaScript.
