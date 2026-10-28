/**
 * Banc du Suivi SEO : page de référence et consignes selon le type de page.
 *
 * Sans réseau ni base : `node tests/seoAdvisor.test.js` (ou `npm test`).
 *
 * Ce qui est couvert (cas réels du 27/10/2026) :
 *   - le rôle de chaque type de page : fiche produit (son modèle), page marque
 *     (la marque), catégorie (un type de produit), landing page (le thème de
 *     son adresse), lexique (la définition), étiquette, accueil ;
 *   - « puff elfbar » → page marque, « elfbar 4 in 1 » → fiche, « puff » →
 *     catégorie, « puff sans nicotine » → sa landing page, une question → lexique ;
 *   - une fiche, une page marque ou l'accueil ne changent jamais de title ;
 *     un lexique dont le title ne parle que de la requête est recentré sur la
 *     définition ; une étiquette dans ce cas passe en noindex ;
 *   - une page cible décidée n'est jamais modifiée ;
 *   - rien à faire = pas de carte, et aucune ligne « ne rien… » dans une carte ;
 *   - les consignes sont complètes : phrase HTML à coller, lien relatif ;
 *   - la marque se lit dans les données structurées, pas dans l'adresse ;
 *   - pas de lien depuis /marque/elfbar vers l'article « menthol » ;
 *   - un seul H2 pour « elfbar recharge » et « recharge elfbar ».
 *
 * Cas réels du 28/10/2026 (cartes « Liens à corriger » fausses, masquées) :
 *   - un lien vers une autre version du modèle (JNR avec / sans nicotine) ou vers
 *     l'étiquette du modèle n'est jamais signalé ;
 *   - un nom de marque seul va vers la page marque, jamais vers une fiche, même
 *     quand la marque contient « vape » (Geek Vape, Lost Vape) ;
 *   - la carte « Texte » ne demande que ce qui manque à l'intro et aux H2 ;
 *   - le title d'une page cible peut commencer par le type de produit
 *     (« Puff Elfa Pro… »), « cartouche » = « recharge », « 4in1 » = « 4 in 1 ».
 */

const assert = require('assert');
const advisor = require('../src/services/seoAdvisorService');

const {
  brandFromJsonLd, ownsQuery, isBrandQuery, brandOf, roleOf, centeredOn, chooseReference, rivalSteps,
  relatedSources, detectCannibalisation, detectTexte,
} = advisor;

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

const SITE = 'https://www.youvape.fr';
const MARQUE = `${SITE}/marque/elfbar`;
const KIT_4IN1 = `${SITE}/produit/e-cigarettes/kits-ecigarettes/puffs/puff-4in1-elfbar`;
const PACK_4IN1 = `${SITE}/produit/eliquides/cartouches-pre-remplies/pack-2x-cartouches-4in1-10mg-elfbar`;
const ELFA_0MG = `${SITE}/produit/e-cigarettes/kits-ecigarettes/puffs/puff-elfa-pro-0mg`;
const ELFA_20MG = `${SITE}/produit/e-cigarettes/kits-ecigarettes/puffs/kit-puff-elfa-pro-20mg-elfbar`;
const ELFX = `${SITE}/produit/e-cigarettes/kits-ecigarettes/kits-format-pod/kit-elfx-mega-elbar`;
const TAG_4IN1 = `${SITE}/etiquette-produit/puff-elfbar-4in1`;
const CAT_PUFFS = `${SITE}/categorie-produit/e-cigarettes/kits-ecigarettes/puffs`;
const CAT_ECIG = `${SITE}/categorie-produit/e-cigarettes`;
const CAT_POD = `${SITE}/categorie-produit/e-cigarettes/kits-ecigarettes/kits-format-pod`;
const PUFF_0MG = `${SITE}/puff-sans-nicotine`;
const LEX_PUFF = `${SITE}/puff`;
const LEX_ECIG = `${SITE}/cigarette-electronique`;
const ACCUEIL = `${SITE}/`;
const ARTICLE_MENTHOL = `${SITE}/blog/vape-news/interdiction-des-cigarettes-mentholees-pourquoi`;
const BOSTON = `${SITE}/produit/eliquides/eliquides-10ml/boston-menthol`;

// Titles et H1 relevés en ligne (27/10/2026), ou d'avant les corrections du plan.
const PAGES = {
  [MARQUE]: { title: 'Toutes les Puffs et recharges de la marque Elfbar - YouVape', h1: 'Elfbar, le spécialiste de la puff' },
  [KIT_4IN1]: { title: 'Puff 4in1 par Elfbar - 4 goûts dans 1 seule puff - YouVape', h1: 'Puff 4in1 - Elfbar', brand: 'Elfbar' },
  [PACK_4IN1]: { title: 'Pack 2x Cartouches 4in1 10mg/ml par Elfbar - YouVape', h1: 'Pack 2x Cartouches 4in1 10mg/ml - Elfbar', brand: 'Elfbar' },
  [ELFA_0MG]: { title: 'Puff Elfa Pro sans Nicotine (2 cartouches, 4ml) par Elfbar - YouVape', h1: 'Puff Elfa Pro sans Nicotine (2 cartouches, 4ml) - Elfbar', brand: 'Elfbar' },
  [ELFA_20MG]: { title: 'Puff Elfa Pro 20mg par Elfbar - YouVape', h1: 'Puff Elfa Pro 20mg - Elfbar', brand: 'Elfbar' },
  [ELFX]: { title: 'Cigarette électronique Pod ElfX Mega par Elfbar- YouVape', h1: 'Cigarette électronique Pod ElfX Mega - Elfbar', brand: 'Elfbar' },
  [TAG_4IN1]: { title: 'Puff Elfbar 4in1 - YouVape', h1: 'Puff Elfbar 4in1' },
  [CAT_PUFFS]: { title: 'Puff rechargeable : à cartouche, grande capacité, 4 saveurs - YouVape', h1: 'Puff rechargeable' },
  [CAT_ECIG]: { title: 'Cigarette électronique : pods, kits box et puffs rechargeables - YouVape', h1: 'Cigarette électronique' },
  [CAT_POD]: { title: 'Pod cigarette électronique : kits pod à cartouche - YouVape', h1: 'Pod cigarette électronique' },
  [PUFF_0MG]: { title: 'Puff sans nicotine - YouVape', h1: 'Puff sans nicotine' },
  [LEX_PUFF]: { title: 'Qu\'est-ce qu\'une puff ? Définition - Lexique YouVape', h1: 'Qu\'est-ce qu\'une Puff ?' },
  // Le lexique « cigarette électronique » AVANT la ligne 3.9 du plan.
  [LEX_ECIG]: { title: 'Cigarette électronique - YouVape', h1: 'Qu\'est-ce qu\'une cigarette électronique ?' },
  [ACCUEIL]: { title: 'Vape shop - YouVape', h1: 'YouVape' },
};
const audit = (url, extra = {}) => ({ url, links: [], word_count: 800, ...PAGES[url], ...extra });
const auditsOf = (...list) => new Map(list.map((a) => [a.url.replace(/\/$/, ''), a]));

