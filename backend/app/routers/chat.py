import json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.auth import get_current_user, CurrentUser
from app.services.supabase_client import get_supabase
from app.services import groq_service
from app.rag.retriever import RagRetriever
from app.guardrail.guardrail import validate

router = APIRouter(prefix="/chat", tags=["chat"])

class ChatRequest(BaseModel):
    analysis_id: str
    message: str
    chat_history: list[dict] = []

@router.post("")
async def chat(body: ChatRequest, user: CurrentUser = Depends(get_current_user)):
    supabase = get_supabase()

    result = supabase.table("analysis_results").select(
        "id, primary_condition, llm_explanation"
    ).eq("id", body.analysis_id).eq("user_id", user.id).single().execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Analysis not found")

    analysis = result.data
    # retrieve() is synchronous — no await
    rag_context = RagRetriever(supabase).retrieve(
        analysis["primary_condition"] or "general", ""
    )

    response_text = groq_service.generate_chat_response(
        primary_condition=analysis["primary_condition"] or "general",
        rag_context=rag_context,
        chat_history=body.chat_history,
        user_message=body.message,
    )

    # validate() uses keyword-only arg product_names (after *)
    validation = validate(
        response_text,
        product_names=rag_context.product_whitelist,
    )

    return {
        "response": validation.cleaned_text,
        "guardrail_flags": [f.__dict__ for f in validation.flagged_items],
    }
