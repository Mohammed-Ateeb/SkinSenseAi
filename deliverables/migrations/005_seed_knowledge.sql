-- =====================================================================
-- SkinSense AI — Migration 005: Seed Clinical Knowledge
-- =====================================================================
-- Inserts 12 clinical knowledge chunks into public.skincare_knowledge
-- (created in migration 002).  Covers all 6 target conditions plus
-- skin barrier science and Fitzpatrick phototypes.
--
-- embedding is set to NULL — backfill via `python -m app.rag.backfill`
--
-- Idempotent: ON CONFLICT on the unique index below.
-- =====================================================================

-- Unique content index so re-runs are safe
CREATE UNIQUE INDEX IF NOT EXISTS skincare_knowledge_content_unique
  ON public.skincare_knowledge (md5(content));

INSERT INTO public.skincare_knowledge
  (id, content, source, condition, embedding)
VALUES

-- 1. Acne: pathophysiology
(
  'b2c3d4e5-0001-4f6a-b7c8-d9e0f1a20001',
  'Acne vulgaris is a multifactorial inflammatory disorder of the pilosebaceous unit driven by four '
  || 'key mechanisms: follicular hyperkeratinisation (comedone formation), androgen-stimulated sebum '
  || 'overproduction, colonisation by Cutibacterium acnes (formerly P. acnes), and a subsequent '
  || 'innate immune inflammatory cascade releasing interleukins IL-1α, IL-8, and TNF-α. '
  || 'Comedones are the primary non-inflammatory lesion; rupture of the follicular wall triggers the '
  || 'inflammatory papule, pustule, nodule, and cyst spectrum. '
  || 'Genetic predisposition, diet (high glycaemic load, dairy), and psychological stress all amplify sebum output.',
  'Clinical Dermatology Guidelines',
  'acne',
  NULL
),

-- 2. Acne: OTC treatment ladder
(
  'b2c3d4e5-0002-4f6a-b7c8-d9e0f1a20002',
  'The OTC acne treatment ladder begins with benzoyl peroxide (BPO) 2.5–5%, which kills C. acnes '
  || 'via free-radical oxidation without inducing antibiotic resistance, making it first-line for '
  || 'mild-to-moderate inflammatory acne. Salicylic acid 0.5–2% is a comedolytic beta-hydroxy acid '
  || 'that dissolves the lipid plug and is preferred for non-inflammatory comedonal acne. '
  || 'Niacinamide 4–10% reduces sebum excretion rate and is anti-inflammatory via PGE2 suppression; '
  || 'azelaic acid 10–20% adds keratolytic, antibacterial, and post-inflammatory hyperpigmentation '
  || 'benefits. Persistent moderate-to-severe acne requires clinician referral for topical or oral retinoids.',
  'AAD Acne Clinical Guideline 2024',
  'acne',
  NULL
),

-- 3. Eczema: skin barrier dysfunction
(
  'b2c3d4e5-0003-4f6a-b7c8-d9e0f1a20003',
  'Atopic dermatitis (eczema) is fundamentally a defect in the epidermal barrier, most often caused '
  || 'by loss-of-function mutations in FLG (filaggrin), which reduce natural moisturising factor and '
  || 'disrupt the cornified envelope. This increases transepidermal water loss (TEWL) from a normal '
  || '5–10 g/m²/h to upwards of 30–70 g/m²/h during flares, leading to chronic xerosis. '
  || 'Barrier failure permits allergen penetration and microbial colonisation — notably Staphylococcus '
  || 'aureus in >90% of lesional skin — which drives the Th2/Th22-skewed inflammatory response '
  || 'characterised by markedly elevated serum IgE, IL-4, IL-13, and IL-31 (the primary itch mediator).',
  'Skin Barrier Research',
  'eczema',
  NULL
),

-- 4. Eczema: wet wrapping and trigger avoidance
(
  'b2c3d4e5-0004-4f6a-b7c8-d9e0f1a20004',
  'Wet-wrap therapy involves applying a topical emollient or diluted corticosteroid, covering the '
  || 'area with a damp tubular bandage, and then a dry outer layer; this creates an occlusive microenvironment '
  || 'that dramatically reduces TEWL and delivers the active ingredient 10-fold more effectively. '
  || 'Common environmental triggers to avoid include fragrance and perfume (most frequent contact sensitiser), '
  || 'sodium lauryl sulphate (SLS) which disrupts tight junctions at concentrations >0.1%, house dust mite, '
  || 'pet dander, and extremes of temperature. '
  || 'Daily gentle cleansing with a pH-balanced (5.5), soap-free, fragrance-free wash is recommended to '
  || 'preserve the acid mantle without compromising barrier lipid composition.',
  'AAD Atopic Dermatitis Guidelines',
  'eczema',
  NULL
),

