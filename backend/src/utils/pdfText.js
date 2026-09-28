/**
 * Nettoyage du texte extrait d'un PDF, avant tout parsing.
 *
 * Partagé par l'import fournisseur (`pdfImportModel`) et le contrôle de facture
 * (`parsers/invoices`) : les deux lisent les mêmes documents, et un parseur mis
 * au point sur du texte nettoyé casse sur du brut.
 *
 * Le recollage des mots coupés par un tiret en fin de ligne n'est pas
 * cosmétique : c'est lui qui répare les références longues que le PDF renvoie à
 * la ligne (« S30467- » / « TJCSFSDENSWE100FRRB » chez LVP).
 *
 * En cas d'échec, retourne le texte d'origine : mieux vaut un parsing dégradé
 * qu'une exception sur un caractère exotique.
 */
function cleanPdfText(text) {
  try {
    let cleaned = text;

    // Espaces insécables et autres variantes → espace normal
    cleaned = cleaned.replace(/[       ﻿]/g, ' ');

    // Tirets typographiques → tiret standard
    cleaned = cleaned.replace(/[‐‑‒–—―]/g, '-');

    // Caractères de contrôle parasites (hors \n et \t)
    cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // Recollage des mots coupés en fin de ligne par un tiret
    // Ex : "GOLD-\nSUCKER" → "GOLD-SUCKER"
    cleaned = cleaned.replace(/([A-Za-z0-9])-\n([A-Za-z0-9])/g, '$1-$2');

    // Espaces multiples → espace simple (hors sauts de ligne)
    cleaned = cleaned.replace(/[^\S\n]+/g, ' ');

    return cleaned;
  } catch {
    return text;
  }
}

/** Vrai si le tampon est un PDF (et non un CSV ou un texte). */
function isPdf(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer.toString('ascii', 0, 4) === '%PDF';
}

module.exports = { cleanPdfText, isPdf };
