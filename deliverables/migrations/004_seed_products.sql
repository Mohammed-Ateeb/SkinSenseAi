-- =====================================================================
-- SkinSense AI — Migration 004: Seed Products Catalogue
-- =====================================================================
-- Inserts 15 OTC skincare products covering all 6 target conditions:
--   acne, eczema, psoriasis, rosacea, seborrheic_keratoses, tinea
--
-- Uses generic product-category names (not proprietary brand names).
-- embedding is set to NULL — backfill via `python -m app.rag.backfill`
-- after running migration 002 (pgvector).
--
-- Idempotent: ON CONFLICT (name) DO NOTHING requires a unique index.
-- =====================================================================

-- Unique name constraint to make ON CONFLICT work cleanly.
-- The index is harmless if already present.
CREATE UNIQUE INDEX IF NOT EXISTS products_name_unique ON public.products (name);

INSERT INTO public.products
  (id, name, category, target_conditions, active_ingredients,
   excludes_ingredients, is_active, priority_score, description, embedding)
VALUES

-- 1. Niacinamide 10% + Zinc 1% Serum
(
  'a1b2c3d4-0001-4e5f-a6b7-c8d9e0f10001',
  'Niacinamide 10% + Zinc 1% Serum',
  'serum',
  ARRAY['acne','rosacea'],
  ARRAY['niacinamide 10%','zinc pca 1%'],
  ARRAY['fragrance','alcohol','parabens'],
  TRUE, 9,
  'Combines niacinamide with zinc PCA to regulate sebum production, reduce visible pores, and calm redness. '
  || 'Best used morning and evening on cleansed skin; suitable for oily, acne-prone, and rosacea-prone skin types.',
  NULL
),

-- 2. Salicylic Acid 2% Cleanser
(
  'a1b2c3d4-0002-4e5f-a6b7-c8d9e0f10002',
  'Salicylic Acid 2% Cleanser',
  'cleanser',
  ARRAY['acne','seborrheic_keratoses'],
  ARRAY['salicylic acid 2%'],
  ARRAY['sulfates','fragrance'],
  TRUE, 8,
  'A beta-hydroxy acid cleanser that exfoliates inside the pore, dislodging keratin plugs and reducing comedones. '
  || 'Use once daily, increasing to twice daily as tolerated; avoid around eyes.',
  NULL
),

-- 3. Colloidal Oatmeal Moisturizer
(
  'a1b2c3d4-0003-4e5f-a6b7-c8d9e0f10003',
  'Colloidal Oatmeal Moisturizer',
  'moisturizer',
  ARRAY['eczema','psoriasis','rosacea'],
  ARRAY['colloidal oatmeal 1%','glycerin','shea butter'],
  ARRAY['fragrance','dyes','alcohol','parabens'],
  TRUE, 9,
  'FDA-approved colloidal oatmeal forms a protective film that soothes itch, reduces inflammation, and restores '
  || 'skin-barrier function. Ideal for flare management in eczema, psoriasis, and sensitive rosacea-prone skin.',
  NULL
),

-- 4. Ceramide Barrier Repair Cream
(
  'a1b2c3d4-0004-4e5f-a6b7-c8d9e0f10004',
  'Ceramide Barrier Repair Cream',
  'moisturizer',
  ARRAY['eczema','psoriasis'],
  ARRAY['ceramide np','ceramide ap','ceramide eop','cholesterol','fatty acids'],
  ARRAY['fragrance','alcohol'],
  TRUE, 10,
  'Replenishes the physiologic ratio of ceramides, cholesterol, and fatty acids (3:1:1) to restore transepidermal '
  || 'water loss control. Clinically indicated as a daily maintenance moisturizer in atopic dermatitis and psoriasis.',
  NULL
),

