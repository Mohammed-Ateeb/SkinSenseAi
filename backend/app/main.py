import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from app.routers import analyze, chat, upload, history
from app.ml.router import router as ml_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield

app = FastAPI(title="SkinSense AI API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", os.getenv("FRONTEND_URL", "")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ml_router)
app.include_router(analyze.router)
app.include_router(chat.router)
app.include_router(upload.router)
app.include_router(history.router)

@app.get("/health")
def health():
    return {"status": "ok", "service": "skinsense-ai"}
