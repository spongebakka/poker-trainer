# Felt: poker, learned at the table

A play-first poker trainer: 13 drills in three acts (the game → cash games →
tournaments). Every drill is something you do on a felt table: tap cards, tap
seats, paint ranges, slide a chip. Every answer gets a "why" with real numbers.
No network, no build step, no dependencies.

## Run it
```
python3 -m http.server 8766 --bind 127.0.0.1
```
then open http://127.0.0.1:8766/index.html. Progress saves in the browser
(`localStorage`, key `felt_v1`). Keyboard on desktop: the letter on each button,
Enter for next, Esc for home.

## On your phone
It's a PWA: `manifest.webmanifest` + `icons/` make it installable, and `sw.js` caches
every file so it runs with no signal. Live at https://spongebakka.github.io/poker-trainer/ via GitHub
Pages (repo spongebakka/poker-trainer, **public**, branch `main`, root folder). Each
push to `main` redeploys in about a minute. Commits use the GitHub no-reply email
(set in this repo's git config) so Kai's address stays off the public history. **When you change any app file, bump `VERSION` in `sw.js`**
so installed copies refresh their cache. The icon is drawn in `tools/icon.html` and
rendered to PNG with headless Chrome + `sips`.

## Files
- `engine.js`: hand evaluator (7-card), 169 hand classes, range parsing, Monte Carlo
  equity, ICM (Malmuth-Harville). Shared by the browser and Node.
- `data.js`: **generated**, do not edit. 169×169 preflop equity matrix (12,000 run-outs
  per matchup), blocker-aware combo weights, and heads-up push/fold Nash charts for
  1–20 and 25 bb (fictitious play, 600 iterations). Rebuild: `npm run build-data` (~1 min).
- `app.js`: UI shell + the 13 drills. Each drill is one `def({...})` block with an
  `idea` (the teaching text) and `run(ctx)` (deal a spot, grade it, explain it).
- `style.css`, `fonts.css`: look and feel. Fonts are embedded (same three as the
  blackjack trainer) so it works offline.
- `test/engine-check.js`: `npm test`. 480 checks: hand ranking edge cases, equity vs
  published matchups, Nash sanity (AA always shoves, range shrinks with stack,
  ~58% at 10 bb), ICM properties.

## Where the "right answers" come from
| Drill | Source of truth |
|---|---|
| Who wins, Best five, Outs | the evaluator, exact |
| Matchups | the equity matrix (class average; suits move it a point or two) |
| Open or fold, Paint | a standard **simplified** 100bb 6-max chart in `OPEN` (app.js). Not solver output: real solver charts mix edge hands. |
| Pot odds, Bluff maths, Stack | arithmetic |
| Push or fold, Call the shove | the Nash tables in data.js (heads-up / blind vs blind, no antes) |
| Bubble maths | ICM on the actual stacks; opponent range = top X% by equity vs a random hand |

## Mastery
"Solid" = 18 of the last 20 right. Nothing is locked; the home screen points at the
first drill that isn't solid yet.

## Ideas not built yet
- A live table: play full hands against bots with a coach flagging each decision.
- Antes in push/fold (modern tournaments use a big-blind ante, which widens shoves).
- 3-betting and facing a raise; postflop c-bet spots.
- Spaced repetition across drills (the blackjack trainer has an FSRS layer to borrow).
