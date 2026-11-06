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
4. **Recto + Verso.** Le sélecteur sous l'aperçu permet de mettre un
   design différent à l'avant et à l'arrière (sur t-shirt / sweat /
   pull). Ajouter un design au verso ajoute automatiquement +500 DA.
   Mug et tote bag restent à une seule face.
5. **Note pour la boutique** (optionnel) : un champ libre pour les
   instructions (couleur d'encre, taille du logo…), inclus dans le
   message WhatsApp.
5b. **Guide des tailles** intégré à la page : tableau de mensurations
   (poitrine, longueur, épaules, manche) en cm + un mini-recommendeur
   (taille + poids → on suggère la taille → un bouton **Choisir cette
   taille** applique la sélection dans le designer). Source des
   données : `src/lib/size-guide.ts` (éditable).
5c. **Mode "Sur ma photo"** : un toggle au-dessus de l'aperçu remplace
   le mockup produit par une photo de toi (uploadée) — le design se
   superpose. Quand tu commandes, la photo essayée est jointe en plus
   des fichiers d'impression habituels.
5d. **Galerie de designs** (`/galerie`) : tous les designs groupés par
   anime, avec deep-link vers le designer (`/custom/?design=<id>`).
   Clique un design → il s'ouvre directement dans le studio.
6. **Commande** sur WhatsApp ou Instagram, avec quantité, coordonnées
   et livraison / retrait — voir « Comment ça marche, côté commande ».

> **Mockups photo réels** : par défaut les mockups sont des dessins
> vectoriels recolorables. Pour utiliser de vraies photos produit,
> dépose-les dans `public/images/mockups/` et ajoute un bloc `raster`
> au mockup concerné — voir les instructions en bas de
> `src/lib/mockups.ts`.

Le code du designer vit dans `src/lib/` (logique pure, testable) et
`src/scripts/builder.ts` (le contrôleur DOM).

## Le Dojo — programme de fidélité (page `/dojo`)

Un jeu léger qui donne envie de revenir et de commander, sans compte ni
serveur :

- **Chakra 気** gagné en utilisant le site : ouvrir le designer (+10),
  premier design (+20), essayer 5 designs (+30), importer son image
  (+40), ajouter un verso (+30), essayer sur sa photo (+40), guide des
  tailles (+20), page Infos (+10), partager le site (+30), première
  commande (+100), chaque commande suivante (+50), invocation du jour
  (+15).
- **5 rangs** : Minarai 見習 (0) → Genin 下忍 (50) → Chūnin 中忍 (150) →
  Jōnin 上忍 (300) → Shinobi 忍者 (500). Un écran « Nouveau rang »
  s'affiche à chaque passage. Le rang est visible dans l'en-tête.
- **Designs secrets** : un design peut être réservé à un rang. Il
  apparaît en silhouette 🔒 dans les galeries jusqu'à ce rang.
  *(Admin → Designs → « Design secret ? »)*. Trois designs originaux
  sont fournis en exemple : Oni Masqué, Dragon d'Encre, Kitsune Blanc.
- **Invocation du jour** : une fois par jour, un design tiré au sort
  (commun 70 %, rare 25 %, légendaire 5 % — *Admin → Designs →
  Rareté*), à créer directement dans le designer.
- **Cadeaux par rang** *(Admin → Paramètres du site → Le Dojo)* : par
  défaut sticker offert (Chūnin), emballage collector (Jōnin), accès en
  avant-première aux drops (Shinobi). **À adapter à ce que la boutique
  veut vraiment offrir.** Le rang et les cadeaux sont ajoutés au
  message de commande :

```
🥋 Dojo : Chūnin 中忍 · 225 chakra
🎁 Sticker SHINOBI offert avec ta commande (récompense dojo, à confirmer)
```

> La progression est stockée **sur le téléphone du client** (pas de
> compte, pas de suivi). Elle peut donc être trichée : les cadeaux sont
> présentés « à confirmer » et c'est la boutique qui décide. Garde des
> cadeaux symboliques (stickers, emballage, avant-premières) plutôt que
> des remises importantes. Le Dojo se désactive d'un clic dans l'admin.

### Compte à rebours de drop

*Admin → Paramètres du site → Prochain drop* : un nom + une date
affichent un compte à rebours sur l'accueil (« Drop « Collection
Hiver » 14j 01h 59m »). Laisse la date vide pour le cacher.

