// npm test (part 2): the coached table. Simulates thousands of bot-only hands and checks
// the invariants that a hand engine tends to break.
"use strict";
const PE = require("../engine.js"), T = require("../table.js");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; if (fail < 25) console.log("FAIL:", m); } };
const P = s => PE.parseCards(s);

// --- hand reading ---
const tierOf = (h, b) => T.tier(P(h), P(b));
ok(tierOf("Ah Kd", "As 7c 2d").t === 4, "top pair good kicker = 4");
ok(tierOf("Ah 4d", "As 7c 2d").t === 3, "top pair weak kicker = 3");
ok(tierOf("7h 7d", "As 7c 2d").t === 5, "set = 5");
ok(tierOf("Qh Qd", "Js 7c 2d").t === 4, "overpair = 4");
ok(tierOf("Ah 9h", "Kh 7h 2d").draw === 2, "flush draw");
ok(tierOf("9c 8d", "7h 6s 2d").draw === 2, "open-ended straight draw");
ok(tierOf("9c 5d", "7h 6s 2d").draw === 1, "gutshot");
ok(tierOf("Ah 9h", "Kh 7h 2h").t === 5, "made flush = 5");
ok(tierOf("2c 3d", "As Ks Qs Js Ts").desc === "the board plays", "board plays");
ok(tierOf("9h 8h", "Th 7h 2c").t === 3 && tierOf("9h 8h", "Th 7h 2c").draw === 3, "combo draw = 3");

// --- simulated games ---
function sim(mode, seed, maxHands) {
  const g = T.newGame(mode, seed);
  g.players[0].style = T.BOTS[1]; // let a bot play the hero seat
  const total0 = g.players.reduce((a, p) => a + p.stack, 0);
  let hands = 0, coached = 0;
  for (; hands < maxHands; hands++) {
    if (mode === "cash" && g.players[0].stack === 0) { g.players[0].stack = T.CASH_BUYIN; g.buyins++; }
    const before = g.players.reduce((a, p) => a + p.stack, 0);
    const H = T.newHand(g); if (!H) break;
    const afterTopUp = before + 0; // bots top up inside newHand
    const start = H.order.reduce((a, s) => a + H.startStacks[s], 0);
    let steps = 0;
    while (!H.over && steps++ < 300) {
      const s = H.toAct, L = T.legal(H);
      ok(L.toCall >= 0 && L.maxTo >= L.minTo || !L.canRaise, "legal sizes sane");
      if (s === 0 && coached < 40 && seed % 2 === 0) { const A = T.coach(H); ok(A && A.spot && Object.keys(A.accept).length > 0, "coach answers " + (A && A.spot)); coached++; }
      const a = T.botAction(H);
      T.act(H, a);
      const p = H.seats[s];
      if (p.range) ok(p.range.some(c => (c[0] === p.cards[0] && c[1] === p.cards[1]) || (c[0] === p.cards[1] && c[1] === p.cards[0])), `bot's real hand stays in its tracked range (hand ${H.id}, ${a.type})`);
      for (const x of H.order) ok(H.seats[x].stack >= 0, "no negative stack");
    }
    ok(H.over, "hand finishes");
    const end = H.order.reduce((a, s) => a + g.players[s].stack, 0);
    ok(end === start, `chips conserved in hand ${H.id}: ${start} -> ${end}`);
    if (g.over) break;
  }
  return { g, hands, total0 };
}
let tourneys = 0, cashHands = 0;
for (let seed = 1; seed <= 30; seed++) {
  const { g, hands } = sim("tourney", seed, 400);
  ok(g.over, "tournament ends (seed " + seed + ", " + hands + " hands)");
  const places = Object.values(g.places).sort((a, b) => a - b);
  const want = Array.from({ length: places.length }, (_, k) => 7 - places.length + k).join();
  ok(places.join() === want && (g.players[0].stack === 0 || places.length === 6), "places assigned bottom-up: " + places.join());
  tourneys++;
}
for (let seed = 101; seed <= 104; seed++) { cashHands += sim("cash", seed, 500).hands; }

// --- side pots: three all-ins of different sizes ---
{
  const g = T.newGame("tourney", 7);
  [0, 1, 2, 3, 4, 5].forEach(s => (g.players[s].stack = 0));
  g.players[0].stack = 50; g.players[1].stack = 100; g.players[2].stack = 200; g.btn = 2;
  const H = T.newHand(g); // btn moves to seat 0
  H.seats[0].cards = P("Ah Ad"); H.seats[1].cards = P("Kh Kd"); H.seats[2].cards = P("Qh Qd");
  H.deck = H.deck.filter(c => ![...H.seats[0].cards, ...H.seats[1].cards, ...H.seats[2].cards].includes(c));
  while (!H.over) T.act(H, { type: "allin" });
  const w = H.result.wins, sc = H.result.scores, tot = Object.values(w).reduce((a, b) => a + b, 0);
  ok(tot === 250 && g.players[2].stack === (w[2] || 0) + 100, "pots pay 250, and QQ's uncalled 100 goes back to its stack: " + JSON.stringify(w));
  const best3 = Math.max(sc[0], sc[1], sc[2]), best2 = Math.max(sc[1], sc[2]);
  const main = {}, side = {};
  [0, 1, 2].filter(x => sc[x] === best3).forEach((x, _, arr) => main[x] = 150 / arr.length);
  [1, 2].filter(x => sc[x] === best2).forEach((x, _, arr) => side[x] = 100 / arr.length);
  const want = x => Math.floor((main[x] || 0) + (side[x] || 0)) ;
  ok([0, 1, 2].every(x => Math.abs((w[x] || 0) - want(x)) <= 1), `side pots split right: got ${JSON.stringify(w)}`);
}

