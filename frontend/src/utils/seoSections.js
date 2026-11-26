/**
 * Les sept écrans de Suivi SEO, devenus des APPS de la pile « Suivi SEO »
 * (onglets d'une seule page `/seo` jusqu'au 26/11/2026).
 *
 * Même montage que les sections d'Achats (utils/purchaseSections.js) : cette liste
 * sert aux routes (App.jsx) ET à la page qui les rend (SeoApp.jsx). Libellé, icône
 * et couleur vivent dans APPS (components/AppIcons.jsx), seule source de vérité.
 */
export const SEO_SECTION_KEYS = ['positions', 'cibles', 'page', 'recommandations', 'redaction', 'mots-cles', 'visibilite-ia'];

/** L'entrée APPS d'une section, retrouvée par son adresse. */
export function appOfSeoSection(apps, key) {
  return apps.find((a) => a.path === `/seo/${key}`);
}
