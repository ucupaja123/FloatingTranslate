// ==================== CATUR 3D v3 (gaya chess.com) ====================
// Lawan komputer (3 level), 2 pemain di satu HP, dan online melawan member lain.
// Langkah online divalidasi di server (chess-online.js). Aturan ada di chess-rules.js.
import { THREE } from "./engine.js";
import { play } from "./sound.js";
import { C, PROFILE, GLYPH, LEVEL_NAME, LEVELS, TIMES, HUMAN, isWhite, el, fresh, clone, fmt, captured, status, legal, applyMove, bestMove } from "./chess-rules.js";

const MODES = [["ai", "Lawan Komputer"], ["pvp", "2 Pemain"], ["online", "Online (Member)"]];
const ROLE = { owner: "👑 Owner", admin: "🛡️ Admin", reseller: "💎 Reseller", premium: "⭐ Premium", user: "👤 User" };
const restore = s => ({ b: s.b, turn: s.turn, cr: s.cr, ep: s.ep, last: s.last, log: s.log });
const token = () => localStorage.getItem("xc_token") || "";

// Socket.io: pakai yang dilayani server, kalau gagal pakai CDN
function loadSocketIO() {
  if (window.io) return Promise.resolve(window.io);
  const load = src => new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => (window.io ? res(window.io) : rej(new Error("io tidak tersedia")));
    s.onerror = rej;
    document.head.append(s);
  });
  return load("/socket.io/socket.io.js").catch(() => load("https://cdn.socket.io/4.7.5/socket.io.min.js"));
}

