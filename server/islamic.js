// ============================================================
//  ISLAMIC: Jadwal Shalat + Al-Quran Digital
//  Sumber utama: api.myquran.com v3 (data Kemenag RI, stabil untuk Indonesia)
//  Sumber cadangan: AlAdhan (butuh koordinat)
// ============================================================
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const cache = new Map();
function getCache(key) {
  const e = cache.get(key);
  if (e && e.exp > Date.now()) return e.v;
  cache.delete(key);
  return null;
}
function setCache(key, value, ttlMs) {
  if (cache.size > 600) cache.delete(cache.keys().next().value);
  cache.set(key, { v: value, exp: Date.now() + ttlMs });
}

const UA = { "User-Agent": "Mozilla/5.0", Accept: "application/json" };
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// ============ SUMBER UTAMA: api.myquran.com v3 ============
// (bisa diganti lewat env MYQURAN_BASE, dipakai untuk tes)
const MYQURAN = (process.env.MYQURAN_BASE || "https://api.myquran.com/v3").replace(/\/+$/, "");

// Nama kota dari daftar aplikasi -> nama yang cocok di MyQuran (tanpa "kota"/"kab")
function normKota(s) {
  return String(s || "").toLowerCase().replace(/\b(kota|kabupaten|kab\.?)\b/g, " ").replace(/\s+/g, " ").trim();
}

// Cari ID kota/kabupaten. Hasil di-cache 30 hari (ID kota tidak berubah).
async function cariKotaMyQuran(namaKota) {
  const key = "myq:kota:" + normKota(namaKota);
  const hit = getCache(key);
  if (hit) return hit;

  const { data } = await axios.get(`${MYQURAN}/sholat/kabkota/cari/${encodeURIComponent(namaKota)}`, {
    timeout: 10000,
    headers: UA
  });
  const list = Array.isArray(data && data.data) ? data.data : [];
  if (list.length === 0) throw new Error("Kota tidak ditemukan");

  // Pilih yang namanya paling cocok; kalau tidak ada, ambil hasil pertama
  const target = normKota(namaKota);
  const best = list.find(x => normKota(x.lokasi) === target)
    || list.find(x => normKota(x.lokasi).includes(target))
    || list[0];
  const id = String(best.id);
  setCache(key, id, 30 * DAY);
  return id;
}

// Ambil jadwal 1 hari. tz wajib dikirim supaya jam sesuai zona kota (WIB/WITA/WIT).
async function fetchTimingsMyQuran(idKota, tanggal, tz) {
  const { data } = await axios.get(`${MYQURAN}/sholat/jadwal/${idKota}/${tanggal}`, {
    params: { tz },
    timeout: 15000,
    headers: UA
  });
  return data;
}

// Terima beberapa bentuk respons (objek tunggal, objek di dalam "jadwal", atau array)
function pickJadwal(payload, tanggal) {
  let body = payload && payload.data !== undefined ? payload.data : payload;
  if (Array.isArray(body)) {
    body = body.find(x => x && (x.tanggal === tanggal || x.date === tanggal)) || body[0];
  }
  const j = (body && body.jadwal) ? body.jadwal : body;
  if (!j || typeof j !== "object" || !(j.subuh || j.dzuhur || j.Subuh || j.Dzuhur)) {
    throw new Error("Respon MyQuran tidak valid");
  }
  return j;
}

// ============ SUMBER CADANGAN: AlAdhan ============
async function fetchTimingsAlAdhan(lat, lng, date, method) {
  const { data } = await axios.get(`https://api.aladhan.com/v1/timings/${date}`, {
    params: { latitude: lat, longitude: lng, method },
    timeout: 15000,
    headers: UA,
    maxRedirects: 5
  });
  if (!data || data.code !== 200 || !data.data || !data.data.timings)
    throw new Error("Respon AlAdhan tidak valid");
  return data.data;
}

// DD-MM-YYYY -> YYYY-MM-DD
function toISO(dateDDMMYYYY) {
  const [d, m, y] = dateDDMMYYYY.split("-");
  return `${y}-${m}-${d}`;
}

// Format keluaran seragam untuk semua sumber.
// gregorian WAJIB DD-MM-YYYY: frontend membandingkannya dengan tanggal hari ini (lihat index.html).
function normalizeMyQuran(j, date, tz) {
  const pick = (...keys) => {
    for (const k of keys) if (j[k] != null && j[k] !== "") return String(j[k]).slice(0, 5);
    return "";
  };
  return {
    timings: {
      Imsak: pick("imsak", "Imsak"),
      Fajr: pick("subuh", "Subuh"),
      Sunrise: pick("terbit", "Terbit"),
      Dhuhr: pick("dzuhur", "Dzuhur", "dhuhur"),
      Asr: pick("ashar", "Ashar"),
      Maghrib: pick("maghrib", "Maghrib"),
      Isha: pick("isya", "Isya")
    },
    hijri: "",
    gregorian: date,
    timezone: tz || "Asia/Jakarta"
  };
}

