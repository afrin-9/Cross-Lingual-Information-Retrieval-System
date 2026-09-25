# Cross-Lingual-Information-Retrieval-System

Bangla ⇄ English news search. Articles crawled from Bangladeshi newspapers are indexed with
BM25, one index per language. Queries are translated with MarianMT, so a query in either
language returns results in both.

| Notebook | What it does |
|---|---|
| `script/Module_A.ipynb` | Crawling (RSS, sitemaps, section pages) → `data/document_{en,bn}.json` |
| `script/Module_B.ipynb` | Cleaning (≥ 20 tokens) and normalization → `data/document_{en,bn}_clean.json` |
| `script/Module_C.ipynb` | BM25 indexes and per-language search |
| `script/Module_D.ipynb` | Language detection, MarianMT translation, cross-lingual search |

## Web app

`webapp/` puts the whole pipeline in a browser:

- **Search**: type a query in Bangla or English. The app shows the detected language and the
  machine translation, which you can edit and re-run. Results appear side by side for both
  languages, with BM25 scores and highlighted terms. Click a result to read the full article.
- **Explore**: page through both corpora, filtered by source or title.
- **Dataset**: corpus statistics, documents per source, the document length distribution, and a pipeline overview.

```
webapp/
  backend/engine.py   BM25 + MarianMT (same tokenizers/models as Modules C & D)
  backend/main.py     FastAPI: /api/search, /api/doc/{id}, /api/docs, /api/stats, /api/health
  frontend/           index.html, styles.css, app.js (static, no build step)
  requirements.txt
Dockerfile            one container: API + frontend
```

The server builds the BM25 indexes from `data/*_clean.json` at startup, which takes about 15 s.
It doesn't need the `.pkl` files. The translation models load in the background, and the
header shows **MT loading… → MT ready**. Until they're ready, searches cover the query's own
language only, or you can type a translation yourself.

### Run locally

The `data/` folder must contain `document_en.json`, `document_en_clean.json`,
`document_bn.json` and `document_bn_clean.json`.

Quickest way, using the `clir_env` conda env without activating it:

```powershell
.\webapp\run.ps1              # add -Reload while editing code, -Port 9000 to change port
```

Or activate the env yourself. It already has torch, transformers and sentencepiece. If
PowerShell says `conda` is not recognized, run
`& "$env:USERPROFILE\miniconda3\Scripts\conda.exe" init powershell` once and reopen the terminal.

```powershell
conda activate clir_env
pip install fastapi "uvicorn[standard]"      # one time
cd webapp\backend
uvicorn main:app --port 8000
```

Open **http://localhost:8000**. Add `--reload` while editing code.

With a fresh environment instead:

```powershell
python -m venv .venv; .venv\Scripts\activate
pip install -r webapp\requirements.txt
cd webapp\backend; uvicorn main:app --port 8000
```

Environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `CLIR_DATA_DIR` | `<repo>/data` | Folder with the four JSON files |
| `CLIR_TRANSLATION` | `marian` | Set to `off` to skip loading the translation models |

On the first run, the MarianMT models (~300 MB each) download from Hugging Face.

### Run with Docker

```bash
docker build -t clir .
docker run -p 7860:7860 clir        # → http://localhost:7860
```

The image is CPU-only (~3.8 GB, with the models built in) and uses about 1.5 GB of RAM.

### Deploy (free): Hugging Face Spaces

Spaces runs the Dockerfile as is. The free CPU tier has 16 GB of RAM, which is enough for
this app. Render and Railway free tiers (512 MB) are not.

1. Create a Space at https://huggingface.co/new-space. Pick the **Docker** SDK with the
   **Blank** template, and **CPU basic (free)** hardware.
2. Clone it and copy in the app and the data (`data/` is gitignored in this repo, so it has
   to go in the Space):

   ```powershell
   git clone https://huggingface.co/spaces/<your-user>/<space-name> ..\clir-space
   Copy-Item Dockerfile, .dockerignore ..\clir-space\
   Copy-Item webapp ..\clir-space\webapp -Recurse -Exclude __pycache__
   New-Item -ItemType Directory ..\clir-space\data
   Copy-Item data\document_*.json ..\clir-space\data\
   ```

3. Replace the Space's `README.md` header so it uses port 7860:

   ```yaml
   ---
   title: Bangla English CLIR
   emoji: 🔎
   colorFrom: blue
   colorTo: red
   sdk: docker
   app_port: 7860
   ---
   ```

4. Push. The JSON files are over 10 MB, so they need Git LFS:

   ```powershell
   cd ..\clir-space
   git lfs install
   git lfs track "*.json"
   git add .
   git commit -m "Deploy CLIR web app"
   git push        # username = HF user, password = an HF access token with write scope
   ```

The build takes about 10 minutes. The app then runs at
`https://<your-user>-<space-name>.hf.space`. Free Spaces sleep after 48 h without visits and
wake on the next request, which takes about a minute.

Other hosts: the same image runs on any Docker host with **≥ 2 GB RAM**, such as a VPS,
Google Cloud Run, Fly.io or a paid Render plan. The container listens on `$PORT` (default 7860).

**Hosting the frontend separately** (GitHub Pages, Netlify, …): deploy `webapp/frontend/` as a
static site. In `index.html`, before the `app.js` script tag, add
`<script>window.CLIR_API = "https://your-backend-url"</script>`. CORS is already open for GET
requests.
