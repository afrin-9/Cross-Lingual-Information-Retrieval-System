"""Search engine for the CLIR web app.

Mirrors the notebooks: tokenizers and BM25 from Module C, language detection
and MarianMT query translation from Module D.
"""
import json
import logging
import os
import re
import threading
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
from rank_bm25 import BM25Okapi

log = logging.getLogger("clir")

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.getenv("CLIR_DATA_DIR", ROOT / "data"))

BN_EN_NAME = "Helsinki-NLP/opus-mt-bn-en"
EN_BN_NAME = "shhossain/opus-mt-en-to-bn"


# ---------- Module C tokenizers ----------
def tokenize_en(text):
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text.split()


def tokenize_bn(text):
    text = re.sub(r"\s+", " ", text).strip()
    return text.split()


TOKENIZERS = {"en": tokenize_en, "bn": tokenize_bn}


# ---------- Module D language detection ----------
def is_bangla(text):
    return any(0x0980 <= ord(ch) <= 0x09FF for ch in text)


def _load_json(name):
    path = DATA_DIR / name
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


class Corpus:
    """One language: the cleaned docs indexed with BM25, plus display metadata."""

    def __init__(self, lang):
        self.lang = lang
        clean = _load_json(f"document_{lang}_clean.json")
        if clean is None:
            raise FileNotFoundError(f"Missing {DATA_DIR / f'document_{lang}_clean.json'}")
        raw = _load_json(f"document_{lang}.json") or []
        # Module B overwrote English clean titles with the lowercased body,
        # so show the original title/body from the raw crawl when available.
        raw_by_id = {d.get("doc_id"): d for d in raw}

        tok = TOKENIZERS[lang]
        corpus = []
        self.docs = []
        for d in clean:
            corpus.append(tok((d.get("title", "") + " " + d.get("body", "")).strip()))
            orig = raw_by_id.get(d.get("doc_id"), d)
            url = d.get("url", "")
            self.docs.append({
                "doc_id": d.get("doc_id", ""),
                "title": (orig.get("title") or d.get("title") or "").strip(),
                "body": (orig.get("body") or d.get("body") or "").strip(),
                "url": url,
                "source": urlparse(url).netloc.removeprefix("www."),
                "date": d.get("date", ""),
                "language": lang,
                "token_count": _to_int(d.get("token_count")),
            })
        self.bm25 = BM25Okapi(corpus)
        self.by_id = {d["doc_id"]: d for d in self.docs}
        self.raw_count = len(raw) or len(clean)
        log.info("Indexed %d %s docs", len(self.docs), lang)

    def search(self, query, top_k=10):
        q = TOKENIZERS[self.lang](query)
        if not q:
            return q, []
        scores = self.bm25.get_scores(q)
        k = min(top_k, len(scores))
        idx = np.argpartition(-scores, k - 1)[:k]
        idx = idx[np.argsort(-scores[idx])]
        out = []
        for i in idx:
            if scores[i] <= 0:
                break
            d = self.docs[i]
            out.append({**_summary(d), "score": round(float(scores[i]), 4),
                        "snippet": _snippet(d["body"], q)})
        return q, out

    def stats(self):
        tokens = np.array([d["token_count"] for d in self.docs])
        edges = [20, 50, 100, 200, 400, 800, 1600]
        labels = ["20–49", "50–99", "100–199", "200–399", "400–799", "800–1599", "1600+"]
        hist = np.histogram(tokens, bins=edges + [max(int(tokens.max()) + 1, 1601)])[0]
        return {
            "raw": self.raw_count,
            "clean": len(self.docs),
            "dated": sum(1 for d in self.docs if d["date"]),
            "avg_tokens": round(float(tokens.mean()), 1),
            "median_tokens": int(np.median(tokens)),
            "total_tokens": int(tokens.sum()),
            "vocab": len(self.bm25.idf),
            "sources": Counter(d["source"] for d in self.docs).most_common(),
            "token_hist": [{"label": l, "count": int(c)} for l, c in zip(labels, hist)],
        }


