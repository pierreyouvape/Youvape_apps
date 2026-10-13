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

Le mu-plugin PHP (rendu serveur des widgets, page `/videos/<slug>`, sitemap vidéo)
reste à écrire, en partant du thème enfant `you-vape-theme-child`.

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
- Statistiques : le lecteur émet `yvstories:event` sur `window`
  (`impression`, `open`, `view`, `progress` 25/50/75/100, `seek`, `cta_click`, `close`).
  Un saut en avant n'émet PAS les paliers `progress` sautés (le taux de lecture
  complète ne doit compter que ce qui a été regardé).
- Navigation : tap gauche / droite = vidéo précédente / suivante ; barre de
  lecture en bas (glisser ou toucher) ; clavier ← → = ±5 s, ↑ ↓ = vidéo
  précédente / suivante, Espace = pause, Échap = fermer.

## Points d'intégration WordPress

- **WP Rocket** : exclure `yv-stories.js` du « Retarder l'exécution JavaScript »,
  sinon le premier tap sur une bulle ne fait rien.
- Retirer le `preconnect` / `preload` vers `youvape.my.join-stories.com` (le
  `scripts/product.js` qu'il précharge répond déjà AccessDenied).
- Bouton d'action : `cta.url` si renseigné, sinon `/?post_type=product&p=<product_id>`.

## Testé (13/10/2026)

Parcours réel sous WebKit (profil iPhone 14) : ouverture au clic, lecture avec
le son, barre de progression, fermeture par Échap, événements émis, aucune
erreur JavaScript.
