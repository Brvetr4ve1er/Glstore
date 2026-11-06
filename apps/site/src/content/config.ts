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

/* A design shows its uploaded image when there is one, otherwise its
 * emoji placeholder. Old entries ({ image: "🥷", isEmoji: true }) are
 * still accepted and converted, so nothing breaks after an upgrade. */
const designs = defineCollection({
  type: 'data',
  schema: z.preprocess(
    (raw) => {
      const d = { ...(raw as Record<string, unknown>) };
      if (d.isEmoji === true && typeof d.image === 'string' && !d.emoji) {
        d.emoji = d.image;
        delete d.image;
      }
      delete d.isEmoji;
      if (d.image === '' || d.image === null) delete d.image;
      if (d.emoji === '' || d.emoji === null) delete d.emoji;
      return d;
    },
    z.object({
      id: z.string().regex(/^[a-z0-9-]+$/, 'Identifiant : minuscules, chiffres et tirets uniquement'),
      name: z.string(),                        // "Gojo Satoru"
      anime: z.string(),                       // "Jujutsu Kaisen"
      image: z.string().optional(),            // "/images/designs/gojo.png" (uploaded in /admin/)
      emoji: z.string().optional(),            // "🥷" placeholder until there's an image
      tagColor: z.enum([
        'naruto','jjk','onepiece','dbz','bleach','aot','deathnote','bluelock','original'
      ]).default('original'),
      featured: z.boolean().default(false),    // appears on home page
      order: z.number().default(0),
    }).refine((d) => d.image || d.emoji, { message: 'Ajoute une image ou un emoji au design' }),
  ),
});

export const collections = { bases, designs };
