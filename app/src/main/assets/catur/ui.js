const $ = id => document.getElementById(id);
const waiting = {};
let nextId = 0, game, data, at = 0, flipped = false, thinkMs = 800;

// Jawaban engine dikirim balik oleh aplikasi lewat fungsi ini.
window.onEngine = (id, text) => {
  const w = waiting[id];
  delete waiting[id];
  if (!w) return;
  if (text.startsWith("ERROR")) w.reject(new Error(text.slice(7)));
  else w.resolve(text);
};
const engine = fen => new Promise((resolve, reject) => {
  const id = ++nextId;
  waiting[id] = { resolve, reject };
  Android.analyze(id, fen, thinkMs);
});

const labelOf = key => LABELS.find(l => l[0] === key);

$("go").onclick = async () => {
  $("error").textContent = "";
  try {
    game = buildGame($("pgn").value);
    thinkMs = Number($("speed").value);
    $("go").disabled = true;
    $("loading").hidden = false;
    $("bar").value = 0;
    $("count").textContent = "Menyiapkan engine…";
    data = await analyze(game, engine, (n, total) => {
      $("bar").value = n / total;
      $("count").textContent = `Menganalisis posisi ${n} dari ${total}`;
    });
    $("input").hidden = true;
    $("result").hidden = false;
    const t = game.tags;
    $("players").textContent = `${t.White || "Putih"} vs ${t.Black || "Hitam"} · ${game.result}`;
    buildMoves();
    buildSummary();
    show(0);
  } catch (e) {
    $("error").textContent = e.message;
  }
  $("go").disabled = false;
  $("loading").hidden = true;
};

$("again").onclick = () => {
  $("pgn").value = "";
  $("result").hidden = true;
  $("input").hidden = false;
  scrollTo(0, 0);
};

document.querySelector(".nav").onclick = e => {
  const go = e.target.dataset.go;
  if (!go) return;
  if (go === "flip") flipped = !flipped;
  const to = { first: 0, prev: at - 1, next: at + 1, last: game.plies.length, flip: at }[go];
  show(Math.max(0, Math.min(game.plies.length, to)));
};

function buildMoves() {
  $("moves").replaceChildren(...game.plies.map((p, i) => {
    const l = labelOf(data.reviews[i].label);
    const b = el("button", "", (p.color === "w" ? `${Math.floor(i / 2) + 1}. ` : "") + p.san + " " + l[2]);
    b.style.color = l[3];
    b.onclick = () => show(i + 1);
    return b;
  }));
}

function buildSummary() {
  const row = (name, a, b, color) => {
    const tr = el("tr");
    tr.append(el("td", "", name), el("td", "", a), el("td", "", b));
    if (color) tr.firstChild.style.color = color;
    return tr;
  };
  const of = c => data.reviews.filter((_, i) => game.plies[i].color === c);
  const accuracy = list => list.length ? (list.reduce((s, r) => s + r.accuracy, 0) / list.length).toFixed(1) + "%" : "-";
  const w = of("w"), b = of("b");
  $("summary").replaceChildren(
    row("", "Putih", "Hitam"),
    row("Akurasi (perkiraan)", accuracy(w), accuracy(b)),
    ...LABELS.map(l => row(`${l[2]} ${l[1]}`, w.filter(r => r.label === l[0]).length, b.filter(r => r.label === l[0]).length, l[3]))
  );
}

function show(n) {
  at = n;
  const s = game.positions[n].state;
  const ply = game.plies[n - 1];
  const review = data.reviews[n - 1];
  const label = review && labelOf(review.label);
  const cells = [];
  for (let i = 0; i < 64; i++) {
    const idx = flipped ? 63 - i : i, r = Math.floor(idx / 8), c = idx % 8;
    const p = s.b[r][c];
    const cell = el("div", `sq ${(r + c) % 2 ? "dark" : "light"}`);
    if (p) cell.append(el("span", isWhite(p) ? "w" : "b", GLYPH[p.toLowerCase()] + "︎"));
    if (ply && s.last && (idx === s.last.from || idx === s.last.to)) cell.style.background = label[3] + "aa";
    if (ply && idx === s.last.to) {
      const badge = el("span", "badge", label[2]);
      badge.style.background = label[3];
      cell.append(badge);
    }
    cells.push(cell);
  }
  $("board").replaceChildren(...cells);

  // Panah hijau: langkah yang disarankan engine, digambar di posisi sesudah langkah.
  $("arrow").innerHTML = "";
  if (review && review.best !== ply.uci) {
    const point = sq => {
      let x = "abcdefgh".indexOf(sq[0]), y = 8 - Number(sq[1]);
      if (flipped) { x = 7 - x; y = 7 - y; }
      return [x + 0.5, y + 0.5];
    };
    const [x1, y1] = point(review.best.slice(0, 2)), [x2, y2] = point(review.best.slice(2, 4));
    $("arrow").innerHTML = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#22c55e" stroke-width=".16" stroke-linecap="round" opacity=".8"/><circle cx="${x2}" cy="${y2}" r=".22" fill="#22c55e" opacity=".85"/>`;
  }

  const here = data.info[n];
  const whiteWin = s.turn === "w" ? here.win : 100 - here.win;
  $("evalfill").style.width = whiteWin + "%";
  const box = $("comment");
  if (!ply) box.replaceChildren(el("p", "muted", "Posisi awal. Tekan ▶ untuk mulai."));
  else {
    const title = el("b", "", `${ply.san} · ${label[1]} ${label[2]}`);
    title.style.color = label[3];
    const note = review.best === ply.uci ? "Ini langkah pilihan engine."
      : `Saran engine (panah hijau): ${review.bestSan}`;
    box.replaceChildren(title, el("p", "", note), el("p", "muted", `Evaluasi: ${here.text}`));
  }
  [...$("moves").children].forEach((b, i) => b.classList.toggle("on", i === n - 1));
}
