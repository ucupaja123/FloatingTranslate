// ==================== KUIS 3D (kartu CSS 3D) ====================
// Logika dari game asli: 4 kategori, tiap soal 1 poin, jeda 1 detik setelah jawab.
// Tampilan memakai kartu CSS 3D (bukan adegan WebGL), karena kuis tidak butuh adegan.
const DATA = {
  "Matematika": [
    { question: "Berapa hasil dari 15 x 4?", options: ["50", "60", "70", "45"], answer: 1 },
    { question: "Akar kuadrat dari 81 adalah...", options: ["7", "8", "9", "10"], answer: 2 },
    { question: "Jika x + 5 = 12, berapa nilai x?", options: ["5", "6", "7", "8"], answer: 2 }
  ],
  "IPA": [
    { question: "H2O adalah rumus kimia dari?", options: ["Garam", "Gula", "Air", "Minyak"], answer: 2 },
    { question: "Planet terdekat dengan Matahari adalah?", options: ["Venus", "Merkurius", "Mars", "Bumi"], answer: 1 }
  ],
  "Agama": [
    { question: "Rukun Islam yang pertama adalah?", options: ["Sholat", "Puasa", "Syahadat", "Zakat"], answer: 2 },
    { question: "Kitab suci umat Islam adalah?", options: ["Injil", "Zabur", "Taurat", "Al-Quran"], answer: 3 }
  ],
  "Umum": [
    { question: "Ibu kota Indonesia adalah?", options: ["Bandung", "Surabaya", "Jakarta", "Medan"], answer: 2 },
    { question: "Gunung tertinggi di dunia?", options: ["Kilimanjaro", "Everest", "Fuji", "Kerinci"], answer: 1 }
  ]
};

// Matematika: 3 soal tetap + 197 soal acak (angka dan jawaban dihitung otomatis) = 200
function genMath(n) {
  const R = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const seen = new Set(), out = [];
  while (out.length < n) {
    let q, ans;
    const t = R(0, 5);
    if (t === 0) { const a = R(11, 39), b = R(3, 19); q = `Berapa hasil dari ${a} x ${b}?`; ans = a * b; }
    else if (t === 1) { const a = R(100, 999), b = R(100, 999); q = `Berapa hasil dari ${a} + ${b}?`; ans = a + b; }
    else if (t === 2) { const a = R(2, 30), b = R(2, 30); q = `Jika x + ${b} = ${a + b}, berapa nilai x?`; ans = a; }
    else if (t === 3) { const r = R(2, 30); q = `Akar kuadrat dari ${r * r} adalah...`; ans = r; }
    else if (t === 4) { const p = [5, 10, 20, 25, 50][R(0, 4)], base = R(2, 40) * 20; q = `Berapa ${p}% dari ${base}?`; ans = base * p / 100; }
    else { const a = R(2, 12), b = R(2, 12), p = a * b, c = R(1, p - 1); q = `Berapa hasil dari ${a} x ${b} - ${c}?`; ans = p - c; }
    if (seen.has(q)) continue;
    seen.add(q);
    const opts = new Set([ans]);
    while (opts.size < 4) { const v = ans + R(-9, 9); if (v >= 0) opts.add(v); }
    const arr = [...opts].sort(() => Math.random() - 0.5);
    out.push({ question: q, options: arr.map(String), answer: arr.indexOf(ans) });
  }
  return out;
}
DATA.Matematika.push(...genMath(200 - DATA.Matematika.length));