-- 5. Psoriasis: pathophysiology
(
  'b2c3d4e5-0005-4f6a-b7c8-d9e0f1a20005',
  'Psoriasis is a T-cell-mediated chronic inflammatory skin disease in which plasmacytoid dendritic '
  || 'cells and keratinocytes amplify an IL-23/Th17 axis, producing massive IL-17A, IL-22, and TNF-α '
  || 'output that drives keratinocyte hyperproliferation — reducing epidermal turnover from the normal '
  || '28 days to 3–5 days. The result is the classic well-demarcated erythematous plaque with silvery '
  || 'micaceous scale. The Koebner (isomorphic) phenomenon — new plaques appearing at sites of physical '
  || 'trauma within 10–20 days — affects approximately 25% of patients and is a useful diagnostic clue.',
  'British Association of Dermatologists Psoriasis Guidelines',
  'psoriasis',
  NULL
),

-- 6. Psoriasis: topical management
(
  'b2c3d4e5-0006-4f6a-b7c8-d9e0f1a20006',
  'Coal tar (1–5%) is one of the oldest effective keratolytic and anti-inflammatory agents for psoriasis; '
  || 'it suppresses DNA synthesis in rapidly dividing keratinocytes and is particularly useful for scalp '
  || 'and nail psoriasis. Salicylic acid 2–6% acts as a keratolytic, softening and lifting adherent scale '
  || 'to improve penetration of other topicals. Daily generous emollient use (minimum 250 g/week) is not '
  || 'merely cosmetic — it reduces plaque thickness, decreases topical corticosteroid requirements by up to '
  || '30%, and blunts the itch-scratch cycle that worsens psoriatic plaques.',
  'Clinical Dermatology Guidelines',
  'psoriasis',
  NULL
),

-- 7. Rosacea: vascular triggers and SPF
(
  'b2c3d4e5-0007-4f6a-b7c8-d9e0f1a20007',
  'Rosacea is a chronic facial inflammatory condition whose hallmark is neurovascular dysregulation: '
  || 'transient receptor potential (TRP) ion channels on facial cutaneous nerves are hypersensitive to '
  || 'temperature, UV radiation, capsaicin, and ethanol, triggering exaggerated vasodilation (flushing). '
  || 'Common vascular triggers that patients should systematically identify and avoid include hot beverages, '
  || 'spicy food, alcohol (especially red wine and spirits), strenuous exercise, extreme temperatures, and '
  || 'emotional stress. '
  || 'Broad-spectrum mineral SPF 30–50 is non-negotiable: UV exposure is the most consistent rosacea '
  || 'trigger across all subtypes and also upregulates cathelicidin LL-37, the antimicrobial peptide '
  || 'central to rosacea pathogenesis.',
  'National Rosacea Society Expert Committee Guidelines',
  'rosacea',
  NULL
),

-- 8. Rosacea: niacinamide and azelaic acid
(
  'b2c3d4e5-0008-4f6a-b7c8-d9e0f1a20008',
  'Niacinamide at 4–10% concentration reduces rosacea erythema by suppressing prostaglandin E2-mediated '
  || 'vasodilation and decreasing TEWL, strengthening the impaired barrier common in ETR (erythematotelangiectatic '
  || 'rosacea) subtype. Azelaic acid 15–20% (prescription) and 10% (OTC) is first-line for papulopustular '
  || 'rosacea (PPR): it normalises keratinisation, reduces Demodex density, and directly inhibits the reactive '
  || 'oxygen species production in neutrophils that perpetuates the PPR inflammatory cycle. '
  || 'Both agents are well tolerated on Fitzpatrick IV–VI skin tones without risk of post-inflammatory '
  || 'hyperpigmentation that limits other treatments.',
  'AAD Rosacea Clinical Guideline 2019',
  'rosacea',
  NULL
),

