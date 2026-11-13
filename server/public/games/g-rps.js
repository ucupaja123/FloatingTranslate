// ==================== GUNTING BATU KERTAS 3D ====================
// Logika dari game asli: hitung mundur 3-2-1, pilih senjata, lawan acak,
// first to 3. Varian "Suit Game" di file asli sama aturannya, jadi digabung.
import { THREE } from "./engine.js";

const CH = ["batu", "gunting", "kertas"];
const LABEL = { batu: "🪨 Batu", gunting: "✂️ Gunting", kertas: "📄 Kertas" };

function determine(player, ai) {
  if (player === ai) return "draw";
  if (
    (player === "batu" && ai === "gunting") ||
    (player === "gunting" && ai === "kertas") ||
    (player === "kertas" && ai === "batu")
  ) return "win";
  return "lose";
}

export default {
  id: "rps",
  title: "Gunting Batu Kertas",
  icon: "✊",
  desc: "Best of 3 ronde lawan AI. Hitung mundur, lalu pilih cepat!",
  opts: { bg: 0x1b2a3a, camPos: [0, 7.5, 9.5], lookAt: [0, 0.6, 0], fov: 46, fit: { w: 11.4, h: 9.8 } },

  mount(e) {
    let p = 0, a = 0, canSelect = false, shaking = false, gen = 0;
    let plGroup = null, aiGroup = null;
    const choiceBtns = {};

    // ----- meja -----
    const table = new THREE.Mesh(
      new THREE.CylinderGeometry(4.6, 4.6, 0.3, 48),
      e.mat(0x2a7a55)
    );
    table.position.y = -0.2;
    table.receiveShadow = true;
    e.scene.add(table);

    // ----- bentuk tangan (3D) -----
    function makeHand(kind, color) {
      const g = new THREE.Group();
      const m = e.mat(color);
      if (kind === "batu") {
        const r = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 1), m);
        r.castShadow = true;
        g.add(r);
      } else if (kind === "kertas") {
        const pap = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 1.2), m);
        pap.rotation.x = -0.35;
        pap.castShadow = true;
        g.add(pap);
      } else if (kind === "gunting") {
        const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 1.7), m);
        const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 1.7), m);
        b1.position.set(0, 0, 0.5); b1.rotation.y = 0.35;
        b2.position.set(0, 0, 0.5); b2.rotation.y = -0.35;
        const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.07, 10, 24), m);
        const ring2 = ring1.clone();
        ring1.position.set(-0.45, 0, -0.35);
        ring2.position.set(0.45, 0, -0.35);
        b1.castShadow = b2.castShadow = true;
        g.add(b1, b2, ring1, ring2);
      } else {
        // kepalan (menunggu)
        const f = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, 1.2), m);
        f.castShadow = true;
        g.add(f);
        const q = e.label("?", { w: 0.9, h: 0.9, color: "#111", bgc: null, font: "bold 150px sans-serif" });
        q.position.set(0, 1.1, 0.7);
        q.rotation.x = -0.55;
        g.add(q);
      }
      return g;
    }

    function clearHands() {
      for (const g of [plGroup, aiGroup]) {
        if (!g) continue;
        e.scene.remove(g);
      }
      plGroup = aiGroup = null;
    }

    function placeHand(side, kind) {
      const x = side === "pl" ? -2.6 : 2.6;
      const color = side === "pl" ? 0xffd23f : 0x5cc8ff;
      const g = makeHand(kind, color);
      g.position.set(x, 0.9, 0);
      if (side === "ai") g.rotation.y = Math.PI;
      e.scene.add(g);
      if (side === "pl") plGroup = g; else aiGroup = g;
      return g;
    }

    function reveal(side, kind) {
      e.sfx("pop");
      const old = side === "pl" ? plGroup : aiGroup;
      if (old) e.scene.remove(old);
      const g = placeHand(side, kind);
      g.scale.setScalar(0.2);
      e.tween(380, k => { g.scale.setScalar(0.2 + 0.8 * k); });
    }

    // ----- HUD -----
    const st = document.createElement("div");
    st.className = "g3-status";
    const chips = document.createElement("div");
    chips.className = "g3-row";
    const row = document.createElement("div");
    row.className = "g3-row";
    const startBtn = document.createElement("button");
    startBtn.type = "button";
    startBtn.className = "gbtn hot";
    startBtn.textContent = "MULAI";
    e.on(startBtn, "click", startMatch);
    row.appendChild(startBtn);
    for (const c of CH) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "gbtn";
      b.textContent = LABEL[c];
      b.disabled = true;
      e.on(b, "click", () => choose(c));
      choiceBtns[c] = b;
      row.appendChild(b);
    }
    e.hud.append(st, chips, row);

    function setStatus(t) { st.textContent = t; }
    function renderChips() {
      chips.innerHTML = `<span class="g3-chip">Kamu ${p}</span><span class="g3-chip">AI ${a}</span>`;
    }
    function setChoices(on) {
      for (const c of CH) choiceBtns[c].disabled = !on;
    }

    async function countdown(g) {
      canSelect = false;
      setChoices(false);
      clearHands();
      placeHand("pl", "kepal");
      placeHand("ai", "kepal");
      shaking = true;
      for (const s of ["3", "2", "1"]) {
        e.sfx("tick");
        setStatus(s);
        await e.wait(700);
        if (g !== gen) return;
      }
      setStatus("MULAI!");
      await e.wait(400);
      if (g !== gen) return;
      shaking = false;
      canSelect = true;
      setStatus("Pilih senjatamu!");
      setChoices(true);
    }

    function startMatch() {
      gen++;
      const g = gen;
      p = 0; a = 0;
      renderChips();
      startBtn.disabled = true;
      startBtn.textContent = "Berjalan...";
      countdown(g);
    }

    async function choose(c) {
      if (!canSelect) return;
      const g = gen;
      canSelect = false;
      setChoices(false);
      shaking = true;
      setStatus("Lawan memilih...");
      const aiPick = CH[Math.floor(Math.random() * 3)];
      await e.wait(800);
      if (g !== gen) return;
      shaking = false;

      reveal("pl", c);
      reveal("ai", aiPick);
      const r = determine(c, aiPick);
      e.sfx(r === "win" ? "ok" : r === "lose" ? "bad" : "tick");
      if (r === "win") { p++; setStatus("Kamu menang ronde ini! ✨"); }
      else if (r === "lose") { a++; setStatus("Kamu kalah ronde ini."); }
      else setStatus("Seri!");
      renderChips();

      await e.wait(1000);
      if (g !== gen) return;

      if (p >= 3) return matchEnd("KAMU MENANG MATCH! 🏆");
      if (a >= 3) return matchEnd("AI menang match. Coba lagi!");

      setStatus("Ronde berikutnya...");
      await e.wait(500);
      if (g !== gen) return;
      countdown(g);
    }

    function matchEnd(msg) {
      e.sfx(msg.includes("KAMU") ? "end" : "lose");
      canSelect = false;
      setChoices(false);
      setStatus(msg);
      startBtn.disabled = false;
      startBtn.textContent = "Main lagi";
    }

    e.onTick((dt, t) => {
      if (!shaking) return;
      const s = Math.sin(t * 16) * 0.2;
      if (plGroup) plGroup.rotation.z = s;
      if (aiGroup) aiGroup.rotation.z = -s;
    });

    renderChips();
    setStatus("Tekan MULAI untuk bermain");
    placeHand("pl", "kepal");
    placeHand("ai", "kepal");
  }
};
