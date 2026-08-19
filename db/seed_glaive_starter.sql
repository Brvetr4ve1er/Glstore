-- =====================================================================
--  GLAIVE — starter catalog (DEMO STOCK)
-- =====================================================================
--
--  ###################################################################
--  #  THESE PRODUCTS DO NOT EXIST. THEY ARE INVENTED DEMO DATA.      #
--  #  Names, specs, prices and stock levels were all made up so the  #
--  #  storefront has something to render before real stock arrives.  #
--  #  Do NOT leave them ACTIVE on a shop taking real orders — you    #
--  #  cannot fulfil them. The off-switch is at the bottom of this    #
--  #  header; run it the moment you import a real catalog.           #
--  ###################################################################
--
--  WHY THIS FILE EXISTS
--  db/seed_gaming.sql seeds 14 products and then archives them: their
--  names were SteelSeries' real product line, which is fine for a
--  layout study and not fine for a live shop. That left the storefront
--  with an empty catalog and no way to smoke-test checkout. This file
--  restores a browsable, orderable catalog using names that are ours.
--
--  NAMING
--  Every series below is original and was checked against real gaming
--  peripherals before being used. GLAIVE is a bladed polearm, so the
--  sub-lines are parts of the weapon and of the forge:
--    Quillon  (crossguard) .. Headsets
--    Halberd  (polearm)    .. Keyboards
--    Riposte  (the strike) .. Mice
--    Strop    (edge finish).. Mousepads
--    Vambrace (arm guard)  .. Controllers
--    Cinder   (forge ember).. Accessories
--  Two earlier candidates were dropped for colliding with shipping
--  products: "Anvil" (nvil.gg, custom gaming keyboards) and
--  "Whetstone" (ASUS ROG Whetstone mousepad). Check any name you add.
--
--  CATEGORIES ARE LOAD-BEARING
--  Headsets / Keyboards / Mice / Controllers are hard-linked by
--  storefront Navbar.tsx and Footer.tsx as /c/<Category>. Spell them
--  exactly as below or those nav links land on an empty page.
--
--  SKU RANGE
--  Starts at -101. The archival block in seed_gaming.sql lists its 14
--  SKUs explicitly (-001..-003), so it can never touch these.
--
--  FRESH INIT ONLY
--  Loads BEFORE db/migrations/*.sql, so there is no store_id column and
--  no stores table yet — hence the pre-005 shape (plain column list,
--  ON CONFLICT (sku)). Same limitation as seed_gaming.sql: re-running
--  this against an already-migrated database FAILS on store_id NOT NULL
--  before it ever reaches the conflict check. It is for init_remote_db.py
--  and the Docker first-boot only. To add products to a live database,
--  use the admin's CSV import.
--
--  ---------------------------------------------------------------
--  OFF-SWITCH — paste into Neon's SQL editor when real stock lands.
--  Hides all 15 from the storefront AND makes them unorderable.
--  Both statements are needed: api/services/orders.py checks
--  offers.is_active but never products.status, so archiving the
--  product alone leaves it buyable by offer id.
--
--    UPDATE products SET status = 'ARCHIVED', updated_at = NOW()
--     WHERE sku IN ('GLV-HS-101','GLV-HS-102','GLV-HS-103',
--                   'GLV-KB-101','GLV-KB-102','GLV-KB-103',
--                   'GLV-MO-101','GLV-MO-102','GLV-MO-103',
--                   'GLV-MP-101','GLV-MP-102',
--                   'GLV-CT-101','GLV-CT-102',
--                   'GLV-AC-101','GLV-AC-102');
--
--    UPDATE offers o SET is_active = false, updated_at = NOW()
--      FROM products p
--     WHERE p.id = o.product_id AND p.sku LIKE 'GLV-__-1%';
--  ---------------------------------------------------------------
-- =====================================================================


-- ── HEADSETS — Quillon ───────────────────────────────────────────────
WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-HS-101','quillon-7-wireless','Quillon 7 Wireless','GLAIVE','Headsets','Wireless',
    'Casque sans fil 2.4GHz + Bluetooth simultanes. Double batterie remplacable, 38h autonomie, micro a reduction de bruit.',
    '{"Drivers":"50mm Neodyme","Connexion":"2.4GHz + Bluetooth 5.3","Frequence":"20-22000 Hz","Batterie":"38 heures","Micro":"Detachable, anti-bruit","Plateformes":"PC/PS/Xbox/Switch","Poids":"318 g"}'::jsonb,
    'ACTIVE', 0.91)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-HS-101-BLK','{"color":"Noir"}',  28000, 46000, 39900, 24),
  ('GLV-HS-101-WHT','{"color":"Blanc"}', 28000, 46000, NULL,   9)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;

WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-HS-102','quillon-5-wireless','Quillon 5 Wireless','GLAIVE','Headsets','Wireless',
    'Sans fil 2.4GHz faible latence. Coussinets memoire de forme, 45h autonomie, charge USB-C rapide.',
    '{"Drivers":"40mm Neodyme","Connexion":"2.4GHz","Frequence":"20-20000 Hz","Batterie":"45 heures","Micro":"Retractable","Plateformes":"PC/PS/Switch","Poids":"295 g"}'::jsonb,
    'ACTIVE', 0.88)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-HS-102-BLK','{"color":"Noir"}', 19000, 32000, NULL, 31)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;

WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-HS-103','quillon-3-filaire','Quillon 3 Filaire','GLAIVE','Headsets','Wired',
    'Casque filaire jack 3.5mm. Leger, coussinets tissu respirant, compatible tout support sans pilote.',
    '{"Drivers":"40mm Neodyme","Connexion":"Jack 3.5mm","Frequence":"20-20000 Hz","Micro":"Bras flexible","Plateformes":"Universel","Poids":"245 g"}'::jsonb,
    'ACTIVE', 0.85)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-HS-103-BLK','{"color":"Noir"}', 8500, 15000, 12900, 52)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;


-- ── KEYBOARDS — Halberd ──────────────────────────────────────────────
WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-KB-101','halberd-pro-tkl','Halberd Pro TKL','GLAIVE','Keyboards','Mechanical',
    'Clavier mecanique TKL a switches hot-swap. Chassis aluminium, double amorti, RGB par touche.',
    '{"Format":"TKL (87 touches)","Switches":"Lineaires hot-swap","Chassis":"Aluminium CNC","Retroeclairage":"RGB par touche","Polling":"1000 Hz","Cable":"USB-C detachable","Poids":"820 g"}'::jsonb,
    'ACTIVE', 0.92)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-KB-101-AZ','{"layout":"AZERTY"}', 31000, 52000, NULL, 18),
  ('GLV-KB-101-QW','{"layout":"QWERTY"}', 31000, 52000, NULL, 11)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;

WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-KB-102','halberd-65-compact','Halberd 65 Compact','GLAIVE','Keyboards','Mechanical',
    'Format 65% pour liberer de la place a la souris. Switches pre-lubrifies, mousse anti-resonance.',
    '{"Format":"65% (68 touches)","Switches":"Tactiles pre-lubrifies","Chassis":"ABS renforce","Retroeclairage":"RGB par touche","Polling":"1000 Hz","Cable":"USB-C detachable","Poids":"610 g"}'::jsonb,
    'ACTIVE', 0.89)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-KB-102-AZ','{"layout":"AZERTY"}', 22000, 37000, 33900, 26)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;

WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-KB-103','halberd-core','Halberd Core','GLAIVE','Keyboards','Membrane',
    'Clavier membrane silencieux, resistant aux eclaboussures. Retroeclairage 3 zones, anti-ghosting 26 touches.',
    '{"Format":"Complet (105 touches)","Switches":"Membrane","Retroeclairage":"RGB 3 zones","Anti-ghosting":"26 touches","Etancheite":"Resistant aux eclaboussures","Cable":"USB-A fixe 1.8m","Poids":"780 g"}'::jsonb,
    'ACTIVE', 0.84)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-KB-103-AZ','{"layout":"AZERTY"}', 5800, 11000, NULL, 64)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;


-- ── MICE — Riposte ───────────────────────────────────────────────────
WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-MO-101','riposte-air-wireless','Riposte Air Wireless','GLAIVE','Mice','Wireless',
    'Souris ultralegere 58g, coque ajouree. Capteur 26000 DPI, patins PTFE pur, 90h autonomie.',
    '{"Capteur":"Optique 26000 DPI","Poids":"58 g","Connexion":"2.4GHz + Bluetooth","Batterie":"90 heures","Switches":"Optiques 80M clics","Patins":"100% PTFE","Boutons":"6 programmables"}'::jsonb,
    'ACTIVE', 0.92)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-MO-101-BLK','{"color":"Noir"}',  15000, 25000, NULL, 33),
  ('GLV-MO-101-WHT','{"color":"Blanc"}', 15000, 25000, NULL, 14)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;

WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-MO-102','riposte-lite-wireless','Riposte Lite Wireless','GLAIVE','Mice','Wireless',
    'Sans fil 2.4GHz a prix serre. 72g, capteur 12000 DPI, autonomie 60h sur pile AA.',
    '{"Capteur":"Optique 12000 DPI","Poids":"72 g","Connexion":"2.4GHz","Batterie":"60 heures (AA)","Switches":"Mecaniques 20M clics","Patins":"PTFE","Boutons":"6 programmables"}'::jsonb,
    'ACTIVE', 0.87)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-MO-102-BLK','{"color":"Noir"}', 9000, 16000, 13900, 47)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;

WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-MO-103','riposte-core-filaire','Riposte Core Filaire','GLAIVE','Mice','Wired',
    'Souris filaire d entree de gamme. Capteur 6400 DPI, cable souple tresse, plug and play.',
    '{"Capteur":"Optique 6400 DPI","Poids":"85 g","Connexion":"USB-A filaire","Cable":"Tresse 1.8m","Switches":"Mecaniques 10M clics","Boutons":"6 programmables"}'::jsonb,
    'ACTIVE', 0.83)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-MO-103-BLK','{"color":"Noir"}', 3800, 7500, NULL, 88)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;


-- ── MOUSEPADS — Strop ────────────────────────────────────────────────
WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-MP-101','strop-xxl','Strop XXL','GLAIVE','Mousepads','Cloth',
    'Tapis etendu 900x400mm. Surface tissu fine trame, base caoutchouc antiderapant, bords surpiques.',
    '{"Dimensions":"900 x 400 x 4 mm","Surface":"Tissu fine trame","Base":"Caoutchouc antiderapant","Bords":"Surpiques","Entretien":"Lavable"}'::jsonb,
    'ACTIVE', 0.86)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-MP-101-XXL','{"size":"XXL"}', 3000, 5500, NULL, 41)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;

WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-MP-102','strop-glow-xl','Strop Glow XL','GLAIVE','Mousepads','RGB',
    'Tapis retroeclaire 14 zones RGB, surface hybride. Memoire integree, commande sans logiciel.',
    '{"Dimensions":"800 x 300 x 4 mm","Surface":"Hybride tissu-silicone","Retroeclairage":"14 zones RGB","Base":"Caoutchouc antiderapant","Cable":"USB-C detachable","Memoire":"Integree"}'::jsonb,
    'ACTIVE', 0.88)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-MP-102-XL','{"size":"XL"}', 6500, 12000, 9900, 29)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;


-- ── CONTROLLERS — Vambrace ───────────────────────────────────────────
WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-CT-101','vambrace-wireless','Vambrace Wireless','GLAIVE','Controllers','Wireless',
    'Manette sans fil a sticks a effet Hall (zero derive). Gachettes a course reglable, 2 palettes arriere.',
    '{"Sticks":"Effet Hall anti-derive","Connexion":"2.4GHz + Bluetooth","Batterie":"25 heures","Gachettes":"Course reglable","Palettes":"2 arriere programmables","Plateformes":"PC/Switch/Android","Poids":"268 g"}'::jsonb,
    'ACTIVE', 0.90)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-CT-101-BLK','{"color":"Noir"}',  11000, 19000, NULL, 22),
  ('GLV-CT-101-WHT','{"color":"Blanc"}', 11000, 19000, NULL,  8)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;

WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-CT-102','vambrace-lite','Vambrace Lite','GLAIVE','Controllers','Wireless',
    'Manette Bluetooth compacte pour Switch et mobile. Support telephone inclus, vibration double moteur.',
    '{"Sticks":"Potentiometre standard","Connexion":"Bluetooth 5.0","Batterie":"18 heures","Vibration":"Double moteur","Inclus":"Support telephone","Plateformes":"Switch/Android/iOS","Poids":"212 g"}'::jsonb,
    'ACTIVE', 0.85)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-CT-102-BLK','{"color":"Noir"}', 6800, 12500, 10900, 36)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;


-- ── ACCESSORIES — Cinder ─────────────────────────────────────────────
WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-AC-101','cinder-dac','Cinder DAC','GLAIVE','Accessories','Audio',
    'DAC et ampli casque USB-C. Molette de volume physique, egaliseur a 4 profils, sortie optique.',
    '{"Convertisseur":"32-bit / 96 kHz","Entree":"USB-C","Sorties":"Jack 3.5mm + optique","Commandes":"Molette + 4 profils EQ","Impedance":"16-150 ohms","Plateformes":"PC/PS/Switch"}'::jsonb,
    'ACTIVE', 0.87)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-AC-101-BLK','{"color":"Noir"}', 16000, 27000, NULL, 17)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;

WITH p AS (
  INSERT INTO products (sku, slug, name, brand, category, subcategory, description, specs, status, completeness_score)
  VALUES ('GLV-AC-102','riposte-grip-kit','Riposte Grip Kit','GLAIVE','Accessories','Grip',
    'Kit d adherence pour la serie Riposte. Grip tape decoupe, patins PTFE de rechange, lingette de pose.',
    '{"Inclus":"Grip tape + patins + lingette","Patins":"100% PTFE","Compatibilite":"Serie Riposte","Pose":"Sans residu"}'::jsonb,
    'ACTIVE', 0.81)
  ON CONFLICT (sku) DO NOTHING RETURNING id)
INSERT INTO offers (product_id, variant_sku, variant_attrs, purchase_price, retail_price, sale_price, currency, stock_quantity)
SELECT p.id, v.sku, v.attrs::jsonb, v.pp, v.rp, v.sp::numeric, 'DZD', v.stock
FROM p CROSS JOIN (VALUES
  ('GLV-AC-102-STD','{}', 1900, 3900, NULL, 73)
) AS v(sku, attrs, pp, rp, sp, stock)
ON CONFLICT (variant_sku) DO NOTHING;