// Données Search Console réduites à une requête partagée entre deux pages.
const shared = (query, total, rows) => ({
  q: new Map([[query, total]]),
  byQuery: new Map([[query, rows.sort((a, b) => b.i - a.i)]]),
});
// Aucune ligne « rien à faire » dans une carte.
const noFiller = (text) => assert.doesNotMatch(text, /ne rien|rien à retirer|ne pas le modifier|déjà en place|garder «/);

console.log('Rôle des pages');

test('types : fiche, marque, catégorie, landing page, lexique (title ou H1), étiquette, article, accueil', () => {
  assert.strictEqual(roleOf(KIT_4IN1, audit(KIT_4IN1)), 'fiche produit');
  assert.strictEqual(roleOf(MARQUE, audit(MARQUE)), 'page marque');
  assert.strictEqual(roleOf(CAT_PUFFS, audit(CAT_PUFFS)), 'catégorie');
  assert.strictEqual(roleOf(PUFF_0MG, audit(PUFF_0MG)), 'landing page');
  assert.strictEqual(roleOf(LEX_PUFF, audit(LEX_PUFF)), 'lexique');
  assert.strictEqual(roleOf(LEX_ECIG, audit(LEX_ECIG)), 'lexique'); // reconnu à son H1 « Qu'est-ce qu'une… ? »
  assert.strictEqual(roleOf(TAG_4IN1, audit(TAG_4IN1)), 'étiquette');
  assert.strictEqual(roleOf(ARTICLE_MENTHOL, {}), 'article');
  assert.strictEqual(roleOf(`${SITE}/avis-tests/avis-luxe-xr-max-2-vaporesso`, {}), 'article');
  assert.strictEqual(roleOf(ACCUEIL, audit(ACCUEIL)), 'accueil');
});

test('un title « ne parle que de la requête » : mêmes mots de sujet, ni plus ni moins', () => {
  assert.strictEqual(centeredOn('Cigarette électronique - YouVape', 'cigarette electronique'), true);
  assert.strictEqual(centeredOn('Cigarettes électroniques - YouVape', 'cigarette électronique'), true);
  assert.strictEqual(centeredOn('Puff sans nicotine - YouVape', 'puff'), false);
  assert.strictEqual(centeredOn('Qu\'est-ce qu\'une puff ? Définition - Lexique YouVape', 'puff'), false);
  assert.strictEqual(centeredOn('Toutes les Puffs et recharges de la marque Elfbar - YouVape', 'puff elfbar'), false);
});

console.log('Page de référence');

test('« puff elfbar » → page marque, même quand la fiche a plus de clics', () => {
  const audits = auditsOf(audit(MARQUE), audit(KIT_4IN1));
  const r = chooseReference('puff elfbar', [KIT_4IN1, MARQUE], audits);
  assert.strictEqual(r.main, MARQUE);
  assert.strictEqual(r.why, '« puff elfbar » ne désigne que la marque');
});

test('« elfbar 4 in 1 » → fiche ; « elfbar 4 in 1 recharge » → pack de cartouches', () => {
  const audits = auditsOf(audit(MARQUE), audit(KIT_4IN1), audit(PACK_4IN1));
  assert.strictEqual(chooseReference('elfbar 4 in 1', [MARQUE, KIT_4IN1], audits).main, KIT_4IN1);
  assert.strictEqual(chooseReference('elfbar 4 in 1 recharge', [KIT_4IN1, PACK_4IN1], audits).main, PACK_4IN1);
});

test('« puff » → catégorie, devant la landing page et le lexique', () => {
  const audits = auditsOf(audit(CAT_PUFFS), audit(PUFF_0MG), audit(LEX_PUFF));
  const r = chooseReference('puff', [PUFF_0MG, LEX_PUFF, CAT_PUFFS], audits);
  assert.strictEqual(r.main, CAT_PUFFS);
  assert.strictEqual(r.why, 'les types de produit reviennent à la catégorie');
});

test('« puff sans nicotine » → sa landing page (son adresse), même avec moins de clics', () => {
  const audits = auditsOf(audit(CAT_PUFFS), audit(PUFF_0MG));
  assert.strictEqual(chooseReference('puff sans nicotine', [CAT_PUFFS, PUFF_0MG], audits).main, PUFF_0MG);
});

test('une question → le lexique', () => {
  const audits = auditsOf(audit(CAT_PUFFS), audit(LEX_PUFF));
  assert.strictEqual(chooseReference('qu\'est ce qu\'une puff', [CAT_PUFFS, LEX_PUFF], audits).main, LEX_PUFF);
});

console.log('Consignes par type de page');

test('fiche produit : jamais de title, seulement la phrase et son lien relatif', () => {
  const steps = rivalSteps({ query: 'puff elfbar', main: MARQUE, page: KIT_4IN1, audits: auditsOf(audit(MARQUE), audit(KIT_4IN1)) });
  assert.deepStrictEqual(steps, [
    'Sur /produit/e-cigarettes/kits-ecigarettes/puffs/puff-4in1-elfbar, à la fin de la description du produit, ajouter : <p>Voir aussi : <a href="/marque/elfbar">puff Elfbar</a>.</p>',
  ]);
});

