// ============================================================
//  HUB GAME 3D PRIMSIC
//  Setiap file game mengekspor default:
//    { id, title, icon, desc, mount(engine) }
//  Hub membuat engine (kanvas + HUD), memanggil mount(), dan
//  membersihkan semuanya saat pemain keluar.
// ============================================================
import { createEngine } from "./engine.js";

const GAME_FILES = [
  "./g-tictactoe.js",
  "./g-minesweeper.js",
  "./g-rps.js",
  "./g-slot.js",
  "./g-ludo.js",
  "./g-ular.js",
  "./g-chess.js",
  "./g-poker.js",
  "./g-kalkulator.js",
  "./g-kuis.js",
  "./g-memory.js"
];

const menuEl = document.getElementById("menu");
const gridEl = document.getElementById("gridGames");
const stageEl = document.getElementById("stage");
const stageBox = document.getElementById("stageBox");
const homeBtn = document.getElementById("ghHome");
const titleEl = document.getElementById("ghTitle");

let games = [];
let current = null; // { game, engine }

// Muat semua game. Yang gagal dimuat dilewati, tidak menghentikan hub.
async function loadGames() {
  const results = await Promise.allSettled(GAME_FILES.map(f => import(f)));
  games = results
    .filter(r => r.status === "fulfilled" && r.value && r.value.default)
    .map(r => r.value.default);
  for (const r of results) {
    if (r.status === "rejected") console.warn("Game gagal dimuat:", r.reason);
  }
  renderMenu();
  routeFromHash();
}

function renderMenu() {
  gridEl.innerHTML = "";
  for (const g of games) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gcard";
    b.dataset.id = g.id;
    b.innerHTML = `<span class="gi"></span><b></b><small></small>`;
    b.querySelector(".gi").textContent = g.icon || "🎮";
    b.querySelector("b").textContent = g.title;
    b.querySelector("small").textContent = g.desc || "";
    b.addEventListener("click", () => { location.hash = g.id; });
    gridEl.appendChild(b);
  }
}

function openGame(game) {
  closeGame();
  menuEl.hidden = true;
  stageEl.hidden = false;
  titleEl.textContent = game.title;

  // Bilah atas di dalam stage: tombol kembali + judul
  stageBox.innerHTML = "";
  const bar = document.createElement("div");
  bar.className = "gbar";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "gbtn";
  back.textContent = "←";
  back.setAttribute("aria-label", "Kembali");
  back.addEventListener("click", leaveGame);
  const h = document.createElement("h2");
  h.textContent = `${game.icon || ""} ${game.title}`;
  const home = document.createElement("a");
  home.className = "gbtn";
  home.href = "/";
  home.textContent = "🏠";
  home.setAttribute("aria-label", "Beranda PRIMSIC");
  bar.append(back, h, home);

  const body = document.createElement("div");
  body.style.cssText = "position:relative;flex:1;min-height:0;overflow:hidden";
  stageBox.append(bar, body);

  const engine = createEngine(body, game.opts || {});
  current = { game, engine };
  try {
    game.mount(engine);
  } catch (err) {
    console.error("Game error:", err);
    const p = document.createElement("p");
    p.className = "g3-status";
    p.textContent = "Gagal menjalankan game ini. Coba muat ulang halaman.";
    engine.hud.appendChild(p);
  }
}

function closeGame() {
  if (current) {
    current.engine.dispose();
    current = null;
  }
  stageBox.innerHTML = "";
  stageEl.hidden = true;
  menuEl.hidden = false;
  titleEl.textContent = "Game 3D";
}

// Tutup game langsung (tidak menunggu perubahan hash), lalu kembali ke menu
function leaveGame() {
  location.hash = "";
  closeGame();
}

function routeFromHash() {
  const id = decodeURIComponent(location.hash.replace(/^#/, ""));
  const game = games.find(g => g.id === id);
  if (game) openGame(game);
  else closeGame();
}

// Di menu: biarkan tautan ke beranda PRIMSIC berjalan. Di dalam game: kembali ke menu dulu.
homeBtn.addEventListener("click", (e) => { if (!current) return; e.preventDefault(); leaveGame(); });
window.addEventListener("hashchange", routeFromHash);

loadGames();
