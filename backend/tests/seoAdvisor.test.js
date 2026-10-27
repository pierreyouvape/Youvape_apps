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

const h2Test = detectTexte({
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
}, auditsOf(audit(MARQUE)), new Map()).then(
  (recs) => {
    const rec = recs.find((r) => r.rec_key === `texte:${MARQUE}`);
    assert.ok(rec, 'carte « texte » de /marque/elfbar attendue');
    assert.match(rec.action, /intertitres \(H2\) sur : « Elfbar recharge »\./);
    assert.doesNotMatch(rec.action, /« Recharge elfbar »/);
    noFiller(rec.action);
    console.log('  ok   « elfbar recharge » et « recharge elfbar » : un seul H2, et pas de « title à garder »');
  },
  (err) => { failures++; console.error(`  FAIL intertitres\n       ${err.message}`); }
);

h2Test.then(() => {
  console.log(failures === 0 ? '\nTous les tests passent.' : `\n${failures} test(s) en échec.`);
  process.exit(failures === 0 ? 0 : 1);
});
