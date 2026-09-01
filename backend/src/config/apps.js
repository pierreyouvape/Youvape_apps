/**
 * Registre des apps du launcher, côté backend.
 *
 * Sert à donner TOUS les droits au super admin sans réécrire une liste à chaque
 * nouvelle app : c'est l'oubli de cette liste qui rendait une app invisible
 * (tuile absente de l'accueil et de la sidebar) même pour le super admin.
 *
 * ⚠️ À garder synchronisé avec `frontend/src/components/AppIcons.jsx` (APPS),
 * qui reste la source de vérité de l'affichage (libellé, icône, couleur).
 */
const APP_KEYS = [
  'customers',
  'reviews',
  'rewards',
  'emails',
  'stats',
  'purchases',
  'purchases-v2',
  'reception',
  'packing',
  'catalog',
  'financier',
  'commandes',
  'tickets',
  'chronopost',
  'colissimo',
  'lettre-suivie',
  'mondial-relay',
  'transporteurs',
  'veille',
  'inscrits',
  'promos',
  'boutique-mtp',
  'boutique-cast',
  'process',
];

/** Permissions complètes (lecture + écriture) sur toutes les apps. */
const allPermissions = () =>
  Object.fromEntries(APP_KEYS.map((key) => [key, { read: true, write: true }]));

module.exports = { APP_KEYS, allPermissions };
