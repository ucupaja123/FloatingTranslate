// ==================== MINESWEEPER 3D ====================
// Logika dari game asli: papan 8x8, peluang ranjau 1/6, buka otomatis
// untuk kotak tanpa tetangga ranjau.
import { THREE } from "./engine.js";

const N = 8;
const MINE_P = 1 / 6;
const COLORS = ["", "#2456ff", "#1c8a3a", "#e0302b", "#4b1c9e", "#8a2b00", "#00838f", "#222", "#666"];

function neighbors(k) {
  const r = Math.floor(k / N), c = k % N;
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < N && nc >= 0 && nc < N) out.push(nr * N + nc);
    }
  }
  return out;
}

const SP = 1.0;
const cx = k => ((k % N) - (N - 1) / 2) * SP;
const cz = k => (Math.floor(k / N) - (N - 1) / 2) * SP;

export default {
  id: "mines",
  title: "Minesweeper",
  icon: "💣",
  desc: "Buka kotak tanpa kena ranjau. Angka = jumlah ranjau di sekitar.",
  opts: { bg: 0xe9f2ff, camPos: [0, 11, 8.5], lookAt: [0, 0, 0], fov: 42, fit: { w: 10.6, h: 12.4 } },

  mount(e) {
    let mines = [], revealed = [], over = false, gen = 0;
    let wins = 0, losses = 0;
    const tiles = [];
    const decor = [];

    const base = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.4, 9.6), e.mat(0x2b2b3a));
    base.position.y = -0.36;
    base.receiveShadow = true;
    e.scene.add(base);

    const tileGeo = new THREE.BoxGeometry(0.92, 0.5, 0.92);
    const hiddenMat = e.mat(0x7aa2ff);
    const openMat = e.mat(0xf4f1e6);
    const mineMat = e.mat(0xff7a8a);
    const bombGeo = new THREE.SphereGeometry(0.22, 18, 14);
    const bombMat = e.mat(0x1d1d28, { metalness: 0.4, roughness: 0.3 });

    for (let k = 0; k < N * N; k++) {
      const t = new THREE.Mesh(tileGeo, hiddenMat);
      t.position.set(cx(k), 0, cz(k));
      t.castShadow = true;
      t.receiveShadow = true;
      t.userData.key = k;
      e.scene.add(t);
      tiles.push(t);
    }

    // ----- HUD -----
    const st = document.createElement("div");
    st.className = "g3-status";
    const chips = document.createElement("div");
    chips.className = "g3-row";
    const row = document.createElement("div");
    row.className = "g3-row";
    const resetB = document.createElement("button");
    resetB.type = "button";
    resetB.className = "gbtn hot";
    resetB.textContent = "Papan baru";
    e.on(resetB, "click", newBoard);
    row.appendChild(resetB);
    e.hud.append(st, chips, row);

    function setStatus(t) { st.textContent = t; }
    function renderChips() {
      const left = revealed.filter((r, k) => !r && !mines[k]).length;
      chips.innerHTML =
        `<span class="g3-chip">Menang: ${wins}</span>` +
        `<span class="g3-chip">Kalah: ${losses}</span>` +
        `<span class="g3-chip">Sisa aman: ${over ? 0 : left}</span>`;
    }

    const adj = k => neighbors(k).reduce((n, j) => n + (mines[j] ? 1 : 0), 0);

    // Buka kotak; kembalikan daftar kotak yang baru terbuka
    function revealFrom(start) {
      const out = [];
      const stack = [start];
      while (stack.length) {
        const k = stack.pop();
        if (revealed[k]) continue;
        revealed[k] = true;
        out.push(k);
        if (mines[k]) continue;
        if (adj(k) === 0) {
          for (const n of neighbors(k)) {
            if (!revealed[n] && !mines[n]) stack.push(n);
          }
        }
      }
      return out;
    }

    function paint(k) {
      e.sfx("pop");
      const t = tiles[k];
      t.material = mines[k] ? mineMat : openMat;
      e.tween(160, p => { t.scale.y = 1 - 0.7 * p; });
      if (mines[k]) {
        const b = new THREE.Mesh(bombGeo, bombMat);
        b.position.set(cx(k), 0.3, cz(k));
        b.castShadow = true;
        e.scene.add(b);
        decor.push(b);
      } else {
        const n = adj(k);
        if (n > 0) {
          const lb = e.label(n, { w: 0.7, h: 0.7, color: COLORS[n], font: "bold 170px sans-serif" });
          lb.rotation.x = -Math.PI / 2;
          lb.position.set(cx(k), 0.1, cz(k));
          e.scene.add(lb);
          decor.push(lb);
        }
      }
    }

    function revealAllMines() {
      for (let k = 0; k < N * N; k++) {
        if (mines[k] && !revealed[k]) {
          revealed[k] = true;
          paint(k);
        }
      }
    }

    function clickTile(k) {
      if (over || revealed[k]) return;
      const g = gen;
      const opened = revealFrom(k);
      for (const j of opened) paint(j);

      if (mines[k]) {
        over = true;
        losses++;
        revealAllMines();
        e.sfx("boom"); setStatus("BOOM! Kamu kena ranjau 💥");
      } else {
        const left = revealed.filter((r, j) => !r && !mines[j]).length;
        if (left === 0) {
          over = true;
          wins++;
          e.sfx("end"); setStatus("Menang! Semua kotak aman 🎉");
        } else {
          setStatus("Terus buka kotak aman...");
        }
      }
      renderChips();
      if (g !== gen) return;
    }

    function newBoard() {
      gen++;
      over = false;
      mines = Array.from({ length: N * N }, () => Math.random() < MINE_P);
      revealed = Array(N * N).fill(false);
      tiles.forEach(t => { t.material = hiddenMat; t.scale.y = 1; });
      for (const d of decor) {
        e.scene.remove(d);
        if (d.geometry) d.geometry.dispose();
        if (d.material && d.material.map) d.material.map.dispose();
        if (d.material) d.material.dispose();
      }
      decor.length = 0;
      setStatus("Ketuk kotak untuk membuka");
      renderChips();
    }

    e.on(e.renderer.domElement, "pointerdown", ev => {
      if (ev.button > 0) return;
      const hit = e.pick(ev.clientX, ev.clientY, tiles);
      if (hit) clickTile(hit.key);
    });

    newBoard();
  }
};
