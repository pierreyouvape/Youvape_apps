/**
 * PDF d'une vague de picking : une page de garde, puis un bon de préparation
 * par commande, dans l'ordre de la vague.
 *
 * Fonction pure : elle reçoit la vague toute préparée (pickingModel) et rend
 * les octets du PDF. Aucune base, aucun réseau.
 *
 * Trois choix, pour que le document serve en rayon :
 *   - une vraie police embarquée (Inter) : la police standard du PDF ne sait
 *     pas écrire « Ω », présent dans 413 noms de produits (résistances) ;
 *   - de vrais codes-barres (bwip-js) : EAN-13 pour les produits quand le code
 *     en est un, Code 128 pour le reste et pour les n° de commande et de vague ;
 *   - les articles triés par emplacement : l'ordre du chemin en rayon.
 */

const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const bwipjs = require('bwip-js');

const ASSETS = path.join(__dirname, '..', 'assets', 'picking');
const asset = (name) => fs.readFileSync(path.join(ASSETS, name));

// A4 portrait, en points PostScript.
const W = 595.28;
const H = 841.89;
const M = 36;

const COL = {
  ink: rgb(0.07, 0.09, 0.15),
  grey: rgb(0.42, 0.45, 0.5),
  light: rgb(0.62, 0.65, 0.7),
  line: rgb(0.86, 0.88, 0.9),
  zebra: rgb(0.965, 0.972, 0.98),
  brand: rgb(0.02, 0.37, 0.52),       // bleu Youvape
  violet: rgb(0.486, 0.227, 0.929),   // couleur de l'app Picking
  violetL: rgb(0.953, 0.933, 1),
  white: rgb(1, 1, 1),
};

const CARRIER_LOGOS = {
  laposte: 'carrier_laposte.png',
  mondial_relay: 'carrier_mondial_relay.png',
  colissimo: 'carrier_colissimo.png',
  chronopost: 'carrier_chronopost.png',
  interne: 'carrier_retrait_magasin.png',
};

const CARRIER_LABELS = {
  laposte: 'La Poste',
  mondial_relay: 'Mondial Relay',
  colissimo: 'Colissimo',
  chronopost: 'Chronopost',
  interne: 'Retrait magasin',
};

const carrierLabel = (c) => {
  if (!c?.carrierCode) return 'Transporteur non reconnu';
  if (c.carrierCode === 'chronopost' && c.accountCode === '2shop') return 'Chronopost 2Shop';
  return CARRIER_LABELS[c.carrierCode] || c.carrierCode;
};

const countryName = (code) => {
  if (!code) return '';
  try { return new Intl.DisplayNames(['fr'], { type: 'region' }).of(String(code).toUpperCase()); } catch { return code; }
};

/**
 * @param {Date|string} d
 * @param {boolean} [parisWallTime] - true pour une date WooCommerce : stockée en
 *        heure de Paris SANS fuseau, node-pg la lit comme de l'UTC ; on l'affiche
 *        donc telle quelle. false pour une date de l'app (NOW(), vraie UTC).
 */
const fmtDate = (d, parisWallTime = false) => {
  if (!d) return '';
  const opts = {
    timeZone: parisWallTime ? 'UTC' : 'Europe/Paris',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  };
  return new Intl.DateTimeFormat('fr-FR', opts).format(new Date(d)).replace(' ', ' à ');
};

/** Code-barres PNG : EAN-13 si le code en est un valide, Code 128 sinon. */
const barcodePng = async (text, { ean = false, height = 10, scale = 3 } = {}) => {
  const value = String(text);
  if (ean && /^\d{13}$/.test(value)) {
    try {
      return await bwipjs.toBuffer({ bcid: 'ean13', text: value, scale, height, includetext: true, textsize: 9 });
    } catch (e) { /* clé de contrôle fausse : repli en Code 128 */ }
  }
  return bwipjs.toBuffer({ bcid: 'code128', text: value, scale, height, includetext: ean, textsize: 9 });
};

/** Coupe un texte en lignes tenant dans `width`. */
const wrap = (text, font, size, width, maxLines = 3) => {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= width) { cur = next; continue; }
    if (cur) lines.push(cur);
    cur = w;
    if (lines.length === maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    let last = lines[maxLines - 1];
    while (last && font.widthOfTextAtSize(`${last}…`, size) > width) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
};

const fit = (text, font, size, width) => wrap(text, font, size, width, 1)[0] || '';

