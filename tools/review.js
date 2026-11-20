// Coaching-session report. Reads everything Felt has synced to the felt-data repo and prints
// what a coach needs: volume, accuracy vs before, leaks, sure-but-wrong, autopilot mistakes,
// drill vs table transfer, results, flagged hands and progress on the current plan.
//
//   node tools/review.js ../felt-data            (since the current plan started)
//   node tools/review.js ../felt-data --days 7
//   node tools/review.js ../felt-data --since 2026-11-18
"use strict";
const fs = require("fs"), path = require("path");
const T = require("../table.js");

const args = process.argv.slice(2);
const dir = path.resolve(args.find(a => !a.startsWith("--") && !/^\d/.test(a)) || "../felt-data");
const opt = k => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : null; };
const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return null; } };

// ---- load ----
const files = [];
(function walk(d) { if (!fs.existsSync(d)) return; for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : f.endsWith(".json") && files.push(p); } })(path.join(dir, "log"));
const byId = new Map();
for (const f of files) for (const r of readJSON(f) || []) if (r && r.id) byId.set(r.id, r);
const all = [...byId.values()].sort((a, b) => a.t < b.t ? -1 : 1);
const plan = readJSON(path.join(dir, "coach/plan.json"));
const replies = readJSON(path.join(dir, "coach/replies.json")) || {};

const DAY = 864e5;
const since = opt("since") ? Date.parse(opt("since")) : opt("days") ? Date.now() - +opt("days") * DAY : plan && plan.since ? Date.parse(plan.since) : 0;
const span = Math.max(DAY, Date.now() - since);
const inWin = (r, a, b) => { const t = Date.parse(r.t); return t >= a && t < b; };
const cur = all.filter(r => inWin(r, since, Infinity));
const prev = since ? all.filter(r => inWin(r, since - span, since)) : [];

const pct = (a, n) => (n ? Math.round(100 * a / n) + "%" : "–");
const MIN = 15, early = n => (n < MIN ? " (too early to tell)" : "");
const firsts = rs => rs.filter(r => r.type === "decision" && r.try === 1);
const drills = rs => rs.filter(r => r.type === "drill");
const right = r => r.type === "decision" ? r.grade !== "no" : r.ok;
const secs = ms => (ms / 1000).toFixed(1) + "s";
const out = [];
const H = s => out.push("", "## " + s);
const L = s => out.push(s);

const describe = r => {
  const first = r.type === "decision" && (r.spot === "open" || r.spot === "shove" || r.spot === "option");
  const limped = r.type === "decision" && r.spot === "limpers";
  if (r.type === "decision") return `#${r.handNo} ${r.mode} ${r.pos} ${r.cards} | ${r.street}${r.board ? " " + r.board : ""}${r.made ? " (" + r.made + ")" : ""} | ${first ? (r.spot === "option" ? "limped to you" : "folded to you") : limped ? `${r.limpers || "?"} limper${r.limpers === 1 ? "" : "s"} in front, ${r.toCall} to call into ${r.pot}` : r.toCall ? `${r.toCall} to call into ${r.pot}` : `pot ${r.pot}`}, ${r.effBB} bb deep${r.villain && !first ? ` vs ${r.villain.name} (${r.villain.style}, ${Math.round((r.villain.rangePct || 0) * 100)}% range)` : ""} | did ${r.did} (${r.guess ? "guessing" : "sure"}, ${secs(r.ms)}) | coach: ${r.best}${r.eq != null ? `, eq ${Math.round(r.eq * 100)}%` : ""}${r.need != null ? ` need ${Math.round(r.need * 100)}%` : ""}`;
  if (r.type === "drill") return `${r.title}: ${r.q} | ${r.ok ? "right" : r.grade} (${r.guess ? "guessing" : "sure"}, ${secs(r.ms)})${r.log ? " | " + JSON.stringify(r.log) : ""}`;
  if (r.type === "hand") { const me = r.seats.find(s => s.seat === 0); return `hand #${r.no} ${r.mode} ${me ? me.pos + " " + me.cards : ""} board ${r.board || "-"} net ${r.net} bb`; }
  return r.type;
};

// ---- report ----
L(`# Felt review · ${since ? "since " + new Date(since).toISOString().slice(0, 10) : "all time"} · ${all.length} records total`);
if (!all.length) { L("", "No data synced yet. Check Felt → Coach sync on the phone."); console.log(out.join("\n")); process.exit(0); }

H("Volume");
const hands = cur.filter(r => r.type === "hand" && r.net != null), F = firsts(cur), D = drills(cur);
const days = new Set(cur.map(r => r.t.slice(0, 10))).size, sess = new Set(cur.map(r => r.sid)).size;
L(`${days} days, ${sess} sessions · ${hands.length} hands (${hands.filter(h => h.mode === "cash").length} cash, ${hands.filter(h => h.mode === "tourney").length} tournament) · ${F.length} table decisions · ${D.length} drill answers`);
const pf = firsts(prev), pd = drills(prev);
L(`Table, right first try: ${pct(F.filter(right).length, F.length)}${pf.length ? ` (before: ${pct(pf.filter(right).length, pf.length)} of ${pf.length})` : ""}${early(F.length)}`);
L(`Drills, right: ${pct(D.filter(right).length, D.length)}${pd.length ? ` (before: ${pct(pd.filter(right).length, pd.length)} of ${pd.length})` : ""}`);

