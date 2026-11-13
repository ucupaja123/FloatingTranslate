// ============================================================
//      KUOTA DENGERIN (lagu) PER ROLE + BONUS BELI
//      user      : 3 lagu / hari
//      premium   : 8 lagu / bulan
//      reseller  : 15 lagu / hari
//      admin     : 25 lagu / hari
//      owner     : tanpa batas
//      Reset mengikuti waktu Jakarta (WIB): harian tiap 00:00, bulanan tiap tanggal 1 00:00.
//      Bonus hasil beli TIDAK hangus; dipakai setelah kuota periode ini habis.
// ============================================================
const fs = require("fs");
const path = require("path");

// Batas lagu per periode. Owner tanpa batas (Infinity).
const LISTEN_LIMITS = {
  user: 3,
  premium: 8,
  reseller: 15,
  admin: 25,
  owner: Infinity
};

// Periode reset per role: "day" (harian) atau "month" (bulanan)
const LISTEN_PERIODS = {
  user: "day",
  premium: "month",
  reseller: "day",
  admin: "day",
  owner: "day"
};

// Lagu yang sama dari akun yang sama dalam jendela ini hanya dihitung sekali.
// Ini mencakup prefetch lagu berikutnya dan ulang URL saat koneksi putus
// (lagu panjang tetap aman karena jendela 30 menit).
const DEDUPE_MS = 30 * 60 * 1000;

const DATA_DIR = path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "listens.json");
const BONUS_FILE = path.join(DATA_DIR, "listen-bonus.json");

const JKT_OFFSET = 7 * 3600 * 1000;   // WIB = UTC+7, tanpa daylight saving
const DAY_MS = 24 * 3600 * 1000;

function jakartaParts(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(now));
  const get = (t) => parts.find(p => p.type === t).value;
  return { y: Number(get("year")), m: Number(get("month")), d: get("day") };
}

function periodOf(role) {
  return Object.prototype.hasOwnProperty.call(LISTEN_PERIODS, role) ? LISTEN_PERIODS[role] : "day";
}

// Kunci periode: "2026-11-04" untuk harian, "2026-11" untuk bulanan
function periodKey(period, now = Date.now()) {
  const p = jakartaParts(now);
  const mm = String(p.m).padStart(2, "0");
  return period === "month" ? `${p.y}-${mm}` : `${p.y}-${mm}-${p.d}`;
}

// Waktu reset berikutnya (ms), tepat jam 00:00 WIB
function nextResetAt(period, now = Date.now()) {
  if (period === "month") {
    const p = jakartaParts(now);
    const ny = p.m === 12 ? p.y + 1 : p.y;
    const nm = p.m === 12 ? 1 : p.m + 1;
    return Date.UTC(ny, nm - 1, 1) - JKT_OFFSET;
  }
  return (Math.floor((now + JKT_OFFSET) / DAY_MS) + 1) * DAY_MS - JKT_OFFSET;
}

function limitFor(role) {
  return Object.prototype.hasOwnProperty.call(LISTEN_LIMITS, role) ? LISTEN_LIMITS[role] : LISTEN_LIMITS.user;
}

function readJsonFile(file) {
  try {
    if (!fs.existsSync(file)) return {};
    const raw = fs.readFileSync(file, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}

// Tulis ke file sementara lalu ganti, supaya file tidak rusak jika proses berhenti di tengah
function writeJsonFile(file, data) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  } catch (e) { console.error("listen quota save error:", e.message); }
}

function load() { return readJsonFile(FILE); }
function save(data) { writeJsonFile(FILE, data); }

// Catatan periode ini untuk satu user. Periode lama dianggap kosong.
function currentRecord(all, username, role, now) {
  const key = periodKey(periodOf(role), now);
  const rec = all[username];
  if (!rec || rec.key !== key) return { key, count: 0, lastVid: null, lastAt: 0 };
  return rec;
}

function view(used, limit) {
  return { used, limit: limit === Infinity ? null : limit };
}

// ---------- bonus (hasil beli) ----------
function bonusOf(username) {
  const n = Number(readJsonFile(BONUS_FILE)[username]);
  return n > 0 ? Math.floor(n) : 0;
}

// Tambah bonus lagu untuk satu user. Dipanggil saat pesanan disetujui owner.
function addBonus(username, amount) {
  const all = readJsonFile(BONUS_FILE);
  all[username] = bonusOf(username) + Math.max(0, Math.floor(Number(amount) || 0));
  writeJsonFile(BONUS_FILE, all);
  return all[username];
}

function consumeBonus(username) {
  const all = readJsonFile(BONUS_FILE);
  const n = bonusOf(username);
  if (n <= 0) return false;
  all[username] = n - 1;
  writeJsonFile(BONUS_FILE, all);
  return true;
}

// Cek saja, tanpa mencatat. Dipakai di awal permintaan supaya tidak
// memanggil sumber audio kalau kuota sudah habis.
function peek(username, role, videoId, now = Date.now()) {
  const rec = currentRecord(load(), username, role, now);
  const limit = limitFor(role);
  const dup = rec.lastVid === videoId && now - rec.lastAt < DEDUPE_MS;
  const bonus = bonusOf(username);
  return { allowed: dup || rec.count < limit || bonus > 0, counted: false, bonus, ...view(rec.count, limit) };
}

// Catat satu lagu. Pengecekan dan penambahan terjadi dalam satu langkah sinkron,
// jadi dua permintaan bersamaan tidak bisa melewati batas.
// Urutan: kuota periode dulu, lalu bonus.
function claim(username, role, videoId, now = Date.now()) {
  const all = load();
  const rec = currentRecord(all, username, role, now);
  const limit = limitFor(role);

  if (rec.lastVid === videoId && now - rec.lastAt < DEDUPE_MS) {
    rec.lastAt = now;
    all[username] = rec;
    save(all);
    return { allowed: true, counted: false, fromBonus: false, bonus: bonusOf(username), ...view(rec.count, limit) };
  }

  let fromBonus = false;
  if (rec.count < limit) {
    rec.count += 1;
  } else if (consumeBonus(username)) {
    fromBonus = true;
  } else {
    return { allowed: false, counted: false, fromBonus: false, bonus: 0, ...view(rec.count, limit) };
  }

  rec.lastVid = videoId;
  rec.lastAt = now;
  all[username] = rec;
  save(all);
  return { allowed: true, counted: true, fromBonus, bonus: bonusOf(username), ...view(rec.count, limit) };
}

// Untuk tampilan sisa kuota
function status(username, role, now = Date.now()) {
  const period = periodOf(role);
  const rec = currentRecord(load(), username, role, now);
  return {
    period,
    resetsAt: nextResetAt(period, now),
    bonus: bonusOf(username),
    ...view(rec.count, limitFor(role))
  };
}

module.exports = { LISTEN_LIMITS, LISTEN_PERIODS, DEDUPE_MS, periodOf, periodKey, nextResetAt, peek, claim, status, addBonus, bonusOf };
