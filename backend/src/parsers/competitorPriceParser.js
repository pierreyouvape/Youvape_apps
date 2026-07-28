/**
 * Parser de prix pour fiches produit concurrentes (principalement PrestaShop).
 *
 * Stratégie, par ordre de fiabilité :
 *   1. JSON-LD (<script type="application/ld+json">) @type=Product → offers.price
 *      → c'est le PRIX DE VENTE réel (remise incluse). Le plus fiable.
 *   2. État JS PrestaShop : "PriceInclTax":"15.25" (prix TTC courant).
 *   3. Meta og:price:amount / product:price:amount → EN DERNIER : sur les pages
 *      en promo, cette balise contient souvent le prix BARRÉ (avant remise).
 *
 * Retourne { price, regular_price, in_stock, currency } — price=null si introuvable.
 */

const toNumber = (raw) => {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // Retire symboles/espaces, gère la virgule décimale française
  s = s.replace(/[^\d.,]/g, '');
  if (s.includes(',') && s.includes('.')) {
    // format type "1.234,56" → enlève les milliers puis virgule → point
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

const availabilityToStock = (val) => {
  if (!val) return null;
  const v = String(val).toLowerCase();
  if (v.includes('instock') || v.includes('in_stock')) return true;
  if (v.includes('outofstock') || v.includes('out_of_stock') || v.includes('soldout')) return false;
  return null;
};

// Parcourt récursivement un objet JSON-LD pour trouver le premier nœud @type Product
const findProductNode = (node) => {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findProductNode(item);
      if (found) return found;
    }
    return null;
  }
  const type = node['@type'];
  const isProduct = type === 'Product' || (Array.isArray(type) && type.includes('Product'));
  if (isProduct && node.offers) return node;
  if (node['@graph']) return findProductNode(node['@graph']);
  return null;
};

const parseJsonLd = (html) => {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let json;
    try {
      json = JSON.parse(m[1].trim());
    } catch {
      continue; // bloc JSON-LD invalide, on passe au suivant
    }
    const product = findProductNode(json);
    if (!product) continue;
    const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
    if (!offer) continue;
    const price = toNumber(offer.price ?? offer.lowPrice ?? offer.priceSpecification?.price);
    if (price === null) continue;
    return {
      price,
      currency: offer.priceCurrency || 'EUR',
      in_stock: availabilityToStock(offer.availability),
    };
  }
  return null;
};

const matchFirst = (html, regexes) => {
  for (const re of regexes) {
    const m = html.match(re);
    if (m && m[1]) {
      const n = toNumber(m[1]);
      if (n !== null) return n;
    }
  }
  return null;
};

/**
 * @param {string} html - contenu HTML de la page
 * @returns {{price:number|null, regular_price:number|null, in_stock:boolean|null, currency:string}}
 */
function parsePrice(html) {
  if (!html || typeof html !== 'string') {
    return { price: null, regular_price: null, in_stock: null, currency: 'EUR' };
  }

  let price = null;
  let currency = 'EUR';
  let in_stock = null;

  // 1) JSON-LD — source prioritaire
  const ld = parseJsonLd(html);
  if (ld) {
    price = ld.price;
    currency = ld.currency || 'EUR';
    in_stock = ld.in_stock;
  }

  // 2) Fallback : état JS PrestaShop (prix TTC courant)
  if (price === null) {
    price = matchFirst(html, [
      /"PriceInclTax"\s*:\s*"?([\d.,]+)"?/i,
      /"price_amount"\s*:\s*"?([\d.,]+)"?/i,
      /"priceAmount"\s*:\s*"?([\d.,]+)"?/i,
    ]);
  }

  // 3) Dernier recours : meta og/product (peut être le prix barré → moins fiable)
  if (price === null) {
    price = matchFirst(html, [
      /(?:og:price:amount|product:price:amount)["']\s+content=["']([\d.,]+)["']/i,
      /itemprop=["']price["'][^>]*content=["']([\d.,]+)["']/i,
    ]);
  }

  // Prix barré (avant remise) — best effort, uniquement s'il est supérieur au prix de vente
  let regular_price = matchFirst(html, [
    /"PriceInclTaxWithoutReduction"\s*:\s*"?([\d.,]+)"?/i,
    /"regular_price"\s*:\s*"?([\d.,]+)"?/i,
    /(?:og:price:amount|product:price:amount)["']\s+content=["']([\d.,]+)["']/i,
  ]);
  if (regular_price !== null && price !== null && regular_price <= price) {
    regular_price = null; // pas une vraie remise
  }

  // Disponibilité de secours via meta si JSON-LD muet
  if (in_stock === null) {
    const av = html.match(/(?:og:availability|product:availability)["']\s+content=["']([^"']+)["']/i);
    if (av) in_stock = availabilityToStock(av[1]);
  }

  return { price, regular_price, in_stock, currency };
}

module.exports = { parsePrice, toNumber };