H("Table skills (first tries) next to their drill");
for (const [k, v] of Object.entries(T.SKILLS)) {
  const f = F.filter(r => r.skill === k), d = D.filter(r => r.drill === v.drill);
  if (!f.length && !d.length) continue;
  L(`- ${v.name}: table ${pct(f.filter(right).length, f.length)} of ${f.length}${early(f.length)} · drill "${v.drill}" ${pct(d.filter(right).length, d.length)} of ${d.length}${f.length >= MIN && d.length >= MIN && d.filter(right).length / d.length - f.filter(right).length / f.length > 0.2 ? "  ← knows it in the drill, not using it at the table" : ""}`);
}

H("Drills");
const dIds = [...new Set(D.map(r => r.drill))];
for (const id of dIds) {
  const d = D.filter(r => r.drill === id), est = d.filter(r => r.log && r.log.guess != null && r.log.truth != null);
  L(`- ${d[0].title}: ${pct(d.filter(right).length, d.length)} of ${d.length}${est.length ? ` · estimates off by ${Math.round(100 * est.reduce((a, r) => a + Math.abs(r.log.guess - r.log.truth), 0) / est.length)} pts on average` : ""}`);
}

H("Sure vs guessing (table + drills)");
const both = [...F, ...D], sure = both.filter(r => !r.guess), gu = both.filter(r => r.guess);
L(`Sure: ${pct(sure.filter(right).length, sure.length)} right of ${sure.length} · Guessing: ${pct(gu.filter(right).length, gu.length)} right of ${gu.length}`);
const sw = sure.filter(r => !right(r));
L(`Sure and wrong (${sw.length}): wrong beliefs, fix these first`);
sw.slice(-10).forEach(r => L("  - " + describe(r)));
const rg = gu.filter(right);
if (rg.length) L(`Guessing but right: ${rg.length} (knows it, doesn't trust it yet)`);

H("Leaks (wrong first tries, grouped)");
const groups = {};
for (const r of F) { const k = `${T.SKILLS[r.skill] ? T.SKILLS[r.skill].name : r.skill} · ${r.street} · ${r.pos}`; (groups[k] = groups[k] || []).push(r); }
Object.entries(groups).map(([k, rs]) => ({ k, rs, wrong: rs.filter(r => !right(r)) })).filter(g => g.wrong.length)
  .sort((a, b) => b.wrong.length - a.wrong.length).slice(0, 8)
  .forEach(g => { L(`- ${g.k}: ${g.wrong.length} wrong of ${g.rs.length}${early(g.rs.length)}`); g.wrong.slice(-2).forEach(r => L("    " + describe(r))); });
const ap = both.filter(r => !right(r) && r.ms < 3000);
H(`Autopilot: ${ap.length} quick mistakes (under 3s)`);
ap.slice(-6).forEach(r => L("  - " + describe(r)));

H("Results");
const cash = hands.filter(h => h.mode === "cash"), net = cash.reduce((a, h) => a + h.net, 0);
if (cash.length) L(`Cash: ${net >= 0 ? "+" : ""}${net.toFixed(1)} bb over ${cash.length} hands (${(100 * net / cash.length).toFixed(1)} bb/100; needs 1,000+ hands to mean much)`);
cur.filter(r => r.type === "game").forEach(g => L(`Tournament: finished ${g.place} of 6 after ${g.hands} hands, ${g.right}/${g.n} decisions right`));

H("Flagged");
const flags = new Map();
for (const r of all) { if (r.type === "flag") flags.set(r.ref, r); if (r.type === "unflag") flags.delete(r.ref); }
if (!flags.size) L("None.");
for (const [ref, f] of flags) {
  const target = byId.get(ref);
  L(`- [${ref}] ${f.label}${replies[ref] ? "  (already replied)" : ""}`);
  if (f.note) L(`    Kai: "${f.note}"`);
  if (target) { L("    " + describe(target)); if (target.why) L("    coach said: " + target.why.join(" ")); }
  if (target && target.type === "hand") target.actions.forEach(a => L(`      ${["pre", "flop", "turn", "river"][a.street]} ${target.seats.find(s => s.seat === a.seat).pos}${a.seat === 0 ? " (Kai)" : ""} ${a.type}${a.to ? " " + a.to : ""}`));
}

if (plan && plan.tasks) {
  H(`Plan: ${plan.title}`);
  for (const t of plan.tasks) {
    if (t.kind === "drill" && t.goal === "solid") { const d = all.filter(r => r.type === "drill" && r.drill === t.key).slice(-20); L(`- ${t.text}: ${d.filter(right).length} of last ${d.length} right${d.length >= 20 && d.filter(right).length >= 18 ? " ✓ solid" : ""}`); continue; }
    const rs = cur.filter(r => t.kind === "hands" ? r.type === "hand" && r.net != null && (!t.key || t.key === "any" || r.mode === t.key) : t.kind === "skill" ? r.type === "decision" && r.try === 1 && r.skill === t.key : r.type === "drill" && r.drill === t.key);
    L(`- ${t.text}: ${rs.length} / ${t.n || "?"}${t.kind !== "hands" ? `, ${rs.filter(right).length} right` : ""}`);
  }
}
console.log(out.join("\n"));