export default {
  id: "chess",
  title: "Catur",
  icon: "♞",
  desc: "Lawan komputer, 2 pemain, atau tantang member lain secara online.",
  opts: { bg: 0x1d2236, camPos: [0, 11, 9.5], lookAt: [0, 0, 0], fov: 40, fit: { w: 10.4, h: 14.2 } },

  mount(e) {
    let cfg = { mode: "ai", level: 2, time: 600 }, draft = { ...cfg };
    let S = fresh(), hist = [], sel = null, moves = [], busy = false, gen = 0, info = null;
    let clock = { w: Infinity, b: Infinity }, playing = false, ended = false, promoPending = null;
    let net = null;   // { sock, matchId, color, opp }
    let myName = "", presence = [], members = [], incoming = null, outgoing = null, lobbyNote = "";
    const tiles = [], groupAt = {}, marks = [];

    const isOnline = () => cfg.mode === "online" && !!(net && net.matchId);
    const topSide = () => (isOnline() ? (net.color === "w" ? "b" : "w") : "b");   // sisi lawan (di atas)
    const humanTurn = () => cfg.mode === "pvp" || (isOnline() ? S.turn === net.color : S.turn === HUMAN);
    const clockFrom = v => (cfg.time > 0 ? { w: v.w, b: v.b } : { w: Infinity, b: Infinity });
    const mkBtn = (label, cls, fn, disabled) => {
      const b = el("button", "gbtn " + (cls || ""), label);
      b.type = "button";
      b.disabled = !!disabled;
      e.on(b, "click", fn);
      return b;
    };
    const setCam = white => { e.camera.position.set(0, 11, white ? 9.5 : -9.5); e.camera.lookAt(0, 0, 0); };

    // ----- papan -----
    const base = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.4, 9.6), e.mat(0x4a2f1a, { roughness: 0.6 }));
    base.position.y = -0.25;
    base.receiveShadow = true;
    e.scene.add(base);
    const tileGeo = new THREE.BoxGeometry(0.98, 0.2, 0.98);
    const tm = {};
    for (const k of Object.keys(C)) tm[k] = e.mat(C[k], { roughness: 0.5 });
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const t = new THREE.Mesh(tileGeo, tm.light);
      t.position.set(c - 3.5, 0, r - 3.5);
      t.receiveShadow = true;
      t.userData.key = r * 8 + c;
      e.scene.add(t);
      tiles.push(t);
    }
    function coord(txt, x, z) {
      const l = e.label(txt, { w: 0.5, h: 0.5, color: "#f3e7c9", font: "bold 130px sans-serif" });
      l.rotation.x = -Math.PI / 2;
      l.position.set(x, -0.04, z);
      e.scene.add(l);
    }
    for (let i = 0; i < 8; i++) {
      coord("abcdefgh"[i], i - 3.5, 4.35);
      coord(String(8 - i), -4.35, i - 3.5);
    }

    // ----- bidak -----
    const geo = {};
    for (const k of Object.keys(PROFILE)) geo[k] = new THREE.LatheGeometry(PROFILE[k].map(([x, y]) => new THREE.Vector2(x, y)), 26);
    const headGeo = new THREE.BoxGeometry(0.34, 0.5, 0.56);
    const crossGeo = new THREE.BoxGeometry(0.08, 0.36, 0.08);
    const crossBarGeo = new THREE.BoxGeometry(0.32, 0.08, 0.08);
    const ballGeo = new THREE.SphereGeometry(0.11, 14, 10);
    const pieceMats = {
      w: e.mat(0xf7f1e1, { roughness: 0.3, metalness: 0.05 }),
      b: e.mat(0x2d2d3a, { roughness: 0.3, metalness: 0.1 })
    };
    const dotGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.04, 18);
    const ringGeo = new THREE.TorusGeometry(0.42, 0.06, 8, 24);
    const dotMat = e.mat(0x1c3d24, { transparent: true, opacity: 0.6 });
    const ringMat = e.mat(0xe0474c, { transparent: true, opacity: 0.85 });

    function makePiece(ch) {
      const kind = ch.toLowerCase();
      const m = isWhite(ch) ? pieceMats.w : pieceMats.b;
      const g = new THREE.Group();
      const body = new THREE.Mesh(geo[kind], m);
      body.castShadow = true;
      g.add(body);
      if (kind === "n") {
        const head = new THREE.Mesh(headGeo, m);
        head.position.set(0, 0.85, 0.05);
        head.rotation.x = -0.5;
        head.castShadow = true;
        g.add(head);
      }
      if (kind === "q") {
        const ball = new THREE.Mesh(ballGeo, m);
        ball.position.y = 1.3;
        g.add(ball);
      }
      if (kind === "k") {
        const v = new THREE.Mesh(crossGeo, m);
        v.position.y = 1.5;
        const h = new THREE.Mesh(crossBarGeo, m);
        h.position.y = 1.56;
        g.add(v, h);
      }
      return g;
    }

    function place(r, c, ch) {
      const g = makePiece(ch);
      g.position.set(c - 3.5, 0.1, r - 3.5);
      g.userData.key = r * 8 + c;
      e.scene.add(g);
      groupAt[r * 8 + c] = g;
    }

    function sync() {
      for (const k of Object.keys(groupAt)) {
        e.scene.remove(groupAt[k]);
        delete groupAt[k];
      }
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (S.b[r][c]) place(r, c, S.b[r][c]);
    }

    function paint() {
      tiles.forEach((t, i) => {
        const r = i >> 3, c = i & 7, dark = (r + c) % 2 === 1;
        let mt = dark ? tm.dark : tm.light;
        if (S.last && (S.last.from === i || S.last.to === i)) mt = dark ? tm.lastD : tm.lastL;
        if (info && info.check && info.kingIdx === i) mt = tm.check;
        if (sel && sel.r * 8 + sel.c === i) mt = tm.sel;
        t.material = mt;
      });
    }

    function paintMarks() {
      for (const m of marks) e.scene.remove(m);
      marks.length = 0;
      for (const mv of moves) {
        const cap = !!S.b[mv.row][mv.col] || !!mv.ep;
        const mesh = new THREE.Mesh(cap ? ringGeo : dotGeo, cap ? ringMat : dotMat);
        mesh.position.set(mv.col - 3.5, cap ? 0.12 : 0.13, mv.row - 3.5);
        if (cap) mesh.rotation.x = Math.PI / 2;
        e.scene.add(mesh);
        marks.push(mesh);
      }
    }

    // ----- HUD -----
    const hud = e.hud;
    hud.style.cssText = "position:absolute;inset:0;display:flex;flex-direction:column;justify-content:space-between;padding:10px 10px calc(10px + env(safe-area-inset-bottom,0px));pointer-events:none";
    const topEl = el("div", "ch-top"), botEl = el("div", "ch-bot");
    const card = () => {
      const root = el("div", "ch-card");
      const av = el("div", "ch-av"), mid = el("div"), name = el("div", "ch-name"), cap = el("div", "ch-cap");
      mid.style.flex = "1";
      mid.append(name, cap);
      const clk = el("div", "ch-clock", "∞");
      root.append(av, mid, clk);
      return { root, av, name, cap, clk };
    };
    const topC = card(), botC = card();
    const statusEl = el("div", "ch-status", "");
    const movesEl = el("div", "ch-moves", "");
    const undoB = mkBtn("↶ Undo", "", undo);
    const resignB = mkBtn("🏳 Menyerah", "bad", resign);
    const newB = mkBtn("⚙ Menu", "hot", openSetup);
    topEl.append(topC.root, statusEl, movesEl);
    const actRow = el("div", "ch-row");
    actRow.append(undoB, resignB, newB);
    botEl.append(botC.root, actRow);
    const setupEl = el("div", "ch-overlay"), lobbyEl = el("div", "ch-overlay");
    const chEl = el("div", "ch-overlay"), endEl = el("div", "ch-overlay"), promoEl = el("div", "ch-overlay");
    hud.append(topEl, botEl, setupEl, lobbyEl, chEl, endEl, promoEl);
    const modalOpen = () => [setupEl, lobbyEl, chEl, endEl, promoEl].some(x => x.classList.contains("on"));

    function updateClocks() {
      const top = topSide(), bot = top === "b" ? "w" : "b";
      const show = (side, c) => {
        c.clk.textContent = fmt(clock[side]);
        c.clk.className = "ch-clock" +
          (playing && !ended && S.turn === side ? " on" : "") +
          (clock[side] < 20 && clock[side] !== Infinity ? " low" : "");
      };
      show(top, topC);
      show(bot, botC);
    }

    function updateHUD() {
      const cap = captured(S.b), top = topSide(), online = isOnline();
      topC.av.textContent = online ? "🌐" : cfg.mode === "ai" ? "🤖" : "♚";
      botC.av.textContent = top === "b" ? "♔" : "♚";
      topC.name.textContent = online ? net.opp : cfg.mode === "ai" ? `Komputer · ${LEVEL_NAME[cfg.level]}` : "Hitam";
      botC.name.textContent = online ? (myName || "Kamu") : cfg.mode === "ai" ? "Kamu (Putih)" : "Putih";
      topC.cap.textContent = (top === "b" ? cap.w : cap.bl).map(p => GLYPH[p]).join("");
      botC.cap.textContent = (top === "b" ? cap.bl : cap.w).map(p => GLYPH[p]).join("");
      movesEl.textContent = S.log.length
        ? S.log.map((t, i) => (i % 2 === 0 ? `${i / 2 + 1}. ` : "") + t).join("  ")
        : "Belum ada langkah";
      movesEl.scrollLeft = movesEl.scrollWidth;
      updateClocks();
    }

    function refresh() {
      info = status(S);
      paint();
      paintMarks();
      if (!ended) {
        let t;
        if (!playing) t = cfg.mode === "online" ? "Pilih lawan di lobi" : "Pilih mode untuk mulai";
        else if (info.mate) t = "Skakmat!";
        else if (info.stale) t = "Remis: pat";
        else if (isOnline()) t = S.turn === net.color ? "Giliran kamu" : `Menunggu ${net.opp}`;
        else if (cfg.mode === "ai" && S.turn !== HUMAN) t = "Komputer sedang berpikir…";
        else t = `Giliran ${S.turn === "w" ? "Putih" : "Hitam"}${info.check ? " · SKAK!" : ""}`;
        statusEl.textContent = t;
      }
      updateHUD();
      undoB.disabled = busy || !hist.length || isOnline();
    }

    // ----- pengaturan -----
    function buildSetup() {
      setupEl.innerHTML = "";
      const box = el("div", "ch-modal");
      box.append(el("h3", "", "Main Catur"));
      const groups = [["Mode", "mode", MODES], ["Level komputer", "level", LEVELS], ["Waktu per pemain", "time", TIMES]];
      for (const [title, key, list] of groups) {
        if (key === "level" && draft.mode !== "ai") continue;
        box.append(el("div", "ch-sec", title));
        const row = el("div", "ch-chips");
        for (const [val, label] of list) {
          const b = el("button", "ch-chip-btn" + (draft[key] === val ? " on" : ""), label);
          b.type = "button";
          e.on(b, "click", () => { draft[key] = val; buildSetup(); });
          row.append(b);
        }
        box.append(row);
      }
      if (draft.mode === "online") box.append(el("div", "ch-sec", "Tantang member yang sedang membuka Catur online"));
      const acts = el("div", "ch-row");
      acts.append(mkBtn(draft.mode === "online" ? "Buka lobi" : "Mulai", "hot", startFromSetup));
      if (playing && !ended) acts.append(mkBtn("Batal", "", () => setupEl.classList.remove("on")));
      box.append(acts);
      setupEl.append(box);
    }

    function openSetup() {
      draft = { ...cfg };
      buildSetup();
      setupEl.classList.add("on");
      endEl.classList.remove("on");
      promoEl.classList.remove("on");
    }

    function startFromSetup() {
      const wasOnline = isOnline() && playing && !ended;
      cfg = { ...draft };
      setupEl.classList.remove("on");
      if (cfg.mode === "online") {
        if (wasOnline) net.sock.emit("chess:resign", { matchId: net.matchId });
        if (net) net.matchId = null;
        playing = false;
        ended = false;
        return openLobby();
      }
      if (net) net.matchId = null;
      setCam(true);
      newGame();
    }

    // ----- lobi online -----
    function openLobby() {
      lobbyEl.classList.add("on");
      lobbyNote = "";
      buildLobby();
      connectOnline();
      loadMembers();
    }

    function buildLobby() {
      lobbyEl.innerHTML = "";
      const box = el("div", "ch-modal");
      box.append(el("h3", "", "Lobi Online"));
      if (lobbyNote) box.append(el("div", "ch-sec", lobbyNote));
      if (outgoing) {
        box.append(el("div", "ch-sec", `Menunggu ${outgoing.to} menjawab…`));
        box.append(mkBtn("Batalkan tantangan", "bad", () => net && net.sock && net.sock.emit("chess:cancel", { id: outgoing.id })));
      }
      const onl = new Set(presence.map(p => p.username));
      const rows = (members.length ? members : presence)
        .filter(mb => mb.username !== myName)
        .sort((a, b) => (onl.has(b.username) - onl.has(a.username)) || a.username.localeCompare(b.username));
      if (!rows.length) box.append(el("div", "ch-sec", "Belum ada member lain"));
      for (const mb of rows.slice(0, 60)) {
        const on = onl.has(mb.username);
        const row = el("div", "ch-row-m");
        const who = el("div", "ch-who");
        who.append(el("b", "", mb.username), el("small", "", `${ROLE[mb.role] || ""} · ${on ? "online" : "offline"}`));
        row.append(who, mkBtn("Tantang", on ? "hot" : "", () => challenge(mb.username), !on || !!outgoing));
        box.append(row);
      }
      box.append(mkBtn("Kembali", "", () => { lobbyEl.classList.remove("on"); openSetup(); }));
      lobbyEl.append(box);
    }

    function buildIncoming() {
      chEl.innerHTML = "";
      if (!incoming) return chEl.classList.remove("on");
      const box = el("div", "ch-modal");
      const t = (TIMES.find(x => x[0] === incoming.time) || [0, "Tanpa jam"])[1];
      box.append(el("h3", "", `${incoming.from} menantang kamu`), el("div", "ch-sec", `Waktu: ${t}`));
      const row = el("div", "ch-row");
      row.append(
        mkBtn("Terima", "hot", () => { net.sock.emit("chess:accept", { id: incoming.id }); incoming = null; buildIncoming(); }),
        mkBtn("Tolak", "bad", () => { net.sock.emit("chess:decline", { id: incoming.id }); incoming = null; buildIncoming(); })
      );
      box.append(row);
      chEl.append(box);
      chEl.classList.add("on");
    }

    async function connectOnline() {
      net = net || { sock: null, matchId: null, color: "w", opp: "" };
      if (net.sock) return;
      if (!token()) { lobbyNote = "Login dulu di aplikasi PRIMSIC untuk main online."; return buildLobby(); }
      try {
        const io = await loadSocketIO();
        const sock = io("/chess", { auth: { token: token() }, transports: ["websocket", "polling"] });
        net.sock = sock;
        sock.on("connect_error", err => { lobbyNote = "Gagal tersambung: " + err.message; buildLobby(); });
        sock.on("chess:welcome", d => { myName = d.username; buildLobby(); });
        sock.on("chess:lobby", d => { presence = d.online; buildLobby(); });
        sock.on("chess:challenge", d => { incoming = d; buildIncoming(); play("coin"); });
        sock.on("chess:sent", d => { outgoing = d; lobbyNote = ""; buildLobby(); });
        sock.on("chess:declined", d => { outgoing = null; lobbyNote = `${d.by} menolak tantangan`; buildLobby(); });
        sock.on("chess:cancelled", d => {
          if (incoming && incoming.id === d.id) { incoming = null; buildIncoming(); }
          if (outgoing && outgoing.id === d.id) { outgoing = null; buildLobby(); }
        });
        sock.on("chess:error", d => { lobbyNote = d.error; buildLobby(); });
        sock.on("chess:start", startOnline);
        sock.on("chess:resume", startOnline);
        sock.on("chess:state", applyNet);
        sock.on("chess:over", overNet);
      } catch (err) {
        lobbyNote = "Tidak bisa memuat koneksi.";
        buildLobby();
      }
    }

    async function loadMembers() {
      try {
        const r = await fetch("/api/social/members", { headers: { Authorization: "Bearer " + token() } });
        const j = await r.json();
        if (j.success) { members = j.data; buildLobby(); }
      } catch (err) { /* offline: tampilkan yang online saja */ }
    }

    function challenge(to) {
      if (!net || !net.sock || !net.sock.connected) { lobbyNote = "Belum tersambung ke server"; return buildLobby(); }
      net.sock.emit("chess:challenge", { to, time: cfg.time });
    }

    function startOnline(d) {
      if (!net) return;
      cfg = { ...cfg, mode: "online", time: d.time };
      net.matchId = d.matchId;
      net.color = d.color;
      net.opp = d.opp;
      incoming = null;
      outgoing = null;
      lobbyEl.classList.remove("on");
      chEl.classList.remove("on");
      setupEl.classList.remove("on");
      endEl.classList.remove("on");
      S = restore(d.state);
      clock = clockFrom(d.clock);
      hist = []; sel = null; moves = []; busy = false; ended = false; playing = true; promoPending = null;
      setCam(d.color === "w");
      gen++;
      sync();
      refresh();
      play("coin");
    }

    // Langkah lawan (atau konfirmasi langkah kita) dari server
    function applyNet(d) {
      if (!isOnline() || d.matchId !== net.matchId) return;
      const prev = S.log.length;
      S = restore(d.state);
      clock = clockFrom(d.clock);
      sel = null; moves = []; busy = false; hist = [];
      sync();
      refresh();
      if (S.log.length > prev) {
        const last = S.log[S.log.length - 1];
        play(last.includes("x") ? "capture" : last.endsWith("+") ? "check" : "move");
      }
    }

    function overNet(d) {
      if (!net || d.matchId !== net.matchId) return;
      if (d.state) { S = restore(d.state); sync(); }
      endGame(d.title, d.sub, d.winner);
      refresh();
    }

    // ----- permainan -----
    function endGame(title, sub, winner) {
      ended = true;
      statusEl.textContent = title;
      endEl.innerHTML = "";
      const box = el("div", "ch-modal");
      box.append(el("h3", "", title), el("div", "ch-sec", sub));
      const r = el("div", "ch-row");
      r.append(mkBtn("Main lagi", "hot", openSetup), mkBtn("Lihat papan", "", () => endEl.classList.remove("on")));
      box.append(r);
      endEl.append(box);
      endEl.classList.add("on");
      const side = cfg.mode === "online" ? net && net.color : cfg.mode === "ai" ? HUMAN : null;
      if (!side) play("end");
      else play(winner === side ? "end" : winner ? "lose" : "ok");
      updateClocks();
    }

    function newGame() {
      gen++;
      S = fresh(); hist = []; sel = null; moves = []; busy = false; ended = false; promoPending = null;
      clock = clockFrom({ w: cfg.time, b: cfg.time });
      playing = true;
      sync();
      refresh();
      maybeAI();
    }

    function maybeAI() {
      if (!playing || ended || busy || cfg.mode !== "ai" || S.turn === HUMAN) return;
      const g = gen;
      e.later(450, () => {
        if (g !== gen || ended) return;
        const best = bestMove(S, cfg.level, cfg.level === 1 ? 160 : 0);
        if (best) doMove(best.fr, best.fc, best.m);
      });
    }

    // Langkah lokal (komputer atau 2 pemain)
    async function doMove(fr, fc, m) {
      const g = gen;
      hist.push({ S: clone(S), clock: { ...clock } });
      const mover = groupAt[fr * 8 + fc], victim = groupAt[m.row * 8 + m.col];
      sel = null; moves = []; busy = true;
      paint(); paintMarks();
      const res = applyMove(S, fr, fc, m);
      const anims = [];
      if (mover) {
        const a = mover.position.clone(), b = new THREE.Vector3(m.col - 3.5, 0.1, m.row - 3.5);
        anims.push(e.tween(340, k => {
          mover.position.lerpVectors(a, b, k);
          mover.position.y = 0.1 + Math.sin(k * Math.PI) * 0.6;
        }));
      }
      if (victim && victim !== mover) anims.push(e.tween(220, k => victim.scale.setScalar(1 - k)));
      await Promise.all(anims);
      if (g !== gen) return;
      busy = false;
      info = status(S);
      S.log[S.log.length - 1] += info.mate ? "#" : info.check ? "+" : "";
      sync();
      refresh();
      if (info.mate) {
        const winner = S.turn === "w" ? "b" : "w";
        return endGame(`Skakmat! ${winner === "w" ? "Putih" : "Hitam"} menang`, "Permainan selesai", winner);
      }
      if (info.stale) return endGame("Remis: pat", "Tidak ada langkah legal", null);
      play(res.castle ? "move" : info.check ? "check" : res.cap ? "capture" : "move");
      maybeAI();
    }

    // Langkah online: kirim ke server, papan diperbarui saat server membalas
    function sendMove(fr, fc, m, pc) {
      sel = null; moves = [];
      paint(); paintMarks();
      net.sock.emit("chess:move", { matchId: net.matchId, fr, fc, row: m.row, col: m.col, pc });
    }

    function showPromo(fr, fc, m) {
      promoPending = { fr, fc, m };
      const w = S.turn === "w";
      promoEl.innerHTML = "";
      const box = el("div", "ch-modal");
      box.append(el("h3", "", "Pilih bidak promosi"));
      const grid = el("div", "ch-promo");
      for (const L of ["Q", "R", "B", "N"]) {
        const b = el("button", "", GLYPH[w ? L : L.toLowerCase()]);
        b.type = "button";
        e.on(b, "click", () => {
          const p = promoPending;
          promoEl.classList.remove("on");
          promoPending = null;
          if (isOnline()) sendMove(p.fr, p.fc, p.m, L);
          else doMove(p.fr, p.fc, { ...p.m, pc: L });
        });
        grid.append(b);
      }
      box.append(grid);
      promoEl.append(box);
      promoEl.classList.add("on");
    }

    function onPick(idx) {
      if (busy || ended || !playing || modalOpen() || !humanTurn()) return;
      const r = idx >> 3, c = idx & 7;
      if (sel) {
        const m = moves.find(x => x.row === r && x.col === c);
        if (m) {
          if (m.promo) return showPromo(sel.r, sel.c, m);
          return isOnline() ? sendMove(sel.r, sel.c, m) : doMove(sel.r, sel.c, m);
        }
        if (sel.r === r && sel.c === c) { sel = null; moves = []; paint(); return paintMarks(); }
      }
      const ch = S.b[r][c];
      if (ch && isWhite(ch) === (S.turn === "w")) { sel = { r, c }; moves = legal(S, r, c); }
      else { sel = null; moves = []; }
      paint();
      paintMarks();
    }

    function undo() {
      if (busy || ended || !hist.length || isOnline()) return;
      const back = Math.min(cfg.mode === "ai" ? 2 : 1, hist.length);
      let snap = null;
      for (let i = 0; i < back; i++) snap = hist.pop();
      gen++;
      S = snap.S;
      clock = snap.clock;
      sel = null; moves = [];
      endEl.classList.remove("on");
      promoEl.classList.remove("on");
      sync();
      refresh();
      maybeAI();
    }

    function resign() {
      if (!playing || ended) return;
      if (isOnline()) return net.sock.emit("chess:resign", { matchId: net.matchId });
      const loser = cfg.mode === "ai" ? HUMAN : S.turn;
      endGame(`${loser === "w" ? "Putih" : "Hitam"} menyerah`, cfg.mode === "ai" ? "Komputer menang" : "Permainan selesai", loser === "w" ? "b" : "w");
    }

    // Jam: berjalan di layar. Di online, server yang menentukan kapan waktu habis.
    e.onTick(dt => {
      if (!playing || ended || busy || modalOpen()) return;
      clock[S.turn] = Math.max(0, clock[S.turn] - dt);
      if (clock[S.turn] === 0 && !isOnline()) {
        const loser = S.turn;
        return endGame(`${loser === "w" ? "Putih" : "Hitam"} kehabisan waktu`, "Waktu habis", loser === "w" ? "b" : "w");
      }
      updateClocks();
    });

    e.on(e.renderer.domElement, "pointerdown", ev => {
      if (ev.button > 0) return;
      const hit = e.pick(ev.clientX, ev.clientY, [...tiles, ...Object.values(groupAt)]);
      if (hit) onPick(hit.key);
    });

    sync();
    refresh();
    openSetup();
  }
};
