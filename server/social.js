// ============================================================
//      SOSIAL: grup (buka/tutup seperti WA), chat pribadi antar
//      member, dan status yang hilang otomatis setelah 24 jam.
//      Semua endpoint memakai token sesi (identitas tidak dari body).
// ============================================================
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { findByUsername, getAccounts, badgeMap } = require("./account");
const badgeLib = require("./badges");

const DATA_DIR = path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "social.json");

const MAX_MSG = 300;              // pesan disimpan per grup / per percakapan
const MAX_TEXT = 500;             // panjang pesan chat
const MAX_GROUP_MEMBERS = 100;
const MAX_GROUP_NAME = 40;
const SEND_GAP_MS = 1000;         // anti spam: 1 pesan per detik per akun
const STATUS_TTL = 24 * 3600 * 1000;
const STATUS_TEXT_MAX = 200;
const MAX_STATUS_PER_USER = 10;
const STATUS_COLORS = ["#8b5cf6", "#f472b6", "#22d3ee", "#fbbf24", "#34d399", "#fb7185", "#111827"];

const lastSend = new Map();       // username(lower) -> ts pesan terakhir

function fresh() { return { groups: [], gmsgs: {}, dms: {}, status: [] }; }

function load() {
  try {
    if (!fs.existsSync(FILE)) return fresh();
    const raw = fs.readFileSync(FILE, "utf8");
    return { ...fresh(), ...(raw ? JSON.parse(raw) : {}) };
  } catch (e) { return fresh(); }
}

function save(d) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(d));
    fs.renameSync(tmp, FILE);
    return true;
  } catch (e) { console.error("social save error:", e.message); return false; }
}

// Buang status yang sudah lewat 24 jam
function pruneStatus(d, now = Date.now()) {
  d.status = d.status.filter(s => now - s.ts < STATUS_TTL);
}

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const dmKey = (a, b) => [String(a).toLowerCase(), String(b).toLowerCase()].sort().join("|");

// Teks dibersihkan: tanpa karakter kontrol, dipotong, tidak boleh kosong
function cleanText(text, max) {
  const t = String(text ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r/g, "")
    .trim();
  if (!t) return { error: "Pesan tidak boleh kosong" };
  if (t.length > max) return { error: `Maksimal ${max} karakter` };
  return { text: t };
}

function rateLimited(username, now = Date.now()) {
  const key = String(username).toLowerCase();
  const last = lastSend.get(key) || 0;
  if (now - last < SEND_GAP_MS) return true;
  lastSend.set(key, now);
  return false;
}

function isMember(g, u) { return g.members.some(m => same(m, u)); }
function isGroupAdmin(g, acc) {
  return acc.role === "owner" || g.admins.some(a => same(a, acc.username));
}
function canSee(g, acc) { return acc.role === "owner" || isMember(g, acc.username); }
function canSend(g, acc) {
  if (!canSee(g, acc)) return false;
  return !g.locked || isGroupAdmin(g, acc);
}

function groupView(g, acc) {
  return {
    id: g.id,
    name: g.name,
    createdBy: g.createdBy,
    admins: g.admins,
    members: g.members,
    locked: g.locked,
    isMember: isMember(g, acc.username),
    isAdmin: isGroupAdmin(g, acc),
    canSend: canSend(g, acc),
    createdAt: g.createdAt
  };
}

function pushMsg(list, msg) {
  list.push(msg);
  if (list.length > MAX_MSG) list.splice(0, list.length - MAX_MSG);
}

// Menempelkan lencana terbaru pengirim ke setiap item (dibaca dari akun saat ini)
function decorate(list, key) {
  const bm = badgeMap();
  return list.map(x => ({ ...x, badges: bm.get(String(x[key]).toLowerCase()) || [] }));
}

function sinceFilter(list, since) {
  const s = Number(since) || 0;
  return list.filter(m => m.ts > s).slice(-100);
}