-- 5. Coal Tar 1% Shampoo/Body Wash
(
  'a1b2c3d4-0005-4e5f-a6b7-c8d9e0f10005',
  'Coal Tar 1% Shampoo/Body Wash',
  'wash',
  ARRAY['psoriasis','seborrheic_keratoses'],
  ARRAY['coal tar 1%'],
  ARRAY['parabens'],
  TRUE, 7,
  'Coal tar normalises keratinocyte proliferation and has anti-inflammatory and anti-pruritic properties useful '
  || 'in scalp psoriasis and seborrhoeic dermatitis. Apply to affected areas, leave 5 minutes, then rinse thoroughly.',
  NULL
),

-- 6. Azelaic Acid 10% Gel
(
  'a1b2c3d4-0006-4e5f-a6b7-c8d9e0f10006',
  'Azelaic Acid 10% Gel',
  'treatment',
  ARRAY['acne','rosacea'],
  ARRAY['azelaic acid 10%'],
  ARRAY['fragrance','alcohol'],
  TRUE, 8,
  'Azelaic acid inhibits P. acnes proliferation, reduces post-inflammatory hyperpigmentation, and has direct '
  || 'anti-inflammatory action on erythema and papulopustular lesions in rosacea. Apply a thin layer twice daily.',
  NULL
),

-- 7. Hyaluronic Acid Hydrating Serum
(
  'a1b2c3d4-0007-4e5f-a6b7-c8d9e0f10007',
  'Hyaluronic Acid Hydrating Serum',
  'serum',
  ARRAY['eczema','rosacea'],
  ARRAY['sodium hyaluronate','hyaluronic acid','panthenol'],
  ARRAY['fragrance','alcohol','essential oils'],
  TRUE, 7,
  'Multi-weight hyaluronic acid binds up to 1000× its weight in water, delivering immediate and sustained '
  || 'hydration without occluding pores. Suitable as a first-step treatment for dehydrated, sensitive, or '
  || 'rosacea-prone skin; apply to damp skin and seal with a moisturizer.',
  NULL
),

-- 8. Benzoyl Peroxide 2.5% Gel
(
  'a1b2c3d4-0008-4e5f-a6b7-c8d9e0f10008',
  'Benzoyl Peroxide 2.5% Gel',
  'treatment',
  ARRAY['acne'],
  ARRAY['benzoyl peroxide 2.5%'],
  ARRAY['fragrance'],
  TRUE, 9,
  'Benzoyl peroxide releases free-radical oxygen that kills P. acnes without inducing antibiotic resistance. '
  || 'The 2.5% concentration is as effective as 5–10% with significantly less irritation and dryness; '
  || 'apply once daily to affected areas and avoid contact with fabric.',
  NULL
),

-- 9. Zinc Pyrithione 1% Wash
(
  'a1b2c3d4-0009-4e5f-a6b7-c8d9e0f10009',
  'Zinc Pyrithione 1% Wash',
  'wash',
  ARRAY['seborrheic_keratoses','tinea'],
  ARRAY['zinc pyrithione 1%'],
  ARRAY['sulfates','fragrance'],
  TRUE, 8,
  'Zinc pyrithione disrupts the membrane of Malassezia furfur and dermatophytes, reducing fungal colonisation '
  || 'that drives seborrhoeic dermatitis and tinea versicolor. Use as a daily or alternate-day body wash; '
  || 'can also be used as a 5-minute leave-on scalp treatment.',
  NULL
),

-- 10. Clotrimazole 1% Antifungal Cream
(
  'a1b2c3d4-0010-4e5f-a6b7-c8d9e0f10010',
  'Clotrimazole 1% Antifungal Cream',
  'treatment',
  ARRAY['tinea'],
  ARRAY['clotrimazole 1%'],
  ARRAY['fragrance'],
  TRUE, 9,
  'An imidazole antifungal that inhibits ergosterol synthesis, disrupting the fungal cell membrane of '
  || 'dermatophytes responsible for tinea pedis, tinea corporis, and tinea cruris. Apply twice daily for '
  || '2–4 weeks; continue for 1 week after resolution to prevent relapse.',
  NULL
),

