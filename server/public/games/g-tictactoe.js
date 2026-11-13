// ==================== TIC TAC TOE 3D ====================
// Logika dari game asli: minimax tak terkalahkan, undo, skor.
import { THREE } from "./engine.js";

const WIN = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

function winnerOf(b) {
  for (const [a, c, d] of WIN) {
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return { p: b[a], line: [a, c, d] };
  }
  return null;
}

function minimax(b, maxTurn) {
  const w = winnerOf(b);
  if (w) return w.p === "X" ? -10 : 10;
  if (b.every(Boolean)) return 0;
  let best = maxTurn ? -Infinity : Infinity;
  for (let i = 0; i < 9; i++) {
    if (b[i]) continue;
    b[i] = maxTurn ? "O" : "X";
    const s = minimax(b, !maxTurn);
    b[i] = "";
    best = maxTurn ? Math.max(best, s) : Math.min(best, s);
  }
  return best;
}

function bestMove(b) {
  let best = -Infinity, mv = -1;
  for (let i = 0; i < 9; i++) {
    if (b[i]) continue;
    const c = [...b];
    c[i] = "O";
    const s = minimax(c, false);
    if (s > best) { best = s; mv = i; }
  }
  return mv;
}

const SP = 2.3;
const cx = i => (i % 3 - 1) * SP;
const cz = i => (Math.floor(i / 3) - 1) * SP;

