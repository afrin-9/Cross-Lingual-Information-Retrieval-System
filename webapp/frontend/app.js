// Frontend for the CLIR API. Same-origin by default; set window.CLIR_API to point elsewhere.
const API = (window.CLIR_API || "").replace(/\/$/, "") + "/api";
const LANG_NAME = { en: "English", bn: "বাংলা" };
const EXAMPLES = ["তারেক রহমান", "Bangladesh cricket", "নির্বাচন", "inflation", "ঢাকা মেট্রোরেল", "Rohingya refugees"];
const EN_STOP = new Set("a an the of in on at to for and or is are was were be by with from as it its this that".split(" "));

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => Number(n).toLocaleString("en-US");

async function api(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

function highlight(text, tokens) {
  let html = esc(text);
  const terms = (tokens || []).filter((t) => t.length > 1 && !EN_STOP.has(t)).map((t) => esc(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!terms.length) return html;
  terms.sort((a, b) => b.length - a.length);
  // Extend matches through trailing Bangla characters so a <mark> never splits a word from its vowel signs.
  return html.replace(new RegExp(`(?:${terms.join("|")})[\\u0980-\\u09FF]*`, "gi"), "<mark>$&</mark>");
}

function shortDate(d) {
  if (!d) return "";
  const t = new Date(d);
  return isNaN(t) ? d : t.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function hitCard(h, i, tokens, maxScore) {
  const lang = h.language;
  const pct = maxScore ? Math.max(3, (h.score / maxScore) * 100) : 0;
  return `
    <article class="hit" tabindex="0" data-id="${esc(h.doc_id)}">
      <div class="hit-top">
        ${i != null ? `<span class="rank">${String(i + 1).padStart(2, "0")}</span>` : ""}
        <h4 lang="${lang}">${highlight(h.title || "(untitled)", tokens)}</h4>
      </div>
      <div class="meta" ${i == null ? 'style="margin-left:0"' : ""}>
        <span class="src">${esc(h.source)}</span>
        ${h.date ? `<span>${esc(shortDate(h.date))}</span>` : ""}
        <span>${fmt(h.token_count)} tokens</span>
        <span>${esc(h.doc_id)}</span>
      </div>
      <p lang="${lang}" ${i == null ? 'style="margin-left:0"' : ""}>${highlight(h.snippet, tokens)}</p>
      ${h.score != null ? `
      <div class="score" title="BM25 score">
        <span class="score-bar"><i style="width:${pct}%;background:var(--series-${lang})"></i></span>
        <span>${h.score.toFixed(2)}</span>
      </div>` : ""}
    </article>`;
}

/* ---------------- tabs ---------------- */
function route() {
  const tab = (location.hash || "#search").slice(1);
  const name = ["search", "explore", "dataset"].includes(tab) ? tab : "search";
  $$(".view").forEach((v) => (v.hidden = v.id !== `view-${name}`));
  $$(".tabs a").forEach((a) => a.classList.toggle("active", a.dataset.tab === name));
  if (name === "explore") Explore.ensure();
  if (name === "dataset") Dataset.ensure();
}
window.addEventListener("hashchange", route);

/* ---------------- theme ---------------- */
(function theme() {
  const saved = (() => { try { return localStorage.getItem("theme"); } catch { return null; } })();
  if (saved) document.documentElement.dataset.theme = saved;
  $("#theme-toggle").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch {}
  });
})();

/* ---------------- translation status ---------------- */
async function pollStatus() {
  const el = $("#mt-status");
  try {
    const { translation } = await api("/health");
    const map = { ready: ["ok", "MT ready"], loading: ["warn", "MT loading…"], unavailable: ["off", "MT unavailable"], disabled: ["off", "MT off"] };
    const [cls, label] = map[translation] || ["off", translation];
    el.className = `pill ${cls}`;
    el.textContent = label;
    if (translation === "loading") setTimeout(pollStatus, 4000);
  } catch {
    el.className = "pill off";
    el.textContent = "API offline";
    setTimeout(pollStatus, 6000);
  }
}

/* ---------------- document modal ---------------- */
const modal = $("#doc-modal");
async function openDoc(id) {
  $("#dm-title").textContent = "Loading…";
  $("#dm-body").textContent = "";
  $("#dm-meta").innerHTML = "";
  modal.showModal();
  try {
    const d = await api(`/doc/${encodeURIComponent(id)}`);
    $("#dm-title").textContent = d.title || "(untitled)";
    $("#dm-title").lang = d.language;
    $("#dm-body").textContent = d.body;
    $("#dm-body").lang = d.language;
    $("#dm-meta").innerHTML = `<span class="lang-badge"><span class="dot ${d.language}"></span>${LANG_NAME[d.language]}</span>
      <span class="src">${esc(d.source)}</span>${d.date ? `<span>${esc(shortDate(d.date))}</span>` : ""}
      <span>${fmt(d.token_count)} tokens</span><span>${esc(d.doc_id)}</span>`;
    $("#dm-link").href = d.url;
  } catch (e) {
    $("#dm-title").textContent = "Could not load document";
    $("#dm-body").textContent = e.message;
  }
}
$("#dm-close").addEventListener("click", () => modal.close());
modal.addEventListener("click", (e) => { if (e.target === modal) modal.close(); });
document.addEventListener("click", (e) => {
  const card = e.target.closest(".hit[data-id]");
  if (card) openDoc(card.dataset.id);
});
document.addEventListener("keydown", (e) => {
  const card = e.target.closest?.(".hit[data-id]");
  if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openDoc(card.dataset.id); }
});

