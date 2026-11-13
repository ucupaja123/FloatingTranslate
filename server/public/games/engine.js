// ============================================================
//  ENGINE 3D untuk kumpulan game PRIMSIC
//  Dibangun di atas Three.js (dimuat lewat importmap di games/index.html)
// ============================================================
import * as THREE from "three";
import { play, unlock } from "./sound.js";

export { THREE };

// Buat satu kanvas 3D + overlay HUD. Semua listener & animasi dicatat
// supaya bisa dibersihkan saat keluar dari game.
export function createEngine(container, opts = {}) {
  const {
    bg = 0x101018,
    camPos = [0, 9, 9],
    lookAt = [0, 0, 0],
    fov = 45,
    fit = null // { w, h }: jarak kamera menyesuaikan agar area ini selalu terlihat
  } = opts;

  const host = document.createElement("div");
  host.className = "g3-host";
  container.appendChild(host);

  const hud = document.createElement("div");
  hud.className = "g3-hud";
  container.appendChild(hud);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bg);

  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 300);
  camera.position.set(...camPos);
  camera.lookAt(...lookAt);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a55, 1.0));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(6, 14, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -12;
  key.shadow.camera.right = 12;
  key.shadow.camera.top = 12;
  key.shadow.camera.bottom = -12;
  scene.add(key);

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const ticks = [];
  const listeners = [];
  const timers = new Set();
  let alive = true;
  let rafId = 0;
  let last = performance.now();

  const lookV = new THREE.Vector3(...lookAt);
  const dirV = new THREE.Vector3(...camPos).sub(lookV).normalize();

  function resize() {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    if (fit) {
      // Mundur sampai area fit muat di tinggi dan lebar layar
      const tanH = Math.tan(THREE.MathUtils.degToRad(fov / 2));
      const d = Math.max((fit.h / 2) / tanH, (fit.w / 2) / (tanH * camera.aspect));
      camera.position.copy(lookV).addScaledVector(dirV, Math.max(d, 4));
      camera.lookAt(lookV);
    }
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  function frame(now) {
    if (!alive) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    for (const fn of ticks) fn(dt, now / 1000);
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  // Ubah posisi layar jadi objek 3D yang tersentuh.
  // Mengembalikan userData.key dari objek (atau induknya) yang pertama kena.
  function pick(clientX, clientY, objects) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(objects, true);
    for (const h of hits) {
      let o = h.object;
      while (o) {
        if (o.userData && o.userData.key !== undefined) {
          return { key: o.userData.key, object: o, point: h.point };
        }
        o = o.parent;
      }
    }
    return null;
  }

  // Daftarkan listener DOM yang akan dilepas saat dispose()
  function on(el, type, fn, options) {
    el.addEventListener(type, fn, options);
    listeners.push(() => el.removeEventListener(type, fn, options));
  }

  // Sentuhan pertama membuka audio (syarat browser); tombol juga berbunyi "tap"
  on(container, "pointerdown", ev => {
    unlock();
    if (ev.target.closest && ev.target.closest("button")) play("tap");
  }, { capture: true, passive: true });

  // Timer yang ikut dibatalkan saat keluar game
  function later(ms, fn) {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  }
  function wait(ms) {
    return new Promise(res => later(ms, res));
  }

  // Tween sederhana: onUpdate(k) dengan k 0..1 (ease in-out)
  function tween(ms, onUpdate) {
    return new Promise(res => {
      const t0 = performance.now();
      function step(now) {
        if (!alive) return res();
        const k = Math.min(1, (now - t0) / ms);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        onUpdate(e);
        if (k < 1) requestAnimationFrame(step);
        else res();
      }
      requestAnimationFrame(step);
    });
  }

  // Tekstur dari kanvas (untuk angka, emoji, wajah kartu, dll)
  function canvasTexture(size, draw) {
    const c = document.createElement("canvas");
    c.width = size[0];
    c.height = size[1];
    draw(c.getContext("2d"), c.width, c.height);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  // Papan teks datar (menghadap kamera secara tetap)
  function label(text, { w = 1, h = 1, color = "#fff", bgc = null, font = "bold 96px sans-serif" } = {}) {
    const tex = canvasTexture([256, 256], (g, W, H) => {
      if (bgc) { g.fillStyle = bgc; g.fillRect(0, 0, W, H); }
      g.fillStyle = color;
      g.font = font;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(text), W / 2, H / 2 + 8);
    });
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.userData.disposeTex = tex;
    return mesh;
  }

  // Bahan standar gaya neo-brutal: warna solid, sedikit mengkilap
  function mat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...opts });
  }

  // Bersihkan semua yang dibuat game ini
  function dispose() {
    if (!alive) return;
    alive = false;
    cancelAnimationFrame(rafId);
    for (const id of timers) clearTimeout(id);
    timers.clear();
    for (const off of listeners) off();
    listeners.length = 0;
    ro.disconnect();
    scene.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const list = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of list) {
          if (m.map) m.map.dispose();
          m.dispose();
        }
      }
    });
    renderer.dispose();
    // Lepas konteks WebGL sekarang juga, supaya di HP tidak menumpuk saat ganti game
    const lose = renderer.getContext && renderer.getContext().getExtension("WEBGL_lose_context");
    if (lose) lose.loseContext();
    host.remove();
    hud.remove();
  }

  return {
    scene, camera, renderer, host, hud,
    pick, on, later, wait, tween, canvasTexture, label, mat, sfx: play,
    onTick(fn) { ticks.push(fn); },
    dispose,
    get alive() { return alive; }
  };
}
