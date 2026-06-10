// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://shinobishop.dz',
  build: { format: 'directory' },
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/admin') && !page.includes('/404'),
    }),
  ],
  // Decap CMS is a separate /admin/ static page; no server runtime.
});
