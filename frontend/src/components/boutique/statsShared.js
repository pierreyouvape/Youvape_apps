import { C } from '../picking/pickingUi';

/** Boutique › Statistiques et Produits dormants : constantes et outils partagés. */

export const MAUVE = '#A21CAF';
export const MAUVE_TRACK = '#FAE8FF';

export const jourParis = (d = new Date()) => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(d);

export const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
export const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

export const champ = {
  padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.greyB}`,
  fontSize: 13.5, fontFamily: 'inherit', color: C.dark, background: C.white,
};

export const carte = {
  background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12, marginBottom: 16,
};

/**
 * Options d'une liste, triées « 10 ml, 50 ml, 100 ml » (ordre numérique), la
 * valeur « Sans… » en dernier. La sélection courante reste proposée même si
 * elle n'a plus de vente sur la nouvelle période.
 */
export const avecSelection = (options = [], valeur) => {
  const liste = [...options].sort((a, b) => (a.id === '__none__') - (b.id === '__none__')
    || a.name.localeCompare(b.name, 'fr', { numeric: true }));
  if (valeur && !liste.some((o) => o.id === valeur)) liste.unshift({ id: valeur, name: 'Aucune vente sur la période' });
  return liste;
};
