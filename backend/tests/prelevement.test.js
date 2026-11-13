/**
 * Banc des prélèvements boutique : `node tests/prelevement.test.js` (ou `npm test`).
 *
 * Couvert : coût d'achat figé, pièces boutique (résistances à l'unité), fiche
 * Nextore créée depuis le site, codes-barres à ajouter, choix du produit caisse,
 * annulation (ce qui se défait, ce qui ne part pas, ce qui est refusé).
 */

const assert = require('assert');
const {
  siteUnitCost, boutiqueQty, nextoreProductPayload, splitBarcodes, barcodesToAdd, resolveNx, isCleanRefusal, cancelPlan, allocateSales,
} = require('../src/services/prelevementRules');

// ── Coût d'achat du site : même règle que la valeur de stock ────────────────
assert.strictEqual(siteUnitCost({ computed_cost: '3.12345', wc_cog_cost: '9' }), 3.1235, 'PMP d\'abord, 4 décimales');
assert.strictEqual(siteUnitCost({ computed_cost: null, wc_cog_cost: '2.5' }), 2.5, 'repli sur le coût WC');
assert.strictEqual(siteUnitCost({ computed_cost: '0', wc_cog_cost: null }), null, 'coût nul = inconnu');

// ── Pièces boutique ─────────────────────────────────────────────────────────
const resistance = { category_name: 'RESISTANCES' };
assert.strictEqual(boutiqueQty(2, 'Pack 5 résistances Zenith 0.4', resistance), 10, 'résistances : 2 packs de 5 = 10 pièces');
assert.strictEqual(boutiqueQty(2, 'Pack 5 cartouches Xros', { category_name: 'CARTOUCHES' }), 2, 'cartouches : à la boîte');
assert.strictEqual(boutiqueQty(3, 'Fruizee 50ml', null), 3, 'sans produit caisse : 1 pour 1');

// ── Fiche créée dans la caisse ──────────────────────────────────────────────
const site = { name: 'Flacon Unicorn V3 10ml', regular_price: '1.50', price: '1.20', computed_cost: '0.31', wp_product_id: 4242 };
const payload = nextoreProductPayload(site, { categoryId: 12, barcodes: ['3700000000011', '3700000000028'] });
assert.deepStrictEqual(payload, {
  name: 'Flacon Unicorn V3 10ml', price: 1.5, cost: 0.31, category_id: '12', tax_rate: '4', type: 'standard',
  barcode: '3700000000011;3700000000028', link_code: '4242',
}, 'prix normal du site (pas la promo), TVA 20 % = code 4');
assert.strictEqual(nextoreProductPayload({ ...site, regular_price: '' }, { categoryId: 1, barcodes: [] }).price, 1.2, 'sans prix normal : prix courant');
assert.throws(() => nextoreProductPayload({ ...site, regular_price: '0', price: '0' }, { categoryId: 1, barcodes: [] }), /sans prix/);
assert.throws(() => nextoreProductPayload(site, { categoryId: '', barcodes: [] }), /catégorie/);

// ── Codes-barres ────────────────────────────────────────────────────────────
assert.deepStrictEqual(splitBarcodes('123; 456;;789'), ['123', '456', '789']);
assert.deepStrictEqual(barcodesToAdd('111;222', ['222', '333', '333']), ['333'], 'seulement ceux qui manquent, sans doublon');
assert.deepStrictEqual(barcodesToAdd(null, ['111']), ['111']);

// ── Produit caisse ──────────────────────────────────────────────────────────
assert.deepStrictEqual(resolveNx({ nx_product_id: '9', source: 'manual' }, ['1', '2']), { nxProductId: '9', how: 'manual' }, 'le lien enregistré prime');
assert.deepStrictEqual(resolveNx(null, ['5', '5']), { nxProductId: '5', how: 'ean' }, 'un seul produit par code-barres');
assert.strictEqual(resolveNx(null, ['5', '6']).how, 'ambiguous', 'deux produits : on ne choisit pas');
assert.strictEqual(resolveNx(null, []).nxProductId, null);

// ── Refus net ───────────────────────────────────────────────────────────────
assert.ok(isCleanRefusal('Nextore PUT /stocks → HTTP 422 x'));
assert.ok(!isCleanRefusal('fetch failed'));