test('fiche produit dont le lien « Elfbar » vers la marque existe : rien à faire', () => {
  const fiche = audit(KIT_4IN1, { links: [{ href: MARQUE, text: 'Elfbar' }] });
  assert.deepStrictEqual(rivalSteps({ query: 'puff elfbar', main: MARQUE, page: KIT_4IN1, audits: auditsOf(audit(MARQUE), fiche) }), []);
});

test('lien existant avec une ancre sans le sujet : l\'ancre à remplacer, mot pour mot', () => {
  const fiche = audit(KIT_4IN1, { links: [{ href: PACK_4IN1, text: '' }] });
  const steps = rivalSteps({ query: 'recharge elfbar 4 en 1', main: PACK_4IN1, page: KIT_4IN1, audits: auditsOf(fiche, audit(PACK_4IN1)) });
  assert.deepStrictEqual(steps, [
    'Sur /produit/e-cigarettes/kits-ecigarettes/puffs/puff-4in1-elfbar : remplacer l\'ancre du lien vers /produit/eliquides/cartouches-pre-remplies/pack-2x-cartouches-4in1-10mg-elfbar (« image sans texte ») par « recharge Elfbar 4 en 1 ».',
  ]);
});

test('lexique dont le title ne parle que de la requête : title recentré sur la définition, puis le lien', () => {
  const steps = rivalSteps({ query: 'cigarette électronique', main: CAT_ECIG, page: LEX_ECIG, audits: auditsOf(audit(CAT_ECIG), audit(LEX_ECIG)) });
  assert.deepStrictEqual(steps, [
    'Title de /cigarette-electronique : remplacer « Cigarette électronique - YouVape » par « Qu\'est-ce qu\'une cigarette électronique ? Définition - Lexique YouVape ».',
    'Sur /cigarette-electronique, à la fin du premier paragraphe, ajouter : <p>Tous les modèles sont regroupés dans notre rayon <a href="/categorie-produit/e-cigarettes">cigarette électronique</a>.</p>',
  ]);
});

test('landing page qui ne parle pas que de la requête (/puff-sans-nicotine sur « puff ») : seulement le lien', () => {
  const steps = rivalSteps({ query: 'puff', main: CAT_PUFFS, page: PUFF_0MG, audits: auditsOf(audit(CAT_PUFFS), audit(PUFF_0MG)) });
  assert.deepStrictEqual(steps, [
    'Sur /puff-sans-nicotine, à la fin du premier paragraphe, ajouter : <p>Tous les modèles sont regroupés dans notre rayon <a href="/categorie-produit/e-cigarettes/kits-ecigarettes/puffs">puff</a>.</p>',
  ]);
});

test('page cible décidée (/puff-sans-nicotine, « page à protéger ») : jamais modifiée', () => {
  const steps = rivalSteps({ query: 'puff', main: CAT_PUFFS, page: PUFF_0MG, audits: auditsOf(audit(CAT_PUFFS), audit(PUFF_0MG)), protectedUrls: new Set([PUFF_0MG]) });
  assert.deepStrictEqual(steps, []);
});

test('landing page qui ne parle que de la requête : title à réécrire dans Rédaction SEO', () => {
  const POD = `${SITE}/pod-cigarette`;
  const steps = rivalSteps({ query: 'pod', main: CAT_POD, page: POD, audits: auditsOf(audit(CAT_POD), { url: POD, title: 'Pod - YouVape', h1: 'Pod', links: [{ href: CAT_POD, text: 'pods' }] }) });
  assert.deepStrictEqual(steps, [
    'Title de /pod-cigarette : « Pod - YouVape » ne parle que de « pod », que porte /categorie-produit/e-cigarettes/kits-ecigarettes/kits-format-pod. Le réécrire dans l\'onglet Rédaction SEO, sur le thème de son adresse.',
  ]);
});

test('étiquette qui ne parle que de la requête : noindex, et pas de lien à ajouter', () => {
  const steps = rivalSteps({ query: 'puff elfbar 4in1', main: KIT_4IN1, page: TAG_4IN1, audits: auditsOf(audit(KIT_4IN1), audit(TAG_4IN1)) });
  assert.deepStrictEqual(steps, [
    'Yoast > réglages de l\'étiquette /etiquette-produit/puff-elfbar-4in1 : passer en noindex, follow. Son title, « Puff Elfbar 4in1 - YouVape », ne parle que de « puff elfbar 4in1 », que porte /produit/e-cigarettes/kits-ecigarettes/puffs/puff-4in1-elfbar.',
  ]);
});

test('accueil et page marque : jamais de title, même centré sur la requête', () => {
  const home = rivalSteps({ query: 'vape shop', main: CAT_ECIG, page: ACCUEIL, audits: auditsOf(audit(CAT_ECIG), audit(ACCUEIL)) });
  assert.strictEqual(home.length, 1);
  assert.match(home[0], /^Sur \/, dans le bloc de texte du bas de l’accueil, ajouter : /);
  const marque = rivalSteps({ query: 'elfbar', main: KIT_4IN1, page: MARQUE, audits: auditsOf(audit(KIT_4IN1), audit(MARQUE, { title: 'Elfbar - YouVape' })) });
  assert.doesNotMatch(marque.join(' '), /Title de/);
});

console.log('Cartes');

test('« puff elfbar » : carte page marque + phrase pour la fiche, sans texte inutile', () => {
  const data = shared('puff elfbar', { c: 7, i: 476, p: 7.1 }, [
    { page: MARQUE, c: 2, i: 260, p: 6.5 },
    { page: KIT_4IN1, c: 5, i: 216, p: 7.8 },
  ]);
  const [rec] = detectCannibalisation(data, auditsOf(audit(MARQUE), audit(KIT_4IN1)));
  assert.strictEqual(rec.action, [
    '1. Page de référence : /marque/elfbar (page marque, « puff elfbar » ne désigne que la marque).',
    '2. Sur /produit/e-cigarettes/kits-ecigarettes/puffs/puff-4in1-elfbar, à la fin de la description du produit, ajouter : <p>Voir aussi : <a href="/marque/elfbar">puff Elfbar</a>.</p>',
  ].join('\n\n'));
  noFiller(rec.action);
});

