// Felt ↔ coach: logs every decision, drill answer and flag, and syncs them to Kai's PRIVATE
// felt-data repo on GitHub. Pulls the coach's plan and replies back. Spec: docs/COACHING.md.
// Works offline: records wait in an outbox in localStorage and upload when there's signal.
(function () {
  "use strict";
  const APP = "felt-11"; // keep equal to VERSION in sw.js (npm test checks)
  const SCHEMA = 1, REPO = "spongebakka/felt-data", API = "https://api.github.com/repos/" + REPO;
  const KEY = "felt_coach_v1";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const S = load();
  S.dev = S.dev || Math.random().toString(36).slice(2, 8);
  S.seq = S.seq || 0;
  S.outbox = S.outbox || [];   // records not uploaded yet
  S.hist = S.hist || [];       // compact [time, key, ok] for plan progress, kept locally
  S.flags = S.flags || {};     // ref -> {label, note, t}
  S.coach = S.coach || { plan: null, replies: {}, fetched: null };
  S.sync = S.sync || { token: null, last: null, err: null };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
  const sid = S.dev + "-" + Date.now().toString(36);
  const listeners = [];
  const changed = () => listeners.forEach(f => { try { f(); } catch (e) {} });

  const newId = () => S.dev + "-" + (++S.seq).toString(36);
  function rec(type, data, id) {
    const r = Object.assign({ v: SCHEMA, app: APP, type, id: id || newId(), t: new Date().toISOString(), sid }, data);
    S.outbox.push(r);
    if (S.outbox.length > 20000) S.outbox.splice(0, S.outbox.length - 20000);
    save(); soon();
    return r.id;
  }
  function tally(key, ok) {
    S.hist.push([Date.now(), key, ok ? 1 : 0]);
    if (S.hist.length > 5000) S.hist.splice(0, S.hist.length - 5000);
    save();
  }
  const plain = html => String(html == null ? "" : html).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").replace(/ ([.,!?;:%)])/g, "$1").replace(/\( /g, "(").trim();

  // ---- flags ----
  function flag(ref, label) { if (!S.flags[ref]) { S.flags[ref] = { label, note: "", t: Date.now() }; rec("flag", { ref, label, note: "" }); changed(); } }
  function note(ref, text) { const f = S.flags[ref]; if (!f) return; f.note = text; rec("flag", { ref, label: f.label, note: text }); changed(); }
  function unflag(ref) { if (!S.flags[ref]) return; delete S.flags[ref]; rec("unflag", { ref }); changed(); }

  // ---- plan progress (counted from what was played since the plan started) ----
  function progress(task, since) {
    const t0 = since ? Date.parse(since) : 0;
    let n = 0, right = 0;
    for (const [t, key, ok] of S.hist) {
      if (t < t0) continue;
      const hit = task.kind === "hands"
        ? key.startsWith("hand:") && (!task.key || task.key === "any" || key === "hand:" + task.key)
        : key === task.kind + ":" + task.key;
      if (hit) { n++; right += ok; }
    }
    return { n, right };
  }

  // ---- sync ----
  const b64 = s => { const by = new TextEncoder().encode(s); let bin = ""; for (let i = 0; i < by.length; i += 0x8000) bin += String.fromCharCode.apply(null, by.subarray(i, i + 0x8000)); return btoa(bin); };
  const hdr = () => ({ Authorization: "Bearer " + S.sync.token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });
  let busy = false, timer = null;
  function soon(ms) { if (!S.sync.token) return; clearTimeout(timer); timer = setTimeout(syncNow, ms == null ? 15000 : ms); }
  async function upload() {
    while (S.outbox.length) {
      const batch = S.outbox.slice(0, 400), now = new Date().toISOString();
      const path = `log/${now.slice(0, 7)}/${now.replace(/[:.]/g, "-")}-${S.dev}.json`;
      const r = await fetch(`${API}/contents/${path}`, { method: "PUT", headers: hdr(), cache: "no-store",
        body: JSON.stringify({ message: `Felt: ${batch.length} records`, content: b64(JSON.stringify(batch)) }) });
      if (!r.ok) throw new Error(r.status === 401 ? "The key was refused. Make a new one?" : r.status === 404 ? "Can't see felt-data. Does the key include that repo, with Contents: read and write?" : "Upload failed (" + r.status + ")");
      const ids = new Set(batch.map(x => x.id));
      S.outbox = S.outbox.filter(x => !ids.has(x.id)); save();
    }
  }
  async function getJSON(path) {
    const r = await fetch(`${API}/contents/${path}?t=${Date.now()}`, { headers: Object.assign(hdr(), { Accept: "application/vnd.github.raw+json" }), cache: "no-store" });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("Couldn't read " + path + " (" + r.status + ")");
    return r.json();
  }
  async function pull() {
    const [plan, replies] = await Promise.all([getJSON("coach/plan.json"), getJSON("coach/replies.json")]);
    S.coach = { plan: plan || null, replies: replies || {}, fetched: Date.now() }; save();
  }
  async function syncNow() {
    if (!S.sync.token || busy) return false;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
    busy = true; clearTimeout(timer);
    try { await upload(); await pull(); S.sync.last = Date.now(); S.sync.err = null; }
    catch (e) { S.sync.err = String(e.message || e); if (S.outbox.length) soon(120000); }
    finally { busy = false; save(); changed(); }
    return !S.sync.err;
  }
  async function connect(token) {
    token = String(token || "").trim();
    if (!token) return "Paste the key first.";
    let r;
    try { r = await fetch(API, { headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" }, cache: "no-store" }); }
    catch (e) { return "No connection. Try again with signal."; }
    if (r.status === 401) return "GitHub didn't accept that key. Check you copied all of it.";
    if (!r.ok) return "That key can't see felt-data. When you make it, pick only that repository.";
    const j = await r.json();
    if (!j.private) return "felt-data isn't private. Stop and ask your coach before syncing.";
    S.sync.token = token; S.sync.err = null; save();
    await syncNow();
    return null;
  }
  function disconnect() { S.sync = { token: null, last: null, err: null }; save(); changed(); }

  if (typeof window !== "undefined") {
    window.addEventListener("online", () => soon(1000));
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && S.outbox.length) syncNow(); });
    setTimeout(() => soon(800), 0);
  }

  window.COACH = {
    APP, REPO, newId, rec, tally, plain, flag, note, unflag, progress, syncNow, connect, disconnect,
    onChange: f => listeners.push(f),
    isFlagged: ref => !!S.flags[ref], flags: () => S.flags,
    plan: () => S.coach.plan, replies: () => S.coach.replies || {},
    status: () => ({ connected: !!S.sync.token, last: S.sync.last, err: S.sync.err, waiting: S.outbox.length, busy }),
  };
})();
