/* Poker engine: hand evaluation, hand classes, ranges, ICM.
   Pure functions, no DOM. Loaded by the browser (window.PE) and by Node
   (tools/precompute.js, test/) via require. Card = 0..51: rank = c>>2 (0=deuce..12=ace),
   suit = c&3 (0=spades,1=hearts,2=diamonds,3=clubs). */
(function (root) {
  "use strict";
  const RANKS = "23456789TJQKA";
  const SUITS = "shdc";
  const GLYPH = ["♠", "♥", "♦", "♣"];
  const RANK_NAME = ["Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Jack","Queen","King","Ace"];
  const RANK_PLURAL = ["Twos","Threes","Fours","Fives","Sixes","Sevens","Eights","Nines","Tens","Jacks","Queens","Kings","Aces"];
  const CAT_NAME = ["High card","One pair","Two pair","Three of a kind","Straight","Flush","Full house","Four of a kind","Straight flush"];

  const rankOf = c => c >> 2, suitOf = c => c & 3;
  const card = (r, s) => (r << 2) | s;
  const cardStr = c => RANKS[c >> 2] + SUITS[c & 3];
  function parseCard(s) { return card(RANKS.indexOf(s[0].toUpperCase()), SUITS.indexOf(s[1].toLowerCase())); }
  const parseCards = s => s.trim().split(/\s+/).filter(Boolean).map(parseCard);

  // ---------- 7-card evaluator ----------
  // Score = category * 16^5 + five kicker ranks (4 bits each). Higher wins.
  const cnt = new Int8Array(13), smask = new Int32Array(4), scnt = new Int8Array(4);
  function straightTop(mask) {
    for (let t = 12; t >= 4; t--) if (((mask >> (t - 4)) & 31) === 31) return t;
    if ((mask & 0x100F) === 0x100F) return 3; // wheel A-2-3-4-5
    return -1;
  }
  function topBits(mask, n) {
    const out = [];
    for (let r = 12; r >= 0 && out.length < n; r--) if (mask & (1 << r)) out.push(r);
    return out;
  }
  const pack = (cat, k) => cat * 1048576 + ((k[0] || 0) << 16) + ((k[1] || 0) << 12) + ((k[2] || 0) << 8) + ((k[3] || 0) << 4) + (k[4] || 0);

  function evaluate(cards) {
    cnt.fill(0); smask.fill(0); scnt.fill(0);
    let rmask = 0;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i], r = c >> 2, s = c & 3;
      cnt[r]++; smask[s] |= 1 << r; scnt[s]++; rmask |= 1 << r;
    }
    let fs = -1;
    for (let s = 0; s < 4; s++) if (scnt[s] >= 5) fs = s;
    if (fs >= 0) {
      const st = straightTop(smask[fs]);
      if (st >= 0) return pack(8, [st]);
    }
    let quad = -1, trips = [], pairs = [];
    for (let r = 12; r >= 0; r--) {
      if (cnt[r] === 4) quad = r; else if (cnt[r] === 3) trips.push(r); else if (cnt[r] === 2) pairs.push(r);
    }
    if (quad >= 0) return pack(7, [quad, topBits(rmask & ~(1 << quad), 1)[0]]);
    if (trips.length && (trips.length > 1 || pairs.length)) {
      const t = trips[0], p = trips.length > 1 ? Math.max(trips[1], pairs[0] ?? -1) : pairs[0];
      return pack(6, [t, p]);
    }
    if (fs >= 0) return pack(5, topBits(smask[fs], 5));
    const st = straightTop(rmask);
    if (st >= 0) return pack(4, [st]);
    if (trips.length) return pack(3, [trips[0], ...topBits(rmask & ~(1 << trips[0]), 2)]);
    if (pairs.length >= 2) {
      const a = pairs[0], b = pairs[1];
      return pack(2, [a, b, topBits(rmask & ~(1 << a) & ~(1 << b), 1)[0]]);
    }
    if (pairs.length) return pack(1, [pairs[0], ...topBits(rmask & ~(1 << pairs[0]), 3)]);
    return pack(0, topBits(rmask, 5));
  }
  const category = score => Math.floor(score / 1048576);
  const kickers = score => [16, 12, 8, 4, 0].map(sh => (score >> sh) & 15);

  function describe(score) {
    const cat = category(score), k = kickers(score);
    switch (cat) {
      case 0: return RANK_NAME[k[0]] + " high";
      case 1: return "Pair of " + RANK_PLURAL[k[0]];
      case 2: return "Two pair, " + RANK_PLURAL[k[0]] + " and " + RANK_PLURAL[k[1]];
      case 3: return "Three " + RANK_PLURAL[k[0]];
      case 4: return RANK_NAME[k[0]] + "-high straight";
      case 5: return RANK_NAME[k[0]] + "-high flush";
      case 6: return RANK_PLURAL[k[0]] + " full of " + RANK_PLURAL[k[1]];
      case 7: return "Four " + RANK_PLURAL[k[0]];
      case 8: return k[0] === 12 ? "Royal flush" : RANK_NAME[k[0]] + "-high straight flush";
    }
  }
  // Which kicker card actually settled a same-category tie, for teaching text.
  function decider(a, b) {
    if (category(a) !== category(b)) return null;
    const ka = kickers(a), kb = kickers(b);
    for (let i = 0; i < 5; i++) if (ka[i] !== kb[i]) return { index: i, a: ka[i], b: kb[i] };
    return null;
  }

  function combos(arr, k) {
    const out = [], cur = [];
    (function rec(start) {
      if (cur.length === k) { out.push(cur.slice()); return; }
      for (let i = start; i < arr.length; i++) { cur.push(arr[i]); rec(i + 1); cur.pop(); }
    })(0);
    return out;
  }
  function bestFive(cards) {
    let best = -1, bestSet = null;
    for (const set of combos(cards, 5)) { const s = evaluate(set); if (s > best) { best = s; bestSet = set; } }
    return { score: best, cards: bestSet };
  }

  // ---------- 169 starting-hand classes ----------
  // Index layout matches the 13x13 grid: row = first rank (A at top), col = second.
  // Above diagonal = suited, below = offsuit, diagonal = pairs.
  const GRID = [];   // GRID[row][col] = class index
  const CLASSES = []; // {name, hi, lo, type:'p'|'s'|'o', combos:[[c1,c2],...], row, col}
  for (let row = 0; row < 13; row++) {
    GRID.push([]);
    for (let col = 0; col < 13; col++) {
      const r1 = 12 - row, r2 = 12 - col;
      const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
      const type = row === col ? "p" : col > row ? "s" : "o";
      const name = RANKS[hi] + RANKS[lo] + (type === "p" ? "" : type);
      const cs = [];
      if (type === "p") { for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) cs.push([card(hi, a), card(hi, b)]); }
      else if (type === "s") { for (let s = 0; s < 4; s++) cs.push([card(hi, s), card(lo, s)]); }
      else { for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (a !== b) cs.push([card(hi, a), card(lo, b)]); }
      GRID[row].push(CLASSES.length);
      CLASSES.push({ name, hi, lo, type, combos: cs, row, col });
    }
  }
  const NAME_TO_CLASS = Object.fromEntries(CLASSES.map((c, i) => [c.name, i]));
  function classOf(c1, c2) {
    const r1 = c1 >> 2, r2 = c2 >> 2, hi = Math.max(r1, r2), lo = Math.min(r1, r2);
    const type = r1 === r2 ? "p" : (c1 & 3) === (c2 & 3) ? "s" : "o";
    return NAME_TO_CLASS[RANKS[hi] + RANKS[lo] + (type === "p" ? "" : type)];
  }
  const comboCount = i => CLASSES[i].combos.length;

  // Range strings like "22+, A2s+, KTs+, K9s-K7s, AJo+, KQo, 76s"
  function parseRange(str) {
    const set = new Set();
    const R = ch => RANKS.indexOf(ch.toUpperCase());
    for (let tok of str.split(",").map(t => t.trim()).filter(Boolean)) {
      if (tok.includes("-")) {
        const [a, b] = tok.split("-");
        if (a[0] === a[1]) { for (let r = R(b[0]); r <= R(a[0]); r++) set.add(NAME_TO_CLASS[RANKS[r] + RANKS[r]]); }
        else { const t = a[2]; for (let r = R(b[1]); r <= R(a[1]); r++) set.add(NAME_TO_CLASS[a[0].toUpperCase() + RANKS[r] + t]); }
        continue;
      }
      const plus = tok.endsWith("+"); if (plus) tok = tok.slice(0, -1);
      if (tok.length === 2) { // pair
        const r0 = R(tok[0]);
        for (let r = r0; r <= (plus ? 12 : r0); r++) set.add(NAME_TO_CLASS[RANKS[r] + RANKS[r]]);
      } else {
        const hi = R(tok[0]), lo = R(tok[1]), t = tok[2].toLowerCase();
        for (let r = lo; r <= (plus ? hi - 1 : lo); r++) set.add(NAME_TO_CLASS[RANKS[hi] + RANKS[r] + t]);
      }
    }
    if (set.has(undefined)) throw new Error("bad range: " + str);
    return set;
  }
  const rangeCombos = set => [...set].reduce((n, i) => n + comboCount(i), 0);
  const rangePct = set => rangeCombos(set) / 1326 * 100;

  // ---------- Equity ----------
  // Exact-ish Monte Carlo equity for specific hands. hands = [[c,c],[c,c],...], board = partial board.
  function equityMC(hands, board, trials, rng) {
    rng = rng || Math.random;
    const dead = new Set([...hands.flat(), ...board]);
    const deck = []; for (let c = 0; c < 52; c++) if (!dead.has(c)) deck.push(c);
    const need = 5 - board.length, share = new Float64Array(hands.length);
    const exhaustive = need <= 2;
    const runs = exhaustive ? combos(deck, need) : null;
    const n = exhaustive ? runs.length : trials;
    const b = board.slice();
    for (let t = 0; t < n; t++) {
      let extra;
      if (exhaustive) extra = runs[t];
      else {
        extra = [];
        for (let k = 0; k < need; k++) { const j = k + Math.floor(rng() * (deck.length - k)); [deck[k], deck[j]] = [deck[j], deck[k]]; extra.push(deck[k]); }
      }
      const full = b.concat(extra);
      let best = -1, winners = [];
      for (let h = 0; h < hands.length; h++) {
        const s = evaluate(hands[h].concat(full));
        if (s > best) { best = s; winners = [h]; } else if (s === best) winners.push(h);
      }
      for (const w of winners) share[w] += 1 / winners.length;
    }
    return Array.from(share, x => x / n);
  }

  // ---------- ICM (Malmuth-Harville) ----------
  function icm(stacks, payouts) {
    const n = stacks.length, eq = new Array(n).fill(0);
    const total = stacks.reduce((a, b) => a + b, 0);
    (function rec(remaining, place, prob, rem) {
      if (place >= payouts.length || prob === 0) return;
      for (const i of remaining) {
        if (stacks[i] <= 0) continue;
        const p = prob * stacks[i] / rem;
        eq[i] += p * payouts[place];
        rec(remaining.filter(j => j !== i), place + 1, p, rem - stacks[i]);
      }
    })(stacks.map((_, i) => i), 0, 1, total);
    return eq;
  }

  const PE = {
    RANKS, SUITS, GLYPH, RANK_NAME, RANK_PLURAL, CAT_NAME,
    rankOf, suitOf, card, cardStr, parseCard, parseCards,
    evaluate, category, kickers, describe, decider, combos, bestFive,
    GRID, CLASSES, NAME_TO_CLASS, classOf, comboCount, parseRange, rangeCombos, rangePct,
    equityMC, icm,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = PE; else root.PE = PE;
})(typeof window !== "undefined" ? window : globalThis);
