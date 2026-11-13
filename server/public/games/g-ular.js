// ==================== ULAR TANGGA 3D ====================
// Logika dari game asli: papan 1-100, tangga & ular yang sama, lawan bot
// (Easy / Normal / Impossible), koin dari menang, skin bisa dibuka dengan koin.
import { THREE } from "./engine.js";

const TANGGA = { 4: 14, 9: 31, 20: 38, 28: 84, 40: 59, 63: 81 };
const ULAR = { 17: 7, 54: 34, 62: 19, 64: 60, 87: 24, 95: 75, 99: 78 };
const SKIN_COLOR = { Cobra: 0x3b8bff, Python: 0x3ddc84, Viper: 0xb36bff };
const SKIN_PRICE = 100;
const LEVELS = ["Easy", "Normal", "Impossible"];
const STEP_MS = 230;
const UP = new THREE.Vector3(0, 1, 0);

// Posisi 3D kotak nomor n (1..100). Baris 0 di dekat kamera, baris ganjil berbalik.
function tileV(n, y) {
  const idx = n - 1;
  const r = Math.floor(idx / 10);
  const k = idx % 10;
  const c = r % 2 === 0 ? k : 9 - k;
  return new THREE.Vector3(c - 4.5, y, 4.5 - r);
}

// Batang silinder antara dua titik
function bar(p1, p2, radius, material) {
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 8), material);
  m.position.copy(p1).add(p2).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  m.castShadow = true;
  return m;
}

// Dadu kubus dengan pip di setiap muka
const NORMAL = { 1: [0, 1, 0], 6: [0, -1, 0], 2: [0, 0, 1], 5: [0, 0, -1], 3: [1, 0, 0], 4: [-1, 0, 0] };
const FACE_VALUES = [3, 4, 1, 6, 2, 5];
const PIP_POS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const GRID = [0.25, 0.5, 0.75];

