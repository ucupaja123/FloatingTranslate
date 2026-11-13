// ==================== CEK FOTO: AI atau asli? ====================
// Semua dibaca dari byte file di perangkat. Tidak ada yang diunggah.
// Hasilnya BUKTI, bukan kepastian: metadata bisa dihapus atau dipalsukan,
// dan deteksi dari piksel butuh model terlatih yang tidak ada di sini.
// Koordinat GPS sengaja tidak dibaca; yang ditampilkan hanya ada/tidaknya data lokasi.

const latin = new TextDecoder("latin1");
const utf8 = new TextDecoder("utf-8");
const str = (u8, off, len) => latin.decode(u8.subarray(off, off + len));
const dv = u8 => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
const first = arr => (Array.isArray(arr) && arr.length ? arr[0] : undefined);
const trim = v => (typeof v === "string" ? v.trim() : v);

// Ukuran yang lazim dihasilkan generator AI (hanya penanda lemah)
const AI_SIZES = new Set([
  "512x512", "768x768", "1024x1024", "1536x1536", "2048x2048",
  "1024x1792", "1792x1024", "1024x1536", "1536x1024",
  "832x1216", "1216x832", "896x1152", "1152x896", "768x1344", "1344x768"
]);
const EDITOR = /photoshop|lightroom|gimp|snapseed|picsart|canva|facetune|meitu|affinity/i;
// Nama generator yang bisa muncul di metadata. Aplikasi lain bisa menulis ulang nama ini,
// jadi hasilnya dugaan dari penanda, bukan bukti pasti. Watermark piksel tidak dibaca di sini.
const GENERATORS = [
  ["Google Gemini / Imagen", /Gemini|Nano Banana|Imagen|\bVeo\b|SynthID/i],
  ["OpenAI (DALL-E / ChatGPT)", /DALL-?E|ChatGPT|OpenAI|GPT-4o/i],
  ["Midjourney", /Midjourney/i],
  ["Adobe Firefly", /Firefly/i],
  ["Stable Diffusion / ComfyUI", /Stable Diffusion|ComfyUI|Automatic1111|InvokeAI/i],
  ["Ideogram", /Ideogram/i],
  ["NovelAI", /NovelAI/i],
  ["Flux (Black Forest Labs)", /Black Forest Labs|\bFLUX\b/],
  ["Grok (xAI)", /\bGrok\b/],
  ["Microsoft (Bing Image Creator)", /Bing Image Creator|Microsoft Designer/i]
];
// Kunci teks PNG yang nilainya hanya berisi nama aplikasi (bukan isi prompt)
const GEN_TEXT_KEYS = /^(software|generator|source|model|creator)$/i;
// Kunci teks PNG yang menandakan alat tertentu. Isi prompt tidak dibaca untuk ini.
const PNG_KEY_GEN = {
  parameters: "Stable Diffusion (A1111/Forge)",
  "sd-metadata": "InvokeAI",
  prompt: "ComfyUI",
  workflow: "ComfyUI"
};
const AI_PNG_KEYS = /^(parameters|prompt|workflow|sd-metadata)$/i;
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
const HEADER_LIMIT = 2 * 1024 * 1024;

