/* Astro content collections.
 *
 * Owners do NOT edit these files directly — they edit through the
 * Decap CMS admin panel at /admin/, which writes well-formed JSON
 * into these collection folders and commits to GitHub.
 *
 * Schemas validate at build time so a broken edit can't ship.
 */
import { defineCollection, z } from 'astro:content';

const bases = defineCollection({
  type: 'data',
  schema: z.object({
    id: z.string(),                          // "tshirt" | "sweat" | "pull" | "tote" | "mug"
    name: z.string(),                        // "T-shirt oversize"
    price: z.number(),                       // base price in DZD
    doubleSideAllowed: z.boolean().default(true),
    extraDoubleSide: z.number().default(500),
    icon: z.string().default('👕'),          // emoji used as preview when no image
    order: z.number().default(0),            // sort order in the builder
  }),
});

const designs = defineCollection({
  type: 'data',
  schema: z.object({
    id: z.string(),                          // "gojo"
    name: z.string(),                        // "Gojo Satoru"
    anime: z.string(),                       // "Jujutsu Kaisen"
    image: z.string(),                       // "/images/designs/gojo.png" (or emoji)
    isEmoji: z.boolean().default(false),     // true if `image` is an emoji
    tagColor: z.enum([
      'naruto','jjk','onepiece','dbz','bleach','aot','deathnote','bluelock','original'
    ]).default('original'),
    featured: z.boolean().default(false),    // appears on home page
    order: z.number().default(0),
  }),
});

export const collections = { bases, designs };
