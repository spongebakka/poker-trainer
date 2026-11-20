# Felt coaching: data and sync spec

Status: **built 2026-11-18** (Kai picked option 2b, the "I'm guessing" toggle). Not built yet:
re-tests (`retest` in plan.json, the "Re-test this spot" button). Code: `coach.js` (log, outbox,
sync), the COACH section of `app.js` (toggle, flags, This week, #/sync, #/flags), `tools/review.js`.
The store is the private repo spongebakka/felt-data, cloned at `../felt-data`; its CLAUDE.md
holds the session routine.

## The idea
Felt stays Kai's phone app: its own home-screen icon, and it works offline. Everything he does in it
(table hands **and** all 13 drills) is logged and synced to a **private** GitHub repo. Coaching
sessions happen in Claude Code on the Mac: Claude reads the data, talks it through with Kai, then
writes a plan and replies back to the repo. Felt picks those up the next time it opens.
Asking about a hand happens in the session, not inside Felt (no API key, no per-message cost).

```
 Felt (phone, offline OK) ──upload batches──▶ spongebakka/felt-data (PRIVATE) ◀──git pull/push── Claude on the Mac
          ▲                                       log/  coach/plan.json  coach/replies.json  coach/notebook.md
          └──────────────── fetch plan + replies on open ◀───────────────┘
```

## Hard rules
- **Kai's data never goes in the public `poker-trainer` repo.** Only in `felt-data` (private).
- Kai creates the GitHub token and types it into Felt himself. It never goes in chat or in a file.
  Fine-grained token, **only** the felt-data repo, Contents: read and write, 1-year expiry.
- Every log record is append-only, and each upload is a new file, so the phone and Mac never clash.
- A leak only counts with enough samples behind it; review output says "too early" under ~15 spots.

## What gets logged (every record has `v` (schema), `app` (sw.js VERSION), `t` (ISO time), `sid` (session id))

**session**: start, end, mode or drill, device.

**hand** (table, every hand, full so it can be replayed exactly in Node):
mode, level/blinds/ante, button, seat setup (position, stack, bot style per seat), deck order,
every action (seat, street, type, amount), board, showdown cards, result per seat (in bb),
tournament place if it ended.

**decision** (each hero action at the table):
hand id, street, spot (`open`/`option`/`limpers`/`shove`/`vsRaise`/`vs3bet`/`allin`/`facingBet`/`betCheck`), skill, limpers (count, `limpers` spot only), pot, to call,
effective stack (bb), SPR, hand description ("top pair, weak kicker"), draw, villain style +
range %, what he did (type + size), the coach's best and accepted set, grade, first or second try,
equity, need %, EV per bet size (betCheck), **confidence (sure / guessing)**, **think time (ms)**,
whether the hint was shown.

**drill** (each answer in any drill; one `log` object passed to `ctx.finish`):

| Drill | Logged |
|---|---|
| Who wins? | both hands, board, hand categories, picked vs right |
| Best five | hole, board, cards picked vs the real five, category |
| Seats | button seat, position asked, position tapped |
| Open or fold | hand class, position, chose vs chart, distance from the range edge |
| Paint the range | position, hands missed, hands added, accuracy |
| Matchups | the two hands, his estimate vs true equity, error in points |
| Outs | hole, board, draw type, his count vs true, outs missed |
| Pot odds | pot, bet, equity, need %, chose vs right |
| Bluff maths | bet/pot, question type, his estimate vs true, error |
| Stack in blinds | stack, blinds, ante, his answer vs true |
| Push or fold | hand, stack in bb, chose vs Nash, margin |
| Call the shove | hand, stack in bb, chose vs Nash, margin |
| Bubble maths | stacks, payouts, chose vs right, chip EV vs ICM EV |

Plus confidence, think time and grade on every drill answer.

**flag**: hand or drill answer id, optional note from Kai ("didn't get why this was a fold").

## Coach → Felt
- `coach/plan.json`: `{week, focus: [1-2 ideas], tasks: [{text, target: {skill|drill, n, goal}}], retest: [spot ids]}`.
  Felt shows it as a "This week" card with progress counted from its own log.
- `coach/replies.json`: `{[flagId]: {text, t}}`. Felt shows the reply on that hand.
- `retest`: saved spots Felt re-deals a few days later (spaced re-testing from Kai's brief).

## Coaching session routine (Mac, Claude Code opened in `felt-data`)
1. `git pull`, then run the review tool (to build: `tools/review.js` in this repo) on the new logs.
   It prints: volume, right-first-try % vs last week, leaks ranked by bb cost with sample sizes,
   sure-but-wrong spots, quick mistakes (autopilot), drill vs table transfer, progress on last plan.
2. Read `coach/notebook.md` (what was taught, what clicked, misconceptions, what's next).
3. Flagged hands first: ask what he was thinking before explaining (Kai's brief: nudge, don't tell).
4. One leak, taught with his real hands; check every number with the engine, not from memory.
5. Write plan.json + replies.json, update notebook.md, commit, push.

## Build order
1. Mockup of the new Felt bits for Kai to tweak (confidence tap, flag + note, This week card,
   replies, sync settings). **Wait for his OK** (mockups before building).
2. Logging in Felt (outbox in localStorage), all records above. Tests: records replay to the same hand.
3. Sync (upload batches, fetch plan/replies) + the felt-data repo (ask Kai before creating it).
4. `tools/review.js` + `felt-data/CLAUDE.md` with the routine above.
5. First real session once there are ~100 hands.