test('rien à faire (le lien « Elfbar » existe) : pas de carte du tout', () => {
  const data = shared('puff elfbar', { c: 7, i: 476, p: 7.1 }, [
    { page: MARQUE, c: 2, i: 260, p: 6.5 },
    { page: KIT_4IN1, c: 5, i: 216, p: 7.8 },
  ]);
  const fiche = audit(KIT_4IN1, { links: [{ href: MARQUE, text: 'Elfbar' }] });
  assert.deepStrictEqual(detectCannibalisation(data, auditsOf(audit(MARQUE), fiche)), []);
});

test('page cible décidée en face : pas de carte', () => {
  const data = shared('puff', { c: 30, i: 5000, p: 9 }, [
    { page: PUFF_0MG, c: 20, i: 2600, p: 8 },
    { page: CAT_PUFFS, c: 10, i: 2400, p: 10 },
  ]);
  assert.deepStrictEqual(detectCannibalisation(data, auditsOf(audit(CAT_PUFFS), audit(PUFF_0MG)), [], new Set([PUFF_0MG])), []);
});

console.log('Fiches et marque');

test('mots propres d\'une fiche : marque, modèle, type de produit (recharge = cartouche)', () => {
  assert.strictEqual(ownsQuery('puff elfbar', audit(KIT_4IN1)), true);
  assert.strictEqual(ownsQuery('elfbar 4 in 1', audit(KIT_4IN1)), true);
  assert.strictEqual(ownsQuery('elfbar 3 in 1', audit(KIT_4IN1)), false);
  assert.strictEqual(ownsQuery('elfa pro', audit(ELFA_20MG)), true);
  assert.strictEqual(ownsQuery('recharge elfbar 4 en 1', audit(PACK_4IN1)), true);
  assert.strictEqual(ownsQuery('recharge elfbar 4 en 1', audit(KIT_4IN1)), false);
  assert.strictEqual(ownsQuery('pod cigarette electronique', audit(ELFX)), false);
  assert.strictEqual(ownsQuery('elfbar', audit(MARQUE)), false);
});

test('requêtes « marque » : marque seule ou avec puff, recharge, rechargeable, france', () => {
  for (const q of ['elfbar', 'elf bar', 'puff elfbar', 'elf bar puff', 'elfbar rechargeable', 'recharge elfbar', 'cartouche elfbar', 'elfbar france']) {
    assert.strictEqual(isBrandQuery(q, 'elfbar'), true, q);
  }
  for (const q of ['elfbar 4 in 1', 'elfbar sans nicotine', 'elfa pro', 'elfbar prix']) {
    assert.strictEqual(isBrandQuery(q, 'elfbar'), false, q);
  }
});

test('marque dont le nom contient « vape » : « Geek Vape », « puff Lost Vape » sont des requêtes marque', () => {
  assert.strictEqual(isBrandQuery('Geek Vape', 'geekvape'), true);
  assert.strictEqual(isBrandQuery('puff lost vape', 'lost-vape'), true);
  assert.strictEqual(isBrandQuery('geek vape aegis solo 5', 'geekvape'), false);
});

test('la marque se lit dans les données structurées (Product.brand), même avec @graph ou un bloc illisible', () => {
  const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
  assert.strictEqual(brandFromJsonLd(ld({ '@type': 'Product', name: 'Puff 4in1', brand: { '@type': 'Brand', name: 'Elfbar' } })), 'Elfbar');
  assert.strictEqual(brandFromJsonLd(ld({ '@graph': [{ '@type': 'WebPage' }, { '@type': ['Product'], brand: 'Aspire' }] })), 'Aspire');
  assert.strictEqual(brandFromJsonLd(ld({ '@type': 'WebPage' })), null);
  const broken = '<script type="application/ld+json">{"@type": "Product", "description": "ligne 1\nligne 2",\n "brand": {\n "@type": "Brand",\n "name": "Elfbar"\n }}</script>';
  assert.strictEqual(brandFromJsonLd(broken), 'Elfbar');
});

test('brandOf : relevé d\'abord, adresse ensuite, jamais un taux de nicotine', () => {
  const audits = auditsOf(audit(ELFX), { url: `${SITE}/produit/x/kit-tlx-kiwi-vapor`, brand: 'Kiwi Vapor' });
  assert.strictEqual(brandOf(ELFX, audits), 'elfbar'); // l'adresse dit « elbar »
  assert.strictEqual(brandOf(`${SITE}/produit/x/kit-tlx-kiwi-vapor`, audits), 'kiwi-vapor');
  assert.strictEqual(brandOf(ELFA_0MG, new Map()), null); // « 0mg » n'est pas une marque
  assert.strictEqual(brandOf(`${SITE}/produit/x/pod-vprime-2-oxva`, new Map()), 'oxva');
});

console.log('Liens et intertitres');

test('pas de lien depuis /marque/elfbar vers l\'article « menthol » : la page source doit parler du sujet', () => {
  const data = {
    byQuery: new Map([
      ['menthol cigarette', [{ page: ARTICLE_MENTHOL, c: 0, i: 206, p: 5.2 }]],
      ['elfbar menthol', [{ page: MARQUE, c: 2, i: 300, p: 8 }, { page: BOSTON, c: 1, i: 40, p: 9 }]],
    ]),
  };
  assert.deepStrictEqual(relatedSources(data, 'menthol cigarette', ARTICLE_MENTHOL, auditsOf(audit(MARQUE))), [BOSTON]);
});

console.log('Liens et ancres existants');

