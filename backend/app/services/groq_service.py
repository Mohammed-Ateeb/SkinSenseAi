import os
from groq import Groq
from app.ml.inference import PredictionResult
from app.rag.retriever import RetrievedContext
from app.services import product_catalog

# Groq chat model. Overridable via GROQ_MODEL. Default is a model this
# account has access to (Llama models return model_not_found on this key,
# and the older llama3/gemma ids are decommissioned).
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")

_client: Groq | None = None

_SHORT_DISCLAIMER = (
    "This is AI guidance, not a diagnosis — see a dermatologist for anything "
    "persistent, painful, spreading, or changing."
)


def get_groq_client() -> Groq:
    global _client
    if _client is None:
        _client = Groq(api_key=os.environ["GROQ_API_KEY"])
    return _client


def _products_text(rag_context: RetrievedContext, condition: str) -> str:
    """Approved products for the prompt — RAG results, or the mock catalog fallback."""
    if rag_context.products:
        lines = []
        for p in rag_context.products[:5]:
            ings = ", ".join(p.active_ingredients[:3]) if p.active_ingredients else "various actives"
            lines.append(f"- {p.name} ({ings})")
        return "\n".join(lines)
    return product_catalog.prompt_lines(condition)


def _knowledge_text(rag_context: RetrievedContext) -> str:
    lines = [f"- [{k.condition}] {k.content[:200]}..." for k in rag_context.knowledge[:3]]
    return "\n".join(lines)


def build_analysis_prompt(rag_context: RetrievedContext, condition: str) -> str:
    """System prompt for the full post-scan skin report (structured, specific)."""
    readable = condition.replace("_", " ")
    return f"""You are SkinSense AI, a dermatology assistant. An image classifier has \
detected **{readable}** in the user's photo. Write specific, practical guidance for \
THIS condition — not generic skincare filler.

HARD RULES:
- Never recommend prescription-only items (tretinoin, isotretinoin, oral/topical antibiotics, corticosteroids stronger than OTC hydrocortisone 1%, biologics).
- Only recommend from the APPROVED PRODUCTS list below. Use their exact names.
- Never claim certainty — this is a screening aid, not a diagnosis.
- Write in clear, warm, plain English. Short paragraphs. You may use a few short bold labels, but do NOT number every line or wrap text in stray asterisks.

APPROVED PRODUCTS:
{_products_text(rag_context, condition)}

CLINICAL NOTES (optional grounding):
{_knowledge_text(rag_context)}

Cover, tailored to {readable}:
1. What {readable} is and how it typically looks/feels — tie it to what was detected.
2. A simple AM and PM routine using ONLY the approved products above, with how to apply each.
3. Habits or triggers that specifically help or worsen {readable}.
4. Clear signs that mean they should see a dermatologist.

End with ONE short line: "{_SHORT_DISCLAIMER}"
Keep it under 350 words. Answer the condition specifically — no vague boilerplate."""


def build_chat_prompt(rag_context: RetrievedContext, condition: str) -> str:
    """System prompt for conversational chat — answers the question directly."""
    readable = condition.replace("_", " ") if condition and condition != "general" else None
    context_line = (
        f"The user's most recent skin analysis detected **{readable}**. Assume questions "
        f"relate to that unless they clearly ask about something else."
        if readable else
        "The user has not run a recent analysis, so answer their skin question generally."
    )
    return f"""You are SkinSense AI, a friendly, expert dermatology assistant. Give
accurate, specific, genuinely useful answers — like a knowledgeable clinician talking
to a patient, not a generic wellness bot.

{context_line}

HOW TO ANSWER:
- ANSWER THE QUESTION DIRECTLY AND FIRST. Never open with a disclaimer. Never refuse to answer a general skin question.
- Be SPECIFIC and substantive: real causes, mechanisms, concrete steps, realistic timelines. Use dermatology facts (e.g. for acne: excess sebum, follicular hyperkeratinisation, C. acnes, inflammation, hormones/androgens, diet/dairy & high-glycaemic foods, friction, stress).
- Tailor to their detected condition when relevant. Avoid vague filler like "consult a professional" as the whole answer.
- 2-4 short paragraphs or a tight list. Plain English. Light formatting only — you may bold a few key terms; no rigid numbered templates, no stray asterisks.
- Only mention over-the-counter products, preferring the approved names below. Never recommend prescription-only medication.
- Do NOT append a long medical disclaimer. Only if the topic is genuinely serious (spreading infection, severe pain, suspicious lesion) add ONE short sentence advising they see a dermatologist.

APPROVED PRODUCTS (use exact names if you mention any):
{_products_text(rag_context, condition)}"""


def generate_analysis(
    predict_result: PredictionResult,
    rag_context: RetrievedContext,
    additional_context: str = "",
) -> str:
    client = get_groq_client()

    diff_lines = [f"  - {d.condition.replace('_',' ')}: {d.confidence:.1%}"
                  for d in predict_result.differential_diagnoses]
    diff_text = "\n".join(diff_lines)

    confidence_note = ""
    if predict_result.low_confidence_flag:
        confidence_note = "\nNote: model confidence is LOW — treat findings as tentative and lead with that."
    elif not predict_result.confidence_threshold_met:
        confidence_note = "\nNote: model confidence is below optimal — mention results may be less reliable."

    user_message = f"""Skin analysis results:

DETECTED CONDITION: {predict_result.primary_condition.replace('_', ' ').title()} \
(confidence {predict_result.confidence_score:.1%})
OTHER POSSIBILITIES:
{diff_text}{confidence_note}
{f"USER CONTEXT: {additional_context}" if additional_context else ""}

Give guidance specific to the detected condition."""

    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": build_analysis_prompt(rag_context, predict_result.primary_condition)},
            {"role": "user", "content": user_message},
        ],
        temperature=0.4,
        max_tokens=900,
    )
    return response.choices[0].message.content or ""


def generate_chat_response(
    primary_condition: str,
    rag_context: RetrievedContext,
    chat_history: list[dict],
    user_message: str,
) -> str:
    client = get_groq_client()

    messages = [{"role": "system", "content": build_chat_prompt(rag_context, primary_condition)}]
    for msg in chat_history[-10:]:  # last 10 for context window
        if msg.get("role") in ("user", "assistant"):
            messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": user_message})

    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=messages,
        temperature=0.5,
        max_tokens=700,
    )
    return response.choices[0].message.content or ""