def _summary(d):
    return {k: d[k] for k in ("doc_id", "title", "url", "source", "date", "language", "token_count")}


def _snippet(body, q_tokens, width=280):
    lower = body.lower()
    pos = min((p for p in (lower.find(t) for t in q_tokens) if p >= 0), default=0)
    start = max(0, pos - width // 3)
    snip = body[start:start + width]
    return ("…" if start else "") + snip + ("…" if start + width < len(body) else "")


class Translator:
    """MarianMT BN<->EN (Module D). Loads in a background thread; optional."""

    def __init__(self):
        self.mode = os.getenv("CLIR_TRANSLATION", "marian").lower()
        self.status = "disabled" if self.mode == "off" else "loading"
        self.error = None
        self._lock = threading.Lock()
        if self.status == "loading":
            threading.Thread(target=self._load, daemon=True).start()

    def _load(self):
        try:
            import torch
            from transformers import MarianMTModel, MarianTokenizer
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
            self.tok_bn_en = MarianTokenizer.from_pretrained(BN_EN_NAME)
            self.mod_bn_en = MarianMTModel.from_pretrained(BN_EN_NAME).to(self.device).eval()
            self.tok_en_bn = MarianTokenizer.from_pretrained(EN_BN_NAME)
            self.mod_en_bn = MarianMTModel.from_pretrained(EN_BN_NAME).to(self.device).eval()
            self.status = "ready"
            log.info("Translation models ready on %s", self.device)
        except Exception as e:  # missing deps, no network, OOM...
            self.status, self.error = "unavailable", str(e)
            log.warning("Translation unavailable: %s", e)

    def translate(self, text, src):
        if self.status != "ready":
            return None
        import torch
        tok, mod = (self.tok_bn_en, self.mod_bn_en) if src == "bn" else (self.tok_en_bn, self.mod_en_bn)
        with self._lock, torch.no_grad():
            batch = tok([text], return_tensors="pt", padding=True, truncation=True).to(self.device)
            gen = mod.generate(**batch, max_new_tokens=128)
            return tok.batch_decode(gen, skip_special_tokens=True)[0]


class Engine:
    def __init__(self):
        self.translator = Translator()
        self.corpora = {"en": Corpus("en"), "bn": Corpus("bn")}
        self._stats = {lang: c.stats() for lang, c in self.corpora.items()}

    def clir_search(self, query, top_k=10, translated=None):
        """Module D clir_search: search the query's own language directly and
        the other language via the (possibly user-supplied) translation."""
        src = "bn" if is_bangla(query) else "en"
        tgt = "en" if src == "bn" else "bn"
        source = "manual"
        if not translated:
            translated = self.translator.translate(query, src)
            source = "marian" if translated else None
        q_src, res_src = self.corpora[src].search(query, top_k)
        # Without a translation the query shares no terms with the other index.
        q_tgt, res_tgt = self.corpora[tgt].search(translated, top_k) if translated else ([], [])
        return {
            "query": query,
            "query_language": src,
            "translated_query": translated,
            "translation_source": source,
            "translation_status": self.translator.status,
            "results": {
                src: {"query_tokens": q_src, "hits": res_src},
                tgt: {"query_tokens": q_tgt, "hits": res_tgt},
            },
        }

    def get_doc(self, doc_id):
        for c in self.corpora.values():
            if doc_id in c.by_id:
                return c.by_id[doc_id]
        return None

    def browse(self, lang, source=None, text=None, page=1, size=20):
        docs = self.corpora[lang].docs
        if source:
            docs = [d for d in docs if d["source"] == source]
        if text:
            t = text.lower()
            docs = [d for d in docs if t in d["title"].lower()]
        start = (page - 1) * size
        return {
            "total": len(docs),
            "page": page,
            "size": size,
            "items": [{**_summary(d), "snippet": d["body"][:220]} for d in docs[start:start + size]],
        }

    def stats(self):
        return {
            "languages": self._stats,
            "translation": {"status": self.translator.status, "error": self.translator.error,
                            "models": {"bn→en": BN_EN_NAME, "en→bn": EN_BN_NAME}},
        }
