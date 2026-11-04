import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import axios from 'axios'
import './index.css'
// Feuilles d'écran aux classes GLOBALES (.btn, .tab-button, .alert, .loading…) dont
// d'autres écrans profitent sans les importer. Chargées ici, partout et dans cet
// ordre, comme du temps où toute l'app tenait dans un seul fichier — chargées
// avec leur seul écran (utils/lazyPage.js), elles manqueraient aux autres.
import './pages/SettingsApp.css'
import './pages/PurchasesApp.css'
import App from './App.jsx'

// Intercepteur global : attache le token JWT (localStorage) à chaque requête axios.
// Indispensable maintenant que les routeurs de données backend exigent l'auth :
// beaucoup d'appels de lecture (stats produits/clients/marques…) ne posaient pas
// le header à la main.
//
// Un Authorization posé à la main est REMPLACÉ s'il n'est pas la session en
// cours du navigateur. Sur un poste de préparation, la personne change sans que
// les pages se rechargent (StationLock) : un écran ouvert avant le changement
// garde l'ancien jeton dans ses variables, et ses actions (étiquette « emballée
// par »…) partiraient au nom de la personne précédente. Seulement vers NOTRE API.
const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '')
const isOurApi = (url) => {
  if (!url) return false
  try {
    const u = new URL(url, window.location.origin)
    const base = new URL(API_BASE, window.location.origin)
    return (u.origin === window.location.origin && u.pathname.startsWith('/api/'))
      || (u.origin === base.origin && u.pathname.startsWith(`${base.pathname.replace(/\/$/, '')}/`))
  } catch {
    return false
  }
}
/** En-tête à envoyer : la session en cours, sauf jeton d'une autre nature (pas « Bearer »). */
const currentAuth = (existing, token) => {
  if (!token) return existing || null
  if (!existing || /^Bearer\s/i.test(existing)) return `Bearer ${token}`
  return existing
}

axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  const url = config.baseURL && config.url && !/^https?:/i.test(config.url)
    ? `${config.baseURL.replace(/\/$/, '')}/${config.url.replace(/^\//, '')}`
    : config.url
  const existing = config.headers?.Authorization
  if (token && (!existing || isOurApi(url))) {
    config.headers = config.headers || {}
    config.headers.Authorization = currentAuth(existing, token)
  }
  return config
})

// Même chose pour `fetch` : l'app SAV l'utilise partout et ses routes
// d'écriture exigent le jeton (droit `tickets` lecture / écriture). Seulement
// vers NOTRE API (`/api/…`).
const nativeFetch = window.fetch.bind(window)
window.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : null)
  const token = localStorage.getItem('token')
  if (!token || !isOurApi(url)) return nativeFetch(input, init)
  const headers = new Headers(init.headers || {})
  headers.set('Authorization', currentAuth(headers.get('Authorization'), token))
  return nativeFetch(input, { ...init, headers })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
