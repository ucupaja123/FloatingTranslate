/*
  TikTok Downloader + Search
  Credit: @IkyyExecutive, @AwasPhpJir
  Combined & adapted for YTMusic Web
*/

const axios = require("axios");
const qs = require("qs");
const CryptoJS = require("crypto-js");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");

// ============================================================
//      DOWNLOADER 1: savetiktok.id (primary)
// ============================================================
async function savetiktok(url) {
  const jar = new CookieJar();
  const client = wrapper(axios.create({
    jar,
    withCredentials: true,
    timeout: 20000,
    headers: {                                                               "User-Agent":
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36"
    }
  }));
                                                                         try {
    await client.get("https://savetiktok.id/");

    const { data } = await client.post(
      "https://savetiktok.id/wp-admin/admin-ajax.php",
      qs.stringify({
        action: "tkdl_download",
        tkdl_nonce: "c44ce6ec30",
        url
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Origin: "https://savetiktok.id",
          Referer: "https://savetiktok.id/",
          "X-Requested-With": "XMLHttpRequest"
        }
      }
    );

    // Response bisa object atau string JSON
    let parsed = data;
    if (typeof data === "string") {
      try { parsed = JSON.parse(data); } catch (e) {}
    }

    return { ok: true, source: "savetiktok", data: parsed };
  } catch (e) {
    return { ok: false, source: "savetiktok", error: e.response?.data || e.message };
  }
}

// ============================================================
//      DOWNLOADER 2: allinonedownloader.com (fallback)
// ============================================================
const AES_IV_HEX = "afc4e290725a3bf0ac4d3ff826c43c10";

function encryptUrlAio(url, token) {
  const key = CryptoJS.enc.Hex.parse(token);
  const iv = CryptoJS.enc.Hex.parse(AES_IV_HEX);
  const encrypted = CryptoJS.AES.encrypt(url, key, {
    iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.ZeroPadding
  });
  return encrypted.toString();
}