/**
 * @param {object} wave
 * @param {string} wave.waveNumber
 * @param {Date|string} wave.createdAt
 * @param {?string} wave.ruleName        - null = vague manuelle
 * @param {object[]} wave.orders          - dans l'ordre de la vague, cf. drawOrder
 * @returns {Promise<Uint8Array>}
 */
const buildWavePdf = async (wave) => {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`Vague ${wave.waveNumber}`);
  doc.setAuthor('Youvape Apps — Picking');

  const f = {
    regular: await doc.embedFont(asset('Inter-400.ttf')),
    semi: await doc.embedFont(asset('Inter-600.ttf')),
    bold: await doc.embedFont(asset('Inter-700.ttf')),
    black: await doc.embedFont(asset('Inter-800.ttf')),
  };
  const logo = await doc.embedJpg(asset('logo.jpg'));
  const carrierLogos = {};
  const carrierLogo = async (code) => {
    if (!CARRIER_LOGOS[code]) return null;
    if (!carrierLogos[code]) carrierLogos[code] = await doc.embedPng(asset(CARRIER_LOGOS[code]));
    return carrierLogos[code];
  };

  await drawCover(doc, f, logo, carrierLogo, wave);
  for (let i = 0; i < wave.orders.length; i++) {
    await drawOrder(doc, f, logo, carrierLogo, wave, wave.orders[i], i + 1);
  }
  return doc.save();
};

// ── Page de garde ───────────────────────────────────────────────────────────

const drawCover = async (doc, f, logo, carrierLogo, wave) => {
  const page = doc.addPage([W, H]);

  page.drawImage(logo, { x: M, y: H - M - 56, width: 56, height: 56 });
  page.drawText('VAGUE DE PRÉPARATION', { x: M + 72, y: H - M - 26, size: 11, font: f.bold, color: COL.violet });
  page.drawText('Youvape — Picking', { x: M + 72, y: H - M - 44, size: 10, font: f.regular, color: COL.grey });

  // Numéro de vague : lisible de loin, posé sur le bac.
  let size = 64;
  while (f.black.widthOfTextAtSize(wave.waveNumber, size) > W - 2 * M) size -= 2;
  const numW = f.black.widthOfTextAtSize(wave.waveNumber, size);
  page.drawText(wave.waveNumber, { x: (W - numW) / 2, y: H - 250, size, font: f.black, color: COL.ink });

  const bc = await doc.embedPng(await barcodePng(wave.waveNumber, { height: 18, scale: 4 }));
  const bcW = Math.min(360, bc.width * 0.5);
  const bcH = bcW * bc.height / bc.width;
  page.drawImage(bc, { x: (W - bcW) / 2, y: H - 290 - bcH, width: bcW, height: bcH });

  // Bloc d'informations.
  const totalItems = wave.orders.reduce((s, o) => s + o.lines.reduce((t, l) => t + l.qty, 0), 0);
  const infos = [
    ['Créée le', fmtDate(wave.createdAt)],
    ['Commandes', String(wave.orders.length)],
    ['Articles', String(totalItems)],
    ['Origine', wave.ruleName ? `Règle « ${wave.ruleName} »` : 'Vague manuelle'],
  ];
  let y = H - 420;
  const boxX = M + 40;
  const boxW = W - 2 * M - 80;
  page.drawRectangle({ x: boxX, y: y - infos.length * 30 + 2, width: boxW, height: infos.length * 30 + 8, color: COL.zebra, borderColor: COL.line, borderWidth: 1 });
  for (const [k, v] of infos) {
    page.drawText(k, { x: boxX + 20, y: y - 12, size: 12, font: f.regular, color: COL.grey });
    page.drawText(v, { x: boxX + 150, y: y - 12, size: 14, font: f.bold, color: COL.ink });
    y -= 30;
  }

  // Transporteurs concernés, avec le nombre de commandes.
  y -= 40;
  page.drawText('Transporteurs', { x: boxX, y, size: 12, font: f.bold, color: COL.violet });
  y -= 14;
  const byCarrier = new Map();
  for (const o of wave.orders) {
    const key = `${o.carrier?.carrierCode}:${o.carrier?.accountCode}`;
    const cur = byCarrier.get(key) || { carrier: o.carrier, n: 0 };
    cur.n += 1;
    byCarrier.set(key, cur);
  }
  for (const { carrier, n } of byCarrier.values()) {
    const img = await carrierLogo(carrier?.carrierCode);
    const rowH = 38;
    page.drawLine({ start: { x: boxX, y: y - rowH }, end: { x: boxX + boxW, y: y - rowH }, thickness: 0.8, color: COL.line });
    if (img) {
      const h = 22;
      page.drawImage(img, { x: boxX, y: y - rowH + 8, width: h * img.width / img.height, height: h });
    }
    page.drawText(carrierLabel(carrier), { x: boxX + 150, y: y - rowH + 14, size: 12, font: f.semi, color: COL.ink });
    const txt = `${n} commande${n > 1 ? 's' : ''}`;
    page.drawText(txt, { x: boxX + boxW - f.bold.widthOfTextAtSize(txt, 12), y: y - rowH + 14, size: 12, font: f.bold, color: COL.ink });
    y -= rowH;
  }

  footer(page, f, `Vague ${wave.waveNumber}`, `Imprimée le ${fmtDate(new Date())}`);
};

