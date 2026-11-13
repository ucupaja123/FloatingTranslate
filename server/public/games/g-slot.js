// ==================== SLOT MACHINE 3D ====================
// Logika dari game asli: koin 100 awal, taruhan 5-50, pembayaran sama.
import { THREE } from "./engine.js";

const ICONS = ["🍒", "🍊", "🍋", "🍉", "⭐", "💎", "7️⃣", "🎰"];
const SEG = ICONS.length;
const R = 1.25;          // jari-jari gulungan
const TAU = Math.PI * 2;

function calcWin(s, bet) {
  const [a, b, c] = s;
  if (a === "7️⃣" && b === a && c === a) return bet * 10;
  if (a === "💎" && b === a && c === a) return bet * 8;
  if (a === "⭐" && b === a && c === a) return bet * 6;
  if (a === b && b === c) return bet * 3;
  if (a === b || b === c || a === c) return bet * 1;
  return 0;
}

export default {
  id: "slot",
  title: "Slot Machine",
  icon: "🎰",
  desc: "Putar 3 gulungan 3D. Tiga sama = menang besar. Ada bonus gratis.",
  opts: { bg: 0x1a0f2e, camPos: [0, 2.6, 11], lookAt: [0, 0.3, 0], fov: 40, fit: { w: 10.4, h: 7.4 } },

  mount(e) {
    let score = 100, bet = 10, spinning = false;

    // ----- rumah mesin -----
    const body = new THREE.Mesh(new THREE.BoxGeometry(9.2, 4.6, 1.2), e.mat(0xc2185b));
    body.position.set(0, 0.2, -1.0);
    body.castShadow = true;
    body.receiveShadow = true;
    e.scene.add(body);

    const win = new THREE.Mesh(new THREE.BoxGeometry(7.6, 2.9, 0.2), e.mat(0x0d0718));
    win.position.set(0, 0.2, -0.35);
    e.scene.add(win);

    const payline = new THREE.Mesh(
      new THREE.BoxGeometry(7.8, 0.06, 0.1),
      e.mat(0xffd23f, { emissive: 0xffaa00, emissiveIntensity: 0.8 })
    );
    payline.position.set(0, 0.2, 0.1);
    e.scene.add(payline);

    // ----- gulungan -----
    const faceMats = ICONS.map(ch => new THREE.MeshBasicMaterial({
      map: e.canvasTexture([256, 256], (g, W, H) => {
        g.fillStyle = "#fff8e7";
        g.fillRect(0, 0, W, H);
        g.font = "180px serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(ch, W / 2, H / 2 + 10);
      })
    }));
    const faceGeo = new THREE.PlaneGeometry(1.5, 0.98);
    const coreGeo = new THREE.CylinderGeometry(R - 0.05, R - 0.05, 1.7, 28);
    const coreMat = e.mat(0x2b1b44);

    function makeReel(x) {
      const g = new THREE.Group();
      g.position.set(x, 0.2, 0);
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.rotation.z = Math.PI / 2;
      g.add(core);
      for (let i = 0; i < SEG; i++) {
        const al = (i / SEG) * TAU;
        const f = new THREE.Mesh(faceGeo, faceMats[i]);
        f.position.set(0, -R * Math.sin(al), R * Math.cos(al));
        f.rotation.x = al;
        g.add(f);
      }
      e.scene.add(g);
      return g;
    }
    const reels = [makeReel(-2.5), makeReel(0), makeReel(2.5)];

    // Putar gulungan sampai muka index `idx` menghadap depan
    function spinReel(reel, idx, ms, extra) {
      const cur = reel.rotation.x;
      const want = -((idx / SEG) * TAU);
      const diff = ((want - cur) % TAU + TAU) % TAU;
      const end = cur + extra * TAU + diff;
      return e.tween(ms, k => { reel.rotation.x = cur + (end - cur) * k; });
    }

    // ----- HUD -----
    const st = document.createElement("div");
    st.className = "g3-status";
    const chips = document.createElement("div");
    chips.className = "g3-row";
    const row1 = document.createElement("div");
    row1.className = "g3-row";
    const row2 = document.createElement("div");
    row2.className = "g3-row";

    const btn = (label, cls, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "gbtn " + (cls || "");
      b.textContent = label;
      e.on(b, "click", fn);
      return b;
    };
    const minusB = btn("−5", "", () => changeBet(-5));
    const plusB = btn("+5", "", () => changeBet(5));
    const spinB = btn("SPIN", "hot", spin);
    const freeB = btn("+50 gratis", "ok", takeFreeCoins);
    row1.append(minusB, spinB, plusB);
    row2.append(freeB);
    e.hud.append(st, chips, row1, row2);

    function setStatus(t) { st.textContent = t; }
    function renderChips() {
      chips.innerHTML = `<span class="g3-chip">🪙 ${score}</span><span class="g3-chip">Taruhan ${bet}</span>`;
    }
    function setBusy(on) {
      spinning = on;
      spinB.disabled = on;
      minusB.disabled = on;
      plusB.disabled = on;
      freeB.disabled = on;
    }

    async function spin() {
      if (spinning) return;
      if (score < bet) {
        setStatus("❌ Saldo tidak cukup!");
        return;
      }
      setBusy(true);
      e.sfx("reel");
      score -= bet;
      renderChips();
      setStatus("🔄 Memutar...");

      const res = reels.map(() => Math.floor(Math.random() * SEG));
      await Promise.all(reels.map((r, i) => spinReel(r, res[i], 1300 + i * 450, 4 + i)));

      const sym = res.map(i => ICONS[i]);
      const w = calcWin(sym, bet);
      if (w > 0) {
        score += w;
        e.sfx(w >= bet * 6 ? "jackpot" : "coin");
        setStatus(`🎉 MENANG! +${w} koin! 🎉`);
      } else {
        e.sfx("bad");
        setStatus("😢 Coba lagi!");
      }
      renderChips();
      setBusy(false);
    }

    function changeBet(amount) {
      if (spinning) return;
      const nb = bet + amount;
      if (nb >= 5 && nb <= 50) bet = nb;
      renderChips();
    }

    function takeFreeCoins() {
      if (spinning) return;
      score += 50;
      e.sfx("coin");
      setStatus("🎁 +50 koin gratis! 🎁");
      renderChips();
    }

    e.onTick((dt, t) => {
      payline.material.emissiveIntensity = 0.5 + 0.4 * Math.sin(t * 5);
    });

    renderChips();
    setStatus("Tekan SPIN untuk mulai!");
  }
};
