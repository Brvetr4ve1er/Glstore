-- ============================================================================
-- Seed: Ghir Laffaire — home appliances (brand #2)
--
-- This is the SECOND brand on the platform, alongside GLAIVE (gaming gear).
-- Different catalog, different look, its own orders and customers. Same code.
--
-- PREREQUISITE — the store row must exist first:
--     python scripts/deploy/add_store.py \
--       --slug ghir --name "Ghir Laffaire" --prefix GHR --currency DZD
-- This file RAISES a clear exception if you run it before that.
--
-- Then apply it:
--     psql "<your-connection-string>" -f db/seed_ghir.sql
--
-- Idempotent: safe to re-run. Every INSERT uses ON CONFLICT DO NOTHING.
--
-- ── Why the ON CONFLICT targets look different from db/seed_gaming.sql ──────
-- seed_gaming.sql predates migration 005 and uses `ON CONFLICT (sku)`.
-- Migration 005 DROPPED products_sku_key and offers_variant_sku_key and
-- replaced them with the composite indexes products_store_sku_key(store_id,sku)
-- and offers_store_variant_sku_key(store_id,variant_sku) — so that two brands
-- can legitimately use the same SKU. On a post-005 database `ON CONFLICT (sku)`
-- fails with "no unique or exclusion constraint matching the ON CONFLICT
-- specification". This file therefore targets the composite indexes, and sets
-- store_id explicitly (it is NOT NULL after 005 — there is no backfill to
-- rely on for a brand created after that migration ran).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. GUARD — fail loudly rather than silently seeding nothing
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM stores WHERE slug = 'ghir') THEN
        RAISE EXCEPTION
            'Store "ghir" does not exist yet. Create it first:  '
            'python scripts/deploy/add_store.py --slug ghir --name "Ghir Laffaire" --prefix GHR';
    END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 1. BRAND IDENTITY — warm retail palette, deliberately unlike GLAIVE's
--    dark gaming look. Only set if the operator has not themed it in
--    Theme Studio (an authored theme always carries an "overrides" key).
-- ---------------------------------------------------------------------------

UPDATE stores
   SET theme = '{
         "preset": "default",
         "mode": "light",
         "overrides": {
           "--color-electric-blue": "#0F6FC5",
           "--color-neon-yellow":   "#F2A413",
           "--color-hot-pink":      "#C2410C",
           "--color-surface-0":     "#FBF9F6",
           "--color-surface-1":     "#FFFFFF",
           "--color-surface-2":     "#F4F1EC",
           "--color-surface-3":     "#E7E2DA",
           "--color-surface-4":     "#CFC7BB",
           "--color-text-1":        "#1A1713",
           "--color-text-2":        "#3D3730",
           "--color-text-3":        "#6B6156"
         }
       }'::jsonb,
       updated_at = NOW()
 WHERE slug = 'ghir'
   AND NOT jsonb_exists(theme, 'overrides');


-- ---------------------------------------------------------------------------
-- 2. CATALOG — 12 products. Algerian market, DZD, COD-friendly price points.
--    Brands are real in-market names (Condor and Iris are Algerian).
--    purchase_price < retail_price everywhere so margin reporting is sane.
-- ---------------------------------------------------------------------------

-- ── Réfrigérateurs ─────────────────────────────────────────────────────────

WITH s AS (SELECT id FROM stores WHERE slug = 'ghir'),
     p AS (
  INSERT INTO products (store_id, sku, slug, name, brand, category, subcategory,
                        description, specs, status, completeness_score)
  SELECT s.id, 'GHR-RF-001', 'condor-nofrost-450l',
         'Réfrigérateur Condor No Frost 450L', 'CONDOR', 'Refrigerator', 'No Frost',
         'Réfrigérateur combiné No Frost 450 litres. Froid ventilé, compartiment congélation 4 étoiles, classe énergétique A+.',
         '{"Capacite":"450 L","Type":"Combine No Frost","Classe":"A+","Congelation":"4 etoiles","Portes":"2","Garantie":"24 mois"}'::jsonb,
         'ACTIVE', 0.88
  FROM s
  ON CONFLICT (store_id, sku) DO NOTHING RETURNING id, store_id)
