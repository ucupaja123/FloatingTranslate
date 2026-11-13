// ==================== CATUR ONLINE (tantang member) ====================
// Namespace socket "/chess". Login memakai token sesi aplikasi (sama dengan API).
// Server yang memvalidasi setiap langkah dan menghitung jam, jadi tidak bisa dicurangi dari browser.
const path = require("path");
const { pathToFileURL } = require("url");
const { getSessionAccount } = require("./account");

const CLOCKS = [0, 300, 600];   // detik per pemain; 0 = tanpa jam
const GRACE_MS = 40000;         // jeda sebelum pemain yang terputus dinyatakan kalah

module.exports = async function setupChessOnline(io) {
  const R = await import(pathToFileURL(path.join(__dirname, "public/games/chess-rules.js")).href);
  const ns = io.of("/chess");
  const conns = new Map();      // username -> Set(socket id)
  const roles = new Map();      // username -> role
  const challenges = new Map(); // id -> { id, from, to, time }
  const matches = new Map();    // id -> match
  const activeBy = new Map();   // username -> id pertandingan yang sedang berjalan
  let seq = 1;

  const emitTo = (user, ev, data) => { for (const sid of conns.get(user) || []) ns.to(sid).emit(ev, data); };
  const lobby = () => ns.emit("chess:lobby", { online: [...conns.keys()].map(u => ({ username: u, role: roles.get(u) })) });
  const colorOf = (m, u) => (m.white === u ? "w" : m.black === u ? "b" : null);
  const colorName = c => (c === "w" ? "Putih" : "Hitam");
  const other = c => (c === "w" ? "b" : "w");
  const serial = s => ({ b: s.b, turn: s.turn, cr: s.cr, ep: s.ep, last: s.last, log: s.log });
  const view = (m, color) => ({ matchId: m.id, color, opp: color === "w" ? m.black : m.white, time: m.time, state: serial(m.s), clock: m.clock });

  // Batalkan tantangan yang dikirim user ini
  function dropFrom(user) {
    for (const c of [...challenges.values()]) {
      if (c.from !== user) continue;
      challenges.delete(c.id);
      emitTo(c.to, "chess:cancelled", { id: c.id });
    }
  }
  // Batalkan semua tantangan yang melibatkan user ini (dipakai saat keluar)
  function dropAll(user) {
    for (const c of [...challenges.values()]) {
      if (c.from !== user && c.to !== user) continue;
      challenges.delete(c.id);
      emitTo(c.from === user ? c.to : c.from, "chess:cancelled", { id: c.id });
    }
  }

  function endMatch(m, title, winner, sub) {
    if (m.over) return;
    m.over = true;
    for (const t of Object.values(m.grace)) clearTimeout(t);
    if (activeBy.get(m.white) === m.id) activeBy.delete(m.white);
    if (activeBy.get(m.black) === m.id) activeBy.delete(m.black);
    const payload = { matchId: m.id, title, winner, sub: sub || "Permainan selesai", state: serial(m.s), clock: m.clock };
    emitTo(m.white, "chess:over", payload);
    emitTo(m.black, "chess:over", payload);
    setTimeout(() => matches.delete(m.id), 60000);
    lobby();
  }

  function push(m) {
    const payload = { matchId: m.id, state: serial(m.s), clock: m.clock };
    emitTo(m.white, "chess:state", payload);
    emitTo(m.black, "chess:state", payload);
  }

  // Jam server: kalau giliran seseorang habis, pertandingan selesai
  setInterval(() => {
    const now = Date.now();
    for (const m of matches.values()) {
      if (!m.time || m.over) continue;
      const loser = m.s.turn;
      if (m.clock[loser] - (now - m.last) / 1000 <= 0) {
        endMatch(m, `${colorName(loser)} kehabisan waktu`, other(loser), "Waktu habis");
      }
    }
  }, 500);

  ns.use((socket, next) => {
    const acc = getSessionAccount(String(socket.handshake.auth?.token || ""));
    if (!acc) return next(new Error("Belum login"));
    socket.data.user = acc.username;
    roles.set(acc.username, acc.role);
    next();
  });

  ns.on("connection", socket => {
    const u = socket.data.user;
    if (!conns.has(u)) conns.set(u, new Set());
    conns.get(u).add(socket.id);
    socket.emit("chess:welcome", { username: u });

    // Sambung ulang: kalau pertandingan masih berjalan, lanjutkan
    const m0 = matches.get(activeBy.get(u) || "");
    if (m0 && !m0.over) {
      const color = colorOf(m0, u);
      clearTimeout(m0.grace[color]);
      delete m0.grace[color];
      socket.emit("chess:resume", view(m0, color));
    }
    lobby();

    const err = msg => socket.emit("chess:error", { error: msg });

    socket.on("chess:challenge", d => {
      d = d || {};
      const to = String(d.to || ""), time = CLOCKS.includes(Number(d.time)) ? Number(d.time) : 600;
      if (!to || to === u) return err("Pilih member lain");
      if (!conns.has(to)) return err("Member itu belum membuka Catur online");
      if (activeBy.has(u) || activeBy.has(to)) return err("Salah satu pemain sedang bermain");
      dropFrom(u);
      const id = String(seq++);
      challenges.set(id, { id, from: u, to, time });
      emitTo(to, "chess:challenge", { id, from: u, time });
      socket.emit("chess:sent", { id, to });
    });

    socket.on("chess:cancel", d => {
      const c = challenges.get(String((d || {}).id));
      if (!c || c.from !== u) return;
      challenges.delete(c.id);
      emitTo(c.to, "chess:cancelled", { id: c.id });
    });

    socket.on("chess:decline", d => {
      const c = challenges.get(String((d || {}).id));
      if (!c || c.to !== u) return;
      challenges.delete(c.id);
      emitTo(c.from, "chess:declined", { by: u });
    });

    socket.on("chess:accept", d => {
      const c = challenges.get(String((d || {}).id));
      if (!c || c.to !== u) return err("Tantangan sudah tidak berlaku");
      challenges.delete(c.id);
      if (activeBy.has(c.from) || activeBy.has(u) || !conns.has(c.from)) return err("Tidak bisa dimulai sekarang");
      dropAll(c.from);
      dropAll(u);
      const fromIsWhite = Math.random() < 0.5;
      const m = {
        id: "m" + seq++, white: fromIsWhite ? c.from : u, black: fromIsWhite ? u : c.from,
        time: c.time, s: R.fresh(), clock: { w: c.time, b: c.time }, last: Date.now(), grace: {}, over: false
      };
      matches.set(m.id, m);
      activeBy.set(c.from, m.id);
      activeBy.set(u, m.id);
      emitTo(m.white, "chess:start", view(m, "w"));
      emitTo(m.black, "chess:start", view(m, "b"));
      lobby();
    });

    socket.on("chess:move", d => {
      d = d || {};
      const m = matches.get(String(d.matchId));
      if (!m || m.over) return;
      const color = colorOf(m, u);
      if (!color) return;
      if (m.s.turn !== color) return err("Bukan giliranmu");
      const [fr, fc, row, col] = [d.fr, d.fc, d.row, d.col].map(Number);
      if (![fr, fc, row, col].every(n => Number.isInteger(n) && n >= 0 && n < 8)) return err("Langkah tidak valid");
      const cand = R.legal(m.s, fr, fc).find(x => x.row === row && x.col === col);
      if (!cand) return err("Langkah tidak legal");
      const now = Date.now();
      if (m.time) {
        m.clock[color] -= (now - m.last) / 1000;
        if (m.clock[color] <= 0) {
          m.clock[color] = 0;
          return endMatch(m, `${colorName(color)} kehabisan waktu`, other(color), "Waktu habis");
        }
      }
      m.last = now;
      const pc = ["Q", "R", "B", "N"].includes(d.pc) ? d.pc : "Q";
      R.applyMove(m.s, fr, fc, { ...cand, pc });
      const st = R.status(m.s);
      m.s.log[m.s.log.length - 1] += st.mate ? "#" : st.check ? "+" : "";
      if (st.mate) return endMatch(m, `Skakmat! ${colorName(color)} menang`, color, "Permainan selesai");
      if (st.stale) return endMatch(m, "Remis: pat", null, "Tidak ada langkah legal");
      push(m);
    });

    socket.on("chess:resign", d => {
      const m = matches.get(String((d || {}).matchId));
      const color = m && colorOf(m, u);
      if (!color || m.over) return;
      endMatch(m, `${colorName(color)} menyerah`, other(color), "Menyerah");
    });

    socket.on("disconnect", () => {
      const set = conns.get(u);
      if (set) set.delete(socket.id);
      if (set && set.size === 0) {
        conns.delete(u);
        dropAll(u);
        const m = matches.get(activeBy.get(u) || "");
        if (m && !m.over) {
          const color = colorOf(m, u), winner = other(color);
          m.grace[color] = setTimeout(() => {
            if (!conns.has(u)) endMatch(m, `${colorName(winner)} menang`, winner, "Lawan terputus");
          }, GRACE_MS);
        }
      }
      lobby();
    });
  });
};