-- 11. Antifungal Body Wash (Ketoconazole-free / selenium-free alternative)
(
  'a1b2c3d4-0011-4e5f-a6b7-c8d9e0f10011',
  'Terbinafine-Free Antifungal Body Wash',
  'wash',
  ARRAY['tinea'],
  ARRAY['undecylenic acid','tea tree oil 5%'],
  ARRAY['sulfates','parabens','fragrance'],
  TRUE, 6,
  'Natural antifungal body wash combining undecylenic acid and tea tree oil to reduce surface dermatophyte '
  || 'load on the trunk and limbs. Useful as an adjunct to prescription antifungal therapy or for maintenance '
  || 'in recurrent tinea versicolor; lather and leave on for 2–3 minutes before rinsing.',
  NULL
),

-- 12. SPF 50 Mineral Sunscreen
(
  'a1b2c3d4-0012-4e5f-a6b7-c8d9e0f10012',
  'SPF 50 Mineral Sunscreen (Broad-Spectrum)',
  'sunscreen',
  ARRAY['rosacea'],
  ARRAY['zinc oxide 15%','titanium dioxide 7%'],
  ARRAY['chemical uv filters','fragrance','alcohol','oxybenzone','avobenzone'],
  TRUE, 10,
  'Physical blockers zinc oxide and titanium dioxide reflect UV and visible light without chemical reactions, '
  || 'making this the preferred sunscreen for rosacea and Fitzpatrick IV–VI phototypes where heat triggers '
  || 'flushing and chemical filters may cause irritation. Apply 15 minutes before sun exposure and reapply '
  || 'every 2 hours.',
  NULL
),

-- 13. Mandelic Acid 5% Toner
(
  'a1b2c3d4-0013-4e5f-a6b7-c8d9e0f10013',
  'Mandelic Acid 5% Toner',
  'toner',
  ARRAY['acne','seborrheic_keratoses'],
  ARRAY['mandelic acid 5%','witch hazel'],
  ARRAY['fragrance','alcohol','sulfates'],
  TRUE, 6,
  'Mandelic acid is a large-molecule alpha-hydroxy acid that penetrates slowly, making it better tolerated '
  || 'than glycolic acid on sensitive or darker skin tones. It exfoliates the stratum corneum, unblocks pores, '
  || 'and mildly inhibits Malassezia, making it useful in acne and seborrhoeic conditions.',
  NULL
),

-- 14. Centella Asiatica Soothing Cream
(
  'a1b2c3d4-0014-4e5f-a6b7-c8d9e0f10014',
  'Centella Asiatica Soothing Cream',
  'moisturizer',
  ARRAY['eczema','rosacea'],
  ARRAY['centella asiatica extract','madecassoside','asiaticoside','glycerin'],
  ARRAY['fragrance','essential oils','alcohol','dyes'],
  TRUE, 8,
  'Madecassoside and asiaticoside from Centella asiatica suppress NF-κB-driven inflammation and promote '
  || 'collagen synthesis, accelerating barrier recovery after flares. Particularly effective as a calming '
  || 'post-procedure or post-flare cream for rosacea and atopic eczema.',
  NULL
),

-- 15. Panthenol 5% Barrier Lotion
(
  'a1b2c3d4-0015-4e5f-a6b7-c8d9e0f10015',
  'Panthenol 5% Barrier Lotion',
  'moisturizer',
  ARRAY['eczema','psoriasis'],
  ARRAY['panthenol 5%','glycerin','allantoin'],
  ARRAY['fragrance','parabens','mineral oil'],
  TRUE, 7,
  'Panthenol (pro-vitamin B5) is converted to pantothenic acid in the skin, stimulating fibroblast proliferation '
  || 'and supporting epithelialisation. At 5%, it reliably reduces transepidermal water loss and is suitable for '
  || 'daily use in eczema and psoriasis as a lightweight, fast-absorbing maintenance moisturizer.',
  NULL
)

ON CONFLICT (name) DO NOTHING;

-- =====================================================================
-- Backfill embeddings after running migration 002:
--   python -m app.rag.backfill
-- =====================================================================
