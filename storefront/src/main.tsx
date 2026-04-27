import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import {
  applyTheme, loadCached, refreshThemeFromServer, bindCrossTabSync, bindPreviewChannel,
} from '@/lib/theme'

// Theme bootstrap (Phase 9 Push 3):
//   1) Apply the cached theme synchronously so first paint matches the
//      admin-chosen palette (no flash of canon Bricolage punk-blue if the
//      admin has, say, set the storefront to Paper or Sakura).
//   2) Kick off a background refresh from /api/v1/storefront/theme — if the
//      admin updated the theme since the last visit, the second paint will
//      reflect it without needing a hard reload.
const cached = loadCached()
if (cached) applyTheme(cached)

// Fire-and-forget. Failure keeps the cached/canonical theme; we never
// blank-screen the storefront because of a theme miss.
refreshThemeFromServer()

// Cross-tab sync: if another storefront tab refreshes the cache, mirror
// the change here so every open tab repaints together.
bindCrossTabSync()

// Studio iframe preview channel: when the storefront is loaded inside the
// Theme Studio's preview iframe, accept live theme drafts via postMessage.
// No-op when running standalone (parent === self).
if (window.parent !== window) {
  bindPreviewChannel()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
