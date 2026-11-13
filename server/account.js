const badgeLib = require("./badges");
// accounts.js — penyimpanan akun, hash password, sesi login, dan aturan role
// Dipakai bersama oleh server web (server.js) dan bot Telegram (bot.js).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("./config");

const filePath = path.resolve(config.accountFile);
const dataDir = path.dirname(filePath);
const sessionFile = path.join(dataDir, "sessions.json");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const ROLES = ["owner", "admin", "reseller", "premium", "user"];

// ============================================================
//  FILE HELPER
// ============================================================
function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8");
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function writeJson(file, data) {
  try {
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);   // tulis ke file sementara dulu supaya tidak rusak kalau mati di tengah
    return true;
  } catch (e) { return false; }
}

// ============================================================
//  HASH PASSWORD (scrypt bawaan Node, tanpa dependensi baru)
//  Format: scrypt$<saltHex>$<hashHex>
//  Akun lama yang masih plaintext tetap bisa login, lalu di-hash otomatis.
// ============================================================
function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(plain), salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}
function isHashed(stored) {
  return typeof stored === "string" && stored.startsWith("scrypt$");
}
function checkPassword(stored, plain) {
  if (typeof stored !== "string" || plain == null) return false;
  const given = String(plain);
  if (!isHashed(stored)) {
    const a = Buffer.from(stored), b = Buffer.from(given);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const [, saltHex, hashHex] = stored.split("$");
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(given, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// ============================================================
//  DATA AKUN
// ============================================================
function getAccounts() {
  const arr = readJson(filePath, []);
  return Array.isArray(arr) ? arr : [];
}
function saveAccounts(arr) { return writeJson(filePath, arr); }

// Lencana disimpan sebagai daftar id. Saat ditampilkan diubah jadi gambar (lihat badges.js).
function publicAccount(a) {
  return { username: a.username, role: a.role, createdBy: a.createdBy, ts: a.ts, badges: badgeLib.resolve(a.badges) };
}

// Peta username(huruf kecil) -> lencana (objek gambar), untuk pesan/status/daftar member
function badgeMap() {
  const cat = badgeLib.catalog();
  const m = new Map();
  for (const a of getAccounts()) m.set(String(a.username).toLowerCase(), badgeLib.resolve(a.badges, cat));
  return m;
}

function seedAccounts() {
  const existing = getAccounts();
  if (existing.length > 0) return existing;
  const seeded = config.seedAccounts.map(a => ({
    username: a.username,
    password: hashPassword(a.password),
    role: a.role,
    createdBy: a.createdBy || "system",
    ts: Date.now()
  }));
  saveAccounts(seeded);
  return seeded;
}

function findByUsername(u) {
  const key = String(u).toLowerCase();
  return getAccounts().find(a => a.username.toLowerCase() === key);
}

function findByCredentials(u, p) {
  const accs = getAccounts();
  const key = String(u).toLowerCase();
  const acc = accs.find(a => a.username.toLowerCase() === key);
  if (!acc || !checkPassword(acc.password, p)) return undefined;
  if (!isHashed(acc.password)) {          // migrasi akun lama: plaintext -> hash
    acc.password = hashPassword(p);
    saveAccounts(accs);
  }
  return acc;
}

function countOwners(accs) { return accs.filter(a => a.role === "owner").length; }

function validateCredentials(username, password) {
  if (!username || !password) return "Username & password wajib";
  if (!config.usernamePattern.test(String(username).trim())) return "Username 2-20 karakter: huruf, angka, _ . -";
  if (String(password).length < config.minPasswordLength) return `Password min ${config.minPasswordLength} karakter`;
  if (String(password).length > 100) return "Password maksimal 100 karakter";
  return null;
}

// createdBy: "system" (seed/bot), "self" (registrasi sendiri, role wajib user),
// atau username pembuat yang harus ada dan punya hak membuat role tersebut.
function createAccount({ username, password, role, createdBy = "system" }) {
  username = String(username || "").trim();
  const err = validateCredentials(username, password);
  if (err) return { success: false, error: err };
  if (!ROLES.includes(role)) return { success: false, error: "Role invalid" };
  if (findByUsername(username)) return { success: false, error: "Username sudah dipakai" };
  const accs = getAccounts();
  if (accs.length >= config.maxAccountsPerBot) return { success: false, error: "Max akun tercapai" };

  if (createdBy === "self") {
    if (role !== "user") return { success: false, error: "Registrasi hanya bisa membuat akun user" };
  } else if (createdBy !== "system") {
    const creator = findByUsername(createdBy);
    if (!creator) return { success: false, error: "Pembuat akun tidak valid" };
    if (!canCreate(creator.username, role)) return { success: false, error: `Role ${creator.role} tidak bisa buat ${role}` };
    const mine = accs.filter(a => a.createdBy && a.createdBy.toLowerCase() === creator.username.toLowerCase());
    if (mine.length >= config.maxAccountsPerUser) return { success: false, error: `Max ${config.maxAccountsPerUser} akun/user` };
  }

  const newAcc = { username, password: hashPassword(password), role, createdBy: String(createdBy), ts: Date.now() };
  accs.push(newAcc);
  if (!saveAccounts(accs)) return { success: false, error: "Gagal simpan" };
  return { success: true, data: newAcc };
}

// Registrasi mandiri dari halaman login: selalu role user.
function registerAccount({ username, password }) {
  return createAccount({ username, password, role: "user", createdBy: "self" });
}

function deleteAccount({ username, requestedBy = "system" }) {
  const accs = getAccounts();
  const idx = accs.findIndex(a => a.username.toLowerCase() === String(username).toLowerCase());
  if (idx === -1) return { success: false, error: "Akun tidak ditemukan" };
  const target = accs[idx];
  if (requestedBy !== "system") {
    const req = findByUsername(requestedBy);
    if (!req) return { success: false, error: "Requester invalid" };
    if (req.username.toLowerCase() === target.username.toLowerCase()) return { success: false, error: "Tidak bisa hapus akun sendiri" };
    const isCreator = target.createdBy && target.createdBy.toLowerCase() === req.username.toLowerCase();
    if (req.role !== "owner" && !isCreator) return { success: false, error: "Tidak punya izin" };
    if (target.role === "owner" && req.role !== "owner") return { success: false, error: "Tidak punya izin hapus owner" };
  }
  if (target.role === "owner" && countOwners(accs) <= 1) return { success: false, error: "Tidak bisa menghapus owner terakhir" };
  accs.splice(idx, 1);
  if (!saveAccounts(accs)) return { success: false, error: "Gagal simpan" };
  revokeSessions(target.username);
  return { success: true };
}

// Reset password oleh owner / pembuat akun (bukan untuk akun sendiri).
function updatePassword({ username, newPassword, requestedBy = "system" }) {
  if (!newPassword || String(newPassword).length < config.minPasswordLength) return { success: false, error: `Password min ${config.minPasswordLength} karakter` };
  const accs = getAccounts();
  const target = accs.find(a => a.username.toLowerCase() === String(username).toLowerCase());
  if (!target) return { success: false, error: "Akun tidak ditemukan" };
  if (requestedBy !== "system") {
    const req = findByUsername(requestedBy);
    if (!req) return { success: false, error: "Requester invalid" };
    if (req.username.toLowerCase() === target.username.toLowerCase()) return { success: false, error: "Untuk akun sendiri, pakai menu Ganti Password" };
    const isCreator = target.createdBy && target.createdBy.toLowerCase() === req.username.toLowerCase();
    if (req.role !== "owner" && !isCreator) return { success: false, error: "Tidak punya izin" };
    if (target.role === "owner" && req.role !== "owner") return { success: false, error: "Tidak punya izin" };
  }
  target.password = hashPassword(newPassword);
  if (!saveAccounts(accs)) return { success: false, error: "Gagal simpan" };
  revokeSessions(target.username);
  return { success: true };
}

// Ganti password sendiri: wajib password lama.
function changeOwnPassword({ username, oldPassword, newPassword }) {
  const accs = getAccounts();
  const target = accs.find(a => a.username.toLowerCase() === String(username).toLowerCase());
  if (!target) return { success: false, error: "Akun tidak ditemukan" };
  if (!checkPassword(target.password, oldPassword)) return { success: false, error: "Password lama salah" };
  if (!newPassword || String(newPassword).length < config.minPasswordLength) return { success: false, error: `Password baru min ${config.minPasswordLength} karakter` };
  if (String(newPassword).length > 100) return { success: false, error: "Password maksimal 100 karakter" };
  if (checkPassword(target.password, newPassword)) return { success: false, error: "Password baru harus berbeda dari yang lama" };
  target.password = hashPassword(newPassword);
  if (!saveAccounts(accs)) return { success: false, error: "Gagal simpan" };
  return { success: true };
}

// Atur lencana satu akun. Hanya owner. Daftar lencana menggantikan yang lama.
function setAccountBadges({ username, badges, requestedBy }) {
  const req = findByUsername(requestedBy);
  if (!req || req.role !== "owner") return { success: false, error: "Hanya owner yang bisa atur lencana" };
  const accs = getAccounts();
  const target = accs.find(a => a.username.toLowerCase() === String(username).toLowerCase());
  if (!target) return { success: false, error: "Akun tidak ditemukan" };
  target.badges = badgeLib.cleanIds(badges);
  if (!saveAccounts(accs)) return { success: false, error: "Gagal simpan" };
  return { success: true, data: publicAccount(target) };
}

// Lencana yang filenya dihapus: lepaskan dari semua akun
function stripBadge(id) {
  id = String(id || "").toLowerCase();
  const accs = getAccounts();
  let changed = false;
  for (const a of accs) {
    if (Array.isArray(a.badges) && a.badges.some(x => String(x).toLowerCase() === id)) {
      a.badges = a.badges.filter(x => String(x).toLowerCase() !== id);
      changed = true;
    }
  }
  if (changed) saveAccounts(accs);
  return true;
}

// Ubah role (naik/turun level). Hanya owner.
function setAccountRole({ username, role, requestedBy }) {
  if (!ROLES.includes(role)) return { success: false, error: "Role invalid" };
  const req = findByUsername(requestedBy);
  if (!req || req.role !== "owner") return { success: false, error: "Hanya owner yang bisa ubah role" };
  const accs = getAccounts();
  const target = accs.find(a => a.username.toLowerCase() === String(username).toLowerCase());
  if (!target) return { success: false, error: "Akun tidak ditemukan" };
  if (target.username.toLowerCase() === req.username.toLowerCase()) return { success: false, error: "Tidak bisa ubah role akun sendiri" };
  if (target.role === role) return { success: true, data: publicAccount(target) };
  if (target.role === "owner" && role !== "owner" && countOwners(accs) <= 1) return { success: false, error: "Owner terakhir tidak bisa diturunkan" };
  target.role = role;
  if (!saveAccounts(accs)) return { success: false, error: "Gagal simpan" };
  return { success: true, data: publicAccount(target) };
}

function listAccountsBy(creator) {
  const accs = getAccounts();
  if (!creator || creator === "system") return accs;
  return accs.filter(a => a.createdBy && a.createdBy.toLowerCase() === String(creator).toLowerCase());
}
function listAllAccounts() { return getAccounts(); }

function canCreate(creator, targetRole) {
  const c = findByUsername(creator);
  if (!c) return false;
  return (config.roleHierarchy[c.role] || []).includes(targetRole);
}
function getAvailableRoles(creator) {
  const c = findByUsername(creator);
  if (!c) return [];
  return config.roleHierarchy[c.role] || [];
}
function getStats() {
  const accs = getAccounts();
  const byRole = { owner: 0, admin: 0, reseller: 0, premium: 0, user: 0 };
  accs.forEach(a => { if (byRole[a.role] !== undefined) byRole[a.role]++; });
  return { total: accs.length, byRole };
}

// ============================================================
//  SESI LOGIN (token acak, hanya hash-nya yang disimpan)
// ============================================================
function tokenKey(token) { return crypto.createHash("sha256").update(String(token)).digest("hex"); }

function loadSessions() {
  const s = readJson(sessionFile, {});
  const now = Date.now();
  for (const k of Object.keys(s)) if (!s[k] || s[k].exp < now) delete s[k];
  return s;
}

function createSession(username) {
  const token = crypto.randomBytes(32).toString("hex");
  const s = loadSessions();
  s[tokenKey(token)] = { username, exp: Date.now() + config.sessionDays * 24 * 3600 * 1000 };
  writeJson(sessionFile, s);
  return token;
}

// Mengembalikan akun dari token. Kalau akun sudah dihapus, sesinya ikut tidak berlaku.
function getSessionAccount(token) {
  if (!token) return null;
  const sess = loadSessions()[tokenKey(token)];
  if (!sess) return null;
  return findByUsername(sess.username) || null;
}

function destroySession(token) {
  if (!token) return;
  const s = loadSessions();
  delete s[tokenKey(token)];
  writeJson(sessionFile, s);
}

// Cabut semua sesi akun tertentu, kecuali satu token (perangkat yang sedang dipakai).
function revokeSessions(username, keepToken) {
  const s = loadSessions();
  const keep = keepToken ? tokenKey(keepToken) : null;
  const who = String(username).toLowerCase();
  for (const [k, v] of Object.entries(s)) {
    if (k !== keep && String(v.username).toLowerCase() === who) delete s[k];
  }
  writeJson(sessionFile, s);
}

seedAccounts();

module.exports = {
  ROLES, publicAccount, badgeMap, setAccountBadges, stripBadge,
  getAccounts, saveAccounts, seedAccounts,
  findByUsername, findByCredentials, hashPassword, checkPassword,
  createAccount, registerAccount, deleteAccount, updatePassword, changeOwnPassword, setAccountRole,
  listAccountsBy, listAllAccounts, canCreate, getAvailableRoles, getStats,
  createSession, getSessionAccount, destroySession, revokeSessions
};
