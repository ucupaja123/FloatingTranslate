// ==================== LUDO KING 3D (versi sederhana) ====================
// Logika dari game asli: lintasan 0-30, lempar dadu bergantian dengan AI,
// siapa sampai 30 dulu menang lalu posisi direset.
import { THREE } from "./engine.js";

const GOAL = 30;
const TRACK = GOAL + 1;   // kotak 0..30
const RAD = 4.2;
const STEP_MS = 170;

// Muka dadu: nilai -> arah normal yang harus menghadap ke atas
const NORMAL = {
  1: [0, 1, 0], 6: [0, -1, 0],
  2: [0, 0, 1], 5: [0, 0, -1],
  3: [1, 0, 0], 4: [-1, 0, 0]
};
// Urutan material BoxGeometry: +x, -x, +y, -y, +z, -z
const FACE_VALUES = [3, 4, 1, 6, 2, 5];

const PIP_POS = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8]
};
const GRID = [0.25, 0.5, 0.75];

function tileXZ(k) {
  const a = -Math.PI / 2 + (k / TRACK) * Math.PI * 2;
  return [Math.cos(a) * RAD, Math.sin(a) * RAD];
}

export default {
  id: "ludo",
  title: "Ludo King",
  icon: "🎲",
  desc: "Lempar dadu, lalu lari ke kotak 30 sebelum AI.",
  opts: { bg: 0x1f2a44, camPos: [0, 10, 8.5], lookAt: [0, 0, 0], fov: 46, fit: { w: 11.8, h: 12.6 } },

  mount(e) {
    let pPos = 0, aPos = 0, busy = false, over = false, gen = 0;
    let wins = 0, losses = 0, rolling = false, lastDice = 1;

    // ----- lintasan -----
    const tileGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.16, 22);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(RAD + 1.1, RAD + 1.1, 0.3, 64), e.mat(0x2b3a5c));
    base.position.y = -0.2;
    base.receiveShadow = true;
    e.scene.add(base);

    for (let k = 0; k < TRACK; k++) {
      const color = k === 0 ? 0x3ddc84 : k === GOAL ? 0xffd23f : (k % 5 === 0 ? 0x5cc8ff : 0xfff3d6);
      const t = new THREE.Mesh(tileGeo, e.mat(color));
      const [x, z] = tileXZ(k);
      t.position.set(x, 0.04, z);
      t.receiveShadow = true;
      e.scene.add(t);
      const lb = e.label(k, { w: 0.6, h: 0.6, color: "#111", font: "bold 150px sans-serif" });
      lb.rotation.x = -Math.PI / 2;
      lb.position.set(x, 0.13, z);
      e.scene.add(lb);
    }

    // ----- pion -----
    function makePawn(color) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0, 0.34, 0.8, 16), e.mat(color));
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), e.mat(color));
      head.position.y = 0.5;
      body.castShadow = head.castShadow = true;
      g.add(body, head);
      e.scene.add(g);
      return g;
    }
    const pawns = { pl: makePawn(0x3b8bff), ai: makePawn(0xff5d73) };

    function pawnXZ(who, k) {
      const [x, z] = tileXZ(k);
      const len = Math.hypot(x, z);
      const off = who === "pl" ? -0.36 : 0.36;
      return [x + (x / len) * off, z + (z / len) * off];
    }
    function snap(who, k) {
      const [x, z] = pawnXZ(who, k);
      pawns[who].position.set(x, 0.5, z);
    }

    async function hop(who, k) {
      e.sfx("tick");
      const p = pawns[who];
      const x0 = p.position.x, z0 = p.position.z;
      const [x1, z1] = pawnXZ(who, k);
      await e.tween(STEP_MS, s => {
        p.position.x = x0 + (x1 - x0) * s;
        p.position.z = z0 + (z1 - z0) * s;
        p.position.y = 0.5 + Math.sin(s * Math.PI) * 0.7;
      });
      p.position.y = 0.5;
    }

    // ----- dadu -----
    const pipsMats = [1, 2, 3, 4, 5, 6].map(v => new THREE.MeshStandardMaterial({
      roughness: 0.4,
      map: e.canvasTexture([128, 128], (g, W, H) => {
        g.fillStyle = "#fffdf5";
        g.fillRect(0, 0, W, H);
        g.fillStyle = "#111";
        for (const idx of PIP_POS[v]) {
          const x = GRID[idx % 3] * W, y = GRID[Math.floor(idx / 3)] * H;
          g.beginPath();
          g.arc(x, y, W * 0.08, 0, Math.PI * 2);
          g.fill();
        }
      })
    }));
    const dieMats = FACE_VALUES.map(v => pipsMats[v - 1]);
    const dice = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), dieMats);
    dice.position.set(0, 0.9, 0);
    dice.castShadow = true;
    e.scene.add(dice);

    async function rollDie() {
      e.sfx("dice");
      const v = 1 + Math.floor(Math.random() * 6);
      rolling = true;
      const g = gen;
      await e.wait(850);
      rolling = false;
      if (g !== gen) return v;
      const qStart = dice.quaternion.clone();
      const n = new THREE.Vector3(...NORMAL[v]);
      const qEnd = new THREE.Quaternion().setFromUnitVectors(n, new THREE.Vector3(0, 1, 0));
      await e.tween(330, k => dice.quaternion.slerpQuaternions(qStart, qEnd, k));
      lastDice = v;
      renderChips();
      return v;
    }

    // ----- HUD -----
    const st = document.createElement("div");
    st.className = "g3-status";
    const chips = document.createElement("div");
    chips.className = "g3-row";
    const row = document.createElement("div");
    row.className = "g3-row";
    const rollB = document.createElement("button");
    rollB.type = "button";
    rollB.className = "gbtn hot";
    rollB.textContent = "🎲 Lempar";
    e.on(rollB, "click", playerTurn);
    const resetB = document.createElement("button");
    resetB.type = "button";
    resetB.className = "gbtn";
    resetB.textContent = "Ulang";
    e.on(resetB, "click", resetAll);
    row.append(rollB, resetB);
    e.hud.append(st, chips, row);

    function setStatus(t) { st.textContent = t; }
    function renderChips() {
      chips.innerHTML =
        `<span class="g3-chip">Kamu ${pPos}/${GOAL}</span>` +
        `<span class="g3-chip">Dadu ${lastDice}</span>` +
        `<span class="g3-chip">AI ${aPos}/${GOAL}</span>` +
        `<span class="g3-chip">Menang ${wins}-${losses}</span>`;
    }
    function setRollable(on) { rollB.disabled = !on; }

    async function moveSteps(who, steps) {
      const g = gen;
      let pos = who === "pl" ? pPos : aPos;
      const target = Math.min(pos + steps, GOAL);
      for (let k = pos + 1; k <= target; k++) {
        if (g !== gen) return;
        await hop(who, k);
        if (who === "pl") pPos = k; else aPos = k;
        renderChips();
      }
    }

    function roundWin(who) {
      e.sfx(who === "pl" ? "end" : "lose");
      if (who === "pl") { wins++; setStatus("🎉 YOU WIN! 🎉"); }
      else { losses++; setStatus("💀 AI menang. Coba lagi!"); }
      pPos = 0; aPos = 0;
      snap("pl", 0);
      snap("ai", 0);
      renderChips();
    }

    async function playerTurn() {
      if (busy || over) return;
      busy = true;
      setRollable(false);
      const g = gen;
      setStatus("Dadu dilempar...");
      const d = await rollDie();
      if (g !== gen) return;

      setStatus(`Kamu dapat ${d}`);
      await moveSteps("pl", d);
      if (g !== gen) return;

      if (pPos >= GOAL) { roundWin("pl"); return endTurn(g); }

      setStatus("Giliran AI...");
      await e.wait(900);
      if (g !== gen) return;

      const ad = await rollDie();
      if (g !== gen) return;
      setStatus(`AI dapat ${ad}`);
      await moveSteps("ai", ad);
      if (g !== gen) return;

      if (aPos >= GOAL) { roundWin("ai"); return endTurn(g); }

      setStatus("Giliran kamu!");
      endTurn(g);
    }

    function endTurn(g) {
      if (g !== gen) return;
      busy = false;
      setRollable(true);
      renderChips();
    }

    function resetAll() {
      gen++;
      busy = false;
      pPos = 0; aPos = 0; wins = 0; losses = 0; lastDice = 1;
      rolling = false;
      snap("pl", 0);
      snap("ai", 0);
      dice.quaternion.identity();
      setStatus("Giliranmu! Lempar dadu.");
      setRollable(true);
      renderChips();
    }

    e.onTick((dt) => {
      if (rolling) {
        dice.rotation.x += dt * 14;
        dice.rotation.y += dt * 11;
      }
    });

    snap("pl", 0);
    snap("ai", 0);
    setStatus("Giliranmu! Lempar dadu.");
    renderChips();
  }
};