module.exports = function registerIslamic(app) {
  // ---------- JADWAL SHALAT ----------
  // GET /api/sholat?lat=-6.2&lng=106.8&date=04-11-2026&kota=Jakarta&tz=Asia/Jakarta
  // kota & tz dipakai sumber utama (MyQuran). lat & lng dipakai sumber cadangan (AlAdhan).
  app.get("/api/sholat", async (req, res) => {
    const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
    const date = String(req.query.date || "");
    const kota = String(req.query.kota || "").trim().slice(0, 60);
    const tzRaw = String(req.query.tz || "Asia/Jakarta");
    const tz = /^[A-Za-z_]+\/[A-Za-z_]+$/.test(tzRaw) ? tzRaw : "Asia/Jakarta";

    if (!/^\d{2}-\d{2}-\d{4}$/.test(date))
      return res.status(400).json({ success: false, error: "Format tanggal harus DD-MM-YYYY" });

    const koordinatValid = isFinite(lat) && isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    if (!kota && !koordinatValid)
      return res.status(400).json({ success: false, error: "Kirim kota atau koordinat (lat & lng)" });

    const key = `sholat:${kota}|${tz}|${koordinatValid ? lat.toFixed(2) + "," + lng.toFixed(2) : "-"}|${date}`;
    const hit = getCache(key);
    if (hit) return res.json({ success: true, cached: true, source: hit.source, data: hit.data });

    // ==== SUMBER UTAMA: MyQuran ====
    if (kota) {
      try {
        const idKota = await cariKotaMyQuran(kota);
        const payload = await fetchTimingsMyQuran(idKota, toISO(date), tz);
        const out = normalizeMyQuran(pickJadwal(payload, toISO(date)), date, tz);
        setCache(key, { source: "myquran", data: out }, 6 * HOUR);
        return res.json({ success: true, source: "myquran", data: out });
      } catch (e) {
        console.error("MyQuran gagal:", e.message);
      }
    }

    // ==== CADANGAN: AlAdhan (butuh koordinat) ====
    if (koordinatValid) {
      try {
        let d;
        try { d = await fetchTimingsAlAdhan(lat, lng, date, 20); }   // 20 = Kemenag RI
        catch (e) { d = await fetchTimingsAlAdhan(lat, lng, date, 3); }
        const clean = (t) => String(t || "").split(" ")[0];
        const t = d.timings;
        const h = (d.date && d.date.hijri) || {};
        const out = {
          timings: {
            Imsak: clean(t.Imsak), Fajr: clean(t.Fajr), Sunrise: clean(t.Sunrise),
            Dhuhr: clean(t.Dhuhr), Asr: clean(t.Asr), Maghrib: clean(t.Maghrib), Isha: clean(t.Isha)
          },
          hijri: h.day ? `${h.day} ${(h.month && h.month.en) || ""} ${h.year} H` : "",
          gregorian: d.date && d.date.gregorian ? d.date.gregorian.date : date,
          timezone: (d.meta && d.meta.timezone) || tz
        };
        setCache(key, { source: "aladhan", data: out }, 6 * HOUR);
        return res.json({ success: true, source: "aladhan", data: out });
      } catch (e) {
        console.error("AlAdhan gagal:", e.message);
      }
    }

    return res.status(502).json({ success: false, error: "Jadwal shalat belum bisa dimuat. Coba lagi sebentar lagi." });
  });

  // ---------- DAFTAR SUARA ADZAN ----------
  app.get("/api/adzan", (req, res) => {
    const dir = path.join(__dirname, "public", "adzan");
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => /\.(mp3|ogg|m4a|wav)$/i.test(f)).sort(); } catch (e) {}
    const pretty = f => f.replace(/\.[^.]+$/, "").replace(/^subuh[-_ ]*/i, "").replace(/[-_]+/g, " ")
      .replace(/\b\w/g, c => c.toUpperCase()).trim() || "Muadzin";
    const data = files.map(f => ({ file: "/adzan/" + encodeURIComponent(f), name: pretty(f), subuh: /^subuh[-_ ]/i.test(f) }));
    res.json({ success: true, data });
  });

  // ---------- AL-QURAN ----------
  const QURAN = "https://equran.id/api/v2";

  app.get("/api/quran/surat", async (req, res) => {
    const hit = getCache("quran:list");
    if (hit) return res.json({ success: true, cached: true, data: hit });
    try {
      const { data } = await axios.get(`${QURAN}/surat`, { timeout: 20000, headers: UA });
      if (!data || !Array.isArray(data.data)) throw new Error("Respon tidak valid");
      setCache("quran:list", data.data, 24 * HOUR);
      res.json({ success: true, data: data.data });
    } catch (e) {
      console.error("Quran list error:", e.message);
      res.status(502).json({ success: false, error: "Gagal memuat daftar surat" });
    }
  });

  app.get("/api/quran/surat/:n", async (req, res) => {
    const n = parseInt(req.params.n, 10);
    if (!Number.isInteger(n) || n < 1 || n > 114)
      return res.status(400).json({ success: false, error: "Nomor surat 1-114" });
    const key = `quran:surat:${n}`;
    const hit = getCache(key);
    if (hit) return res.json({ success: true, cached: true, data: hit });
    try {
      const { data } = await axios.get(`${QURAN}/surat/${n}`, { timeout: 25000, headers: UA });
      if (!data || !data.data || !Array.isArray(data.data.ayat)) throw new Error("Respon tidak valid");
      setCache(key, data.data, 24 * HOUR);
      res.json({ success: true, data: data.data });
    } catch (e) {
      console.error("Quran surat error:", e.message);
      res.status(502).json({ success: false, error: "Gagal memuat surat" });
    }
  });
};

// Dipakai untuk tes unit (lihat scripts di luar proyek)
module.exports.normalizeMyQuran = normalizeMyQuran;
module.exports.pickJadwal = pickJadwal;
module.exports.normKota = normKota;
