/**
 * Les quatre sections de Gestion d'achat, devenues des APPS de la pile Achats.
 *
 * Elles vivaient dans un menu interne à `/purchases`, sous un titre qui répétait
 * celui de la pile : deux niveaux de rangement pour quatre écrans. Chacune a
 * maintenant son adresse — `/purchases/<clé>` — donc son favori, son bouton
 * retour et son lien partageable.
 *
 * Cette liste sert à DEUX endroits qui doivent rester d'accord : les routes
 * (App.jsx) et la page qui les rend (PurchasesApp.jsx). D'où un module à elle
 * plutôt qu'un export posé à côté d'un composant — le rechargement à chaud de
 * Vite ne suit plus un fichier qui exporte les deux.
 *
 * Libellé, icône et couleur ne sont PAS ici : ils vivent dans APPS
 * (components/AppIcons.jsx), seule source de vérité de l'affichage. Les
 * recopier, c'est les voir diverger.
 */
export const SECTION_KEYS = ['besoins', 'fournisseurs', 'commandes', 'depenses'];

/** L'entrée APPS d'une section, retrouvée par son adresse. */
export function appOfSection(apps, key) {
  return apps.find(a => a.path === `/purchases/${key}`);
}
