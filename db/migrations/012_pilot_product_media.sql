-- ============================================================================
-- Migration 012: pilot product media — the three QA-passed product cards
--
-- DATA, not schema. It is a migration so it reaches the live database in the
-- same step as 010 and 011, with no extra command for the operator.
--
-- The files ship in the storefront build (storefront/public/media/products/),
-- which Vercel serves from the same origin as the API, so a root-relative URL
-- resolves on the storefront. The admin resolves it against the API origin
-- (`mediaUrl` in admin/src/lib/api.ts).
--
-- Provenance (docs: el yusr project / bulk_media/pilot_magnific_results.csv):
--   AI renders made in Magnific (Seedream 5 Pro) from a product library asset
--   built on a SKU-verified source photo, then visually checked against that
--   photo on 2026-09-24 and approved by the owner for the site.
--
--   GX332810      KRUPS       creation xSRRoCFjfW  source: official Krups page
--   GN-SFP502M-G  GEANT       creation bx44XDn5Y2  source: WebStar Electro (schema.org model)
--   AMB-021CM     SCHALLENGE  creation 0eE74BtTfW  source: BH Kitchen (schema.org model)
--
--   NOT included: SF-8044 and BL3001 (owner review pending) and GK-CZ86DV-N
--   (rejected — its source photo shows a Cristor-badged cooker).
--
-- Attaches only where a product with that SKU exists, in whichever store has
-- it; on any other database this inserts nothing. store_id is taken from the
-- product itself. An image becomes primary only if the product has no stored
-- primary yet, and nothing is inserted twice. Idempotent — safe to re-run.
-- ============================================================================

INSERT INTO product_media (
    store_id, product_id, url, kind, position, is_primary, status, source,
    alt_text, width, height, bytes, checksum_sha256
)
SELECT
    p.store_id,
    p.id,
    v.url,
    'image',
    0,
    NOT EXISTS (
        SELECT 1 FROM product_media pm
         WHERE pm.store_id = p.store_id
           AND pm.product_id = p.id
           AND pm.is_primary
           AND pm.status = 'STORED'
    ),
    'STORED'::media_status_enum,
    'GENERATED'::media_source_enum,
    v.alt_text,
    1200,
    1200,
    v.bytes,
    v.checksum
FROM (VALUES
    ('GX332810',
     '/media/products/krups_gx332810_product-card_v01.webp',
     'Moulinette KRUPS GX332810',
     31784,
     'e5feb8b1de0874bfcbd7c3a7878a65819b7411620cad654b5aaf8947aa78b2da'),
    ('GN-SFP502M-G',
     '/media/products/geant_gn-sfp502m-g_product-card_v01.webp',
     'Réfrigérateur inox GEANT GN-SFP502M-G',
     23820,
     'e5ffb3d8292194d1498192dcd4ab95da9a59a19873f7405ead47dce1e2721338'),
    ('AMB-021CM',
     '/media/products/schallenge_amb-021cm_product-card_v01.webp',
     'Cafetière SCHALLENGE AMB-021CM',
     57226,
     '6a7af1670ba7e4d6857c5bc922087e1d12e62c55ab7f422abdd864fc64ea382a')
) AS v(sku, url, alt_text, bytes, checksum)
JOIN products p ON p.sku = v.sku
WHERE NOT EXISTS (
    SELECT 1 FROM product_media pm
     WHERE pm.store_id = p.store_id
       AND pm.product_id = p.id
       AND pm.url = v.url
);
