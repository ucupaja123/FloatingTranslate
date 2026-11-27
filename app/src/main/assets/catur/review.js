// Logika review: baca PGN game yang sudah selesai, tanya engine, beri label tiap langkah.
const LABELS = [
  ["brilian", "Brilian", "!!", "#1baca6"],
  ["hebat", "Hebat", "!", "#5c8bb0"],
  ["terbaik", "Terbaik", "★", "#81b64c"],
  ["sangatbagus", "Sangat bagus", "✓", "#95b776"],
  ["bagus", "Bagus", "•", "#7a9a86"],
  ["terpaksa", "Terpaksa", "→", "#8b8f98"],
  ["kurang", "Kurang tepat", "?!", "#f0c15c"],
  ["salah", "Kesalahan", "?", "#e6912c"],
  ["blunder", "Blunder", "??", "#e0474c"]
];
const UNIT = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const FINISHED = ["1-0", "0-1", "1/2-1/2"];

function parsePgn(text) {
  const tags = {};
  const body = text.replace(/^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm, (_, k, v) => { tags[k] = v; return ""; });
  if (tags.FEN || (tags.Variant && !/^(standard|chess)$/i.test(tags.Variant)))
    throw new Error("Cuma catur standar dari posisi awal yang didukung.");
  let moves = body.replace(/\{[^}]*\}/g, " ").replace(/;[^\n]*/g, " ");
  while (/\([^()]*\)/.test(moves)) moves = moves.replace(/\([^()]*\)/g, " ");
  const tokens = moves.replace(/\$\d+/g, " ").replace(/\d+\s*\.(\.\.)?/g, " ").split(/\s+/).filter(Boolean);
  const result = tokens.find(t => FINISHED.includes(t));
  // Hanya game yang sudah selesai: hasil harus tertulis di akhir PGN.
  if (!result || tokens[tokens.length - 1] !== result || (tags.Result && tags.Result !== result))
    throw new Error("Game ini belum selesai. PGN harus diakhiri hasil: 1-0, 0-1, atau 1/2-1/2.");
  const sans = tokens.slice(0, -1).filter(t => !/^[!?]+$/.test(t));
  if (!sans.length) throw new Error("Tidak ada langkah di PGN ini.");
  return { tags, result, sans };
}

const uciOf = x => SQ(x.fr, x.fc) + SQ(x.m.row, x.m.col) + (x.m.promo ? (x.m.pc || "Q").toLowerCase() : "");

// Semua langkah legal, promosi dipecah menjadi empat pilihan.
function moveList(s) {
  const out = [];
  for (const x of legalAll(s)) {
    if (!x.m.promo) out.push(x);
    else for (const pc of ["Q", "R", "B", "N"]) out.push({ fr: x.fr, fc: x.fc, m: { ...x.m, pc } });
  }
  return out;
}

function findSan(s, token) {
  const t = token.replace(/[+#!?]+$/g, "").replace(/0/g, "O");
  const all = moveList(s);
  if (t === "O-O" || t === "O-O-O")
    return all.find(x => x.m.castle !== undefined && x.m.col === (t === "O-O" ? 6 : 2));
  const g = /^([KQRBN])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([QRBN]))?$/.exec(t);
  if (!g) return null;
  const [, piece = "P", file, rank, dest, promo] = g;
  const found = all.filter(x =>
    s.b[x.fr][x.fc].toUpperCase() === piece && SQ(x.m.row, x.m.col) === dest &&
    (!file || "abcdefgh"[x.fc] === file) && (!rank || String(8 - x.fr) === rank) &&
    (x.m.promo ? x.m.pc === promo : !promo));
  return found.length === 1 ? found[0] : null;
}

function sanOf(s, x) {
  const piece = s.b[x.fr][x.fc].toUpperCase();
  const cap = !!s.b[x.m.row][x.m.col] || !!x.m.ep;
  let out;
  if (x.m.castle !== undefined) out = x.m.col === 6 ? "O-O" : "O-O-O";
  else if (piece === "P") out = (cap ? "abcdefgh"[x.fc] + "x" : "") + SQ(x.m.row, x.m.col) + (x.m.promo ? "=" + x.m.pc : "");
  else {
    const rivals = moveList(s).filter(y => s.b[y.fr][y.fc].toUpperCase() === piece &&
      y.m.row === x.m.row && y.m.col === x.m.col && (y.fr !== x.fr || y.fc !== x.fc));
    let dis = "";
    if (rivals.length) {
      if (!rivals.some(y => y.fc === x.fc)) dis = "abcdefgh"[x.fc];
      else if (!rivals.some(y => y.fr === x.fr)) dis = String(8 - x.fr);
      else dis = SQ(x.fr, x.fc);
    }
    out = piece + dis + (cap ? "x" : "") + SQ(x.m.row, x.m.col);
  }
  const t = clone(s);
  applyMove(t, x.fr, x.fc, x.m);
  const st = status(t);
  return out + (st.mate ? "#" : st.check ? "+" : "");
}

function fenOf(s, half, full) {
  const rows = s.b.map(row => {
    let out = "", gap = 0;
    for (const p of row) {
      if (!p) gap++;
      else { out += (gap || "") + p; gap = 0; }
    }
    return out + (gap || "");
  });
  const castle = ["K", "Q", "k", "q"].filter(k => s.cr[k]).join("") || "-";
  const ep = s.ep < 0 ? "-" : SQ(Math.floor(s.ep / 8), s.ep % 8);
  return `${rows.join("/")} ${s.turn} ${castle} ${ep} ${half} ${full}`;
}

function buildGame(text) {
  const pgn = parsePgn(text);
  const s = fresh();
  let half = 0;
  const positions = [{ state: clone(s), fen: fenOf(s, 0, 1) }];
  const plies = pgn.sans.map((token, i) => {
    const x = findSan(s, token);
    if (!x) throw new Error(`Langkah ke-${Math.floor(i / 2) + 1} "${token}" tidak bisa dibaca.`);
    const before = clone(s);
    const san = sanOf(before, x);
    const pawn = s.b[x.fr][x.fc].toLowerCase() === "p";
    const taken = x.m.ep ? "p" : s.b[x.m.row][x.m.col].toLowerCase();
    applyMove(s, x.fr, x.fc, x.m);
    half = pawn || taken ? 0 : half + 1;
    positions.push({ state: clone(s), fen: fenOf(s, half, Math.floor((i + 1) / 2) + 1) });
    return { move: x, uci: uciOf(x), san, taken, color: before.turn };
  });
  return { ...pgn, positions, plies };
}

// Material yang bisa dimenangkan pihak yang jalan lewat rangkaian makan di satu kotak.
function exchange(s, row, col) {
  const white = s.turn === "w";
  const takers = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = s.b[r][c];
    if (!p || isWhite(p) !== white) continue;
    if (pseudo(s, r, c).some(m => m.row === row && m.col === col)) takers.push({ r, c, v: UNIT[p.toLowerCase()] });
  }
  takers.sort((a, b) => a.v - b.v);
  for (const t of takers) {
    const m = legal(s, t.r, t.c).find(y => y.row === row && y.col === col);
    if (!m) continue;
    const value = UNIT[s.b[row][col].toLowerCase()];
    const next = clone(s);
    applyMove(next, t.r, t.c, m);
    return Math.max(0, value - exchange(next, row, col));
  }
  return 0;
}

