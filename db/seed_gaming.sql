-- =====================================================================
--  GLAIVE — Gaming catalog seed
--  Turns the Ghir Laffaire commerce platform into a gaming-gear store.
--  Same architecture (products/offers/media, COD + wilaya, DZD) — different
--  "map": gaming categories + gaming products.
--
--  Auto-loaded on a fresh DB via docker-entrypoint-initdb.d (02-seed_gaming),
--  or run manually against an existing DB:
--    docker compose exec db psql -U glstore -d glstore \
--      -f /docker-entrypoint-initdb.d/02-seed_gaming.sql
--
--  Idempotent: ON CONFLICT DO NOTHING on sku/variant_sku, so re-running is safe.
--  Products are ACTIVE so they surface on the public storefront immediately.
--  Images are intentionally omitted — the platform's own scraper + Image
--  Review pipeline is the intended way to attach product photography.
--
--  Pattern: each product is inserted in a data-modifying CTE whose RETURNING id
--  is CROSS JOINed against a VALUES list of its offers (referenced exactly once).
-- =====================================================================

-- ── HEADSETS ─────────────────────────────────────────────────────────
WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-HS-001','nova-elite-wireless','Nova Elite Wireless','GLAIVE','Headsets','Wireless',
    'Casque sans fil Hi-Res certifie. Haut-parleurs 40mm fibre de carbone, double batterie remplacable a chaud, ANC actif.',
    '{"Drivers":"40mm Fibre de carbone","Connexion":"2.4GHz + Bluetooth 5.3","Frequence":"10-40000 Hz","Batterie":"Hot-swap","Micro":"ClearCast Gen 3","Poids":"330 g"}'::jsonb,
    'ACTIVE', 0.90)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-HS-001-BLK','{"color":"Noir"}', 52000, 89000, 79000, 18),
  ('GLV-HS-001-WHT','{"color":"Blanc"}',52000, 89000, NULL,   7)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;

WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-HS-002','nova-7-wireless','Nova 7 Wireless','GLAIVE','Headsets','Wireless',
    'Sans fil multiplateforme — 54h autonomie, 2.4GHz + Bluetooth simultanes. PC, PlayStation, Xbox, Switch.',
    '{"Drivers":"40mm Neodyme","Connexion":"2.4GHz + Bluetooth","Batterie":"54 heures","Micro":"ClearCast Gen 2","Plateformes":"PC/PS/Xbox/Switch","Poids":"325 g"}'::jsonb,
    'ACTIVE', 0.88)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-HS-002-BLK','{"color":"Noir"}', 26000, 42000, NULL, 32)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;

WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-HS-003','nova-3-wired','Nova 3 Wired','GLAIVE','Headsets','Wired',
    'Casque esport filaire leger, audio spatial 360 et micro retractable a reduction de bruit.',
    '{"Drivers":"40mm Neodyme","Connexion":"USB-C / 3.5mm","Audio":"360 Spatial","Micro":"Retractable","Poids":"253 g"}'::jsonb,
    'ACTIVE', 0.85)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-HS-003-BLK','{"color":"Noir"}', 10000, 18000, NULL, 44)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;

-- ── KEYBOARDS ────────────────────────────────────────────────────────
WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-KB-001','apex-pro-tkl','Apex Pro TKL','GLAIVE','Keyboards','Mechanical',
    'Switchs magnetiques OmniPoint reglables avec Rapid Trigger, actuation par touche et option sans fil 8000Hz.',
    '{"Switchs":"OmniPoint Magnetique","Actuation":"0.1-4.0 mm","Polling":"8000 Hz","Ecran":"OLED","Format":"Tenkeyless","Chassis":"Aluminium"}'::jsonb,
    'ACTIVE', 0.90)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-KB-001-AZ','{"layout":"AZERTY"}', 34000, 56000, NULL, 21)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;

WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-KB-002','apex-mini-60','Apex Mini 60','GLAIVE','Keyboards','Mechanical',
    'Format competitif 60% avec switchs magnetiques reglables et Protection Mode. Vitesse pure, encombrement minimal.',
    '{"Switchs":"OmniPoint Magnetique","Actuation":"0.2-3.8 mm","Format":"60%","Polling":"1000 Hz","Keycaps":"PBT double-shot"}'::jsonb,
    'ACTIVE', 0.87)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-KB-002-QW','{"layout":"QWERTY"}', 27000, 44000, NULL, 14)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;

WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-KB-003','apex-3-tkl','Apex 3 TKL','GLAIVE','Keyboards','Membrane',
    'Switchs gaming silencieux, RGB 10 zones et resistance a l eau IP32 a un prix imbattable.',
    '{"Switchs":"Whisper-Quiet","RGB":"10 zones","Resistance":"IP32","Format":"Tenkeyless","Cable":"Detachable"}'::jsonb,
    'ACTIVE', 0.84)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-KB-003-AZ','{"layout":"AZERTY"}', 6500, 12000, 9900, 60)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;

-- ── MICE ─────────────────────────────────────────────────────────────
WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-MO-001','aerox-3-wireless','Aerox 3 Wireless','GLAIVE','Mice','Wireless',
    'Coque nid d abeille ultralegere 66g, polling 4000Hz et resistance a l eau AquaBarrier.',
    '{"Capteur":"TrueMove Air 18000 CPI","Polling":"4000 Hz","Poids":"66 g","Switchs":"Golden Micro IP54","Batterie":"200 h","Connexion":"2.4GHz + Bluetooth"}'::jsonb,
    'ACTIVE', 0.89)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-MO-001-BLK','{"color":"Noir"}', 13000, 21000, NULL, 29),
  ('GLV-MO-001-WHT','{"color":"Blanc"}',13000, 21000, NULL, 12)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;

WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-MO-002','rival-3','Rival 3','GLAIVE','Mice','Wired',
    'Rapport qualite-prix imbattable. Capteur optique precis, switchs 80M clics et RGB Prism.',
    '{"Capteur":"TrueMove Core 8500 CPI","Switchs":"80M clics","Poids":"77 g","RGB":"Prism 3 zones","Connexion":"USB filaire"}'::jsonb,
    'ACTIVE', 0.85)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-MO-002-BLK','{"color":"Noir"}', 4200, 8500, 6900, 75)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;

WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-MO-003','prime-wireless','Prime Wireless','GLAIVE','Mice','Wireless',
    'Concue avec et pour les pros de l esport. Switchs optiques Prestige et sans fil Quantum 2.0 zero latence.',
    '{"Capteur":"TrueMove Pro 18000 CPI","Switchs":"Prestige OM Optique","Poids":"80 g","Sans-fil":"Quantum 2.0","Batterie":"100 h"}'::jsonb,
    'ACTIVE', 0.88)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-MO-003-BLK','{"color":"Noir"}', 17000, 28000, NULL, 16)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;

-- ── MOUSEPADS ────────────────────────────────────────────────────────
WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-MP-001','qck-heavy','QcK Heavy','GLAIVE','Mousepads','Cloth',
    'Le standard des pros. Tissu micro-tisse epais 6mm pour une surface stable et un tracking precis.',
    '{"Surface":"Tissu micro-tisse","Epaisseur":"6 mm","Base":"Caoutchouc antiderapant","Tailles":"M / L / XXL"}'::jsonb,
    'ACTIVE', 0.86)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-MP-001-M',  '{"size":"Medium"}', 1800, 3500, NULL, 90),
  ('GLV-MP-001-XXL','{"size":"XXL"}',    3200, 5900, NULL, 40)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;

WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-MP-002','qck-prism-xl','QcK Prism XL','GLAIVE','Mousepads','RGB',
    'Eclairage RGB reactif deux zones synchronise au jeu, surface double tissu controle et vitesse.',
    '{"Surface":"Tissu double texture","RGB":"2 zones reactives","Taille":"900x300 mm","Sync":"GameSense"}'::jsonb,
    'ACTIVE', 0.85)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-MP-002-XL','{"size":"XL"}', 7000, 13000, 10900, 23)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;

-- ── CONTROLLERS ──────────────────────────────────────────────────────
WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-CT-001','stratus-plus','Stratus+ Wireless','GLAIVE','Controllers','Wireless',
    'Manette sans fil premium pour Android, PC et cloud gaming. Gachettes a effet Hall et 90h+ autonomie.',
    '{"Connexion":"Bluetooth + 2.4GHz","Gachettes":"Effet Hall","Batterie":"90+ heures","Plateformes":"Android/PC/Cloud"}'::jsonb,
    'ACTIVE', 0.85)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-CT-001-BLK','{"color":"Noir"}', 9500, 16000, NULL, 27)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;

