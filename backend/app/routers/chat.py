import json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.auth import get_current_user, CurrentUser
from app.services.supabase_client import get_supabase
from app.services import groq_service, product_catalog
from app.rag.retriever import RagRetriever
from app.guardrail.guardrail import validate

router = APIRouter(prefix="/chat", tags=["chat"])

class ChatRequest(BaseModel):
    message: str
    # Both optional: the general chat page has neither; the "Ask about your
    # results" hand-off passes a condition; analysis-scoped chat passes an id.
    analysis_id: str | None = None
    condition: str | None = None
    chat_history: list[dict] = []

@router.post("")
async def chat(body: ChatRequest, user: CurrentUser = Depends(get_current_user)):
    supabase = get_supabase()

    condition = (body.condition or "general").strip() or "general"

    # If an analysis id is supplied, use its condition — but never hard-fail
    # general chat when it's missing or not found.
    if body.analysis_id:
        result = supabase.table("analysis_results").select(
            "id, primary_condition, llm_explanation"
        ).eq("id", body.analysis_id).eq("user_id", user.id).maybe_single().execute()
        if result and result.data and result.data.get("primary_condition"):
            condition = result.data["primary_condition"]

    # retrieve() is synchronous — no await
    rag_context = RagRetriever(supabase).retrieve(condition, "")

    try:
        response_text = groq_service.generate_chat_response(
            primary_condition=condition,
            rag_context=rag_context,
            chat_history=body.chat_history,
            user_message=body.message,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Chat model error: {e}")

    # Guard: never surface an empty answer (which would collapse to a bare
    # disclaimer). Fall back to a helpful line instead.
    if not response_text or not response_text.strip():
        response_text = (
            "I couldn't generate a full answer just now — please rephrase your "
            "question or try again in a moment."
        )

    # Whitelist from RAG, or the mock catalog when the vector store is empty.
    whitelist = rag_context.product_whitelist or product_catalog.whitelist_names(condition)
    # strip_hallucinated_products=False: only flag, never delete sentences (the
    # old stripping mangled answers and left artifacts like ".g").
    # enforce_disclaimer=False: the chat prompt already ends with a short caution
    # when relevant; we do NOT bolt the long disclaimer onto every reply — the
    # user asked for answers, not a disclaimer wall.
    validation = validate(
        response_text,
        product_names=whitelist,
        strip_hallucinated_products=False,
        enforce_disclaimer=False,
    )

    return {
        "response": validation.cleaned_text,
        "guardrail_flags": [f.__dict__ for f in validation.flagged_items],
    }
