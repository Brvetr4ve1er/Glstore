/// <reference types="astro/client" />

// Optional AI background removal, loaded from a CDN only when the customer asks for it.
declare module 'https://esm.sh/@imgly/background-removal@1.5.8' {
  export function removeBackground(src: Blob, config?: unknown): Promise<Blob>;
  const _default: typeof removeBackground;
  export default _default;
}
