// npm test — checks the engines against known poker facts.
"use strict";
const PE = require("../engine.js"), D = require("../data.js");
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log("FAIL:", msg); } };
const ev = s => PE.evaluate(PE.parseCards(s));
const beats = (a, b, msg) => ok(ev(a) > ev(b), msg || `${a} > ${b}`);
const ties = (a, b) => ok(ev(a) === ev(b), `${a} == ${b}`);

// hand ranking order
const ladder = ["As Ks Qs Js Ts 2c 3d", "9h 9d 9c 9s 2h 3d 5c", "Kh Kd Kc 7s 7h 2d 3c", "Ah Kh 2h 7h 9h 9d 9c",
  "5h 6d 7c 8s 9h Kd 2c", "Qh Qd Qc 7s 4h 2d 3c", "Jh Jd 4c 4s 9h 2d 3c", "Th Td 4c 8s 9h 2d 3c", "Ah Jd 4c 8s 9h 2d 3c"];
for (let i = 0; i + 1 < ladder.length; i++) beats(ladder[i], ladder[i + 1]);
ok(PE.describe(ev(ladder[0])) === "Royal flush", "royal named");
beats("6h 2d 3c 4s 5h Kd Kc", "Ah 2d 3c 4s 5h Kd Kc", "6-high straight beats the wheel");
beats("Ah 2d 3c 4s 5h Kd Qc", "Kh Kd Kc 9s 8h 2d 3c", "wheel beats trips");
beats("As Kd 9c 9s 4h 4d 2c", "Qs Jd 9c 9s 4h 4d 2c", "two pair kicker");
ties("As Kd Qc Jh Th 2c 3d", "Ad Kc Qh Js Ts 4c 5d");
ties("2c 3d 9h 9d 9c 9s Ah", "4c 5d 9h 9d 9c 9s Ah"); // board plays quads with ace
beats("Kh Kd Kc Qs Qh Qd 2c", "Kh Kd Kc Js Jh 2d 3c", "full house picks higher pair from second trips");
ok(PE.category(ev("Ah 2h 3h 4h 5h 6h 7h")) === 8, "7-card straight flush");
ok(PE.describe(ev("Ah 2h 3h 4h 5h Kd Kc")) === "Five-high straight flush", "steel wheel");
ok(PE.bestFive(PE.parseCards("As Ks 2d 3c Qs Js Ts")).cards.length === 5, "bestFive returns five");

// classes + ranges
ok(PE.CLASSES.length === 169 && PE.CLASSES.reduce((n, c) => n + c.combos.length, 0) === 1326, "169 classes, 1326 combos");
ok(Math.abs(PE.rangePct(PE.parseRange("22+")) - 6 * 13 / 1326 * 100) < 1e-9, "pairs = 5.9%");
ok(PE.parseRange("K9s-K7s").size === 3, "dash range");

// equity matrix against well-known matchups (published values ±1.5%)
const eq = (a, b) => D.eq[PE.NAME_TO_CLASS[a] * 169 + PE.NAME_TO_CLASS[b]] / 10;
const near = (a, b, want, tol = 1.5) => ok(Math.abs(eq(a, b) - want) <= tol, `${a} vs ${b}: ${eq(a, b)} (want ~${want})`);
near("AA", "KK", 82); near("AKo", "22", 47); near("AKs", "QQ", 46); near("AKo", "AQo", 74);
near("KK", "AKo", 70); near("JTs", "AKo", 40); near("22", "T9s", 47); near("AA", "72o", 88);
for (let i = 0; i < 169; i += 7) for (let j = 0; j < 169; j += 11) ok(Math.abs(D.eq[i * 169 + j] + D.eq[j * 169 + i] - 1000) <= 1, "equity symmetric");

// direct Monte Carlo agrees with the matrix
const mc = PE.equityMC([PE.parseCards("Ah Kd"), PE.parseCards("7c 7s")], [], 40000)[0] * 100;
ok(Math.abs(mc - eq("AKo", "77")) < 2, `MC AKo vs 77 ${mc.toFixed(1)} ~ matrix ${eq("AKo", "77")}`);
// exhaustive turn->river: 9-out flush draw vs set, known 9/44? no: compute exactly and compare to counting
const r = PE.equityMC([PE.parseCards("Ah Kh"), PE.parseCards("9c 9d")], PE.parseCards("9h 4h 2c Js"), 0);
ok(r.length === 2 && r[0] > 0 && r[0] < 0.25, "exhaustive river enumeration runs");

// Nash push/fold sanity (heads-up, chip-EV): shoves get tighter as stacks deepen
const id = n => PE.NAME_TO_CLASS[n];
const pushPct = S => D.nash.push[S].split("").reduce((s, ch, i) => s + (+ch / 9) * PE.comboCount(i), 0) / 13.26;
ok(pushPct(5) > pushPct(10) && pushPct(10) > pushPct(15) && pushPct(15) > pushPct(20), "push range shrinks with stack");
ok(Math.abs(pushPct(10) - 58) < 5, `SB shoves ~58% at 10bb (got ${pushPct(10).toFixed(0)})`);
for (const S of D.nash.stacks) { ok(D.nash.push[S][id("AA")] === "9", "AA always shoves " + S); ok(D.nash.call[S][id("AA")] === "9", "AA always calls " + S); }
ok(D.nash.push[15][id("72o")] === "0", "72o folds at 15bb");
ok(D.nash.push[10][id("K2o")] === "9", "K2o shoves at 10bb");

// ICM
const e = PE.icm([5000, 5000, 5000, 5000], [50, 30, 20]);
ok(e.every(x => Math.abs(x - 25) < 1e-9), "equal stacks = equal shares");
const e2 = PE.icm([12100, 2000, 4400, 1500], [50, 30, 20]);
ok(Math.abs(e2.reduce((a, b) => a + b, 0) - 100) < 1e-9, "ICM sums to prize pool");
ok(e2[0] / 100 < 12100 / 20000 && e2[3] / 100 > 1500 / 20000, "big stack < chip%, short stack > chip%");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
