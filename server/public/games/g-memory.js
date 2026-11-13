// ==================== CARI PASANGAN (memory) ====================
// Balik dua kartu. Kalau sama, kartu tetap terbuka. Ada hitungan langkah dan waktu.
const ICONS = ["🍎", "🍌", "🍇", "🍓", "🍒", "🥝", "🍍", "🍉"];

export default {
  id: "memory",
  title: "Cari Pasangan",
  icon: "🃏",
  desc: "Balik dua kartu, cari pasangannya. Makin sedikit langkah dan waktu makin bagus.",
  opts: { bg: 0xfff8e7, camPos: [0, 10, 10], lookAt: [0, 0, 0], fov: 40, fit: { w: 4, h: 4 } },

  mount(e) {
    e.hud.style.cssText = "position:absolute;inset:0;padding:0;display:block;overflow:auto;pointer-events:none";
    const stage = document.createElement("div");
    stage.className = "quiz-stage";
    const box = document.createElement("div");
    box.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:12px;width:min(94%,380px)";
    const row1 = document.createElement("div");
    row1.className = "g3-row";
    const info = document.createElement("div");
    info.className = "g3-chip";
    const clockEl = document.createElement("div");
    clockEl.className = "g3-chip";
    row1.append(info, clockEl);
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(4,1fr);gap:8px;width:100%";
    const row = document.createElement("div");
    row.className = "g3-row";
    const again = document.createElement("button");
    again.type = "button";
    again.className = "gbtn hot";
    again.textContent = "Acak ulang";
    e.on(again, "click", start);
    row.append(again);
    box.append(row1, grid, row);
    stage.append(box);
    e.hud.append(stage);

    let deck = [], open = [], lock = false, moves = 0, found = 0, time = 0, timing = false;

    // Stopwatch: jalan sejak kartu pertama dibalik sampai semua pasangan ketemu
    e.onTick(dt => {
      if (!timing) return;
      time += dt;
      clockEl.textContent = `⏱ ${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`;
    });

    function start() {
      const cards = [...ICONS, ...ICONS].map(v => ({ v, up: false, done: false }));
      deck = cards.sort(() => Math.random() - 0.5);
      open = [];
      lock = false;
      moves = 0;
      found = 0;
      time = 0;
      timing = false;
      clockEl.textContent = "⏱ 0:00";
      render();
    }

    function render() {
      info.textContent = found === ICONS.length
        ? `Selesai dalam ${moves} langkah! 🎉`
        : `Langkah ${moves} · Pasangan ${found}/${ICONS.length}`;
      grid.innerHTML = "";
      deck.forEach((c, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "mc" + (c.done ? " done" : c.up ? " up" : "");
        b.textContent = c.up || c.done ? c.v : "?";
        e.on(b, "click", () => flip(i));
        grid.appendChild(b);
      });
    }

    function flip(i) {
      const c = deck[i];
      if (lock || c.up || c.done) return;
      timing = true;
      c.up = true;
      open.push(i);
      e.sfx("flip");
      render();
      if (open.length < 2) return;
      moves++;
      lock = true;
      const [i1, i2] = open, d = deck;
      if (deck[i1].v === deck[i2].v) {
        deck[i1].done = deck[i2].done = true;
        found++;
        open = [];
        lock = false;
        if (found === ICONS.length) timing = false;
        e.sfx(found === ICONS.length ? "end" : "ok");
        render();
      } else {
        e.sfx("tick");
        e.later(800, () => {
          if (d !== deck) return; // sudah acak ulang
          deck[i1].up = deck[i2].up = false;
          open = [];
          lock = false;
          render();
        });
      }
    }

    start();
  }
};