// Pengorbanan: sesudah langkah, perwira sendiri sengaja dibiarkan bisa direbut dengan rugi minimal 2 poin.
function isSacrifice(before, after, ply) {
  if (ply.move.m.promo) return false;
  const white = ply.color === "w";
  const flipped = clone(before);
  flipped.turn = white ? "b" : "w";
  flipped.ep = -1;
  const got = ply.taken ? UNIT[ply.taken] : 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = after.b[r][c];
    if (!p || isWhite(p) !== white || !"nbrq".includes(p.toLowerCase())) continue;
    const loss = exchange(after, r, c);
    if (loss - got < 2) continue;
    const moved = r === ply.move.m.row && c === ply.move.m.col;
    if (moved || before.b[r][c] !== p || exchange(flipped, r, c) < loss) return true;
  }
  return false;
}

// Baca keluaran UCI: simpan baris info terakhir untuk tiap multipv.
function parseEngine(text) {
  const lines = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("info ") || / (lowerbound|upperbound)/.test(line)) continue;
    const score = / score (cp|mate) (-?\d+)/.exec(line);
    const pv = / pv (\S+)/.exec(line);
    if (!score || !pv) continue;
    const k = Number((/ multipv (\d+)/.exec(line) || [0, 1])[1]);
    lines[k - 1] = { type: score[1], value: Number(score[2]), move: pv[1] };
  }
  return lines;
}

// Peluang menang (0-100) dari sudut pandang pihak yang jalan.
function winChance(line) {
  if (line.type === "mate") return line.value > 0 ? 100 : 0;
  return 100 / (1 + Math.exp(-0.00368208 * line.value));
}

function evalText(line, turn) {
  const v = turn === "w" ? line.value : -line.value;
  if (line.type === "mate") return (v > 0 ? "+" : "-") + "M" + Math.abs(v);
  return (v > 0 ? "+" : "") + (v / 100).toFixed(1);
}

async function analyze(game, engine, onProgress) {
  const info = [];
  for (let i = 0; i < game.positions.length; i++) {
    const { state, fen } = game.positions[i];
    const st = status(state);
    if (st.over) {
      info.push({ win: st.mate ? 0 : 50, lines: [], text: st.mate ? "#" : "0.0" });
    } else {
      const lines = parseEngine(await engine(fen));
      if (!lines[0]) throw new Error("Engine tidak memberi hasil.");
      info.push({ win: winChance(lines[0]), lines, text: evalText(lines[0], state.turn) });
    }
    onProgress(i + 1, game.positions.length);
  }

  const reviews = game.plies.map((ply, i) => {
    const before = game.positions[i].state;
    const here = info[i];
    const best = here.lines[0];
    const second = here.lines[1];
    const isBest = best.move === ply.uci;
    const after = isBest ? here.win : 100 - info[i + 1].win;
    const loss = Math.max(0, here.win - after);
    const options = moveList(before);
    const previous = game.plies[i - 1];
    const recapture = !!(previous && previous.taken && ply.taken &&
      previous.move.m.row === ply.move.m.row && previous.move.m.col === ply.move.m.col);

    let label;
    if (options.length === 1) label = "terpaksa";
    else if (loss <= 2 && after >= 45 && second && winChance(second) < 97 &&
      isSacrifice(before, game.positions[i + 1].state, ply)) label = "brilian";
    else if (isBest && !recapture && second && here.win - winChance(second) >= 10) label = "hebat";
    else if (isBest) label = "terbaik";
    else if (loss <= 2) label = "sangatbagus";
    else if (loss <= 5) label = "bagus";
    else if (loss <= 10) label = "kurang";
    else if (loss <= 20) label = "salah";
    else label = "blunder";

    const suggestion = options.find(x => uciOf(x) === best.move);
    const accuracy = Math.min(100, Math.max(0, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
    return { label, loss, accuracy, best: best.move, bestSan: suggestion ? sanOf(before, suggestion) : best.move };
  });
  return { info, reviews };
}