## Ce qu'il y a dans la boîte

```
apps/site/
├─ src/
│  ├─ pages/            # Accueil · Designer · Galerie · Infos · Boutique · 404
│  ├─ components/       # Header · Footer · DesignThumb
│  ├─ layouts/Base.astro
│  ├─ lib/              # ◆ le moteur du designer (pur, sans DOM)
│  │  ├─ mockups.ts     #   mockups SVG produits + zones d'impression
│  │  ├─ bg-remove.ts   #   découpe de fond (chroma + IA)
│  │  ├─ compositor.ts  #   placement + rendu canvas + export PNG
│  │  ├─ order.ts       #   message + envoi WhatsApp / Instagram
│  │  ├─ size-guide.ts  #   mensurations + recommandation de taille
│  │  ├─ wilayas.ts     #   les 58 wilayas (formulaire de commande)
│  │  └─ dojo.ts        #   Dojo : chakra, rangs, missions, invocation
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
│  ├─ assets/           # Mascotte, motifs seigaiha, icônes, og.png
│  └─ manifest.webmanifest
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
- `/galerie` — tous les designs, groupés par anime
- `/infos` — délai, livraison, paiement, retours, prix, FAQ
- `/dojo` — programme de fidélité : rang, missions, invocation du jour
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

1. Sur netlify.com → **Add new site → Import an existing project** →
   choisir le repo GitHub. Le `netlify.toml` configure le build tout
   seul (`base = apps/site`, `publish = dist`).
2. **Site configuration → Build & deploy → Branches** : la
   *production branch* doit être la branche qui contient le site
   (aujourd'hui `claude/shinobi-shop-rebuild`, plus tard `main` dans
   son propre repo). C'est aussi la branche écrite dans
   `public/admin/config.yml` → `backend.branch` : les deux doivent
   être identiques, sinon l'admin enregistre au mauvais endroit.
3. Dans le dashboard Netlify :
   - **Identity → Enable Identity**
   - **Identity → Registration → Invite only**
   - **Identity → Services → Git Gateway → Enable**
4. **Identity → Invite users** : inviter l'email de l'owner.
5. L'owner clique le lien de l'email : il arrive sur le site, choisit
   un mot de passe, et est envoyé directement sur `/admin/`.
6. (Optionnel) **Domain management** pour brancher un vrai domaine.
   Les liens de partage et le sitemap suivent automatiquement (Netlify
   fournit l'adresse au moment du build).

### Avant la mise en ligne — checklist

- [ ] **Mettre le vrai numéro WhatsApp** : `/admin/` → Paramètres du
      site → Contact → WhatsApp (format `2135XXXXXXXX`, sans le `+`).
      Tant que c'est le numéro de démo, un bandeau jaune s'affiche en
      haut de chaque page.
- [ ] Vérifier le pseudo Instagram, le téléphone, les horaires.
- [ ] Remplacer les emojis des designs par les vraies images (PNG à
      fond transparent) : `/admin/` → Designs → un design → Image.
- [ ] Passer une commande test depuis un téléphone (WhatsApp **et**
      Instagram) et vérifier que le message + les images arrivent.


## Comment ça marche, côté commande

1. Le visiteur ouvre `/custom`, choisit produit → couleur → design →
   taille, place son design (recto et/ou verso).
2. Dans **Ta commande**, il indique la **quantité**, son **prénom**, son
   **téléphone** et choisit **Livraison** (wilaya + commune) ou
   **Retrait en boutique**. Le total se met à jour en direct :
   `(prix + verso) × quantité + livraison`.
   Ses infos sont mémorisées sur son téléphone pour la prochaine fois.
3. Deux boutons :
   - **Commander sur WhatsApp** — sur téléphone, le message + les
     visuels partent directement dans WhatsApp (partage natif). Sur
     ordinateur, les visuels se téléchargent et WhatsApp Web s'ouvre
     avec le message pré-rempli.
   - **Commander sur Instagram** — Instagram ne permet pas de
     pré-remplir un message : le texte de la commande est **copié**
     automatiquement, les visuels sont partagés (téléphone) ou
     téléchargés (ordinateur), et la conversation avec
     `@shinobishopdz` s'ouvre. Le client colle le message.
4. Si le navigateur bloque le partage (certains iPhone), une fenêtre
   « Ta commande est prête » propose d'envoyer d'un tap.
5. La boutique reçoit un message complet :

```
• Produit : T-shirt oversize — 2 200 DA
• Couleur : Noir · Taille : XL · Quantité : 2
🎨 Recto : Gojo Satoru (Jujutsu Kaisen) · 85% · centré
👤 Prénom : Amine
📞 Téléphone : 0555 12 34 56
🚚 Livraison : 16 · Alger — Bab Ezzouar
Sous-total : 4 400 DA (2 × 2 200 DA)
Livraison : 690 DA (à confirmer selon la wilaya)
Total : 5 090 DA — paiement à la livraison / au retrait
```

   + `shinobi-recto-apercu.png` (le mockup) et
   `shinobi-recto-impression.png` (le fichier à imprimer, fond
   transparent) — et la même chose pour le verso s'il y en a un.


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

Tout ce qui suit se fait depuis **`/admin/`** (ou en éditant le JSON) :

| Pour changer… | Dans l'admin | Fichier |
|---|---|---|
| Le numéro WhatsApp, Instagram, téléphone | Paramètres du site → Contact | `src/content/site.json` |
| Les prix, le supplément verso | Bases | `src/content/bases/*.json` |
| Ajouter un design (avec son image) | Designs → Nouveau | `src/content/designs/*.json` + `public/images/designs/` |
| Les designs de la page d'accueil | Designs → « Mettre en avant » | idem |
| Les horaires, l'adresse, le délai | Paramètres du site → Boutique | `src/content/site.json` |
| Le prix de livraison, la politique de retour | Paramètres du site → Livraison | `src/content/site.json` |
| Les questions de la page Infos | Paramètres du site → Questions fréquentes | `src/content/site.json` → `faq` |
| La phrase d'accroche | Paramètres du site → Hero | `src/content/site.json` |

Réservé au développeur : couleurs / fontes (`src/styles/tokens.css`),
mockups et zones d'impression (`src/lib/mockups.ts`), guide des
tailles (`src/lib/size-guide.ts`), image de partage
(`public/assets/og.png`, 1200×630).

> Un design a soit une **image** (imprimée telle quelle — PNG à fond
> transparent, 1500 px ou plus), soit un **emoji** de remplacement. Le
> build refuse un design qui n'a ni l'un ni l'autre, donc une erreur
> de saisie ne peut pas casser le site en ligne.


## Points techniques

- **Astro 5** rend tout en HTML statique au build → site très rapide.
  Le designer charge ~46 Ko de JavaScript (~16 Ko gzip) ; les autres pages ~8 Ko (~4 Ko gzip) pour le Dojo, en
  TypeScript sans framework.
- Le designer lit son catalogue depuis un `<script type="application/json">`
  embarqué dans la page. La logique pure vit dans `src/lib/`, le
  contrôleur DOM dans `src/scripts/builder.ts`.
- **Decap CMS 3** (version figée dans `public/admin/index.html`) est un
  éditeur visuel pour Git : il commit dans le repo, Netlify reconstruit.
  Publication directe (pas de brouillons à valider).
- **WhatsApp Click-to-Chat** (`wa.me/...?text=...`) et **Web Share API**
  (partage des images sur téléphone). Instagram : lien `ig.me/m/<pseudo>`
  + texte copié.
- **SEO / partage** : image de partage PNG (WhatsApp/Facebook
  n'affichent pas les SVG), URL canonique, sitemap, `robots.txt`
  générés à partir de l'adresse réelle du site ; `ClothingStore` sur
  `/boutique`, `FAQPage` sur `/infos`. Icônes PNG + manifeste pour
  « Ajouter à l'écran d'accueil ».
- En-têtes de sécurité et cache longue durée des fichiers `/_astro/*`
  dans `netlify.toml`.
- **Pas de tracking par défaut** — ajoute Plausible si besoin.


## Coût d'exploitation : 0 €

- Hébergement : gratuit (Netlify free tier, 100 GB / mois).
- Domaine : ~10 € / an (optionnel — `*.netlify.app` est gratuit).
- Pas de base de données.
- Pas de serveur.
- Pas de Stripe.
- Pas d'abonnement Shopify.

L'owner peut faire évoluer le site sans repasser par un dev.
