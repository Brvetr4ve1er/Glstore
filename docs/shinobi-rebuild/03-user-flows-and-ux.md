# 03 — User Flows & UX Critique

> SHINOBI's UX critique is special: there is no current site, so
> "today's friction" lives on Instagram and on the phone. The flows
> below describe **what the site will do** and what it will replace.

## A. Four flows that move revenue

### A.1 Instagram → Web (the new default)

```
IG post / Story / Reels (with link sticker)
        │
        ▼
PDP                         ← deep-linked with the variant pre-selected
        │
        ▼
Add to cart   →   Cart drawer (sticky on mobile)
        │
        ▼
Checkout (one page · COD default · pickup vs delivery)
        │
        ▼
Confirmation + SMS + WhatsApp deep-link
```

**Owner UX win:** every Story link drops the buyer onto a PDP with
the right size **already selected** by passing `?size=M` in the URL.
DMs that would have asked "available in M?" never start.

**KPI:** mobile time-to-add-to-cart < 30 s.

### A.2 Custom Print Builder

```
/custom landing  →  Pick base (T-shirt · Sweat · Pull · Mug · Tote)
        │            ↓
        │       Price chip updates live (table from §5 of source data)
        │            ↓
        │       Pick a design (anime gallery · search by character)
        │            ↓
        │       Pick side(s): recto only · recto + verso  (+500 DA)
        │            ↓
        │       Pick size + colour (where applicable)
        │            ↓
        │       Optional uploads (own design — for verification by owner)
        │            ↓
        │       Live price + 3-D-ish preview (PNG composited over the base photo)
        ▼
"Ajouter au panier" or "Garder le devis"
        │
        ▼
Checkout (standard flow)
```

**The win:** SHINOBI's actual differentiator becomes a self-serve
flow. Custom orders go from "DM, wait, ten messages, confirm" to
"build it, see it, buy it."

**KPI:** custom-builder completion rate (start → cart) ≥ 35 %.

### A.3 Order tracking (no account required)

```
/commande/suivi
        │
        ▼
(order_number, phone) → status timeline + courier link
                       + "discuter en DM" fallback
```

The phone-only flow already shipped in Glstore; we reuse it.

### A.4 In-store pickup

```
PDP "Retrait en boutique" toggle
        │
        ▼
Checkout — shipping group becomes "Retrait à Bab Ezzouar"
        │
        ▼
Confirmation: a pickup code + a map deep-link
        │
        ▼
SMS when the item is ready
        │
        ▼
Customer picks up at the counter; owner scans the code
```

**Why:** the boutique already has foot traffic; pickup ties online
discovery to physical presence and reduces delivery cost. Pickup
items are charged **0 DA** delivery.

## B. Mobile flow notes

The Algerian buyer is overwhelmingly on mobile (Android, often
data-budget conscious). Targets that follow from that:

- Static hero image at LCP — no autoplay video.
- Sticky "Add to bag" on PDP below the fold.
- One-page checkout; never a wizard on mobile.
- Wilaya / commune as cascading native selects.
- WhatsApp deep-link in confirmation and footer.
- PWA install prompt on `/compte` (third visit only — never on
  first paint).

## C. UX critique — what we are removing or adding

Each item: **Problem · Impact · Fix · Expected benefit.**

### C.1 "Combien?" is a tax on the owner

- **Problem today:** every product post invites a DM asking the
  price. The owner answers manually, in real time, often during the
  shop's busy hours.
- **Impact:** time. And ~30 % of those DMs go cold before
  conversion.
- **Fix:** every PDP renders a price visibly. Story links go
  straight to PDP. The owner's bio link becomes a Linktree-style
  hub directing to the current drop + the Custom Builder.
- **Benefit:** owner reclaims ~2 h / day; web-channel conversion
  starts from a healthier baseline.

### C.2 Custom order takes 7+ messages to spec

- **Problem today:** buyer DMs → owner asks for product + design
  + side + size + colour + address + phone, one at a time.
