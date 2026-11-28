// ==================== ATURAN CATUR (dipakai browser dan server) ====================
// Tanpa tampilan: langkah, skak, pat, komputer, dan notasi.
// Diimpor oleh g-chess.js (browser) dan chess-online.js (server).

export const START = [
  ["r", "n", "b", "q", "k", "b", "n", "r"],
  ["p", "p", "p", "p", "p", "p", "p", "p"],
  ["", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["P", "P", "P", "P", "P", "P", "P", "P"],
  ["R", "N", "B", "Q", "K", "B", "N", "R"]
];
export const C = { light: 0xeeeed2, dark: 0x769656, lastL: 0xf6f669, lastD: 0xbaca2b, sel: 0xf7ec6e, check: 0xe0474c, hint: 0x5cc8ff, hintTo: 0x1864ab };
export const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
export const GLYPH = { K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙", k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
export const LEVEL_NAME = { 1: "Mudah", 2: "Sedang", 4: "Sulit" };
export const MODES = [[true, "Lawan Komputer"], [false, "2 Pemain"]];
export const LEVELS = [[1, "Mudah"], [2, "Sedang"], [4, "Sulit"]];
export const TIMES = [[0, "Tanpa jam"], [300, "5 menit"], [600, "10 menit"]];
export const HUMAN = "w", MATE = 1000000;
export const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
export const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
export const KG = [...ORTH, ...DIAG];
export const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
export const PROFILE = {
  p: [[0, 0], [0.32, 0], [0.24, 0.1], [0.12, 0.35], [0.18, 0.55], [0.3, 0.68], [0.16, 0.8], [0, 0.84]],
  r: [[0, 0], [0.38, 0], [0.34, 0.1], [0.3, 0.7], [0.4, 0.8], [0.4, 1.0], [0, 1.0]],
  b: [[0, 0], [0.34, 0], [0.2, 0.3], [0.26, 0.7], [0.12, 0.98], [0, 1.1]],
  q: [[0, 0], [0.38, 0], [0.22, 0.3], [0.28, 0.75], [0.42, 1.0], [0.2, 1.2], [0, 1.2]],
  k: [[0, 0], [0.38, 0], [0.22, 0.3], [0.28, 0.8], [0.36, 1.05], [0.18, 1.22], [0, 1.22]]
};

export const isWhite = p => p === p.toUpperCase();
export const inBoard = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
export const SQ = (r, c) => "abcdefgh"[c] + (8 - r);
export const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
export const fresh = () => ({ b: START.map(r => r.slice()), turn: "w", cr: { K: 1, Q: 1, k: 1, q: 1 }, ep: -1, last: null, log: [] });
export const clone = s => ({ b: s.b.map(r => r.slice()), turn: s.turn, cr: { ...s.cr }, ep: s.ep, last: s.last, log: s.log.slice() });
export const lite = s => ({ b: s.b.map(r => r.slice()), turn: s.turn, cr: { ...s.cr }, ep: s.ep, last: null, log: [] });
export const fmt = t => {
  if (t === Infinity) return "∞";
  if (t < 10) return "0:" + t.toFixed(1).padStart(4, "0");
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
};

// Bidak yang hilang dari tiap pihak (dihitung dari papan vs posisi awal)
export function captured(b) {
  const need = {}, have = {};
  for (const row of START) for (const ch of row) if (ch) need[ch] = (need[ch] || 0) + 1;
  for (const row of b) for (const ch of row) if (ch) have[ch] = (have[ch] || 0) + 1;
  const lostW = [], lostB = [];
  for (const ch of Object.keys(need)) {
    const d = need[ch] - (have[ch] || 0);
    for (let i = 0; i < d; i++) (isWhite(ch) ? lostW : lostB).push(ch);
  }
  return { w: lostW, bl: lostB };
}

// ----- aturan murni (tanpa tampilan) -----
// Apakah kotak (r,c) diserang oleh pihak byWhite?
export function attacked(b, r, c, byWhite) {
  const P = byWhite ? "P" : "p", N = byWhite ? "N" : "n", K = byWhite ? "K" : "k";
  const R = byWhite ? "R" : "r", B = byWhite ? "B" : "b", Q = byWhite ? "Q" : "q";
  const pr = byWhite ? r + 1 : r - 1;
  for (const dc of [-1, 1]) if (inBoard(pr, c + dc) && b[pr][c + dc] === P) return true;
  for (const [dr, dc] of KN) if (inBoard(r + dr, c + dc) && b[r + dr][c + dc] === N) return true;
  for (const [dr, dc] of KG) if (inBoard(r + dr, c + dc) && b[r + dr][c + dc] === K) return true;
  for (const [dirs, pcs] of [[ORTH, [R, Q]], [DIAG, [B, Q]]]) {
    for (const [dr, dc] of dirs) {
      let nr = r + dr, nc = c + dc;
      while (inBoard(nr, nc)) {
        const p = b[nr][nc];
        if (p) { if (pcs.includes(p)) return true; break; }
        nr += dr; nc += dc;
      }
    }
  }
  return false;
}

export function kingAt(b, white) {
  const k = white ? "K" : "k";
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (b[r][c] === k) return [r, c];
  return null;
}

export function castles(s, r, c, w, out) {
  const b = s.b, row = w ? 7 : 0, rook = w ? "R" : "r", foe = !w;
  if (r !== row || c !== 4 || attacked(b, row, 4, foe)) return;
  if (s.cr[w ? "K" : "k"] && !b[row][5] && !b[row][6] && b[row][7] === rook &&
      !attacked(b, row, 5, foe) && !attacked(b, row, 6, foe)) out.push({ row, col: 6, castle: 7 });
  if (s.cr[w ? "Q" : "q"] && !b[row][1] && !b[row][2] && !b[row][3] && b[row][0] === rook &&
      !attacked(b, row, 3, foe) && !attacked(b, row, 2, foe)) out.push({ row, col: 2, castle: 0 });
}

// Gerakan semu-legal (belum memeriksa apakah raja jadi terkena skak)
export function pseudo(s, r, c) {
  const b = s.b, ch = b[r][c], w = isWhite(ch), k = ch.toLowerCase(), out = [];
  const foeAt = (tr, tc) => !!b[tr][tc] && isWhite(b[tr][tc]) !== w;
  if (k === "p") {
    const d = w ? -1 : 1, start = w ? 6 : 1, last = w ? 0 : 7;
    if (inBoard(r + d, c) && !b[r + d][c]) {
      out.push({ row: r + d, col: c, promo: r + d === last });
      if (r === start && !b[r + 2 * d][c]) out.push({ row: r + 2 * d, col: c, dbl: true });
    }
    for (const dc of [-1, 1]) {
      const nr = r + d, nc = c + dc;
      if (!inBoard(nr, nc)) continue;
      const ep = !b[nr][nc] && s.ep === nr * 8 + nc;
      if (foeAt(nr, nc) || ep) out.push({ row: nr, col: nc, ep, promo: nr === last });
    }
  } else if (k === "n" || k === "k") {
    for (const [dr, dc] of (k === "n" ? KN : KG)) {
      const nr = r + dr, nc = c + dc;
      if (inBoard(nr, nc) && (!b[nr][nc] || foeAt(nr, nc))) out.push({ row: nr, col: nc });
    }
    if (k === "k") castles(s, r, c, w, out);
  } else {
    const dirs = k === "r" ? ORTH : k === "b" ? DIAG : KG;
    for (const [dr, dc] of dirs) {
      let nr = r + dr, nc = c + dc;
      while (inBoard(nr, nc)) {
        if (!b[nr][nc]) out.push({ row: nr, col: nc });
        else { if (foeAt(nr, nc)) out.push({ row: nr, col: nc }); break; }
        nr += dr; nc += dc;
      }
    }
  }
  return out;
}

// Menjalankan langkah pada state s (mengubah s). m.pc = bidak promosi (Q/R/B/N).
export function applyMove(s, fr, fc, m) {
  const b = s.b, ch = b[fr][fc], w = isWhite(ch), k = ch.toLowerCase();
  const cap = !!b[m.row][m.col] || !!m.ep;
  const castle = m.castle !== undefined;
  const pc = m.pc || "Q";
  const san = castle ? (m.col === 6 ? "O-O" : "O-O-O")
    : (k === "p" ? (cap ? "abcdefgh"[fc] + "x" : "") : k.toUpperCase() + (cap ? "x" : "")) +
      SQ(m.row, m.col) + (m.promo ? "=" + pc : "");
  b[m.row][m.col] = ch;
  b[fr][fc] = "";
  if (m.ep) b[fr][m.col] = "";
  if (castle) {
    const rookTo = m.col === 6 ? 5 : 3;
    b[fr][rookTo] = b[fr][m.castle];
    b[fr][m.castle] = "";
  }
  if (m.promo) b[m.row][m.col] = w ? pc : pc.toLowerCase();
  s.ep = m.dbl ? ((fr + m.row) / 2) * 8 + fc : -1;
  if (k === "k") { s.cr[w ? "K" : "k"] = 0; s.cr[w ? "Q" : "q"] = 0; }
  const corner = (r, c) => {
    if (r === 7 && c === 0) s.cr.Q = 0;
    if (r === 7 && c === 7) s.cr.K = 0;
    if (r === 0 && c === 0) s.cr.q = 0;
    if (r === 0 && c === 7) s.cr.k = 0;
  };
  corner(fr, fc);
  corner(m.row, m.col);
  s.last = { from: fr * 8 + fc, to: m.row * 8 + m.col };
  s.turn = w ? "b" : "w";
  s.log.push(san);
  return { cap, castle };
}

// Gerakan yang legal: tidak boleh membuat raja sendiri terkena skak
export function legal(s, r, c) {
  const white = isWhite(s.b[r][c]);
  return pseudo(s, r, c).filter(m => {
    const t = clone(s);
    applyMove(t, r, c, m);
    const [kr, kc] = kingAt(t.b, white);
    return !attacked(t.b, kr, kc, !white);
  });
}

export function legalAll(s) {
  const out = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const ch = s.b[r][c];
    if (ch && isWhite(ch) === (s.turn === "w")) for (const m of legal(s, r, c)) out.push({ fr: r, fc: c, m });
  }
  return out;
}

// Keadaan giliran sekarang: skak, skakmat, atau pat
export function status(s) {
  const white = s.turn === "w";
  const [kr, kc] = kingAt(s.b, white);
  const check = attacked(s.b, kr, kc, !white);
  let any = false;
  outer: for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const ch = s.b[r][c];
      if (ch && isWhite(ch) === white && legal(s, r, c).length) { any = true; break outer; }
    }
  }
  return { check, over: !any, mate: !any && check, stale: !any && !check, kingIdx: kr * 8 + kc };
}

