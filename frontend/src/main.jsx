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

// Même chose pour `fetch` : l'app SAV l'utilise partout et ses routes
// d'écriture exigent le jeton (droit `tickets` lecture / écriture). Seulement
// vers NOTRE API (`/api/…`), et sans écraser un Authorization déjà posé.
const nativeFetch = window.fetch.bind(window)
window.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : null)
  const token = localStorage.getItem('token')
  const isOurApi = url && (url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`))
  if (!token || !isOurApi) return nativeFetch(input, init)
  const headers = new Headers(init.headers || {})
  if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
  return nativeFetch(input, { ...init, headers })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