// ── Bon de préparation ──────────────────────────────────────────────────────

const TABLE = {
  loc: { x: M, w: 58 },
  qty: { x: M + 58, w: 40 },
  prod: { x: M + 98, w: 270 },
  bc: { x: M + 368, w: W - 2 * M - 368 },
};

/**
 * @param {object} order
 * @param {string} order.orderNumber
 * @param {Date|string} order.orderDate
 * @param {string} order.shippingMethod
 * @param {{carrierCode: ?string, accountCode: ?string}} order.carrier
 * @param {{name, company, address1, address2, postcode, city, country, phone}} order.shipping
 * @param {?{id, name, address, postcode, city, country}} order.relayPoint
 * @param {{location, qty, name, brand, sku, barcode, packName, shipped}[]} order.lines
 */
const drawOrder = async (doc, f, logo, carrierLogo, wave, order, index) => {
  let page = doc.addPage([W, H]);
  const pages = [page];

  // En-tête : logo, titre, n° de commande et son code-barres (scanné au packing).
  page.drawImage(logo, { x: M, y: H - M - 46, width: 46, height: 46 });
  page.drawText('BON DE PRÉPARATION', { x: M + 58, y: H - M - 16, size: 10, font: f.bold, color: COL.violet });
  page.drawText(`Commande ${order.orderNumber}`, { x: M + 58, y: H - M - 38, size: 20, font: f.black, color: COL.ink });
  page.drawText(`Passée le ${fmtDate(order.orderDate, true)}`, { x: M + 58, y: H - M - 54, size: 9.5, font: f.regular, color: COL.grey });

  const bc = await doc.embedPng(await barcodePng(order.orderNumber, { height: 14, scale: 3 }));
  const bcH = 44;
  const bcW = bcH * bc.width / bc.height;
  page.drawImage(bc, { x: W - M - bcW, y: H - M - 50, width: bcW, height: bcH });
  const waveTxt = `Vague ${wave.waveNumber} · ${index}/${wave.orders.length}`;
  page.drawText(waveTxt, { x: W - M - f.semi.widthOfTextAtSize(waveTxt, 9.5), y: H - M - 64, size: 9.5, font: f.semi, color: COL.grey });

  // Deux cadres : livraison, transporteur.
  const top = H - M - 84;
  const boxH = 108;
  const gap = 12;
  const boxW = (W - 2 * M - gap) / 2;
  for (const x of [M, M + boxW + gap]) {
    page.drawRectangle({ x, y: top - boxH, width: boxW, height: boxH, borderColor: COL.line, borderWidth: 1, color: COL.white });
  }

  const s = order.shipping || {};
  const rp = order.relayPoint;
  page.drawText(rp ? 'CLIENT · LIVRÉ EN POINT RELAIS' : 'LIVRAISON', { x: M + 12, y: top - 16, size: 8, font: f.bold, color: COL.light });
  let ly = top - 32;
  const put = (txt, font = f.regular, size = 10, color = COL.ink) => {
    if (!txt) return;
    page.drawText(fit(txt, font, size, boxW - 24), { x: M + 12, y: ly, size, font, color });
    ly -= size + 3.5;
  };
  put(s.name, f.bold, 12);
  if (rp) {
    put(`Point relais n° ${rp.id}`, f.bold, 10, COL.brand);
    put(rp.name, f.semi, 10);
    put(rp.address);
    put([rp.postcode, rp.city].filter(Boolean).join(' ') + (rp.country && rp.country !== 'FR' ? ` — ${countryName(rp.country)}` : ''));
  } else {
    put(s.company);
    put([s.address1, s.address2].filter(Boolean).join(', '));
    put([s.postcode, s.city].filter(Boolean).join(' '));
    put(countryName(s.country), f.semi);
  }
  put(s.phone ? `Tél. ${s.phone}` : null, f.regular, 9, COL.grey);

  const cx = M + boxW + gap + 12;
  page.drawText('TRANSPORTEUR', { x: cx, y: top - 16, size: 8, font: f.bold, color: COL.light });
  const img = await carrierLogo(order.carrier?.carrierCode);
  if (img) {
    const h = 26;
    page.drawImage(img, { x: cx, y: top - 56, width: h * img.width / img.height, height: h });
  } else {
    page.drawText(carrierLabel(order.carrier), { x: cx, y: top - 50, size: 13, font: f.bold, color: COL.ink });
  }
  if (order.carrier?.carrierCode === 'chronopost' && order.carrier?.accountCode === '2shop') {
    page.drawText('2Shop', { x: cx + 150, y: top - 48, size: 13, font: f.black, color: COL.brand });
  }
  page.drawText(fit(order.shippingMethod, f.semi, 10.5, boxW - 24), { x: cx, y: top - 76, size: 10.5, font: f.semi, color: COL.ink });

  // Tableau des articles.
  let y = top - boxH - 22;
  const header = (p, yy) => {
    p.drawRectangle({ x: M, y: yy - 6, width: W - 2 * M, height: 20, color: COL.violetL });
    [['EMPL.', TABLE.loc], ['QTÉ', TABLE.qty], ['PRODUIT', TABLE.prod], ['CODE-BARRES', TABLE.bc]].forEach(([t, c]) => {
      p.drawText(t, { x: c.x + 6, y: yy, size: 8, font: f.bold, color: COL.violet });
    });
    return yy - 12;
  };
  y = header(page, y);

  const lines = [...order.lines].sort((a, b) =>
    String(a.location || '~').localeCompare(String(b.location || '~'), 'fr', { numeric: true }));

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const nameLines = wrap(l.name, f.semi, 10, TABLE.prod.w - 12, 2);
    const meta = [l.brand, l.sku && `SKU ${l.sku}`].filter(Boolean).join(' · ');
    const rowH = Math.max(52, 14 + nameLines.length * 13 + 12 + (l.packName ? 12 : 0) + (l.shipped ? 11 : 0));

    if (y - rowH < M + 30) {
      page = doc.addPage([W, H]);
      pages.push(page);
      page.drawText(`Commande ${order.orderNumber} (suite)`, { x: M, y: H - M - 14, size: 12, font: f.bold, color: COL.ink });
      y = header(page, H - M - 40);
    }

    if (i % 2 === 1) page.drawRectangle({ x: M, y: y - rowH, width: W - 2 * M, height: rowH, color: COL.zebra });
    page.drawLine({ start: { x: M, y: y - rowH }, end: { x: W - M, y: y - rowH }, thickness: 0.6, color: COL.line });

    const mid = y - rowH / 2;
    page.drawText(l.location || '—', { x: TABLE.loc.x + 6, y: mid - 4, size: 11, font: f.bold, color: l.location ? COL.ink : COL.light });

    // Quantité : en blanc sur noir dès qu'elle dépasse 1, pour ne pas la rater.
    const q = String(l.qty);
    if (l.qty > 1) {
      const bw = Math.max(26, f.black.widthOfTextAtSize(q, 13) + 12);
      page.drawRectangle({ x: TABLE.qty.x + 4, y: mid - 9, width: bw, height: 20, color: COL.ink });
      page.drawText(q, { x: TABLE.qty.x + 4 + (bw - f.black.widthOfTextAtSize(q, 13)) / 2, y: mid - 4, size: 13, font: f.black, color: COL.white });
    } else {
      page.drawText(q, { x: TABLE.qty.x + 12, y: mid - 4, size: 12, font: f.semi, color: COL.ink });
    }

    let ty = y - 16;
    for (const nl of nameLines) {
      page.drawText(nl, { x: TABLE.prod.x + 6, y: ty, size: 10, font: f.semi, color: COL.ink });
      ty -= 13;
    }
    if (meta) {
      page.drawText(fit(meta, f.regular, 8.5, TABLE.prod.w - 12), { x: TABLE.prod.x + 6, y: ty, size: 8.5, font: f.regular, color: COL.grey });
      ty -= 12;
    }
    if (l.packName) {
      page.drawText(fit(`Dans le pack : ${l.packName}`, f.semi, 8.5, TABLE.prod.w - 12), { x: TABLE.prod.x + 6, y: ty, size: 8.5, font: f.semi, color: COL.violet });
      ty -= 12;
    }
    if (l.shipped) {
      page.drawText(`Déjà expédié : ${l.shipped}`, { x: TABLE.prod.x + 6, y: ty, size: 8.5, font: f.regular, color: COL.light });
    }

    if (l.barcode) {
      const png = await doc.embedPng(await barcodePng(l.barcode, { ean: true, height: 9, scale: 2 }));
      const h = Math.min(rowH - 12, 38);
      const w = Math.min(TABLE.bc.w - 12, h * png.width / png.height);
      page.drawImage(png, { x: TABLE.bc.x + 6, y: mid - (w * png.height / png.width) / 2, width: w, height: w * png.height / png.width });
    } else {
      page.drawText('Pas de code-barres', { x: TABLE.bc.x + 6, y: mid - 3, size: 8.5, font: f.regular, color: COL.light });
    }
    y -= rowH;
  }

  const items = order.lines.reduce((s2, l) => s2 + l.qty, 0);
  const summary = `${items} article${items > 1 ? 's' : ''} · ${order.lines.length} ligne${order.lines.length > 1 ? 's' : ''}`;
  if (y - 24 < M + 30) { page = doc.addPage([W, H]); pages.push(page); y = H - M; }
  page.drawText(summary, { x: W - M - f.bold.widthOfTextAtSize(summary, 11), y: y - 20, size: 11, font: f.bold, color: COL.ink });

  pages.forEach((p, i) => footer(p, f, `Commande ${order.orderNumber} · Vague ${wave.waveNumber}`,
    pages.length > 1 ? `Page ${i + 1}/${pages.length}` : ''));
};