export function sniff(u8) {
  if (u8.length > 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return "jpeg";
  if (u8.length > 8 && u8[0] === 0x89 && str(u8, 1, 3) === "PNG") return "png";
  if (u8.length > 12 && str(u8, 0, 4) === "RIFF" && str(u8, 8, 4) === "WEBP") return "webp";
  if (u8.length > 6 && str(u8, 0, 4) === "GIF8") return "gif";
  return null;
}

// Segmen JPEG sampai SOS (awal data gambar). Setiap segmen: marker, start, end, at
function jpegSegments(u8) {
  const out = [];
  let p = 2;
  while (p + 4 <= u8.length && u8[p] === 0xff) {
    const m = u8[p + 1];
    if (m === 0xff) { p += 1; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
    const len = (u8[p + 2] << 8) | u8[p + 3];
    if (len < 2 || p + 2 + len > u8.length) break;
    out.push({ marker: m, start: p + 4, end: p + 2 + len, at: p });
    if (m === 0xda) break;
    p += 2 + len;
  }
  return out;
}

// Chunk PNG: type, start, end, at
function pngChunks(u8) {
  const out = [];
  const d = dv(u8);
  let p = 8;
  while (p + 12 <= u8.length) {
    const len = d.getUint32(p);
    const start = p + 8, end = start + len;
    if (end + 4 > u8.length) break;
    const type = str(u8, p + 4, 4);
    out.push({ type, start, end, at: p });
    if (type === "IEND") break;
    p = end + 4;
  }
  return out;
}

// Baca TIFF/EXIF. Lokasi GPS hanya dicek ada/tidaknya, koordinatnya tidak dibaca.
function parseTiff(u8, base, limit) {
  const d = dv(u8);
  const head = str(u8, base, 2);
  const le = head === "II";
  if (!le && head !== "MM") return null;
  const u16 = o => d.getUint16(o, le);
  const u32 = o => d.getUint32(o, le);
  const valuesOf = e => {
    const type = u16(e + 2), n = u32(e + 4), size = (TYPE_SIZE[type] || 0) * n;
    if (!size) return [];
    const at = size <= 4 ? e + 8 : base + u32(e + 8);
    if (at + size > limit) return [];
    switch (type) {
      case 2: return [str(u8, at, n).replace(/\0+$/, "")];
      case 3: return Array.from({ length: n }, (_, i) => u16(at + 2 * i));
      case 4: return Array.from({ length: n }, (_, i) => u32(at + 4 * i));
      case 5: return Array.from({ length: n }, (_, i) => {
        const a = u32(at + 8 * i), b = u32(at + 8 * i + 4);
        return b ? a / b : null;
      });
      case 10: return Array.from({ length: n }, (_, i) => {
        const a = d.getInt32(at + 8 * i, le), b = d.getInt32(at + 8 * i + 4, le);
        return b ? a / b : null;
      });
      default: return [];
    }
  };
  const ifd = off => {
    const map = new Map();
    const start = base + off;
    const n = u16(start);
    for (let i = 0; i < n; i++) map.set(u16(start + 2 + 12 * i), start + 2 + 12 * i);
    return map;
  };
  const get = (map, tag) => (map.has(tag) ? valuesOf(map.get(tag)) : []);
  const ifd0 = ifd(u32(base + 4));
  const exifPtr = first(get(ifd0, 0x8769));
  const gpsPtr = first(get(ifd0, 0x8825));
  const sub = exifPtr ? ifd(exifPtr) : new Map();
  const s = tag => first(get(sub, tag));
  return {
    make: trim(first(get(ifd0, 0x010f))),
    model: trim(first(get(ifd0, 0x0110))),
    software: trim(first(get(ifd0, 0x0131))),
    dateOriginal: trim(s(0x9003)),
    exposure: s(0x829a),
    fNumber: s(0x829d),
    iso: s(0x8827),
    focalLength: s(0x920a),
    lens: trim(s(0xa434)),
    hasLocation: !!gpsPtr && ifd(gpsPtr).size > 0
  };
}

async function inflate(bytes) {
  const ds = new DecompressionStream("deflate");
  const w = ds.writable.getWriter();
  w.write(bytes).catch(() => {});
  w.close().catch(() => {});
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

// Teks PNG (tEXt, zTXt, iTXt). Hanya kunci dan isinya yang dibaca.
async function pngText(u8, chunks) {
  const out = {};
  for (const c of chunks) {
    if (c.type !== "tEXt" && c.type !== "zTXt" && c.type !== "iTXt") continue;
    try {
      const z = u8.indexOf(0, c.start);
      if (z < 0 || z >= c.end) continue;
      const key = str(u8, c.start, z - c.start);
      if (c.type === "tEXt") {
        out[key] = str(u8, z + 1, c.end - z - 1);
      } else if (c.type === "zTXt") {
        out[key] = latin.decode(await inflate(u8.subarray(z + 2, c.end)));
      } else {
        const packed = u8[z + 1] === 1;
        const lang = u8.indexOf(0, z + 3);
        if (lang < 0) continue;
        const trans = u8.indexOf(0, lang + 1);
        if (trans < 0) continue;
        const body = u8.subarray(trans + 1, c.end);
        out[key] = utf8.decode(packed ? await inflate(body) : body);
      }
    } catch (err) { /* teks yang rusak dilewati */ }
  }
  return out;
}

// Banyak kamera menulis merek di kolom model juga ("Canon EOS R6"), jadi jangan diulang
function camName(c) {
  if (c.make && c.model && c.model.toLowerCase().startsWith(c.make.toLowerCase())) return c.model;
  return [c.make, c.model].filter(Boolean).join(" ");
}

function pick(c) {
  return {
    name: camName(c),
    make: c.make,
    model: c.model,
    lens: c.lens,
    software: c.software,
    dateOriginal: c.dateOriginal,
    exposure: c.exposure ? (c.exposure < 1 ? `1/${Math.round(1 / c.exposure)} dtk` : `${c.exposure} dtk`) : null,
    fNumber: c.fNumber ? `f/${c.fNumber}` : null,
    iso: c.iso ?? null,
    focal: c.focalLength ? `${Math.round(c.focalLength)} mm` : null
  };
}

// Cari nama generator di bagian metadata dan di kunci teks PNG tertentu
function attribute(attrText, text) {
  const found = new Map();
  for (const [name, re] of GENERATORS) {
    if (re.test(attrText)) found.set(name, "XMP/C2PA/EXIF");
  }
  for (const [key, val] of Object.entries(text)) {
    if (GEN_TEXT_KEYS.test(key)) {
      for (const [name, re] of GENERATORS) {
        if (re.test(val)) found.set(name, `teks PNG "${key}"`);
      }
    }
    const k = Object.keys(PNG_KEY_GEN).find(x => x.toLowerCase() === key.toLowerCase());
    if (k) found.set(PNG_KEY_GEN[k], `teks PNG "${key}"`);
  }
  return [...found].map(([name, source]) => ({ name, source }));
}

function verdictOf(signals, hasCamera) {
  const has = (kind, strength) => signals.some(s => s.kind === kind && s.strength === strength);
  const camNote = hasCamera ? " Metadata kamera juga ada, tapi metadata itu bisa ditambahkan ke gambar AI." : "";
  if (has("ai", "kuat")) return {
    id: "ai", tone: "bad", title: "Kemungkinan besar buatan AI",
    summary: "Ada penanda yang biasanya hanya muncul pada gambar buatan AI." + camNote
  };
  if (has("ai", "sedang")) return {
    id: "ai-parsial", tone: "warn", title: "Sebagian gambar buatan AI",
    summary: "Ada penanda bahwa sebagian gambar dibuat atau diubah dengan AI."
  };
  if (has("asli", "sedang")) return {
    id: "asli", tone: "ok", title: "Kemungkinan foto kamera",
    summary: "Ada metadata kamera. Ini belum tentu asli, karena metadata bisa ditambahkan atau dihapus."
  };
  if (has("ai", "lemah")) return {
    id: "belum", tone: "warn", title: "Belum bisa dipastikan",
    summary: "Hanya ada tanda lemah yang mengarah ke AI."
  };
  return {
    id: "belum", tone: "neutral", title: "Belum bisa dipastikan",
    summary: "Tidak ada penanda yang jelas. Ini tidak berarti foto itu asli."
  };
}

// Entry utama. Menerima ArrayBuffer isi file.
export async function analyzeFile(buffer) {
  const u8 = new Uint8Array(buffer);
  const format = sniff(u8);
  if (!format) return { ok: false, error: "Bukan file JPG, PNG, WebP, atau GIF." };
  try {
    return await analyze(u8, format);
  } catch (err) {
    return { ok: false, error: "File tidak bisa dibaca. Mungkin rusak atau terpotong." };
  }
}

async function analyze(u8, format) {
  const d = dv(u8);
  let dims = null, exif = null, chunks = [], text = {};
  let headerEnd = Math.min(u8.length, HEADER_LIMIT);

  if (format === "jpeg") {
    const segs = jpegSegments(u8);
    const sos = segs.find(s => s.marker === 0xda);
    if (sos) headerEnd = sos.at;
    const sof = segs.find(s => s.marker >= 0xc0 && s.marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(s.marker));
    if (sof) dims = { h: d.getUint16(sof.start + 1), w: d.getUint16(sof.start + 3) };
    const app1 = segs.find(s => s.marker === 0xe1 && str(u8, s.start, 6) === "Exif\0\0");
    if (app1) exif = parseTiff(u8, app1.start + 6, app1.end);
  } else if (format === "png") {
    chunks = pngChunks(u8);
    const ihdr = chunks.find(c => c.type === "IHDR");
    if (ihdr) dims = { w: d.getUint32(ihdr.start), h: d.getUint32(ihdr.start + 4) };
    const idat = chunks.find(c => c.type === "IDAT");
    if (idat) headerEnd = idat.at;
    const eXIf = chunks.find(c => c.type === "eXIf");
    if (eXIf) exif = parseTiff(u8, eXIf.start, eXIf.end);
    text = await pngText(u8, chunks);
  } else if (format === "webp") {
    if (str(u8, 12, 4) === "VP8X" && u8.length > 29) {
      dims = {
        w: 1 + (u8[24] | (u8[25] << 8) | (u8[26] << 16)),
        h: 1 + (u8[27] | (u8[28] << 8) | (u8[29] << 16))
      };
    }
  } else if (format === "gif") {
    dims = { w: d.getUint16(6, true), h: d.getUint16(8, true) };
  }

  const hdr = str(u8, 0, headerEnd);
  const pngKeys = Object.keys(text);
  const camera = exif && (exif.make || exif.model) ? exif : null;
  const signals = [];
  const add = (kind, strength, label) => signals.push({ kind, strength, label });

  // Penanda AI yang tertanam (IPTC / C2PA)
  if (/compositeWithTrainedAlgorithmicMedia/.test(hdr)) {
    add("ai", "sedang", "Penanda IPTC: sebagian gambar dibuat atau diubah dengan AI");
  } else if (/trainedAlgorithmicMedia/.test(hdr)) {
    add("ai", "kuat", "Penanda IPTC/C2PA: ditandai sebagai media hasil AI");
  }

  // Generator yang namanya tertulis di metadata. Teks prompt di PNG tidak ikut dibaca,
  // supaya kata seperti "Gemini" di dalam prompt tidak dianggap sebagai generator.
  const attrText = format === "png"
    ? chunks.filter(c => c.at < headerEnd && !["tEXt", "zTXt", "iTXt"].includes(c.type)).map(c => str(u8, c.start, c.end - c.start)).join("")
    : hdr;
  const generators = attribute(attrText, text);
  for (const g of generators) add("ai", "kuat", `Metadata menyebut generator: ${g.name} (dari ${g.source})`);

  // Kunci teks PNG khas alat AI
  const aiKey = pngKeys.find(k => AI_PNG_KEYS.test(k));
  if (aiKey) add("ai", "kuat", `Teks metadata "${aiKey}" khas alat AI`);

  if (/c2pa/i.test(hdr)) add("netral", "sedang", "Ada Content Credentials (C2PA). Ini catatan asal-usul, bukan bukti AI atau asli");

  // Metadata kamera
  if (camera) {
    add("asli", "sedang", `Metadata kamera: ${camName(camera)}`);
    if (camera.exposure && camera.fNumber && camera.iso) add("asli", "lemah", "Data pemotretan lengkap: waktu, bukaan, ISO");
  }
  if (exif && EDITOR.test(exif.software || "")) add("netral", "info", `Sudah diedit dengan: ${exif.software}`);

  // Tanpa metadata sama sekali
  const hasMeta = !!exif || pngKeys.length > 0 || /c2pa|xmpmeta|Exif/i.test(hdr);
  if (!hasMeta) add("netral", "lemah", "Tidak ada metadata. Bisa AI, bisa juga foto yang dikirim lewat chat atau medsos karena metadatanya biasanya dihapus");

  // Ukuran lazim generator AI, hanya kalau tidak ada metadata kamera
  if (dims && AI_SIZES.has(`${dims.w}x${dims.h}`) && !camera) add("ai", "lemah", `Ukuran ${dims.w}×${dims.h} px lazim untuk generator AI`);

  // Privasi: lokasi GPS ada di file (koordinat sengaja tidak ditampilkan)
  const hasLocation = !!(exif && exif.hasLocation);
  if (hasLocation) add("info", "penting", "Foto ini menyimpan data lokasi GPS. Hapus dulu sebelum dibagikan");

  const verdict = verdictOf(signals, !!camera);
  if (generators.length) verdict.summary += ` Dugaan generator: ${generators.map(g => g.name).join(", ")}.`;

  return {
    ok: true,
    format,
    dims,
    camera: camera ? pick(camera) : null,
    exifFound: !!exif,
    hasLocation,
    generators,
    signals,
    verdict
  };
}