/* ---------------- search ---------------- */
const Search = {
  init() {
    $("#examples").innerHTML = '<span class="muted small" style="align-self:center">Try:</span>' +
      EXAMPLES.map((q) => `<button type="button" lang="${/[ঀ-৿]/.test(q) ? "bn" : "en"}">${esc(q)}</button>`).join("");
    $("#examples").addEventListener("click", (e) => {
      if (e.target.tagName !== "BUTTON") return;
      $("#q").value = e.target.textContent;
      this.run();
    });
    $("#search-form").addEventListener("submit", (e) => { e.preventDefault(); this.run(); });
    $("#k").addEventListener("change", () => $("#q").value.trim() && this.run(this.lastTq));
    const params = new URLSearchParams(location.search);
    if (params.get("q")) { $("#q").value = params.get("q"); this.run(params.get("tq")); }
  },

  async run(tq) {
    const q = $("#q").value.trim();
    if (!q) return;
    this.lastTq = tq || null;
    const k = $("#k").value;
    const url = new URL(location.href);
    url.searchParams.set("q", q);
    tq ? url.searchParams.set("tq", tq) : url.searchParams.delete("tq");
    url.hash = "search";
    history.replaceState(null, "", url);

    $("#search-results").innerHTML = [0, 1].map(() => `<div>${'<div class="skeleton"></div>'.repeat(3)}</div>`).join("");
    try {
      const params = new URLSearchParams({ q, k });
      if (tq) params.set("tq", tq);
      this.render(await api(`/search?${params}`));
    } catch (e) {
      $("#search-pipeline").hidden = true;
      $("#search-results").innerHTML = `<div class="error" style="grid-column:1/-1">Search failed: ${esc(e.message)}. Is the backend running?</div>`;
    }
  },

  render(r) {
    const src = r.query_language, tgt = src === "bn" ? "en" : "bn";
    const noteByStatus = {
      marian: "Machine-translated with MarianMT. Edit it and re-run to test a different translation.",
      manual: "You supplied this translation.",
    };
    const note = noteByStatus[r.translation_source] ||
      (r.translation_status === "loading" ? "The translation model is still loading. Type a translation here and press Re-run to search the other language now."
        : "Machine translation isn't available. Type a translation here and press Re-run to search the other language.");
    const pipe = $("#search-pipeline");
    pipe.hidden = false;
    pipe.innerHTML = `
      <div class="step"><div class="label">Query</div><div class="value" lang="${src}">${esc(r.query)}</div></div>
      <div class="step"><div class="label">Detected language</div><div class="value lang-badge"><span class="dot ${src}"></span>${LANG_NAME[src]}</div></div>
      <div class="step"><div class="label">Translated to ${LANG_NAME[tgt]}</div>
        <form class="tq-form" id="tq-form"><input id="tq" lang="${tgt}" value="${esc(r.translated_query || "")}" placeholder="Type a ${tgt === "bn" ? "Bangla" : "English"} translation…" aria-label="Translated query">
        <button class="btn" type="submit">Re-run</button></form>
        <div class="note">${note}</div></div>`;
    $("#tq-form").addEventListener("submit", (e) => { e.preventDefault(); this.run($("#tq").value.trim() || null); });

    $("#search-results").innerHTML = [src, tgt].map((lang) => {
      const { hits, query_tokens } = r.results[lang];
      const max = hits.length ? hits[0].score : 0;
      const how = lang === src ? "original query" : "translated query";
      const emptyMsg = lang !== src && !r.translated_query
        ? `No translation available yet. Enter one above to search ${LANG_NAME[lang]}.`
        : `No ${LANG_NAME[lang]} documents matched.`;
      return `<div>
        <div class="col-head"><h3><span class="dot ${lang}"></span>${LANG_NAME[lang]} results</h3>
          <span class="muted">${hits.length} hits · ${how}</span></div>
        ${hits.length ? hits.map((h, i) => hitCard(h, i, query_tokens, max)).join("")
          : `<div class="empty">${emptyMsg}</div>`}
      </div>`;
    }).join("");
  },
};