export default {
  id: "ttt",
  title: "Tic Tac Toe",
  icon: "❌",
  desc: "Kamu X, lawan AI O yang tak terkalahkan. Ada undo.",
  opts: { bg: 0xfff3d6, camPos: [0, 10.5, 7.5], lookAt: [0, 0, 0.6], fov: 44, fit: { w: 8.6, h: 11.5 } },

  mount(e) {
    let board = Array(9).fill("");
    let hist = [];
    let busy = false, over = false, gen = 0;
    const score = { X: 0, O: 0, D: 0 };
    const cells = [];
    const pieces = Array(9).fill(null);
    let lineMesh = null;

    // ----- papan -----
    const base = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.5, 7.6), e.mat(0x2b2b3a));
    base.position.y = -0.3;
    base.receiveShadow = true;
    e.scene.add(base);

    const cellGeo = new THREE.BoxGeometry(2.1, 0.3, 2.1);
    const matA = e.mat(0xffffff), matB = e.mat(0xffe7a8);
    for (let i = 0; i < 9; i++) {
      const row = Math.floor(i / 3), col = i % 3;
      const m = new THREE.Mesh(cellGeo, (row + col) % 2 ? matB : matA);
      m.position.set(cx(i), 0, cz(i));
      m.receiveShadow = true;
      m.userData.key = i;
      e.scene.add(m);
      cells.push(m);
    }

    // ----- bidak -----
    const xGeo = new THREE.BoxGeometry(0.34, 0.34, 2.0);
    const oGeo = new THREE.TorusGeometry(0.6, 0.17, 16, 40);
    const xMat = e.mat(0xff5d73), oMat = e.mat(0x3b8bff);

    function makePiece(p) {
      const g = new THREE.Group();
      if (p === "X") {
        const a = new THREE.Mesh(xGeo, xMat);
        const b = new THREE.Mesh(xGeo, xMat);
        a.rotation.y = Math.PI / 4;
        b.rotation.y = -Math.PI / 4;
        a.castShadow = b.castShadow = true;
        g.add(a, b);
      } else {
        const t = new THREE.Mesh(oGeo, oMat);
        t.rotation.x = Math.PI / 2;
        t.castShadow = true;
        g.add(t);
      }
      return g;
    }

    async function place(i, p) {
      e.sfx("move");
      const g = makePiece(p);
      g.position.set(cx(i), 3, cz(i));
      g.scale.setScalar(0.4);
      e.scene.add(g);
      pieces[i] = g;
      await e.tween(420, k => {
        g.position.y = 3 - 2.5 * k;
        g.scale.setScalar(0.4 + 0.6 * k);
      });
    }

    function drawLine(line) {
      const [a, , c] = line;
      const x1 = cx(a), z1 = cz(a), x2 = cx(c), z2 = cz(c);
      const len = Math.hypot(x2 - x1, z2 - z1) + 0.6;
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(len, 0.14, 0.3),
        e.mat(0xffd23f, { emissive: 0xffa500, emissiveIntensity: 0.7 })
      );
      m.position.set((x1 + x2) / 2, 1.1, (z1 + z2) / 2);
      m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
      e.scene.add(m);
      lineMesh = m;
    }

    // ----- HUD -----
    const st = document.createElement("div");
    st.className = "g3-status";
    const chips = document.createElement("div");
    chips.className = "g3-row";
    const row = document.createElement("div");
    row.className = "g3-row";
    e.hud.append(st, chips, row);

    const btn = (label, cls, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "gbtn " + (cls || "");
      b.textContent = label;
      e.on(b, "click", fn);
      return b;
    };
    const undoB = btn("↶ Undo", "", undo);
    const resetB = btn("Ulang", "hot", reset);
    row.append(undoB, resetB);

    function setStatus(t) { st.textContent = t; }
    function renderChips() {
      chips.innerHTML =
        `<span class="g3-chip">Kamu X: ${score.X}</span>` +
        `<span class="g3-chip">Seri: ${score.D}</span>` +
        `<span class="g3-chip">AI O: ${score.O}</span>`;
    }
    function updateButtons() {
      undoB.disabled = busy || over || hist.length === 0;
    }

    // ----- alur permainan -----
    async function humanMove(i) {
      if (busy || over || board[i]) return;
      busy = true;
      const g = gen;
      board[i] = "X";
      hist.push({ i, p: "X" });
      updateButtons();
      await place(i, "X");
      if (g !== gen) return;

      if (winnerOf(board) || board.every(Boolean)) return end();

      setStatus("AI sedang berpikir...");
      await e.wait(420);
      if (g !== gen) return;

      const mv = bestMove(board);
      board[mv] = "O";
      hist.push({ i: mv, p: "O" });
      await place(mv, "O");
      if (g !== gen) return;

      if (winnerOf(board) || board.every(Boolean)) return end();

      busy = false;
      setStatus("Giliranmu: X");
      updateButtons();
    }

    function end() {
      const w = winnerOf(board);
      over = true;
      busy = false;
      if (w) {
        drawLine(w.line);
        if (w.p === "X") { score.X++; e.sfx("end"); setStatus("Kamu menang! 🎉"); }
        else { score.O++; e.sfx("lose"); setStatus("AI menang. Coba lagi!"); }
      } else {
        score.D++;
        e.sfx("ok"); setStatus("Seri!");
      }
      renderChips();
      updateButtons();
    }

    function undo() {
      if (busy || over || hist.length === 0) return;
      for (let k = 0; k < 2 && hist.length; k++) {
        const m = hist.pop();
        board[m.i] = "";
        if (pieces[m.i]) { e.scene.remove(pieces[m.i]); pieces[m.i] = null; }
      }
      setStatus("Giliranmu: X");
      updateButtons();
    }

    function reset() {
      gen++;
      busy = false;
      over = false;
      board = Array(9).fill("");
      hist = [];
      pieces.forEach((g, i) => {
        if (g) { e.scene.remove(g); pieces[i] = null; }
      });
      if (lineMesh) {
        e.scene.remove(lineMesh);
        lineMesh.geometry.dispose();
        lineMesh.material.dispose();
        lineMesh = null;
      }
      setStatus("Giliranmu: X");
      updateButtons();
    }

    e.on(e.renderer.domElement, "pointerdown", ev => {
      if (ev.button > 0) return;
      const hit = e.pick(ev.clientX, ev.clientY, cells);
      if (hit) humanMove(hit.key);
    });

    e.onTick((dt, t) => {
      if (lineMesh) lineMesh.material.emissiveIntensity = 0.5 + 0.4 * Math.sin(t * 6);
    });

    renderChips();
    setStatus("Giliranmu: X");
    updateButtons();
  }
};
