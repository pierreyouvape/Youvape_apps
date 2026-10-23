import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.dirname(fileURLToPath(import.meta.url));

/**
 * `manualChunks` : tout ce que main.jsx et App.jsx importent (React, routeur,
 * connexion, bandeau…) va dans un fichier `socle`, App.jsx et main.jsx restent seuls
 * dans l'entrée.
 *
 * Sans ça, Rollup laisse ce code partagé DANS l'entrée : les écrans importent
 * l'entrée, l'entrée importe les écrans, et ce cycle change le nom de TOUS les
 * fichiers au moindre déploiement (mesuré le 23/10/2026 : un mot changé dans
 * Tableau renommait les 110 fichiers). Le navigateur retéléchargeait tout, et un
 * onglet ancien rechargeait au premier écran ouvert, quelle que soit l'app mise à jour.
 */
export function socleChunk({ entree = 'src/main.jsx', routeur = 'src/App.jsx' } = {}) {
  const entreeId = path.resolve(RACINE, entree);
  const routeurId = path.resolve(RACINE, routeur);
  let socle = null;
  return (id, { getModuleInfo }) => {
    if (!socle) {
      socle = new Set();
      const pile = [entreeId];
      while (pile.length) {
        const courant = pile.pop();
        if (socle.has(courant)) continue;
        socle.add(courant);
        pile.push(...(getModuleInfo(courant)?.importedIds || []));
      }
      socle.delete(entreeId);
      socle.delete(routeurId);
    }
    return socle.has(id) ? 'socle' : undefined;
  };
}

/**
 * Empreinte de chaque bloc de l'app, pour que le bandeau « nouvelle version »
 * (src/components/VersionWatcher.jsx) ne s'affiche que là où le code a changé.
 *
 * - Un BLOC = les écrans déclarés `page('<bloc>', () => import('./pages/…'))`
 *   dans App.jsx (cf. src/utils/lazyPage.js) et TOUT ce qu'ils importent.
 * - Le SOCLE = ce que charge chaque page quel que soit l'écran : main.jsx,
 *   App.jsx et leurs imports (connexion, bandeau, post-its du Tableau…). Le
 *   socle change → tout le monde est prévenu.
 *
 * L'empreinte se calcule sur le CONTENU des fichiers sources, pas sur les noms
 * des fichiers produits : elle ne dépend ni du découpage de Rollup ni de ses
 * hashes, et un fichier partagé par deux blocs change l'empreinte des deux.
 *
 * Le résultat est écrit dans index.html (`<script type="application/json"
 * id="app-versions">`) : la page connaît ainsi sa propre version, et le bandeau
 * la compare à celle de l'index.html servi maintenant (jamais mis en cache).
 */

