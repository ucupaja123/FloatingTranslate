// ==================== REMI POKER 3D (sederhana) ====================
// Logika dari game asli: 5 kartu per orang, ante 50, aksi Fold / Cek / Naik,
// AI bertindak acak, pemenang = tangan terkuat. Penyederhanaan: satu putaran
// aksi (versi asli juga begitu), kenaikan tetap 50.
import { THREE } from "./engine.js";

const SUITS = ["♥", "♦", "♣", "♠"];
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const VALUES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const AI_NAMES = ["Bruno", "Sakura", "Viktor", "Luna"];
const ANTE = 50, RAISE = 50;

function evaluateHand(hand) {
  if (hand.length !== 5) return { rank: 0, name: "Invalid", value: 0 };
  const sorted = [...hand].sort((a, b) => a.value - b.value);
  const values = sorted.map(c => c.value);
  const suits = sorted.map(c => c.suit);
  const isFlush = new Set(suits).size === 1;
  let isStraight = true;
  for (let i = 0; i < 4; i++) {
    if (values[i + 1] !== values[i] + 1) { isStraight = false; break; }
  }
  if (!isStraight && values.join() === "2,3,4,5,14") isStraight = true;
  const freq = {};
  values.forEach(v => { freq[v] = (freq[v] || 0) + 1; });
  const counts = Object.values(freq).sort((a, b) => b - a);
  const top = values[4];

  if (isFlush && isStraight && values.includes(10) && values.includes(14)) return { rank: 10, name: "Royal Flush", value: 10000 };
  if (isFlush && isStraight) return { rank: 9, name: "Straight Flush", value: 9000 + top };
  if (counts[0] === 4) return { rank: 8, name: "Four of a Kind", value: 8000 };
  if (counts[0] === 3 && counts[1] === 2) return { rank: 7, name: "Full House", value: 7000 };
  if (isFlush) return { rank: 6, name: "Flush", value: 6000 + top };
  if (isStraight) return { rank: 5, name: "Straight", value: 5000 + top };
  if (counts[0] === 3) return { rank: 4, name: "Three of a Kind", value: 4000 };
  if (counts[0] === 2 && counts[1] === 2) return { rank: 3, name: "Two Pair", value: 3000 };
  if (counts[0] === 2) return { rank: 2, name: "One Pair", value: 2000 };
  return { rank: 1, name: "High Card", value: 1000 + top };
}