// ----- komputer -----
// Nilai posisi dari sudut pandang Putih (positif = Putih unggul)
export function evalBoard(b) {
  let s = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const ch = b[r][c];
    if (!ch) continue;
    const k = ch.toLowerCase(), w = isWhite(ch);
    const cen = 7 - Math.abs(c - 3.5) - Math.abs(r - 3.5);
    const adv = w ? 6 - r : r - 1;
    const pos = k === "p" ? adv * 8 + cen * 3 : k === "n" ? cen * 9 : k === "b" ? cen * 5 : k === "q" ? cen * 2 : 0;
    s += (w ? 1 : -1) * (VAL[k] + pos);
  }
  return s;
}

// Langkah diurutkan: makan bidak lawan paling berharga dulu (lebih cepat dipangkas)
export function ordered(s) {
  const out = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const ch = s.b[r][c];
    if (!ch || isWhite(ch) !== (s.turn === "w")) continue;
    for (const m of pseudo(s, r, c)) {
      const tgt = s.b[m.row][m.col];
      out.push({ fr: r, fc: c, m, sc: (tgt ? VAL[tgt.toLowerCase()] * 10 : 0) + (m.promo ? 800 : 0) });
    }
  }
  return out.sort((x, y) => y.sc - x.sc);
}

export function negamax(s, depth, alpha, beta) {
  if (depth === 0) return (s.turn === "w" ? 1 : -1) * evalBoard(s.b);
  const me = s.turn === "w";
  let best = -Infinity, any = false;
  for (const x of ordered(s)) {
    const tgt = s.b[x.m.row][x.m.col];
    if (tgt && tgt.toLowerCase() === "k") return MATE + depth;
    const t = lite(s);
    applyMove(t, x.fr, x.fc, x.m);
    const [kr, kc] = kingAt(t.b, me);
    if (attacked(t.b, kr, kc, !me)) continue; // langkah ilegal: raja masih di-skak
    any = true;
    const v = -negamax(t, depth - 1, -beta, -alpha);
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  if (!any) {
    const [kr, kc] = kingAt(s.b, me);
    return attacked(s.b, kr, kc, !me) ? -(MATE + depth) : 0; // skakmat atau pat
  }
  return best;
}

// Langkah terbaik untuk pihak yang sedang jalan. noise > 0 membuat komputer lebih mudah dikalahkan.
export function bestMove(s, depth, noise) {
  const list = legalAll(s).sort(() => Math.random() - 0.5);
  let best = null, bestV = -Infinity;
  for (const x of list) {
    const t = lite(s);
    applyMove(t, x.fr, x.fc, x.m);
    let v = -negamax(t, depth - 1, -Infinity, -bestV);
    if (noise) v += (Math.random() - 0.5) * noise;
    if (v > bestV) { bestV = v; best = x; }
  }
  return best;
}