const { extractLinks, linkFixes, linkFixLine, detectLiens, productTables, countProductTables, introOf, h2sOf, mentions } = advisor;
const { titleLeadsWith, containsQuery } = require('../src/services/seoPilotService');
const ELFA_PACK_0MG = `${SITE}/produit/eliquides/cartouches-pre-remplies/pack-x2-cartouches-puff-elfa-pro-0mg`;
const ELFX_CART = `${SITE}/produit/e-cigarettes/composants/cartouches-pods/cartouche-elfx-mega-elfbar`;
const TAG_JNR = `${SITE}/etiquette-produit/puff-jnr`;
// /marque/elfbar le 27/10/2026 : la catégorie puffs liée 5 fois dans le bas de page.
const GAMMES = { href: CAT_PUFFS, text: 'puff', texts: ['puff', 'Elfbar ELFA / ELFA Pro', 'Elfbar 4 en 1', 'Elfbar grande capacité', 'puffs'], count: 5 };
const elfbarAudits = (marqueExtra = {}) => auditsOf(
  audit(MARQUE, { http_status: 200, links: [GAMMES], ...marqueExtra }),
  audit(KIT_4IN1, { http_status: 200 }), audit(PACK_4IN1, { http_status: 200 }),
  audit(ELFA_0MG, { http_status: 200 }), audit(ELFA_20MG, { http_status: 200 }), audit(CAT_PUFFS, { http_status: 200 }),
);
const STATS = new Map([[KIT_4IN1, { i: 3053 }], [PACK_4IN1, { i: 156 }], [ELFA_0MG, { i: 900 }], [ELFA_20MG, { i: 500 }]]);

test('relevé des liens : une entrée par adresse, avec le nombre de liens et toutes les ancres', () => {
  const html = '<p><a href="/categorie-produit/e-cigarettes/kits-ecigarettes/puffs">puff</a> <a href="https://www.youvape.fr/categorie-produit/e-cigarettes/kits-ecigarettes/puffs/"><img src="x.png"></a>'
    + ' <a href="/categorie-produit/e-cigarettes/kits-ecigarettes/puffs">Elfbar 4 en 1</a> <a href="/categorie-produit/e-cigarettes/kits-ecigarettes/puffs">puff</a></p>';
  assert.deepStrictEqual(extractLinks(html), [{ href: CAT_PUFFS, text: 'puff', texts: ['puff', 'Elfbar 4 en 1'], count: 4 }]);
});

test('tableau « Gammes Elfbar » : chaque ancre qui nomme un modèle vers sa fiche, rien pour « puff » ni « grande capacité »', () => {
  const fixes = linkFixes(MARQUE, elfbarAudits(), [], STATS);
  assert.deepStrictEqual(fixes.map((f) => [f.text, f.to]), [
    ['Elfbar ELFA / ELFA Pro', ELFA_0MG], // la fiche Elfa Pro la plus vue
    ['Elfbar 4 en 1', KIT_4IN1], // le kit, pas le pack de recharges
  ]);
});

test('une page cible décidée l\'emporte sur la fiche la plus vue', () => {
  const decided = [{ re: /elfa \/ elfa pro/i, url: ELFA_20MG }];
  const fix = linkFixes(MARQUE, elfbarAudits(), decided, STATS).find((f) => f.text === 'Elfbar ELFA / ELFA Pro');
  assert.deepStrictEqual([fix.to, fix.decided], [ELFA_20MG, true]);
});

test('lien vers la page consacrée à son ancre (« Puffs JNR » → /etiquette-produit/puff-jnr) : jamais signalé', () => {
  const audits = auditsOf(
    audit(MARQUE, { http_status: 200, links: [{ href: TAG_JNR, text: 'Puffs JNR', texts: ['Puffs JNR'], count: 1 }] }),
    { url: `${SITE}/marque/jnr`, title: 'JNR - YouVape', http_status: 200 },
    { url: `${SITE}/produit/e-cigarettes/kits-ecigarettes/puffs/puff-jnr-falcon-x-jnr`, title: 'Puff JNR Falcon X - YouVape', h1: 'Puff JNR Falcon X - JNR', brand: 'JNR', http_status: 200 },
  );
  assert.deepStrictEqual(linkFixes(MARQUE, audits, [], new Map()), []);
});

// /marque/jnr le 28/10/2026 : liens vers la version avec nicotine et vers
// l'étiquette du modèle (titles relevés en ligne ; la Meteorite sans marque relevée).
const MARQUE_JNR = `${SITE}/marque/jnr`;
const METEORITE = `${SITE}/produit/e-cigarettes/kits-ecigarettes/puffs/puff-jnr-meteorite`;
const METEORITE_0 = `${SITE}/produit/e-cigarettes/kits-ecigarettes/puffs/puff-jnr-meteorite-sans-nicotine`;
const GORILLA = `${SITE}/produit/e-cigarettes/kits-ecigarettes/puffs/puff-gorilla-x-jnr`;
const GORILLA_0 = `${SITE}/produit/e-cigarettes/kits-ecigarettes/puffs/puff-jnr-gorilla-x-sans-nicotine`;
const TAG_GORILLA = `${SITE}/etiquette-produit/jnr-gorilla-x-43k`;

test('lien vers une autre version du modèle ou vers son étiquette : jamais signalé (JNR avec / sans nicotine)', () => {
  const audits = auditsOf(
    { url: MARQUE_JNR, title: 'JNR - YouVape', http_status: 200, links: [
      { href: METEORITE, text: 'Puff JNR Meteorite 100k', texts: ['Puff JNR Meteorite 100k'], count: 1 },
      { href: GORILLA, text: 'Puff JNR Gorilla X 43k', texts: ['Puff JNR Gorilla X 43k'], count: 2 },
      { href: TAG_GORILLA, text: 'JNR Gorilla X', texts: ['JNR Gorilla X'], count: 1 },
    ] },
    { url: METEORITE, title: 'Puff JNR Meteorite 100k par JNR - Compacte et autonome - YouVape', http_status: 200 },
    { url: METEORITE_0, title: 'Puff JNR Meteorite 100k Sans Nicotine par JNR - YouVape', brand: 'JNR', http_status: 200 },
    { url: GORILLA, title: 'Puff JNR Gorilla X 43k JNR, la puff la plus durable - YouVape', brand: 'JNR', http_status: 200 },
    { url: GORILLA_0, title: 'Puff JNR Gorilla X 43k sans Nicotine JNR - YouVape', brand: 'JNR', http_status: 200 },
    { url: TAG_GORILLA, title: 'JNR Gorilla X 43K : Puff Rechargeable avec ou sans Nicotine', http_status: 200 },
  );
  const stats = new Map([[METEORITE_0, { i: 2000 }], [METEORITE, { i: 300 }], [GORILLA_0, { i: 1800 }], [GORILLA, { i: 400 }]]);
  assert.deepStrictEqual(linkFixes(MARQUE_JNR, audits, [], stats), []);
});