const footer = (page, f, left, right) => {
  page.drawLine({ start: { x: M, y: M }, end: { x: W - M, y: M }, thickness: 0.6, color: COL.line });
  page.drawText(left, { x: M, y: M - 13, size: 8, font: f.regular, color: COL.light });
  if (right) page.drawText(right, { x: W - M - f.regular.widthOfTextAtSize(right, 8), y: M - 13, size: 8, font: f.regular, color: COL.light });
};

/**
 * Lignes d'un bon de préparation, à partir des lignes WooCommerce de la commande.
 *
 *   - Les packs woosb ne se prélèvent pas : on liste leurs composants (ligne à
 *     0 € dont le produit figure dans `woosb_ids` d'un pack de la commande),
 *     chacun marqué « Dans le pack : … ».
 *   - Quantité = ce qui RESTE à expédier d'après BMS (`remainingBySku`), le
 *     reste est affiché « Déjà expédié ». Sans relevé BMS pour la commande
 *     (null), on imprime tout ce qui a été commandé.
 *   - Code-barres : le premier EAN-13 du produit, sinon son premier code.
 *
 * @param {object[]} items - lignes `order_items` jointes au produit
 * @param {?Map<string, number>} remainingBySku
 * @returns {{location, qty, name, brand, sku, barcode, packName, shipped}[]}
 */
