// app.js
const express = require("express");
const path = require("path");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const expressLayouts = require("express-ejs-layouts");

const { fetchWithCache } = require("./database");

const app = express();
const PORT = process.env.PORT || 3000;

const API_BASE = "https://sm.sapimu.au/api/v1";
const ONE_HOUR = 3600;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

app.use(helmet({
  // HLS.js CDN and inline EJS JSON blobs need relaxed CSP in real production.
  // For a stricter CSP, self-host assets and use nonces.
  contentSecurityPolicy: false
}));
app.use(compression());
app.use(morgan("dev"));
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/public", express.static(path.join(__dirname, "public"), {
  etag: true,
  maxAge: "7d",
  immutable: true
}));

function getLang(req) {
  const q = (req.query.lang || "").toString().trim();
  const c = (req.cookies.lang || "").toString().trim();
  const lang = q || c || "en";
  return lang;
}

function setLangCookie(res, lang) {
  res.cookie("lang", lang, {
    httpOnly: false,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 365
  });
}

async function apiGetJson(url) {
  const res = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "CineStreamPro/1.0"
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`API error ${res.status} for ${url}: ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ---------- Page Routes ----------

app.get("/", async (req, res) => {
  const lang = getLang(req);
  setLangCookie(res, lang);

  const languages = await fetchWithCache(
    `languages`,
    async () => apiGetJson(`${API_BASE}/languages`),
    86400
  ).catch(() => []);

  const home = await fetchWithCache(
    `home:${lang}`,
    async () => apiGetJson(`${API_BASE}/home?lang=${encodeURIComponent(lang)}`),
    ONE_HOUR
  ).catch(() => []);

  const hero = Array.isArray(home) && home.length > 0 ? home[0] : null;
  const grid = Array.isArray(home) && home.length > 1 ? home.slice(1) : [];

  res.render("index", {
    lang,
    languages,
    hero,
    grid,
    meta: {
      title: "CineStream Pro",
      description: "Stream with a premium Netflix-style UI, fast caching, and HLS playback."
    }
  });
});

app.get("/watch/:code", async (req, res) => {
  const lang = getLang(req);
  setLangCookie(res, lang);

  const code = req.params.code;
  const epFromQuery = Number(req.query.ep || 1) || 1;

  const episodes = await fetchWithCache(
    `episodes:${code}:${lang}`,
    async () => apiGetJson(`${API_BASE}/episodes/${encodeURIComponent(code)}?lang=${encodeURIComponent(lang)}`),
    ONE_HOUR
  ).catch(() => []);

  // Initial play link cached with TTL derived from expires_in
  const playKey = `play:${code}:${lang}:ep:${epFromQuery}`;
  const play = await fetchWithCache(
    playKey,
    async () =>
      apiGetJson(
        `${API_BASE}/play/${encodeURIComponent(code)}?lang=${encodeURIComponent(lang)}&ep=${encodeURIComponent(epFromQuery)}`
      ),
    (fresh) => {
      const ttl = Number(fresh?.expires_in);
      // If API provides expires_in, use it; else a conservative short cache.
      return Number.isFinite(ttl) && ttl > 0 ? ttl : 600;
    }
  ).catch(() => null);

  res.render("watch", {
    lang,
    code,
    episodes,
    initialEpisode: epFromQuery,
    play,
    meta: {
      title: "Watch • CineStream Pro",
      description: "Premium HLS playback with custom controls."
    }
  });
});

// ---------- JSON API Routes (AJAX) ----------

app.get("/api/search", async (req, res) => {
  const lang = getLang(req);
  const q = (req.query.q || "").toString().trim();

  if (!q) return res.json({ ok: true, results: [] });

  const key = `search:${lang}:${q.toLowerCase()}`;

  const data = await fetchWithCache(
    key,
    async () => apiGetJson(`${API_BASE}/search?q=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}`),
    ONE_HOUR
  ).catch(() => []);

  res.json({ ok: true, results: data });
});

app.get("/api/episodes/:code", async (req, res) => {
  const lang = getLang(req);
  const code = req.params.code;

  const data = await fetchWithCache(
    `episodes:${code}:${lang}`,
    async () => apiGetJson(`${API_BASE}/episodes/${encodeURIComponent(code)}?lang=${encodeURIComponent(lang)}`),
    ONE_HOUR
  ).catch(() => []);

  res.json({ ok: true, episodes: data });
});

app.get("/api/play/:code", async (req, res) => {
  const lang = getLang(req);
  const code = req.params.code;
  const ep = Number(req.query.ep || 1) || 1;

  const key = `play:${code}:${lang}:ep:${ep}`;

  const data = await fetchWithCache(
    key,
    async () =>
      apiGetJson(`${API_BASE}/play/${encodeURIComponent(code)}?lang=${encodeURIComponent(lang)}&ep=${encodeURIComponent(ep)}`),
    (fresh) => {
      const ttl = Number(fresh?.expires_in);
      return Number.isFinite(ttl) && ttl > 0 ? ttl : 600;
    }
  ).catch((e) => {
    res.status(502).json({ ok: false, error: "Upstream error", detail: e.message });
    return null;
  });

  if (!data) return;
  res.json({ ok: true, play: data });
});

// ---------- Health ----------
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

app.listen(PORT, () => {
  console.log(`CineStream Pro running on http://localhost:${PORT}`);
});
