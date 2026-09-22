/**
 * Récapitulatif de remise — le bordereau des transporteurs qui n'en font pas.
 *
 * Colissimo émet un vrai bordereau par API. Mondial Relay, non : leur service
 * SOAP public n'expose que la création d'étiquettes, la recherche de points
 * relais et le suivi (15 opérations relevées le 22/09/2026, aucune de
 * bordereau), et l'API Connect ne sait que créer des expéditions. Leur
 * bordereau de remise vit dans leur extranet, hors de portée.
 *
 * Ce module produit donc NOTRE document : la liste des colis remis, avec une
 * case de signature pour le chauffeur. Ce n'est pas une pièce du transporteur
 * et le document ne le prétend pas — c'est une preuve de remise, et c'est à ça
 * qu'elle sert quand un colis se perd entre l'entrepôt et le réseau.
 *
 * Il est stocké et rattaché exactement comme un vrai bordereau : les colis
 * qu'il porte ne reviennent plus dans la liste à déposer.
 */

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

// A4 portrait, en points PostScript.
const PAGE = { largeur: 595.28, hauteur: 841.89 };
const MARGE = 42;
const NOIR = rgb(0.07, 0.09, 0.15);
const GRIS = rgb(0.42, 0.45, 0.5);
const TRAIT = rgb(0.80, 0.82, 0.85);

// Colonnes du tableau, en points depuis la marge gauche.
const COLONNES = [
  { cle: 'rang',    titre: 'N°',          x: 0,   largeur: 26 },
  { cle: 'commande', titre: 'Commande',   x: 26,  largeur: 88 },
  { cle: 'suivi',   titre: 'N° de suivi', x: 114, largeur: 170 },
  { cle: 'poids',   titre: 'Poids',       x: 284, largeur: 60 },
  { cle: 'date',    titre: 'Étiquetée',   x: 344, largeur: 100 }
];

const LIGNE_H = 16;

/**
 * L'expéditeur, quelle que soit la forme que le contrat lui donne.
 *
 * Colissimo range l'adresse en `sender.company_name` / `line2` / `zip_code`,
 * Mondial Relay en `sender.lastname` / `streetname` / `postcode` : le
 * récapitulatif doit s'accommoder des deux sans qu'on duplique un gabarit par
 * transporteur.
 *
 * @param {object} settings - réglages du contrat
 * @returns {{nom: string, lignes: string[]}}
 */
const lireExpediteur = (settings = {}) => {
  const s = settings.sender || {};
  const nom = s.company_name || s.lastname || s.name || 'SAS EMC';
  const rue = s.line2 || [s.house_no, s.streetname].filter(Boolean).join(' ') || s.address || '';
  const cp = s.zip_code || s.postcode || s.zipcode || '';
  const ville = s.city || s.town || '';
  return { nom, lignes: [rue, [cp, ville].filter(Boolean).join(' ')].filter(Boolean) };
};

/** Coupe un texte à la largeur d'une colonne, en points. */
const couper = (texte, font, taille, largeur) => {
  let t = String(texte == null ? '' : texte);
  while (t.length > 1 && font.widthOfTextAtSize(t, taille) > largeur - 6) t = t.slice(0, -1);
  return t;
};

// Hauteurs réservées, en points. Le cartouche de signature n'est pris que sur
// la DERNIÈRE page : sur les autres, il volerait une dizaine de colis par page.
const HAUT_PREMIERE = 168;   // en-tête complet
const HAUT_SUIVANTE = 74;    // rappel de titre
const BAS_DERNIERE = 120;    // cartouche de signature
const BAS_AUTRE = 46;

/**
 * Répartit les lignes sur les pages.
 *
 * Fonction pure, et exportée pour le banc : c'est elle qui, mal réglée, perdrait
 * un colis entre deux pages — un colis remis qui ne figure sur aucun papier,
 * exactement ce que le récapitulatif est censé empêcher.
 *
 * @param {Array} lignes
 * @returns {{lignes: Array, premiere: boolean, derniere: boolean}[]} au moins une page
 */