test('nom de marque seul : la page marque, jamais une fiche (Geek Vape, Lost Vape, Starbuzz)', () => {
  const TOP10 = `${SITE}/top-10-cigarette-electronique`;
  const MARQUE_GEEK = `${SITE}/marque/geekvape`;
  const MARQUE_STARBUZZ = `${SITE}/marque/starbuzz`;
  const TAG_STARBUZZ = `${SITE}/etiquette-produit/puff-starbuzz`;
  const Z_TANK = `${SITE}/produit/e-cigarettes/composants/clearomiseurs/z-subohm-5-tank-geekvape`;
  const CENTAURUS = `${SITE}/produit/e-cigarettes/composants/box-batteries-electroniques/box-centaurus-bt200-lost-vape`;
  const audits = auditsOf(
    { url: TOP10, title: 'Top 10 cigarette électronique - YouVape', http_status: 200, links: [
      { href: MARQUE_GEEK, text: 'Geek Vape', texts: ['Geek Vape'], count: 3 },
      { href: `${SITE}/etiquette-produit/lost-vape-le-bar-40k`, text: 'Lost Vape', texts: ['Lost Vape'], count: 2 },
      { href: TAG_STARBUZZ, text: 'Starbuzz', texts: ['Starbuzz'], count: 1 },
    ] },
    { url: MARQUE_GEEK, title: 'GeekVape : box, clearomiseurs et résistances - YouVape', http_status: 200 },
    { url: Z_TANK, title: 'Clearomiseur Z Subohm 5 Tank par Geekvape - YouVape', brand: 'Geekvape', http_status: 200 },
    // Pas de page marque Lost Vape relevée : on ne devine pas.
    { url: CENTAURUS, title: 'Box Centaurus BT200 par Lost Vape - YouVape', brand: 'Lost Vape', http_status: 200 },
    { url: MARQUE_STARBUZZ, title: 'Starbuzz - YouVape', http_status: 200 },
  );
  const stats = new Map([[Z_TANK, { i: 5000 }], [CENTAURUS, { i: 4000 }]]);
  const fixes = linkFixes(TOP10, audits, [], stats);
  assert.deepStrictEqual(fixes.map((f) => [f.text, f.to]), [['Starbuzz', MARQUE_STARBUZZ]]);
  assert.strictEqual(linkFixLine(fixes[0]), 'Lien « Starbuzz » : remplacer /etiquette-produit/puff-starbuzz par /marque/starbuzz (la page de la marque).');
});

test('sous-marque : sa page sous la marque mère, jamais le doublon non canonique (/marque/tornado)', () => {
  const SOUS_MARQUE = `${SITE}/marque/white-rabbit-2/tornado`;
  const LANDING = `${SITE}/eliquides-tornado-white-rabbit`;
  const audits = auditsOf(
    { url: LANDING, title: 'E-liquides Tornado White Rabbit - YouVape', http_status: 200, links: [
      { href: SOUS_MARQUE, text: 'Puffs Tornado', texts: ['Puffs Tornado'], count: 1 },
      { href: `${SITE}/etiquette-produit/puff-tornado`, text: 'Tornado', texts: ['Tornado'], count: 1 },
    ] },
    { url: SOUS_MARQUE, title: 'Tornado - YouVape', http_status: 200, canonical: SOUS_MARQUE },
    { url: `${SITE}/marque/tornado`, title: 'Tornado - YouVape', http_status: 200, canonical: SOUS_MARQUE },
  );
  assert.deepStrictEqual(linkFixes(LANDING, audits, [], new Map()).map((f) => [f.text, f.to]), [['Tornado', SOUS_MARQUE]]);
});

test('page cible décidée : l\'emporte aussi sur une autre version du modèle', () => {
  const audits = elfbarAudits({ links: [{ href: ELFA_20MG, text: 'Elfbar Elfa Pro', texts: ['Elfbar Elfa Pro'], count: 1 }] });
  const decided = [{ re: /elfa pro/, url: ELFA_0MG }];
  assert.deepStrictEqual(linkFixes(MARQUE, audits, decided, STATS).map((f) => [f.text, f.to, f.decided]), [['Elfbar Elfa Pro', ELFA_0MG, true]]);
  // Sans décision, la fiche 20 mg est un bon lien.
  assert.deepStrictEqual(linkFixes(MARQUE, audits, [], STATS), []);
});

test('relevé de l\'intro (bloc .subtitle du thème) et des H2 du contenu, sans bandeau ni pied de page', () => {
  const html = '<div class="age-gate"><p>En entrant sur ce site, je reconnais être majeur(e).</p></div>'
    + '<script type="text/template"><p>Désolé, ce produit n’est pas disponible.</p><h2>Modèle</h2></script>'
    + '<h1>Elfbar, le spécialiste de la puff</h1><div class="subtitle"><p>Découvrez les puffs de Elfbar, et leurs recharges.</p></div>'
    + '<h2>La marque Elfbar</h2><h2>Gammes Elfbar <span>disponibles</span> chez YouVape</h2><h2>Top 10 &#8211; Puffs</h2><footer><h2>Newsletter</h2></footer>';
  assert.strictEqual(introOf(html), 'Découvrez les puffs de Elfbar, et leurs recharges.');
  assert.deepStrictEqual(h2sOf(html), ['La marque Elfbar', 'Gammes Elfbar disponibles chez YouVape', 'Top 10 – Puffs']);
  assert.strictEqual(introOf('<h1>Puff</h1><p>Texte</p>'), '');
});

test('l\'intro emploie-t-elle la recherche : mots collés ou non, singulier, cartouche = recharge, 4in1 = 4 in 1', () => {
  assert.strictEqual(mentions('Repérez la résistance dont vous avez besoin pour votre pod GeekVape.', 'resistance geek vape'), true);
  assert.strictEqual(mentions('Les cartouches de la Puff 4in1', 'recharge elfbar 4 in 1'), false); // pas « elfbar »
  assert.strictEqual(mentions('Les cartouches Elfbar de la Puff 4in1', 'recharge elfbar 4 in 1'), true);
  assert.strictEqual(mentions('Découvrez les Geek Vape Aegis', 'geekvape'), true);
  assert.strictEqual(mentions('Découvrez nos puffs rechargeables', 'elfbar'), false);
});