const DECLARATION = /\bpage\(\s*'([a-z0-9-]+)'\s*,\s*\(\)\s*=>\s*import\(\s*'([^']+)'\s*\)\s*\)/g;
const IMPORT_DYNAMIQUE = /\bimport\s*\(/g;

export default function appVersions({ entree = 'src/main.jsx', routeur = 'src/App.jsx' } = {}) {
  let racine;
  let routeurFichier;
  let declarations = [];   // [{ bloc, specifier }]

  return {
    name: 'youvape:app-versions',
    apply: 'build',
    enforce: 'post',

    configResolved(config) {
      racine = config.root;
      routeurFichier = path.resolve(racine, routeur);
    },

    // Lu sur le source brut (avant JSX/esbuild, qui réécrit les guillemets).
    buildStart() {
      const source = readFileSync(routeurFichier, 'utf8');
      declarations = [...source.matchAll(DECLARATION)].map(m => ({ bloc: m[1], specifier: m[2] }));
      // Un écran importé en dur tomberait dans le socle : chargé partout, et sa
      // moindre mise à jour préviendrait tout le monde.
      if (/^import\s[^;]*from\s+['"]\.\/pages\//m.test(source)) {
        this.error(`${routeur} : un écran est importé en dur. Le déclarer avec page('bloc', () => import('./pages/…')).`);
      }
      const imports = (source.match(IMPORT_DYNAMIQUE) || []).length;
      if (!declarations.length || imports !== declarations.length) {
        this.error(
          `${routeur} : ${imports} import() pour ${declarations.length} déclaration(s) page('bloc', () => import('…')). ` +
          'Chaque écran doit être déclaré sous cette forme exacte, sinon ses mises à jour ne préviendraient personne.'
        );
      }
      // Un bloc doit être le premier segment d'une adresse, sinon VersionWatcher ne le retrouve jamais.
      for (const bloc of new Set(declarations.map(d => d.bloc))) {
        if (!new RegExp(`["'\`]/${bloc}(?![a-z0-9-])`).test(source)) {
          this.error(`${routeur} : le bloc '${bloc}' ne correspond à aucune adresse /${bloc}…`);
        }
      }
    },

    async generateBundle(_options, bundle) {
      const empreintesModules = new Map();
      const empreinteModule = (id) => {
        if (empreintesModules.has(id)) return empreintesModules.get(id);
        const fichier = id.split('?')[0];
        // Le fichier tel qu'écrit sur le disque (le CSS compris : après Vite, son
        // module JS n'en garde rien) ; un module virtuel n'a que son code.
        const contenu = !id.startsWith('\0') && existsSync(fichier)
          ? readFileSync(fichier)
          : (this.getModuleInfo(id)?.code ?? '');
        const h = createHash('sha256').update(contenu).digest('hex');
        empreintesModules.set(id, h);
        return h;
      };

      const ecrans = new Map();   // id du module écran → bloc
      for (const { bloc, specifier } of declarations) {
        const resolu = await this.resolve(specifier, routeurFichier);
        if (!resolu) this.error(`${routeur} : écran introuvable « ${specifier} » (bloc ${bloc})`);
        ecrans.set(resolu.id, bloc);
      }

      // Tout ce qu'atteignent ces modules, sans jamais entrer dans un écran par
      // la porte d'App.jsx (ses import() dynamiques) : chaque écran compte pour son bloc.
      const empreinte = (depart, { entrerDansLesEcrans }) => {
        const vus = new Set();
        const pile = [...depart];
        while (pile.length) {
          const id = pile.pop();
          if (vus.has(id)) continue;
          vus.add(id);
          const info = this.getModuleInfo(id);
          if (!info) continue;
          for (const suivant of [...info.importedIds, ...info.dynamicallyImportedIds]) {
            if (!entrerDansLesEcrans && ecrans.has(suivant)) continue;
            pile.push(suivant);
          }
        }
        const h = createHash('sha256');
        for (const id of [...vus].sort()) {
          h.update(path.relative(racine, id.replace(/^\0/, ''))).update('\0').update(empreinteModule(id)).update('\n');
        }
        return h.digest('hex').slice(0, 16);
      };

      const entreeId = (await this.resolve(path.resolve(racine, entree)))?.id;
      if (!entreeId) this.error(`Point d'entrée introuvable : ${entree}`);

      const parBloc = new Map();
      for (const [id, bloc] of ecrans) {
        if (!parBloc.has(bloc)) parBloc.set(bloc, []);
        parBloc.get(bloc).push(id);
      }
      const versions = {
        socle: empreinte([entreeId], { entrerDansLesEcrans: false }),
        blocs: Object.fromEntries(
          [...parBloc].sort(([a], [b]) => a.localeCompare(b))
            .map(([bloc, ids]) => [bloc, empreinte(ids, { entrerDansLesEcrans: true })])
        ),
      };

      const html = bundle['index.html'];
      if (!html || html.type !== 'asset' || !String(html.source).includes('</head>')) {
        this.error('index.html absent du build : impossible d\'y inscrire les versions des blocs');
      }
      html.source = String(html.source).replace(
        '</head>',
        `  <script type="application/json" id="app-versions">${JSON.stringify(versions)}</script>\n  </head>`
      );
    },
  };
}