const decouperEnPages = (lignes) => {
  const pages = [];
  let reste = lignes.slice();

  while (reste.length > 0 || pages.length === 0) {
    const premiere = pages.length === 0;
    const hautUtile = PAGE.hauteur - (premiere ? HAUT_PREMIERE : HAUT_SUIVANTE);
    // On suppose d'abord que la page n'est pas la dernière ; si tout tient avec
    // le cartouche, elle l'est.
    const capaciteAvecPied = Math.floor((hautUtile - BAS_DERNIERE) / LIGNE_H);
    const capaciteSansPied = Math.floor((hautUtile - BAS_AUTRE) / LIGNE_H);

    if (reste.length <= capaciteAvecPied) {
      pages.push({ lignes: reste, derniere: true, premiere });
      reste = [];
    } else if (reste.length <= capaciteSansPied + capaciteAvecPied) {
      // Ce qui reste tient sur deux pages : on les équilibre. Sans ça, une
      // page pleine laisserait un seul colis sur la suivante, et le cartouche
      // de signature se retrouverait seul au bas d'une feuille blanche — un
      // papier qu'on oublie d'emporter, donc de faire signer.
      const prises = Math.min(capaciteSansPied, Math.ceil(reste.length / 2));
      pages.push({ lignes: reste.slice(0, prises), derniere: false, premiere });
      reste = reste.slice(prises);
    } else {
      pages.push({ lignes: reste.slice(0, capaciteSansPied), derniere: false, premiere });
      reste = reste.slice(capaciteSansPied);
    }
  }

  return pages;
};

/**
 * Produit le récapitulatif de remise.
 *
 * @param {object} input
 * @param {string} input.carrierLabel - nom du transporteur affiché en titre
 * @param {string} input.number       - numéro du récapitulatif (MR-20260923-01)
 * @param {string} input.accountLabel - contrat, pour lever l'ambiguïté quand il y en a plusieurs
 * @param {object} input.settings     - réglages du contrat (expéditeur)
 * @param {Array}  input.parcels      - lignes de shipment_labels
 * @param {Date}   [input.now]
 * @returns {Promise<string>} le PDF en base64
 */
