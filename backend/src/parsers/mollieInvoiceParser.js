/**
 * Facture mensuelle Mollie (PDF « MOL-NL-R2026.xxxxxxxxxx »), texte pdf-parse.
 *
 * Page 1 : un récapitulatif par famille (« Paiements Bancontact  1 016  1 036,13 EUR »).
 * Page 2 : le détail qui fait foi, une ligne par tarif :
 *   « Bancontact (frais variables) \tEUR 60 488,08 EUR \t1,33% 804,491464 EUR 804,49 EUR »
 *   = libellé, assiette (nombre de transactions ou montant), taux, montant exact, montant facturé.
 *
 * Avoir (« Extourne », MOL-NL-C…) : même mise en page, sans période ; il désigne
 * la facture qu'il corrige (« Application sur la facture: MOL-NL-R… »).
 */

const SP = '[ \\u00a0\\u202f]';
const NUM = `-?\\d{1,3}(?:${SP}\\d{3})*(?:,\\d+)?`;

const toNum = (s) => (s == null ? null : parseFloat(String(s).replace(/[   ]/g, '').replace(',', '.')));
const toIsoDate = (d) => {
  const m = /(\d{2})-(\d{2})-(\d{4})/.exec(d || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

const DETAIL_RE = new RegExp(
  `^(.+?)\\s+EUR\\s+(${NUM})(?:\\s*EUR)?\\s+(${NUM})\\s*(%|EUR)\\s+(${NUM})\\s*EUR\\s+(${NUM})\\s*EUR\\s*$`
);
const SUMMARY_RE = new RegExp(`^(.+?)\\s*\\t\\s*(${NUM})\\s*\\t\\s*(${NUM})\\s*EUR\\s*$`);

function parseMollieInvoice(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const out = {
    docType: 'invoice', appliesTo: null,
    invoiceNumber: null, invoiceDate: null, periodStart: null, periodEnd: null,
    organisationId: null, totalHT: null, totalTTC: null, prepaid: null, credited: null, amountDue: null,
    summary: [], lines: [], warnings: [],
  };

  let page = 1;
  for (const l of lines) {
    if (/^-- \d+ of \d+ --$/.test(l)) { page++; continue; }
    let m;
    if ((m = /^Référence de (?:facture|l.extourne)\s+(MOL-[A-Z0-9.\-]+)/.exec(l))) { out.invoiceNumber = m[1]; continue; }
    if ((m = /^Date de (?:facture|l.extourne)\s+(\d{2}-\d{2}-\d{4})/.exec(l))) { out.invoiceDate = toIsoDate(m[1]); continue; }
    if ((m = /^Application sur la facture\s*:\s*(MOL-[A-Z0-9.\-]+)/.exec(l))) { out.appliesTo = m[1]; continue; }
    if (/^Extourne$/.test(l)) { out.docType = 'credit'; continue; }
    if ((m = /^Période de facturation\s+(\d{2}-\d{2}-\d{4})\s+pour\s+(\d{2}-\d{2}-\d{4})/.exec(l))) {
      out.periodStart = toIsoDate(m[1]); out.periodEnd = toIsoDate(m[2]); continue;
    }
    if ((m = /^ID de l'organisation\s+(\d+)/.exec(l))) { out.organisationId = m[1]; continue; }
    if ((m = new RegExp(`^Total hors TVA\\s+(${NUM})\\s*EUR`).exec(l))) { if (out.totalHT == null) out.totalHT = toNum(m[1]); continue; }
    if ((m = new RegExp(`^Total TVA comprise\\s+(${NUM})\\s*EUR`).exec(l))) { out.totalTTC = toNum(m[1]); continue; }
    if ((m = new RegExp(`^Montant préréglé.*?\\t\\s*(${NUM})\\s*EUR`).exec(l))) { out.prepaid = toNum(m[1]); continue; }
    if ((m = new RegExp(`^Montant versé au solde.*?\\t\\s*(${NUM})\\s*EUR`).exec(l))) { out.credited = toNum(m[1]); continue; }
    if ((m = new RegExp(`^Montant dû\\s+(${NUM})\\s*EUR`).exec(l))) { out.amountDue = toNum(m[1]); continue; }

    if (page >= 2 && (m = DETAIL_RE.exec(l))) {
      const [, label, base, rate, unit, unrounded, rounded] = m;
      out.lines.push({
        label: label.replace(/\s+/g, ' ').trim(),
        base: toNum(base),
        rate: toNum(rate),
        rateUnit: unit === '%' ? 'pct' : 'fixed',
        unrounded: toNum(unrounded),
        amount: toNum(rounded),
      });
      continue;
    }
    if (page === 1 && (m = SUMMARY_RE.exec(l)) && !/^(Total|Montant|Description)/.test(m[1])) {
      out.summary.push({ label: m[1].trim(), qty: toNum(m[2]), amount: toNum(m[3]) });
      continue;
    }
    // Ligne de détail que la regex n'a pas su lire : on le dit plutôt que de la perdre.
    if (page >= 2 && /\(frais (fixes|variables)\)|rembours/i.test(l) && /EUR/.test(l)) {
      out.warnings.push(`Ligne de détail illisible : « ${l} »`);
    }
  }

  if (/^MOL-[A-Z]+-C/.test(out.invoiceNumber || '')) out.docType = 'credit';
  if (!out.invoiceNumber) throw new Error('Référence de facture Mollie introuvable : est-ce bien une facture Mollie ?');
  if (!out.lines.length) throw new Error('Aucune ligne de détail lue (page « Description de la facture »)');
  return out;
}

module.exports = { parseMollieInvoice };