-- ── ACCESSORIES ──────────────────────────────────────────────────────
WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-AC-001','gamedac-gen2','GameDAC Gen 2','GLAIVE','Accessories','Audio',
    'DAC ESS Sabre certifie Hi-Res offrant un son 96kHz/24-bit avec EQ materiel et molette ChatMix.',
    '{"DAC":"ESS Sabre Hi-Res","Audio":"96kHz/24-bit","Controles":"ChatMix + EQ","Connexion":"USB-C"}'::jsonb,
    'ACTIVE', 0.84)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-AC-001-BLK','{"color":"Noir"}', 17000, 29000, NULL, 19)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;

WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-AC-002','aerox-booster-pack','Aerox Booster Pack','GLAIVE','Accessories','Grip',
    'Grip tape, patins PTFE et dongle de charge USB-C pour garder votre Aerox en vol.',
    '{"Inclus":"Grip tape + patins","Patins":"100% PTFE","Compatibilite":"Serie Aerox"}'::jsonb,
    'ACTIVE', 0.82)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-AC-002-STD','{}', 2200, 4500, NULL, 55)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;

-- =====================================================================
--  ARCHIVE THE PLACEHOLDER CATALOG
--  ---------------------------------------------------------------
--  The 14 products above are a DESIGN STUDY, not sellable stock. Their
--  names are SteelSeries' actual product line (Arctis Nova, Apex Pro
--  TKL, Aerox 3, Rival 3, QcK, GameDAC) and their specs carry
--  SteelSeries trademarks such as "ClearCast" -- all inserted under
--  brand = 'GLAIVE'. That is fine as a layout/theming fixture; it is
--  not fine on a storefront taking real cash-on-delivery orders.
--
--  So they are seeded (useful as a rendering fixture before real stock
--  arrives, and as a reference for catalog shape) but immediately
--  ARCHIVED, which removes them from every public surface.
--
--  WHY BOTH UPDATES ARE REQUIRED -- archiving the product is NOT enough:
--    · api/routes/catalog.py requires status = 'ACTIVE' for facets and
--      featured, and excludes ARCHIVED from lists. Product hidden. Good.
--    · BUT api/services/orders.py:94-109 joins offers -> products and
--      tests ONLY o.is_active. It never reads p.status. An ARCHIVED
--      product whose offers are still active is therefore STILL
--      ORDERABLE by anyone holding an offer id (stale cart, bookmark).
--      Deactivating the offers is what actually closes that path -- the
--      same pair of writes DELETE /products/{id} performs on a soft
--      archive.
--
--  Runs at seed time, BEFORE migration 005 adds store_id, so these
--  match on sku alone. SKUs are listed explicitly rather than matched
--  with LIKE 'GLV-%' so that re-running this against a live database
--  can never touch a real product imported later under the same prefix.
--
--  TO BRING THEM BACK (demo/testing on a non-public deployment):
--    UPDATE products SET status = 'ACTIVE' WHERE sku IN (...same list...);
--    UPDATE offers SET is_active = true WHERE variant_sku LIKE 'GLV-%';
--
--  Idempotent: both statements are UPDATEs, safe to re-run.
-- =====================================================================

UPDATE products
   SET status     = 'ARCHIVED',
       updated_at = NOW()
 WHERE sku IN (
    'GLV-HS-001','GLV-HS-002','GLV-HS-003',
    'GLV-KB-001','GLV-KB-002','GLV-KB-003',
    'GLV-MO-001','GLV-MO-002','GLV-MO-003',
    'GLV-MP-001','GLV-MP-002',
    'GLV-CT-001',
    'GLV-AC-001','GLV-AC-002'
   )
   AND status <> 'ARCHIVED';

UPDATE offers o
   SET is_active  = false,
       updated_at = NOW()
  FROM products p
 WHERE p.id = o.product_id
   AND p.sku IN (
    'GLV-HS-001','GLV-HS-002','GLV-HS-003',
    'GLV-KB-001','GLV-KB-002','GLV-KB-003',
    'GLV-MO-001','GLV-MO-002','GLV-MO-003',
    'GLV-MP-001','GLV-MP-002',
    'GLV-CT-001',
    'GLV-AC-001','GLV-AC-002'
   )
   AND o.is_active;
