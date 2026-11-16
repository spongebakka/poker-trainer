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

console.log(`table: ${tourneys} tournaments + ${cashHands} cash hands simulated`);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
