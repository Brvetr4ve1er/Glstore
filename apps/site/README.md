# SHINOBI Shop — Site officiel

> Site statique pour [SHINOBI Shop](https://instagram.com/shinobishopdz),
> boutique d'anime streetwear personnalisé à Bab Ezzouar, Alger.
>
> Les commandes arrivent sur WhatsApp ou Instagram — pas de
> e-commerce, pas de compte à gérer, pas de paiement en ligne. Un beau
> catalogue, un **designer façon Printify** (importe ton image → le
> fond est enlevé → tu l'appliques sur un mockup produit), et un bouton
> qui envoie la commande + le visuel + le fichier d'impression sur
> WhatsApp.

## Le designer (page `/custom`)

C'est le cœur du site. Fonctionne **entièrement dans le navigateur** —
aucun serveur, aucune API payante.

1. **Choisis un produit** → un mockup vectoriel s'affiche (t-shirt,
   sweat/pull à capuche, mug, tote), recolorable.
2. **Importe ton image** (ou prends un design de la galerie). Le **fond
   est enlevé automatiquement** par un découpage chroma (remplissage
   depuis les bords) — instantané, sans réseau. Pour les photos
   complexes, un bouton « Découpe IA » charge un modèle ONNX
   (`@imgly/background-removal`, ≈40 Mo) à la demande.
   - Réglages : curseur de sensibilité · **pipette** (clique la couleur
     de fond à enlever) · **garder l'original**.
3. **Place le design** sur la zone d'impression : glisse pour déplacer,
   curseurs taille + rotation, boutons Centrer / Ajuster.
4. **Commande.** Sur **mobile**, le visuel + le fichier d'impression
   partent directement dans WhatsApp via le partage natif
   (`navigator.share` avec fichiers). Sur **ordinateur**, ils se
   téléchargent et WhatsApp s'ouvre pré-rempli — il suffit de les
   joindre au message.

Le code du designer vit dans `src/lib/` (logique pure, testable) et
`src/scripts/builder.ts` (le contrôleur DOM).

## Ce qu'il y a dans la boîte

```
apps/site/
├─ src/
│  ├─ pages/            # Accueil · Designer (/custom) · Boutique
│  ├─ components/       # Header · Footer
│  ├─ layouts/Base.astro
│  ├─ lib/              # ◆ le moteur du designer (pur, sans DOM)
│  │  ├─ mockups.ts     #   mockups SVG produits + zones d'impression
│  │  ├─ bg-remove.ts   #   découpe de fond (chroma + IA)
│  │  ├─ compositor.ts  #   placement + rendu canvas + export PNG
│  │  └─ order.ts       #   partage WhatsApp (Web Share API + repli)
│  ├─ scripts/
│  │  └─ builder.ts     #   contrôleur DOM du designer
│  ├─ content/          # Données éditables par l'admin (JSON)
│  │  ├─ bases/         # T-shirt, sweat, pull, mug, tote
│  │  ├─ designs/       # Gojo, Sukuna, Luffy, Naruto, …
│  │  └─ site.json      # Marque, contact, boutique, horaires
│  └─ styles/tokens.css # Couleurs, fontes, espacements
├─ public/
│  ├─ admin/            # Panneau d'admin (Decap CMS)
│  │  ├─ index.html
│  │  └─ config.yml
│  ├─ images/designs/   # Images des designs (uploadées depuis l'admin)
│  └─ assets/           # Mascotte + motifs seigaiha
├─ netlify.toml         # Config de déploiement
└─ package.json
```

> **Mockups & zones d'impression** sont définis dans
> `src/lib/mockups.ts` (config développeur — géométrie SVG + rectangle
> de la zone imprimable par produit). Les prix/noms restent éditables
> par l'owner dans `content/bases/*.json`.

## Démarrer en local

```bash
cd apps/site
npm install
npm run dev          # → http://localhost:4321
```

Pages disponibles :
- `/` — accueil
- `/custom` — le builder
- `/boutique` — infos boutique + LocalBusiness JSON-LD
- `/admin/` — panneau d'admin (besoin de Netlify Identity en prod)

## Construire pour la production

```bash
npm run build        # → apps/site/dist/  (HTML / CSS / JS statiques)
npm run preview      # vérifie le build localement
```

Le contenu de `dist/` peut se déposer sur n'importe quel hébergeur
statique (Netlify, Vercel, Cloudflare Pages, GitHub Pages, OVH).
**Aucun serveur, aucune base de données.**

## Déployer sur Netlify (recommandé)

Netlify est gratuit, héberge le site + le panneau d'admin + gère les
logins de l'owner avec un email/mot de passe.

1. Pousser le repo sur GitHub.
2. Sur netlify.com → **Add new site → Import an existing project**.
3. Choisir le repo. Netlify lit `apps/site/netlify.toml` et configure
   tout seul (build = `npm run build`, publish = `dist`).
4. Une fois déployé, dans le dashboard Netlify :
   - **Site settings → Identity → Enable Identity**
   - **Identity → Registration → Invite only**
   - **Identity → Services → Git Gateway → Enable**
5. Inviter l'owner par email depuis Netlify (Identity → Invite users).
6. L'owner reçoit l'email, crée un mot de passe, et peut se connecter
   sur `https://[le-site].netlify.app/admin/`.

C'est tout. À partir de là, l'owner ajoute / retire des designs,
change les prix, et met à jour le numéro WhatsApp depuis une UI
visuelle.

## Comment ça marche, côté commande

1. Le visiteur ouvre `/custom`.
2. Il choisit base → design → côté(s) → taille → couleur.
3. Le prix se calcule en temps réel à partir des fichiers
   `src/content/bases/*.json`.
4. Le bouton **"Commander sur WhatsApp"** ouvre
   `wa.me/{numéro}?text=...` avec la commande pré-remplie dans le
   champ de message.
5. Le visiteur ajoute son prénom / wilaya / téléphone et envoie.
6. L'owner reçoit le message dans WhatsApp et gère la suite comme
   d'habitude.

Pour Instagram, le bouton **"Copier la commande"** met le texte dans
le presse-papier ; le visiteur ouvre la DM et colle. (Instagram n'a
pas d'API pour pré-remplir les messages — on contourne avec un
copier/coller en un clic.)

## Éditer le contenu sans code

### Pendant le développement local

```bash
# 1. Lance le serveur Astro
npm run dev

# 2. Dans un AUTRE terminal, lance le proxy Decap local
npx decap-server
```

Décommente la dernière ligne de `public/admin/config.yml` :
```yml
local_backend: true
```

Maintenant `http://localhost:4321/admin/` édite les fichiers JSON
directement sur disque, sans GitHub.

### En production

L'owner se connecte sur `https://[le-site].netlify.app/admin/`,
édite via l'UI, valide. Decap commit la modification sur GitHub,
Netlify re-construit et redéploie automatiquement. **Pas de code.**

## Personnaliser

| Pour changer… | Édite… |
|---|---|
| Le numéro WhatsApp | `src/content/site.json` → `contact.whatsappNumber` |
| Les prix de base | `src/content/bases/*.json` → `price` |
| Le supplément recto+verso | `src/content/bases/*.json` → `extraDoubleSide` |
| Ajouter un design | nouveau fichier dans `src/content/designs/` |
| Les horaires | `src/content/site.json` → `boutique.hours` |
| La phrase d'accroche | `src/content/site.json` → `hero.title` |
| Les couleurs / fontes | `src/styles/tokens.css` |

## Points techniques

- **Astro 5** rend tout en HTML statique au build → site très rapide,
  zéro JavaScript côté client sauf le builder.
- Le builder est **JavaScript vanilla** (~150 lignes), pas de
  framework, lit son catalogue depuis un `<script type="application/json">`
  embarqué dans la page.
- **Decap CMS 3** est un éditeur visuel pour Git — il commit des
  changements dans le repo, ce qui déclenche un rebuild Netlify.
- **WhatsApp Click-to-Chat** (`wa.me/...?text=...`) est officiel et
  pré-remplit le message dans le champ. Le visiteur peut éditer
  avant d'envoyer.
- **Schema.org `ClothingStore`** sur `/boutique` pour Google Maps /
  Knowledge Panel.
- **Pas de tracking par défaut** — ajoute Plausible si besoin.

## Coût d'exploitation : 0 €

- Hébergement : gratuit (Netlify free tier, 100 GB / mois).
- Domaine : ~10 € / an (optionnel — `*.netlify.app` est gratuit).
- Pas de base de données.
- Pas de serveur.
- Pas de Stripe.
- Pas d'abonnement Shopify.

L'owner peut faire évoluer le site sans repasser par un dev.
