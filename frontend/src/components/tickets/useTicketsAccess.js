import { useContext } from 'react';
import { AuthContext } from '../../context/AuthContext';

// Deux niveaux sur l'app SAV (droit `tickets`) :
//   - lecture  : consulter, notes internes, nouveau ticket en note interne,
//                lier un n° de commande — rien ne part au client ;
//   - écriture : plein accès (répondre, créer, statut, champs, fusion, réglages).
// C'est le backend (savRoutes) qui fait foi ; ici on n'affiche pas ce qui serait refusé.
// Permissions pas encore chargées → plein accès affiché : c'est le cas de
// tous les comptes actuels, et le serveur refuse de toute façon.
export default function useTicketsAccess() {
  const { permissions, isSuperAdmin } = useContext(AuthContext);
  const canWrite = isSuperAdmin || !permissions || !!permissions.tickets?.write;
  return { canWrite };
}