export default {
  id: "poker",
  title: "Remi Poker",
  icon: "🃏",
  desc: "5 kartu lawan 4 AI. Fold, cek, atau naikkan. Tangan terkuat menang pot.",
  opts: { bg: 0x0f3b2a, camPos: [0, 11, 9.5], lookAt: [0, 0, 0], fov: 42, fit: { w: 13.4, h: 10.4 } },

  mount(e) {
    let playerChips = 1000, pot = 0, currentBet = 0, phase = "setup";
    let players = [], hands = [], deck = [], gen = 0;
    const cardMats = new Map();
    const cardGroups = [];   // { flip, card } untuk dibersihkan saat ronde baru

    // ----- meja -----
    const table = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.6, 0.3, 56), e.mat(0x1f6b4b));
    table.position.y = -0.2;
    table.receiveShadow = true;
    e.scene.add(table);

    // ----- kartu -----
    const cardGeo = new THREE.PlaneGeometry(0.9, 1.25);
    const backMat = new THREE.MeshStandardMaterial({
      roughness: 0.6,
      map: e.canvasTexture([256, 352], (g, W, H) => {
        g.fillStyle = "#1e3a8a";
        g.fillRect(0, 0, W, H);
        g.strokeStyle = "#ffd23f";
        g.lineWidth = 10;
        g.strokeRect(20, 20, W - 40, H - 40);
        g.fillStyle = "#ffd23f";
        g.font = "bold 90px serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText("♠", W / 2, H / 2);
      })
    });

    function faceMat(card) {
      const key = card.rank + card.suit;
      if (!cardMats.has(key)) {
        const red = card.color === "red";
        const m = new THREE.MeshStandardMaterial({
          roughness: 0.5,
          map: e.canvasTexture([256, 352], (g, W, H) => {
            g.fillStyle = "#fffdf5";
            g.fillRect(0, 0, W, H);
            g.strokeStyle = "#111";
            g.lineWidth = 8;
            g.strokeRect(8, 8, W - 16, H - 16);
            g.fillStyle = red ? "#d7263d" : "#111";
            g.textAlign = "left";
            g.textBaseline = "top";
            g.font = "bold 58px sans-serif";
            g.fillText(card.rank, 22, 18);
            g.font = "bold 46px sans-serif";
            g.fillText(card.suit, 26, 84);
            g.textAlign = "center";
            g.textBaseline = "middle";
            g.font = "bold 150px sans-serif";
            g.fillText(card.suit, W / 2, H / 2 + 10);
          })
        });
        cardMats.set(key, m);
      }
      return cardMats.get(key);
    }

    // Kartu berdiri, bisa dibalik (faceUp = depan menghadap kamera)
    function makeCard(card, faceUp) {
      const outer = new THREE.Group();
      outer.rotation.x = -0.35;
      const flip = new THREE.Group();
      const front = new THREE.Mesh(cardGeo, faceMat(card));
      const back = new THREE.Mesh(cardGeo, backMat);
      front.position.z = 0.01;
      back.position.z = -0.01;
      back.rotation.y = Math.PI;
      front.castShadow = back.castShadow = true;
      flip.add(front, back);
      flip.rotation.y = faceUp ? 0 : Math.PI;
      outer.add(flip);
      e.scene.add(outer);
      cardGroups.push({ flip, outer });
      return { outer, flip };
    }

    function clearCards() {
      for (const c of cardGroups) e.scene.remove(c.outer);
      cardGroups.length = 0;
    }

    function layout() {
      clearCards();
      // Tangan kamu di depan, lawan di belakang (muka tertutup)
      hands[0].forEach((card, i) => {
        const c = makeCard(card, true);
        c.outer.position.set((i - 2) * 1.05, 0.9, 3.3);
      });
      for (let a = 1; a < hands.length; a++) {
        const ax = [-5.4, -1.8, 1.8, 5.4][a - 1];
        hands[a].forEach((card, i) => {
          const c = makeCard(card, false);
          c.outer.scale.setScalar(0.6);
          c.outer.position.set(ax + (i - 2) * 0.62, 0.5, -2.2);
        });
        const lb = e.label(players[a].name, { w: 2.4, h: 0.6, color: "#fff", font: "bold 80px sans-serif" });
        lb.position.set(ax, 1.2, -3.8);
        lb.rotation.x = -0.5;
        e.scene.add(lb);
        cardGroups.push({ outer: lb, flip: lb });
      }
    }

    // ----- deck -----
    function buildDeck() {
      deck = [];
      for (const s of SUITS) {
        RANKS.forEach((r, j) => {
          deck.push({ suit: s, rank: r, value: VALUES[j], color: (s === "♥" || s === "♦") ? "red" : "black" });
        });
      }
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
    }
    const draw = n => deck.splice(0, n);

    // ----- HUD -----
    const st = document.createElement("div");
    st.className = "g3-status";
    const chips = document.createElement("div");
    chips.className = "g3-row";
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
    const startB = btn("Mulai ronde (ante 50)", "hot", startGame);
    const foldB = btn("Fold", "bad", () => act("FOLD"));
    const checkB = btn("Cek / Ikut", "", () => act("CHECK"));
    const raiseB = btn("Naik +50", "ok", () => act("RAISE"));
    row.append(startB, foldB, checkB, raiseB);
    e.hud.append(st, chips, row);

    function setStatus(t) { st.textContent = t; }
    function renderChips() {
      const me = players[0];
      chips.innerHTML =
        `<span class="g3-chip">🪙 Kamu ${me ? me.chips : playerChips}</span>` +
        `<span class="g3-chip">Pot ${pot}</span>`;
    }
    function setActions(on) {
      foldB.disabled = !on;
      checkB.disabled = !on;
      raiseB.disabled = !on;
      startB.disabled = on;
    }

    function startGame() {
      e.sfx("deal");
      gen++;
      if (playerChips < ANTE) {
        playerChips = 1000;
        setStatus("Chip kamu habis, dapat 1000 lagi.");
      }
      pot = 0;
      currentBet = ANTE;
      players = [{ name: "Kamu", chips: playerChips, isAI: false, action: null, bet: 0, folded: false }];
      for (let i = 0; i < AI_NAMES.length; i++) {
        players.push({ name: AI_NAMES[i], chips: 1000, isAI: true, action: null, bet: 0, folded: false });
      }
      for (const p of players) {
        if (p.chips >= ANTE) {
          p.chips -= ANTE;
          p.bet = ANTE;
          pot += ANTE;
        }
      }
      buildDeck();
      hands = [draw(5), draw(5), draw(5), draw(5), draw(5)];
      phase = "playing";
      layout();
      renderChips();
      setStatus("Pilih: Fold, Cek, atau Naik.");
      setActions(true);
    }

    function act(action) {
      if (phase !== "playing") return;
      const g = gen;
      const me = players[0];
      if (action === "FOLD") {
        me.action = "FOLD";
        me.folded = true;
      } else if (action === "CHECK") {
        const call = currentBet - me.bet;
        if (call > 0 && me.chips >= call) {
          me.chips -= call;
          me.bet += call;
          pot += call;
        }
        me.action = "CHECK";
      } else if (action === "RAISE") {
        const need = currentBet - me.bet + RAISE;
        if (me.chips >= need) {
          me.chips -= need;
          me.bet += need;
          pot += need;
          currentBet = me.bet;
        }
        me.action = "RAISE";
      }
      setActions(false);

      // Lawan bertindak acak
      for (const ai of players.slice(1)) {
        if (ai.folded) continue;
        const r = Math.random();
        if (r < 0.3) {
          ai.folded = true;
          ai.action = "FOLD";
        } else if (r < 0.7) {
          const call = currentBet - ai.bet;
          if (call > 0 && ai.chips >= call) {
            ai.chips -= call;
            ai.bet += call;
            pot += call;
          }
          ai.action = "CHECK";
        } else {
          const raise = 50 + Math.floor(Math.random() * 150);
          if (ai.chips >= currentBet + raise) {
            const pay = currentBet + raise - ai.bet;
            ai.chips -= pay;
            ai.bet = currentBet + raise;
            pot += pay;
            currentBet = ai.bet;
          }
          ai.action = "RAISE";
        }
      }
      renderChips();
      e.later(600, () => { if (g === gen) showdown(); });
    }

    function showdown() {
      phase = "setup";
      const seats = players.map((p, i) => ({
        player: p,
        hand: hands[i],
        ev: evaluateHand(hands[i]),
        folded: p.folded
      }));
      const live = seats.filter(s => !s.folded);
      let winnerText = "";
      if (live.length === 0) {
        winnerText = "Semua fold, tidak ada pemenang.";
      } else {
        live.sort((a, b) => b.ev.value - a.ev.value);
        const w = live[0];
        w.player.chips += pot;
        winnerText = `${w.player.name} menang ${pot} dengan ${w.ev.name}`;
        if (live.length === 1) winnerText = `${w.player.name} menang ${pot} (lawan fold)`;
      }
      playerChips = players[0].chips;
      revealAI();
      pot = 0;
      renderChips();
      e.sfx("coin"); setStatus(winnerText + ". Mulai ronde baru?");
      startB.textContent = "Ronde baru (ante 50)";
      setActions(false);
      startB.disabled = false;
    }

    // Balik kartu lawan (yang ada di belakang meja) menghadap ke atas
    function revealAI() {
      e.sfx("flip");
      for (const c of cardGroups) {
        if (c.flip === c.outer || c.flip.children.length !== 2) continue;
        if (c.outer.position.z >= 0) continue; // kartu kamu sudah terbuka
        const f = c.flip;
        e.tween(450, k => { f.rotation.y = Math.PI * (1 - k); });
      }
    }

    renderChips();
    setStatus("Tekan Mulai ronde untuk bermain.");
    setActions(false);
    startB.disabled = false;
  }
};
