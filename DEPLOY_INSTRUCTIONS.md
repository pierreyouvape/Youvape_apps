# Instructions de déploiement - Page Détail Produit

## ✅ Modifications effectuées

### Backend
- **Correction critique** dans `backend/src/services/productStatsService.js`
  - Ligne 22 et 34 : `parent_id` → `wp_parent_id`
  - Cela corrige l'erreur sur `/api/products/:id/stats/kpis`

### Frontend
- **Nouveaux composants de graphiques** dans `frontend/src/components/charts/` :
  - `SalesTimelineChart.jsx`
  - `SalesByDayOfWeekChart.jsx`
  - `SalesByHourChart.jsx`
  - `SalesByCountryPieChart.jsx`

- **Page ProductDetail.jsx complètement refactorisée** avec :
  - Graphiques interactifs (Recharts)
  - Toggle jour/semaine/mois pour l'évolution des ventes
  - Ventes par jour de la semaine
  - Ventes par heure
  - Pie chart des ventes par pays
  - Sections mieux organisées

## 🚀 Commandes de déploiement

### 1. Sur ton VPS (SSH)

```bash
# Se connecter au VPS
ssh root@54.37.156.233

# Aller dans le dossier du projet
cd /root/Youvape_apps

# Mettre à jour le code depuis Git (si tu utilises Git)
git pull

# OU si tu synchronises manuellement :
# Copie les fichiers modifiés depuis ton local vers le VPS

# Redémarrer le backend
cd backend
pm2 restart backend

# Rebuilder le frontend
cd ../frontend
npm run build

# Copier le build vers le dossier servi par Nginx/Apache
# (adapter selon ta config serveur)
# Par exemple :
cp -r dist/* /var/www/html/
# OU
cp -r dist/* /usr/share/nginx/html/
```

### 2. Ou localement puis upload

```bash
# Dans le dossier frontend local
cd /Users/pierremerle/Documents/Youvape/Youvape_apps/frontend
npm run build

# Uploader le dossier dist vers le VPS
scp -r dist/* root@54.37.156.233:/var/www/html/
# OU utiliser rsync
rsync -avz dist/ root@54.37.156.233:/var/www/html/

# Uploader le backend modifié
cd ../backend
scp src/services/productStatsService.js root@54.37.156.233:/root/Youvape_apps/backend/src/services/

# Redémarrer le backend sur le VPS
ssh root@54.37.156.233 "cd /root/Youvape_apps/backend && pm2 restart backend"
```

## 🧪 Test après déploiement

1. **Tester l'endpoint KPIs corrigé** :
```bash
curl -s "http://54.37.156.233:3000/api/products/6518/stats/kpis"
# Devrait retourner {"success": true, "data": {...}}
```

2. **Accéder à la page produit** :
```
http://54.37.156.233/products/6518
```

3. **Vérifier que tous les graphiques s'affichent** :
   - ✅ Évolution des ventes (avec toggle jour/semaine/mois)
   - ✅ Ventes par jour de la semaine
   - ✅ Ventes par heure
   - ✅ Sales by Country (pie chart + tableau)
   - ✅ Tableau des variations
   - ✅ KPIs (6 cartes)

## 📝 Fichiers modifiés

### Backend
- `backend/src/services/productStatsService.js`

### Frontend
- `frontend/src/pages/ProductDetail.jsx` (refactorisation complète)
- `frontend/src/components/charts/SalesTimelineChart.jsx` (nouveau)
- `frontend/src/components/charts/SalesByDayOfWeekChart.jsx` (nouveau)
- `frontend/src/components/charts/SalesByHourChart.jsx` (nouveau)
- `frontend/src/components/charts/SalesByCountryPieChart.jsx` (nouveau)

## ⚠️ Important

- Le backend **DOIT** être redémarré pour corriger l'erreur `parent_id`
- Le frontend **DOIT** être rebuild avec `npm run build`
- Vide le cache du navigateur (Ctrl+Shift+R) après déploiement si la page ne change pas

## 🎨 Améliorations apportées

Par rapport à Metorik :
- ✅ Graphiques plus modernes et interactifs
- ✅ Toggle de granularité temporelle (jour/semaine/mois)
- ✅ Navigation fluide vers clients/produits/commandes
- ✅ Design cohérent avec la charte YouVape (#135E84)
- ✅ Responsive et mobile-friendly
- ✅ Toutes les données déjà disponibles via les endpoints existants
