/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API base, e.g. https://api.example.com/api/v1.
   *  Unset in the all-Vercel same-origin deploy — the app falls back to the
   *  relative "/api/v1", which Vercel rewrites to the Python function. */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
