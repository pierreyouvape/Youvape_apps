import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import axios from 'axios'
import './index.css'
import App from './App.jsx'

// Intercepteur global : attache le token JWT (localStorage) à chaque requête axios.
// Indispensable maintenant que les routeurs de données backend exigent l'auth :
// beaucoup d'appels de lecture (stats produits/clients/marques…) ne posaient pas
// le header à la main. Ne pas écraser un Authorization déjà défini explicitement.
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token && !config.headers?.Authorization) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
