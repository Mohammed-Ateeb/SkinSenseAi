import os
from groq import Groq
from app.ml.inference import PredictionResult
from app.rag.retriever import RetrievedContext

_client: Groq | None = None

def get_groq_client() -> Groq:
    global _client
    if _client is None:
        _client = Groq(api_key=os.environ["GROQ_API_KEY"])
    return _client

def build_system_prompt(rag_context: RetrievedContext) -> str:
    product_lines = []
    for p in rag_context.products[:5]:
        ingredients = ", ".join(p.active_ingredients[:3]) if p.active_ingredients else "various actives"
        product_lines.append(f"- {p.name}: {ingredients}")

    products_text = "\n".join(product_lines) if product_lines else "No specific products retrieved."

    knowledge_lines = []
    for k in rag_context.knowledge[:3]:
        knowledge_lines.append(f"- [{k.condition}] {k.content[:200]}...")
    knowledge_text = "\n".join(knowledge_lines) if knowledge_lines else ""

    return f"""You are SkinSense AI, an expert dermatology assistant powered by AI. You provide evidence-based, personalized skincare guidance.

CRITICAL RULES:
1. NEVER recommend prescription medications (tretinoin, isotretinoin, antibiotics, corticosteroids, biologics)
2. NEVER make definitive diagnoses — always recommend consulting a dermatologist for confirmation
3. ONLY recommend OTC (over-the-counter) products from the approved list below
4. Always include a disclaimer to see a dermatologist for persistent or severe conditions
5. Be empathetic, clear, and non-alarmist in tone

APPROVED PRODUCTS FOR THIS ANALYSIS:
{products_text}

RELEVANT CLINICAL KNOWLEDGE:
{knowledge_text}

RESPONSE FORMAT:
Structure your response with these sections:
1. **Condition Overview** — what the AI detected and what it typically means
2. **Recommended Products** — from the approved list only, with specific usage instructions (AM/PM, how to apply)
3. **Daily Routine** — morning and evening steps
4. **When to See a Dermatologist** — specific warning signs
5. **Disclaimer** — remind user this is AI-generated guidance, not medical advice

Keep responses helpful, actionable, and under 500 words."""

def generate_analysis(
    predict_result: PredictionResult,
    rag_context: RetrievedContext,
    additional_context: str = ""
) -> str:
    client = get_groq_client()

    diff_lines = []
    for d in predict_result.differential_diagnoses:
        diff_lines.append(f"  - {d.condition}: {d.confidence:.1%}")
    diff_text = "\n".join(diff_lines)

    confidence_note = ""
    if predict_result.low_confidence_flag:
        confidence_note = "\n⚠️ Note: The AI confidence is low — treat findings as tentative."
    elif not predict_result.confidence_threshold_met:
        confidence_note = "\n⚠️ Note: The AI confidence is below optimal — results may be less reliable."

    user_message = f"""AI skin analysis results for this patient:

PRIMARY DETECTED CONDITION: {predict_result.primary_condition.replace('_', ' ').title()}
CONFIDENCE: {predict_result.confidence_score:.1%}

TOP-3 DIFFERENTIAL DIAGNOSES:
{diff_text}
{confidence_note}
{f"ADDITIONAL PATIENT CONTEXT: {additional_context}" if additional_context else ""}

Please provide personalized skincare guidance based on these findings."""

    system_prompt = build_system_prompt(rag_context)

    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        temperature=0.4,
        max_tokens=800,
    )
    return response.choices[0].message.content or ""

def generate_chat_response(
    primary_condition: str,
    rag_context: RetrievedContext,
    chat_history: list[dict],
    user_message: str,
) -> str:
    client = get_groq_client()
    system_prompt = build_system_prompt(rag_context)

    messages = [{"role": "system", "content": system_prompt}]
    for msg in chat_history[-10:]:  # last 10 for context window
        if msg.get("role") in ("user", "assistant"):
            messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": user_message})

    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=messages,
        temperature=0.4,
        max_tokens=500,
    )
    return response.choices[0].message.content or ""
