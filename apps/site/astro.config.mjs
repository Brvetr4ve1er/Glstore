// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://shinobishop.dz',
  build: { format: 'directory' },
  // No integrations needed — Astro renders to static HTML by default.
  // Decap CMS is a separate /admin/ static page; no server runtime.
});