- **Impact:** buyer fatigue, owner time, slow turnaround.
- **Fix:** the Custom Builder collects all of it in one screen, with
  live price and a preview.
- **Benefit:** custom-order share of revenue grows; ops time per
  custom order drops.

### C.3 No size guide

- **Problem today:** "is it true-to-size?" is a DM the owner answers
  by heart for each piece.
- **Impact:** returns, owner time, mismatched expectations on
  oversize fit.
- **Fix:** a single size-guide page with cm tables for each garment
  family (oversize tees vs sweats vs caps); a "find your size"
  widget on PDP.
- **Benefit:** -20 % return rate.

### C.4 No social proof at the buy button

- **Problem today:** reviews live on IG comments, separated from
  the buying moment.
- **Impact:** first-time buyers hesitate. Returning buyers buy.
- **Fix:** reviews on PDP, with photos, verified-buyer flag pulled
  from the order ledger. Auto-request email 72 h after delivery.
- **Benefit:** first-time conversion +15 – 25 %.

### C.5 No "passer en boutique" path online

- **Problem today:** the brand's biggest asset (a physical store
  with anime accessories and demo printing) is invisible online.
- **Impact:** missed in-person sales, missed cross-sells (a katana
  next to a Bleach tee is irresistible in person and irrelevant in
  a DM).
- **Fix:** a `/boutique` page with photos, hours, map, "retrait
  gratuit en boutique" toggle on every cart and checkout. An
  "in-store only" badge on katanas + figurines.
- **Benefit:** captures pickup-converters; raises in-shop foot
  traffic by surfacing the shop in search and on every PDP.

### C.6 No drops / campaigns calendar

- **Problem today:** every IG post is a one-shot; there is no
  thematic calendar.
- **Impact:** no recurrent customer ritual; harder to retain
  attention.
- **Fix:** the OKAMI drop engine in the Glstore stack (Phase 2
  there, reused here). Sukuna Friday, Goku Sundays, the Ramadan
  Capsule, etc.
- **Benefit:** repeat-customer rate +10 – 20 pp over a quarter.

### C.7 No payment alternative to COD

- **Problem today:** COD is the only path; cancellation rate at
  delivery is non-trivial.
- **Impact:** courier round-trips eat margin.
- **Fix:** offer card / CIB as a *secondary* option (COD remains
  default). For confirmed-card orders, ship sooner and offer a
  micro-discount or "free pickup" perk.
- **Benefit:** -20 % at-delivery cancellation on the card cohort.

### C.8 No bilingual surface

- **Problem today:** Instagram captions mix FR + AR + EN ad hoc.
- **Impact:** unclear voice for non-FR readers; no `hreflang`
  benefit.
- **Fix:** FR primary (default), EN secondary at launch, AR with
  RTL in v1.1.
- **Benefit:** broader SEO reach across the diaspora; cleaner UX.

### C.9 No analytics — no learning

- **Problem today:** no PostHog, no GA, no Meta Pixel — owner has
  hunches only.
- **Impact:** no data-driven decisions.
- **Fix:** PostHog + Meta + TikTok pixels. Funnels on PDP →
  add-to-cart → checkout → purchase; events on Custom Builder.
- **Benefit:** weekly review meeting has data.

### C.10 No newsletter / DM-to-list capture

- **Problem today:** every DM is a one-off; no contact list grows.
- **Impact:** every drop relies on the IG algorithm.
- **Fix:** "Get the next drop before IG" capture on PDP + footer.
  Klaviyo segments by anime preference (Naruto fans → Naruto
  drops).
- **Benefit:** independent reach; cheaper drop-day activation.

## D. Anti-patterns we will not adopt

- Auto-playing video heroes.
- "Enter your email to see the homepage" gates.
- Discount-wheel pop-ups.
- Hover-only navigation on touch devices.
- "Add to cart" buttons that don't say what they cost.
- A custom-builder that hides the price until the end.