INSERT INTO offers (store_id, product_id, variant_sku, variant_attrs,
                    purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.store_id, p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GHR-RF-001-INX','{"color":"Inox"}',   98000, 149000, 139000, 6),
  ('GHR-RF-001-BLC','{"color":"Blanc"}',  94000, 142000, NULL,   9)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (store_id, variant_sku) DO NOTHING;


WITH s AS (SELECT id FROM stores WHERE slug = 'ghir'),
     p AS (
  INSERT INTO products (store_id, sku, slug, name, brand, category, subcategory,
                        description, specs, status, completeness_score)
  SELECT s.id, 'GHR-RF-002', 'beko-combine-320l',
         'Réfrigérateur Beko Combiné 320L', 'BEKO', 'Refrigerator', 'Combiné',
         'Combiné 320 litres avec compartiment fraîcheur. Faible consommation, silencieux (39 dB).',
         '{"Capacite":"320 L","Type":"Combine","Classe":"A+","Bruit":"39 dB","Portes":"2","Garantie":"24 mois"}'::jsonb,
         'ACTIVE', 0.85
  FROM s
  ON CONFLICT (store_id, sku) DO NOTHING RETURNING id, store_id)
INSERT INTO offers (store_id, product_id, variant_sku, variant_attrs,
                    purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.store_id, p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GHR-RF-002-INX','{"color":"Inox"}', 72000, 108000, NULL, 11)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (store_id, variant_sku) DO NOTHING;


-- ── Lave-linge ─────────────────────────────────────────────────────────────

WITH s AS (SELECT id FROM stores WHERE slug = 'ghir'),
     p AS (
  INSERT INTO products (store_id, sku, slug, name, brand, category, subcategory,
                        description, specs, status, completeness_score)
  SELECT s.id, 'GHR-LL-001', 'condor-lave-linge-8kg',
         'Lave-linge Condor 8kg 1200 tr/min', 'CONDOR', 'Washing Machine', 'Frontal',
         'Lave-linge frontal 8 kg, essorage 1200 tr/min, 15 programmes dont lavage rapide 15 minutes.',
         '{"Capacite":"8 kg","Essorage":"1200 tr/min","Programmes":"15","Classe":"A++","Type":"Frontal","Garantie":"24 mois"}'::jsonb,
         'ACTIVE', 0.87
  FROM s
  ON CONFLICT (store_id, sku) DO NOTHING RETURNING id, store_id)
INSERT INTO offers (store_id, product_id, variant_sku, variant_attrs,
                    purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.store_id, p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GHR-LL-001-BLC','{"color":"Blanc"}', 58000, 89000, 82000, 14)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (store_id, variant_sku) DO NOTHING;


WITH s AS (SELECT id FROM stores WHERE slug = 'ghir'),
     p AS (
  INSERT INTO products (store_id, sku, slug, name, brand, category, subcategory,
                        description, specs, status, completeness_score)
  SELECT s.id, 'GHR-LL-002', 'samsung-ecobubble-9kg',
         'Lave-linge Samsung EcoBubble 9kg', 'SAMSUNG', 'Washing Machine', 'Frontal',
         'Technologie EcoBubble : dissout la lessive avant le lavage pour un nettoyage efficace à basse température.',
         '{"Capacite":"9 kg","Essorage":"1400 tr/min","Technologie":"EcoBubble","Classe":"A+++","Moteur":"Digital Inverter","Garantie":"24 mois"}'::jsonb,
         'ACTIVE', 0.90
  FROM s
  ON CONFLICT (store_id, sku) DO NOTHING RETURNING id, store_id)
INSERT INTO offers (store_id, product_id, variant_sku, variant_attrs,
                    purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.store_id, p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GHR-LL-002-BLC','{"color":"Blanc"}',  88000, 132000, NULL, 5),
  ('GHR-LL-002-INX','{"color":"Silver"}', 92000, 138000, NULL, 3)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (store_id, variant_sku) DO NOTHING;


-- ── Climatisation ──────────────────────────────────────────────────────────

WITH s AS (SELECT id FROM stores WHERE slug = 'ghir'),
     p AS (
  INSERT INTO products (store_id, sku, slug, name, brand, category, subcategory,
                        description, specs, status, completeness_score)
  SELECT s.id, 'GHR-CL-001', 'condor-split-12000-inverter',
         'Climatiseur Condor Split 12000 BTU Inverter', 'CONDOR', 'Air Conditioner', 'Split Inverter',
         'Split mural inverter 12000 BTU. Chaud et froid, filtre anti-bactérien, faible consommation.',
         '{"Puissance":"12000 BTU","Type":"Split Inverter","Mode":"Chaud + Froid","Surface":"20-30 m2","Gaz":"R410A","Garantie":"36 mois"}'::jsonb,
         'ACTIVE', 0.89
  FROM s
  ON CONFLICT (store_id, sku) DO NOTHING RETURNING id, store_id)
INSERT INTO offers (store_id, product_id, variant_sku, variant_attrs,
                    purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.store_id, p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GHR-CL-001-BLC','{"color":"Blanc"}', 82000, 124000, 115000, 12)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (store_id, variant_sku) DO NOTHING;


-- ── Cuisinières & fours ────────────────────────────────────────────────────

WITH s AS (SELECT id FROM stores WHERE slug = 'ghir'),
     p AS (
  INSERT INTO products (store_id, sku, slug, name, brand, category, subcategory,
                        description, specs, status, completeness_score)
  SELECT s.id, 'GHR-CU-001', 'brandt-cuisiniere-5-feux',
         'Cuisinière Brandt 5 feux avec four', 'BRANDT', 'Cooker', 'Gaz',
         'Cuisinière 5 feux gaz avec four électrique 60 litres, gril et tournebroche. Allumage électronique.',
         '{"Feux":"5","Four":"Electrique 60 L","Gril":"Oui","Allumage":"Electronique","Dimensions":"60x60 cm","Garantie":"24 mois"}'::jsonb,
         'ACTIVE', 0.86
  FROM s
  ON CONFLICT (store_id, sku) DO NOTHING RETURNING id, store_id)
INSERT INTO offers (store_id, product_id, variant_sku, variant_attrs,
                    purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.store_id, p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GHR-CU-001-INX','{"color":"Inox"}', 48000, 74000, NULL, 8)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (store_id, variant_sku) DO NOTHING;


WITH s AS (SELECT id FROM stores WHERE slug = 'ghir'),
     p AS (
  INSERT INTO products (store_id, sku, slug, name, brand, category, subcategory,
                        description, specs, status, completeness_score)
  SELECT s.id, 'GHR-MO-001', 'lg-micro-ondes-25l',
         'Micro-ondes LG 25L Grill', 'LG', 'Microwave', 'Grill',
         'Micro-ondes 25 litres avec fonction grill, 900W, revêtement EasyClean et 8 programmes automatiques.',
         '{"Capacite":"25 L","Puissance":"900 W","Grill":"Oui","Programmes":"8","Revetement":"EasyClean","Garantie":"24 mois"}'::jsonb,
         'ACTIVE', 0.84
  FROM s
  ON CONFLICT (store_id, sku) DO NOTHING RETURNING id, store_id)
INSERT INTO offers (store_id, product_id, variant_sku, variant_attrs,
                    purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.store_id, p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GHR-MO-001-NOI','{"color":"Noir"}',  21000, 34000, NULL, 17),
  ('GHR-MO-001-INX','{"color":"Inox"}',  23000, 37000, NULL, 10)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (store_id, variant_sku) DO NOTHING;


-- ── Chauffe-eau ────────────────────────────────────────────────────────────

WITH s AS (SELECT id FROM stores WHERE slug = 'ghir'),
     p AS (
  INSERT INTO products (store_id, sku, slug, name, brand, category, subcategory,
                        description, specs, status, completeness_score)
  SELECT s.id, 'GHR-CE-001', 'condor-chauffe-eau-100l',
         'Chauffe-eau Condor 100L', 'CONDOR', 'Water Heater', 'Électrique',
         'Chauffe-eau électrique 100 litres, cuve émaillée, résistance stéatite et anode magnésium.',
         '{"Capacite":"100 L","Type":"Electrique","Cuve":"Emaillee","Resistance":"Steatite","Puissance":"1800 W","Garantie":"36 mois"}'::jsonb,
         'ACTIVE', 0.83
  FROM s
  ON CONFLICT (store_id, sku) DO NOTHING RETURNING id, store_id)
INSERT INTO offers (store_id, product_id, variant_sku, variant_attrs,
                    purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.store_id, p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GHR-CE-001-BLC','{"color":"Blanc"}', 26000, 41000, 38000, 21)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (store_id, variant_sku) DO NOTHING;


-- ── Petit électroménager ───────────────────────────────────────────────────

WITH s AS (SELECT id FROM stores WHERE slug = 'ghir'),
     p AS (
  INSERT INTO products (store_id, sku, slug, name, brand, category, subcategory,
                        description, specs, status, completeness_score)
  SELECT s.id, 'GHR-PE-001', 'moulinex-blender-1-5l',
         'Blender Moulinex 1.5L 800W', 'MOULINEX', 'Mixer', 'Blender',
         'Blender chauffant 1.5 litre, 800W, bol en verre résistant et 4 lames inox.',
         '{"Capacite":"1.5 L","Puissance":"800 W","Bol":"Verre","Lames":"4 inox","Vitesses":"2 + pulse","Garantie":"12 mois"}'::jsonb,
         'ACTIVE', 0.82
  FROM s
  ON CONFLICT (store_id, sku) DO NOTHING RETURNING id, store_id)
INSERT INTO offers (store_id, product_id, variant_sku, variant_attrs,
                    purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.store_id, p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GHR-PE-001-NOI','{"color":"Noir"}', 7200, 12500, NULL, 34)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (store_id, variant_sku) DO NOTHING;


WITH s AS (SELECT id FROM stores WHERE slug = 'ghir'),
     p AS (
  INSERT INTO products (store_id, sku, slug, name, brand, category, subcategory,
                        description, specs, status, completeness_score)
  SELECT s.id, 'GHR-PE-002', 'iris-ventilateur-colonne',
         'Ventilateur colonne Iris 45W', 'IRIS', 'Fan', 'Colonne',
         'Ventilateur colonne oscillant 45W, 3 vitesses, minuterie 7h30 et télécommande.',
         '{"Puissance":"45 W","Vitesses":"3","Oscillation":"Oui","Minuterie":"7h30","Telecommande":"Oui","Hauteur":"110 cm"}'::jsonb,
         'ACTIVE', 0.80
  FROM s
  ON CONFLICT (store_id, sku) DO NOTHING RETURNING id, store_id)
INSERT INTO offers (store_id, product_id, variant_sku, variant_attrs,
                    purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.store_id, p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GHR-PE-002-BLC','{"color":"Blanc"}', 5400, 9800, 8900, 42)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (store_id, variant_sku) DO NOTHING;


WITH s AS (SELECT id FROM stores WHERE slug = 'ghir'),
     p AS (
  INSERT INTO products (store_id, sku, slug, name, brand, category, subcategory,
                        description, specs, status, completeness_score)
  SELECT s.id, 'GHR-PE-003', 'samsung-aspirateur-2000w',
         'Aspirateur Samsung 2000W sans sac', 'SAMSUNG', 'Vacuum', 'Sans sac',
         'Aspirateur traîneau sans sac 2000W, filtration HEPA et cuve 2 litres facile à vider.',
         '{"Puissance":"2000 W","Type":"Sans sac","Filtration":"HEPA","Cuve":"2 L","Rayon":"9 m","Garantie":"12 mois"}'::jsonb,
         'ACTIVE', 0.81
  FROM s
  ON CONFLICT (store_id, sku) DO NOTHING RETURNING id, store_id)
INSERT INTO offers (store_id, product_id, variant_sku, variant_attrs,
                    purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.store_id, p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GHR-PE-003-RGE','{"color":"Rouge"}', 16500, 26900, NULL, 19)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (store_id, variant_sku) DO NOTHING;


-- ── TV ─────────────────────────────────────────────────────────────────────

WITH s AS (SELECT id FROM stores WHERE slug = 'ghir'),
     p AS (
  INSERT INTO products (store_id, sku, slug, name, brand, category, subcategory,
                        description, specs, status, completeness_score)
  SELECT s.id, 'GHR-TV-001', 'condor-smart-tv-55-4k',
         'Smart TV Condor 55" 4K UHD', 'CONDOR', 'TV', 'Smart TV',
         'Téléviseur LED 55 pouces 4K UHD, Android TV intégré, 3 ports HDMI et 2 USB.',
         '{"Diagonale":"55 pouces","Resolution":"4K UHD","OS":"Android TV","HDMI":"3","USB":"2","Garantie":"24 mois"}'::jsonb,
         'ACTIVE', 0.87
  FROM s
  ON CONFLICT (store_id, sku) DO NOTHING RETURNING id, store_id)
INSERT INTO offers (store_id, product_id, variant_sku, variant_attrs,
                    purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.store_id, p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GHR-TV-001-NOI','{"color":"Noir"}', 62000, 94000, 87000, 7)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (store_id, variant_sku) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 3. REPORT — what landed
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_store   UUID;
    v_prods   INTEGER;
    v_offers  INTEGER;
BEGIN
    SELECT id INTO v_store FROM stores WHERE slug = 'ghir';
    SELECT COUNT(*) INTO v_prods  FROM products WHERE store_id = v_store;
    SELECT COUNT(*) INTO v_offers FROM offers   WHERE store_id = v_store;
    RAISE NOTICE 'Ghir Laffaire seeded: % products, % offers (store_id=%)',
                 v_prods, v_offers, v_store;
END $$;
