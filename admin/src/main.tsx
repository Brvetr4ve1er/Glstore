import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { applyTheme, loadCachedTheme } from '@/lib/theme'

// First-paint theme: read from localStorage synchronously so the page
// doesn't flash in the canonical palette before the user-saved one lands.
// The Settings page (and a small fetcher in App.tsx) refreshes from the
// server in the background and applies the authoritative copy.
const cached = loadCachedTheme('admin')
if (cached) applyTheme(cached, 'admin')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