const buildPrintLines = (items, remainingBySku = null) => {
  const packs = items.filter(i => i.type === 'woosb');
  const packOf = (i) => {
    if (Number(i.line_total) !== 0) return null;
    const pack = packs.find(pk => (pk.woosb_ids || []).some(w => String(w.id) === String(i.product_id)));
    if (pack) return String(pack.name).trim();
    return (/\sdans le pack\s*:\s*(.+)$/i.exec(i.name || '') || [])[1] || null;
  };
  const remaining = remainingBySku ? new Map(remainingBySku) : null;

  const lines = [];
  for (const i of items) {
    if (i.type === 'woosb') continue;
    const ordered = Number(i.qty) || 0;
    let qty = ordered;
    if (remaining && i.sku) {
      const left = remaining.get(i.sku) || 0;
      qty = Math.min(ordered, left);
      remaining.set(i.sku, left - qty);
    }
    if (qty <= 0) continue;
    const barcodes = i.barcodes || [];
    lines.push({
      location: i.location || null,
      qty,
      name: String(i.name || '').replace(/\s+dans le pack\s*:.*$/i, '').trim(),
      brand: [i.brand, i.sub_brand].filter(Boolean).join(' — '),
      sku: i.sku || null,
      barcode: barcodes.find(b => /^\d{13}$/.test(b)) || barcodes[0] || null,
      packName: packOf(i),
      shipped: ordered - qty
    });
  }
  return lines;
};

module.exports = { buildWavePdf, buildPrintLines };
