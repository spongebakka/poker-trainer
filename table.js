/* Felt: the coached table. A full No-Limit Hold'em hand engine (blinds, antes, betting,
   side pots, showdown), bots whose strategy is a pure function of (cards, situation) so
   their exact range can be tracked action by action, and a coach that grades each of your
   decisions against those real ranges. No DOM. Browser: window.TBL. Node: module.exports. */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory(require("./engine.js"), require("./data.js"));
  else root.TBL = factory(root.PE, root.PDATA);
})(this, function (PE, D) {
  "use strict";
  const N = 169;

  // ---------- hand strength order (equity vs a random hand) ----------
  const ORDER = [...Array(N).keys()].sort((a, b) => D.eqRand[b] - D.eqRand[a]);
  const PCT = new Float64Array(N); // share of all combos that are stronger than this class (midpoint)
  { let c = 0; for (const i of ORDER) { const k = PE.comboCount(i); PCT[i] = (c + k / 2) / 1326; c += k; } }
  const CLS = new Int16Array(52 * 52);
  for (let a = 0; a < 52; a++) for (let b = 0; b < 52; b++) if (a !== b) CLS[a * 52 + b] = PE.classOf(a, b);
  const clsOf = (a, b) => CLS[a * 52 + b];
  const ALL = []; for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) ALL.push([a, b]);

  // ---------- charts ----------
  // Simplified 100bb 6-max opening chart (raise first in). Not solver output.
  const OPEN = {
    UTG: "33+, A2s+, K9s+, QTs+, JTs, T9s, 98s, AJo+, KQo",
    HJ: "22+, A2s+, K8s+, Q9s+, J9s+, T9s, 98s, 87s, ATo+, KJo+, QJo",
    CO: "22+, A2s+, K5s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A8o+, KTo+, QTo+, JTo",
    BTN: "22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 96s+, 85s+, 74s+, 64s+, 53s+, 43s, A2o+, K8o+, Q9o+, J9o+, T9o, 98o",
    SB: "22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 96s+, 86s+, 75s+, 64s+, 54s, A2o+, K8o+, Q9o+, J9o+, T9o",
  };
  // Simplified isolation-raise chart: raise over one or more limpers (bigger than an open). Not solver output.
  const ISO = {
    HJ: "77+, ATs+, KJs+, QJs, AJo+, KQo",
    CO: "77+, A9s+, KTs+, QTs+, JTs, AJo+, KQo",
    BTN: "66+, A8s+, K9s+, QTs+, JTs, ATo+, KJo+",
    SB: "88+, ATs+, KJs+, AJo+, KQo",
  };
  const ISOSET = Object.fromEntries(Object.entries(ISO).map(([k, v]) => [k, PE.parseRange(v)]));
  const OPENSET = Object.fromEntries(Object.entries(OPEN).map(([k, v]) => [k, PE.parseRange(v)]));
  const OPENPCT = Object.fromEntries(Object.entries(OPENSET).map(([k, s]) => [k, PE.rangePct(s) / 100]));
  const POSN = { 2: ["BTN", "BB"], 3: ["BTN", "SB", "BB"], 4: ["BTN", "SB", "BB", "CO"], 5: ["BTN", "SB", "BB", "HJ", "CO"], 6: ["BTN", "SB", "BB", "UTG", "HJ", "CO"] };
  const POS_NAME = { BTN: "button", SB: "small blind", BB: "big blind", UTG: "under the gun", HJ: "hijack", CO: "cutoff" };

  // Heads-up Nash shove % by stack, then shrunk for each extra player still to act.
  const NASHPCT = {};
  for (const S of D.nash.stacks) NASHPCT[S] = D.nash.push[S].split("").reduce((s, ch, i) => s + (+ch / 9) * PE.comboCount(i), 0) / 1326;
  const nashAt = S => { const st = D.nash.stacks; let b = st[0]; for (const x of st) if (Math.abs(x - S) < Math.abs(b - S)) b = x; return NASHPCT[b]; };
  const BEHIND_F = [1, 1, 0.72, 0.55, 0.44, 0.36];
  const pushRange = (S, behind) => Math.min(1, nashAt(Math.max(1, S)) * BEHIND_F[Math.min(5, Math.max(1, behind))]);

  // class equity vs "top X%" (matrix, blocker-weighted), cached
  const topCache = {};
  function eqVsTop(cls, pct) {
    const key = Math.max(1, Math.round(pct * 100));
    let row = topCache[key];
    if (!row) {
      const wts = new Float64Array(N); let c = 0;
      for (const i of ORDER) { if (c / 1326 >= key / 100) break; wts[i] = 1; c += PE.comboCount(i); }
      row = topCache[key] = new Float64Array(N);
      for (let i = 0; i < N; i++) { let w = 0, e = 0; for (let j = 0; j < N; j++) if (wts[j]) { const x = D.w[i * N + j]; w += x; e += x * D.eq[i * N + j] / 1000; } row[i] = w ? e / w : 0.5; }
    }
    return row[cls];
  }

  // ---------- rng + deterministic mixing ----------
  function seeded(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
  function hashU(a, b, salt) { let x = (a * 73856093) ^ (b * 19349663) ^ (salt * 83492791); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x ^= x >>> 16; return (x >>> 0) / 4294967296; }
  function shuffle(a, rng) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // ---------- bots ----------
  // Real table terms: nit (very tight), TAG (tight-aggressive, the solid style), LAG (loose-aggressive), calling station.
  // limp: share of first-in hands (below the top quarter of their range) that just call the big blind instead of raising.
  const BOTS = [
    { name: "Rosa", tag: "nit", loose: 0.65, agg: 0.8, bluff: 0.35, sticky: 0.8 },
    { name: "Dev", tag: "TAG", loose: 1, agg: 1.1, bluff: 1, sticky: 1 },
    { name: "Mick", tag: "LAG", loose: 1.6, agg: 1.4, bluff: 1.7, sticky: 1.05, limp: 0.2 },
    { name: "June", tag: "calling station", loose: 1.5, agg: 0.55, bluff: 0.35, sticky: 1.7, limp: 0.8 },
    { name: "Theo", tag: "TAG", loose: 1.05, agg: 1.05, bluff: 1, sticky: 1 },
    { name: "Ines", tag: "LAG", loose: 1.3, agg: 1.5, bluff: 1.4, sticky: 0.95, limp: 0.15 },
    { name: "Sal", tag: "nit", loose: 0.7, agg: 0.9, bluff: 0.5, sticky: 0.9 },
  ];
  const STYLE_LINE = {
    "nit": "plays very few hands; when a nit bets big, believe it",
    "TAG": "tight and aggressive: the solid, standard style",
    "LAG": "loose and aggressive: plays lots of hands and bets a lot",
    "calling station": "calls far too much and rarely bluffs: value-bet them, never bluff them",
  };

  // ---------- postflop hand reading ----------
  function straightIn(m) { const x = (m << 1) | ((m >> 12) & 1); for (let k = 0; k <= 9; k++) if (((x >> k) & 31) === 31) return true; return false; }
  function completers(m) { if (straightIn(m)) return 0; let n = 0; for (let r = 0; r < 13; r++) if (!(m & (1 << r)) && straightIn(m | (1 << r))) n++; return n; }
  function tier(hole, board) {
    const all = hole.concat(board), sc = PE.evaluate(all), cat = PE.category(sc);
    const br = board.map(c => c >> 2).sort((a, b) => b - a), top = br[0];
    const bc = {}; for (const r of br) bc[r] = (bc[r] || 0) + 1;
    const h1 = hole[0] >> 2, h2 = hole[1] >> 2, pp = h1 === h2;
    const boardPaired = Object.values(bc).some(n => n >= 2);
    let t = 0, desc = "nothing";
    if (board.length === 5 && PE.evaluate(board) === sc) { t = 0; desc = "the board plays"; }
    else if (cat >= 4) {
      t = 5; desc = PE.describe(sc).toLowerCase();
      if (cat === 5) { // flush: weak if board has 4+ of the suit and our best flush card is low
        const s = [0, 0, 0, 0]; board.forEach(c => s[c & 3]++); const fs = s.indexOf(Math.max(...s));
        if (s[fs] >= 4) { const mine = hole.filter(c => (c & 3) === fs).map(c => c >> 2); if (Math.max(...mine) < 10) { t = 3; desc = "a low flush on a four-flush board"; } }
      }
      if (cat === 4 && board.length >= 4) { // straight using one card on a four-straight board is weaker
        let m = 0; board.forEach(c => m |= 1 << (c >> 2)); if (m & 4096) m |= 1 << 13;
        for (let x = 4; x <= 13; x++) { let n = 0; for (let k = 0; k < 5; k++) if (m & (1 << (x - k))) n++; if (n >= 4) { t = 4; desc = "a straight, but one card makes it for anyone"; break; } }
      }
    } else if (cat === 3) {
      if (pp && bc[h1] === 1) { t = 5; desc = "a set"; }
      else if (bc[h1] === 2 || bc[h2] === 2) { t = 4; desc = "trips"; }
      else { t = 0; desc = "trips on the board"; }
    } else if (cat === 2) {
      const pairs = [h1, h2].filter(r => bc[r] === 1);
      if (!pp && h1 !== h2 && pairs.length === 2) { t = 5; desc = "two pair"; }
      else if (pp && !bc[h1]) { t = h1 > top ? 4 : h1 > br[1] ? 2 : 1; desc = h1 > top ? "an overpair (board pair too)" : "a pocket pair under the board"; }
      else if (pairs.length === 1) { const pr = pairs[0]; t = pr === top ? 3 : 2; desc = pr === top ? "top pair on a paired board" : "a pair on a paired board"; }
      else { t = 0; desc = "two pair on the board"; }
    } else if (cat === 1) {
      if (pp) {
        if (h1 > top) { t = 4; desc = "an overpair"; }
        else if (h1 > br[1]) { t = 2; desc = "a pocket pair below the top card"; }
        else { t = 1; desc = "a small pocket pair"; }
      } else if (!boardPaired || bc[h1] === 1 || bc[h2] === 1) {
        const pr = bc[h1] ? h1 : h2, kick = pr === h1 ? h2 : h1;
        if (pr === top) { t = kick >= 9 ? 4 : 3; desc = "top pair, " + (kick >= 9 ? "good kicker" : "weak kicker"); }
        else if (pr === br[1]) { t = 2; desc = "second pair"; }
        else { t = 1; desc = "bottom pair"; }
      } else { t = 0; desc = h1 > top && h2 > top ? "two overcards" : "nothing (the pair is on the board)"; }
    } else desc = h1 > top && h2 > top ? "two overcards" : h1 === 12 || h2 === 12 ? "ace high" : "nothing";
    let draw = 0; // 2 = flush draw or open-ender, 3 = combo draw, 1 = gutshot
    if (board.length < 5) {
      const s = [0, 0, 0, 0]; all.forEach(c => s[c & 3]++);
      const fd = hole.some(c => s[c & 3] === 4) && cat < 5;
      const mk = cs => cs.reduce((m, c) => m | (1 << (c >> 2)), 0);
      const mAll = mk(all), mB = mk(board);
      const cAll = cat < 4 ? completers(mAll) : 0, cB = completers(mB);
      const oe = cAll >= 2 && cAll > cB, gut = cAll === 1 && cB === 0;
      draw = fd && oe ? 3 : fd || oe ? 2 : gut ? 1 : 0;
      if (draw >= 2 && t <= 2) { desc = (t ? desc + " plus " : "") + (draw === 3 ? "a flush and straight draw" : fd ? "a flush draw" : "an open-ended straight draw"); t = Math.max(t, draw === 3 ? 3 : 2); }
      else if (draw === 1 && t === 0) { t = 1; desc = desc === "nothing" ? "a gutshot" : desc + " and a gutshot"; }
    }
    return { t, draw, desc, cat };
  }

  // ---------- engine ----------
  const LEVELS = [[10, 20, 0], [15, 30, 0], [25, 50, 50], [50, 100, 100], [75, 150, 150], [100, 200, 200], [150, 300, 300], [200, 400, 400], [300, 600, 600], [400, 800, 800], [600, 1200, 1200], [1000, 2000, 2000], [1500, 3000, 3000], [2500, 5000, 5000]];
  const HPL = 6, PAYOUT = [65, 35], CASH_BUYIN = 200;

  function newGame(mode, seed) {
    const rng = seed == null ? Math.random : seeded(seed);
    const cash = mode === "cash", start = cash ? CASH_BUYIN : 1500;
    const bots = shuffle(BOTS.slice(), rng).slice(0, 5);
    const players = [{ seat: 0, name: "You", hero: true, stack: start, style: null }]
      .concat(bots.map((b, k) => ({ seat: k + 1, name: b.name, hero: false, stack: start, style: b })));
    return { mode, cash, players, btn: Math.floor(rng() * 6), handNo: 0, rng, buyins: 1, places: {}, over: false };
  }
  function blindsFor(g, handNo) {
    if (g.cash) return { sb: 1, bb: 2, ante: 0, level: 0 };
    const L = Math.min(LEVELS.length - 1, Math.floor(handNo / HPL)); const [sb, bb, ante] = LEVELS[L];
    return { sb, bb, ante, level: L + 1, handsLeft: HPL - (handNo % HPL) };
  }
  const liveSeats = g => g.players.filter(p => p.stack > 0).map(p => p.seat);

  function newHand(g) {
    if (g.cash) for (const p of g.players) if (!p.hero && p.stack < CASH_BUYIN * 0.4) p.stack = CASH_BUYIN;
    if (liveSeats(g).length < 2 || g.players[0].stack <= 0) { g.over = true; return null; }
    do g.btn = (g.btn + 1) % 6; while (g.players[g.btn].stack <= 0);
    const bl = blindsFor(g, g.handNo); g.handNo++;
    const order = []; for (let k = 0; k < 6; k++) { const s = (g.btn + k) % 6; if (g.players[s].stack > 0) order.push(s); }
    const n = order.length, names = POSN[n];
    const deck = shuffle([...Array(52).keys()], g.rng);
    const H = { g, id: g.handNo, bl, order, n, deck, board: [], street: 0, seats: {}, pot: 0, dead: 0, curBet: 0, minRaise: bl.bb,
      toAct: null, actions: [], streetAgg: null, prevAgg: null, preAgg: null, over: false, result: null, startStacks: {} };
    order.forEach((s, k) => {
      H.startStacks[s] = g.players[s].stack;
      H.seats[s] = { seat: s, pos: names[k], cards: [deck.pop(), deck.pop()], stack: g.players[s].stack, bet: 0, total: 0, folded: false, allin: false, acted: false, range: g.players[s].hero ? null : ALL.slice() };
    });
    const sbSeat = n === 2 ? order[0] : order[1], bbSeat = n === 2 ? order[1] : order[2];
    H.sbSeat = sbSeat; H.bbSeat = bbSeat;
    putIn(H, sbSeat, bl.sb); putIn(H, bbSeat, bl.bb);
    if (bl.ante) { const p = H.seats[bbSeat], a = Math.min(bl.ante, p.stack); p.stack -= a; H.dead += a; H.pot += a; if (!p.stack) p.allin = true; }
    H.curBet = bl.bb;
    H.toAct = nextToAct(H, bbSeat);
    if (H.toAct == null) endStreet(H);
    return H;
  }
  function putIn(H, s, amt) { const p = H.seats[s], a = Math.min(amt, p.stack); p.stack -= a; p.bet += a; p.total += a; if (!p.stack) p.allin = true; return a; }
  const nextSeat = (H, s) => H.order[(H.order.indexOf(s) + 1) % H.order.length];
  function nextToAct(H, from) {
    let s = from;
    const live = H.order.filter(x => !H.seats[x].folded);
    if (live.length < 2) return null;
    const canMove = live.filter(x => !H.seats[x].allin);
    for (let k = 0; k < H.order.length; k++) {
      s = nextSeat(H, s); const p = H.seats[s];
      if (p.folded || p.allin) continue;
      if (!p.acted || p.bet < H.curBet) {
        // lone player with chips who already matches everything has nothing to decide
        if (canMove.length === 1 && p.bet >= Math.max(...live.map(x => H.seats[x].bet))) return null;
        return s;
      }
    }
    return null;
  }
  const potTotal = H => H.pot + H.order.reduce((a, s) => a + H.seats[s].bet, 0);
  function legal(H) {
    const p = H.seats[H.toAct], toCall = Math.min(H.curBet - p.bet, p.stack), maxTo = p.bet + p.stack;
    const others = H.order.filter(s => s !== H.toAct && !H.seats[s].folded && !H.seats[s].allin);
    const canRaise = p.stack > toCall && others.length > 0;
    return { toCall, canCheck: toCall === 0, minTo: Math.min(H.curBet + H.minRaise, maxTo), maxTo, canRaise, pot: potTotal(H) };
  }
  function normalize(H, a) {
    const L = legal(H);
    if (a.type === "fold" && L.toCall === 0) return { type: "check" };
    if (a.type === "check" && L.toCall > 0) return { type: "fold" };
    if (a.type === "call" && L.toCall === 0) return { type: "check" };
    if (a.type === "raise" || a.type === "allin") {
      if (!L.canRaise) return L.toCall ? { type: "call" } : { type: "check" };
      let to = a.type === "allin" ? L.maxTo : Math.round(a.to);
      if (to >= L.maxTo * 0.8) to = L.maxTo;
      to = Math.max(L.minTo, Math.min(L.maxTo, to));
      return { type: "raise", to };
    }
    return { type: a.type };
  }
  const sameAction = (a, b) => a.type === b.type && (a.type !== "raise" || a.to === b.to);

  function situation(H, s) {
    const p = H.seats[s], L = legal(H), bb = H.bl.bb;
    const live = H.order.filter(x => !H.seats[x].folded), others = live.filter(x => x !== s);
    const eff = Math.min(p.stack + p.bet, Math.max(...others.map(x => H.seats[x].stack + H.seats[x].bet)));
    const st = H.actions.filter(a => a.street === H.street && a.type === "raise");
    const lastR = st.length ? st[st.length - 1] : null;
    const post = H.order.slice(1).concat(H.order.slice(0, 1)); // SB first ... BTN last
    let behind = 0; if (H.street === 0) { let x = s; while (true) { x = nextSeat(H, x); if (x === s) break; if (!H.seats[x].folded && !H.seats[x].allin && (!H.seats[x].acted || H.seats[x].bet < H.curBet)) behind++; if (x === H.bbSeat) break; } }
    let vsPct = 0.05;
    if (lastR) { const rp = H.seats[lastR.seat]; const rS = (H.startStacks[lastR.seat]) / bb; vsPct = rp.allin ? (st.length > 1 ? 0.06 : pushRange(rS, lastR.behind || 2)) : st.length > 1 ? 0.05 : (OPENPCT[rp.pos] || 0.4); }
    return { street: H.street, board: H.board, pos: p.pos, n: H.n, nLive: live.length, toCall: L.toCall, pot: L.pot, bb, stack: p.stack, bet: p.bet,
      curBet: H.curBet, minTo: L.minTo, maxTo: L.maxTo, canRaise: L.canRaise, S: eff / bb, raises: st.length, behind,
      facingAllin: !!(lastR && H.seats[lastR.seat].allin), vsPct,
      ip: lastR ? post.indexOf(s) > post.indexOf(lastR.seat) : false,
      aggressor: H.street === 0 ? false : H.prevAgg === s, limpers: H.street === 0 ? H.order.filter(x => x !== H.bbSeat && x !== H.sbSeat && H.seats[x].bet === bb && H.seats[x].acted).length : 0,
      salt: H.id * 131 + s * 17 + H.actions.length * 7 + H.g.handNo };
  }

  // ---------- bot policy: pure function of (style, hole, situation) ----------
  function policy(st, hole, sit) {
    const lo = Math.min(hole[0], hole[1]), hi = Math.max(hole[0], hole[1]);
    const u = hashU(lo, hi, sit.salt), u2 = hashU(hi, lo, sit.salt + 1);
    return sit.street === 0 ? prePolicy(st, hole, sit, u) : postPolicy(st, hole, sit, u, u2);
  }
  const R = to => ({ type: "raise", to }), ALLIN = { type: "allin" }, FOLD = { type: "fold" }, CALL = { type: "call" }, CHECK = { type: "check" };
  function prePolicy(st, hole, sit, u) {
    const cls = clsOf(hole[0], hole[1]), pct = PCT[cls], bb = sit.bb;
    const allinCall = () => { const eq = eqVsTop(cls, sit.vsPct), need = sit.toCall / (sit.pot + sit.toCall); return eq >= need - 0.03 * (st.sticky - 1) ? (sit.toCall >= sit.stack ? CALL : ALLIN) : FOLD; };
    if (sit.raises === 0) {
      if (sit.toCall === 0) return pct < 0.07 * st.agg ? R(sit.curBet * 3 + sit.limpers * bb) : CHECK;
      if (sit.S <= 12) return pct < pushRange(sit.S, sit.behind) * st.loose ? ALLIN : FOLD;
      const thr = (sit.n === 2 ? 0.75 : OPENPCT[sit.pos] || 0.4) * st.loose;
      if (st.limp) { // limpers: the top of the range still raises; the rest mostly just calls (open-limp, or over-limp behind others)
        if (pct < thr && pct > thr * 0.25 && u < st.limp) return CALL;
        if (pct >= thr && st.limp >= 0.5 && sit.limpers && pct < Math.min(0.85, thr * 1.3)) return CALL; // a station tags along wider when the pot's already multiway
      }
      if (pct < thr) return R(((sit.pos === "SB" ? 3 : sit.S < 30 ? 2.2 : 2.5) + sit.limpers) * bb);
      return FOLD;
    }
    if (sit.raises === 1) {
      if (sit.facingAllin || sit.toCall >= sit.stack * 0.45) return allinCall();
      const rbb = sit.curBet / bb;
      if (pct < 0.035 * st.agg || (pct > 0.18 && pct < 0.3 && u < 0.18 * st.bluff)) return sit.S <= 25 ? ALLIN : R(sit.curBet * (sit.ip ? 3 : 3.6));
      let thr = sit.pos === "BB" ? 0.34 : sit.pos === "SB" ? 0.09 : sit.ip ? 0.14 : 0.08;
      thr *= st.loose * st.sticky * Math.pow(2.5 / Math.max(2, rbb), 0.8);
      if (sit.S <= 20) thr *= 0.5;
      return pct < thr ? CALL : FOLD;
    }
    if (sit.facingAllin || sit.toCall >= sit.stack * 0.45) return allinCall();
    if (pct < 0.022) return sit.S > 60 ? R(sit.curBet * 2.3) : ALLIN;
    if (pct < 0.06 * st.sticky && sit.S > 40) return CALL;
    return FOLD;
  }
  function postPolicy(st, hole, sit, u, u2) {
    const T = tier(hole, sit.board), t = T.t, river = sit.street === 3, draw = !river && T.draw >= 2;
    const pot = sit.pot, multi = sit.nLive > 2;
    if (sit.toCall === 0) {
      let p = t >= 5 ? 0.85 : t === 4 ? 0.75 : t === 3 ? (draw ? 0.6 : 0.4) : draw ? 0.45 * st.agg : t === 0 || (river && T.draw) ? (sit.aggressor ? 0.4 : 0.1) * st.bluff : 0.12;
      if (multi && t < 4) p *= 0.3;
      if (u < Math.min(0.95, p * (t >= 4 ? 1 : st.agg))) {
        const frac = t >= 4 ? (river ? 0.75 : 0.66) : 0.4;
        return R(Math.max(sit.bb, Math.round(pot * frac)));
      }
      return CHECK;
    }
    const r = sit.toCall / Math.max(1, pot - sit.toCall), need = sit.toCall / (pot + sit.toCall);
    const raiseP = t >= 5 ? 0.45 * st.agg : draw && t >= 3 ? 0.25 * st.agg : t === 0 && !river && !multi ? 0.04 * st.bluff : 0;
    if (u < raiseP && sit.canRaise) return R(sit.curBet * 3);
    if (t >= 5) return CALL;
    if (t === 4) return r > 1.2 && u2 > 0.6 * st.sticky ? FOLD : CALL;
    if (t === 3) return r <= (river ? 0.6 : 0.85) * st.sticky ? CALL : FOLD;
    if (draw) return need <= (sit.street === 1 ? 0.32 : 0.21) * st.sticky ? CALL : FOLD;
    if (t === 2) return r <= 0.5 * st.sticky ? CALL : FOLD;
    if (t === 1) return st.sticky > 1.3 && r <= 0.5 ? CALL : FOLD;
    return FOLD;
  }
  function botAction(H) { const s = H.toAct; return normalize(H, policy(H.g.players[s].style, H.seats[s].cards, situation(H, s))); }

  // ---------- applying actions ----------
  function act(H, raw) {
    const s = H.toAct, p = H.seats[s], a = normalize(H, raw), L = legal(H), sit = situation(H, s);
    if (p.range) { // narrow this bot's range to the combos that would have done exactly this
      const st = H.g.players[s].style, dead = new Set(H.board);
      p.range = p.range.filter(c => !dead.has(c[0]) && !dead.has(c[1]) && sameAction(normalizeFor(H, policy(st, c, sit)), a));
    }
    const rec = { seat: s, pos: p.pos, street: H.street, type: a.type, to: a.to || 0, amount: 0, behind: sit.behind, potBefore: L.pot, toCall: L.toCall, allin: false };
    if (a.type === "fold") p.folded = true;
    else if (a.type === "call") rec.amount = putIn(H, s, L.toCall);
    else if (a.type === "raise") {
      rec.amount = putIn(H, s, a.to - p.bet);
      const inc = p.bet - H.curBet;
      if (inc >= H.minRaise) { H.minRaise = inc; for (const x of H.order) if (x !== s) H.seats[x].acted = false; }
      if (p.bet > H.curBet) H.curBet = p.bet;
      H.streetAgg = s; if (H.street === 0) H.preAgg = s;
    }
    rec.allin = p.allin; rec.to = p.bet;
    p.acted = true; H.actions.push(rec);
    const live = H.order.filter(x => !H.seats[x].folded);
    if (live.length === 1) return award(H, live[0]);
    const nx = nextToAct(H, s);
    if (nx != null) H.toAct = nx; else endStreet(H);
    return rec;
  }
  const normalizeFor = (H, a) => normalize(H, a);

  function endStreet(H) {
    const live = H.order.filter(x => !H.seats[x].folded);
    // return an uncalled bet
    const bets = H.order.map(s => H.seats[s].bet).sort((a, b) => b - a);
    if (bets[0] > bets[1]) { const s = H.order.find(x => H.seats[x].bet === bets[0]); const p = H.seats[s], d = bets[0] - bets[1]; p.bet -= d; p.total -= d; p.stack += d; if (p.stack) p.allin = false; H.returned = { seat: s, amount: d }; }
    for (const s of H.order) { H.pot += H.seats[s].bet; H.seats[s].bet = 0; H.seats[s].acted = false; }
    H.prevAgg = H.streetAgg; H.streetAgg = null; H.curBet = 0; H.minRaise = H.bl.bb;
    const canAct = live.filter(s => !H.seats[s].allin);
    if (H.street === 3) return showdown(H);
    if (canAct.length <= 1) { while (H.board.length < 5) { if (H.board.length === 0 || H.board.length >= 3) H.deck.pop(); dealStreet(H); } H.street = 3; H.ranOut = true; return showdown(H); }
    H.street++; H.deck.pop(); dealStreet(H);
    H.toAct = nextToAct(H, H.order[0]);
    if (H.toAct == null) endStreet(H);
  }
  function dealStreet(H) { const k = H.board.length === 0 ? 3 : 1; for (let i = 0; i < k; i++) H.board.push(H.deck.pop()); }

  function settle(H, wins, shown, scores) {
    H.over = true; H.toAct = null;
    for (const s of H.order) H.g.players[s].stack = H.seats[s].stack + (wins[s] || 0);
    H.result = { wins, shown, scores };
    const g = H.g;
    if (!g.cash) {
      const busted = H.order.filter(s => g.players[s].stack === 0).sort((a, b) => H.startStacks[b] - H.startStacks[a]);
      let left = liveSeats(g).length;
      busted.forEach((s, k) => { g.places[s] = left + 1 + k; });
      if (left === 1) { g.places[liveSeats(g)[0]] = 1; g.over = true; }
      if (g.players[0].stack === 0) g.over = true;
    }
  }
  function award(H, s) { // everyone else folded
    const total = H.dead + H.order.reduce((a, x) => a + H.seats[x].total, 0);
    for (const x of H.order) { H.seats[x].bet = 0; }
    settle(H, { [s]: total }, [], {});
  }
  function showdown(H) {
    const live = H.order.filter(x => !H.seats[x].folded), scores = {};
    for (const s of live) scores[s] = PE.evaluate(H.seats[s].cards.concat(H.board));
    const levels = [...new Set(live.map(s => H.seats[s].total))].sort((a, b) => a - b);
    const pots = []; let prev = 0;
    for (const lv of levels) {
      let amt = 0; for (const s of H.order) { const t = H.seats[s].total; amt += Math.max(0, Math.min(t, lv) - Math.min(t, prev)); }
      pots.push({ amount: amt, elig: live.filter(s => H.seats[s].total >= lv) }); prev = lv;
    }
    const counted = pots.reduce((a, p) => a + p.amount, 0), all = H.order.reduce((a, s) => a + H.seats[s].total, 0);
    pots[pots.length - 1].amount += all - counted; pots[0].amount += H.dead;
    const wins = {};
    for (const p of pots) {
      if (!p.amount) continue;
      const best = Math.max(...p.elig.map(s => scores[s])), w = p.elig.filter(s => scores[s] === best);
      const share = Math.floor(p.amount / w.length); let odd = p.amount - share * w.length;
      const byBtn = w.slice().sort((a, b) => ((H.order.indexOf(a) + H.order.length - 1) % H.order.length) - ((H.order.indexOf(b) + H.order.length - 1) % H.order.length));
      for (const s of byBtn) { wins[s] = (wins[s] || 0) + share + (odd > 0 ? 1 : 0); odd--; }
    }
    H.pots = pots;
    settle(H, wins, live, scores);
  }

  // ---------- equity vs ranges (Monte Carlo) ----------
  function eqVsRanges(hole, board, ranges, trials, rng) {
    rng = rng || Math.random;
    const used = new Uint8Array(52); let win = 0, done = 0;
    const base = hole.concat(board);
    for (let t = 0; t < trials; t++) {
      used.fill(0); for (const c of base) used[c] = 1;
      const opp = []; let okT = true;
      for (const r of ranges) {
        let c = null; for (let k = 0; k < 30; k++) { const x = r[Math.floor(rng() * r.length)]; if (!used[x[0]] && !used[x[1]]) { c = x; break; } }
        if (!c) { okT = false; break; } used[c[0]] = used[c[1]] = 1; opp.push(c);
      }
      if (!okT) continue;
      const bd = board.slice();
      while (bd.length < 5) { const c = Math.floor(rng() * 52); if (!used[c]) { used[c] = 1; bd.push(c); } }
      const me = PE.evaluate(hole.concat(bd)); let best = me, ties = 1, lose = false;
      for (const o of opp) { const v = PE.evaluate(o.concat(bd)); if (v > me) { lose = true; break; } if (v === me) ties++; }
      done++; if (!lose) win += 1 / ties;
    }
    return done ? win / done : 0.5;
  }
  const clean = (range, dead) => range.filter(c => !dead.has(c[0]) && !dead.has(c[1]));
  function rangeWeights(range) { const w = new Float64Array(N); for (const c of range) w[clsOf(c[0], c[1])] += 1; for (let i = 0; i < N; i++) w[i] /= PE.comboCount(i); return w; }
  const rangeShare = range => range.length / 1326;

  // ---------- coach ----------
  const pc = x => (x * 100).toFixed(x < 0.1 ? 1 : 0) + "%";
  const bbs = (x, bb) => { const v = x / bb; return (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1)).replace(/\.0$/, "") + " bb"; };
  function kindOf(H, a) { // what the hero's action is, in coach terms
    const n = normalize(H, a), L = legal(H);
    if (n.type === "raise") return n.to === L.maxTo ? "allin" : "raise";
    if (n.type === "call" && L.toCall >= H.seats[H.toAct].stack) return "allin-call";
    return n.type;
  }
  const SKILLS = {
    open: { name: "Opening (first in)", drill: "open" },
    vsLimp: { name: "Facing limpers", drill: "open" },
    shove: { name: "Short-stack all in or fold", drill: "shove" },
    vsRaise: { name: "Facing a raise", drill: "flip" },
    allin: { name: "Calling an all-in", drill: "callshove" },
    facingBet: { name: "Facing a bet", drill: "odds" },
    betCheck: { name: "Bet or check", drill: "bluff" },
  };

  function coach(H) {
    const s = H.toAct, me = H.seats[s], sit = situation(H, s), L = legal(H), bb = H.bl.bb;
    const cls = clsOf(me.cards[0], me.cards[1]), name = PE.CLASSES[cls].name, pct = PCT[cls];
    const dead = new Set(me.cards.concat(H.board));
    const opps = H.order.filter(x => x !== s && !H.seats[x].folded);
    // preflop, players still to act behind us will mostly fold: only count those who've put chips in on purpose
    const inv = H.street === 0 ? opps.filter(x => H.seats[x].acted) : opps;
    const ranges = (inv.length ? inv : opps).map(x => { const r = clean(H.seats[x].range || ALL, dead); return r.length ? r : clean(ALL, dead); });
    const lastR = [...H.actions].reverse().find(a => a.street === H.street && a.type === "raise");
    const villain = lastR ? lastR.seat : opps[0];
    const vName = H.g.players[villain].name, vRange = clean(H.seats[villain].range || ALL, dead);
    const A = { spot: "", skill: "", accept: {}, hint: "", lines: [], villain, range: rangeWeights(vRange), rangePct: rangeShare(vRange), handName: name };
    const set = (ok, mid) => { for (const k of ok) A.accept[k] = "ok"; for (const k of (mid || [])) A.accept[k] = A.accept[k] || "mid"; };
    const potAfter = L.pot + L.toCall, need = L.toCall / potAfter;
    const S = sit.S, pos = me.pos, cash = H.g.cash;

    // calling an all-in, or a bet that puts us all in
    const allinSpot = L.toCall > 0 && (sit.facingAllin || L.toCall >= me.stack * (H.street === 0 ? 0.45 : 0.6));
    if (allinSpot) {
      A.spot = "allin"; A.skill = "allin";
      const eq = eqVsRanges(me.cards, H.board, ranges, 2500);
      // if they bet more than we have, the excess goes back to them: price the call on what's really contested
      const vp0 = H.seats[villain], excess = Math.max(0, vp0.bet - (me.bet + me.stack)), call = L.toCall;
      const contested = L.pot - excess + call;
      const needC = call / contested;
      let bar = needC, icmLine = "";
      const live = liveSeats(H.g);
      if (!cash && live.length >= 3 && opps.length === 1) {
        const stacks = f => live.map(f);
        const myBehind = me.stack, potNow = L.pot;
        const st = x => (H.seats[x] ? H.seats[x].stack : H.g.players[x].stack);
        const fold = stacks(x => x === s ? myBehind : x === villain ? st(x) + potNow : st(x));
        const win = stacks(x => x === s ? myBehind - call + contested : x === villain ? st(x) + excess : st(x));
        const lose = stacks(x => x === s ? myBehind - call : x === villain ? st(x) + potNow + call : st(x));
        const k = live.indexOf(s);
        const f$ = PE.icm(fold, PAYOUT)[k], w$ = PE.icm(win, PAYOUT)[k], l$ = PE.icm(lose, PAYOUT)[k];
        if (w$ > l$) { const icmNeed = (f$ - l$) / (w$ - l$); if (icmNeed > needC + 0.01) { icmLine = `With payouts on the line (top two paid), busting costs more than doubling gains, so <b>ICM</b> raises the bar to <b>${pc(icmNeed)}</b>.`; bar = icmNeed; } }
      }
      A.eq = eq; A.need = bar;
      const close = Math.abs(eq - bar) < 0.025;
      if (close) set(["call", "allin-call", "allin", "fold"]); else if (eq > bar) set(["call", "allin-call", "allin"]); else set(["fold"]);
      A.best = close ? "either" : eq > bar ? "call" : "fold";
      A.hint = `It costs <b>${bbs(call, bb)}</b> to win a pot of <b>${bbs(contested, bb)}</b>, so you need to win <b>${pc(needC)}</b> of the time${icmLine ? " (more, with prize money at stake)" : ""}. Now picture what ${vName} would do this with. Are you ahead of that often enough?`;
      A.lines = [`Calling needs <b>${pc(needC)}</b>: <span class="m">${bbs(call, bb)} ÷ ${bbs(contested, bb)}</span>.`];
      if (icmLine) A.lines.push(icmLine);
      A.lines.push(`${name} wins <b>${pc(eq)}</b> against everything ${vName} would play this way (${pc(A.rangePct)} of hands).`);
      A.lines.push(close ? "That's right on the line: either is fine." : eq > bar ? "You're getting the right price: <b>call</b>." : "Not enough: <b>fold</b> and wait for a better spot.");
      return A;
    }

    if (H.street === 0) {
      const raises = sit.raises;
      if (raises === 0 && L.toCall === 0) { // big blind option
        A.spot = "option"; A.skill = "open";
        set(["check"], pct < 0.1 ? ["raise"] : []); if (pct < 0.06) set(["raise"]);
        A.best = pct < 0.06 ? "raise" : "check";
        A.hint = "No one raised. You can see the flop for free.";
        A.lines = [pct < 0.06 ? `${name} is a premium hand: raise to build the pot.` : "Nobody raised, so checking sees the flop for free."];
        return A;
      }
      if (raises === 0) {
        if (S <= 12) {
          A.spot = "shove"; A.skill = "shove";
          const thr = pushRange(S, sit.behind), inR = pct < thr, close = Math.abs(pct - thr) < 0.03;
          if (close) set(["allin", "fold"]); else set([inR ? "allin" : "fold"]);
          A.best = close ? "either" : inR ? "allin" : "fold";
          A.hint = `You have <b>${S.toFixed(0)} big blinds</b>. That's too short to raise and then fold. From the ${POS_NAME[pos] || pos}, with ${sit.behind} player${sit.behind === 1 ? "" : "s"} left to act, is ${name} strong enough to put it all in?`;
          A.lines = [`At ${S.toFixed(0)} bb with ${sit.behind} left to act, the all-in range here is about the top <b>${pc(thr)}</b> of hands.`,
            `${name} is about the top <b>${pc(pct)}</b>: ${close ? "right on the edge, so either is fine" : inR ? "inside it, so go <b>all in</b>" : "outside it, so <b>fold</b>"}.`,
            "Why all in and not a small raise: at this depth a raise commits you anyway, and all in makes everyone else fold more often (<b>fold equity</b>).",
            "Ranges are approximate (heads-up maths, shrunk for each extra player behind you)."];
          return A;
        }
        if (sit.limpers) return limpSpot(H, A, sit, set, { s, me, cls, name, pct, S, pos, bb, L, ranges });
        A.spot = "open"; A.skill = "open";
        const chartPos = sit.n === 2 ? null : pos, inChart = chartPos ? OPENSET[chartPos] && OPENSET[chartPos].has(cls) : pct < 0.75;
        set(inChart ? ["raise"] : ["fold"], inChart ? ["call", S <= 25 ? "allin" : null].filter(Boolean) : []);
        A.best = inChart ? "raise" : "fold";
        const share = chartPos ? OPENPCT[chartPos] : 0.75;
        A.hint = `Everyone before you folded. From the ${POS_NAME[pos] || pos}, ${sit.behind} player${sit.behind === 1 ? "" : "s"} can still wake up with a hand behind you. Does ${name} make the cut for that seat?`;
        A.lines = [`The ${POS_NAME[pos] || pos} opens about the top <b>${pc(share)}</b> of hands. ${name} ${inChart ? "is in that range: <b>raise</b>" : "isn't: <b>fold</b>"}.`];
        if (inChart) A.lines.push(`Standard size: <span class="m">${pos === "SB" ? "3" : S < 30 ? "2.2" : "2.5"} bb</span>. Raise, don't limp (just call): raising can win the blinds right now and gives you the lead.`);
        else A.lines.push("Folding costs nothing here. Hands like this lose money from this seat over time, mostly because you'll play the pot out of position against better hands.");
        if (chartPos && chartPos !== "BTN") A.lines.push("The later your seat, the more hands you can open: fewer players behind, and you act last after the flop.");
        return A;
      }
      // facing a raise (or more)
      A.spot = raises === 1 ? "vsRaise" : "vs3bet"; A.skill = "vsRaise";
      const eq = eqVsRanges(me.cards, H.board, ranges, 2000);
      const Rz = sit.ip ? 0.85 : 0.7, ev = Rz * eq * potAfter - L.toCall, tol = 0.06 * potAfter;
      const valueRaise = raises === 1 ? (eq >= 0.56 || pct < 0.03) : (eq >= 0.55 || pct < 0.015);
      A.eq = eq;
      if (valueRaise) { set(["raise", "allin"], ["call", "allin-call"]); A.best = raises === 1 ? "3-bet" : "4-bet"; }
      else if (ev > tol && (raises === 1 || S > 35)) { set(["call"], eq > 0.48 ? ["raise"] : []); A.best = "call"; }
      else if (ev < -tol || (raises > 1 && S <= 35)) { set(["fold"]); A.best = "fold"; }
      else { set(["call", "fold"]); A.best = "either"; }
      const rp = H.seats[villain];
      A.hint = `${vName} ${raises > 1 ? "re-raised you (a <b>3-bet</b>)" : "raised"} from the ${POS_NAME[rp.pos] || rp.pos}: that's not a random hand, it's roughly the top ${pc(A.rangePct)}. How does ${name} do against <i>those</i> hands? After the flop you'll ${sit.ip ? "act after them" : "have to act first"}.`;
      A.lines = [`${name} has <b>${pc(eq)}</b> against ${vName}'s range${inv.length > 1 ? " and the other caller" + (inv.length > 2 ? "s" : "") : ""}.`,
        `Calling costs <span class="m">${bbs(L.toCall, bb)}</span> for a pot of <span class="m">${bbs(potAfter, bb)}</span>. ${sit.ip ? "In position" : "Out of position"} you only cash in about ${Math.round(Rz * 100)}% of your equity, so calling is worth about <b>${ev >= 0 ? "+" : "−"}${bbs(Math.abs(ev), bb)}</b>.`,
        valueRaise ? `You're well ahead of their range: <b>${A.best}</b> for value${S <= 25 ? " (at this stack, that means all in)" : ""}. Just calling lets them see a cheap flop.` :
          A.best === "call" ? "Good enough to <b>call</b>, not strong enough to raise." : A.best === "fold" ? "Not enough: <b>fold</b>. Raises from tight seats are stronger than they look." : "Close: calling and folding are about the same."];
      return A;
    }

    // ---- postflop ----
    const T = tier(me.cards, H.board);
    A.made = T.desc;
    if (L.toCall > 0) {
      A.spot = "facingBet"; A.skill = "facingBet";
      const eq = eqVsRanges(me.cards, H.board, ranges, 2500); A.eq = eq; A.need = need;
      const close = Math.abs(eq - need) < 0.04, raiseGood = eq >= 0.7 && opps.length === 1 && L.canRaise;
      if (raiseGood) { set(["raise", "allin"], ["call"]); A.best = "raise"; }
      else if (close) { set(["call", "fold"]); A.best = "either"; }
      else if (eq > need) { set(["call"], eq > 0.6 ? ["raise"] : []); A.best = "call"; }
      else { set(["fold"]); A.best = "fold"; }
      A.hint = `${vName} bet <b>${bbs(L.toCall, bb)}</b>. Calling wins a pot of <b>${bbs(potAfter, bb)}</b>, so you need <b>${pc(need)}</b>. You have ${T.desc}. What would ${vName} bet with on this board?`;
      A.lines = [`You need <b>${pc(need)}</b> to call: <span class="m">${bbs(L.toCall, bb)} ÷ ${bbs(potAfter, bb)}</span>.`,
        `With ${T.desc} you win <b>${pc(eq)}</b> against everything ${vName} bets here.`,
        raiseGood ? "You're way ahead of their betting range: <b>raise</b> to get more in." : close ? "Right on the line: either is fine." : eq > need ? "The price is right: <b>call</b>." : "Not enough: <b>fold</b>. A bet narrows their range toward hands that beat you."];
      if (H.street < 3 && T.draw >= 2) A.lines.push(`That equity counts ${H.street === 1 ? "both cards to come" : "the river"}, so it assumes no more betting. ${H.street === 1 ? "If they bet the turn too, a draw needs a better price." : ""}`);
      return A;
    }
    // bet or check
    A.spot = "betCheck"; A.skill = "betCheck";
    const pot = L.pot;
    if (opps.length > 1 || !H.seats[villain].range) {
      const eq = eqVsRanges(me.cards, H.board, ranges, 2000); A.eq = eq;
      const value = eq >= 0.55, close = eq > 0.45 && eq < 0.55;
      if (close) set(["check", "raise"]); else set([value ? "raise" : "check"]);
      A.best = close ? "either" : value ? "bet" : "check";
      A.hint = `${opps.length} players are still in. With this many, someone usually has something. With ${T.desc}, are you ahead of all of them?`;
      A.lines = [`You win <b>${pc(eq)}</b> against ${opps.length === 2 ? "both of them" : "all " + opps.length + " of them"} together.`, value ? "That's strong enough to <b>bet</b> for value." : close ? "Close either way." : "Not enough to bet into several players: <b>check</b>.", "Against more players, bluff less and bet only good hands."];
      return A;
    }
    // heads-up: real EV against this bot's actual responses
    const vp = H.seats[villain], st = H.g.players[villain].style;
    const sample = vRange.length > 150 ? Array.from({ length: 150 }, () => vRange[Math.floor(Math.random() * vRange.length)]) : vRange;
    const eqs = sample.map(c => eqVsRanges(me.cards, H.board, [[c]], H.street === 3 ? 1 : 24));
    const evCheck = eqs.reduce((a, e) => a + e * pot, 0) / sample.length;
    const sizes = [0.33, 0.66, 1].map(f => Math.min(me.stack, Math.max(bb, Math.round(pot * f))));
    const opt = sizes.map(B => {
      const vsit = { street: H.street, board: H.board, pos: vp.pos, n: H.n, nLive: 2, toCall: Math.min(B, vp.stack), pot: pot + B, bb, stack: vp.stack, bet: 0, curBet: B, minTo: B * 2, maxTo: vp.stack, canRaise: vp.stack > B && me.stack > B, S, raises: 1, behind: 0, facingAllin: B >= me.stack, vsPct: 0.3, ip: false, aggressor: H.prevAgg === villain, limpers: 0, salt: H.id * 131 + villain * 17 + (H.actions.length + 1) * 7 + H.g.handNo };
      let ev = 0, f = 0;
      sample.forEach((c, k) => {
        const r = policy(st, c, vsit);
        if (r.type === "fold" || r.type === "check") { ev += pot; f++; }
        else if (r.type === "call") ev += eqs[k] * (pot + 2 * Math.min(B, vp.stack)) - Math.min(B, vp.stack);
        else ev += -B; // raised: assume we let it go
      });
      return { B, ev: ev / sample.length, fold: f / sample.length };
    });
    const bestBet = opt.reduce((a, b) => (b.ev > a.ev ? b : a));
    const tol = 0.05 * pot;
    const bestEV = Math.max(evCheck, bestBet.ev);
    A.evCheck = evCheck; A.opt = opt; A.sizes = sizes;
    A.gradeBet = to => { const B = to; const o = opt.reduce((a, b) => (Math.abs(b.B - B) < Math.abs(a.B - B) ? b : a)); return o.ev >= bestEV - tol ? "ok" : o.ev >= bestEV - 2.5 * tol || bestBet.ev >= bestEV - tol ? "mid" : "no"; };
    set(evCheck >= bestEV - tol ? ["check"] : []); set(bestBet.ev >= bestEV - tol ? ["raise", "allin"] : []);
    if (!Object.keys(A.accept).length) set(["check"]);
    A.best = bestBet.ev > evCheck + tol ? "bet" : evCheck > bestBet.ev + tol ? "check" : "either";
    const fmtB = o => `${Math.round(o.B / pot * 100)}% pot`;
    A.hint = `You have ${T.desc}. If you bet, which of ${vName}'s hands call, and which fold? Do worse hands call you, or do better hands stay and worse ones leave?`;
    A.lines = [`Checking: you win about <b>${pc(evCheck / pot)}</b> of the pot as it stands (<span class="m">${bbs(evCheck, bb)}</span>).`,
      `Best bet, ${fmtB(bestBet)}: ${vName} folds <b>${pc(bestBet.fold)}</b>; you average <span class="m">${bbs(bestBet.ev, bb)}</span>.`,
      A.best === "bet" ? (bestBet.fold >= 0.6 ? (T.t >= 3 ? "They fold most hands, and you're often best when they call: <b>bet</b>." : "Most of their hands fold to a bet. Winning the pot now beats showing down a weak hand: <b>bet</b> (that's <b>fold equity</b>).") : "Worse hands call you: <b>bet for value</b>.") : A.best === "check" ? "Betting only gets called by hands that beat you, and folds out hands you already beat: <b>check</b>." : "Close: betting and checking are about the same here.",
      `${STYLE_LINE[st.tag] ? vName + " is a " + st.tag + ": " + STYLE_LINE[st.tag] + "." : ""}`].filter(Boolean);
    A.lines.push("Counts this street only, against how this player actually responds.");
    return A;
  }
  // Someone limped (called the big blind) and nobody has raised: isolation raise, over-limp, or fold.
  function limpSpot(H, A, sit, set, c) {
    const { s, me, cls, name, pct, S, pos, bb, L, ranges } = c, k = sit.limpers;
    const C = PE.CLASSES[cls], pair = C.type === "p", suited = C.type === "s";
    const limpers = H.order.filter(x => x !== s && x !== H.sbSeat && x !== H.bbSeat && !H.seats[x].folded && H.seats[x].acted && H.seats[x].bet === bb);
    const v = limpers[0], vName = H.g.players[v].name, dead = new Set(me.cards);
    let vRange = clean(H.seats[v].range || ALL, dead); if (!vRange.length) vRange = clean(ALL, dead);
    A.spot = "limpers"; A.skill = "vsLimp"; A.limpers = k;
    A.villain = v; A.range = rangeWeights(vRange); A.rangePct = rangeShare(vRange);
    const isoPos = ISOSET[pos] ? pos : "BTN", iso = ISOSET[isoPos].has(cls);
    const openPos = OPENSET[pos] ? pos : null, inOpen = openPos ? OPENSET[openPos].has(cls) : pct < 0.75;
    // plays well in a cheap multiway pot: any pair, suited aces, suited broadways, suited connectors and one-gappers 5-4 and up
    const playable = pair || (suited && (C.hi === 12 || C.lo >= 8 || (C.hi - C.lo <= 2 && C.lo >= 2)));
    const deep = S >= 30;
    const std = pos === "SB" ? 3 : S < 30 ? 2.2 : 2.5, target = (std + k) * bb;
    const who = k === 1 ? `${vName} limped` : `${k} players limped`;
    A.hint = `${who} in front of you: they just called the big blind instead of raising. Limpers usually hold medium hands they didn't want to raise. With ${name} on the ${POS_NAME[pos] || pos}, do you want to make it bigger, limp along cheaply, or let it go?`;
    A.lines = [`A <b>limp</b> means calling the big blind instead of raising. ${vName} limps with about ${pc(A.rangePct)} of hands here, and has already said "not strong enough to raise".`];
    const size = `<span class="m">${std} bb + ${k} bb = ${+(target / bb).toFixed(1)} bb</span>`;
    if (iso) {
      set(["raise"], [S <= 25 ? "allin" : null, (pair || suited) && pct > 0.05 ? "call" : null].filter(Boolean));
      A.best = "raise";
      A.gradeSize = to => (to >= target - 0.25 * bb ? "ok" : "mid");
      const eq = eqVsRanges(me.cards, [], ranges, 2000); A.eq = eq;
      A.lines.push(`${name} is strong enough to punish that: make an <b>isolation raise</b>. You win <b>${pc(eq)}</b> against ${k === 1 ? "what " + vName + " limps with" : "all the limpers' hands together"}.`,
        `Raise bigger than a normal open: the standard size plus 1 bb for every limper, so ${size}. Limpers like to call, so a small raise doesn't get rid of anyone.`,
        "The aim is a pot against one weak player, with the best hand and the lead. Just calling (an <b>over-limp</b>) lets everyone in cheaply and wastes your strong hand.");
    } else if (playable && deep) {
      set(["call"], [inOpen ? "raise" : null, suited ? "fold" : null].filter(Boolean));
      A.best = "limp behind";
      A.lines.push(pair
        ? `Small pairs love a cheap pot with lots of players: you make a set about 1 time in 8, and a set wins big pots from limpers who hit top pair. Call along: an <b>over-limp</b> (also called <b>limping behind</b>).`
        : `Suited hands like ${name} play well in big multiway pots: they make flushes and straights that win a lot. A cheap <b>over-limp</b> is fine.`,
        `Raising isn't great: ${name} isn't strong enough for an <b>isolation raise</b>, and limpers often call, so you'd play a big pot with a medium hand.`,
        "Over-limping works because it's cheap and the stacks are deep: you risk 1 bb to win a big pot when you hit (<b>implied odds</b>).");
    } else if (playable) {
      set(["fold"], ["call"]);
      A.best = "fold";
      A.lines.push(`${name} would be an <b>over-limp</b> with deep stacks, but at ${S.toFixed(0)} bb there isn't enough left behind to win when you hit (poor <b>implied odds</b>). <b>Fold</b> is best; a cheap call is not a big mistake.`);
    } else if (inOpen) {
      set(["fold"], ["raise"]);
      A.best = "fold";
      A.lines.push(`If everyone had folded, ${name} would be an open from the ${POS_NAME[pos] || pos}, but mostly because the blinds often fold (a <b>steal</b>). Now there's no steal: the limper usually calls, and ${C.type === "o" ? "offsuit hands like this are often <b>dominated</b> by the limper's A-x and K-x" : "this hand doesn't play well against several players"}.`,
        `<b>Fold</b>. Don't limp behind with it either: a weak ${C.type === "o" ? "offsuit " : ""}hand in a multiway pot makes second-best hands that lose big pots.`);
    } else {
      set(["fold"]);
      A.best = "fold";
      A.lines.push(`${name} is too weak even for a cheap limp: <b>fold</b>. Paying 1 bb every time with hands like this adds up.`);
    }
    return A;
  }
  function grade(H, A, a) {
    const k = kindOf(H, a), n = normalize(H, a);
    if (A.spot === "betCheck" && n.type === "raise" && A.gradeBet) return A.gradeBet(n.to);
    if (A.gradeSize && k === "raise" && A.accept.raise === "ok") return A.gradeSize(n.to);
    const key = k === "allin-call" && !A.accept["allin-call"] ? "call" : k;
    if (A.accept[key]) return A.accept[key];
    if (k === "allin" && A.accept.raise && A.spot !== "shove" && A.spot !== "open" && A.spot !== "limpers") return "mid";
    return "no";
  }

  return { PCT, OPEN, OPENSET, OPENPCT, ISO, ISOSET, POS_NAME, BOTS, STYLE_LINE, SKILLS, LEVELS, HPL, PAYOUT, CASH_BUYIN, tier, newGame, newHand, legal, normalize, act, botAction, situation, policy, coach, grade, potTotal, blindsFor, liveSeats, eqVsRanges, kindOf, seeded, clsOf };
});
