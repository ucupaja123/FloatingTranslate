const express = require("express");
const path = require("path");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");
const YTMusic = require("ytmusic-api");
const db = require("./db");
const quota = require("./listen-quota");
const { setAccountBadges, stripBadge } = require("./account");
const badges = require("./badges");
const tiktok = require("./tiktok");

// Akun, sesi login & hash password (shared dengan bot Telegram)
const {
  publicAccount,
  getAccounts,
  createAccount,
  registerAccount,
  deleteAccount,
  updatePassword: updateAccountPassword,
  changeOwnPassword,
  setAccountRole,
  findByCredentials,
  canCreate,
  getAvailableRoles,
  getStats: getAccountStats,
  createSession,
  getSessionAccount,
  destroySession,
  revokeSessions
} = require("./accounts");

const app = express();
const server = http.createServer(app);

app.set("trust proxy", true);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"], credentials: false },
  transports: ["websocket", "polling"],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

const PORT = process.env.PORT || 6543;

// Static files — DULUAN sebelum API
// Hanya folder public yang boleh diakses dari browser.
// (Sebelumnya seluruh folder proyek ikut terbuka: config.js & data/ bisa diunduh.)
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "600kb" }));

// Jadwal shalat + Al-Quran digital
require("./islamic")(app);

// ============================================================
//                YTMUSIC INIT
// ============================================================
let ytmusic;
let ytmusicReady = false;

(async () => {
  try {
    ytmusic = new YTMusic();
    if (typeof ytmusic.initialize === "function") await ytmusic.initialize();
    ytmusicReady = true;
    console.log("✅ YTMusic client ready");
  } catch (e) {
    console.error("❌ Gagal init YTMusic:", e.message);
  }
})();