-- 9. Seborrheic Keratoses: differentiation and management
(
  'b2c3d4e5-0009-4f6a-b7c8-d9e0f1a20009',
  'Seborrhoeic keratoses (SK) are benign epidermal tumours arising from keratinocyte proliferation; '
  || 'they appear as well-demarcated, "stuck-on," waxy plaques that range from tan to dark brown and '
  || 'are characterised by keratin-filled pseudocysts (comedo-like openings) on dermoscopy — a key '
  || 'differentiator from melanoma. Unlike melanocytic lesions, SKs do not arise from melanocytes and '
  || 'carry no malignant potential; however, sudden eruption of multiple SKs (sign of Leser-Trélat) may '
  || 'indicate an underlying internal malignancy. '
  || 'Zinc pyrithione washes reduce the Malassezia colonisation that can secondarily inflame SKs on the scalp '
  || 'and trunk, alleviating associated itch and scaling without addressing the lesion itself.',
  'Clinical Dermatology Guidelines',
  'seborrheic_keratoses',
  NULL
),

-- 10. Tinea: dermatophyte infections and treatment
(
  'b2c3d4e5-0010-4f6a-b7c8-d9e0f1a20010',
  'Tinea (dermatophytosis) is caused by keratinophilic fungi — Trichophyton, Microsporum, and Epidermophyton '
  || 'species — that invade the non-living keratinised layers of skin, hair, and nails. '
  || 'Azole antifungals (clotrimazole, miconazole, ketoconazole) inhibit lanosterol 14α-demethylase, '
  || 'blocking ergosterol synthesis and disrupting membrane integrity; allylamines (terbinafine) inhibit '
  || 'squalene epoxidase, causing lethal squalene accumulation rather than just ergostatic effects — making '
  || 'them fungicidal rather than fungistatic and requiring a shorter treatment course. '
  || 'Hygiene measures — keeping affected areas dry, using separate towels, avoiding shared footwear, and '
  || 'washing bed linen at 60°C — are essential to prevent autoreinfection and household spread.',
  'Infectious Diseases Society Clinical Practice Guidelines',
  'tinea',
  NULL
),

-- 11. Skin Barrier Science
(
  'b2c3d4e5-0011-4f6a-b7c8-d9e0f1a20011',
  'The stratum corneum functions as the primary permeability barrier through its "brick and mortar" '
  || 'architecture: corneocytes (bricks) embedded in a lamellar lipid matrix (mortar) composed of ceramides '
  || '(~50%), free fatty acids (~15%), and cholesterol (~25%), optimally in a 3:1:1 molar ratio. '
  || 'Disruption of this ratio — by harsh cleansers, low-humidity environments, or genetic FLG mutations — '
  || 'raises TEWL and increases skin sensitivity. '
  || 'The acid mantle (skin surface pH 4.5–5.5) is maintained by secretion of lactic acid and free fatty '
  || 'acids; alkaline shift above pH 6 activates serine proteases that degrade corneodesmosomal proteins, '
  || 'accelerating desquamation and impairing antimicrobial defence.',
  'Skin Barrier Research',
  'general',
  NULL
),

-- 12. Fitzpatrick Scale and SPF recommendations
(
  'b2c3d4e5-0012-4f6a-b7c8-d9e0f1a20012',
  'The Fitzpatrick phototype scale classifies skin into six types based on constitutive melanin content '
  || 'and UV tanning/burning response: Type I (always burns, never tans; MC1R variants, red/blonde hair) '
  || 'through Type VI (deeply pigmented, never burns; highest epidermal melanin index). '
  || 'Melanin provides intrinsic SPF: Type I skin has an estimated natural SPF of ~1–3, Type VI ~8–13. '
  || 'Despite this, Types IV–VI still accumulate UV-induced DNA damage and are not immune to photocarcinogenesis; '
  || 'furthermore, UV triggers post-inflammatory hyperpigmentation (PIH) more readily in higher phototypes. '
  || 'AAD recommendations: Types I–II should use SPF 50+ broad-spectrum daily; Types III–VI require minimum '
  || 'SPF 30, with preference for mineral sunscreens to avoid irritation and to minimise the white cast '
  || 'associated with zinc oxide through newer cosmetically elegant formulations.',
  'AAD Photoprotection Recommendations',
  'general',
  NULL
)

ON CONFLICT DO NOTHING;

-- =====================================================================
-- Backfill embeddings after running migration 002:
--   python -m app.rag.backfill
-- =====================================================================