// ── Annulation (le client change d'avis, la pièce retourne au site) ──────────
const row = (o) => ({ origin: 'boutique', cancelled_at: null, site_status: 'sent', nx_status: 'sent', ...o });
const refused = (o, re) => assert.throws(() => cancelPlan(row(o)), (e) => e.statusCode === 409 && re.test(e.message));
assert.deepStrictEqual(cancelPlan(row({})), { site: 'undo', nx: 'undo' }, 'tout est parti : tout se défait');
assert.deepStrictEqual(cancelPlan(row({ site_status: 'queued', nx_status: 'queued' })), { site: 'cancel', nx: 'cancel' }, 'rien parti : rien à défaire');
assert.deepStrictEqual(cancelPlan(row({ nx_status: 'waiting' })), { site: 'undo', nx: 'cancel' }, 'absent de la caisse : seul le site se défait');
assert.deepStrictEqual(cancelPlan(row({ site_status: 'error', site_error: 'Stock physique du site (0) inférieur au prélèvement (1) : à vérifier.' })),
  { site: 'cancel', nx: 'undo' }, 'refus net : rien n\'a été écrit au site');
assert.deepStrictEqual(cancelPlan(row({ nx_status: 'error', nx_error: 'Nextore PUT /stocks → HTTP 422' })), { site: 'undo', nx: 'cancel' });
refused({ nx_status: 'error', nx_error: 'Réponse Nextore incertaine, VÉRIFIEZ le stock dans la caisse' }, /à vérifier/);
refused({ site_status: 'error', site_error: 'Envoi interrompu (serveur redémarré pendant l\'appel) : VÉRIFIEZ' }, /à vérifier/);
refused({ site_status: 'sending' }, /en cours d'envoi/);
refused({ cancelled_at: new Date() }, /déjà annulé/);
refused({ origin: 'pda', nx_status: 'skipped' }, /Vente boutique/);

// ── Rapprochement avec les ventes de la caisse (cas réels du 12-13/11/2026) ──
const P = (id, nx, at, q) => ({ id, nx_product_id: nx, at, nx_qty: q });
const S = (nx, at, q) => ({ product_id: nx, at, quantity: String(q) });
let sold = allocateSales(
  [P(780, '13290', '2026-11-12 13:14:48', '12'), P(793, '12643', '2026-11-13 17:22:53', 5), P(786, '13835', '2026-11-13 11:52:36', 1)],
  [S('13290', '2026-11-12 13:16:35', 10), S('13290', '2026-11-12 13:16:35', 2), S('12643', '2026-11-13 17:23:34', 4), S('12643', '2026-11-13 17:23:34', 1)]
);
assert.strictEqual(sold.get(780), 12, 'deux lignes de vente pour un prélèvement de 12');
assert.strictEqual(sold.get(793), 5, 'pack de 5 résistances : 5 pièces en caisse, vendues 4 + 1');
assert.strictEqual(sold.get(786), 0, 'rien vendu : annulable');
// Le plus ancien d'abord : le prélèvement du jour reste annulable si l'ancien absorbe la vente.
sold = allocateSales([P(1, 'X', '2026-11-10 10:00:00', 1), P(2, 'X', '2026-11-13 10:00:00', 1)], [S('X', '2026-11-13 10:02:00', 1)]);
assert.deepStrictEqual([sold.get(1), sold.get(2)], [1, 0]);
// Encaissé avant d'avoir scanné le prélèvement : compté vendu (tolérance 30 min), au-delà non.
sold = allocateSales([P(3, 'Y', '2026-11-13 14:20:00', 1)], [S('Y', '2026-11-13 14:00:00', 1)]);
assert.strictEqual(sold.get(3), 1, 'vente 20 min avant le scan');
sold = allocateSales([P(4, 'Y', '2026-11-13 14:20:00', 1)], [S('Y', '2026-11-13 13:00:00', 1)]);
assert.strictEqual(sold.get(4), 0, 'vente 1 h 20 avant : une autre pièce');
// Retour en caisse (quantité négative) ignoré ; prélèvement sans produit caisse jamais vendu.
sold = allocateSales([P(5, 'Z', '2026-11-13 09:00:00', 2), P(6, null, '2026-11-13 09:00:00', 1)], [S('Z', '2026-11-13 09:05:00', -1), S('Z', '2026-11-13 09:06:00', 1)]);
assert.deepStrictEqual([sold.get(5), sold.get(6)], [1, 0], 'vendu en partie : plus annulable non plus');

console.log('✓ prelevement.test.js');
