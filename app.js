/* Felt: poker fundamentals, learned at the table. UI + drills. Engines in engine.js, tables in data.js. */
(function () {
  "use strict";
  const { RANKS, GLYPH, RANK_PLURAL, CAT_NAME, CLASSES, GRID, NAME_TO_CLASS } = PE;
  const D = window.PDATA, N = 169;

  // ---------- tiny helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "style") el.style.cssText = v;
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }
  const rnd = n => Math.floor(Math.random() * n);
  const pick = a => a[rnd(a.length)];
  const chance = p => Math.random() < p;
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  const freshDeck = () => shuffle([...Array(52).keys()]);
  const P = (x, d) => (x * 100).toFixed(d == null ? (Math.abs(x) < 0.1 ? 1 : 0) : d) + "%";
  const fmt = n => n.toLocaleString("en-US");
  const rankTxt = r => (r === 8 ? "10" : RANKS[r]);
  const cardTxt = c => rankTxt(c >> 2) + GLYPH[c & 3];
  const cardsTxt = cs => cs.map(cardTxt).join(" ");
  const isRed = c => (c & 3) === 1 || (c & 3) === 2;
  const comboOf = i => { const cs = CLASSES[i].combos; return pick(cs).slice(); };
  const eqCls = (i, j) => D.eq[i * N + j] / 1000;
  const wCls = (i, j) => D.w[i * N + j];
  function eqVsWeights(i, wts) {
    let w = 0, e = 0;
    for (let j = 0; j < N; j++) { if (!wts[j]) continue; const x = wts[j] * wCls(i, j); w += x; e += x * eqCls(i, j); }
    return w ? e / w : 0;
  }
  const rangeOrder = [...Array(N).keys()].sort((a, b) => D.eqRand[b] - D.eqRand[a]);
  function topRange(pct) {
    const set = new Set(); let c = 0;
    for (const i of rangeOrder) { if (c / 1326 >= pct) break; set.add(i); c += PE.comboCount(i); }
    return set;
  }
  const weightsPct = wts => wts.reduce((s, x, i) => s + x * PE.comboCount(i), 0) / 1326;

  // ---------- storage ----------
  const KEY = "felt_v1";
  let store;
  try { store = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { store = {}; }
  store.d = store.d || {};
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} };
  const stat = id => (store.d[id] = store.d[id] || { hist: [], n: 0, streak: 0, best: 0, seen: false });
  const WINDOW = 20, SOLID = 18;
  const solidOf = id => { const s = stat(id); const last = s.hist.slice(-WINDOW); return last.length >= WINDOW && last.filter(Boolean).length >= SOLID; };

  // ---------- visual atoms ----------
  function cardEl(c, o = {}) {
    const el = h("div", { class: "card" + (isRed(c) ? " red" : "") + (o.sm ? " sm" : "") + (o.cls ? " " + o.cls : "") });
    const g = GLYPH[c & 3];
    el.innerHTML = `<span class="rk">${rankTxt(c >> 2)}</span><span class="su">${g}</span><span class="pip">${g}</span>`;
    if (!o.flat) el.style.setProperty("--rot", (Math.random() * 3 - 1.5).toFixed(2) + "deg");
    if (o.deal != null) { el.classList.add("deal"); el.style.setProperty("--d", o.deal + "s"); }
    el.dataset.c = c;
    return el;
  }
  const backEl = (o = {}) => {
    const el = h("div", { class: "card back" + (o.cls ? " " + o.cls : "") });
    if (o.deal != null) { el.classList.add("deal"); el.style.setProperty("--d", o.deal + "s"); }
    el.style.setProperty("--rot", (Math.random() * 3 - 1.5).toFixed(2) + "deg");
    return el;
  };
  const cardRow = (cs, o = {}) => h("div", { class: "cards" }, cs.map((c, k) => cardEl(c, { ...o, deal: o.deal != null ? o.deal + k * 0.07 : null })));

  const CHIP_COL = ["var(--ch500)", "var(--ch100)", "var(--ch25)", "var(--ch5)", "var(--ch1)"];
  function chipsEl(amount, o = {}) {
    const denoms = o.denoms || [500, 100, 25, 5, 1];
    const wrap = h("div", { class: "chipwrap" });
    const row = h("div", { class: "chips" });
    let left = amount, cols = 0;
    denoms.forEach((d, k) => {
      let n = Math.floor(left / d + 1e-9); left -= n * d;
      while (n > 0 && cols < 6) {
        const take = Math.min(n, 9); n -= take; cols++;
        const st = h("div", { class: "stack" });
        for (let i = 0; i < take; i++) st.append(h("i", { class: "chip" + (i === take - 1 ? " top" : ""), style: `--c:${CHIP_COL[k]}` }));
        row.append(st);
      }
    });
    if (!cols) row.append(h("div", { class: "stack" }, h("i", { class: "chip top", style: "--c:var(--ch1)" })));
    wrap.append(row);
    if (o.label !== false) wrap.append(h("div", { class: "amt", html: o.label || fmt(amount) }));
    return wrap;
  }

  // 13x13 grid. cls(i) returns extra class string for cell i.
  function gridEl(cls, o = {}) {
    const g = h("div", { class: "grid" + (o.paint ? " paint" : "") });
    for (let row = 0; row < 13; row++) for (let col = 0; col < 13; col++) {
      const i = GRID[row][col];
      g.append(h("div", { class: "c " + (CLASSES[i].type === "s" ? "s " : "") + (cls(i) || "") + (o.me === i ? " me" : ""), "data-i": i }, CLASSES[i].name));
    }
    return g;
  }
  const meter = rows => h("div", { class: "meter" }, rows.map(r =>
    h("div", { class: "r" }, h("span", {}, r[0]), h("div", { class: "tr" }, h("i", { style: `width:${Math.max(0, Math.min(100, r[1] * 100))}%;--c:${r[2] || "var(--brass)"}` })), h("span", { class: "m" }, P(r[1], 1)))));

  // ---------- table positions ----------
  const POS6 = ["BTN", "SB", "BB", "UTG", "HJ", "CO"]; // clockwise from the button
  const POS_NAME = { BTN: "Button", SB: "Small blind", BB: "Big blind", UTG: "Under the gun", HJ: "Hijack", CO: "Cutoff" };
  const PRE_ORDER = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
  const SEAT_XY = [[50, 90], [9, 68], [13, 22], [50, 7], [87, 22], [91, 68]];
  const toward = (xy, f) => [xy[0] + (50 - xy[0]) * f, xy[1] + (47 - xy[1]) * f];
  const posAt = (seat, btn) => POS6[(seat - btn + 6) % 6];

  // ---------- opening chart (simplified 100bb 6-max) ----------
  const OPEN = {
    UTG: "33+, A2s+, K9s+, QTs+, JTs, T9s, 98s, AJo+, KQo",
    HJ: "22+, A2s+, K8s+, Q9s+, J9s+, T9s, 98s, 87s, ATo+, KJo+, QJo",
    CO: "22+, A2s+, K5s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A8o+, KTo+, QTo+, JTo",
    BTN: "22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 96s+, 85s+, 74s+, 64s+, 53s+, 43s, A2o+, K8o+, Q9o+, J9o+, T9o, 98o",
    SB: "22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 96s+, 86s+, 75s+, 64s+, 54s, A2o+, K8o+, Q9o+, J9o+, T9o",
  };
  const OPENSET = Object.fromEntries(Object.entries(OPEN).map(([k, v]) => [k, PE.parseRange(v)]));
  const WHY_POS = {
    UTG: "Five players still to act behind you, and you'll usually play the pot out of position. Only strong hands.",
    HJ: "Four players behind you. A touch wider than under the gun.",
    CO: "Three behind, and only the button can act after you once the flop comes.",
    BTN: "Only the blinds are left, and you act last on every street after the flop. The widest open at the table.",
    SB: "Only the big blind left, but you'll be out of position all hand. Open wide, and raise bigger (3bb).",
  };
  function boundary(set) {
    const out = [];
    for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) {
      const i = GRID[r][c], inn = set.has(i);
      const nb = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < 13 && b < 13);
      if (nb.some(([a, b]) => set.has(GRID[a][b]) !== inn)) out.push(i);
    }
    return out;
  }
  function familyLine(set, i, what) {
    const C = CLASSES[i];
    if (C.type === "p") {
      const lows = [...Array(13).keys()].filter(r => set.has(NAME_TO_CLASS[RANKS[r] + RANKS[r]]));
      return lows.length ? `Pairs: ${RANKS[lows[0]]}${RANKS[lows[0]]} and up ${what}.` : `No pairs ${what}.`;
    }
    const fam = [];
    for (let lo = C.hi - 1; lo >= 0; lo--) fam.push(NAME_TO_CLASS[RANKS[C.hi] + RANKS[lo] + C.type]);
    const label = (C.type === "s" ? "Suited " : "Offsuit ") + RANK_PLURAL[C.hi].toLowerCase();
    const ins = fam.filter(x => set.has(x));
    if (!ins.length) return `${label}: none ${what}.`;
    if (ins.length === fam.length) return `${label}: every one ${what}.`;
    let k = 0; while (k < fam.length && set.has(fam[k])) k++;
    if (k === ins.length) return `${label}: ${CLASSES[fam[k - 1]].name} and better ${what}.`;
    return `${label} that ${what.replace(/^open/, "open")}: ${ins.map(x => CLASSES[x].name).join(", ")}.`;
  }

  // ---------- Nash helpers ----------
  const NS = D.nash.stacks;
  const nearestStack = s => NS.reduce((a, b) => Math.abs(b - s) < Math.abs(a - s) ? b : a);
  const freq = (kind, S, i) => +D.nash[kind][nearestStack(S)][i] / 9;
  function thresholdText(kind, i) {
    let t = 0, any = false;
    for (const s of NS) if (freq(kind, s, i) >= 0.5) { t = s; any = true; }
    if (!any) return kind === "push" ? "never, even at 1 bb" : "never, at any stack here";
    if (t === NS[NS.length - 1]) return "at every stack up to 25 bb";
    return `up to ${t} bb`;
  }
  const nashW = (kind, S) => Array.from(D.nash[kind][nearestStack(S)], ch => +ch / 9);

  // ---------- generators shared by several drills ----------
  function genDraw(minOuts, maxOuts) {
    for (let tries = 0; tries < 4000; tries++) {
      const dk = freshDeck();
      const hero = dk.slice(0, 2), vil = dk.slice(2, 4), board = dk.slice(4, 8);
      const hs = PE.evaluate(hero.concat(board)), vs = PE.evaluate(vil.concat(board));
      if (hs >= vs) continue;
      // prefer real draws: a flush draw or 4 to a straight
      const all = hero.concat(board);
      const suitN = [0, 0, 0, 0]; all.forEach(c => suitN[c & 3]++);
      const fd = hero.some(c => suitN[c & 3] === 4);
      let rm = 0; all.forEach(c => rm |= 1 << (c >> 2)); if (rm & 4096) rm |= 1 << 13;
      let sd = false; for (let t = 4; t <= 13; t++) { let n = 0; for (let k = 0; k < 5; k++) if (rm & (1 << (t - k))) n++; if (n === 4) sd = true; }
      if (!(fd || sd) && !chance(0.2)) continue;
      const rest = dk.slice(8), outs = [], ties = [], dirty = [];
      const heroCat = PE.category(hs);
      for (const c of rest) {
        const a = PE.evaluate(hero.concat(board, [c])), b = PE.evaluate(vil.concat(board, [c]));
        if (a > b) outs.push(c); else if (a === b) ties.push(c);
        else if (PE.category(a) >= 4 && PE.category(a) > heroCat) dirty.push({ c, hero: a, vil: b });
      }
      if (outs.length < minOuts || outs.length > maxOuts) continue;
      return { hero, vil, board, rest, outs, ties, dirty, hs, vs };
    }
  }
  function outsBreakdown(q) {
    const by = {};
    for (const c of q.outs) { const cat = PE.category(PE.evaluate(q.hero.concat(q.board, [c]))); (by[cat] = by[cat] || []).push(c); }
    return Object.keys(by).sort((a, b) => b - a).map(k => `${by[k].length} make ${CAT_NAME[k].toLowerCase().replace(/^one pair/, "a winning pair").replace(/^(straight|flush|full house|straight flush)$/, "a $1")}`).join(", ");
  }

  // =========================================================
  // DRILLS
  // Each: { id, act, title, skill, idea, run(ctx) }
  // ctx: stage, prompt, ctl, finish({grade, lines, extra}), keys{}
  // =========================================================
  const DRILLS = [];
  const def = d => DRILLS.push(d);

  // ---- 01 Who wins ----
  def({
    id: "rank", act: 1, title: "Who wins?", skill: "Tell which hand takes the pot at showdown.",
    idea: `<p>Every hand is your <b>best five cards</b> out of seven: your two plus the five on the board.</p>
      <p>Strongest first: straight flush, four of a kind, full house, flush, straight, three of a kind, two pair, one pair, high card.</p>
      <p>Same type of hand? Compare its top card, then the <b>kickers</b>, one at a time. If all five cards match, the pot is split, even when the hole cards are different.</p>`,
    run(ctx) {
      let q;
      for (;;) {
        const dk = freshDeck();
        q = { a: dk.slice(0, 2), b: dk.slice(2, 4), board: dk.slice(4, 9) };
        q.sa = PE.evaluate(q.a.concat(q.board)); q.sb = PE.evaluate(q.b.concat(q.board));
        const same = PE.category(q.sa) === PE.category(q.sb);
        if (same || chance(0.3)) break;
      }
      const stage = h("div", { class: "felt" },
        h("div", { class: "zone" }, h("div", { class: "lbl", html: "Player <b>B</b>" }), cardRow(q.b, { deal: 0 })),
        h("div", { class: "zone board" }, cardRow(q.board, { deal: 0.2 })),
        h("div", { class: "zone" }, cardRow(q.a, { deal: 0.1 }), h("div", { class: "lbl", html: "Player <b>A</b>" })));
      ctx.stage.append(stage);
      ctx.prompt.innerHTML = "Who wins the pot?";
      const answer = ans => {
        const truth = q.sa > q.sb ? "A" : q.sb > q.sa ? "B" : "S";
        const ba = PE.bestFive(q.a.concat(q.board)), bb = PE.bestFive(q.b.concat(q.board));
        const win = truth === "A" ? ba.cards : truth === "B" ? bb.cards : ba.cards;
        stage.querySelectorAll(".card").forEach(el => el.classList.toggle(win.includes(+el.dataset.c) ? "hl" : "dim", true));
        const lines = [
          `<b>A:</b> ${PE.describe(q.sa)} <span class="m">${cardsTxt(ba.cards)}</span>`,
          `<b>B:</b> ${PE.describe(q.sb)} <span class="m">${cardsTxt(bb.cards)}</span>`,
        ];
        const dc = PE.decider(q.sa, q.sb);
        if (truth === "S") lines.push(ba.cards.every(c => q.board.includes(c)) ? "The board is the best hand for both: <b>the board plays</b>, so the pot is split." : "Both make the identical five-card hand, so the pot is split. Your sixth and seventh cards never count.");
        else if (!dc) lines.push(`${CAT_NAME[PE.category(Math.max(q.sa, q.sb))]} beats ${CAT_NAME[PE.category(Math.min(q.sa, q.sb))].toLowerCase()}.`);
        else if (dc.index === 0) lines.push(`Same hand type, so the higher one wins: ${RANK_PLURAL[Math.max(dc.a, dc.b)].toLowerCase()} beat ${RANK_PLURAL[Math.min(dc.a, dc.b)].toLowerCase()}.`);
        else lines.push(`Settled by the ${["", "second", "third", "fourth", "fifth"][dc.index]} card: a ${PE.RANK_NAME[Math.max(dc.a, dc.b)].toLowerCase()} beats a ${PE.RANK_NAME[Math.min(dc.a, dc.b)].toLowerCase()}. That's the <b>kicker</b>.`);
        ctx.finish({ log: { pick: ans, truth }, grade: ans === truth ? "ok" : "no", lines });
      };
      ctx.buttons([["A wins", () => answer("A"), "a"], ["Split", () => answer("S"), "s", "mid"], ["B wins", () => answer("B"), "b"]]);
    },
  });

  // ---- 02 Best five ----
  def({
    id: "five", act: 1, title: "Best five", skill: "Pick out the five cards that actually play.",
    idea: `<p>Tap the five cards that make your hand. Sometimes that's both of yours, sometimes one, sometimes neither: then <b>the board plays</b>.</p>
      <p>Watch for a third pair that doesn't count, a straight hiding behind a pair, and a flush that only needs one of your cards.</p>`,
    run(ctx) {
      let hole, board, best;
      for (;;) {
        const dk = freshDeck(); hole = dk.slice(0, 2); board = dk.slice(2, 7);
        best = PE.bestFive(hole.concat(board));
        if (PE.category(best.score) >= 1 || chance(0.15)) break;
      }
      const sel = new Set();
      const mk = (c, k) => { const el = cardEl(c, { cls: "tap", deal: k * 0.06 }); el.onclick = () => { if (ctx.done) return; sel.has(c) ? sel.delete(c) : sel.size < 5 && sel.add(c); el.classList.toggle("sel", sel.has(c)); lock.disabled = sel.size !== 5; }; return el; };
      const stage = h("div", { class: "felt" },
        h("div", { class: "zone board" }, h("div", { class: "cards" }, board.map((c, k) => mk(c, 0.15 + k * 0.06)))),
        h("div", { class: "zone" }, h("div", { class: "cards" }, hole.map((c, k) => mk(c, k * 0.06))), h("div", { class: "lbl", html: "<b>Your</b> hand" })));
      ctx.stage.append(stage);
      ctx.prompt.innerHTML = "Tap your best five cards.";
      const lock = ctx.buttons([["Lock in", () => {
        const s = PE.evaluate([...sel]);
        const ok = s === best.score;
        stage.querySelectorAll(".card").forEach(el => { el.classList.remove("sel"); el.classList.add(best.cards.includes(+el.dataset.c) ? "hl" : "dim"); });
        const lines = [`Best hand: <b>${PE.describe(best.score)}</b> <span class="m">${cardsTxt(best.cards)}</span>`];
        if (!ok) lines.push(`Your five made ${PE.describe(s).replace(/^./, m => m.toLowerCase())}.`);
        const used = best.cards.filter(c => hole.includes(c)).length;
        lines.push(used === 0 ? "Neither of your cards plays. Anyone left in has at least this hand." : used === 1 ? "Only one of your cards plays." : "Both of your cards play.");
        ctx.finish({ grade: ok ? "ok" : "no", lines });
      }, "enter"]])[0];
      lock.disabled = true;
    },
  });

  // ---- 03 Seats ----
  const SEAT_Q = [
    ["Tap the <em>button</em>.", "BTN"], ["Tap the <em>small blind</em>.", "SB"], ["Tap the <em>big blind</em>.", "BB"],
    ["Tap <em>under the gun</em>.", "UTG"], ["Tap the <em>hijack</em>.", "HJ"], ["Tap the <em>cutoff</em>.", "CO"],
    ["Before the flop, who acts <em>first</em>?", "UTG"], ["After the flop, who acts <em>first</em>?", "SB"],
    ["After the flop, who acts <em>last</em>?", "BTN"], ["Before the flop, who acts <em>last</em>?", "BB"],
  ];
  const SEAT_FACT = {
    BTN: "The button acts last on every street after the flop. The best seat at the table.",
    SB: "First to act after the flop, every street. The worst seat, even with half a blind already in.",
    BB: "Acts last before the flop (it already has a full bet in), then second after it.",
    UTG: "'Under the gun': first to act before the flop, with five players still to come.",
    HJ: "Two seats right of the button. It 'hijacks' the steal before the cutoff can.",
    CO: "One seat right of the button. It 'cuts off' the button's chance to steal the blinds.",
  };
  def({
    id: "seats", act: 1, title: "Seats", skill: "Name every seat, and who acts when.",
    idea: `<p>The <b>button</b> (the D disc) is the dealer seat. Going left from it: <b>small blind, big blind, under the gun, hijack, cutoff</b>, then back to the button.</p>
      <p>Before the flop, action starts left of the big blind. After the flop it starts left of the button, so the button always acts last.</p>
      <p><b>Acting last is an edge.</b> You see what everyone else did before you decide.</p>`,
    run(ctx) {
      const btn = rnd(6), [qText, want] = pick(SEAT_Q);
      const felt = h("div", { class: "felt oval" });
      const seats = [];
      SEAT_XY.forEach((xy, s) => {
        const el = h("div", { class: "seat tapme", style: `left:${xy[0]}%;top:${xy[1]}%` },
          h("div", { class: "mini" }, backEl({ deal: s * 0.05 }), backEl({ deal: s * 0.05 + 0.3 })),
          h("div", { class: "plate" }, h("div", { class: "p" }, "Seat " + (s + 1)), h("div", { class: "q" }, fmt(100) + " bb")));
        el.onclick = () => { if (!ctx.done) answer(s); };
        seats.push(el); felt.append(el);
      });
      const bxy = toward(SEAT_XY[btn], 0.28);
      felt.append(h("div", { class: "dbtn", style: `left:${bxy[0] + 6}%;top:${bxy[1]}%` }, "D"));
      for (const [k, amt] of [[1, "½"], [2, "1"]]) {
        const s = (btn + k) % 6, xy = toward(SEAT_XY[s], 0.46);
        felt.append(h("div", { class: "blind", style: `left:${xy[0]}%;top:${xy[1]}%` }, chipsEl(1, { label: amt })));
      }
      ctx.stage.append(felt);
      ctx.prompt.innerHTML = qText + `<span class="sub">The D disc marks the button.</span>`;
      ctx.buttons([]);
      function answer(s) {
        const got = posAt(s, btn), ok = got === want;
        seats.forEach((el, k) => {
          const p = posAt(k, btn);
          el.classList.remove("tapme");
          $(".p", el).textContent = p;
          if (p === want) el.classList.add("good"); else if (k === s) el.classList.add("bad");
        });
        const lines = [];
        if (!ok) lines.push(`You tapped the <b>${POS_NAME[got].toLowerCase()}</b>. The answer was the <b>${POS_NAME[want].toLowerCase()}</b>.`);
        lines.push(SEAT_FACT[want]);
        lines.push(`From the button, going left: <span class="m">BTN → SB → BB → UTG → HJ → CO</span>`);
        ctx.finish({ log: { asked: want, tapped: got }, grade: ok ? "ok" : "no", lines });
      }
    },
  });

  // ---- 04 Open or fold ----
  def({
    id: "open", act: 2, title: "Open or fold", skill: "Know what to raise when it's folded to you.",
    idea: `<p>When everyone before you folds, you <b>raise</b> or you <b>fold</b>. Just calling the big blind ("limping") is a leak, so skip it.</p>
      <p>The later your seat, the fewer players behind you can wake up with a better hand, and the more often you act last after the flop. So the range widens around the table: <span class="num">UTG 15%</span> → <span class="num">HJ 20%</span> → <span class="num">CO 28%</span> → <span class="num">BTN 44%</span>.</p>
      <p>This is a standard simplified chart for 6-handed cash games with 100 big blinds (2.5bb opens, 3bb from the small blind). Solver charts mix a few edge hands; this one picks a side.</p>`,
    run(ctx) {
      const pos = pick(["UTG", "HJ", "CO", "BTN", "SB"]), set = OPENSET[pos];
      const btn = (6 - POS6.indexOf(pos)) % 6;
      const cls = chance(0.55) ? pick(boundary(set)) : PE.classOf(...freshDeck().slice(0, 2));
      const hand = comboOf(cls); shuffle(hand);
      const felt = h("div", { class: "felt oval" });
      const myOrder = PRE_ORDER.indexOf(pos);
      SEAT_XY.forEach((xy, s) => {
        if (s === 0) return;
        const p = posAt(s, btn), folded = PRE_ORDER.indexOf(p) < myOrder;
        felt.append(h("div", { class: "seat", style: `left:${xy[0]}%;top:${xy[1]}%` },
          h("div", { class: "mini" }, backEl({ cls: folded ? "muck" : "" }), backEl({ cls: folded ? "muck" : "" })),
          h("div", { class: "plate" }, h("div", { class: "p" }, p), h("div", { class: "q" }, folded ? "fold" : "100 bb"))));
      });
      felt.append(h("div", { class: "seat hero", style: `left:50%;top:94%` }, h("div", { class: "plate" }, h("div", { class: "p" }, pos + " · you"))));
      felt.append(h("div", { class: "herohand", style: "bottom:16%" }, hand.map((c, k) => cardEl(c, { deal: 0.1 + k * 0.08 }))));
      const bxy = toward(SEAT_XY[btn], 0.3);
      felt.append(h("div", { class: "dbtn", style: `left:${bxy[0] + 7}%;top:${bxy[1]}%` }, "D"));
      for (const [k, amt] of [[1, "½"], [2, "1"]]) { const xy = toward(SEAT_XY[(btn + k) % 6], 0.46); felt.append(h("div", { class: "blind", style: `left:${xy[0]}%;top:${xy[1]}%` }, chipsEl(1, { label: amt }))); }
      ctx.stage.append(felt);
      ctx.prompt.innerHTML = pos === "UTG" ? `First to act, <em>under the gun</em>.` : `Folded to you in the <em>${POS_NAME[pos].toLowerCase()}</em>.`;
      const answer = raise => {
        const truth = set.has(cls), ok = raise === truth;
        const lines = [
          `<b>${CLASSES[cls].name}</b> is ${truth ? "a raise" : "a fold"} from the ${pos}. ${familyLine(set, cls, "open here")}`,
          WHY_POS[pos],
          `The ${pos} opens <span class="m">${P(PE.rangePct(set) / 100)}</span> of hands, about 1 in ${Math.round(100 / PE.rangePct(set))}.`,
        ];
        const extra = h("div", {}, gridEl(i => set.has(i) ? "in" : "", { me: cls }), h("div", { class: "gridkey", html: `<span><i style="background:var(--brass)"></i>${pos} opens</span><span>□ outlined: your hand</span>` }));
        ctx.finish({ log: { hand: CLASSES[cls].name, pos, chose: raise ? "raise" : "fold", right: truth ? "raise" : "fold" }, grade: ok ? "ok" : "no", lines, extra });
      };
      ctx.buttons([["Fold", () => answer(false), "f", "fold"], [pos === "SB" ? "Raise 3bb" : "Raise 2.5bb", () => answer(true), "r"]]);
    },
  });

  // ---- 05 Paint the range ----
  def({
    id: "paint", act: 2, title: "Paint the range", skill: "Draw each seat's opening range from memory.",
    idea: `<p>Draw the chart from memory. Drag across cells to fill them; start a drag on a filled cell to erase.</p>
      <p>The grid: <b>pairs</b> run down the diagonal, <b>suited</b> hands sit above it, <b>offsuit</b> below. Suited hands make flushes, so the top half fills further.</p>
      <p>Score: at least 90% overlap with the chart, counted by real card combinations.</p>`,
    run(ctx) {
      const pos = pick(["UTG", "HJ", "CO", "BTN", "SB"]), set = OPENSET[pos];
      const mine = new Set();
      const grid = gridEl(() => "", { paint: true });
      const counter = h("div", { class: "count" });
      const upd = () => { counter.innerHTML = `Painted <b>${P(PE.rangeCombos(mine) / 1326)}</b> · the ${pos} opens about ${P(PE.rangePct(set) / 100)}`; };
      let mode = null;
      const cellAt = e => { const t = document.elementFromPoint(e.clientX, e.clientY); return t && t.dataset && t.dataset.i != null && grid.contains(t) ? t : null; };
      const paintCell = t => { const i = +t.dataset.i; if (mode === "add") mine.add(i); else mine.delete(i); t.classList.toggle("in", mode === "add"); upd(); };
      grid.addEventListener("pointerdown", e => { if (ctx.done) return; const t = cellAt(e); if (!t) return; mode = mine.has(+t.dataset.i) ? "del" : "add"; paintCell(t); grid.setPointerCapture(e.pointerId); });
      grid.addEventListener("pointermove", e => { if (!mode) return; const t = cellAt(e); if (t) paintCell(t); });
      const stop = () => { mode = null; };
      grid.addEventListener("pointerup", stop); grid.addEventListener("pointercancel", stop);
      upd();
      ctx.stage.append(h("div", { class: "tabs" }, ["UTG", "HJ", "CO", "BTN", "SB"].map(p => h("b", { class: p === pos ? "on" : "" }, p))), grid, counter);
      ctx.prompt.innerHTML = `Paint the <em>${POS_NAME[pos].toLowerCase()}</em> opening range.`;
      ctx.buttons([["Clear", () => { mine.clear(); grid.querySelectorAll(".c").forEach(c => c.classList.remove("in")); upd(); }, null, "fold"], ["Check", () => {
        let inter = 0, uni = 0, miss = 0, extra = 0;
        for (let i = 0; i < N; i++) {
          const a = set.has(i), b = mine.has(i), w = PE.comboCount(i);
          if (a && b) inter += w; if (a || b) uni += w; if (a && !b) miss++; if (b && !a) extra++;
        }
        const score = uni ? inter / uni : 0, ok = score >= 0.9;
        grid.querySelectorAll(".c").forEach(c => {
          const i = +c.dataset.i, a = set.has(i), b = mine.has(i);
          c.className = "c " + (CLASSES[i].type === "s" ? "s " : "") + (a && b ? "in" : a ? "miss" : b ? "extra" : "");
        });
        const lines = [`Overlap: <span class="m">${P(score)}</span>. ${miss ? `${miss} hand${miss > 1 ? "s" : ""} missed (outlined)` : "Nothing missed"}, ${extra ? `${extra} extra (red)` : "nothing extra"}.`];
        lines.push(WHY_POS[pos]);
        ctx.finish({ log: { pos, overlap: +score.toFixed(3), missed: miss, extra }, grade: ok ? "ok" : score >= 0.8 ? "mid" : "no", lines, okCounts: ok, verdict: ok ? null : score >= 0.8 ? "Close." : null });
      }, "enter"]]);
    },
  });

  // ---- 06 Matchups ----
  function archetype(a, b) {
    const A = CLASSES[a], B = CLASSES[b];
    if (A.type === "p" && B.type === "p") return "Bigger pair vs smaller pair: about <b>80/20</b>.";
    if (A.type === "p" || B.type === "p") {
      const pr = A.type === "p" ? A : B, un = A.type === "p" ? B : A;
      const overs = [un.hi, un.lo].filter(r => r > pr.hi).length;
      if (un.hi === pr.hi || un.lo === pr.hi) return "Pair vs a hand holding one of its cards: the pair is a big favourite, about <b>85/15</b> or more.";
      return overs === 2 ? "Pair vs two overcards: the classic <b>coin flip</b>, about 55/45 to the pair." : overs === 1 ? "Pair vs one overcard: about <b>70/30</b> to the pair." : "Pair vs two lower cards: about <b>85/15</b> to the pair.";
    }
    const shared = [A.hi, A.lo].filter(r => r === B.hi || r === B.lo).length;
    if (shared) return "They share a card, so the better kicker <b>dominates</b>: about 70/30.";
    if (Math.min(A.hi, A.lo) > Math.max(B.hi, B.lo) || Math.min(B.hi, B.lo) > Math.max(A.hi, A.lo)) return "Two higher cards vs two lower cards: about <b>63/37</b>.";
    return "Interleaved cards (one high, one between): close, about <b>55/45 to 60/40</b>.";
  }
  def({
    id: "flip", act: 2, title: "Matchups", skill: "Feel how often hand beats hand before the flop.",
    idea: `<p>Before the flop, few hands are huge favourites. Learn the shapes:</p>
      <p><span class="num">80/20</span> bigger pair vs smaller pair<br><span class="num">70/30</span> dominated (AK vs AQ), or pair vs one overcard<br><span class="num">55/45</span> pair vs two overcards, the "coin flip"<br><span class="num">63/37</span> two higher cards vs two lower</p>
      <p>Get within 7% to score. Equities come from about 12,000 run-outs per matchup.</p>`,
    run(ctx) {
      const playable = rangeOrder.slice(0, 95);
      let a, b, ha, hb;
      for (;;) {
        a = pick(playable); b = pick(playable); if (a === b) continue;
        ha = comboOf(a); hb = comboOf(b);
        if (!ha.some(c => hb.includes(c))) break;
      }
      const truth = eqCls(a, b);
      const val = h("div", { class: "val" }, "50", h("small", {}, "%"));
      const rng = h("input", { type: "range", min: 0, max: 100, value: 50, step: 1 });
      const sync = () => { val.firstChild.textContent = rng.value; rng.style.setProperty("--p", rng.value + "%"); };
      rng.oninput = sync; sync();
      ctx.stage.append(h("div", { class: "felt" },
        h("div", { class: "zone" }, h("div", { class: "lbl", html: "Player <b>B</b>" }), cardRow(hb, { deal: 0.1 })),
        h("div", { class: "zone board" }, h("div", { class: "lbl" }, "all in before the flop")),
        h("div", { class: "zone" }, cardRow(ha, { deal: 0 }), h("div", { class: "lbl", html: "Player <b>A</b>" }))),
        h("div", { class: "slider" }, val, rng, h("div", { class: "ticks" }, h("span", {}, "0"), h("span", {}, "50"), h("span", {}, "100"))));
      ctx.prompt.innerHTML = `How often does <em>A</em> win?`;
      ctx.buttons([["Lock in", () => {
        const g = +rng.value / 100, err = Math.abs(g - truth);
        rng.disabled = true;
        const lines = [
          `<b>${CLASSES[a].name}</b> wins <span class="m">${P(truth)}</span> against <b>${CLASSES[b].name}</b>. You said ${P(g)}, off by ${Math.round(err * 100)}.`,
          archetype(a, b),
        ];
        const extra = meter([[CLASSES[a].name, truth], [CLASSES[b].name, 1 - truth, "var(--tx4)"]]);
        ctx.finish({ log: { a: CLASSES[a].name, b: CLASSES[b].name, guess: g, truth: +truth.toFixed(3) }, grade: err <= 0.07 ? "ok" : "no", lines, extra });
      }, "enter"]]);
    },
  });

  // ---- 07 Outs ----
  def({
    id: "outs", act: 2, title: "Outs", skill: "Find every card that wins you the pot.",
    idea: `<p>An <b>out</b> is a card that turns your losing hand into the winner. You can see their cards here, so count exactly.</p>
      <p>Tap every card in the deck that wins on the river. Watch for <b>dirty outs</b>: a card that makes your flush but gives them a full house isn't an out. Cards that only tie don't count.</p>
      <p>Common counts: <span class="num">9</span> flush draw · <span class="num">8</span> open-ended straight draw · <span class="num">4</span> gutshot · <span class="num">15</span> flush + straight draw.</p>`,
    run(ctx) {
      const q = genDraw(3, 17), picked = new Set();
      ctx.stage.append(h("div", { class: "felt" },
        h("div", { class: "zone" }, h("div", { class: "lbl", html: `Them · <b>${PE.describe(q.vs)}</b>` }), cardRow(q.vil, { deal: 0.1 })),
        h("div", { class: "zone board" }, cardRow(q.board, { deal: 0.2 })),
        h("div", { class: "zone" }, cardRow(q.hero, { deal: 0 }), h("div", { class: "lbl", html: `You · <b>${PE.describe(q.hs)}</b>` }))));
      const deck = h("div", { class: "deck" });
      const counter = h("div", { class: "count" });
      const upd = () => { counter.innerHTML = `<b>${picked.size}</b> picked`; };
      for (let s = 0; s < 4; s++) for (let r = 12; r >= 0; r--) {
        const c = PE.card(r, s);
        if (!q.rest.includes(c)) { deck.append(h("div", { class: "slot" })); continue; }
        const el = cardEl(c, { flat: true, cls: "tap" });
        el.onclick = () => { if (ctx.done) return; picked.has(c) ? picked.delete(c) : picked.add(c); el.classList.toggle("sel", picked.has(c)); upd(); };
        deck.append(el);
      }
      upd();
      ctx.stage.append(deck, counter);
      ctx.prompt.innerHTML = `One card to come. Tap your <em>outs</em>.`;
      ctx.buttons([["Check", () => {
        const truth = new Set(q.outs);
        let hit = 0, wrong = 0;
        deck.querySelectorAll(".card").forEach(el => {
          const c = +el.dataset.c, t = truth.has(c), p = picked.has(c);
          el.classList.remove("sel");
          if (t && p) { el.classList.add("hl"); hit++; } else if (t) el.classList.add("miss"); else if (p) { el.classList.add("wrong"); wrong++; } else el.classList.add("dim");
        });
        const ok = hit === truth.size && wrong === 0;
        const lines = [`<b>${q.outs.length} outs</b>: ${outsBreakdown(q)}.`];
        if (!ok) lines.push(`You found ${hit} of ${q.outs.length}${wrong ? `, plus ${wrong} that don't win` : ""}. Missed outs pulse; wrong picks are red.`);
        if (q.dirty.length) { const d = q.dirty[0]; lines.push(`Dirty out: the <span class="m">${cardTxt(d.c)}</span> gives you ${PE.describe(d.hero).replace(/^./, m => m.toLowerCase())} but gives them ${PE.describe(d.vil).replace(/^./, m => m.toLowerCase())}.`); }
        if (q.ties.length) lines.push(`${q.ties.length === 1 ? "One card splits" : q.ties.length + " cards split"} the pot (<span class="m">${cardsTxt(q.ties.slice(0, 6))}</span>). Not an out.`);
        ctx.finish({ log: { outs: q.outs.length, found: hit, wrong }, grade: ok ? "ok" : "no", lines, note: `Rule of 2: ${q.outs.length} outs × 2 ≈ ${q.outs.length * 2}% to hit. Exactly ${q.outs.length}/44 = ${P(q.outs.length / 44)} here.` });
      }, "enter"]]);
    },
  });

  // ---- 08 Pot odds ----
  const FRACS = [[1 / 3, "a third of the pot"], [1 / 2, "half the pot"], [2 / 3, "two-thirds of the pot"], [3 / 4, "three-quarters of the pot"], [1, "the size of the pot"], [1.5, "1.5× the pot"]];
  def({
    id: "odds", act: 2, title: "Pot odds", skill: "Call a bet only when the price is right.",
    idea: `<p>When someone bets, the pot gives you a <b>price</b>. The equity you need is <span class="num">your call ÷ the pot after you call</span>.</p>
      <p>A half-pot bet needs <span class="num">25%</span>. A pot-size bet needs <span class="num">33%</span>.</p>
      <p>Your chance with one card to come is about <b>outs × 2</b> (the rule of 2). With two cards to come, outs × 4. Call when your chance beats the price.</p>`,
    run(ctx) {
      const q = genDraw(4, 15);
      const [frac, fracName] = pick(FRACS);
      const pot = (2 + rnd(19)) * 10, bet = Math.max(5, Math.round(pot * frac / 5) * 5);
      const need = bet / (pot + 2 * bet), have = q.outs.length / 46;
      ctx.stage.append(h("div", { class: "felt" },
        h("div", { class: "zone" }, h("div", { class: "cards" }, backEl({ deal: 0 }), backEl({ deal: 0.06 })), h("div", { class: "lbl" }, "They bet")),
        h("div", { class: "potline" }, h("div", {}, chipsEl(pot), h("div", { class: "lbl", style: "font:500 10px var(--mn);color:var(--tx3);text-align:center;letter-spacing:.1em" }, "POT")),
          h("div", { class: "deal", style: "--d:.35s" }, chipsEl(bet), h("div", { class: "lbl", style: "font:500 10px var(--mn);color:var(--brass2);text-align:center;letter-spacing:.1em" }, "THEIR BET"))),
        h("div", { class: "zone board" }, cardRow(q.board, { deal: 0.1 })),
        h("div", { class: "zone" }, cardRow(q.hero, { deal: 0.05 }), h("div", { class: "lbl", html: `You · <b>${q.outs.length} outs</b> on the river` }))));
      ctx.prompt.innerHTML = `They bet <em>${bet}</em> into ${pot}.<span class="sub">That's ${fracName}. You count ${q.outs.length} outs. One card to come.</span>`;
      const answer = call => {
        const close = Math.abs(have - need) < 0.02, truth = have >= need;
        const ev = have * (pot + bet) - (1 - have) * bet;
        const lines = [
          `Call <span class="m">${bet}</span> to win <span class="m">${pot + bet}</span>: you put in ${bet} of a ${pot + 2 * bet} final pot, so you need <b>${P(need, 1)}</b>.`,
          `${q.outs.length} outs × 2 ≈ ${q.outs.length * 2}%. Exactly: ${q.outs.length} ÷ 46 unseen cards = <b>${P(have, 1)}</b>.`,
          close ? `Too close to call by maths alone. This is where <b>implied odds</b> decide it: if you'll win a bet more when you hit, call.` :
            `${truth ? "Calling" : "Calling here"} ${ev >= 0 ? "wins" : "loses"} about <span class="m">${Math.abs(ev).toFixed(1)}</span> chips each time on average.`,
        ];
        const extra = meter([["You need", need, "var(--tx3)"], ["You have", have, have >= need ? "var(--ok)" : "var(--no)"]]);
        ctx.finish({ log: { pot, bet, need: +need.toFixed(3), have: +have.toFixed(3), chose: call ? "call" : "fold", right: close ? "either" : truth ? "call" : "fold" }, grade: close || call === truth ? "ok" : "no", lines, extra, verdict: close ? "Either works." : null });
      };
      ctx.buttons([["Fold", () => answer(false), "f", "fold"], ["Call " + bet, () => answer(true), "c"]]);
    },
  });

  // ---- 09 Bluff maths ----
  def({
    id: "bluff", act: 2, title: "Bluff maths", skill: "How often a bet must work, and how often to defend.",
    idea: `<p>A bluff risks your bet to win the pot. It breaks even when they fold <span class="num">bet ÷ (bet + pot)</span> of the time.</p>
      <p>Flip it round for defence. To stop their bluffs from printing money, keep going with <span class="num">pot ÷ (pot + bet)</span> of your hands. That's the <b>minimum defence frequency</b>.</p>
      <p>Half pot: <span class="num">33% / 67%</span>. Pot: <span class="num">50% / 50%</span>. Twice the pot: <span class="num">67% / 33%</span>.</p>`,
    run(ctx) {
      const type = pick(["bluff", "defend"]);
      const [frac] = pick(FRACS.concat([[2, ""]]));
      const pot = (4 + rnd(17)) * 10, bet = Math.max(5, Math.round(pot * frac / 5) * 5);
      const truth = type === "bluff" ? bet / (bet + pot) : pot / (pot + bet);
      const val = h("div", { class: "val" }, "50", h("small", {}, "%"));
      const rng = h("input", { type: "range", min: 0, max: 100, value: 50 });
      const sync = () => { val.firstChild.textContent = rng.value; rng.style.setProperty("--p", rng.value + "%"); }; rng.oninput = sync; sync();
      ctx.stage.append(h("div", { class: "felt" },
        h("div", { class: "potline" }, h("div", {}, chipsEl(pot), h("div", { class: "amt" }, h("small", {}, "pot"))),
          h("div", { class: "deal", style: "--d:.25s" }, chipsEl(bet), h("div", { class: "amt" }, h("small", {}, type === "bluff" ? "your bluff" : "their bet")))),
        h("div", { class: "zone" }, h("div", { class: "lbl" }, type === "bluff" ? "the river · you have nothing" : "the river · they bet"))),
        h("div", { class: "slider" }, val, rng, h("div", { class: "ticks" }, h("span", {}, "0"), h("span", {}, "50"), h("span", {}, "100"))));
      ctx.prompt.innerHTML = type === "bluff" ? `You bluff <em>${bet}</em> into ${pot}. How often must they fold to break even?` : `They bet <em>${bet}</em> into ${pot}. What share of your hands must keep going?`;
      ctx.buttons([["Lock in", () => {
        const g = +rng.value / 100, err = Math.abs(g - truth); rng.disabled = true;
        const lines = type === "bluff" ? [
          `You risk <span class="m">${bet}</span> to win <span class="m">${pot}</span>. Break-even: ${bet} ÷ (${bet} + ${pot}) = <b>${P(truth)}</b>.`,
          `If they fold more often than that, the bluff makes money even with the worst hand. You said ${P(g)}.`,
        ] : [
          `They risk <span class="m">${bet}</span> to win <span class="m">${pot}</span>. Keep going with ${pot} ÷ (${pot} + ${bet}) = <b>${P(truth)}</b> of your range.`,
          `Fold more than ${P(1 - truth)} and they can bet any two cards for profit. You said ${P(g)}.`,
        ];
        ctx.finish({ log: { type, bet, pot, guess: g, truth: +truth.toFixed(3) }, grade: err <= 0.05 ? "ok" : "no", lines, note: "Bigger bets need more folds to work, and let the defender fold more." });
      }, "enter"]]);
    },
  });

  // ---- 10 Stack in big blinds ----
  const LEVELS = [[25, 50], [50, 100], [75, 150], [100, 200], [150, 300], [200, 400], [300, 600], [400, 800], [500, 1000], [600, 1200], [1000, 2000], [1500, 3000]];
  const zoneOf = bb => bb >= 40 ? ["Deep", "Play close to a cash game: open, 3-bet, see flops."] :
    bb >= 25 ? ["Middling", "Open normally, but 3-bet shoves start to appear."] :
    bb >= 15 ? ["Short", "Open small (2–2.2bb). Facing a raise, re-shove or fold more than you call."] :
    bb >= 10 ? ["Very short", "Open-shove from late seats, re-shove often, rarely call."] :
    ["Push or fold", "Any raise commits you, so just shove or fold. The next drill is this zone."];
  def({
    id: "stack", act: 3, title: "Stack in blinds", skill: "Read your stack the way tournament players do.",
    idea: `<p>In a tournament, chips mean nothing without the blinds. Count your stack in <b>big blinds</b>: your stack ÷ the big blind.</p>
      <p>That number tells you which game you're in. Deep stacks play like cash. Under about 10–12 bb you only shove or fold.</p>
      <p>20,000 chips is huge at 100/200 and nearly dead at 2,000/4,000.</p>`,
    run(ctx) {
      const [sb, bb] = pick(LEVELS), want = 4 + rnd(70);
      const stack = Math.max(bb, Math.round((want * bb + (Math.random() - 0.5) * 0.6 * bb) / 25) * 25);
      const truth = Math.round(stack / bb);
      const opts = new Set([truth]);
      for (const d of [Math.round(stack / sb), Math.round(stack / (sb + bb)), Math.round(truth * 1.3), truth + 5, Math.max(1, truth - 4), truth * 10]) { if (opts.size < 4 && d > 0) opts.add(d); }
      const choices = shuffle([...opts]);
      ctx.stage.append(h("div", { class: "felt" },
        h("div", { class: "zone" }, h("div", { class: "lbl" }, "blinds"), h("div", { class: "serif", style: "font-size:30px" }, `${fmt(sb)} / ${fmt(bb)}`)),
        h("div", { class: "potline" }, chipsEl(stack, { denoms: [5000, 1000, 500, 100, 25], label: fmt(stack) + " <small>chips</small>" }))));
      ctx.prompt.innerHTML = `How many <em>big blinds</em> is your stack?`;
      const grid = h("div", { class: "choices" });
      choices.forEach(n => { const b = h("button", { class: "btn" }, String(n)); b.onclick = () => { if (ctx.done) return; answer(n, b); }; grid.append(b); });
      ctx.ctl.append(grid);
      ctx.keys = Object.fromEntries(choices.map((n, k) => [String(k + 1), () => !ctx.done && answer(n, grid.children[k])]));
      function answer(n, el) {
        [...grid.children].forEach(b => { if (+b.textContent === truth) b.classList.add("right"); else if (b === el) b.classList.add("wrongc"); });
        const [zn, zt] = zoneOf(truth);
        const lines = [`${fmt(stack)} ÷ ${fmt(bb)} = <b>${truth} big blinds</b>.`];
        if (n === Math.round(stack / sb) && n !== truth) lines.push("That answer divided by the small blind. Always use the big one.");
        lines.push(`<b>${zn}.</b> ${zt}`);
        ctx.finish({ log: { stack, bb, answer: n, truth }, grade: n === truth ? "ok" : "no", lines, keepCtl: true });
      }
    },
  });

  // ---- 11 Push or fold ----
  function nearThreshold(kind, S) {
    const out = [];
    for (let i = 0; i < N; i++) { const f = freq(kind, S, i); const fl = freq(kind, Math.max(1, S - 3), i), fh = freq(kind, Math.min(25, S + 3), i); if ((fl >= 0.5) !== (fh >= 0.5) || (f > 0.2 && f < 0.8)) out.push(i); }
    return out;
  }
  def({
    id: "shove", act: 3, title: "Push or fold", skill: "Shove or fold short-stacked from the small blind.",
    idea: `<p>Short-stacked, a raise you can't fold is just a worse shove. So you <b>push all in, or fold</b>.</p>
      <p>This chart is the <b>Nash equilibrium</b> for the small blind when it's folded to you: shove this range and no opponent can exploit it. It was calculated for this app from all 169×169 starting-hand matchups.</p>
      <p>From earlier seats, shove tighter: more players behind you can wake up with a hand.</p>`,
    run(ctx) {
      const S = chance(0.85) ? 2 + rnd(14) : pick([18, 20]);
      const near = nearThreshold("push", S);
      const cls = chance(0.6) && near.length ? pick(near) : PE.classOf(...freshDeck().slice(0, 2));
      const hand = shuffle(comboOf(cls)), f = freq("push", S, cls);
      ctx.stage.append(h("div", { class: "felt" },
        h("div", { class: "zone" }, h("div", { class: "cards" }, backEl({ deal: 0 }), backEl({ deal: 0.06 })), h("div", { class: "lbl", html: `Big blind · <b>${S} bb</b>` })),
        h("div", { class: "potline" }, h("div", {}, chipsEl(1, { label: "½" })), h("div", {}, chipsEl(2, { label: "1" }))),
        h("div", { class: "zone" }, cardRow(hand, { deal: 0.1 }), h("div", { class: "lbl", html: `You · small blind · <b>${S} bb</b>` }))));
      ctx.prompt.innerHTML = `Folded to you. <em>${S} big blinds</em> deep.`;
      const answer = shove => {
        const mixed = f > 0.3 && f < 0.7, truth = f >= 0.5, ok = mixed || shove === truth;
        const w = nashW("push", S);
        const lines = [
          `Nash ${truth ? "shoves" : "folds"} <b>${CLASSES[cls].name}</b> here${mixed ? " (a mixed spot: either is fine)" : ""}. It shoves ${CLASSES[cls].name} ${thresholdText("push", cls)}.`,
          `At ${S} bb the small blind shoves <span class="m">${P(weightsPct(w))}</span> of hands.`,
          `Folding costs your ½ bb. Shoving wins 1.5 bb right away whenever they fold, and the shorter you are, the less a call hurts you and the more they need a real hand to call.`,
        ];
        const extra = h("div", {}, gridEl(i => w[i] >= 0.5 ? "in" : w[i] > 0.15 ? "f1" : "", { me: cls }), h("div", { class: "gridkey", html: `<span><i style="background:var(--brass)"></i>shove at ${S} bb</span><span><i style="background:rgba(201,164,90,.35)"></i>sometimes</span>` }));
        ctx.finish({ log: { hand: CLASSES[cls].name, bb: S, chose: shove ? "shove" : "fold", right: mixed ? "either" : truth ? "shove" : "fold" }, grade: ok ? "ok" : "no", lines, extra, verdict: mixed ? "Either works." : null });
      };
      ctx.buttons([["Fold", () => answer(false), "f", "fold"], ["All in", () => answer(true), "a"]]);
    },
  });

  // ---- 12 Call the shove ----
  def({
    id: "callshove", act: 3, title: "Call the shove", skill: "Defend the big blind against a short-stack shove.",
    idea: `<p>The other side of the shove. You already have 1 bb in, so calling costs <span class="num">stack − 1</span> to win <span class="num">stack + 1</span>.</p>
      <p>You call tighter than they shove. They win the blinds every time you fold; you only win when your hand holds up. The price is often good, but your hand has to beat their <b>range</b>, not their worst hand.</p>`,
    run(ctx) {
      const S = chance(0.85) ? 3 + rnd(13) : pick([18, 20]);
      const near = nearThreshold("call", S);
      const cls = chance(0.65) && near.length ? pick(near) : PE.classOf(...freshDeck().slice(0, 2));
      const hand = shuffle(comboOf(cls)), f = freq("call", S, cls);
      const pw = nashW("push", S), eq = eqVsWeights(cls, pw), need = (S - 1) / (2 * S);
      ctx.stage.append(h("div", { class: "felt" },
        h("div", { class: "zone" }, h("div", { class: "cards" }, backEl({ deal: 0 }), backEl({ deal: 0.06 })), h("div", { class: "lbl", html: `Small blind · <b>all in for ${S} bb</b>` })),
        h("div", { class: "potline" }, h("div", { class: "deal", style: "--d:.3s" }, chipsEl(S, { denoms: [5, 1], label: S + " bb" })), h("div", {}, chipsEl(1, { label: "1" }))),
        h("div", { class: "zone" }, cardRow(hand, { deal: 0.1 }), h("div", { class: "lbl", html: `You · big blind` }))));
      ctx.prompt.innerHTML = `The small blind shoves <em>${S} bb</em>.`;
      const answer = call => {
        const mixed = f > 0.3 && f < 0.7, truth = f >= 0.5, ok = mixed || call === truth;
        const cw = nashW("call", S);
        const lines = [
          `Price: call <span class="m">${S - 1}</span> more to win <span class="m">${S + 1}</span>. You need <b>${P(need, 1)}</b>.`,
          `Their Nash shoving range at ${S} bb is ${P(weightsPct(pw))} of hands. <b>${CLASSES[cls].name}</b> has <b>${P(eq, 1)}</b> against it.`,
          `Nash ${truth ? "calls" : "folds"}${mixed ? " (mixed: either is fine)" : ""}. It calls with ${CLASSES[cls].name} ${thresholdText("call", cls)}.`,
        ];
        const extra = h("div", {}, meter([["You need", need, "var(--tx3)"], ["You have", eq, eq >= need ? "var(--ok)" : "var(--no)"]]),
          gridEl(i => cw[i] >= 0.5 ? "in" : cw[i] > 0.15 ? "f1" : "", { me: cls }), h("div", { class: "gridkey", html: `<span><i style="background:var(--brass)"></i>call a ${S} bb shove</span>` }));
        ctx.finish({ log: { hand: CLASSES[cls].name, bb: S, chose: call ? "call" : "fold", right: mixed ? "either" : truth ? "call" : "fold", eq: +eq.toFixed(3), need: +need.toFixed(3) }, grade: ok ? "ok" : "no", lines, extra, verdict: mixed ? "Either works." : null });
      };
      ctx.buttons([["Fold", () => answer(false), "f", "fold"], ["Call", () => answer(true), "c"]]);
    },
  });

  // ---- 13 Bubble maths (ICM) ----
  const PAY = [50, 30, 20];
  function icmTable(names, stacks, me) {
    const eq = PE.icm(stacks, PAY), tot = stacks.reduce((a, b) => a + b, 0);
    return h("table", { class: "icmt" }, h("tr", {}, h("th", {}, "Player"), h("th", {}, "Chips"), h("th", {}, "Chip %"), h("th", {}, "Prize %")),
      names.map((n, i) => h("tr", { class: i === me ? "me" : "" }, h("td", {}, n), h("td", {}, fmt(stacks[i])), h("td", {}, P(stacks[i] / tot, 1)), h("td", {}, P(eq[i] / 100, 1)))));
  }
  function randStacks(total) {
    for (;;) { const cuts = [0, ...[1, 2, 3].map(() => Math.random()).sort(), 1]; const s = cuts.slice(1).map((c, i) => Math.round((c - cuts[i]) * total / 100) * 100); if (Math.min(...s) >= 1200) { s[3] = total - s[0] - s[1] - s[2]; return s; } }
  }
  def({
    id: "icm", act: 3, title: "Bubble maths", skill: "Why the chips you lose are worth more than the ones you win.",
    idea: `<p>Tournament chips aren't money. <b>ICM</b> (the Independent Chip Model) works out each stack's chance of finishing in each place, which turns chips into a share of the prize pool.</p>
      <p>Chips you lose cost more than chips you win: doubling up doesn't double your prize, but busting takes it to zero. On the <b>bubble</b>, one place off the money, calling an all-in needs a much better hand than chip maths says.</p>
      <p>Here: 4 players left, 3 get paid: <span class="num">50% / 30% / 20%</span>.</p>`,
    run(ctx) {
      const names = ["You", "Seat 2", "Seat 3", "Seat 4"];
      if (chance(0.45)) { // estimate your share
        const st = randStacks(20000), eq = PE.icm(st, PAY), truth = eq[0] / 100;
        const val = h("div", { class: "val" }, "25", h("small", {}, "%"));
        const rng = h("input", { type: "range", min: 0, max: 60, value: 25 });
        const sync = () => { val.firstChild.textContent = rng.value; rng.style.setProperty("--p", (rng.value / 60 * 100) + "%"); }; rng.oninput = sync; sync();
        ctx.stage.append(h("div", { class: "felt" },
          h("div", { class: "potline" }, st.map((s, i) => h("div", {}, chipsEl(s, { denoms: [5000, 1000, 500, 100], label: (i ? names[i] : "<b>You</b>") + "<br>" + fmt(s) })))),
          h("div", { class: "zone" }, h("div", { class: "lbl" }, "prize pool: 50 / 30 / 20 · 4th gets nothing"))),
          h("div", { class: "slider" }, val, rng, h("div", { class: "ticks" }, h("span", {}, "0"), h("span", {}, "30"), h("span", {}, "60"))));
        ctx.prompt.innerHTML = `You have <em>${P(st[0] / 20000)}</em> of the chips. What share of the prize pool is that worth?`;
        ctx.buttons([["Lock in", () => {
          const g = +rng.value / 100, err = Math.abs(g - truth); rng.disabled = true;
          const lines = [`ICM says <b>${P(truth, 1)}</b> of the prize pool, for ${P(st[0] / 20000, 1)} of the chips. You said ${P(g)}.`,
            st[0] / 20000 > truth ? "Big stacks are worth <b>less</b> than their chips: you can only win first place once." : "Short stacks are worth <b>more</b> than their chips: everyone who survives the bubble gets paid, however small."];
          ctx.finish({ log: { guess: g, truth: +truth.toFixed(3) }, grade: err <= 0.04 ? "ok" : "no", lines, extra: icmTable(names, st, 0) });
        }, "enter"]]);
        return;
      }
      // bubble call: big stack shoves, you're in the big blind
      let st, Y, X, b = 400, rangeP, rw, cls, eq, chipNeed, need, fold$, win$, lose$;
      for (let t = 0; t < 200; t++) {
        st = randStacks(20000).sort((a, c) => c - a);
        X = st[0]; Y = st[1 + rnd(3)]; if (Y > 7000 || Y < 2000 || X <= Y) continue;
        const others = st.slice(1); others.splice(others.indexOf(Y), 1);
        st = [Y, X, ...others];
        rangeP = pick([0.3, 0.4, 0.5]); const set = topRange(rangeP); rw = Array.from({ length: N }, (_, i) => set.has(i) ? 1 : 0);
        fold$ = PE.icm([Y - b, X + b, ...others], PAY)[0]; win$ = PE.icm([2 * Y, X - Y, ...others], PAY)[0]; lose$ = 0;
        need = (fold$ - lose$) / (win$ - lose$); chipNeed = (Y - b) / (2 * Y);
        const pool = rangeOrder.slice(0, 120).filter(i => { const e = eqVsWeights(i, rw); return e > chipNeed - 0.05 && e < need + 0.08; });
        if (!pool.length) continue;
        cls = chance(0.8) ? pick(pool) : pick(rangeOrder.slice(0, 60)); eq = eqVsWeights(cls, rw);
        break;
      }
      const hand = shuffle(comboOf(cls));
      ctx.stage.append(h("div", { class: "felt" },
        h("div", { class: "zone" }, h("div", { class: "cards" }, backEl({ deal: 0 }), backEl({ deal: 0.06 })), h("div", { class: "lbl", html: `Chip leader · <b>${fmt(X)}</b> · shoves the top ${P(rangeP)} of hands` })),
        h("div", { class: "potline" }, h("div", { class: "deal", style: "--d:.3s" }, chipsEl(Y, { denoms: [5000, 1000, 500, 100], label: "covers you" })), h("div", {}, chipsEl(b, { denoms: [100], label: "your BB " + b }))),
        h("div", { class: "zone" }, cardRow(hand, { deal: 0.1 }), h("div", { class: "lbl", html: `You · <b>${fmt(Y)}</b> · big blind` }))));
      ctx.prompt.innerHTML = `On the bubble, the chip leader shoves. <em>Call or fold?</em><span class="sub">4 left, 3 paid. If you call and lose, you're out with nothing.</span>`;
      const answer = call => {
        const close = Math.abs(eq - need) < 0.015, truth = eq >= need, ok = close || call === truth;
        const dEV = (eq * win$ + (1 - eq) * lose$ - fold$);
        const lines = [
          `<b>${CLASSES[cls].name}</b> has <b>${P(eq, 1)}</b> against their range.`,
          `In chips, calling needs only <span class="m">${P(chipNeed, 1)}</span>, so it's a ${eq >= chipNeed ? "call" : "fold"} on chips alone.`,
          `But folding keeps <span class="m">${P(fold$ / 100, 1)}</span> of the prize pool, and busting on the bubble pays nothing. ICM raises the bar to <b>${P(need, 1)}</b>.`,
          close ? "Right on the line: either is fine." : `Calling ${dEV >= 0 ? "gains" : "costs"} about <span class="m">${Math.abs(dEV).toFixed(1)}%</span> of the prize pool each time.`,
        ];
        const extra = h("div", {}, meter([["Your equity", eq, eq >= need ? "var(--ok)" : "var(--no)"], ["Chips need", chipNeed, "var(--tx4)"], ["ICM needs", need, "var(--brass)"]]), icmTable(["You", "Chip leader", "Seat 3", "Seat 4"], st, 0));
        ctx.finish({ log: { hand: CLASSES[cls].name, eq: +eq.toFixed(3), need: +need.toFixed(3), chipNeed: +chipNeed.toFixed(3), chose: call ? "call" : "fold" }, grade: ok ? "ok" : "no", lines, extra, verdict: close ? "Either works." : null });
      };
      ctx.buttons([["Fold", () => answer(false), "f", "fold"], ["Call", () => answer(true), "c"]]);
    },
  });

  // =========================================================
  // THE TABLE: full hands against bots, with a coach at every decision
  // =========================================================
  const TBLX = window.TBL;
  const skillStats = () => (store.t = store.t || {});
  function skillHit(sk, v) { const t = skillStats(); const a = (t[sk] = t[sk] || []); a.push(v); if (a.length > 80) a.splice(0, a.length - 80); save(); }
  const skillRate = sk => { const a = (skillStats()[sk] || []).slice(-30); return a.length ? { n: a.length, r: a.reduce((x, y) => x + y, 0) / a.length } : null; };
  let G = null, GS = null; // game in memory, session stats
  const stableRot = c => (((c * 37) % 31) / 10 - 1.5).toFixed(2) + "deg";
  const BEST_WORD = { raise: "raise", "3-bet": "3-bet", "4-bet": "4-bet", call: "call", fold: "fold", check: "check", bet: "bet", allin: "go all in", either: "either is fine" };

  function leakRows(withLinks) {
    const rows = Object.entries(TBLX.SKILLS).map(([k, v]) => ({ k, v, s: skillRate(k) })).filter(x => x.s);
    rows.sort((a, b) => a.s.r - b.s.r);
    return rows.map(({ k, v, s }) => h("div", { class: "leak" + (s.r < 0.7 ? " weak" : s.r >= 0.85 && s.n >= 10 ? " strong" : "") },
      h("div", { class: "nm" }, v.name, h("small", {}, `${Math.round(s.r * s.n)}/${s.n} right first time`)),
      h("div", { class: "tr" }, h("i", { style: `width:${s.r * 100}%` })),
      withLinks && s.r < 0.85 ? h("button", { class: "lk", onclick: () => go(v.drill) }, "Drill it →") : h("span", { class: "lk m" }, P(s.r))));
  }

  function lobby() {
    current = { keys: {} }; document.title = "The table · Felt";
    app.innerHTML = "";
    const w = h("div", { class: "wrap" },
      h("div", { class: "bar" }, h("button", { class: "back", onclick: () => { location.hash = ""; }, "aria-label": "Back" }, "←"),
        h("div", { class: "ttl" }, h("small", {}, "Play"), "The table"), h("div", { class: "score" })));
    if (G && !G.over) w.append(h("button", { class: "next", onclick: () => playTable() },
      h("div", {}, h("div", { class: "k" }, "Your seat is still warm"), h("div", { class: "t" }, G.cash ? "Back to the cash game" : "Back to the tournament"), h("div", { class: "s" }, `Hand ${G.handNo} · ${fmt(G.players[0].stack)} chips`)), h("span", { class: "btn" }, "Sit")));
    const pickMode = mode => { G = TBLX.newGame(mode); GS = { right: 0, n: 0, hands: 0, skills: {} }; playTable(); };
    w.append(
      h("button", { class: "mode", onclick: () => pickMode("cash") },
        h("div", { class: "t" }, "Cash game"), h("div", { class: "s" }, "Blinds 1/2. Everyone sits with 100 big blinds. Chips are money, so a chip won is worth exactly a chip lost. Buy back in any time."),
        h("div", { class: "k" }, "Most of the skill here is after the flop")),
      h("button", { class: "mode", onclick: () => pickMode("tourney") },
        h("div", { class: "t" }, "Tournament"), h("div", { class: "s" }, "Six players, 1,500 chips each. Blinds go up every 6 hands, antes kick in, and when you're out you're out. Top two get paid (65/35)."),
        h("div", { class: "k" }, "Watch your stack in big blinds shrink")),
      h("section", { class: "act" }, h("h2", {}, h("i", {}, "WHO"), "You'll meet"),
        h("div", { class: "gloss" }, Object.entries(TBLX.STYLE_LINE).map(([k, v]) => h("p", {}, h("b", {}, k), " " + v)))),
      h("section", { class: "act" }, h("h2", {}, h("i", {}, "HOW"), "The coach"),
        h("div", { class: "gloss" }, h("p", {}, "Every decision you make gets checked against what that player actually holds this way, worked out from how they play."),
          h("p", {}, "Get it wrong and you get a ", h("b", {}, "hint"), " and a second go before the answer. Only your first try counts."))));
    const lr = leakRows(true);
    if (lr.length) w.append(h("section", { class: "act" }, h("h2", {}, h("i", {}, "YOU"), "Strong and weak"), h("p", { class: "lede" }, "Your last 30 decisions of each kind, weakest first."), ...lr));
    app.append(w); window.scrollTo(0, 0);
  }

  function playTable() {
    if (!G) return lobby();
    if (location.hash !== "#/play") history.replaceState(null, "", "#/play");
    document.title = (G.cash ? "Cash game" : "Tournament") + " · Felt";
    app.innerHTML = "";
    const score = h("div", { class: "score" }), info = h("div", { class: "tinfo" });
    const felt = h("div", { class: "felt oval tbl" }), heroZ = h("div", { class: "herozone" });
    const prompt = h("div", { class: "prompt sm" }), ctl = h("div", { class: "ctl tctl" }), coachBox = h("div"), endBox = h("div");
    const w = h("div", { class: "wrap" },
      h("div", { class: "bar" }, h("button", { class: "back", onclick: () => { token++; lobby(); history.replaceState(null, "", "#/lobby"); }, "aria-label": "Back" }, "←"),
        h("div", { class: "ttl" }, h("small", {}, "The table"), G.cash ? "Cash game" : "Tournament"), score),
      info, felt, heroZ, prompt, ctl, coachBox, endBox);
    app.append(w);
    let H = null, say = {}, token = 0, seen = new Set();
    current = { keys: {} };
    const updScore = () => { score.innerHTML = `<b>${GS.right}</b>/${GS.n} · hand <b>${G.handNo}</b>`; };

    function render() {
      updScore();
      const bl = H.bl, me = G.players[0];
      info.innerHTML = G.cash ? `Blinds <b>1/2</b> · you're <b class="${me.stack + 0 - G.buyins * TBLX.CASH_BUYIN >= 0 ? "up" : "dn"}">${(me.stack - G.buyins * TBLX.CASH_BUYIN) >= 0 ? "+" : "−"}${fmt(Math.abs(me.stack - G.buyins * TBLX.CASH_BUYIN) / 2)} bb</b>${G.buyins > 1 ? ` · ${G.buyins} buy-ins` : ""}`
        : `Level <b>${bl.level}</b> · ${fmt(bl.sb)}/${fmt(bl.bb)}${bl.ante ? ` · ante ${fmt(bl.ante)}` : ""} · <b>${TBLX.liveSeats(G).length}</b> left · up in ${bl.handsLeft} hand${bl.handsLeft === 1 ? "" : "s"}`;
      felt.innerHTML = "";
      SEAT_XY.forEach((xy, s) => {
        const p = G.players[s], hs = H.seats[s];
        if (!hs) { felt.append(h("div", { class: "seat empty", style: `left:${xy[0]}%;top:${xy[1]}%` }, h("div", { class: "plate" }, h("div", { class: "p" }, p.stack > 0 ? p.name : "—"), h("div", { class: "q" }, p.stack > 0 ? "sitting out" : G.places[s] ? `out · ${ordinal(G.places[s])}` : "empty")))); return; }
        const showFace = H.over && H.result.shown.includes(s) || (s === 0);
        const cards = hs.folded ? [] : s === 0 ? [] : showFace ? hs.cards.map(c => { const e = cardEl(c, { sm: true }); e.style.setProperty("--rot", stableRot(c)); return e; }) : [backEl(), backEl()];
        const won = H.over && H.result.wins[s];
        const el = h("div", { class: "seat" + (s === H.toAct && !H.over ? " turn" : "") + (hs.folded ? " out" : "") + (won ? " win" : "") + (s === 0 ? " hero" : ""), style: `left:${xy[0]}%;top:${xy[1]}%` },
          say[s] ? h("div", { class: "say" + (say[s].k ? " " + say[s].k : "") }, say[s].t) : null,
          s === 0 ? null : h("div", { class: "mini" }, cards),
          h("div", { class: "plate" }, h("div", { class: "p" }, s === 0 ? "You" : p.name, h("span", { class: "pos" }, hs.pos)), h("div", { class: "q" }, fmt(hs.stack)), s ? h("div", { class: "tg" }, p.style.tag) : null));
        felt.append(el);
        if (hs.bet > 0) { const b = toward(xy, 0.4); felt.append(h("div", { class: "blind", style: `left:${b[0]}%;top:${b[1]}%` }, chipsEl(hs.bet, { denoms: G.cash ? [100, 25, 5, 1] : [500, 100, 25, 5], label: fmt(hs.bet) }))); }
      });
      const bxy = toward(SEAT_XY[G.btn], 0.25);
      felt.append(h("div", { class: "dbtn", style: `left:${bxy[0] + 7}%;top:${bxy[1]}%` }, "D"));
      const pot = H.over ? 0 : TBLX.potTotal(H);
      const board = h("div", { class: "cards bd" }, H.board.map((c, k) => { const e = cardEl(c, { deal: seen.has(c) ? null : 0.05 * k }); e.style.setProperty("--rot", stableRot(c)); seen.add(c); return e; }));
      felt.append(h("div", { class: "tmid" }, pot ? h("div", { class: "potl" }, "Pot ", h("b", {}, fmt(TBLX.potTotal(H)))) : h("div", { class: "potl" }, " "), board));
      // hero
      const hs = H.seats[0];
      heroZ.innerHTML = "";
      if (hs) {
        const cs = h("div", { class: "cards" }, hs.cards.map((c, k) => { const e = cardEl(c, { deal: seen.has(c) ? null : 0.1 + k * 0.08, cls: hs.folded ? "muck" : "" }); e.style.setProperty("--rot", stableRot(c)); seen.add(c); return e; }));
        const made = H.board.length && !hs.folded ? TBLX.tier(hs.cards, H.board).desc : PE.CLASSES[TBLX.clsOf(hs.cards[0], hs.cards[1])].name;
        heroZ.append(cs, h("div", { class: "lbl", html: `<b>${hs.pos}</b> · ${fmt(hs.stack)} <span>(${(hs.stack / H.bl.bb).toFixed(hs.stack / H.bl.bb < 10 ? 1 : 0)} bb)</span> · ${made}` }));
      }
    }
    const ordinal = n => n + (n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th");
    function sayFor(rec) {
      const amt = fmt(rec.to);
      if (rec.type === "fold") return { t: "Fold", k: "f" };
      if (rec.type === "check") return { t: "Check" };
      if (rec.type === "call") return { t: rec.allin ? "Call · all in" : "Call " + fmt(rec.amount) };
      if (rec.allin) return { t: "All in " + amt, k: "r" };
      if (rec.street > 0 && rec.toCall === 0 && !H.actions.some(a => a !== rec && a.street === rec.street && a.type === "raise")) return { t: "Bet " + amt, k: "r" };
      const n = H.actions.filter(a => a.street === rec.street && a.type === "raise").length;
      return { t: rec.street === 0 && n >= 2 ? `${n + 1}-bet to ${amt}` : "Raise to " + amt, k: "r" };
    }
    function doAct(a) {
      const st = H.street, rec = TBLX.act(H, a);
      if (rec && rec.seat != null) say[rec.seat] = sayFor(rec);
      if (H.street !== st && !H.over) say = {};
    }
    const pause = ms => { const t = token; return new Promise(r => setTimeout(() => r(t === token), ms)); };
    async function step() {
      while (H && !H.over && H.toAct !== 0) {
        const heroIn = H.seats[0] && !H.seats[0].folded;
        const st = H.street;
        if (!(await pause(heroIn ? 650 : 260))) return;
        doAct(TBLX.botAction(H)); render();
        if (H.street !== st && !H.over && !(await pause(heroIn ? 350 : 120))) return;
      }
      if (H.over) return handOver();
      heroTurn();
    }
    function heroTurn() {
      render();
      const L = TBLX.legal(H), bb = H.bl.bb, me = H.seats[0];
      const A = TBLX.coach(H); let tries = 0, guess = false, firstId = null, t0 = Date.now();
      const old = coachBox.querySelector(".fb.coach");
      if (old && !old.classList.contains("old")) { old.classList.add("old"); const v = old.querySelector(".v"); v.prepend(h("span", { class: "lastk" }, "Last decision · ")); v.onclick = () => old.classList.toggle("open"); }
      prompt.innerHTML = `Your move.<span class="sub">${L.toCall ? `${fmt(L.toCall)} to call · ` : ""}pot ${fmt(L.pot)}${L.toCall && (H.street > 0 || H.curBet > bb) ? ` · you need ${P(L.toCall / (L.pot + L.toCall))} to call` : ""}</span>`;
      const opts = [];
      if (L.toCall > 0) opts.push(["Fold", { type: "fold" }, "f", "fold"]);
      opts.push(L.toCall ? [L.toCall >= me.stack ? `Call all in ${fmt(L.toCall)}` : `Call ${fmt(L.toCall)}`, { type: "call" }, "c", "mid"] : ["Check", { type: "check" }, "c", "mid"]);
      if (L.canRaise) {
        const raises = H.actions.filter(a => a.street === H.street && a.type === "raise").length, sizes = [];
        if (H.street === 0) {
          if (raises === 0) { const S = me.stack / bb; sizes.push(L.toCall === 0 ? 3 * bb + H.curBet - bb : (me.pos === "SB" ? 3 : S < 30 ? 2.2 : 2.5) * bb); }
          else sizes.push(H.curBet * (raises === 1 ? 3 : 2.3));
        } else if (L.toCall === 0) for (const f of [0.33, 0.66, 1]) sizes.push(Math.max(bb, Math.round(L.pot * f)));
        else sizes.push(H.curBet * 3);
        const seen2 = new Set(); let k = 1;
        for (const to0 of sizes) {
          const n = TBLX.normalize(H, { type: "raise", to: to0 }); if (n.type !== "raise" || n.to >= L.maxTo || seen2.has(n.to)) continue; seen2.add(n.to);
          const word = H.street === 0 ? (raises === 0 ? "Raise to" : raises === 1 ? "3-bet to" : "4-bet to") : L.toCall === 0 ? "Bet" : "Raise to";
          const extra = H.street > 0 && L.toCall === 0 ? ` <small>${Math.round((n.to - me.bet) / L.pot * 100)}% pot</small>` : H.street === 0 ? ` <small>${+(n.to / bb).toFixed(1)} bb</small>` : "";
          opts.push([`${word} ${fmt(n.to)}${extra}`, n, String(k++), ""]);
        }
        opts.push([`All in ${fmt(L.maxTo)}`, { type: "allin" }, "a", "allin"]);
      }
      ctl.innerHTML = ""; ctl.classList.remove("hide"); current.keys = {};
      const gz = guessToggle(v => { guess = v; });
      prompt.append(gz.el);
      const choose = a => {
        const g = TBLX.grade(H, A, a);
        const id = logDecision(A, a, g, tries, guess, Date.now() - t0);
        if (tries === 0) { firstId = id; COACH.tally("skill:" + A.skill, g !== "no"); }
        gz.reset(); t0 = Date.now();
        if (tries === 0 && g === "no") {
          tries = 1; skillHit(A.skill, 0); GS.n++; (GS.skills[A.skill] = GS.skills[A.skill] || [0, 0])[1]++; updScore();
          coachBox.querySelectorAll(".fb.old").forEach(x => x.remove());
          coachBox.append(h("div", { class: "fb mid hint" }, h("div", { class: "v" }, "Hold on."), h("p", { class: "ln", html: A.hint }), h("p", { class: "ln k", html: "Have another go. Your first answer is already counted." })));
          setTimeout(() => coachBox.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
          return;
        }
        if (tries === 0) { const v = g === "no" ? 0 : 1; skillHit(A.skill, v); GS.n++; GS.right += v; const sk = (GS.skills[A.skill] = GS.skills[A.skill] || [0, 0]); sk[0] += v; sk[1]++; }
        showVerdict(A, g, tries);
        const fbv = coachBox.querySelector(".fb.coach");
        if (fbv) fbv.append(flagCtl(firstId, `Hand ${G.handNo} · ${G.cash ? "cash" : "tournament"} · ${me.pos} · ${cardsTxt(me.cards)}${H.board.length ? " · board " + cardsTxt(H.board) : " · preflop"}`));
        ctl.innerHTML = ""; prompt.innerHTML = ""; current.keys = {};
        doAct(a); render(); step();
      };
      for (const [label, a, key, cls] of opts) {
        const b = h("button", { class: "btn" + (cls ? " " + cls : ""), html: label + (key ? `<kbd>${key.toUpperCase()}</kbd>` : "") });
        b.onclick = () => choose(a); ctl.append(b);
        if (key) current.keys[key] = () => choose(a);
      }
      if (L.toCall === 0) current.keys.k = () => choose({ type: "check" });
      current.keys.g = gz.toggle;
    }
    // Everything the coach needs to review this decision later, captured before the action is applied.
    function logDecision(A, a, g, tries, guess, ms) {
      const L = TBLX.legal(H), bb = H.bl.bb, me = H.seats[0], n = TBLX.normalize(H, a);
      const others = H.order.filter(s => s !== 0 && !H.seats[s].folded).map(s => H.seats[s].stack + H.seats[s].bet);
      const eff = Math.min(me.stack + me.bet, Math.max(0, ...others));
      const tr = H.board.length ? TBLX.tier(me.cards, H.board) : null;
      const vp = A.villain != null ? G.players[A.villain] : null, r3 = x => (x == null ? null : +(+x).toFixed(3));
      return COACH.rec("decision", {
        hand: H.key, game: G.key, mode: G.cash ? "cash" : "tourney", handNo: G.handNo, try: tries + 1,
        street: ["preflop", "flop", "turn", "river"][H.street], spot: A.spot, skill: A.skill, pos: me.pos,
        cards: cardsTxt(me.cards), cls: PE.CLASSES[TBLX.clsOf(me.cards[0], me.cards[1])].name, board: cardsTxt(H.board),
        made: tr ? tr.desc : null, draw: tr ? tr.draw : 0, bb, pot: L.pot, toCall: L.toCall,
        effBB: +(eff / bb).toFixed(1), spr: L.pot ? +(eff / L.pot).toFixed(2) : null,
        villain: vp ? { seat: A.villain, name: vp.name, style: vp.style.tag, rangePct: r3(A.rangePct) } : null,
        did: n.type + (n.to ? " " + n.to : ""), kind: TBLX.kindOf(H, a), best: A.best, accept: A.accept, grade: g,
        eq: r3(A.eq), need: r3(A.need), guess, ms, why: (A.lines || []).map(COACH.plain), hint: tries ? COACH.plain(A.hint) : undefined,
      });
    }
    function logHand() {
      const bb = H.bl.bb, mode = G.cash ? "cash" : "tourney";
      COACH.rec("hand", {
        mode, game: G.key, no: G.handNo, blinds: { sb: H.bl.sb, bb, ante: H.bl.ante || 0, level: H.bl.level || null }, btn: G.btn,
        seats: H.order.map(s => ({ seat: s, pos: H.seats[s].pos, who: s ? G.players[s].name : "You", style: s ? G.players[s].style.tag : null, stack: H.startStacks[s], cards: cardsTxt(H.seats[s].cards) })),
        actions: H.actions.map(x => ({ seat: x.seat, street: x.street, type: x.type, to: x.to, amount: x.amount, allin: x.allin || undefined })),
        board: cardsTxt(H.board), shown: H.result.shown, wins: H.result.wins, ranOut: !!H.ranOut,
        net: H.seats[0] ? +((G.players[0].stack - H.startStacks[0]) / bb).toFixed(2) : null, place: G.places[0] || null,
      }, H.key);
      if (H.seats[0]) COACH.tally("hand:" + mode, 1);
    }
    function rangeBlock(A) {
      if (!A.range || A.spot === "open" || A.spot === "shove" || A.spot === "option") return null;
      const vn = G.players[A.villain].name;
      const g = gridEl(i => (A.range[i] > 0.001 ? "rg" : ""), { me: TBLX.clsOf(H.seats[0].cards[0], H.seats[0].cards[1]) });
      g.querySelectorAll(".c.rg").forEach(c => c.style.setProperty("--a", 0.45 + 0.55 * A.range[+c.dataset.i].toFixed(2)));
      return h("details", { class: "rng" }, h("summary", {}, `What ${vn} can have here · ${P(A.rangePct)} of hands`), g,
        h("div", { class: "gridkey" }, h("span", {}, h("i", { style: "background:var(--brass)" }), "in their range (paler = only some suits)"), h("span", {}, h("i", { style: "outline:2px solid var(--tx)" }), "your hand")));
    }
    function showVerdict(A, g, tries) {
      coachBox.innerHTML = "";
      const right = g !== "no", word = BEST_WORD[A.best] || A.best;
      const v = tries ? (right ? "Better." : "Still not it.") : g === "ok" ? "Right." : "Fine.";
      const cls = right ? (g === "ok" && !tries ? "ok" : "mid") : "no";
      const fb = h("div", { class: "fb " + cls + " coach" }, h("div", { class: "v" }, v, h("span", { class: "best" }, A.best === "either" ? "Either is fine here" : "Best: " + word)));
      const body = h("div", {}, A.lines.map(l => h("p", { class: "ln", html: l })), rangeBlock(A));
      if (!tries && g === "ok") { const d = h("details", { class: "why" }, h("summary", {}, "Why"), body); fb.append(d); }
      else fb.append(body);
      if (g === "mid" && !tries) fb.append(h("p", { class: "ln k", html: `Not wrong, but <b>${word}</b> is better here.` }));
      coachBox.append(fb);
    }
    function handOver() {
      render(); prompt.innerHTML = ""; ctl.innerHTML = "";
      GS.hands++; logHand();
      const r = H.result, lines = [];
      const winners = Object.keys(r.wins).map(Number);
      for (const s of winners) {
        const who = s === 0 ? "You win" : G.players[s].name + " wins";
        lines.push(r.shown.length ? `<b>${who} ${fmt(r.wins[s])}</b> with ${PE.describe(r.scores[s]).replace(/^./, m => m.toLowerCase())}.` : `<b>${who} ${fmt(r.wins[s])}</b>. Everyone else folded.`);
      }
      if (r.shown.length) for (const s of r.shown) if (!winners.includes(s)) lines.push(`${s === 0 ? "You" : G.players[s].name} showed ${cardsTxt(H.seats[s].cards)}: ${PE.describe(r.scores[s]).replace(/^./, m => m.toLowerCase())}.`);
      if (H.ranOut) lines.push("All in, so the rest of the board was dealt out.");
      if (r.shown.length > 1) lines.push(`<span class="k2">At showdown, the last player to bet or raise shows first. If nobody bet on the river, the first player left of the button shows first.</span>`);
      const fb = h("div", { class: "fb end" }, h("div", { class: "v" }, winners.includes(0) ? "Your pot." : "Hand over."), lines.map(l => h("p", { class: "ln", html: l })));
      const nb = h("button", { class: "btn" }, G.over ? "See how you did" : "Next hand", h("kbd", {}, "↵"));
      const next = () => (G.over ? gameOver() : deal());
      if (H.seats[0]) fb.append(flagCtl(H.key, `Hand ${G.handNo} · ${G.cash ? "cash" : "tournament"} · ${cardsTxt(H.seats[0].cards)} · the whole hand`));
      nb.onclick = next; fb.append(h("div", { class: "go" }, nb));
      endBox.innerHTML = ""; endBox.append(fb);
      current.keys = { enter: next, " ": next };
      setTimeout(() => fb.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
    }
    function gameOver() {
      token++; coachBox.innerHTML = ""; endBox.innerHTML = ""; felt.innerHTML = ""; heroZ.innerHTML = ""; info.innerHTML = "";
      const place = G.places[0] || 1, paid = place <= TBLX.PAYOUT.length;
      if (!G.logged) { G.logged = true; COACH.rec("game", { mode: "tourney", game: G.key, place, hands: G.handNo, right: GS.right, n: GS.n }); }
      const fb = h("div", { class: "fb " + (paid ? "ok" : "no") }, h("div", { class: "v" }, `You finished ${ordinal(place)} of 6.`),
        h("p", { class: "ln", html: paid ? `In the money: <b>${TBLX.PAYOUT[place - 1]}%</b> of the prize pool.` : place === 3 ? "Out on the <b>bubble</b>, one place from the money. That's the spot where survival is worth the most." : "Out before the money." }),
        h("p", { class: "ln", html: `${G.handNo} hands · your decisions: <b>${GS.right}/${GS.n}</b> right first time.` }),
        ...leakRows(false));
      const again = h("button", { class: "btn" }, "New tournament");
      again.onclick = () => { G = TBLX.newGame("tourney"); GS = { right: 0, n: 0, hands: 0, skills: {} }; playTable(); };
      const lob = h("button", { class: "btn ghost" }, "Lobby"); lob.onclick = () => { G = null; lobby(); history.replaceState(null, "", "#/lobby"); };
      fb.append(h("div", { class: "go" }, lob, again));
      endBox.append(fb); current.keys = { enter: () => again.click() };
    }
    function deal() {
      token++; coachBox.innerHTML = ""; endBox.innerHTML = ""; say = {}; seen = new Set();
      if (G.cash && G.players[0].stack === 0) {
        felt.innerHTML = ""; heroZ.innerHTML = "";
        const fb = h("div", { class: "fb no" }, h("div", { class: "v" }, "Out of chips."), h("p", { class: "ln", html: `In a cash game you can buy back in. That's another ${TBLX.CASH_BUYIN} (100 bb). Bankroll tip: keep at least 20 buy-ins for the stakes you play.` }));
        const b = h("button", { class: "btn" }, "Buy back in"); b.onclick = () => { G.players[0].stack = TBLX.CASH_BUYIN; G.buyins++; deal(); };
        fb.append(h("div", { class: "go" }, b)); endBox.append(fb); current.keys = { enter: () => b.click() }; return;
      }
      H = TBLX.newHand(G);
      if (!H) return gameOver();
      if (!G.key) G.key = COACH.newId();
      H.key = COACH.newId();
      render(); step();
    }
    deal();
    window.scrollTo(0, 0);
  }

  // =========================================================
  // COACH: sure/guessing, flags, This week, sync (data layer in coach.js)
  // =========================================================
  const FLAG_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4h11l-1.5 4L16 12H5"/></svg>';
  function guessToggle(onChange) {
    let on = false;
    const b = h("button", { class: "guess", type: "button", "aria-pressed": "false" }, h("i"), "I'm guessing", h("kbd", {}, "G"));
    const set = v => { on = v; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); onChange(on); };
    b.onclick = () => set(!on);
    return { el: h("div", { class: "guessrow" }, h("span", {}, "Not sure? Tap this first"), b), toggle: () => set(!on), reset: () => set(false) };
  }
  function flagCtl(ref, label) {
    const box = h("div", { class: "flagbox" });
    const draw = () => {
      box.innerHTML = "";
      const f = COACH.flags()[ref];
      box.classList.toggle("on", !!f);
      if (!f) {
        const b = h("button", { class: "flagb", type: "button" }, h("span", { class: "fi", html: FLAG_SVG }), "Flag for coach");
        b.onclick = () => { COACH.flag(ref, label); draw(); };
        return box.append(b);
      }
      const ta = h("textarea", { rows: "3", placeholder: "What's confusing you? (optional)", "aria-label": "Note for your coach" });
      ta.value = f.note || "";
      const saved = h("span", { class: "saved" }, f.note ? "Saved" : "");
      ta.oninput = () => { saved.textContent = ""; };
      const sv = h("button", { class: "btn ghost", type: "button" }, "Save note");
      sv.onclick = () => { COACH.note(ref, ta.value.trim()); saved.textContent = "Saved"; };
      const un = h("button", { class: "unflag", type: "button" }, "Unflag");
      un.onclick = () => { COACH.unflag(ref); draw(); };
      box.append(h("div", { class: "fh" }, h("span", { class: "fi", html: FLAG_SVG }), h("span", {}, "Flagged for your coach"), un), ta, h("div", { class: "fr" }, saved, sv));
    };
    draw();
    return box;
  }
  const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago"; };
  function syncPill() {
    const st = COACH.status();
    const txt = !st.connected ? "Coach sync · set up" : st.err ? "Sync problem · tap to see" : st.busy ? "Syncing…" :
      (st.last ? "Synced " + ago(st.last) : "Not synced yet") + (st.waiting ? ` · ${st.waiting} waiting` : "");
    return h("button", { class: "syncpill" + (!st.connected ? " off" : st.err ? " err" : ""), type: "button", onclick: () => { location.hash = "#/sync"; } }, h("i"), txt);
  }
  function planCard() {
    const p = COACH.plan();
    if (!p || !p.title) return null;
    const t = h("div", { class: "t" }), s = h("p", { class: "s" });
    t.textContent = p.title; s.textContent = p.why || "";
    const sec = h("section", { class: "plan" }, h("div", { class: "k" }, "This week · from your coach" + (p.week ? " · " + p.week : "")), t, s);
    for (const task of p.tasks || []) {
      let txt, frac, done;
      if (task.kind === "drill" && task.goal === "solid") {
        const last = stat(task.key).hist.slice(-WINDOW), r = last.filter(Boolean).length;
        done = solidOf(task.key); txt = done ? "Solid ✓" : last.length ? `${r} of last ${last.length} right` : "not started"; frac = done ? 1 : Math.min(1, r / SOLID);
      } else {
        const pr = COACH.progress(task, p.since), n = task.n || 1;
        done = pr.n >= n; frac = Math.min(1, pr.n / n);
        txt = `${Math.min(pr.n, n)} / ${n}` + (task.kind !== "hands" && pr.n ? ` · ${pr.right} right` : "");
      }
      const name = h("span"); name.textContent = task.text || "";
      const row = h("button", { class: "task" + (done ? " done" : ""), type: "button" },
        h("div", { class: "tl" }, name, h("span", { class: "m" }, txt)), h("div", { class: "trk" }, h("i", { style: `width:${Math.round(frac * 100)}%` })));
      row.onclick = () => { location.hash = task.kind === "drill" && DRILLS.some(d => d.id === task.key) ? "#/" + task.key : "#/lobby"; };
      sec.append(row);
    }
    if (p.next) { const nx = h("p", { class: "nx" }); nx.textContent = p.next; sec.append(nx); }
    return sec;
  }
  function flagsRow() {
    const fl = COACH.flags(), rp = COACH.replies(), refs = Object.keys(fl);
    const nrep = refs.filter(r => rp[r]).length;
    if (!refs.length) return null;
    return h("button", { class: "next flagsrow", type: "button", onclick: () => { location.hash = "#/flags"; } },
      h("div", {}, h("div", { class: "k" }, "Your flags"), h("div", { class: "t" }, nrep ? `${nrep} repl${nrep === 1 ? "y" : "ies"} from your coach` : `${refs.length} flagged`),
        h("div", { class: "s" }, nrep ? "On hands you flagged" : "Waiting for your next coaching session")),
      h("span", { class: "arrow" }, "→"));
  }
  COACH.onChange(() => {
    if (location.hash && location.hash !== "#/") { if (location.hash === "#/sync") syncPage(true); return; }
    const w = app.querySelector(".wrap"); if (!w) return;
    const pill = w.querySelector(".syncpill"); if (pill) pill.replaceWith(syncPill());
    const old = w.querySelector(".plan"), pc = planCard(), tcard = w.querySelector(".next.table");
    if (old) old.remove(); if (pc && tcard) tcard.before(pc);
    const of = w.querySelector(".flagsrow"), fr = flagsRow();
    if (of) of.remove(); if (fr && tcard) tcard.before(fr);
  });
  const pageBar = (small, title) => h("div", { class: "bar" }, h("button", { class: "back", onclick: () => { location.hash = ""; }, "aria-label": "Back" }, "←"),
    h("div", { class: "ttl" }, h("small", {}, small), title), h("div", { class: "score" }));
  function syncPage(keepInput) {
    const prev = keepInput && app.querySelector("#synckey") ? app.querySelector("#synckey").value : "";
    current = null; document.title = "Coach sync · Felt"; app.innerHTML = "";
    const st = COACH.status();
    const w = h("div", { class: "wrap page" }, pageBar("Settings", "Coach sync"),
      h("p", { class: "lede" }, "Every hand, decision and drill answer goes to your private felt-data store on GitHub. Your coach reads it on your Mac, then sends back a plan and replies to your flags. No signal? It all waits on your phone and goes up later."));
    if (st.connected) {
      const msg = h("p", { class: "ln" + (st.err ? " bad" : "") }); msg.textContent = st.err || (st.last ? "Last synced " + ago(st.last) + "." : "Not synced yet.");
      const now = h("button", { class: "btn", type: "button" }, st.busy ? "Syncing…" : "Sync now");
      now.onclick = async () => { now.textContent = "Syncing…"; await COACH.syncNow(); syncPage(); };
      const off = h("button", { class: "btn ghost", type: "button" }, "Disconnect");
      off.onclick = () => { if (confirm("Disconnect this phone? Anything not uploaded stays on the phone.")) { COACH.disconnect(); syncPage(); } };
      w.append(h("section", { class: "card2" }, h("div", { class: "k" }, "Connected · " + COACH.REPO + " (private)"), msg,
        h("p", { class: "ln" }, `${st.waiting} record${st.waiting === 1 ? "" : "s"} waiting to upload.`), h("div", { class: "go" }, off, now)));
    } else {
      const inp = h("input", { id: "synckey", type: "password", autocomplete: "off", autocapitalize: "off", spellcheck: "false", placeholder: "github_pat_…" });
      inp.value = prev;
      const err = h("p", { class: "ln bad" });
      const go = h("button", { class: "btn", type: "button" }, "Connect");
      go.onclick = async () => { go.textContent = "Checking…"; go.disabled = true; const e = await COACH.connect(inp.value); if (e) { err.textContent = e; go.textContent = "Connect"; go.disabled = false; } else syncPage(); };
      w.append(h("section", { class: "card2" }, h("div", { class: "k" }, "One-time setup · about 3 minutes"),
        h("ol", { class: "steps" },
          h("li", { html: `On GitHub, open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">new fine-grained token</a>.` }),
          h("li", { html: `Name it <b>Felt</b>. Expiration: <b>1 year</b>.` }),
          h("li", { html: `Repository access: <b>Only select repositories</b> → <b>felt-data</b>.` }),
          h("li", { html: `Permissions → Repository → <b>Contents: Read and write</b>. Nothing else.` }),
          h("li", { html: `Generate it, copy it, paste it here. Don't send it to anyone, including Claude.` })),
        h("label", { for: "synckey", class: "lbl" }, "Your key"), inp, err, h("div", { class: "go" }, go)));
    }
    w.append(h("section", { class: "card2 quiet" }, h("div", { class: "k" }, "What gets sent"),
      h("p", { class: "ln" }, "Each table hand in full (everyone's cards, every bet, the result). Each decision: the spot, what you did, what the coach wanted, the numbers, sure or guessing, and how long you took. Each drill answer. Your flags and notes. Nothing else from your phone.")));
    app.append(w); window.scrollTo(0, 0);
  }
  function flagsPage() {
    current = null; document.title = "Your flags · Felt"; app.innerHTML = "";
    const fl = COACH.flags(), rp = COACH.replies();
    const w = h("div", { class: "wrap page" }, pageBar("Coach", "Your flags"));
    const refs = Object.keys(fl).sort((a, b) => fl[b].t - fl[a].t);
    if (!refs.length) w.append(h("p", { class: "lede" }, "Nothing flagged yet. Tap “Flag for coach” under any verdict and it shows up here and in your next coaching session."));
    for (const ref of refs) {
      const f = fl[ref], r = rp[ref];
      const lab = h("div", { class: "k" }); lab.textContent = f.label || ref;
      const sec = h("section", { class: "card2" + (r ? " replied" : "") }, lab);
      if (f.note) { const n = h("p", { class: "you" }); n.textContent = "You: “" + f.note + "”"; sec.append(n); }
      if (r) {
        sec.append(h("div", { class: "who" }, "Coach"));
        String(r.text || "").split(/\n\s*\n/).forEach(par => { const p = h("p", { class: "ln" }); p.textContent = par.trim(); sec.append(p); });
      } else sec.append(h("p", { class: "ln dim" }, "Waiting for your next coaching session."));
      const un = h("button", { class: "unflag", type: "button" }, r ? "Done, remove" : "Unflag");
      un.onclick = () => { COACH.unflag(ref); flagsPage(); };
      sec.append(h("div", { class: "fr" }, un));
      w.append(sec);
    }
    app.append(w); window.scrollTo(0, 0);
  }

  // =========================================================
  // SHELL
  // =========================================================
  const ACTS = {
    1: ["I", "The game", "Rules you need cold before strategy can stick."],
    2: ["II", "Cash games", "The blinds stay put, so the same spots keep coming back. The fundamentals live here."],
    3: ["III", "Tournaments", "Blinds rise, stacks shrink, and survival has a price."],
  };
  const app = document.getElementById("app");
  let current = null;
  const nextDrill = () => DRILLS.find(d => !solidOf(d.id)) || DRILLS[DRILLS.length - 1];

  function pips(id) {
    const last = stat(id).hist.slice(-WINDOW);
    const el = h("div", { class: "pips" });
    for (let k = 0; k < WINDOW; k++) el.append(h("b", { class: k < last.length ? (last[k] ? "y" : "x") : "" }));
    return el;
  }
  function mstate(id) {
    const s = stat(id), last = s.hist.slice(-WINDOW), right = last.filter(Boolean).length;
    if (!s.n) return h("div", { class: "mstate" }, "new");
    if (solidOf(id)) return h("div", { class: "mstate solid" }, "solid");
    return h("div", { class: "mstate" }, `${right}/${last.length}`);
  }

  function home() {
    current = null; document.title = "Felt";
    app.innerHTML = "";
    const nx = nextDrill(), idx = DRILLS.indexOf(nx) + 1, ns = stat(nx.id);
    const w = h("div", { class: "wrap" },
      h("header", { class: "mast" }, h("h1", { html: "Felt<span>.</span>" }), h("div", { class: "sub", html: "poker, learned<br>at the table" })),
      h("button", { class: "next", onclick: () => go(nx.id) },
        h("div", {}, h("div", { class: "k" }, ns.n ? "Pick up where you left off" : "Start here"), h("div", { class: "t" }, `${String(idx).padStart(2, "0")} · ${nx.title}`), h("div", { class: "s" }, nx.skill)),
        h("span", { class: "btn" }, "Deal")));
    const lr = leakRows(true);
    w.insertBefore(h("button", { class: "next table", onclick: () => { location.hash = "#/lobby"; } },
      h("div", {}, h("div", { class: "k" }, G && !G.over ? "Your seat is still warm" : "Play"), h("div", { class: "t" }, "The table"), h("div", { class: "s" }, "Real hands, cash game or tournament, against five players. A coach checks every decision.")),
      h("span", { class: "btn" }, "Sit")), w.querySelector(".next"));
    w.querySelector(".next:not(.table) .k").textContent = ns.n ? "Practice reps · pick up where you left off" : "Practice reps · start here";
    w.querySelector(".mast").after(syncPill());
    const tcard = w.querySelector(".next.table"), pc = planCard(), fr = flagsRow();
    if (pc) tcard.before(pc);
    if (fr) tcard.before(fr);
    if (lr.length) w.append(h("section", { class: "act" }, h("h2", {}, h("i", {}, "YOU"), "Strong and weak"), h("p", { class: "lede" }, "From your decisions at the table, weakest first."), ...lr));
    for (const a of [1, 2, 3]) {
      const [num, name, lede] = ACTS[a];
      const sec = h("section", { class: "act" }, h("h2", {}, h("i", {}, "ACT " + num), name), h("p", { class: "lede" }, lede));
      DRILLS.forEach((d, k) => {
        if (d.act !== a) return;
        sec.append(h("button", { class: "row" + (d === nx ? " is-next" : ""), onclick: () => go(d.id) },
          h("span", { class: "n" }, String(k + 1).padStart(2, "0")),
          h("div", {}, h("div", { class: "t" }, d.title), h("div", { class: "s" }, d.skill)),
          h("div", {}, pips(d.id), mstate(d.id))));
      });
      w.append(sec);
    }
    const solid = DRILLS.filter(d => solidOf(d.id)).length;
    w.append(h("footer", { class: "foot" }, h("span", {}, `${solid} of ${DRILLS.length} solid · solid = 18 of your last 20 right`),
      h("button", { onclick: () => { if (confirm("Wipe all progress?")) { store = { d: {} }; save(); home(); } } }, "Reset")));
    app.append(w);
    window.scrollTo(0, 0);
  }

  function go(id) { location.hash = "#/" + id; }
  function drill(id) {
    const d = DRILLS.find(x => x.id === id); if (!d) return home();
    const s = stat(id), num = DRILLS.indexOf(d) + 1;
    document.title = d.title + " · Felt";
    app.innerHTML = "";
    const score = h("div", { class: "score" });
    const updScore = () => { const last = s.hist.slice(-WINDOW); score.innerHTML = `<b>${last.filter(Boolean).length}</b>/${last.length || 0} · run <b>${s.streak}</b>`; };
    const idea = h("details", { class: "idea" }, h("summary", {}, "The idea"), h("div", { class: "body", html: d.idea }));
    if (!s.seen) { idea.open = true; s.seen = true; save(); }
    const stage = h("div"), prompt = h("div", { class: "prompt" }), ctl = h("div", { class: "ctl" }), fbBox = h("div"), gzBox = h("div");
    const w = h("div", { class: "wrap" },
      h("div", { class: "bar" }, h("button", { class: "back", onclick: () => { location.hash = ""; }, "aria-label": "Back" }, "←"),
        h("div", { class: "ttl" }, h("small", {}, `${String(num).padStart(2, "0")} · Act ${ACTS[d.act][0]}`), d.title), score),
      idea, stage, prompt, gzBox, ctl, fbBox);
    app.append(w);
    updScore();
    current = { keys: {} };
    function deal() {
      stage.innerHTML = ""; prompt.innerHTML = ""; ctl.innerHTML = ""; fbBox.innerHTML = ""; ctl.classList.remove("hide");
      let guess = false; const t0 = Date.now(), gz = guessToggle(v => { guess = v; });
      gzBox.innerHTML = ""; gzBox.append(gz.el);
      const ctx = current = {
        stage, prompt, ctl, keys: { g: gz.toggle }, done: false,
        buttons(list) {
          ctl.innerHTML = ""; const els = [];
          for (const [label, fn, key, cls] of list) {
            const b = h("button", { class: "btn" + (cls ? " " + cls : "") }, label, key && key.length === 1 ? h("kbd", {}, key.toUpperCase()) : null);
            b.onclick = () => { if (!ctx.done) fn(); };
            if (key) ctx.keys[key] = () => { if (!ctx.done && !b.disabled) fn(); };
            ctl.append(b); els.push(b);
          }
          return els;
        },
        finish(r) {
          ctx.done = true;
          const ok = r.grade === "ok";
          s.hist.push(ok ? 1 : 0); if (s.hist.length > 60) s.hist.splice(0, s.hist.length - 60);
          s.n++; s.streak = ok ? s.streak + 1 : 0; s.best = Math.max(s.best, s.streak); save(); updScore();
          const q = COACH.plain(prompt.innerHTML);
          const rid = COACH.rec("drill", { drill: d.id, title: d.title, grade: r.grade, ok, guess, ms: Date.now() - t0, q,
            why: r.lines.map(COACH.plain), note: r.note ? COACH.plain(r.note) : undefined, log: r.log || null });
          COACH.tally("drill:" + d.id, ok);
          gzBox.innerHTML = "";
          if (!r.keepCtl) ctl.classList.add("hide");
          const verdict = r.verdict || (ok ? pick(["Right.", "Yes.", "Correct.", "Spot on."]) : r.grade === "mid" ? "Close." : pick(["Not quite.", "No.", "Not this time."]));
          const fb = h("div", { class: "fb " + (ok && !r.verdict ? "ok" : ok ? "mid" : r.grade === "mid" ? "mid" : "no") }, h("div", { class: "v" }, verdict));
          for (const ln of r.lines) fb.append(h("p", { class: "ln", html: ln }));
          if (r.extra) fb.append(r.extra);
          if (r.note) fb.append(h("p", { class: "ln k", html: r.note }));
          const nb = h("button", { class: "btn" }, "Next hand", h("kbd", {}, "↵"));
          nb.onclick = deal;
          fb.append(flagCtl(rid, `${d.title}${q ? " · " + q.slice(0, 70) : ""}`));
          fb.append(h("div", { class: "go" }, nb));
          fbBox.append(fb);
          ctx.keys = { enter: deal, " ": deal };
          setTimeout(() => fb.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
        },
      };
      d.run(ctx);
    }
    deal();
    window.scrollTo(0, 0);
  }

  document.addEventListener("keydown", e => {
    if (!current || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target && e.target.closest && e.target.closest("textarea, input")) return; // typing a note, not playing
    const k = e.key === "Enter" ? "enter" : e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const fn = current.keys && current.keys[k];
    if (fn) { e.preventDefault(); fn(); }
    if (e.key === "Escape") location.hash = "";
  });
  const route = () => {
    const m = location.hash.match(/^#\/(\w+)/);
    if (!m) return home();
    if (m[1] === "lobby") return lobby();
    if (m[1] === "sync") return syncPage();
    if (m[1] === "flags") return flagsPage();
    if (m[1] === "play") return G && !G.over ? playTable() : lobby();
    drill(m[1]);
  };
  window.addEventListener("hashchange", route);
  route();
  window.__felt = { DRILLS, OPENSET, store: () => store, game: () => G };
})();
