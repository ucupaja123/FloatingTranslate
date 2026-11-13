// ============================================================
//      LENCANA: gambar di samping nama (centang biru, logo, dll)
//      Setiap file gambar di public/badges/ = satu lencana.
//      Owner bisa menambah (upload) dan menghapus dari aplikasi.
//      Lencana bawaan "verified" (centang biru) tidak bisa dihapus.
// ============================================================
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "public", "badges");
const DATA_DIR = path.join(__dirname, "data");
const META_FILE = path.join(DATA_DIR, "badges.json"); // { id: label }

const MAX_BADGES = 10;                // lencana per akun
const MAX_UPLOAD_BYTES = 300 * 1024;  // ukuran gambar setelah didecode
const PROTECTED = ["verified"];
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,23}$/;
const FILE_RE = /^([a-z0-9][a-z0-9_-]{0,23})\.(png|jpg|webp|gif|svg)$/;
const EXT_BY_MIME = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const DEFAULT_LABELS = { verified: "Terverifikasi" };
const SHIPPED_LABELS_FILE = path.join(DIR, "labels.json");  // nama bawaan logo (ikut zip)

function readShippedLabels() {
  try {
    const obj = JSON.parse(fs.readFileSync(SHIPPED_LABELS_FILE, "utf8"));
    return obj && typeof obj === "object" ? obj : {};
  } catch (e) { return {}; }
}

function readMeta() {
  try {
    const raw = fs.readFileSync(META_FILE, "utf8");
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch (e) { return {}; }
}

function writeMeta(obj) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = META_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, META_FILE);
    return true;
  } catch (e) { console.error("badges save error:", e.message); return false; }
}

// Daftar lencana dari file yang ada sekarang: [{ id, label, src }]
function catalog() {
  let files = [];
  try { files = fs.readdirSync(DIR).sort(); } catch (e) {}
  const meta = readMeta();
  const shipped = readShippedLabels();
  const seen = new Map();
  for (const f of files) {
    const m = FILE_RE.exec(f);
    if (!m || seen.has(m[1])) continue;
    let mtime = 0;
    try { mtime = Math.floor(fs.statSync(path.join(DIR, f)).mtimeMs); } catch (e) {}
    const id = m[1];
    seen.set(id, { id, label: meta[id] || shipped[id] || DEFAULT_LABELS[id] || id, src: `/badges/${f}?v=${mtime}` });
  }
  return [...seen.values()].sort((a, b) => (PROTECTED.includes(b.id) - PROTECTED.includes(a.id)) || a.label.localeCompare(b.label));
}

// Hanya id yang filenya masih ada; tanpa duplikat; maksimal MAX_BADGES
function cleanIds(list, cat = catalog()) {
  const known = new Set(cat.map(b => b.id));
  const arr = Array.isArray(list) ? list : [];
  return [...new Set(arr.map(x => String(x || "").toLowerCase()))].filter(id => known.has(id)).slice(0, MAX_BADGES);
}

// Ubah daftar id tersimpan menjadi objek lencana lengkap (untuk ditampilkan)
function resolve(ids, cat = catalog()) {
  const byId = new Map(cat.map(b => [b.id, b]));
  const arr = Array.isArray(ids) ? ids : [];
  return [...new Set(arr.map(x => String(x || "")))].map(id => byId.get(id)).filter(Boolean).slice(0, MAX_BADGES);
}

function magicOk(mime, buf) {
  if (mime === "image/png") return buf.length > 8 && buf.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (mime === "image/jpeg") return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (mime === "image/gif") return buf.length > 4 && buf.slice(0, 4).toString("latin1") === "GIF8";
  if (mime === "image/webp") return buf.length > 12 && buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP";
  return false;
}

function existingFiles(id) {
  try { return fs.readdirSync(DIR).filter(f => FILE_RE.exec(f) && FILE_RE.exec(f)[1] === id); } catch (e) { return []; }
}

// Upload dari aplikasi. dataUrl = "data:image/png;base64,...."
function saveUpload({ name, label, dataUrl }) {
  const id = String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!ID_RE.test(id)) return { error: "Nama lencana: huruf/angka, maksimal 24 karakter" };
  if (PROTECTED.includes(id)) return { error: "Nama itu dipakai lencana bawaan" };
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) return { error: "Gambar harus PNG, JPG, WEBP, atau GIF" };
  const buf = Buffer.from(m[2], "base64");
  if (!buf.length || buf.length > MAX_UPLOAD_BYTES) return { error: "Ukuran gambar maksimal 300 KB" };
  if (!magicOk(m[1], buf)) return { error: "File gambar tidak valid" };

  fs.mkdirSync(DIR, { recursive: true });
  for (const f of existingFiles(id)) { try { fs.unlinkSync(path.join(DIR, f)); } catch (e) {} }
  fs.writeFileSync(path.join(DIR, `${id}.${EXT_BY_MIME[m[1]]}`), buf);
  const meta = readMeta();
  meta[id] = String(label || name).trim().slice(0, 24) || id;
  writeMeta(meta);
  return { success: true, data: catalog().find(b => b.id === id) };
}

// Hapus file lencana. Akun yang punya lencana ini juga dibersihkan di account.js
function removeBadge(id) {
  id = String(id || "").toLowerCase();
  if (PROTECTED.includes(id)) return { error: "Lencana bawaan tidak bisa dihapus" };
  const files = existingFiles(id);
  if (!files.length) return { error: "Lencana tidak ditemukan" };
  for (const f of files) { try { fs.unlinkSync(path.join(DIR, f)); } catch (e) {} }
  const meta = readMeta();
  delete meta[id];
  writeMeta(meta);
  return { success: true };
}

module.exports = { MAX_BADGES, catalog, cleanIds, resolve, saveUpload, removeBadge };