/* ---------------- explore ---------------- */
const Explore = {
  state: { lang: "en", source: "", text: "", page: 1, size: 20 },
  loaded: false,
  async ensure() {
    if (this.loaded) return;
    this.loaded = true;
    $$(".seg button").forEach((b) => b.addEventListener("click", () => {
      $$(".seg button").forEach((x) => x.classList.toggle("active", x === b));
      Object.assign(this.state, { lang: b.dataset.lang, source: "", page: 1 });
      this.fillSources();
      this.load();
    }));
    $("#ex-source").addEventListener("change", (e) => { Object.assign(this.state, { source: e.target.value, page: 1 }); this.load(); });
    let t;
    $("#ex-text").addEventListener("input", (e) => {
      clearTimeout(t);
      t = setTimeout(() => { Object.assign(this.state, { text: e.target.value.trim(), page: 1 }); this.load(); }, 250);
    });
    $("#ex-prev").addEventListener("click", () => { this.state.page--; this.load(); });
    $("#ex-next").addEventListener("click", () => { this.state.page++; this.load(); });
    await Dataset.fetch();
    this.fillSources();
    this.load();
  },
  fillSources() {
    const srcs = Dataset.data?.languages[this.state.lang].sources || [];
    $("#ex-source").innerHTML = `<option value="">All sources</option>` +
      srcs.map(([s, n]) => `<option value="${esc(s)}">${esc(s)} (${fmt(n)})</option>`).join("");
  },
  async load() {
    const s = this.state;
    const params = new URLSearchParams({ lang: s.lang, page: s.page, size: s.size });
    if (s.source) params.set("source", s.source);
    if (s.text) params.set("text", s.text);
    $("#ex-list").innerHTML = '<div class="skeleton"></div>'.repeat(4);
    try {
      const r = await api(`/docs?${params}`);
      const pages = Math.max(1, Math.ceil(r.total / r.size));
      $("#ex-count").textContent = `${fmt(r.total)} documents`;
      $("#ex-page").textContent = `Page ${r.page} of ${fmt(pages)}`;
      $("#ex-prev").disabled = r.page <= 1;
      $("#ex-next").disabled = r.page >= pages;
      const terms = s.text ? [s.text.toLowerCase()] : [];
      $("#ex-list").innerHTML = r.items.length ? r.items.map((d) => hitCard(d, null, terms, 0)).join("")
        : `<div class="empty">No documents match these filters.</div>`;
    } catch (e) {
      $("#ex-list").innerHTML = `<div class="error">Failed to load: ${esc(e.message)}</div>`;
    }
  },
};

/* ---------------- dataset & charts ---------------- */
const tip = $("#tooltip");
function bindTooltips(root) {
  root.addEventListener("mousemove", (e) => {
    const t = e.target.closest("[data-tip]");
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.dataset.tip;
    tip.hidden = false;
    const x = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8);
    tip.style.left = `${x}px`;
    tip.style.top = `${e.clientY - 36}px`;
  });
  root.addEventListener("mouseleave", () => (tip.hidden = true));
}

function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

function tableView(rows, head) {
  return `<details class="table-view"><summary>Show as table</summary><table>
    <tr><th>${head[0]}</th><th>${head[1]}</th></tr>
    ${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${fmt(b)}</td></tr>`).join("")}</table></details>`;
}

// Horizontal bars: one per source, value labels at bar ends.
function hbar(el, rows, total) {
  const W = Math.max(280, el.clientWidth), rowH = 30, labelW = Math.min(170, W * 0.38), valW = 64;
  const H = rows.length * rowH;
  const max = Math.max(...rows.map((r) => r[1]));
  const bw = W - labelW - valW;
  const maxChars = Math.floor((labelW - 12) / 6.8);
  const bars = rows.map(([name, n], i) => {
    const y = i * rowH, w = Math.max(2, (n / max) * bw);
    const label = name.length > maxChars ? name.slice(0, maxChars - 1) + "…" : name;
    return `<g>
      <text x="${labelW - 10}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(label)}</text>
      <rect class="bar" x="${labelW}" y="${y + 6}" width="${w}" height="${rowH - 12}" rx="4"></rect>
      <text class="val" x="${labelW + w + 8}" y="${y + rowH / 2 + 4}">${fmt(n)}</text>
      <rect class="hit-area" x="0" y="${y}" width="${W}" height="${rowH}" data-tip="${esc(name)}: ${fmt(n)} docs (${((n / total) * 100).toFixed(1)}%)"></rect>
    </g>`;
  }).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Documents by source">${bars}</svg>` +
    tableView(rows, ["Source", "Documents"]);
}

