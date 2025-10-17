# TODO - Système de permissions utilisateurs

## ✅ Fait (Backend)
1. ✅ Migration SQL créée (`add_permissions.sql`)
2. ✅ Modèle `userPermissionsModel.js` créé
3. ✅ Controller `usersController.js` créé
4. ✅ Routes `/api/users` créées
5. ✅ Routes ajoutées dans `server.js`

## 🔴 À FAIRE IMMÉDIATEMENT (pour que ça fonctionne)

### 1. Exécuter la migration SQL
```bash
docker exec -it youvape_postgres psql -U youvape -d youvape_db -f /app/backend/src/config/add_permissions.sql
```
OU directement :
```bash
docker exec -it youvape_postgres psql -U youvape -d youvape_db < backend/src/config/add_permissions.sql
```

### 2. Redémarrer le backend
```bash
docker restart youvape_backend
```

## 📋 À FAIRE ENSUITE (Backend)

### 3. Créer le middleware de vérification des permissions
Fichier : `backend/src/middleware/permissionMiddleware.js`
- Fonction `checkPermission(appName, permissionType)` qui vérifie si l'utilisateur a les droits
- Protège automatiquement youvape34@gmail.com (tous les droits)

### 4. Protéger les routes existantes
Ajouter le middleware sur :
- `/api/reviews/*` - vérifier permission "reviews"
- `/api/rewards/*` - vérifier permission "rewards"
- `/api/emails/*` - vérifier permission "emails"

Exemple :
```js
router.get('/config', checkPermission('reviews', 'read'), reviewsController.getConfig);
router.post('/config', checkPermission('reviews', 'write'), reviewsController.saveConfig);
```

## 📋 À FAIRE (Frontend)

### 5. Modifier AuthContext
Fichier : `frontend/src/context/AuthContext.jsx`
- Ajouter `permissions` et `isAdmin` dans le state
- Charger les permissions au login via `/api/users/me/permissions`
- Exposer les permissions dans le contexte

### 6. Créer la page Settings
Fichier : `frontend/src/pages/SettingsApp.jsx`
- Onglet "Gestion des utilisateurs"
- Tableau avec liste des users
- Pour chaque user :
  - Checkbox "Administrateur"
  - Checkboxes pour chaque app (Lecture / Écriture)
    - [ ] Avis Garantis - Lecture / Écriture
    - [ ] Récompense - Lecture / Écriture
    - [ ] Emails - Lecture / Écriture
- Bouton "Sauvegarder" pour chaque utilisateur
- Bouton "Supprimer" (sauf super admin)
- Protection : youvape34@gmail.com non modifiable (griser les champs)

### 7. Ajouter la route /settings
Fichier : `frontend/src/App.jsx`
```jsx
import SettingsApp from './pages/SettingsApp';

<Route path="/settings" element={
  <PrivateRoute>
    <SettingsApp />
  </PrivateRoute>
} />
```

### 8. Ajouter le bouton Paramètres dans Home
Fichier : `frontend/src/pages/Home.jsx`
- En haut à droite, à côté du bouton "Se déconnecter"
- Icône ⚙️ ou texte "Paramètres"
- Visible uniquement pour les admins
- `navigate('/settings')`

### 9. Cacher les cartes d'apps selon permissions
Fichier : `frontend/src/pages/Home.jsx`
- Utiliser `permissions` du AuthContext
- N'afficher que les cartes où `permissions[appName].read === true`
- Si aucun droit : afficher message "Aucune application accessible. Contactez un administrateur."

### 10. Gérer les permissions dans les apps
- Désactiver les boutons d'écriture si `write === false`
- Exemple dans ReviewsApp : si `!permissions.reviews.write`, désactiver boutons "Sauvegarder", "Créer", etc.

## 🔒 Protections en place

- ✅ `youvape34@gmail.com` = super admin immuable (codé en dur)
- ✅ Impossible de modifier/supprimer le super admin
- ✅ Nouveaux utilisateurs = aucun droit (home vide)
- ✅ Seuls les admins peuvent gérer les utilisateurs

## 📊 Structure des permissions

```javascript
{
  is_super_admin: false,
  is_admin: true,
  permissions: {
    reviews: { read: true, write: false },
    rewards: { read: true, write: true },
    emails: { read: false, write: false }
  }
}
```

## 🎯 Liste des apps à gérer
- `reviews` - Avis Garantis
- `rewards` - Récompense Avis
- `emails` - Envoi d'Emails

## ⚠️ Points d'attention

1. Toujours vérifier `isSuperAdmin(email)` avant toute opération sensible
2. Le super admin bypass toutes les vérifications de permissions
3. Les permissions sont vérifiées côté backend ET frontend (frontend = UX, backend = sécurité)
4. Un utilisateur sans aucun droit voit une home vide avec message d'info
