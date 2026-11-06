// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

/* Public URL of the site, used for canonical links, share previews and
 * the sitemap. Netlify sets URL at build time to the site's main
 * address (custom domain once one is connected, else *.netlify.app).
 * SITE_URL lets you force a value anywhere else. */
const SITE = process.env.SITE_URL || process.env.URL || 'https://shinobishop.netlify.app';

// https://astro.build/config
export default defineConfig({
  site: SITE,
  build: { format: 'directory' },
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/admin') && !page.includes('/404'),
    }),
  ],
  // Decap CMS is a separate /admin/ static page; no server runtime.
});