test('title d\'une page cible : le type de produit et le conditionnement peuvent précéder la recherche', () => {
  assert.strictEqual(titleLeadsWith('Puff Elfa Pro sans Nicotine (2 cartouches, 4ml) par Elfbar - YouVape', 'elfa pro'), true);
  assert.strictEqual(titleLeadsWith('Pack x2 Cartouches Elfa Pro 0mg Elfbar sans nicotine - YouVape', 'cartouche elfa'), true);
  assert.strictEqual(titleLeadsWith('Pack 2x Cartouches 4in1 10mg/ml par Elfbar - YouVape', 'recharge elfbar 4 in 1'), false);
  // Le title de la ligne 3.7 du plan, une fois en ligne : plus rien à demander.
  assert.strictEqual(titleLeadsWith('Recharges Elfbar 4in1 10 mg/ml : pack de 2 cartouches - YouVape', 'recharge elfbar 4 in 1'), true);
  assert.strictEqual(titleLeadsWith('Magasin de cigarette électronique à Montpellier - YouVape', 'magasin cigarette électronique'), true);
  assert.strictEqual(titleLeadsWith('Cigarette électronique : pods, kits box et puffs - YouVape', 'puff'), false);
  assert.strictEqual(containsQuery('Pack 2x Cartouches 4in1 10mg/ml - Elfbar', 'recharge elfbar 4 in 1'), true);
});

test('carte « Liens à corriger » : chaque lien écrit mot pour mot, sans texte inutile', () => {
  const recs = detectLiens({ q: new Map([['elfbar 4 en 1', { i: 145 }]]), pageStats: STATS }, elfbarAudits(), []);
  assert.strictEqual(recs.length, 1);
  assert.strictEqual(recs[0].action, [
    '1. Lien « Elfbar ELFA / ELFA Pro » : remplacer /categorie-produit/e-cigarettes/kits-ecigarettes/puffs par /produit/e-cigarettes/kits-ecigarettes/puffs/puff-elfa-pro-0mg (la fiche du produit) ; la page a 5 liens vers /categorie-produit/e-cigarettes/kits-ecigarettes/puffs, Google ne retient que le premier.',
    '2. Lien « Elfbar 4 en 1 » : remplacer /categorie-produit/e-cigarettes/kits-ecigarettes/puffs par /produit/e-cigarettes/kits-ecigarettes/puffs/puff-4in1-elfbar (la fiche du produit) ; la page a 5 liens vers /categorie-produit/e-cigarettes/kits-ecigarettes/puffs, Google ne retient que le premier.',
  ].join('\n\n'));
  noFiller(recs[0].action);
});

test('tableau déjà en place : le thème rend chaque [product_table] en .yv-product-table__grid', () => {
  assert.strictEqual(countProductTables('<div class="yv-product-table"><table class="yv-product-table__grid"></table></div><table class="yv-product-table__grid">'), 2);
  assert.strictEqual(countProductTables('<table style="width: 100%">'), 0);
});

// « elfbar » et sa variante « elfbar recharge » sur /marque/elfbar.
const TEXTE_ELFBAR = {
  q: new Map([['elfbar', { c: 45, i: 3500, p: 7.2 }], ['elfbar recharge', { c: 13, i: 633, p: 10.1 }]]),
  byQuery: new Map([['elfbar', [{ page: MARQUE, c: 45, i: 3500, p: 7.2 }]], ['elfbar recharge', [{ page: MARQUE, c: 13, i: 633, p: 10.1 }]]]),
  pageStats: new Map(),
};

