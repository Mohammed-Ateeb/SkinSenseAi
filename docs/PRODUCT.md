# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People experiencing unexplained or recurring skin conditions — redness, rashes, persistent breakouts, flaking — who are not sure what they have and want a fast, private starting point before or instead of a dermatology appointment. Secondary: people actively managing a diagnosed condition who want to track whether their routine is working over time.

## Product Purpose

SkinSense AI lets anyone photograph a skin concern and receive an evidence-based AI analysis in under a minute: primary condition detected, confidence score, top-3 differentials, and OTC product recommendations guardrailed against hallucination. A Digital Skin Twin updates after every scan, tracking barrier integrity, hydration index, and active flare-ups over time so the user can see whether their routine is making a real difference.

## Positioning

The only skin analysis tool with a Digital Skin Twin: a persistent, personalized model of the user's skin state that updates chronologically and generates routine adjustments — not a one-shot result that disappears.

## Operating Context

Used privately, at home, on a phone or laptop. Images are immediately deleted after feature extraction; only anonymized embeddings and metadata persist. The user makes skincare decisions on a weekly-to-monthly cycle, scanning after new products or flare-ups. They may share results with a dermatologist.

## Capabilities and Constraints

- 6 conditions: Acne, Eczema, Psoriasis, Rosacea, Seborrheic Keratoses, Tinea
- EfficientNet-B0 CNN inference (mock mode active until trained weights available)
- RAG-powered OTC product recommendations with post-generation guardrail
- Digital Twin: barrier integrity, hydration index, active flare-ups, Fitzpatrick skin tone
- Groq LLM for explanation generation
- Images deleted from storage immediately after analysis
- No prescription medications, no definitive diagnoses

## Brand Commitments

Name: SkinSense AI. Accent teal #7FD8BE, coral #E8927C. Voice: precise, warm, non-alarmist.

## Product Principles

1. Privacy is structural — images are ephemeral by design
2. Confidence calibration over false certainty
3. The twin outlasts the scan — longitudinal value over one-shot answers
4. OTC only — guardrail is non-negotiable
5. Clinical precision, human warmth
