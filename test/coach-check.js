// npm test (part 3): the coach sync layer and the review tool.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { execFileSync } = require("child_process");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");

// coach.js tags every record with the app version; it must match the service worker's cache name.
const app = (read("coach.js").match(/const APP = "([^"]+)"/) || [])[1], sw = (read("sw.js").match(/const VERSION = "([^"]+)"/) || [])[1];
ok(app && app === sw, `coach.js APP (${app}) matches sw.js VERSION (${sw})`);
ok(/"coach\.js"/.test(read("sw.js")), "sw.js caches coach.js");
ok(/<script src="coach\.js"><\/script>\s*<script src="app\.js">/.test(read("index.html")), "index.html loads coach.js before app.js");
ok(/origin !== self\.location\.origin/.test(read("sw.js")), "service worker never caches GitHub API calls");
ok(!/felt-data\/log|"type":"decision"/.test(read("README.md")), "no synced data in the public repo's README");

// review.js on a tiny fixture: one decision, one drill estimate, one flag with a note.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "felt-review-"));
fs.mkdirSync(path.join(dir, "log/2026-11"), { recursive: true });
const t = new Date().toISOString(), base = { v: 1, app, t, sid: "s1" };
fs.writeFileSync(path.join(dir, "log/2026-11/a.json"), JSON.stringify([
  { ...base, type: "decision", id: "d1", handNo: 3, mode: "cash", try: 1, street: "preflop", spot: "vsRaise", skill: "vsRaise", pos: "BB", cards: "K♠ J♦", board: "", bb: 2, pot: 8, toCall: 3, effBB: 100, did: "fold", best: "call", grade: "no", eq: 0.58, guess: false, ms: 1800, why: ["Call."] },
  { ...base, type: "drill", id: "r1", drill: "flip", title: "Matchups", grade: "no", ok: false, guess: true, ms: 4000, q: "How often does A win?", why: [], log: { guess: 0.5, truth: 0.63 } },
  { ...base, type: "flag", id: "f1", ref: "d1", label: "Hand 3", note: "why call?" },
  { ...base, type: "decision", id: "d2", handNo: 4, mode: "cash", try: 1, street: "preflop", spot: "limpers", skill: "vsLimp", limpers: 2, pos: "BTN", cards: "K♥ 9♦", board: "", bb: 2, pot: 7, toCall: 2, effBB: 100, villain: { name: "June", style: "calling station", rangePct: 0.4 }, did: "call", best: "fold", grade: "no", guess: false, ms: 2500, why: ["Fold."] },
]));
let outp = "";
try { outp = execFileSync("node", [path.join(root, "tools/review.js"), dir], { encoding: "utf8" }); } catch (e) { outp = String(e.stdout || e); }
ok(/2 table decisions · 1 drill answers/.test(outp), "review counts records");
ok(/Facing limpers: table 0% of 1/.test(outp), "review lists the facing-limpers skill");
ok(/2 limpers in front, 2 to call into 7, 100 bb deep vs June/.test(outp), "review describes a limpers spot");
ok(/Sure and wrong \(2\)/.test(outp), "review lists sure-and-wrong");
ok(/Kai: "why call\?"/.test(outp), "review shows flag notes");
ok(/off by 13 pts/.test(outp), "review averages estimate error");
ok(/Autopilot: 2 quick/.test(outp), "review spots quick mistakes");
fs.rmSync(dir, { recursive: true, force: true });

console.log(`coach: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