// Tests asynchrones : lancés à la suite, puis le bilan.
const asyncTests = [
  ['tableaux de /marque/elfbar : une section par catégorie, la marque de la page, les plus vendus en tête', async () => {
    const audits = elfbarAudits();
    const groups = await productTables(MARQUE, [KIT_4IN1, ELFA_0MG, ELFA_20MG, PACK_4IN1, ELFA_PACK_0MG, ELFX_CART], audits);
    assert.deepStrictEqual(groups.map((g) => g.h3), ['Puffs rechargeables Elfbar', 'Cartouches préremplies Elfbar', 'Cartouches pods Elfbar']);
    assert.strictEqual(groups[0].shortcode, '[product_table brand="elfbar" category="puffs" columns="name,autonomie,contenance,taux-de-nicotine" headers="Modèle,Batterie,Réservoir,Nicotine" orderby="popularity"]');
    assert.strictEqual(groups[1].shortcode, '[product_table brand="elfbar" category="cartouches-pre-remplies" columns="name,contenance,taux-de-nicotine,compatibilite" headers="Référence,Contenance,Nicotine,Compatible avec" orderby="popularity"]');
  }],
  ['carte « Texte » : les tableaux à coller quand la page n\'en a aucun ; rien quand elle en a déjà', async () => {
    const data = {
      q: new Map([['elfbar', { c: 45, i: 3500, p: 7.2 }], ['elfbar recharge', { c: 13, i: 633, p: 10.1 }]]),
      byQuery: new Map([['elfbar', [{ page: MARQUE, c: 45, i: 3500, p: 7.2 }]], ['elfbar recharge', [{ page: MARQUE, c: 13, i: 633, p: 10.1 }]]]),
      pageStats: new Map(),
    };
    const products = [KIT_4IN1, ELFA_0MG].map((href) => ({ href, text: '', texts: [], count: 1 }));
    const [sans] = await detectTexte(data, elfbarAudits({ links: products, product_tables: 0 }), new Map());
    assert.match(sans.action, /Tableaux des produits : coller ce bloc dans le texte du bas de page :\n<h3>Puffs rechargeables Elfbar<\/h3>\n\[product_table brand="elfbar" category="puffs" /);
    const [avec] = await detectTexte(data, elfbarAudits({ links: products, product_tables: 2 }), new Map());
    assert.doesNotMatch(avec.action, /product_table/);
  }],
  ['« elfbar recharge » et « recharge elfbar » : un seul H2, et pas de « title à garder »', async () => {
    const recs = await detectTexte({
      q: new Map([
        ['elfbar', { c: 45, i: 3500, p: 7.2 }],
        ['elfbar recharge', { c: 13, i: 633, p: 10.1 }],
        ['recharge elfbar', { c: 7, i: 304, p: 11.3 }],
        ['puff elfbar', { c: 7, i: 476, p: 7.1 }],
      ]),
      byQuery: new Map([
        ['elfbar', [{ page: MARQUE, c: 45, i: 3500, p: 7.2 }]],
        ['elfbar recharge', [{ page: MARQUE, c: 13, i: 633, p: 10.1 }]],
        ['recharge elfbar', [{ page: MARQUE, c: 7, i: 304, p: 11.3 }]],
        ['puff elfbar', [{ page: MARQUE, c: 7, i: 476, p: 7.1 }]],
      ]),
      pageStats: new Map(),
    }, auditsOf(audit(MARQUE)), new Map());
    const rec = recs.find((r) => r.rec_key === `texte:${MARQUE}`);
    assert.ok(rec, 'carte « texte » de /marque/elfbar attendue');
    assert.match(rec.action, /intertitres \(H2\) sur : « Elfbar recharge »\./);
    assert.doesNotMatch(rec.action, /« Recharge elfbar »/);
    noFiller(rec.action);
  }],
  ['carte « Texte » : intro qui nomme déjà la marque, H2 « Recharges » et tableaux en place → pas de carte', async () => {
    const audits = auditsOf(audit(MARQUE, {
      intro: 'Découvrez les puffs de Elfbar, et leurs recharges Elbar.', h2s: ['La marque Elfbar', 'Recharges Elfbar et cartouches'], product_tables: 2,
    }));
    const recs = await detectTexte(TEXTE_ELFBAR, audits, new Map());
    assert.strictEqual(recs.find((r) => r.rec_key === `texte:${MARQUE}`), undefined);
  }],
  ['intertitres des tableaux : la marque des fiches ou de l\'adresse, jamais du H1 (« E-liquides Atelier Just » donnait « E »)', async () => {
    const AJ = `${SITE}/marque/atelier-just`;
    const CONCENTRE = `${SITE}/produit/diy/concentres/concentres-grands-formats/concentre-x-maison-fuel`;
    const audits = auditsOf(
      { url: AJ, title: 'Atelier Just - YouVape', h1: 'E-liquides Atelier Just', http_status: 200 },
      { url: CONCENTRE, title: 'Concentré X - YouVape', brand: 'Maison Fuel', http_status: 200 }, // sous-marque
    );
    assert.deepStrictEqual((await productTables(AJ, [CONCENTRE], audits)).map((g) => g.h3), ['Concentrés grands formats Atelier Just']);
    const YV = `${SITE}/marque/youvape`;
    const PACK = `${SITE}/produit/e-cigarettes/kits-ecigarettes/packs-youvape/pack-decouverte`;
    const yv = auditsOf({ url: YV, title: 'YouVape', http_status: 200 }, { url: PACK, title: 'Pack découverte', brand: 'YouVape', http_status: 200 });
    assert.deepStrictEqual((await productTables(YV, [PACK], yv)).map((g) => g.h3), ['Packs YouVape']); // pas « Packs YouVape YouVape »
  }],
  ['page dont le title n\'a jamais été lu (redirigée) : pas de carte « Texte » à l\'aveugle', async () => {
    const recs = await detectTexte(TEXTE_ELFBAR, auditsOf({ url: MARQUE, http_status: 301, title: null, links: [] }), new Map());
    assert.deepStrictEqual(recs, []);
  }],
  ['« canapuff france », « kiwi vapor site officiel » : ni variante de title ni intertitre (YouVape n\'est pas le site de la marque)', async () => {
    const CANAPUFF = `${SITE}/marque/canapuff`;
    const data = {
      q: new Map([['canapuff', { c: 60, i: 2400, p: 6.1 }], ['canapuff france', { c: 9, i: 256, p: 7.4 }], ['canapuff site officiel', { c: 5, i: 180, p: 8 }]]),
      byQuery: new Map([
        ['canapuff', [{ page: CANAPUFF, c: 60, i: 2400, p: 6.1 }]],
        ['canapuff france', [{ page: CANAPUFF, c: 9, i: 256, p: 7.4 }]],
        ['canapuff site officiel', [{ page: CANAPUFF, c: 5, i: 180, p: 8 }]],
      ]),
      pageStats: new Map(),
    };
    const audits = auditsOf({
      url: CANAPUFF, title: 'Canapuff - Puffs et cartouches de cannabinoïdes à vapoter - YouVape', h1: 'Canapuff', links: [], word_count: 800,
      intro: 'Découvrez les puffs Canapuff.', h2s: ['La marque Canapuff'], product_tables: 1,
    });
    const recs = await detectTexte(data, audits, new Map());
    for (const r of recs) assert.doesNotMatch(r.action, /france|officiel|« site »/i, r.action);
  }],
  ['carte « Texte » : l\'intro sans la recherche → ce qu\'il faut y mettre, avec la phrase actuelle', async () => {
    const audits = auditsOf(audit(MARQUE, { intro: 'Découvrez nos puffs rechargeables et leurs recharges.', h2s: ['La marque'], product_tables: 2 }));
    const [rec] = await detectTexte(TEXTE_ELFBAR, audits, new Map());
    assert.match(rec.action, /Texte : mettre « elfbar » dans l'intro \(aujourd'hui « Découvrez nos puffs rechargeables et leurs recharges\. »\), et ajouter des intertitres \(H2\) sur : « Elfbar recharge »\./);
    assert.doesNotMatch(rec.action, /vérifier/);
    noFiller(rec.action);
  }],
];

(async () => {
  for (const [name, fn] of asyncTests) {
    try {
      await fn();
      console.log(`  ok   ${name}`);
    } catch (err) {
      failures++;
      console.error(`  FAIL ${name}\n       ${err.message}`);
    }
  }
  console.log(failures === 0 ? '\nTous les tests passent.' : `\n${failures} test(s) en échec.`);
  process.exit(failures === 0 ? 0 : 1);
})();
