// ==================== KALKULATOR 3D ====================
// Logika dari game asli: + - × ÷, %, ±, ⌫, C, riwayat hasil.
// Ditambah: urutan operator benar, pembagian nol ditolak, dan keyboard.
import { THREE } from "./engine.js";

const KEYS = [
  ["C", "±", "%", "÷"],
  ["7", "8", "9", "×"],
  ["4", "5", "6", "-"],
  ["1", "2", "3", "+"],
  ["⌫", "0", ".", "="]
];
const OPS = new Set(["+", "-", "*", "/"]);
const MAP = { "×": "*", "÷": "/" };

// Evaluasi ekspresi: * dan / dulu, lalu + dan -. Mendukung minus di depan angka.
function evaluate(s) {
  const toks = s.match(/\d+\.?\d*|\.\d+|[+\-*/]/g) || [];
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const prevIsOp = out.length === 0 || OPS.has(out[out.length - 1]);
    if (t === "-" && prevIsOp) {
      const nxt = toks[++i];
      if (nxt === undefined || OPS.has(nxt)) throw new Error("format");
      out.push(-parseFloat(nxt));
    } else if (OPS.has(t)) {
      out.push(t);
    } else {
      out.push(parseFloat(t));
    }
  }
  if (out.length === 0 || out.length % 2 === 0) throw new Error("format");

  const nums = [out[0]];
  const ops = [];
  for (let i = 1; i < out.length; i += 2) {
    const op = out[i], n = out[i + 1];
    if (op === "*" || op === "/") {
      const last = nums.pop();
      if (op === "/" && n === 0) throw new Error("div0");
      nums.push(op === "*" ? last * n : last / n);
    } else {
      ops.push(op);
      nums.push(n);
    }
  }
  let res = nums[0];
  ops.forEach((op, i) => { res = op === "+" ? res + nums[i + 1] : res - nums[i + 1]; });
  if (!Number.isFinite(res)) throw new Error("nan");
  return res;
}