function formatDuration(s) {
  if (!s || isNaN(s)) return "0:00";
  s = Math.floor(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function getBestThumbnail(thumbs) {
  if (!thumbs || !thumbs.length) return "";
  return [...thumbs].sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || "";
}

function normalizeSong(song) {
  if (!song) return null;
  return {
    type: "SONG",
    title: song.name || song.title || "Unknown",
    artist: song.artist?.name || song.artist || "Unknown",
    duration: formatDuration(song.duration),
    durationMs: (song.duration || 0) * 1000,
    thumbnail: getBestThumbnail(song.thumbnails),
    videoId: song.videoId || null,
    album: song.album?.name || ""
  };
}

// ============================================================
//                USER
// ============================================================
app.post("/api/user/register", (req, res) => {
  const { userId, name } = req.body || {};
  if (!userId) return res.status(400).json({ success: false, error: "Butuh userId" });
  try { res.json({ success: true, data: db.registerUser(userId, name) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get("/api/user/:userId", (req, res) => {
  try {
    const user = db.getUser(req.params.userId);
    if (!user) return res.json({ success: false, error: "User tidak ditemukan" });
    res.json({ success: true, data: user });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post("/api/user/promote", (req, res) => {
  const { userId, key } = req.body || {};
  if (!userId || !key) return res.status(400).json({ success: false, error: "Butuh userId & key" });
  if (!db.ADMIN_KEY || key !== db.ADMIN_KEY) return res.status(403).json({ success: false, error: "Key salah" });
  try {
    db.registerUser(userId, null);
    db.setRole(userId, "admin");
    res.json({ success: true, data: db.getUser(userId) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
//      AUTH: identitas diambil dari token sesi, BUKAN dari body
// ============================================================
function bearerToken(req) {
  const h = String(req.headers.authorization || "");
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}
function requireAccount(req, res, next) {
  const acc = getSessionAccount(bearerToken(req));
  if (!acc) return res.status(401).json({ success: false, error: "Belum login / sesi habis" });
  req.account = acc;
  next();
}
function requireRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.account.role)) return res.status(403).json({ success: false, error: "Tidak punya izin" });
    next();
  };
}
// Tamu (tanpa login): dikenali dari alamat IP klien. Hanya dipakai di fitur yang
// boleh diakses tamu, dan tetap kena batas kuota. Kelola akun tetap pakai requireAccount.
// Ambil IP terakhir di X-Forwarded-For (ditambah proxy hosting), supaya tidak bisa dipalsukan.
function guestKey(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = xff.length ? xff[xff.length - 1] : ((req.socket && req.socket.remoteAddress) || "unknown");
  return "guest:" + ip;
}
function optionalAccount(req, res, next) {
  const tok = bearerToken(req);
  const acc = tok ? getSessionAccount(tok) : null;
  req.account = acc || { username: guestKey(req), role: "user", isGuest: true };
  next();
}

// Batas percobaan login salah: 10x salah -> dikunci 15 menit (per username)
const loginFails = new Map();
const LOGIN_MAX = 10, LOGIN_LOCK_MS = 15 * 60 * 1000;
function loginLocked(key) {
  const e = loginFails.get(key);
  return !!(e && e.until > Date.now());
}
function noteLoginFail(key) {
  const now = Date.now();
  if (loginFails.size > 5000) loginFails.clear();
  let e = loginFails.get(key);
  if (!e || (e.until && e.until <= now)) e = { n: 0, until: 0 };
  e.n += 1;
  if (e.n >= LOGIN_MAX) e.until = now + LOGIN_LOCK_MS;
  loginFails.set(key, e);
}

// Daftar & moderasi user (db.js). Identitas dari token sesi.
app.get("/api/users", requireAccount, requireRoles("owner", "admin"), (req, res) => {
  try {
    const users = Object.values(db.getUsers()).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    res.json({ success: true, data: users });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post("/api/user/role", requireAccount, requireRoles("owner"), (req, res) => {
  const { userId, role } = req.body || {};
  if (!userId) return res.status(400).json({ success: false, error: "Butuh userId" });
  if (!["user", "admin", "owner"].includes(role)) return res.status(400).json({ success: false, error: "Role invalid" });
  try {
    if (!db.setRole(userId, role)) return res.status(404).json({ success: false, error: "User tidak ditemukan" });
    res.json({ success: true, data: db.getUser(userId) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post("/api/user/ban", requireAccount, requireRoles("owner", "admin"), (req, res) => {
  const { userId, banned } = req.body || {};
  if (!userId) return res.status(400).json({ success: false, error: "Butuh userId" });
  const target = db.getUser(userId);
  if (target?.role === "owner" && req.account.role !== "owner") {
    return res.status(403).json({ success: false, error: "Gak bisa ban owner" });
  }
  try {
    if (!db.banUser(userId, banned)) return res.status(404).json({ success: false, error: "User tidak ditemukan" });
    res.json({ success: true, data: db.getUser(userId) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post("/api/register", (req, res) => {
  try {
    const { username, password } = req.body || {};
    const result = registerAccount({ username, password });
    if (!result.success) return res.status(400).json(result);
    const token = createSession(result.data.username);
    res.json({ success: true, token, data: publicAccount(result.data) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post("/api/login", (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ success: false, error: "username & password wajib" });
    const key = String(username).trim().toLowerCase();
    if (loginLocked(key)) return res.status(429).json({ success: false, error: "Terlalu banyak percobaan salah. Coba lagi 15 menit lagi." });
    const account = findByCredentials(String(username).trim(), password);
    if (!account) {
      noteLoginFail(key);
      return res.status(401).json({ success: false, error: "Username atau password salah" });
    }
    loginFails.delete(key);
    const token = createSession(account.username);
    res.json({ success: true, token, data: publicAccount(account) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post("/api/logout", (req, res) => {
  destroySession(bearerToken(req));
  res.json({ success: true });
});

app.get("/api/me", optionalAccount, (req, res) => {
  if (req.account.isGuest) return res.json({ success: true, data: { username: "tamu", role: "user", badges: [] } });
  res.json({ success: true, data: publicAccount(req.account) });
});

// Ganti password sendiri (wajib password lama). Sesi di perangkat lain dicabut.
app.put("/api/me/password", requireAccount, (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    const result = changeOwnPassword({ username: req.account.username, oldPassword, newPassword });
    if (!result.success) return res.status(400).json(result);
    revokeSessions(req.account.username, bearerToken(req));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ============================================================
//      MANAJEMEN AKUN (owner / admin / reseller)
// ============================================================
const MANAGER_ROLES = ["owner", "admin", "reseller"];

app.get("/api/accounts/roles", requireAccount, (req, res) => {
  res.json({ success: true, data: getAvailableRoles(req.account.username) });
});

app.get("/api/accounts", requireAccount, requireRoles(...MANAGER_ROLES), (req, res) => {
  try {
    const all = getAccounts();
    const me = req.account.username.toLowerCase();
    const list = req.account.role === "owner"
      ? all
      : all.filter(a => a.createdBy && a.createdBy.toLowerCase() === me);
    res.json({ success: true, data: list.map(publicAccount) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get("/api/accounts/stats", requireAccount, requireRoles("owner"), (req, res) => {
  try { res.json({ success: true, data: getAccountStats() }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post("/api/accounts", requireAccount, requireRoles(...MANAGER_ROLES), (req, res) => {
  try {
    const { username, password, role } = req.body || {};
    if (!username || !password || !role) return res.status(400).json({ success: false, error: "username, password, role wajib" });
    if (!canCreate(req.account.username, role)) {
      return res.status(403).json({ success: false, error: `Role ${req.account.role} tidak bisa buat ${role}` });
    }
    const result = createAccount({ username, password, role, createdBy: req.account.username });
    if (!result.success) return res.status(400).json(result);
    res.json({ success: true, data: publicAccount(result.data) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.delete("/api/accounts/:username", requireAccount, (req, res) => {
  try {
    const result = deleteAccount({ username: req.params.username, requestedBy: req.account.username });
    if (!result.success) return res.status(400).json(result);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Reset password akun lain (owner / pembuat akun)
app.put("/api/accounts/:username/password", requireAccount, (req, res) => {
  try {
    const { newPassword } = req.body || {};
    if (!newPassword) return res.status(400).json({ success: false, error: "newPassword wajib" });
    const result = updateAccountPassword({ username: req.params.username, newPassword, requestedBy: req.account.username });
    if (!result.success) return res.status(400).json(result);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Naik / turun level akun. Hanya owner.
app.put("/api/accounts/:username/role", requireAccount, requireRoles("owner"), (req, res) => {
  try {
    const { role } = req.body || {};
    const result = setAccountRole({ username: req.params.username, role, requestedBy: req.account.username });
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ============================================================
//                SEARCH (YTMusic)
// ============================================================
// Daftar lencana (gambar): centang biru bawaan + yang diupload owner
app.get("/api/badges", optionalAccount, (req, res) => res.json({ success: true, data: badges.catalog() }));

// Owner upload lencana baru (gambar dikirim sebagai data URL)
app.post("/api/badges", requireAccount, requireRoles("owner"), (req, res) => {
  const b = req.body || {};
  const r = badges.saveUpload({ name: b.name, label: b.label, dataUrl: b.dataUrl });
  if (r.error) return res.status(400).json({ success: false, error: r.error });
  res.json(r);
});

// Owner hapus lencana; otomatis dilepas dari semua akun
app.delete("/api/badges/:id", requireAccount, requireRoles("owner"), (req, res) => {
  const r = badges.removeBadge(req.params.id);
  if (r.error) return res.status(400).json({ success: false, error: r.error });
  stripBadge(req.params.id);
  res.json({ success: true });
});

app.put("/api/accounts/:username/badges", requireAccount, requireRoles("owner"), (req, res) => {
  const r = setAccountBadges({ username: req.params.username, badges: (req.body || {}).badges, requestedBy: req.account.username });
  if (!r.success) return res.status(400).json(r);
  res.json(r);
});

app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ success: false, error: "Query kosong" });
  if (!ytmusicReady) return res.status(503).json({ success: false, error: "YTMusic belum ready" });

  try {
    const results = await ytmusic.search(q);
    const normalized = (results || [])
      .filter(item => item.videoId || item.type === "ALBUM" || item.type === "ARTIST")
      .map(item => {
        const base = {
          type: item.type || "SONG",
          title: item.name || "Unknown",
          thumbnail: getBestThumbnail(item.thumbnails),
          videoId: item.videoId || null
        };
        if (item.type === "SONG" || item.type === "VIDEO" || !item.type) {
          base.artist = item.artist?.name || "Unknown";
          base.duration = formatDuration(item.duration);
          base.durationMs = (item.duration || 0) * 1000;
        } else if (item.type === "ALBUM") {
          base.artist = item.artist?.name || "Unknown";
        } else if (item.type === "ARTIST") {
          base.artist = item.name;
        }
        return base;
      })
      .filter(item => item.title && item.thumbnail);
    res.json({ success: true, data: normalized.slice(0, 24) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
//          YOUTUBE VIDEO SEARCH (via IkyyXD)
// ============================================================
app.get("/api/youtube", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ success: false, error: "Query kosong" });

  try {
    const { data } = await axios.get(
      "https://api.ikyyxd.my.id/search/youtube",
      {
        params: { apikey: "kyzz", query: q },
        timeout: 20000,
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }
      }
    );

    if (!data?.status || !data?.result?.length) {
      return res.status(404).json({ success: false, error: "Tidak ada hasil" });
    }

    const videos = data.result.slice(0, 30).map(v => {
      const vid = (v.link || "").match(/v=([a-zA-Z0-9_-]{11})/);
      return {
        title: v.title || "Unknown",
        channel: v.channel || "Unknown",
        duration: v.duration || "0:00",
        thumbnail: v.imageUrl || v.thumb || "",
        link: v.link || "",
        videoId: vid ? vid[1] : null
      };
    }).filter(v => v.videoId);

    res.json({ success: true, query: q, total: videos.length, data: videos });
  } catch (e) {
    console.error("YouTube error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
//           SPOTIFY SEARCH (Multi-API Fallback)
// ============================================================
app.get("/api/spotify", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ success: false, error: "Query kosong" });

  let tracks = [];

  try {
    const { data } = await axios.get(
      "https://api.ikyyxd.my.id/search/spotify",
      {
        params: { query: q },
        timeout: 15000,
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }
      }
    );

    if (data?.status && data?.tracks?.length) {
      tracks = data.tracks.map(t => ({
        title: t.name || "Unknown",
        artist: Array.isArray(t.artist) ? t.artist.join(", ") : (t.artist || "Unknown"),
        album: t.album || "",
        duration: t.length || "0:00",
        thumbnail: t.cover || "",
        spotifyUrl: t.link || "",
        popularity: t.popularity || 0,
        release: t.release || ""
      }));
    }
  } catch (e) {
    console.log(`⚠️ Spotify IkyyXD gagal: ${e.message}`);
  }

  if (tracks.length === 0) {
    try {
      const { data } = await axios.get(
        "https://api.iroha-api.web.id/v1/spotify",
        {
          params: { action: "search", q },
          timeout: 15000,
          headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }
        }
      );

      if (data?.status && data?.data?.results?.length) {
        tracks = data.data.results.map(t => ({
          title: t.title || "Unknown",
          artist: t.artist || "Unknown",
          album: t.album || "",
          duration: t.duration || "0:00",
          thumbnail: t.cover || "",
          spotifyUrl: t.spotifyUrl || "",
          popularity: 0,
          release: t.date || ""
        }));
      }
    } catch (e) {
      console.log(`⚠️ Spotify Iroha gagal: ${e.message}`);
    }
  }

  // Backup ke-3: Naze API (butuh key di config.nazekey / env NAZE_KEY)
  if (tracks.length === 0 && bkNaze && global.nazekey && global.nazekey.length) {
    try {
      const list = await bkNaze.searchSpotify(q);
      tracks = list.map(t => ({
        title: t.name,
        artist: Array.isArray(t.artists) ? t.artists.join(", ") : t.artists,
        album: "",
        duration: t.duration || "0:00",
        thumbnail: t.thumbnail || "",
        spotifyUrl: t.link === "Tidak ada link" ? "" : t.link,
        popularity: t.popularity === "N/A" ? 0 : t.popularity,
        release: ""
      }));
    } catch (e) {
      console.log(`⚠️ Spotify Naze gagal: ${e.message}`);
    }
  }

  if (tracks.length === 0 && ytmusicReady) {
    try {
      const results = await ytmusic.search(q);
      tracks = results
        .filter(item => item.videoId && (item.type === "SONG" || item.type === "VIDEO"))
        .map(item => normalizeSong(item))
        .filter(Boolean)
        .map(t => ({
          title: t.title,
          artist: t.artist,
          album: t.album || "",
          duration: t.duration,
          thumbnail: t.thumbnail,
          spotifyUrl: `https://www.youtube.com/watch?v=${t.videoId}`,
          videoId: t.videoId,
          popularity: 0,
          release: "",
          fromYTMusic: true
        }));
    } catch (e) {}
  }

  if (tracks.length === 0) {
    return res.status(404).json({ success: false, error: "Tidak ada hasil" });
  }

  res.json({ success: true, query: q, total: tracks.length, data: tracks.slice(0, 30) });
});

// ============================================================
//      AUDIO (YTMusic + Fallback)
// ============================================================
function normalizeExternal(r) {
  if (!r) return null;
  const audio = r.audio?.url || r.audio?.link || r.download?.url || r.download?.link ||
    r.url_mp3 || r.mp3 || r.url || "";
  const title = r.title || r.name || "";
  if (!audio || !title) return null;
  return {
    audio, title,
    artist: r.author || r.channel || r.artist || "Unknown",
    duration: r.duration || 0,
    thumbnail: r.thumbnail || r.thumb || r.image || "",
    quality: r.audio?.quality || r.download?.quality || r.quality || "128kbps"
  };
}

async function fetchFromIkyyXD(url) {
  try {
    const { data } = await axios.get("https://api.ikyyxd.my.id/search/ytplayv2",
      { params: { q: url }, timeout: 15000, headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
    if (!data?.status || !data?.result) return null;
    return normalizeExternal(data.result);
  } catch (e) { return null; }
}
async function fetchFromYupra(url) {
  try {
    const { data } = await axios.get("https://api.yupra.my.id/api/downloader/ytplay",
      { params: { query: url }, timeout: 15000, headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
    if (!data?.status && !data?.success) return null;
    return normalizeExternal(data.result || data.data);
  } catch (e) { return null; }
}
async function fetchFromVreden(url) {
  try {
    const { data } = await axios.get("https://api.vreden.my.id/api/ytplaymp3",
      { params: { query: url }, timeout: 15000, headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
    if (!data?.status && !data?.result) return null;
    return normalizeExternal(data.result || data.data);
  } catch (e) { return null; }
}

// Balasan saat kuota dengerin periode ini sudah habis (harian atau bulanan sesuai role)
function sendListenLimit(res, q, role) {
  const monthly = quota.periodOf(role) === "month";
  return res.status(403).json({
    success: false,
    code: "LIMIT",
    error: `Kuota dengerin ${monthly ? "bulan" : "hari"} ini habis (${q.used}/${q.limit ?? "∞"}). Reset ${monthly ? "tiap tanggal 1" : "tiap hari"} jam 00:00 WIB.`,
    quota: { used: q.used, limit: q.limit, period: monthly ? "month" : "day", resetsAt: quota.nextResetAt(quota.periodOf(role)) }
  });
}

app.get("/api/audio", optionalAccount, async (req, res) => {
  const { videoId } = req.query;
  if (!videoId) return res.status(400).json({ success: false, error: "Butuh videoId" });
  const pk = quota.peek(req.account.username, req.account.role, videoId);
  if (!pk.allowed) return sendListenLimit(res, pk, req.account.role);
  if (!ytmusicReady) return res.status(503).json({ success: false, error: "YTMusic belum ready" });

  const youtubeUrl = `https://music.youtube.com/watch?v=${videoId}`;
  let metadata = {};

  try {
    const song = await ytmusic.getSong(videoId);
    const audioUrl = song?.audio?.url || song?.url || song?.audioUrl;
    metadata = {
      title: song?.name || "",
      artist: song?.artist?.name || "",
      duration: song?.duration || 0,
      thumbnail: getBestThumbnail(song?.thumbnails) || ""
    };
    if (audioUrl) {
      const q = quota.claim(req.account.username, req.account.role, videoId);
      if (!q.allowed) return sendListenLimit(res, q, req.account.role);
      return res.json({ success: true, data: { audio: audioUrl, ...metadata }, source: "ytmusic-api", quota: { used: q.used, limit: q.limit } });
    }
  } catch (e) {}

  const fallbacks = [
    { name: "IkyyXD", fn: () => fetchFromIkyyXD(youtubeUrl) },
    { name: "Yupra", fn: () => fetchFromYupra(youtubeUrl) },
    { name: "Vreden", fn: () => fetchFromVreden(youtubeUrl) }
  ];

  const result = await new Promise((resolve) => {
    let done = false;
    let pending = fallbacks.length;
    fallbacks.forEach(f => {
      f.fn()
        .then(r => { if (r && !done) { done = true; resolve({ ...r, _source: f.name }); } })
        .catch(() => {})
        .finally(() => { pending--; if (pending === 0 && !done) resolve(null); });
    });
  });

  if (!result) return res.status(404).json({ success: false, error: "URL audio tidak tersedia" });

  const q2 = quota.claim(req.account.username, req.account.role, videoId);
  if (!q2.allowed) return sendListenLimit(res, q2, req.account.role);
  res.json({
    success: true,
    data: {
      audio: result.audio,
      title: metadata.title || result.title,
      artist: metadata.artist || result.artist,
      duration: metadata.duration || result.duration,
      thumbnail: metadata.thumbnail || result.thumbnail,
      quality: result.quality
    },
    source: result._source,
    quota: { used: q2.used, limit: q2.limit }
  });
});

// Sisa kuota dengerin bulan ini (untuk tampilan)
app.get("/api/listen/status", optionalAccount, (req, res) => {
  res.json({ success: true, data: quota.status(req.account.username, req.account.role) });
});

// ============================================================
//      VIDEO (MP4)
// ============================================================
app.get("/api/video", async (req, res) => {
  const { videoId } = req.query;
  if (!videoId) return res.status(400).json({ success: false, error: "Butuh videoId" });

  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    const { data } = await axios.get(
      "https://api.iroha-api.web.id/v1/ytmp4",
      {
        params: { url: youtubeUrl },
        timeout: 30000,
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }
      }
    );

    if (!data?.status || !data?.data?.url) {
      return res.status(404).json({ success: false, error: "Video tidak tersedia" });
    }

    res.json({
      success: true,
      data: {
        title: data.data.title || "",
        videoUrl: data.data.url,
        size: data.data.size || 0,
        sizePretty: data.data.sizePretty || "",
        type: data.data.type || "mp4"
      }
    });
  } catch (e) {
    console.error("Video error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---- Stream dari sumber luar (YouTube/CDN) ke pemutar ----
// Batas waktu hanya berlaku sampai header dari sumber diterima.
async function openUpstream(url, opts) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    return await axios.get(url, { ...opts, responseType: "stream", signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Meneruskan isi sumber ke klien. Jika sumber putus, atau diam terlalu lama
// padahal klien tidak sedang menahan (pemutar dijeda / buffer penuh), koneksi
// ke klien DITUTUP. Tanpa itu respons menggantung: pemutar tidak mendapat
// error maupun sinyal selesai, jadi lagu berhenti dan antrean tidak lanjut.
function pipeUpstream(res, src, idleMs = 30000) {
  let lastData = Date.now();
  src.on("data", () => { lastData = Date.now(); });
  src.on("error", () => res.destroy());
  const watchdog = setInterval(() => {
    if (res.destroyed || res.writableEnded) return;
    if (!res.writableNeedDrain && Date.now() - lastData > idleMs) res.destroy();
  }, 5000);
  res.on("close", () => { clearInterval(watchdog); src.destroy(); });
  src.pipe(res);
}

app.get("/api/video/stream", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("URL kosong");

  try {
    const upstream = await openUpstream(url, {
      maxRedirects: 5,
      decompress: false,
      validateStatus: (s) => s >= 200 && s < 400,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "*/*",
        Referer: "https://www.youtube.com/",
        ...(req.headers.range ? { Range: req.headers.range } : {})
      }
    });

    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers["content-type"] || "video/mp4");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-cache");
    if (upstream.headers["content-length"]) res.setHeader("Content-Length", upstream.headers["content-length"]);
    if (upstream.headers["content-range"]) res.setHeader("Content-Range", upstream.headers["content-range"]);

    pipeUpstream(res, upstream.data);
  } catch (e) {
    if (!res.headersSent) res.status(500).send(`Gagal stream: ${e.message}`);
  }
});

// ============================================================
//      TRENDING
// ============================================================
let trendingCache = { data: null, ts: 0 };
const TRENDING_CACHE_TTL = 1000 * 60 * 30;

app.get("/api/trending", async (req, res) => {
  if (trendingCache.data && Date.now() - trendingCache.ts < TRENDING_CACHE_TTL) {
    return res.json({ success: true, data: trendingCache.data, cached: true });
  }
  if (!ytmusicReady) return res.status(503).json({ success: false, error: "YTMusic belum ready" });

  const QUERIES = [
    "top hits indonesia",
    "lagu viral tiktok",
    "trending gaming indonesia",
    "lagu populer indonesia",
    "darlung gaming",
    "music video terbaru"
  ];

  try {
    const picks = [...QUERIES].sort(() => 0.5 - Math.random()).slice(0, 4);
    const normalized = [];

    const ytmPicks = picks.slice(0, 2);
    const ytmPromises = ytmPicks.map(q => ytmusic.search(q).catch(() => []));
    const ytmResults = await Promise.all(ytmPromises);

    for (const list of ytmResults) {
      for (const item of list) {
        if (item.videoId && (item.type === "SONG" || item.type === "VIDEO" || !item.type)) {
          const n = normalizeSong(item);
          if (n) normalized.push({ ...n, source: "ytmusic" });
        }
      }
    }

    const ytPicks = picks.slice(2, 4);
    const ytPromises = ytPicks.map(q =>
      axios.get("https://api.ikyyxd.my.id/search/youtube", {
        params: { apikey: "kyzz", query: q },
        timeout: 15000
      }).then(r => r.data?.result || []).catch(() => [])
    );
    const ytResults = await Promise.all(ytPromises);

    for (const list of ytResults) {
      for (const v of list) {
        const vid = (v.link || "").match(/v=([a-zA-Z0-9_-]{11})/);
        if (vid) {
          normalized.push({
            type: "VIDEO",
            title: v.title || "Unknown",
            artist: v.channel || "Unknown",
            duration: v.duration || "0:00",
            durationMs: 0,
            thumbnail: v.imageUrl || "",
            videoId: vid[1],
            source: "youtube"
          });
        }
      }
    }

    const seen = new Set();
    const unique = [];
    for (const r of normalized) {
      if (!seen.has(r.videoId)) {
        seen.add(r.videoId);
        unique.push(r);
      }
    }

    if (unique.length === 0) {
      if (trendingCache.data) return res.json({ success: true, data: trendingCache.data, fallback: true });
      return res.status(404).json({ success: false, error: "Tidak ada hasil" });
    }

    trendingCache = { data: unique.slice(0, 24), ts: Date.now() };
    res.json({ success: true, data: trendingCache.data });
  } catch (e) {
    if (trendingCache.data) return res.json({ success: true, data: trendingCache.data, fallback: true });
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/api/home", (req, res) => res.redirect(307, "/api/trending"));

// ============================================================
//      RELATED
// ============================================================
app.get("/api/related", async (req, res) => {
  const { title, artist } = req.query;
  if (!title) return res.status(400).json({ success: false, error: "Title kosong" });
  if (!ytmusicReady) return res.status(503).json({ success: false, error: "YTMusic belum ready" });

  try {
    const cleanTitle = String(title).replace(/\(official.*?\)/gi, "").replace(/\[.*?\]/g, "").replace(/\s{2,}/g, " ").trim();
    const query = artist ? `${artist} ${cleanTitle}` : cleanTitle;
    const results = await ytmusic.search(query);

    const normalized = results
      .filter(item => item.videoId && (item.type === "SONG" || item.type === "VIDEO" || !item.type))
      .map(normalizeSong).filter(Boolean)
      .filter(item => item.title.toLowerCase() !== cleanTitle.toLowerCase())
      .slice(0, 8);

    res.json({ success: true, data: normalized });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
//      LIRIK
// ============================================================
app.get("/api/lyrics", async (req, res) => {
  const { title, artist, duration } = req.query;
  if (!title) return res.status(400).json({ success: false, error: "Title kosong" });

  const cleanTitle = String(title)
    .replace(/\(official.*?\)/gi, "").replace(/\[official.*?\]/gi, "")
    .replace(/\(lyric.*?\)/gi, "").replace(/\(lyrics.*?\)/gi, "")
    .replace(/\(audio.*?\)/gi, "").replace(/\(mv.*?\)/gi, "")
    .replace(/\(music video.*?\)/gi, "").replace(/official.*?(video|audio)/gi, "")
    .replace(/lyric video/gi, "").replace(/\[.*?\]/g, "")
    .replace(/【.*?】/g, "").replace(/\s*-\s*topic/gi, "")
    .replace(/\s{2,}/g, " ").trim();

  const cleanArtist = String(artist || "")
    .replace(/vevo$/i, "").replace(/official$/i, "")
    .replace(/\s*-\s*topic/gi, "").trim();

  const attempts = [];
  if (cleanArtist && duration) {
    attempts.push({
      endpoint: "https://lrclib.net/api/get",
      params: { track_name: cleanTitle, artist_name: cleanArtist, duration: Math.round(parseInt(duration) / 1000) }
    });
  }
  if (cleanArtist) {
    attempts.push({
      endpoint: "https://lrclib.net/api/search",
      params: { track_name: cleanTitle, artist_name: cleanArtist }
    });
  }
  attempts.push({ endpoint: "https://lrclib.net/api/search", params: { q: `${cleanTitle} ${cleanArtist}`.trim() } });
  attempts.push({ endpoint: "https://lrclib.net/api/search", params: { q: cleanTitle } });

  for (const att of attempts) {
    try {
      const { data } = await axios.get(att.endpoint, { params: att.params, timeout: 6000, headers: { "User-Agent": "YTMusicWeb/1.0" } });
      let hit = Array.isArray(data) ? data[0] : data;
      if (hit && (hit.plainLyrics || hit.syncedLyrics)) {
        return res.json({
          success: true,
          data: {
            title: hit.trackName || cleanTitle,
            artist: hit.artistName || cleanArtist,
            plain: hit.plainLyrics || "",
            synced: hit.syncedLyrics || "",
            hasSync: !!hit.syncedLyrics
          },
          source: "LRCLIB"
        });
      }
    } catch (e) {}
  }

  if (cleanArtist) {
    try {
      const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(cleanArtist)}/${encodeURIComponent(cleanTitle)}`;
      const { data } = await axios.get(url, { timeout: 6000 });
      if (data?.lyrics) {
        return res.json({
          success: true,
          data: { title: cleanTitle, artist: cleanArtist, plain: data.lyrics.trim(), synced: "", hasSync: false },
          source: "lyrics.ovh"
        });
      }
    } catch (e) {}
  }

  res.json({ success: false, error: "Lirik tidak ditemukan" });
});

// ============================================================
//      COMMENTS
// ============================================================
app.get("/api/comments/:videoId", (req, res) => {
  try { res.json({ success: true, data: db.getComments(req.params.videoId) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.post("/api/comments/:videoId", (req, res) => {
  const { videoId } = req.params;
  const { userId, name, text } = req.body || {};
  if (!userId || !text) return res.status(400).json({ success: false, error: "Butuh userId & text" });
  if (db.isBanned(userId)) return res.status(403).json({ success: false, error: "Kamu di-ban" });
  try { res.json({ success: true, data: db.addComment(videoId, { userId, name, text }) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.delete("/api/comments/:videoId/:commentId", (req, res) => {
  const { videoId, commentId } = req.params;
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ success: false, error: "Butuh userId" });
  res.json(db.deleteComment(videoId, commentId, userId));
});

// ============================================================
//      TRACK + LEADERBOARD
// ============================================================
app.post("/api/track", (req, res) => {
  const { videoId, song, userId, name } = req.body || {};
  if (!videoId) return res.status(400).json({ success: false, error: "Butuh videoId" });
  try {
    db.registerUser(userId, name);
    db.trackPlay(videoId, song || {}, userId);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.get("/api/leaderboard", (req, res) => {
  try {
    const songs = db.getTopSongs(20);
    const listeners = db.getTopListeners(20).map(l => {
      const u = db.getUser(l.userId);
      return { ...l, name: u?.name || l.userId.slice(0, 12), role: u?.role || "user" };
    });
    res.json({ success: true, data: { songs, listeners } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
//      FOLLOWS
// ============================================================
app.get("/api/follows/:userId", (req, res) => {
  try { res.json({ success: true, data: db.getFollows(req.params.userId) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.post("/api/follows/:userId", (req, res) => {
  const { artist } = req.body || {};
  if (!artist) return res.status(400).json({ success: false, error: "Butuh artist" });
  const ok = db.follow(req.params.userId, artist);
  res.json({ success: ok, data: db.getFollows(req.params.userId) });
});
app.delete("/api/follows/:userId", (req, res) => {
  const { artist } = req.body || {};
  if (!artist) return res.status(400).json({ success: false, error: "Butuh artist" });
  db.unfollow(req.params.userId, artist);
  res.json({ success: true, data: db.getFollows(req.params.userId) });
});
app.get("/api/follows/:userId/news", async (req, res) => {
  if (!ytmusicReady) return res.status(503).json({ success: false, error: "YTMusic belum ready" });
  try {
    const artists = db.getFollows(req.params.userId);
    if (artists.length === 0) return res.json({ success: true, data: [] });
    const news = [];
    for (const artist of artists.slice(0, 5)) {
      try {
        const results = await ytmusic.search(`${artist} terbaru`);
        const songs = results
          .filter(item => item.videoId && (item.type === "SONG" || item.type === "VIDEO"))
          .map(normalizeSong).filter(Boolean).slice(0, 3);
        if (songs.length > 0) news.push({ artist, songs });
      } catch (e) {}
    }
    res.json({ success: true, data: news });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
//      WEEKLY
// ============================================================
app.get("/api/weekly/:userId", async (req, res) => {
  if (!ytmusicReady) return res.status(503).json({ success: false, error: "YTMusic belum ready" });
  const userId = req.params.userId;
  try {
    const existing = db.getWeekly(userId);
    if (existing && Date.now() - existing.ts < 7 * 24 * 60 * 60 * 1000) {
      return res.json({ success: true, data: existing.playlist, cached: true });
    }
    const topSongs = db.getTopSongs(20);
    const seedArtists = [...new Set(topSongs.map(s => s.artist).filter(Boolean))].slice(0, 5);

    if (seedArtists.length === 0) {
      const results = await ytmusic.search("lagu viral 2026");
      const normalized = results
        .filter(item => item.videoId && (item.type === "SONG" || item.type === "VIDEO"))
        .map(normalizeSong).filter(Boolean).slice(0, 15);
      db.saveWeekly(userId, normalized);
      return res.json({ success: true, data: normalized, generated: true });
    }

    const allSongs = [];
    const seen = new Set();
    for (const artist of seedArtists) {
      try {
        const results = await ytmusic.search(`${artist} songs`);
        const songs = results
          .filter(item => item.videoId && (item.type === "SONG" || item.type === "VIDEO"))
          .map(normalizeSong).filter(Boolean);
        for (const s of songs) {
          if (!seen.has(s.videoId) && allSongs.length < 20) {
            seen.add(s.videoId);
            allSongs.push(s);
          }
        }
      } catch (e) {}
      if (allSongs.length >= 20) break;
    }

    db.saveWeekly(userId, allSongs);
    res.json({ success: true, data: allSongs, generated: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
//      STREAM & DOWNLOAD
// ============================================================
app.get("/api/stream", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("URL kosong");
  try {
    const upstream = await openUpstream(url, {
      maxRedirects: 5,
      decompress: false, validateStatus: (s) => s >= 200 && s < 400,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "*/*", "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://music.youtube.com/", Origin: "https://music.youtube.com",
        ...(req.headers.range ? { Range: req.headers.range } : {})
      }
    });
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers["content-type"] || "audio/mpeg");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-cache");
    if (upstream.headers["content-length"]) res.setHeader("Content-Length", upstream.headers["content-length"]);
    if (upstream.headers["content-range"]) res.setHeader("Content-Range", upstream.headers["content-range"]);
    pipeUpstream(res, upstream.data);
  } catch (e) {
    if (!res.headersSent) res.status(500).send(`Gagal stream: ${e.message}`);
  }
});

app.get("/api/download", async (req, res) => {
  const url = req.query.url;
  const filename = (req.query.filename || "audio.m4a").replace(/[\\/:*?"<>|]/g, "_");
  if (!url) return res.status(400).send("URL kosong");
  try {
    const upstream = await openUpstream(url, {
      maxRedirects: 5,
      headers: { "User-Agent": "Mozilla/5.0", Referer: "https://music.youtube.com/" }
    });
    res.setHeader("Content-Type", "audio/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
    if (upstream.headers["content-length"]) res.setHeader("Content-Length", upstream.headers["content-length"]);
    pipeUpstream(res, upstream.data);
  } catch (e) {
    if (!res.headersSent) res.status(500).send("Gagal download");
  }
});

// ============================================================
//      TIKTOK
// ============================================================
app.get("/api/tiktok/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  const count = parseInt(req.query.count || "10");
  if (!q) return res.status(400).json({ success: false, error: "Query kosong" });
  try {
    const results = await tiktok.searchTikTok(q, count);
    res.json({ success: true, query: q, total: results.length, data: results });
  } catch (e) {
    console.error("TikTok search error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/api/tiktok/home", async (req, res) => {
  try {
    const keywords = ["fyp", "viral", "tiktok indonesia", "trending", "dance", "lucu"];
    const picked = keywords.sort(() => 0.5 - Math.random()).slice(0, 2);
    let allVideos = [];
    for (const kw of picked) {
      try {
        const videos = await tiktok.searchTikTok(kw, 8);
        allVideos = allVideos.concat(videos);
      } catch (e) {
        console.log(`Gagal ambil keyword ${kw}:`, e.message);
      }
    }
    const seen = new Set();
    const unique = [];
    for (const v of allVideos) {
      if (!seen.has(v.videoUrl)) { seen.add(v.videoUrl); unique.push(v); }
    }
    if (unique.length === 0) return res.status(404).json({ success: false, error: "Gagal memuat" });
    res.json({ success: true, data: unique.sort(() => 0.5 - Math.random()) });
  } catch (e) {
    console.error("TikTok Home error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/api/tiktok/download", async (req, res) => {
  const url = (req.query.url || "").trim();
  if (!url) return res.status(400).json({ success: false, error: "URL kosong" });
  try {
    const result = await tiktok.downloadTikTok(url);
    if (!result) return res.status(404).json({ success: false, error: "Gagal download" });
    res.json({ success: true, data: result });
  } catch (e) {
    console.error("TikTok download error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/api/tiktok/stream", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("URL kosong");
  try {
    const rangeHeader = req.headers.range;
    const upstream = await axios.get(url, {
      responseType: "stream",
      timeout: 60000,
      maxRedirects: 5,
      decompress: false,
      validateStatus: (s) => s >= 200 && s < 400,
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36",
        Accept: "*/*",
        Referer: "https://www.tiktok.com/",
        Origin: "https://www.tiktok.com",
        ...(rangeHeader ? { Range: rangeHeader } : {})
      }
    });
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers["content-type"] || "video/mp4");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-cache");
    if (upstream.headers["content-length"]) res.setHeader("Content-Length", upstream.headers["content-length"]);
    if (upstream.headers["content-range"]) res.setHeader("Content-Range", upstream.headers["content-range"]);
    upstream.data.pipe(res);
    upstream.data.on("error", () => { if (!res.headersSent) res.status(500).end(); });
    req.on("close", () => upstream.data.destroy());
  } catch (e) {
    if (!res.headersSent) res.status(500).send(`Gagal stream: ${e.message}`);
  }
});

// ============================================================
//      FITUR TAMBAHAN — semua digabung di server.js
//      Spotify (cadangan putar + cadangan pencarian), Instagram, Pinterest, Dafont
//      Tiap modul dibungkus safeInit: kalau dependency-nya belum ke-install,
//      cuma modul itu yang mati — server tetap jalan. Jalankan `npm install`.
// ============================================================
// API key Naze opsional (config.js -> nazekey, atau env NAZE_KEY) untuk cadangan pencarian Spotify
{
  let _cfg = {}; try { _cfg = require("./config"); } catch (e) {}
  const _list = (v) => Array.isArray(v) ? v : String(v || "").split(",").map(x => x.trim()).filter(Boolean);
  global.nazekey = _list(process.env.NAZE_KEY || _cfg.nazekey);
}

function safeInit(name, fn) {
  try { return fn(); }
  catch (e) { console.error(`⚠️ Modul ${name} gagal dimuat: ${e.message}`); return null; }
}
const apiFail = (res, code, error, extra = {}) => res.status(code).json({ success: false, error, ...extra });
const needMod = (mod, label) => { if (!mod) throw new Error(label + " tidak tersedia (jalankan npm install)"); return mod; };

// ----- Spotify downloader (v1-v4) -----
const bkSpotify = safeInit("Spotify downloader (v1-v4)", () => {
  const https = require("https")
  const cheerio = require("cheerio")

  function cleanInput(text = "") {
    return String(text || "").trim()
  }

  function extractTrackId(text) {
    if (!text) return null
    const s = String(text)
    if (/^[a-zA-Z0-9]{22}$/.test(s)) return s
    const m = s.match(/track\/([a-zA-Z0-9]{22})/)
    return m ? m[1] : null
  }

  function extractTrackUrl(text) {
    const id = extractTrackId(text)
    if (id) return `https://open.spotify.com/track/${id}`
    if (/spotify\.com\/track\//i.test(String(text))) return String(text).split("?")[0]
    return null
  }

  async function tryGetOfficialMeta(trackUrl) {
    try {
      if (!trackUrl) return null;
      const axios = require("axios");
      const cheerio = require("cheerio");
      const { data } = await axios.get(trackUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        timeout: 15000
      });
      const $ = cheerio.load(data);

      let title = $('meta[property="og:title"]').attr('content');
      let desc = $('meta[property="og:description"]').attr('content');
      let thumbnail = $('meta[property="og:image"]').attr('content');

      let artist = "Unknown Artist";
      if (desc) {
          let parts = desc.split('·').map(p => p.trim());
          artist = parts.length > 1 ? parts[1] : desc;
      }

      return {
        title: title || "Spotify Audio",
        artist: artist,
        thumbnail: thumbnail || "",
        duration: "-" 
      };
    } catch (e) {
      return null;
    }
  }

  async function v1_run(input) {
    const axios = (await import("axios")).default
    const trackId = extractTrackId(input)
    if (!trackId) throw new Error("Invalid Spotify track URL/ID")

    const trackUrl = `https://open.spotify.com/track/${trackId}`
    const headers = {
      origin: "https://spotdown.org",
      referer: "https://spotdown.org/",
      "user-agent": "Mozilla/5.0",
    }

    const { data: details } = await axios.get(`https://spotdown.org/api/song-details?url=${encodeURIComponent(trackUrl)}`, { headers, timeout: 20000 })
    const song = details?.songs?.[0]
    if (!song?.url) throw new Error("Track not found")

    const { data: audioData } = await axios.post("https://spotdown.org/api/download", { url: song.url }, { headers, responseType: "arraybuffer", timeout: 60000 })

    return { version: "v1", trackId, trackUrl, audioBuffer: Buffer.from(audioData), song: {} }
  }

  async function v2_run(input) {
    const axios = require("axios")
    const { zencf } = require("zencf")

    const headers = {
      "user-agent": "Mozilla/5.0 (Linux; Android 10)",
      "content-type": "application/json",
      origin: "https://spotidownloader.com",
      referer: "https://spotidownloader.com/",
    }

    const { token } = await zencf.turnstileMin("https://spotidownloader.com", "0x4AAAAAAA8QAiFfE5GuBRRS")
    const session = await axios.post("https://api.spotidownloader.com/session", { token }, { headers, timeout: 20000 })
    const bearer = session?.data?.token
    if (!bearer) throw new Error("Failed to get session")

    let trackId = extractTrackId(input)
    if (!trackId) {
      const search = await axios.post("https://api.spotidownloader.com/search", { query: input }, { headers: { ...headers, authorization: `Bearer ${bearer}` }, timeout: 20000 })
      const first = search?.data?.tracks?.[0]
      if (!first?.id) throw new Error("Track not found")
      trackId = first.id
    }

    const dl = await axios.post("https://api.spotidownloader.com/download", { id: trackId }, { headers: { ...headers, authorization: `Bearer ${bearer}` }, timeout: 30000 })
    const link = dl?.data?.link
    if (!link) throw new Error("Download link not available")

    const audioRes = await axios.get(link, { responseType: "arraybuffer", timeout: 60000, headers: { "user-agent": headers["user-agent"] } })

    return {
      version: "v2", trackId, trackUrl: `https://open.spotify.com/track/${trackId}`, audioBuffer: Buffer.from(audioRes.data),
      song: {
        title: dl?.data?.metadata?.title,
        artist: dl?.data?.metadata?.artist,
        thumbnail: dl?.data?.metadata?.thumbnail,
        duration: dl?.data?.metadata?.duration
      }
    }
  }

  async function v3_run(input) {
    const axios = require("axios")
    const base = "https://spotmate.online"
    const trackUrl = extractTrackUrl(input)
    if (!trackUrl) throw new Error("Invalid Spotify track URL/ID")

    const client = axios.create({ httpsAgent: new https.Agent({ rejectUnauthorized: false }), validateStatus: () => true, timeout: 30000 })
    const page = await client.get(base, { headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*" } })
    const cookies = page.headers["set-cookie"] || []
    const cookieString = cookies.map((v) => v.split(";")[0]).join("; ")

    const $ = cheerio.load(page.data || "")
    const csrf = $('meta[name="csrf-token"]').attr("content")
    if (!csrf) throw new Error("CSRF not found")

    const convert = await client.post(base + "/convert", { urls: trackUrl }, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json, text/plain, */*", "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest", Referer: base, Origin: base, "X-CSRF-TOKEN": csrf, Cookie: cookieString } })
    if (!convert?.data?.url) throw new Error("Convert failed")

    const audioRes = await axios.get(convert.data.url, { responseType: "arraybuffer", timeout: 60000, headers: { "User-Agent": "Mozilla/5.0" } })

    return { version: "v3", trackId: extractTrackId(trackUrl), trackUrl, audioBuffer: Buffer.from(audioRes.data), song: {} }
  }

  async function v4_run(input) {
    const axios = require("axios")
    const tough = require("tough-cookie")
    const { wrapper } = require("axios-cookiejar-support")
    const spotifyUrl = extractTrackUrl(input)
    if (!spotifyUrl) throw new Error("Invalid Spotify URL")

    const jar = new tough.CookieJar()
    const client = wrapper(axios.create({ jar, withCredentials: true, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, timeout: 30000 }))

    const page = await client.get("https://spotdl.io/v2")
    const $ = cheerio.load(page.data || "")
    const csrfToken = $('meta[name="csrf-token"]').attr("content")
    if (!csrfToken) throw new Error("CSRF token tidak ditemukan")

    const convertRes = await client.post("https://spotdl.io/convert", { urls: spotifyUrl }, { headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": csrfToken, Referer: "https://spotdl.io/v2", Origin: "https://spotdl.io" }, timeout: 30000 })
    if (!convertRes?.data?.url) throw new Error("Gagal convert")

    const audioRes = await axios.get(convertRes.data.url, { responseType: "arraybuffer", headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, timeout: 60000 })

    return { version: "v4", trackId: extractTrackId(spotifyUrl), trackUrl: spotifyUrl, audioBuffer: Buffer.from(audioRes.data), song: {} }
  }

  const SCRAPERS = [
    { name: "v1", run: v1_run },
    { name: "v2", run: v2_run },
    { name: "v3", run: v3_run },
    { name: "v4", run: v4_run },
  ]

  function mergeMetaPreferOfficial(currentMeta = {}, officialMeta = null) {
    if (!officialMeta) return currentMeta || {}
    return {
      title: officialMeta.title && officialMeta.title !== "Spotify Audio" ? officialMeta.title : (currentMeta.title || "Spotify Audio"),
      artist: officialMeta.artist && officialMeta.artist !== "Unknown Artist" ? officialMeta.artist : (currentMeta.artist || "Unknown Artist"),
      thumbnail: officialMeta.thumbnail || currentMeta.thumbnail || "",
      duration: currentMeta.duration && currentMeta.duration !== "-" ? currentMeta.duration : (officialMeta.duration || "-"),
    }
  }

  async function spotifyScrape(input, opts = {}) {
    const text = cleanInput(input)
    if (!text) throw new Error("No input provided")

    let lastErr = null

    for (const s of SCRAPERS) {
      try {
        const res = await s.run(text, opts)
        if (!res?.audioBuffer) throw new Error("Invalid response")

        if (!res.trackUrl && res.trackId) res.trackUrl = `https://open.spotify.com/track/${res.trackId}`;

        const officialMeta = await tryGetOfficialMeta(res.trackUrl)
        res.song = mergeMetaPreferOfficial(res.song, officialMeta)

        return res
      } catch (e) {
        lastErr = e
      }
    }

    console.error(lastErr.message || lastErr)
    throw lastErr || new Error("Semua server Spotify mati/limit.")
  }
  return { spotifyScrape };
});

// ----- Instagram downloader -----
const bkIG = safeInit("Instagram downloader", () => {
  const axios = require('axios');
  const cheerio = require('cheerio');
  const vm = require('node:vm');
  const cloudscraper = require('cloudscraper');

  async function indown(url) {
      try {
          const { data: pageData, headers } = await axios.get('https://indown.io/en1', {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/115.0.0.0 Safari/537.36' }
          });

          const $ = cheerio.load(pageData);
          const token = $('input[name="_token"]').val();
          const cookies = headers['set-cookie'] ? headers['set-cookie'].map(v => v.split(';')[0]).join('; ') : '';

          if (!token) throw new Error('Token Indown not found');

          const params = new URLSearchParams();
          params.append('referer', 'https://indown.io/en1');
          params.append('locale', 'en');
          params.append('_token', token);
          params.append('link', url);
          params.append('p', 'i');

          const { data: resultData } = await axios.post('https://indown.io/download', params, {
              headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'Cookie': cookies,
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/115.0.0.0 Safari/537.36'
              }
          });

          const $result = cheerio.load(resultData);
          const resultUrls = [];

          $result('video source[src], a[href].btn-outline-primary').each((i, e) => {
              let link = $result(e).attr('src') || $result(e).attr('href');
              if (link) {
                  if (link.includes('indown.io/fetch')) {
                      try { link = decodeURIComponent(new URL(link).searchParams.get('url')); } catch (err) {}
                  }
                  if (/cdninstagram\.com|fbcdn\.net/.test(link)) {
                      resultUrls.push(link.replace(/&dl=1$/, ''));
                  }
              }
          });

          const uniqueUrls = [...new Set(resultUrls)];
          if (uniqueUrls.length === 0) throw new Error('No media found');

          return { status: true, source: 'indown', result: { metadata: { username: '-', caption: '-' }, downloadUrl: uniqueUrls } };
      } catch (e) {
          return { status: false, message: e.message };
      }
  }

  async function snapsave(targetUrl) {
      try {
          const form = new URLSearchParams();
          form.append('url', targetUrl);

          const { data } = await axios.post('https://snapsave.app/id/action.php?lang=id', form, {
              headers: {
                  'origin': 'https://snapsave.app',
                  'referer': 'https://snapsave.app/id/download-video-instagram',
                  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
              }
          });

          const ctx = { window: {}, document: { getElementById: () => ({ value: '' }) }, console: console, eval: (res) => res };
          vm.createContext(ctx);
          const decoded = vm.runInContext(data, ctx);
          const regex = /https:\/\/d\.rapidcdn\.app\/v2\?[^"]+/g;
          const matches = decoded.match(regex);

          if (matches && matches.length > 0) {
              const cleanUrls = [...new Set(matches.map(url => url.replace(/&amp;/g, '&')))];
              return { status: true, source: 'snapsave', result: { metadata: { username: '-', caption: '-' }, downloadUrl: cleanUrls } };
          }
          throw new Error('No media found');
      } catch (e) {
          return { status: false, message: e.message };
      }
  }

  const SNAP_BASE = 'https://snapinsta.to';
  const snapHeaders = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36',
      'Accept': '*/*',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': SNAP_BASE,
      'Referer': `${SNAP_BASE}/en2`,
  };
  const jar = new cloudscraper.jar();

  async function snapinsta(instagramUrl) {
      try {
          const formData = `url=${encodeURIComponent(instagramUrl)}`;
          const tokenRes = await cloudscraper.post({
              uri: `${SNAP_BASE}/api/userverify`, headers: snapHeaders, body: formData, jar, simple: false, resolveWithFullResponse: true,
          });
          if (tokenRes.statusCode !== 200) throw new Error(`Token request failed`);
          const tokenData = JSON.parse(tokenRes.body);
          if (!tokenData.success) throw new Error('Token generation failed');
          const token = tokenData.token;

          const searchData = `q=${encodeURIComponent(instagramUrl)}&t=media&v=v2&lang=en&cftoken=${token}`;
          const searchRes = await cloudscraper.post({
              uri: `${SNAP_BASE}/api/ajaxSearch`, headers: snapHeaders, body: searchData, jar, simple: false, resolveWithFullResponse: true,
          });
          if (searchRes.statusCode !== 200) throw new Error(`Ajax request failed`);
          const searchJson = JSON.parse(searchRes.body);
          if (searchJson.status !== 'ok') throw new Error('Search failed');

          let capturedOutput = '';
          const sandbox = {
              console: { log: (...args) => { capturedOutput += args.join(' ') + '\n'; } },
              document: { write: (html) => { capturedOutput += html; }, writeln: (html) => { capturedOutput += html + '\n'; }, location: { hostname: 'snapinsta.to', href: 'https://snapinsta.to/en2' }, getElementById: () => ({ innerHTML: '' }), createElement: () => ({}), body: { appendChild: () => {} } },
              window: { location: { hostname: 'snapinsta.to', href: 'https://snapinsta.to/en2' }, document: { location: { hostname: 'snapinsta.to' } }, addEventListener: () => {}, removeEventListener: () => {} },
              location: { hostname: 'snapinsta.to' }, navigator: { userAgent: 'Mozilla/5.0' }, decodeURIComponent: (str) => decodeURIComponent(str), String: { fromCharCode: (...codes) => String.fromCharCode(...codes) },
              eval: function(code) { return vm.runInNewContext(code, sandbox); }
          };

          const resultVM = vm.runInNewContext(searchJson.data, sandbox);
          const finalHtml = capturedOutput || (typeof resultVM === 'string' ? resultVM : '');
          if (!finalHtml) throw new Error('No HTML output generated');

          const videoMatches = [...finalHtml.matchAll(/href="(https:\/\/dl\.snapcdn\.app\/get\?token=[^"]+)"/gi)].map(m => m[1]);
          const imageMatches = [...finalHtml.matchAll(/<img[^>]+src="(https:\/\/i\.snapcdn\.app\/photo\?token=[^"]+)"/gi)].map(m => m[1]);
        
          const urls = [...new Set([...videoMatches, ...imageMatches])];
          if (urls.length === 0) throw new Error('No media found');

          return { status: true, source: 'snapinsta', result: { metadata: { username: '-', caption: '-' }, downloadUrl: urls } };
      } catch (e) {
          return { status: false, message: e.message };
      }
  }

  async function igdl(url) {
      let res = await snapinsta(url);
      if (res.status && res.result && res.result.downloadUrl.length > 0) return res;

      res = await indown(url);
      if (res.status && res.result && res.result.downloadUrl.length > 0) return res;
    
      res = await snapsave(url);
      return res;
  }
  return { igdl };
});

// ----- Pinterest search -----
// Alur: buka halaman pencarian (cookie csrftoken & _pinterest_sess ikut tersimpan di cookie jar,
// redirect diikuti) -> ambil hasil awal dari __PWS_DATA__ -> lanjutkan halaman lewat BaseSearchResource.
const bkPin = safeInit("Pinterest search", () => {
  const axios = require("axios");
  const { wrapper } = require("axios-cookiejar-support");
  const { CookieJar } = require("tough-cookie");

  // Host bisa diganti lewat env PINTEREST_HOST (dipakai untuk tes dengan server lokal)
  const HOST = (process.env.PINTEREST_HOST || "https://www.pinterest.com").replace(/\/+$/, "");
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
  const MAX_PAGES = 5;

  // Ambil URL gambar pin dari struktur JSON apa pun (hanya ukuran pin, bukan avatar)
  const collectImages = (node, out, depth = 0) => {
    if (!node || typeof node !== "object" || depth > 40) return out;
    if (Array.isArray(node)) { node.forEach(n => collectImages(n, out, depth + 1)); return out; }
    if (node.images && typeof node.images === "object") {
      const img = node.images["736x"] || node.images["474x"] || node.images["orig"];
      if (img && typeof img.url === "string") out.push(img.url);
    }
    for (const v of Object.values(node)) if (v && typeof v === "object") collectImages(v, out, depth + 1);
    return out;
  };

  const extractPwsData = (html) => {
    const m = String(html || "").match(/<script id="__PWS_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch (e) { return null; }
  };

  const getCookieValue = (jar, name) => {
    const str = jar.getCookieStringSync(HOST) || "";
    const hit = str.split(";").map(x => x.trim()).find(x => x.startsWith(name + "="));
    return hit ? hit.slice(name.length + 1) : "";
  };

  const searchPinterestAPI = async (query, limit = 25) => {
    const q = String(query || "").trim();
    if (!q) throw new Error("Query kosong");

    const jar = new CookieJar();
    const client = wrapper(axios.create({
      jar,
      withCredentials: true,
      timeout: 20000,
      maxRedirects: 5,
      responseType: "text",
      validateStatus: s => s >= 200 && s < 400,
      headers: { "User-Agent": UA, "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7" }
    }));
    const sourceUrl = `/search/pins/?q=${encodeURIComponent(q)}`;

    // 1) Halaman pencarian. Kalau csrftoken belum ada, coba halaman utama (kadang cookie di sana).
    let html = "";
    try {
      const page = await client.get(HOST + sourceUrl, { headers: { Accept: "text/html,application/xhtml+xml,*/*;q=0.8" } });
      html = String(page.data || "");
    } catch (e) {
      throw new Error("Gagal membuka Pinterest: " + e.message);
    }
    if (!getCookieValue(jar, "csrftoken")) {
      try { await client.get(HOST + "/", { headers: { Accept: "text/html,application/xhtml+xml,*/*;q=0.8" } }); } catch (e) {}
    }
    const csrftoken = getCookieValue(jar, "csrftoken");
    if (!csrftoken) {
      throw new Error("Gagal mendapatkan CSRF token dari Pinterest (cookie csrftoken tidak diterima). Coba lagi nanti.");
    }

    const results = [];
    const seen = new Set();
    const push = (urls) => {
      for (const u of urls) {
        if (results.length >= limit) break;
        if (!seen.has(u)) { seen.add(u); results.push(u); }
      }
    };

    // 2) Hasil awal dari halaman
    push(collectImages(extractPwsData(html), []));

    // 3) Halaman berikutnya lewat BaseSearchResource
    let bookmark = null;
    for (let page = 0; page < MAX_PAGES && results.length < limit; page++) {
      const body = new URLSearchParams({
        source_url: sourceUrl,
        data: JSON.stringify({ options: { query: q, scope: "pins", bookmarks: bookmark ? [bookmark] : [] }, context: {} })
      }).toString();
      let json;
      try {
        const r = await client.post(HOST + "/resource/BaseSearchResource/get/", body, {
          headers: {
            Accept: "application/json, text/javascript, */*, q=0.01",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "X-CSRFToken": csrftoken,
            "X-Pinterest-AppState": "active",
            "X-Pinterest-Source-Url": sourceUrl,
            Referer: HOST + sourceUrl,
            Origin: HOST
          }
        });
        json = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
      } catch (e) {
        break; // pakai hasil yang sudah didapat
      }
      const rr = json && json.resource_response;
      const pins = rr && rr.data && rr.data.results;
      if (!Array.isArray(pins) || pins.length === 0) break;
      const before = results.length;
      push(collectImages(pins, []));
      bookmark = rr.bookmark;
      if (!bookmark || bookmark === "-end-" || results.length === before) break;
    }

    if (!results.length) throw new Error("Pinterest tidak mengembalikan gambar untuk pencarian ini");
    return results;
  };

  return { searchPinterestAPI };
});

// ----- Dafont search -----
const bkDafont = safeInit("Dafont search", () => {
  const axios = require('axios');
  const cheerio = require('cheerio');

  async function searchDafont(q) {
      let url = 'https://www.dafont.com/search.php?q=' + encodeURIComponent(q);
      let { data } = await axios.get(url);
      let $ = cheerio.load(data);
      let result = [];

      $('.lv1left.dfbg').each((i, el) => {
          let base = $(el);
          let lv2 = base.nextAll('.lv2right').first();
          let dlbox = base.nextAll('.dlbox').first();
          let previewBox = base.nextAll('.preview').first();

          let raw = base.text().replace(/\s+/g, ' ').trim();
          let author = base.find('a').first().text().trim();
          let name = raw.replace(/\s*by\s*.+$/i, '').trim();
          let info = lv2.find('.light').text().trim();
          let downloads = info.match(/[\d,]+ downloads/)?.[0] || 'Unknown';

          let dl = dlbox.find('a.dl').attr('href');
          let download = dl ? 'https:' + dl : null;

          let style = previewBox.attr('style');
          let preview = style ? 'https://www.dafont.com' + (style.match(/url\((.*?)\)/)?.[1] || '') : null;

          if (download) {
              result.push({ name, author, downloads, download, preview });
          }
      });

      return result;
  }
  return { searchDafont };
});

// ---- SPOTIFY PLAY  GET /api/spotify/play?url=<link|id|judul> -> audio MP3 (diputar langsung di player)
//      Cadangan kalau lagu Spotify tidak ketemu versi YouTube-nya. Mendukung Range supaya bisa di-seek.
const spPlayCache = new Map();
app.get("/api/spotify/play", async (req, res) => {
  const input = String(req.query.url || req.query.q || "").trim();
  if (!input) return apiFail(res, 400, "Masukkan link/judul Spotify");
  try {
    let hit = spPlayCache.get(input);
    if (!hit || hit.exp < Date.now()) {
      const r = await needMod(bkSpotify, "Spotify").spotifyScrape(input);
      hit = { buf: r.audioBuffer, exp: Date.now() + 10 * 60 * 1000 };
      if (spPlayCache.size >= 6) spPlayCache.delete(spPlayCache.keys().next().value);
      spPlayCache.set(input, hit);
    }
    const buf = hit.buf, total = buf.length;
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-store");
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (m && (m[1] || m[2])) {
      let s = m[1] ? parseInt(m[1], 10) : Math.max(total - parseInt(m[2], 10), 0);
      let e = m[1] && m[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1;
      if (s >= total || s > e) { res.status(416).setHeader("Content-Range", `bytes */${total}`); return res.end(); }
      res.status(206);
      res.setHeader("Content-Range", `bytes ${s}-${e}/${total}`);
      res.setHeader("Content-Length", e - s + 1);
      return res.end(buf.subarray(s, e + 1));
    }
    res.setHeader("Content-Length", total);
    res.end(buf);
  } catch (e) { apiFail(res, 502, e.message || "Semua server Spotify mati/limit"); }
});

// ---- INSTAGRAM  GET /api/instagram?url=   (snapinsta -> indown -> snapsave)
app.get("/api/instagram", async (req, res) => {
  const url = String(req.query.url || "").trim();
  if (!/^https?:\/\/(www\.)?instagram\.com\//i.test(url)) return apiFail(res, 400, "Masukkan link Instagram yang valid");
  try {
    const r = await needMod(bkIG, "Instagram").igdl(url);
    if (!r || !r.status || !r.result || !r.result.downloadUrl.length) return apiFail(res, 404, (r && r.message) || "Media tidak ditemukan");
    res.json({ success: true, source: r.source, data: { urls: r.result.downloadUrl, metadata: r.result.metadata } });
  } catch (e) { apiFail(res, 500, e.message); }
});

// ---- PINTEREST  GET /api/pinterest?q=&limit=
app.get("/api/pinterest", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit || "24", 10) || 24, 1), 60);
  if (!q) return apiFail(res, 400, "Query kosong");
  try {
    const imgs = await needMod(bkPin, "Pinterest").searchPinterestAPI(q, limit);
    if (!imgs.length) return apiFail(res, 404, "Tidak ada hasil");
    res.json({ success: true, query: q, total: imgs.length, data: imgs });
  } catch (e) { apiFail(res, 500, e.message); }
});

// ---- DAFONT  GET /api/dafont?q=
app.get("/api/dafont", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return apiFail(res, 400, "Query kosong");
  try {
    const list = await needMod(bkDafont, "Dafont").searchDafont(q);
    if (!list.length) return apiFail(res, 404, "Font tidak ditemukan");
    res.json({ success: true, query: q, total: list.length, data: list });
  } catch (e) { apiFail(res, 500, e.message); }
});

// ----- Naze search Spotify -----
const bkNaze = safeInit("Naze search Spotify", () => {
  const axios = require('axios');

  async function searchSpotify(query) {
      try {
          let keys = [];
        
          if (typeof global.nazekey !== 'undefined' && global.nazekey) {
              if (Array.isArray(global.nazekey)) {
                  keys = global.nazekey;
              } else if (typeof global.nazekey === 'string') {
                  keys = global.nazekey.split(',').map(k => k.trim()).filter(k => k !== '');
              }
          }

          if (keys.length === 0) {
              throw new Error("API Key Naze belum disetting di settings.js");
          }

          let tracks = null;

          for (let i = 0; i < keys.length; i++) {
              try {
                  const currentKey = keys[i];
                  const url = `https://api.naze.biz.id/search/spotify?query=${encodeURIComponent(query)}&apikey=${currentKey}`;
                
                  const response = await axios.get(url, { timeout: 15000 });
                
                  let resData = response.data?.result || response.data?.data;
                
                  if (resData && Array.isArray(resData) && resData.length > 0) {
                      tracks = resData;
                      break;
                  }
              } catch (err) {
                  continue;
              }
          }

          if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
              throw new Error("Semua API Key limit, server sedang mati, atau lagu tidak ditemukan!");
          }

          return tracks.map(track => {
              return {
                  name: track.title || 'Tanpa Judul',
                  artists: track.artist || 'Unknown',
                  popularity: track.popularity || 'N/A',
                  link: track.url || 'Tidak ada link',
                  thumbnail: track.thumbnail || null,
                  duration: track.duration || null
              };
          }).slice(0, 20);

      } catch (error) {
          // Log ini akan muncul jika API sedang bermasalah, tapi tidak akan membuat bot crash
          console.error("Peringatan dari Naze API:", error.message);
          return [];
      }
  }
  return { searchSpotify };
});

// ============================================================
//      GRUP, CHAT PRIBADI, STATUS, DAN TOKO (harga & beli limit)
// ============================================================
require("./social")(app, { requireAccount });
require("./shop")(app, { requireAccount, requireRoles });
require("./cek-foto-ai")(app, { requireAccount, requireRoles });
require("./chess-online")(io).catch(err => console.error("Catur online gagal dimuat:", err));

// ============================================================
//      SOCKET.IO
// ============================================================
io.on("connection", (socket) => {
  console.log("🔌 User connected:", socket.id);

  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    socket.emit("chat-history", db.getChat(roomId, 50));
    socket.to(roomId).emit("user-joined", { id: socket.id });
  });

  socket.on("send-message", ({ roomId, userId, name, text }) => {
    if (!roomId || !text) return;
    if (db.isBanned(userId)) {
      socket.emit("error-message", { error: "Kamu di-ban dari chat" });
      return;
    }
    const msg = db.addChat(roomId, { userId, name, text });
    if (msg.error) { socket.emit("error-message", { error: "Gagal kirim pesan" }); return; }
    io.to(roomId).emit("new-message", msg);
  });

  socket.on("disconnect", (reason) => {
    console.log("🔌 Disconnected:", socket.id, reason);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 http://localhost:${PORT}`);
});