async function allInOneDownloader(targetUrl) {
  const baseUrl = "https://allinonedownloader.com";
  const solverApi = "https://api.ikyyxd.my.id/bypass/turnstile-cf-min";
  const userAgent =
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36";

  const jar = new CookieJar();
  const client = wrapper(axios.create({
    jar,
    withCredentials: true,
    headers: {
      "User-Agent": userAgent,
      Accept: "application/json, text/javascript, */*; q=0.01"
    }
  }));

  try {
    // Solve turnstile
    const solverRes = await axios.get(solverApi, {
      params: { url: `${baseUrl}/in/`, sitekey: "0x4AAAAAACm5JpnQ9wkl8EIR" },
      timeout: 90000
    });

    if (!solverRes.data?.status || !solverRes.data?.result?.token) {
      throw new Error("Solver gagal dapet token");
    }
    const ttoken = solverRes.data.result.token;

    const pageRes = await client.get(`${baseUrl}/in/`, {
      headers: { Referer: baseUrl }, timeout: 90000
    });

    const sccMatch = pageRes.data.match(/id=["']scc["'][^>]*value=["']([^"']+)["']/i);
    const tokenMatch = pageRes.data.match(/id=["']token["'][^>]*value=["']([^"']+)["']/i);
    if (!sccMatch || !tokenMatch) throw new Error("Form token tidak ditemukan");

    const endpointPath = sccMatch[1];
    const pageToken = tokenMatch[1];
    const urlHash = encryptUrlAio(targetUrl, pageToken);

    const formData = new URLSearchParams();
    formData.append("url", targetUrl);
    formData.append("token", pageToken);
    formData.append("urlhash", urlHash);
    formData.append("ttoken", ttoken);

    const res = await client.post(`${baseUrl}${endpointPath}`, formData.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: baseUrl,
        Referer: `${baseUrl}/in/`,
        "X-Requested-With": "XMLHttpRequest"
      },
      timeout: 90000
    });

    return { ok: true, source: "allinone", data: res.data };
  } catch (e) {
    return { ok: false, source: "allinone", error: e.message };
  }
}

// ============================================================
//      MASTER DOWNLOAD (coba semua fallback)
// ============================================================
async function downloadTikTok(url) {
  console.log(`📱 TikTok download: ${url}`);

  // Coba savetiktok dulu
  let result = await savetiktok(url);
  if (result.ok && result.data) {
    const normalized = normalizeDownload(result.data);
    if (normalized) return normalized;
  }

  // Fallback ke allinone
  console.log(`⚠️ savetiktok gagal, coba allinone...`);
  result = await allInOneDownloader(url);
  if (result.ok && result.data) {
    const normalized = normalizeDownload(result.data);
    if (normalized) return normalized;
  }

  return null;
}

// Normalisasi response dari berbagai sumber
function normalizeDownload(raw) {
  if (!raw) return null;

  // Kalau string, coba parse JSON
  let data = raw;
  if (typeof raw === "string") {
    try { data = JSON.parse(raw); } catch (e) { return null; }
  }

  // Kalau wrapper object (savetiktok)
  if (data.data) data = data.data;
  if (data.result) data = data.result;

  // Cari field yang mungkin berisi URL video
  const videoUrl =
    data.video ||
    data.video_url ||
    data.videoUrl ||
    data.play ||
    data.play_url ||
    data.hd ||
    data.hdplay ||
    data.wmplay ||
    data.nowm ||
    data.download_url ||
    data.mp4 ||
    (Array.isArray(data.medias) && data.medias.find(m => m.type === "video")?.url) ||
    null;

  const audioUrl =
    data.audio ||
    data.audio_url ||
    data.music ||
    data.music_url ||
    null;

  const title =
    data.title ||
    data.desc ||
    data.description ||
    "TikTok Video";

  const thumbnail =
    data.cover ||
    data.thumbnail ||
    data.thumb ||
    data.origin_cover ||
    null;

  if (!videoUrl) {
    console.log("⚠️ Tidak ada video URL di response:", JSON.stringify(data).substring(0, 200));
    return null;
  }

  return {
    title,
    videoUrl,
    audioUrl,
    thumbnail,
    author: data.author || data.username || data.nickname || "Unknown",
    duration: data.duration || 0
  };
}

// ============================================================
//      SEARCH via getdl.space
// ============================================================
async function searchTikTok(query, count = 10, region = "ID") {
  const baseUrl = "https://getdl.space";
  const jar = new CookieJar();
  const client = wrapper(axios.create({
    jar, withCredentials: true, timeout: 20000
  }));

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36",
    "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    Referer: "https://getdl.space/id/search/tiktok",
    Origin: "https://getdl.space"
  };

  console.log(`📱 TikTok search: "${query}"`);

  const sessionRes = await client.get(`${baseUrl}/api/session`, { headers });
  if (!sessionRes.data?.success || !sessionRes.data.sessionId) {
    throw new Error("Gagal init session getdl.space");
  }
  const sessionId = sessionRes.data.sessionId;

  const searchRes = await client.post(
    `${baseUrl}/api/search/tiktok`,
    {
      query, count, cursor: 0, region, sessionId, sortType: 0
    },
    { headers: { ...headers, "Content-Type": "application/json" } }
  );

  if (!searchRes.data?.success) {
    throw new Error("Gagal search: " + JSON.stringify(searchRes.data));
  }

  const { videos = [] } = searchRes.data.data || {};

  return videos.map(v => ({
    title: v.title || "TikTok Video",
    videoUrl: v.playUrl || v.videoUrl,
    cover: v.cover || v.cover_url || "",
    duration: v.duration || 0,
    author: v.author || v.username || "Unknown",
    createdAt: v.createdAt || null
  })).filter(v => v.videoUrl);
}

module.exports = { searchTikTok, downloadTikTok };