function fmt(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

export default {
  id: "kalkulator",
  title: "Kalkulator",
  icon: "🧮",
  desc: "Kalkulator 3D. Tekan tombolnya, atau pakai keyboard.",
  opts: { bg: 0x2a2f45, camPos: [0, 12, 9], lookAt: [0, 0, 0.4], fov: 42, fit: { w: 6.6, h: 10.4 } },

  mount(e) {
    let expr = "", display = "0", fresh = true, lastResult = "", history = [];

    // ----- badan kalkulator -----
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.5, 8.4), e.mat(0x3a3f55));
    body.position.set(0, -0.15, 0.6);
    body.castShadow = true;
    body.receiveShadow = true;
    e.scene.add(body);

    // ----- layar LCD -----
    const screenCv = document.createElement("canvas");
    screenCv.width = 512;
    screenCv.height = 200;
    const screenTex = new THREE.CanvasTexture(screenCv);
    screenTex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(4.1, 1.6),
      new THREE.MeshBasicMaterial({ map: screenTex })
    );
    screen.rotation.x = -Math.PI / 2 + 0.25;
    screen.position.set(0, 0.11, -2.9);
    e.scene.add(screen);

    function drawScreen() {
      const g = screenCv.getContext("2d");
      g.fillStyle = "#c9e7c0";
      g.fillRect(0, 0, 512, 200);
      g.fillStyle = "#1d3b1a";
      g.textAlign = "right";
      g.textBaseline = "alphabetic";
      g.font = "32px monospace";
      const top = expr.replace(/\*/g, "×").replace(/\//g, "÷");
      g.fillText(top.slice(-24), 490, 62);
      g.font = "bold 84px monospace";
      const shown = display.length > 12 ? display.slice(0, 12) : display;
      g.fillText(shown, 490, 168);
      screenTex.needsUpdate = true;
    }

    // ----- tombol 3D -----
    const keyGeo = new THREE.BoxGeometry(0.85, 0.32, 0.85);
    const keyMats = {
      num: e.mat(0xf4f1e6),
      op: e.mat(0xffd23f),
      eq: e.mat(0x5cc8ff),
      fn: e.mat(0xb7bfd6)
    };
    const keys = [];
    const values = [];
    KEYS.forEach((rowKeys, r) => {
      rowKeys.forEach((label, c) => {
        const kind = label === "=" ? "eq"
          : ["+", "-", "×", "÷"].includes(label) ? "op"
          : ["C", "±", "%", "⌫"].includes(label) ? "fn" : "num";
        const k = new THREE.Mesh(keyGeo, keyMats[kind]);
        k.position.set((c - 1.5) * 1.05, 0.2, -0.4 + r * 1.05 + 0.6);
        k.castShadow = true;
        k.userData.key = keys.length;
        const lb = e.label(label, { w: 0.7, h: 0.7, color: "#111", font: "bold 130px sans-serif" });
        lb.rotation.x = -Math.PI / 2;
        lb.position.set(0, 0.17, 0);
        k.add(lb);
        e.scene.add(k);
        keys.push(k);
        values.push(label);
      });
    });

    function pressAnim(k) {
      const y0 = k.position.y;
      e.tween(160, p => { k.position.y = y0 - 0.12 * Math.sin(p * Math.PI); });
    }

    // ----- logika -----
    function clearAll() {
      expr = "";
      display = "0";
      fresh = true;
    }

    function addOp(op) {
      if (!expr && (op === "+" || op === "-" || op === "×" || op === "÷")) return;
      let s = expr;
      if (s && OPS.has(s.slice(-1))) s = s.slice(0, -1);
      expr = s + (MAP[op] || op);
      display = expr;
      fresh = false;
    }

    function calc() {
      if (!expr || OPS.has(expr.slice(-1))) return;
      try {
        const r = evaluate(expr);
        const text = fmt(r);
        history.unshift({ expression: expr, result: text });
        if (history.length > 50) history.pop();
        lastResult = text;
        expr = text;
        display = text;
        fresh = true;
      } catch (err) {
        display = err.message === "div0" ? "Bagi 0" : "Error";
        expr = "";
        fresh = true;
      }
    }

    function press(v) {
      if (/^[0-9.]$/.test(v)) {
        if (fresh) { expr = v; fresh = false; }
        else expr += v;
        display = expr;
      } else if (v === "C") {
        clearAll();
      } else if (v === "⌫") {
        if (expr.length > 0) {
          expr = expr.slice(0, -1);
          display = expr || "0";
          fresh = false;
        } else {
          display = "0";
          fresh = true;
        }
      } else if (v === "=") {
        calc();
      } else if (v === "±") {
        const n = parseFloat(display);
        if (Number.isFinite(n)) { expr = fmt(-n); display = expr; fresh = false; }
      } else if (v === "%") {
        const n = parseFloat(display);
        if (Number.isFinite(n)) { expr = fmt(n / 100); display = expr; fresh = false; }
      } else {
        addOp(v);
      }
      drawScreen();
    }

    // ----- klik & keyboard -----
    e.on(e.renderer.domElement, "pointerdown", ev => {
      if (ev.button > 0) return;
      const hit = e.pick(ev.clientX, ev.clientY, keys);
      if (!hit) return;
      pressAnim(keys[hit.key]);
      press(values[hit.key]);
    });

    const keyMap = { Enter: "=", "=": "=", Backspace: "⌫", Escape: "C", Delete: "C", "*": "×", "/": "÷", "+": "+", "-": "-", ".": "." };
    e.on(window, "keydown", ev => {
      let v = null;
      if (/^[0-9]$/.test(ev.key)) v = ev.key;
      else if (keyMap[ev.key]) v = keyMap[ev.key];
      if (!v) return;
      ev.preventDefault();
      const idx = values.indexOf(v);
      if (idx >= 0) pressAnim(keys[idx]);
      press(v);
    });

    // ----- HUD -----
    const st = document.createElement("div");
    st.className = "g3-status";
    st.textContent = "Tekan tombol atau ketik di keyboard";
    const row = document.createElement("div");
    row.className = "g3-row";
    const histB = document.createElement("button");
    histB.type = "button";
    histB.className = "gbtn";
    histB.textContent = "Riwayat";
    const panel = document.createElement("div");
    panel.className = "g3-panel";
    panel.hidden = true;
    panel.style.display = "none";
    e.on(histB, "click", () => {
      const open = panel.style.display === "none";
      panel.style.display = open ? "block" : "none";
      if (open) {
        panel.innerHTML = history.length
          ? history.slice(0, 8).map(h => `<div><b>${h.expression.replace(/\*/g, "×").replace(/\//g, "÷")}</b> = ${h.result}</div>`).join("")
          : "<div>Belum ada riwayat.</div>";
      }
    });
    row.appendChild(histB);
    e.hud.append(st, row, panel);

    drawScreen();
  }
};
