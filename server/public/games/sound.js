// ==================== SUARA GAME (Web Audio, tanpa file audio) ====================
// Semua bunyi dibuat dari osilator dan noise, jadi tidak perlu unduh apa pun.
// Audio dibuka saat pemain pertama kali menyentuh layar (syarat browser).
let ctx = null, noiseBuf = null;
export let muted = false;
export function setMuted(v) { muted = !!v; }

// Nada: [frekuensi Hz, mulai (detik), durasi, bentuk gelombang, volume]
const TONE = {
  tap:     [[700, 0, 0.035, "square", 0.04]],
  pop:     [[600, 0, 0.05, "sine", 0.2], [900, 0.03, 0.06, "sine", 0.15]],
  tick:    [[1000, 0, 0.04, "square", 0.08]],
  flip:    [[400, 0, 0.12, "triangle", 0.15], [700, 0.05, 0.1, "triangle", 0.12]],
  deal:    [[1200, 0, 0.03, "square", 0.08], [1000, 0.03, 0.03, "square", 0.08]],
  move:    [[260, 0, 0.08, "triangle", 0.3]],
  capture: [[160, 0, 0.14, "sawtooth", 0.25], [90, 0.04, 0.12, "square", 0.2]],
  check:   [[880, 0, 0.1, "square", 0.15], [1100, 0.1, 0.16, "square", 0.15]],
  end:     [[523, 0, 0.14, "triangle", 0.3], [659, 0.14, 0.14, "triangle", 0.3], [784, 0.28, 0.4, "triangle", 0.3]],
  jackpot: [[523, 0, 0.1, "square", 0.15], [659, 0.1, 0.1, "square", 0.15], [784, 0.2, 0.1, "square", 0.15], [1047, 0.3, 0.6, "square", 0.18]],
  coin:    [[988, 0, 0.08, "square", 0.12], [1319, 0.08, 0.3, "square", 0.12]],
  ok:      [[660, 0, 0.1, "sine", 0.25], [990, 0.08, 0.16, "sine", 0.25]],
  bad:     [[220, 0, 0.28, "sawtooth", 0.18]],
  lose:    [[330, 0, 0.2, "sawtooth", 0.18], [247, 0.2, 0.4, "sawtooth", 0.18]],
  dice:    [[120, 0.72, 0.12, "sine", 0.35]],   // thud saat dadu mendarat, setelah kocokan
  reel:    Array.from({ length: 18 }, (_, i) => [1500 + (i % 3) * 200, i * 0.07, 0.02, "square", 0.06])
};

// Bunyi derau yang disaring: kocokan dadu dan ledakan ranjau
function burst(a, t, dur, freq, vol) {
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = noiseBuf;
  f.type = "bandpass";
  f.frequency.value = freq;
  f.Q.value = 2;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t, Math.random() * 0.5, dur + 0.01);
}
const NOISE = {
  dice: (a, t0) => { for (let i = 0; i < 12; i++) burst(a, t0 + i * 0.06 + Math.random() * 0.02, 0.035, 2000 + Math.random() * 2500, 0.5); },
  boom: (a, t0) => burst(a, t0, 0.5, 300, 0.9)
};

function audio() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (err) { return null; }
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

// Dipanggil saat ada sentuhan pertama, supaya audio sudah siap
export function unlock() { audio(); }

export function play(name) {
  const a = !muted && (TONE[name] || NOISE[name]) && audio();
  if (!a) return;
  const t0 = a.currentTime;
  if (NOISE[name]) NOISE[name](a, t0);
  for (const [f, at, dur, type, vol] of TONE[name] || []) {
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.value = f;
    g.gain.setValueAtTime(vol, t0 + at);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
    o.connect(g).connect(a.destination);
    o.start(t0 + at);
    o.stop(t0 + at + dur + 0.02);
  }
}
