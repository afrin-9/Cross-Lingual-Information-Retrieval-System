# Cross-Lingual IR web app: FastAPI backend + static frontend in one container.
# Build from the repo root:  docker build -t clir .
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/app/.hf \
    PORT=7860

WORKDIR /app

# CPU-only torch keeps the image small (~1 GB instead of ~5 GB with CUDA).
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu
COPY webapp/requirements.txt webapp/requirements.txt
RUN pip install -r webapp/requirements.txt

# Bake the MarianMT models into the image so startup needs no network.
RUN python -c "from transformers import MarianMTModel, MarianTokenizer as T; \
[(T.from_pretrained(m), MarianMTModel.from_pretrained(m)) for m in ('Helsinki-NLP/opus-mt-bn-en', 'shhossain/opus-mt-en-to-bn')]" \
 && chmod -R a+rwX /app/.hf
# Models are baked in: never hit the network at runtime (also works as a non-root user).
ENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1

COPY data/document_en.json data/document_en_clean.json data/document_bn.json data/document_bn_clean.json data/
COPY webapp/ webapp/

EXPOSE 7860
CMD ["sh", "-c", "uvicorn main:app --app-dir webapp/backend --host 0.0.0.0 --port ${PORT}"]
