# Guide d'implémentation des permissions d'écriture dans les apps

## Hook personnalisé créé

Un hook `usePermissions` a été créé dans `/frontend/src/hooks/usePermissions.js` pour simplifier la gestion des permissions dans les apps.

## Comment l'utiliser dans une app (exemple avec ReviewsApp)

### 1. Importer le hook

```javascript
import { usePermissions } from '../hooks/usePermissions';
```

### 2. Utiliser le hook dans le composant

```javascript
const ReviewsApp = () => {
  const { token, logout } = useContext(AuthContext);
  const { canWrite, canRead } = usePermissions('reviews'); // 'reviews', 'rewards' ou 'emails'

  // ... reste du code
}
```

### 3. Désactiver les boutons et actions d'écriture

Ajouter `disabled={!canWrite}` sur tous les éléments qui modifient des données :

#### Exemple 1 : Bouton de sauvegarde de config

```javascript
<button
  type="submit"
  disabled={configSaving || !canWrite}  // Ajouter !canWrite
  style={{
    padding: '10px 30px',
    backgroundColor: canWrite ? '#28a745' : '#6c757d',  // Changer la couleur si pas de droits
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: (configSaving || !canWrite) ? 'not-allowed' : 'pointer',
    marginRight: '10px'
  }}
>
  {configSaving ? 'Sauvegarde...' : 'Enregistrer la configuration'}
</button>
```

#### Exemple 2 : Bouton toggle cron

```javascript
<button
  type="button"
  onClick={handleToggleCron}
  disabled={!canWrite}  // Ajouter !canWrite
  style={{
    padding: '10px 20px',
    borderRadius: '8px',
    border: 'none',
    cursor: canWrite ? 'pointer' : 'not-allowed',
    fontWeight: 'bold',
    backgroundColor: config.cron_enabled === 'true' ? '#28a745' : '#6c757d',
    color: 'white',
    opacity: canWrite ? 1 : 0.6,  // Diminuer l'opacité si pas de droits
    transition: 'background-color 0.3s ease'
  }}
>
  {config.cron_enabled === 'true' ? '✓ Récupération auto activée' : '✗ Récupération auto désactivée'}
</button>
```

#### Exemple 3 : Bouton de test API

```javascript
<button
  onClick={handleTestAPI}
  disabled={testLoading || !config.api_key || !canWrite}  // Ajouter !canWrite
  style={{
    padding: '10px 30px',
    backgroundColor: canWrite ? '#007bff' : '#6c757d',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: (testLoading || !config.api_key || !canWrite) ? 'not-allowed' : 'pointer'
  }}
>
  {testLoading ? 'Chargement...' : 'Tester l\'API maintenant'}
</button>
```

#### Exemple 4 : Bouton de suppression

```javascript
<button
  onClick={handleDeleteAllReviews}
  disabled={!canWrite}  // Ajouter !canWrite
  style={{
    padding: '8px 16px',
    backgroundColor: canWrite ? '#dc3545' : '#6c757d',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: canWrite ? 'pointer' : 'not-allowed',
    opacity: canWrite ? 1 : 0.6
  }}
>
  🗑️ Vider tous les avis
</button>
```

#### Exemple 5 : Formulaire de création manuelle

```javascript
<button
  type="submit"
  disabled={manualLoading || !canWrite}  // Ajouter !canWrite
  style={{
    padding: '10px 30px',
    backgroundColor: canWrite ? '#17a2b8' : '#6c757d',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: (manualLoading || !canWrite) ? 'not-allowed' : 'pointer',
    marginTop: '15px'
  }}
>
  {manualLoading ? 'Création...' : 'Créer l\'avis'}
</button>
```

### 4. Afficher un message si l'utilisateur n'a que les droits de lecture

Ajouter en haut de l'app :

```javascript
{!canWrite && (
  <div style={{
    backgroundColor: '#fff3cd',
    color: '#856404',
    padding: '15px',
    borderRadius: '8px',
    marginBottom: '20px',
    border: '1px solid #ffeaa7'
  }}>
    <strong>⚠️ Mode lecture seule</strong> : Vous n'avez que les droits de lecture pour cette application.
    Contactez un administrateur pour obtenir les droits d'écriture.
  </div>
)}
```

### 5. Désactiver les champs de formulaire (optionnel)

Si vous voulez empêcher complètement l'édition des champs :

```javascript
<input
  type="text"
  name="api_key"
  value={config.api_key}
  onChange={handleConfigChange}
  disabled={!canWrite}  // Ajouter !canWrite
  required
  style={{
    width: '100%',
    padding: '8px',
    borderRadius: '4px',
    border: '1px solid #ccc',
    backgroundColor: canWrite ? 'white' : '#f5f5f5',
    cursor: canWrite ? 'text' : 'not-allowed'
  }}
/>
```

## Apps à modifier

1. **ReviewsApp** ([/frontend/src/pages/ReviewsApp.jsx](frontend/src/pages/ReviewsApp.jsx)) :
   - Boutons : Enregistrer config, Toggle cron, Tester API, Créer avis manuel, Vider avis
   - Permissions : `reviews`

2. **RewardsApp** ([/frontend/src/pages/RewardsApp.jsx](frontend/src/pages/RewardsApp.jsx)) :
   - Boutons : Enregistrer config, Test connexion, Lancer processus, Toggle activé, Récompenser manuellement
   - Permissions : `rewards`

3. **EmailApp** ([/frontend/src/pages/EmailApp.jsx](frontend/src/pages/EmailApp.jsx)) :
   - Boutons : Enregistrer config, Test connexion, Lancer envoi, Toggle activé
   - Permissions : `emails`

## Résumé

Pour chaque app, il faut :

1. Importer `usePermissions`
2. Récupérer `canWrite` avec `usePermissions('nom_app')`
3. Ajouter `disabled={!canWrite}` sur tous les boutons d'action
4. Adapter le style (couleur grisée, cursor not-allowed)
5. (Optionnel) Afficher un bandeau d'avertissement en mode lecture seule
6. (Optionnel) Désactiver les champs de formulaire

Cela garantit que :
- Les utilisateurs avec droits de lecture peuvent voir les données
- Seuls les utilisateurs avec droits d'écriture peuvent modifier les données
- L'UI reflète clairement les permissions de l'utilisateur