// Vertical columns: token-length histogram.
function vbar(el, rows) {
  const W = Math.max(280, el.clientWidth), H = 220, padL = 44, padB = 34, padT = 10;
  const max = niceMax(Math.max(...rows.map((r) => r.count)));
  const plotW = W - padL, plotH = H - padB - padT;
  const slot = plotW / rows.length, bw = Math.min(56, slot - 2);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const grid = ticks.map((t) => {
    const y = padT + plotH - (t / max) * plotH;
    return `<line class="gridline" x1="${padL}" x2="${W}" y1="${y}" y2="${y}"></line>
      <text x="${padL - 8}" y="${y + 4}" text-anchor="end">${fmt(t)}</text>`;
  }).join("");
  const peak = rows.reduce((a, b) => (b.count > a.count ? b : a));
  // Narrow charts: show only each bin's lower bound ("200" instead of "200–399").
  const tickLabel = (l) => (slot < 64 ? l.split("–")[0] : l);
  const cols = rows.map((r, i) => {
    const h = (r.count / max) * plotH, x = padL + i * slot + (slot - bw) / 2, y = padT + plotH - h;
    const label = r === peak ? `<text class="val" x="${x + bw / 2}" y="${y - 6}" text-anchor="middle">${fmt(r.count)}</text>` : "";
    return `<g>
      <path class="bar" d="M${x},${padT + plotH} V${y + Math.min(4, h)} q0,-4 4,-4 H${x + bw - 4} q4,0 4,4 V${padT + plotH} Z"></path>
      ${label}
      <text x="${padL + i * slot + slot / 2}" y="${H - 12}" text-anchor="middle">${tickLabel(r.label)}</text>
      <rect class="hit-area" x="${padL + i * slot}" y="${padT}" width="${slot}" height="${plotH}" data-tip="${r.label} tokens: ${fmt(r.count)} docs"></rect>
    </g>`;
  }).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Document length histogram">${grid}${cols}</svg>` +
    tableView(rows.map((r) => [r.label, r.count]), ["Tokens", "Documents"]);
}

const Dataset = {
  data: null,
  rendered: false,
  async fetch() {
    if (!this.data) this.data = await api("/stats");
    return this.data;
  },
  async ensure() {
    try { await this.fetch(); } catch (e) {
      $("#ds-tiles").innerHTML = `<div class="error" style="grid-column:1/-1">Failed to load stats: ${esc(e.message)}</div>`;
      return;
    }
    if (!this.rendered) {
      this.rendered = true;
      this.tiles();
      $$(".chart-card .viz-root").forEach(bindTooltips);
      let t;
      addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => this.charts(), 150); });
    }
    this.charts();
  },
  tiles() {
    const { en, bn } = this.data.languages;
    const tile = (lang, label, num, sub) => `<div class="tile"><div class="label">${lang ? `<span class="dot ${lang}"></span>` : ""}${label}</div>
      <div class="num">${num}</div><div class="sub">${sub}</div></div>`;
    $("#ds-tiles").innerHTML = [
      tile("en", "English documents", fmt(en.clean), `${fmt(en.raw)} crawled · ${fmt(en.raw - en.clean)} removed`),
      tile("bn", "Bangla documents", fmt(bn.clean), `${fmt(bn.raw)} crawled · ${fmt(bn.raw - bn.clean)} removed`),
      tile(null, "Vocabulary (BM25 terms)", fmt(en.vocab + bn.vocab), `${fmt(en.vocab)} EN · ${fmt(bn.vocab)} BN`),
      tile(null, "Median length", `${en.median_tokens} / ${bn.median_tokens}`, `tokens per doc, EN / BN · ${fmt(en.total_tokens + bn.total_tokens)} total`),
    ].join("");
  },
  charts() {
    if ($("#view-dataset").hidden) return;
    const { en, bn } = this.data.languages;
    hbar($("#ch-src-en"), en.sources, en.clean);
    hbar($("#ch-src-bn"), bn.sources, bn.clean);
    vbar($("#ch-len-en"), en.token_hist);
    vbar($("#ch-len-bn"), bn.token_hist);
  },
};

Search.init();
route();
pollStatus();