export default {
  id: "ular",
  title: "Ular Tangga",
  icon: "🪜",
  desc: "Papan 1-100 dengan tangga dan ular. Lawan bot, menangkan koin.",
  opts: { bg: 0x1d2b1f, camPos: [0, 13, 13], lookAt: [0, 0, 1.2], fov: 44, fit: { w: 12.6, h: 15.2 } },

  mount(e) {
    let pos = { pl: 1, ai: 1 };
    let busy = false, over = false, gen = 0;
    let level = "Easy";
    let coins = 0;
    const skins = { Cobra: true, Python: false, Viper: false };
    let skin = "Cobra";
    let lastDice = 1, rolling = false;

    // ----- papan -----
    const base = new THREE.Mesh(new THREE.BoxGeometry(11.0, 0.4, 11.0), e.mat(0x3a2a18));
    base.position.y = -0.3;
    base.receiveShadow = true;
    e.scene.add(base);

    const matA = e.mat(0xfff3d6), matB = e.mat(0xb8e6a0);
    for (let n = 1; n <= 100; n++) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.16, 0.94), (n + Math.floor((n - 1) / 10)) % 2 ? matA : matB);
      t.position.copy(tileV(n, 0));
      t.receiveShadow = true;
      e.scene.add(t);
      const lb = e.label(n, { w: 0.6, h: 0.6, color: "#111", font: "bold 150px sans-serif" });
      lb.rotation.x = -Math.PI / 2;
      lb.position.copy(tileV(n, 0.09));
      e.scene.add(lb);
    }

    // ----- tangga -----
    const ladderMat = e.mat(0xc98b4a);
    for (const key of Object.keys(TANGGA)) {
      const a = tileV(Number(key), 0.35), b = tileV(TANGGA[key], 0.35);
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      dir.normalize();
      const side = new THREE.Vector3().crossVectors(dir, UP).normalize().multiplyScalar(0.22);
      e.scene.add(bar(a.clone().add(side), b.clone().add(side), 0.05, ladderMat));
      e.scene.add(bar(a.clone().sub(side), b.clone().sub(side), 0.05, ladderMat));
      const rungs = Math.max(2, Math.floor(len / 0.45));
      for (let i = 1; i < rungs; i++) {
        const c = a.clone().lerp(b, i / rungs);
        e.scene.add(bar(c.clone().add(side), c.clone().sub(side), 0.035, ladderMat));
      }
    }

    // ----- ular -----
    const snakeMat = e.mat(0xff5d73);
    const eyeMat = e.mat(0x111111);
    for (const key of Object.keys(ULAR)) {
      const h = tileV(Number(key), 0.4), t = tileV(ULAR[key], 0.15);
      const dir = new THREE.Vector3().subVectors(t, h).normalize();
      const side = new THREE.Vector3().crossVectors(dir, UP).normalize();
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const k = i / 8;
        const p = h.clone().lerp(t, k).add(side.clone().multiplyScalar(Math.sin(k * Math.PI * 3) * 0.45));
        p.y = 0.25 + Math.sin(k * Math.PI) * 0.35;
        pts.push(p);
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 60, 0.1, 8, false), snakeMat);
      tube.castShadow = true;
      e.scene.add(tube);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), snakeMat);
      head.position.copy(pts[0]);
      e.scene.add(head);
      for (const sx of [-0.07, 0.07]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), eyeMat);
        eye.position.set(sx, 0.08, 0.13);
        head.add(eye);
      }
    }

    // ----- pion -----
    const plMat = e.mat(SKIN_COLOR[skin]);
    function makePawn(material) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.22, 0.4, 14), material);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), material);
      head.position.y = 0.36;
      body.castShadow = head.castShadow = true;
      g.add(body, head);
      e.scene.add(g);
      return g;
    }
    const pawns = { pl: makePawn(plMat), ai: makePawn(e.mat(0xff5d73)) };

    function pawnPos(who, n) {
      const v = tileV(n, 0.3);
      v.x += who === "pl" ? -0.22 : 0.22;
      return v;
    }
    function snap(who, n) { pawns[who].position.copy(pawnPos(who, n)); }

    async function hop(who, n) {
      e.sfx("pop");
      const p = pawns[who];
      const a = p.position.clone();
      const b = pawnPos(who, n);
      await e.tween(STEP_MS, s => {
        p.position.lerpVectors(a, b, s);
        p.position.y = 0.3 + Math.sin(s * Math.PI) * 0.6;
      });
      p.position.y = 0.3;
    }
    async function jump(who, n) {
      const p = pawns[who];
      const a = p.position.clone();
      const b = pawnPos(who, n);
      await e.tween(650, s => {
        p.position.lerpVectors(a, b, s);
        p.position.y = 0.3 + Math.sin(s * Math.PI) * 2.2;
      });
      p.position.y = 0.3;
    }

    // ----- dadu -----
    const pipsMats = [1, 2, 3, 4, 5, 6].map(v => new THREE.MeshStandardMaterial({
      roughness: 0.4,
      map: e.canvasTexture([128, 128], (g, W, H) => {
        g.fillStyle = "#fffdf5";
        g.fillRect(0, 0, W, H);
        g.fillStyle = "#111";
        for (const idx of PIP_POS[v]) {
          g.beginPath();
          g.arc(GRID[idx % 3] * W, GRID[Math.floor(idx / 3)] * H, W * 0.08, 0, Math.PI * 2);
          g.fill();
        }
      })
    }));
    const dice = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), FACE_VALUES.map(v => pipsMats[v - 1]));
    dice.position.set(0, 0.7, 7.4);
    dice.castShadow = true;
    e.scene.add(dice);

    function botRoll() {
      if (level === "Easy") return 1 + Math.floor(Math.random() * 6);
      let best = 1, bestScore = -999;
      for (let i = 1; i <= 6; i++) {
        const t = pos.ai + i;
        let s = t;
        if (TANGGA[t]) s += 20;
        if (ULAR[t]) s -= 30;
        if (level === "Impossible") {
          for (let j = 1; j <= 6; j++) {
            const f = t + j;
            if (TANGGA[f]) s += 10;
            if (ULAR[f]) s -= 15;
          }
        }
        if (s > bestScore) { bestScore = s; best = i; }
      }
      return best;
    }

    async function animateDie(v) {
      e.sfx("dice");
      rolling = true;
      const g = gen;
      await e.wait(800);
      rolling = false;
      if (g !== gen) return;
      const qStart = dice.quaternion.clone();
      const qEnd = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...NORMAL[v]), UP);
      await e.tween(320, k => dice.quaternion.slerpQuaternions(qStart, qEnd, k));
      lastDice = v;
      renderChips();
    }

    // ----- HUD -----
    const st = document.createElement("div");
    st.className = "g3-status";
    const chips = document.createElement("div");
    chips.className = "g3-chip-wrap g3-row";
    const row = document.createElement("div");
    row.className = "g3-row";
    const btn = (label, cls, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "gbtn " + (cls || "");
      b.textContent = label;
      e.on(b, "click", fn);
      return b;
    };
    const rollB = btn("🎲 Lempar", "hot", humanTurn);
    const levelB = btn("", "", () => {
      level = LEVELS[(LEVELS.indexOf(level) + 1) % LEVELS.length];
      renderButtons();
    });
    const skinB = btn("", "", () => {
      const list = Object.keys(skins).filter(k => skins[k]);
      skin = list[(list.indexOf(skin) + 1) % list.length];
      plMat.color.setHex(SKIN_COLOR[skin]);
      renderButtons();
    });
    const buyB = btn("", "ok", () => {
      const next = Object.keys(skins).find(k => !skins[k]);
      if (!next || coins < SKIN_PRICE) return;
      coins -= SKIN_PRICE;
      skins[next] = true;
      setStatus(`Skin ${next} terbuka!`);
      renderChips();
      renderButtons();
    });
    const resetB = btn("Ulang", "", resetAll);
    row.append(rollB, levelB, skinB, buyB, resetB);
    e.hud.append(st, chips, row);

    function setStatus(t) { st.textContent = t; }
    function renderChips() {
      chips.innerHTML =
        `<span class="g3-chip">Kamu ${pos.pl}</span>` +
        `<span class="g3-chip">Dadu ${lastDice}</span>` +
        `<span class="g3-chip">Bot ${pos.ai}</span>` +
        `<span class="g3-chip">🪙 ${coins}</span>`;
    }
    function renderButtons() {
      levelB.textContent = `Bot: ${level}`;
      skinB.textContent = `Skin: ${skin}`;
      const locked = Object.keys(skins).find(k => !skins[k]);
      buyB.textContent = locked ? `Buka ${locked} (${SKIN_PRICE}🪙)` : "Semua skin terbuka";
      buyB.disabled = !locked || coins < SKIN_PRICE;
      rollB.disabled = busy || over;
      levelB.disabled = busy;
      skinB.disabled = busy;
      resetB.disabled = busy;
    }

    async function oneMove(who) {
      const g = gen;
      const v = who === "ai" ? botRoll() : 1 + Math.floor(Math.random() * 6);
      setStatus(`${who === "pl" ? "Kamu" : "Bot"} melempar...`);
      await animateDie(v);
      if (g !== gen) return;
      setStatus(`${who === "pl" ? "Kamu" : "Bot"} dapat ${v}`);

      const start = pos[who];
      const raw = start + v;
      const target = Math.min(raw, 100);
      for (let n = start + 1; n <= target; n++) {
        await hop(who, n);
        if (g !== gen) return;
        pos[who] = n;
        renderChips();
      }
      if (raw >= 100) return win(who);

      const tangga = TANGGA[pos[who]];
      const ular = ULAR[pos[who]];
      if (tangga !== undefined || ular !== undefined) {
        const to = tangga !== undefined ? tangga : ular;
        e.sfx(tangga !== undefined ? "coin" : "bad");
        setStatus(tangga !== undefined ? "🪜 Naik tangga!" : "🐍 Kena ular!");
        await jump(who, to);
        if (g !== gen) return;
        pos[who] = to;
        renderChips();
      }
    }

    function win(who) {
      over = true;
      busy = false;
      if (who === "pl") {
        coins += 50;
        e.sfx("jackpot"); setStatus("🏆 KAMU MENANG! +50 koin");
      } else {
        e.sfx("lose"); setStatus("Bot menang. Coba lagi!");
      }
      renderChips();
      renderButtons();
    }

    async function humanTurn() {
      if (busy || over) return;
      busy = true;
      renderButtons();
      const g = gen;
      await oneMove("pl");
      if (g !== gen || over) return;
      await e.wait(700);
      if (g !== gen) return;
      await oneMove("ai");
      if (g !== gen || over) return;
      busy = false;
      setStatus("Giliranmu! Lempar dadu.");
      renderButtons();
    }

    function resetAll() {
      gen++;
      busy = false;
      over = false;
      pos = { pl: 1, ai: 1 };
      lastDice = 1;
      rolling = false;
      snap("pl", 1);
      snap("ai", 1);
      dice.quaternion.identity();
      setStatus("Giliranmu! Lempar dadu.");
      renderChips();
      renderButtons();
    }

    e.onTick(dt => {
      if (rolling) {
        dice.rotation.x += dt * 14;
        dice.rotation.y += dt * 11;
      }
    });

    snap("pl", 1);
    snap("ai", 1);
    setStatus("Giliranmu! Lempar dadu.");
    renderChips();
    renderButtons();
  }
};