export default {
  id: "kuis",
  title: "Kuis",
  icon: "🧠",
  desc: "Pilih kategori, jawab soal. Kartu soal berputar dalam 3D.",
  opts: { bg: 0xfff8e7, camPos: [0, 10, 10], lookAt: [0, 0, 0], fov: 40, fit: { w: 4, h: 4 } },

  mount(e) {
    // Area DOM memenuhi seluruh stage (menutupi kanvas kosong)
    e.hud.style.cssText = "position:absolute;inset:0;padding:0;display:block;overflow:auto;pointer-events:none";
    const stage = document.createElement("div");
    stage.className = "quiz-stage";
    e.hud.appendChild(stage);

    let cat = null, idx = 0, score = 0, answered = false;
    const QUIZ_TIME = 15; // detik per soal
    let left = 0, running = false, timerEl = null;
    e.onTick(dt => {
      if (!running) return;
      left = Math.max(0, left - dt);
      if (timerEl) timerEl.textContent = `⏱ ${Math.ceil(left)}`;
      if (left <= 0) { running = false; timeUp(); }
    });

    function el(tag, cls, text) {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined) n.textContent = text;
      return n;
    }

    function btn(label, cls, fn) {
      const b = el("button", "gbtn " + (cls || ""), label);
      b.type = "button";
      e.on(b, "click", fn);
      return b;
    }

    function renderMenu() {
      cat = null;
      running = false;
      stage.innerHTML = "";
      const box = el("div", "", "");
      box.style.cssText = "text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px;max-width:420px";
      const title = el("h2", "", "Pilih kategori");
      title.style.cssText = "margin:0;font-weight:900;text-transform:uppercase";
      const grid = el("div", "quiz-cats");
      for (const name of Object.keys(DATA)) {
        const b = btn(`${name} (${DATA[name].length})`, "hot", () => startQuiz(name));
        b.style.cssText = "padding:18px 10px;transform:translateZ(20px)";
        grid.appendChild(b);
      }
      box.append(title, grid);
      stage.appendChild(box);
    }

    function startQuiz(name) {
      cat = name;
      idx = 0;
      score = 0;
      renderQuestion();
    }

    function renderQuestion() {
      answered = false;
      const list = DATA[cat];
      const q = list[idx];
      stage.innerHTML = "";

      const meta = el("div", "g3-chip", `${cat} · ${idx + 1}/${list.length} · skor ${score}`);
      meta.style.cssText = "position:absolute;top:14px;left:50%;transform:translateX(-50%);";
      stage.appendChild(meta);
      timerEl = el("div", "g3-chip", `⏱ ${QUIZ_TIME}`);
      timerEl.style.cssText = "position:absolute;top:14px;right:14px;";
      stage.appendChild(timerEl);
      left = QUIZ_TIME;
      running = true;

      const card = el("div", "quiz-card");
      card.style.transform = "rotateY(-80deg)";
      card.append(el("h3", "", q.question));
      const opts = [];
      q.options.forEach((txt, i) => {
        const b = el("button", "quiz-opt", txt);
        b.type = "button";
        e.on(b, "click", () => pick(i, b, opts, q));
        opts.push(b);
        card.appendChild(b);
      });
      stage.appendChild(card);
      requestAnimationFrame(() => requestAnimationFrame(() => { card.style.transform = "rotateY(0deg)"; }));
    }

    function pick(i, btnEl, opts, q) {
      if (answered) return;
      answered = true;
      running = false;
      const correct = q.answer;
      if (i === correct) {
        e.sfx("ok");
        score++;
        btnEl.classList.add("right");
      } else {
        e.sfx("bad");
        btnEl.classList.add("wrong");
        opts[correct].classList.add("right");
      }
      e.later(1000, () => {
        if (!e.alive) return;
        if (idx < DATA[cat].length - 1) {
          idx++;
          renderQuestion();
        } else {
          renderResult();
        }
      });
    }

    // Waktu habis: jawaban benar ditampilkan, lalu lanjut
    function timeUp() {
      if (answered || !cat) return;
      answered = true;
      e.sfx("bad");
      stage.querySelectorAll(".quiz-opt")[DATA[cat][idx].answer].classList.add("right");
      e.later(1000, next);
    }
    function next() {
      if (!e.alive || !cat) return;
      if (idx < DATA[cat].length - 1) { idx++; renderQuestion(); }
      else renderResult();
    }

    function renderResult() {
      running = false;
      e.sfx(score * 2 >= DATA[cat].length ? "end" : "lose");
      stage.innerHTML = "";
      const total = DATA[cat].length;
      const box = el("div", "quiz-card");
      box.style.cssText = "text-align:center";
      box.append(
        el("h3", "", `Skor kamu: ${score} / ${total}`),
        el("p", "", score === total ? "Sempurna! 🎉" : score >= total / 2 ? "Bagus! 👍" : "Coba lagi ya 💪")
      );
      const row = el("div", "g3-row");
      row.style.marginTop = "12px";
      row.append(btn("Ulang kategori ini", "hot", () => startQuiz(cat)), btn("Kategori lain", "", renderMenu));
      box.appendChild(row);
      stage.appendChild(box);
    }

    renderMenu();
  }
};
