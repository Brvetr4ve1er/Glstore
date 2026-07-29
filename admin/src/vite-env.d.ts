/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API base, e.g. https://<project>.vercel.app/api/v1.
   *  Set this to point a locally-run admin at the deployed API so you can
   *  manage the live store. Unset = relative "/api/v1" via the dev proxy. */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