const buildDepositSlipPdf = async ({ carrierLabel, number, accountLabel, settings, parcels, now = new Date() }) => {
  const pdf = await PDFDocument.create();
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const gras = await pdf.embedFont(StandardFonts.HelveticaBold);

  const expediteur = lireExpediteur(settings);
  const dateParis = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(now);
  const heureParis = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit'
  }).format(now);

  const lignes = parcels.map((p, i) => ({
    rang: String(i + 1),
    commande: `#${p.order_number}`,
    suivi: p.tracking_number || '—',
    poids: p.weight_g ? `${p.weight_g} g` : '—',
    date: p.created_at
      ? new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit' })
        .format(new Date(p.created_at))
      : '—'
  }));

  const pages = decouperEnPages(lignes);

  pages.forEach((contenu, index) => {
    const page = pdf.addPage([PAGE.largeur, PAGE.hauteur]);
    const x0 = MARGE;
    let y = PAGE.hauteur - MARGE;

    if (contenu.premiere) {
      page.drawText('Bordereau de remise', { x: x0, y: y - 16, size: 18, font: gras, color: NOIR });
      page.drawText(carrierLabel, { x: x0, y: y - 36, size: 13, font: normal, color: GRIS });

      // Le numéro, aligné à droite : c'est ce qu'on cherche en premier quand on
      // ressort le papier d'un classeur.
      const largeurNum = gras.widthOfTextAtSize(number, 15);
      page.drawText(number, { x: PAGE.largeur - MARGE - largeurNum, y: y - 16, size: 15, font: gras, color: NOIR });
      const sousTitre = `${dateParis} à ${heureParis}`;
      const largeurSous = normal.widthOfTextAtSize(sousTitre, 10);
      page.drawText(sousTitre, { x: PAGE.largeur - MARGE - largeurSous, y: y - 34, size: 10, font: normal, color: GRIS });

      y -= 60;
      page.drawLine({
        start: { x: x0, y }, end: { x: PAGE.largeur - MARGE, y },
        thickness: 1, color: TRAIT
      });

      y -= 20;
      page.drawText('Expéditeur', { x: x0, y, size: 9, font: gras, color: GRIS });
      page.drawText(expediteur.nom, { x: x0, y: y - 14, size: 11, font: normal, color: NOIR });
      expediteur.lignes.forEach((l, i) => {
        page.drawText(l, { x: x0, y: y - 28 - i * 12, size: 10, font: normal, color: GRIS });
      });

      const xDroite = PAGE.largeur / 2 + 20;
      page.drawText('Colis remis', { x: xDroite, y, size: 9, font: gras, color: GRIS });
      page.drawText(`${lignes.length} colis`, { x: xDroite, y: y - 14, size: 11, font: gras, color: NOIR });
      page.drawText(`Contrat ${accountLabel}`, { x: xDroite, y: y - 28, size: 10, font: normal, color: GRIS });
      // Dire ce qu'est ce papier, pour qu'on ne le prenne pas pour une pièce du
      // transporteur : c'est nous qui l'émettons.
      page.drawText(`Document émis par YouVape Apps — ${carrierLabel} ne fournit pas de bordereau.`, {
        x: x0, y: y - 56, size: 8.5, font: normal, color: GRIS
      });

      y -= 76;
    } else {
      page.drawText(`Bordereau de remise ${number} — ${carrierLabel}`, {
        x: x0, y: y - 12, size: 11, font: gras, color: NOIR
      });
      y -= 34;
    }

    // En-tête du tableau
    page.drawLine({ start: { x: x0, y }, end: { x: PAGE.largeur - MARGE, y }, thickness: 1, color: TRAIT });
    y -= 13;
    COLONNES.forEach(c => {
      page.drawText(c.titre, { x: x0 + c.x, y, size: 8.5, font: gras, color: GRIS });
    });
    y -= 6;
    page.drawLine({ start: { x: x0, y }, end: { x: PAGE.largeur - MARGE, y }, thickness: 1, color: TRAIT });

    contenu.lignes.forEach((l, i) => {
      y -= LIGNE_H;
      COLONNES.forEach(c => {
        page.drawText(couper(l[c.cle], normal, 9.5, c.largeur), {
          x: x0 + c.x, y, size: 9.5,
          font: c.cle === 'suivi' ? gras : normal,
          color: c.cle === 'rang' ? GRIS : NOIR
        });
      });
      if (i < contenu.lignes.length - 1) {
        page.drawLine({
          start: { x: x0, y: y - 5 }, end: { x: PAGE.largeur - MARGE, y: y - 5 },
          thickness: 0.4, color: TRAIT
        });
      }
    });

    y -= 12;
    page.drawLine({ start: { x: x0, y }, end: { x: PAGE.largeur - MARGE, y }, thickness: 1, color: TRAIT });

    if (contenu.derniere) {
      // Cartouche de signature : c'est tout l'intérêt du papier.
      y -= 34;
      const moitie = (PAGE.largeur - 2 * MARGE) / 2;
      page.drawText('Remis par (nom)', { x: x0, y, size: 9, font: gras, color: GRIS });
      page.drawText('Reçu par le chauffeur (nom et signature)', { x: x0 + moitie, y, size: 9, font: gras, color: GRIS });
      y -= 42;
      page.drawLine({ start: { x: x0, y }, end: { x: x0 + moitie - 24, y }, thickness: 0.8, color: TRAIT });
      page.drawLine({ start: { x: x0 + moitie, y }, end: { x: PAGE.largeur - MARGE, y }, thickness: 0.8, color: TRAIT });
    }

    const pied = `Page ${index + 1} / ${pages.length}`;
    page.drawText(pied, {
      x: PAGE.largeur - MARGE - normal.widthOfTextAtSize(pied, 8.5),
      y: MARGE - 14, size: 8.5, font: normal, color: GRIS
    });
    page.drawText(`${number} — ${lignes.length} colis`, {
      x: x0, y: MARGE - 14, size: 8.5, font: normal, color: GRIS
    });
  });

  return Buffer.from(await pdf.save()).toString('base64');
};

module.exports = { buildDepositSlipPdf, lireExpediteur, decouperEnPages };