// --- coach sanity on hand-picked spots ---
function spotOpen(cards, pos) {
  for (let seed = 1; seed < 400; seed++) {
    const g = T.newGame("cash", seed); const H = T.newHand(g);
    if (H.toAct !== 0 || H.seats[0].pos !== pos) continue;
    H.seats[0].cards = P(cards);
    return T.coach(H);
  }
}
const aa = spotOpen("Ah Ad", "UTG"), junk = spotOpen("7h 2d", "UTG");
ok(aa && aa.accept.raise === "ok" && !aa.accept.fold, "AA under the gun: raise");
ok(junk && junk.accept.fold === "ok" && !junk.accept.raise, "72o under the gun: fold");

// --- limpers: some bot styles open-limp, and the coach grades the spot ---
{
  const first = {}, limps = {};
  for (let seed = 201; seed <= 260; seed++) {
    const g = T.newGame("cash", seed); g.players[0].style = T.BOTS[1];
    for (let n = 0; n < 60; n++) {
      const H = T.newHand(g); if (!H) break; let steps = 0;
      while (!H.over && steps++ < 300) {
        const s = H.toAct, sit = T.situation(H, s), a = T.botAction(H), st = g.players[s].style;
        if (s && H.street === 0 && sit.raises === 0 && sit.toCall > 0 && sit.S > 12 && a.type !== "fold") {
          first[st.tag] = (first[st.tag] || 0) + 1; if (a.type === "call") limps[st.tag] = (limps[st.tag] || 0) + 1;
        }
        T.act(H, a);
      }
    }
  }
  const rate = t => (limps[t] || 0) / (first[t] || 1);
  ok(!limps.TAG && !limps.nit, "TAGs and nits never limp: " + JSON.stringify(limps));
  ok(rate("calling station") > 0.4 && rate("calling station") < 0.8, "the calling station limps most hands she plays: " + rate("calling station").toFixed(2));
  ok(rate("LAG") > 0.03 && rate("LAG") < 0.2, "LAGs limp now and then: " + rate("LAG").toFixed(2));
}
// Hero on `pos` with `k` limpers in front (everyone else before the hero folds).
function spotLimp(cards, pos, k, mode) {
  for (let seed = 1; seed < 2000; seed++) {
    const g = T.newGame(mode || "cash", seed); const H = T.newHand(g);
    if (H.n !== 6 || H.seats[0].pos !== pos) continue;
    let limped = 0;
    while (H.toAct !== 0) { const p = H.seats[H.toAct]; T.act(H, limped < k && p.pos !== "SB" ? (limped++, { type: "call" }) : { type: "fold" }); }
    if (limped !== k) continue;
    H.seats[0].cards = P(cards);
    return { H, A: T.coach(H) };
  }
}
{
  const bb = 2, gr = (x, a) => T.grade(x.H, x.A, a);
  const aa = spotLimp("Ah Ad", "BTN", 2), sp = aa.A;
  ok(sp.spot === "limpers" && sp.skill === "vsLimp" && T.SKILLS.vsLimp, "two limpers in front: the limpers spot, own skill");
  ok(sp.accept.raise === "ok" && !sp.accept.call && sp.best === "raise", "AA behind limpers: isolation raise, never limp");
  ok(gr(aa, { type: "raise", to: 4.5 * bb }) === "ok", "AA: raise to 2.5 bb + 1 per limper = 4.5 bb is right");
  ok(gr(aa, { type: "raise", to: 2.5 * bb }) === "mid", "AA: a normal 2.5 bb open over two limpers is too small");
  ok(gr(aa, { type: "call" }) === "no" && gr(aa, { type: "allin" }) === "no", "AA: over-limping or shoving 100 bb is wrong");
  ok(sp.villain != null && sp.rangePct > 0 && sp.rangePct < 1 && sp.lines.some(l => /isolation raise/.test(l)), "explains the isolation raise against the limper's range");
  const p44 = spotLimp("4h 4d", "BTN", 1).A;
  ok(p44.accept.call === "ok" && p44.accept.raise === "mid" && !p44.accept.fold && p44.best === "limp behind", "44 behind a limper: over-limp ok, raise mid, fold wrong");
  ok(p44.lines.some(l => /over-limp/.test(l)), "44: says over-limp");
  const s76 = spotLimp("7h 6h", "CO", 1).A;
  ok(s76.accept.call === "ok" && s76.accept.fold === "mid", "76s behind a limper: over-limp ok, fold mid");
  const k9 = spotLimp("Kh 9d", "BTN", 1), k9A = k9.A;
  ok(T.OPENSET.BTN.has(PE.CLASSES.findIndex(c => c.name === "K9o")), "K9o is a button open when folded to");
  ok(k9A.accept.fold === "ok" && !k9A.accept.call && k9A.best === "fold" && gr(k9, { type: "call" }) === "no", "K9o behind a limper: fold, the steal is gone");
  const junk = spotLimp("7h 2d", "BTN", 1).A;
  ok(junk.accept.fold === "ok" && Object.keys(junk.accept).length === 1, "72o behind a limper: fold only");
  const sb = spotLimp("Qh Qd", "SB", 1).A;
  ok(sb.spot === "limpers" && sb.accept.raise === "ok", "QQ in the small blind behind a limper: raise");
  const open = spotLimp("Ah Ad", "BTN", 0).A;
  ok(open.spot === "open", "folded to you on the button is still the open spot");
}

console.log(`table: ${tourneys} tournaments + ${cashHands} cash hands simulated`);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
