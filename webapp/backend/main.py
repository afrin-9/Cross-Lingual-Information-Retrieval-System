"""FastAPI server: JSON API under /api and the static frontend at /."""
import logging
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from engine import Engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

app = FastAPI(title="Cross-Lingual IR System")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

engine = Engine()


@app.get("/api/health")
def health():
    return {"ok": True, "translation": engine.translator.status}


@app.get("/api/search")
def search(
    q: str = Query(..., min_length=1, max_length=300),
    k: int = Query(10, ge=1, le=50),
    tq: Optional[str] = Query(None, max_length=300, description="Override the machine translation"),
):
    return engine.clir_search(q.strip(), top_k=k, translated=(tq or "").strip() or None)


@app.get("/api/doc/{doc_id}")
def doc(doc_id: str):
    d = engine.get_doc(doc_id)
    if d is None:
        raise HTTPException(404, "Document not found")
    return d


@app.get("/api/docs")
def docs(
    lang: str = Query("en", pattern="^(en|bn)$"),
    source: Optional[str] = None,
    text: Optional[str] = None,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
):
    return engine.browse(lang, source, text, page, size)


@app.get("/api/stats")
def stats():
    return engine.stats()


FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