module.exports = function registerSocial(app, { requireAccount }) {
  // ---------- MEMBER ----------
  app.get("/api/social/members", requireAccount, (req, res) => {
    const list = getAccounts()
      .map(a => ({ username: a.username, role: a.role, badges: badgeLib.resolve(a.badges) }))
      .sort((a, b) => a.username.localeCompare(b.username));
    res.json({ success: true, data: list });
  });

  // ---------- GRUP ----------
  app.get("/api/groups", requireAccount, (req, res) => {
    const d = load();
    const acc = req.account;
    const mine = d.groups
      .filter(g => isMember(g, acc.username))
      .map(g => {
        const msgs = d.gmsgs[g.id] || [];
        const last = msgs[msgs.length - 1];
        return { id: g.id, name: g.name, locked: g.locked, members: g.members.length,
          isAdmin: isGroupAdmin(g, acc), lastTs: last ? last.ts : g.createdAt, lastFrom: last ? last.from : null };
      })
      .sort((a, b) => b.lastTs - a.lastTs);
    res.json({ success: true, data: mine });
  });

  app.post("/api/groups", requireAccount, (req, res) => {
    const acc = req.account;
    const name = cleanText((req.body || {}).name, MAX_GROUP_NAME);
    if (name.error) return res.status(400).json({ success: false, error: "Nama grup: " + name.error });

    const wanted = Array.isArray((req.body || {}).members) ? req.body.members : [];
    const members = [acc.username];
    for (const u of wanted) {
      const target = findByUsername(String(u || ""));
      if (!target) return res.status(400).json({ success: false, error: `Member "${u}" tidak ditemukan` });
      if (!members.some(m => same(m, target.username))) members.push(target.username);
    }
    if (members.length > MAX_GROUP_MEMBERS) return res.status(400).json({ success: false, error: `Maksimal ${MAX_GROUP_MEMBERS} anggota` });

    const d = load();
    const g = {
      id: crypto.randomBytes(5).toString("hex"),
      name: name.text,
      createdBy: acc.username,
      admins: [acc.username],
      members,
      locked: false,
      createdAt: Date.now()
    };
    d.groups.push(g);
    if (!save(d)) return res.status(500).json({ success: false, error: "Gagal simpan grup" });
    res.json({ success: true, data: groupView(g, acc) });
  });

  function withGroup(req, res, next) {
    const d = load();
    const g = d.groups.find(x => x.id === req.params.id);
    if (!g || !canSee(g, req.account)) return res.status(404).json({ success: false, error: "Grup tidak ditemukan" });
    req.dd = d; req.group = g;
    next();
  }
  function requireGroupAdmin(req, res, next) {
    if (!isGroupAdmin(req.group, req.account)) return res.status(403).json({ success: false, error: "Hanya admin grup" });
    next();
  }

  app.get("/api/groups/:id", requireAccount, withGroup, (req, res) => {
    res.json({ success: true, data: groupView(req.group, req.account) });
  });

  // Tambah / keluarkan anggota. Anggota boleh keluar sendiri (kecuali pembuat).
  app.post("/api/groups/:id/members", requireAccount, withGroup, (req, res) => {
    const acc = req.account;
    const g = req.group;
    const { username, action } = req.body || {};
    const target = findByUsername(String(username || ""));
    if (!target) return res.status(400).json({ success: false, error: "Akun tidak ditemukan" });
    const self = same(target.username, acc.username);

    if (action === "add") {
      if (!isGroupAdmin(g, acc)) return res.status(403).json({ success: false, error: "Hanya admin grup" });
      if (isMember(g, target.username)) return res.status(400).json({ success: false, error: "Sudah jadi anggota" });
      if (g.members.length >= MAX_GROUP_MEMBERS) return res.status(400).json({ success: false, error: `Maksimal ${MAX_GROUP_MEMBERS} anggota` });
      g.members.push(target.username);
    } else if (action === "remove") {
      if (!isMember(g, target.username)) return res.status(400).json({ success: false, error: "Bukan anggota grup" });
      if (same(target.username, g.createdBy)) return res.status(400).json({ success: false, error: "Pembuat grup tidak bisa dikeluarkan" });
      if (!self && !isGroupAdmin(g, acc)) return res.status(403).json({ success: false, error: "Hanya admin grup" });
      g.members = g.members.filter(m => !same(m, target.username));
      g.admins = g.admins.filter(a => !same(a, target.username));
    } else {
      return res.status(400).json({ success: false, error: "action harus add atau remove" });
    }
    if (!save(req.dd)) return res.status(500).json({ success: false, error: "Gagal simpan" });
    res.json({ success: true, data: groupView(g, acc) });
  });

  // Jadikan / cabut admin grup
  app.post("/api/groups/:id/admin", requireAccount, withGroup, requireGroupAdmin, (req, res) => {
    const g = req.group;
    const { username, admin } = req.body || {};
    if (!isMember(g, username)) return res.status(400).json({ success: false, error: "Hanya anggota yang bisa jadi admin" });
    if (same(username, g.createdBy) && !admin) return res.status(400).json({ success: false, error: "Pembuat grup selalu admin" });
    g.admins = g.admins.filter(a => !same(a, username));
    if (admin) g.admins.push(username);
    if (!save(req.dd)) return res.status(500).json({ success: false, error: "Gagal simpan" });
    res.json({ success: true, data: groupView(g, req.account) });
  });

  // Tutup / buka grup. Saat tertutup, hanya admin yang bisa kirim pesan.
  app.post("/api/groups/:id/lock", requireAccount, withGroup, requireGroupAdmin, (req, res) => {
    req.group.locked = !!(req.body || {}).locked;
    if (!save(req.dd)) return res.status(500).json({ success: false, error: "Gagal simpan" });
    res.json({ success: true, data: groupView(req.group, req.account) });
  });

  app.delete("/api/groups/:id", requireAccount, withGroup, (req, res) => {
    const acc = req.account;
    if (!(same(acc.username, req.group.createdBy) || acc.role === "owner")) {
      return res.status(403).json({ success: false, error: "Hanya pembuat grup yang bisa menghapus" });
    }
    req.dd.groups = req.dd.groups.filter(g => g.id !== req.group.id);
    delete req.dd.gmsgs[req.group.id];
    if (!save(req.dd)) return res.status(500).json({ success: false, error: "Gagal simpan" });
    res.json({ success: true });
  });

  app.get("/api/groups/:id/messages", requireAccount, withGroup, (req, res) => {
    const list = req.dd.gmsgs[req.group.id] || [];
    res.json({ success: true, data: decorate(sinceFilter(list, req.query.since), "from") });
  });

  app.post("/api/groups/:id/messages", requireAccount, withGroup, (req, res) => {
    const acc = req.account;
    const g = req.group;
    if (!isMember(g, acc.username) && acc.role !== "owner") return res.status(403).json({ success: false, error: "Kamu bukan anggota grup ini" });
    if (g.locked && !isGroupAdmin(g, acc)) return res.status(403).json({ success: false, error: "Grup sedang ditutup. Hanya admin yang bisa kirim pesan." });
    const t = cleanText((req.body || {}).text, MAX_TEXT);
    if (t.error) return res.status(400).json({ success: false, error: t.error });
    if (rateLimited(acc.username)) return res.status(429).json({ success: false, error: "Pelan-pelan, tunggu sebentar" });

    const msg = { id: crypto.randomBytes(6).toString("hex"), from: acc.username, role: acc.role, text: t.text, ts: Date.now() };
    req.dd.gmsgs[g.id] = req.dd.gmsgs[g.id] || [];
    pushMsg(req.dd.gmsgs[g.id], msg);
    if (!save(req.dd)) return res.status(500).json({ success: false, error: "Gagal simpan pesan" });
    res.json({ success: true, data: decorate([msg], "from")[0] });
  });

  // ---------- CHAT PRIBADI (antar member) ----------
  app.get("/api/dm", requireAccount, (req, res) => {
    const d = load();
    const me = req.account.username;
    const threads = [];
    for (const [key, list] of Object.entries(d.dms)) {
      const parts = key.split("|");
      if (!parts.includes(me.toLowerCase())) continue;
      const last = list[list.length - 1];
      if (!last) continue;
      const other = same(last.from, me) ? last.to : last.from;
      threads.push({ username: other, lastTs: last.ts, lastText: last.text });
    }
    threads.sort((a, b) => b.lastTs - a.lastTs);
    res.json({ success: true, data: decorate(threads, "username") });
  });

  app.get("/api/dm/:username", requireAccount, (req, res) => {
    const target = findByUsername(req.params.username);
    if (!target) return res.status(404).json({ success: false, error: "Akun tidak ditemukan" });
    const d = load();
    const list = d.dms[dmKey(req.account.username, target.username)] || [];
    res.json({ success: true, data: decorate(sinceFilter(list, req.query.since), "from") });
  });

  app.post("/api/dm/:username", requireAccount, (req, res) => {
    const acc = req.account;
    const target = findByUsername(req.params.username);
    if (!target) return res.status(404).json({ success: false, error: "Akun tidak ditemukan" });
    if (same(target.username, acc.username)) return res.status(400).json({ success: false, error: "Tidak bisa chat diri sendiri" });
    const t = cleanText((req.body || {}).text, MAX_TEXT);
    if (t.error) return res.status(400).json({ success: false, error: t.error });
    if (rateLimited(acc.username)) return res.status(429).json({ success: false, error: "Pelan-pelan, tunggu sebentar" });

    const d = load();
    const key = dmKey(acc.username, target.username);
    d.dms[key] = d.dms[key] || [];
    const msg = { id: crypto.randomBytes(6).toString("hex"), from: acc.username, to: target.username, role: acc.role, text: t.text, ts: Date.now() };
    pushMsg(d.dms[key], msg);
    if (!save(d)) return res.status(500).json({ success: false, error: "Gagal simpan pesan" });
    res.json({ success: true, data: decorate([msg], "from")[0] });
  });

  // ---------- STATUS (24 jam, teks + warna latar) ----------
  app.get("/api/status", requireAccount, (req, res) => {
    const d = load();
    pruneStatus(d);
    const byOwner = new Map();
    for (const s of d.status) {
      if (!byOwner.has(s.owner)) byOwner.set(s.owner, { owner: s.owner, role: s.role, items: [] });
      byOwner.get(s.owner).items.push({ id: s.id, text: s.text, bg: s.bg, ts: s.ts });
    }
    const bm = badgeMap();
    const list = [...byOwner.values()].map(o => {
      o.items.sort((a, b) => a.ts - b.ts);
      o.lastTs = o.items[o.items.length - 1].ts;
      o.mine = same(o.owner, req.account.username);
      o.badges = bm.get(String(o.owner).toLowerCase()) || [];
      return o;
    }).sort((a, b) => (b.mine - a.mine) || (b.lastTs - a.lastTs));
    res.json({ success: true, data: { list, colors: STATUS_COLORS } });
  });

  app.post("/api/status", requireAccount, (req, res) => {
    const acc = req.account;
    const body = req.body || {};
    const t = cleanText(body.text, STATUS_TEXT_MAX);
    if (t.error) return res.status(400).json({ success: false, error: "Status: " + t.error });
    const bg = STATUS_COLORS.includes(body.bg) ? body.bg : STATUS_COLORS[0];

    const d = load();
    pruneStatus(d);
    const mine = d.status.filter(s => same(s.owner, acc.username)).length;
    if (mine >= MAX_STATUS_PER_USER) return res.status(400).json({ success: false, error: `Maksimal ${MAX_STATUS_PER_USER} status aktif` });
    const item = { id: crypto.randomBytes(6).toString("hex"), owner: acc.username, role: acc.role, text: t.text, bg, ts: Date.now() };
    d.status.push(item);
    if (!save(d)) return res.status(500).json({ success: false, error: "Gagal simpan status" });
    res.json({ success: true, data: item });
  });

  app.delete("/api/status/:id", requireAccount, (req, res) => {
    const acc = req.account;
    const d = load();
    const item = d.status.find(s => s.id === req.params.id);
    if (!item) return res.status(404).json({ success: false, error: "Status tidak ditemukan" });
    if (!(same(item.owner, acc.username) || acc.role === "owner")) return res.status(403).json({ success: false, error: "Bukan status kamu" });
    d.status = d.status.filter(s => s.id !== item.id);
    if (!save(d)) return res.status(500).json({ success: false, error: "Gagal simpan" });
    res.json({ success: true });
  });
};

module.exports.STATUS_COLORS = STATUS_COLORS;
