# Felt: poker, learned at the table

A play-first poker trainer. **The table** (`#/lobby`) is the core: full No-Limit
Hold'em hands against five bots, cash game or tournament, with a coach that checks
every decision. Around it sit 13 practice drills in three acts (the game → cash games →
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
- `table.js`: the coached table, no DOM. Hand engine (blinds, big-blind ante, betting,
  min-raise rules, uncalled-bet refunds, side pots, showdown, tournament places), bots,
  and the coach. **Key idea:** a bot's strategy is a pure function of (cards, situation),
  with "random" mixing done by hashing the cards, so after every bot action the engine
  re-runs that strategy over all 1,326 combos and keeps the ones that would have acted
  the same way. That gives the coach the bot's *exact* range, which it uses for equity
  (Monte Carlo) and, for bet-or-check spots, real EV against the bot's actual responses.
  Grading: first try wrong → hint + second go (only the first try counts toward stats).
- `app.js`: UI shell + the 13 drills + the table screen (lobby, table, coach panel). Each drill is one `def({...})` block with an
  `idea` (the teaching text) and `run(ctx)` (deal a spot, grade it, explain it).
- `style.css`, `fonts.css`: look and feel. Fonts are embedded (same three as the
  blackjack trainer) so it works offline.
- `test/table-check.js`: simulates 30 tournaments + 2,000 cash hands of bots: chips
  conserved every hand, each bot's real cards always inside its tracked range, places
  1–6, side pots, hand-reading tiers, coach sanity (AA under the gun raises, 72o folds).
- `test/engine-check.js`: `npm test` runs both. 480 checks: hand ranking edge cases, equity vs
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

## How good are the bots?
Six styles with real names for them (nit, TAG, LAG, calling station). Measured over
6,000 cash hands from the hero seat: the solid (TAG) style wins about +10 bb/100, always
calling loses ~900 bb/100, always going all in ~700 bb/100, always pot-betting postflop
~−20 bb/100. So they reward good play and punish the obvious exploits. Known
simplifications: preflop charts are 6-max simplified, short-stack shove ranges are
heads-up Nash shrunk per player behind, postflop EV counts the current street only.

## Mastery
"Solid" = 18 of the last 20 right. Nothing is locked; the home screen points at the
first drill that isn't solid yet.

## Ideas not built yet
- Table: hand history replay; spaced review that re-deals spots you got wrong; 9-handed tables.
- Antes in push/fold (modern tournaments use a big-blind ante, which widens shoves).
- 3-betting and facing a raise; postflop c-bet spots.
- Spaced repetition across drills (the blackjack trainer has an FSRS layer to borrow).
