# QB Pocket

Score-Hero-style American football prototype: you are the
quarterback. One play (Gun Trips Right — Smash). Snap, read
coverage, throw.

## Run

```bash
npm install
npm run dev
```

The camera sits low behind the QB, in line with the field
(downfield at the top of the screen). Scroll to zoom.

The game opens on a title screen: pick a mode there (**LANCER** is
the single practice drive, **MATCH** four 4-minute quarters against
the CPU, **CARRIÈRE** five matches against ever better teams: the
difficulty drives the CPU QB's reads and accuracy, its runner, its
coverage speed and how fast its pass rush wins). **MENU** or Esc goes back to it. In a match, Space / SNAP
moves on from each break card. When the CPU has the ball you play
defense: the camera flips behind your defense, 1–7 picks the call,
Tab (or C) takes the defender nearest the ball, ZQSD runs him (before
the snap too, to shift him). A gold arrow over his head and a strip at
the bottom of the screen show who you control.

## Controls

- **SNAP** or Space — hike the ball
- Hold the mouse on the grass (or hold keys **1–5** on a receiver),
  release to throw. A short hold floats a lob; a long hold ropes a
  bullet. Hold too long and the ball sails. **Esc** cancels.
- HUD row click — quick touch pass
- Accuracy drops under pressure and on the move. Balls can be
  dropped, broken up, tipped, and intercepted.
- **V** — cycle the run plays (Inside zone, Outside zone, Draw); after
  the handoff ZQSD steers the RB. The line run-blocks for a moment,
  then the DL get off their blocks.
- **P** on 4th down in a match — punt (P again cancels)
- **RESET** or R — same play again

Green ring = open. Yellow = window. Red = covered. Hold the
ball too long and the ends sack you.

## Stack

Vite + TypeScript + Three.js. 1 yard = 1 world unit.

## Where things live (`src/game/`)

| File | What it owns |
| --- | --- |
| `menu.ts` | Title screen and the list of game modes. |
| `career.ts` | CARRIÈRE: 5 opponents of rising difficulty, win to advance, progress in localStorage. |
| `match.ts` | Match rules: score, game clock, quarters, halftime, change of possession (spot mirrored, offense always attacks +z). |
| `match-flow.ts` | A match between snaps: break cards, who gets the ball next, CPU possessions. |
| `run-play.ts` | Run plays: QB path per play and the handoff moment (then the RB is a normal carrier). |
| `punt.ts` | Punt distance, hang, return, touchback, and when the CPU punts on 4th down. |
| `punt-return.ts` | CPU punts: the player's returner (FS) gets under the ball, then the player runs it back (ZQSD, Shift, Space juke) against the cover team. |
| `cpu-offense.ts` | CPU offense when the player defends: play call, QB progression and throw, ball carrier AI. |
| `defense-control.ts` | Player on defense: call sheet (1–7), controlled defender (gold ring), switching, movement. |
| `game.ts` | `FootballGame`: phases, inputs, charging and releasing a throw, drive results. Glue only; put new rules in a module below. |
| `camera.ts` | The only code that moves the camera. Stays behind the QB, no side offset; on defense it rides behind the controlled defender and turns toward the ball (the only yaw, heavily smoothed); stick input follows that heading. |
| `yac.ts` | Ball carrier after the catch or a scramble: juke, pursuit, tackle. |
| `pass-flight.ts` | Ball in the air: receiver break, catch / drop / breakup / pick. |
| `throwing.ts` | Pure throw math: charge power, accuracy, flight time, catch contest. |
| `coverage-looks.ts` | Every defensive call (Cover 0/1/2/3/4, blitzes) as data. |
| `coverage-play.ts` | Coverage AI that runs a look (zone and man). |
| `line-play.ts` | OL / DL and the pass rush. |
| `qb-eyes.ts` | Where the QB is looking, read by the defense. |
| `receiver-grade.ts` | Open / window / covered grade for the HUD rings. |
| `playbook.ts` | Roster and base formation. |
| `plays.ts` | Offensive plays (routes, motion). `play-hints.ts` has the pre-snap tips. |
| `players.ts`, `rig.ts`, `pose-blend.ts` | Player actor (locomotion, inertia), body model and animation poses. |
| `collisions.ts` | Keeps players from running through each other. |
| `field.ts`, `materials.ts`, `scene-kit.ts` | Field, team kits, renderer, lights, aim ring, route lines. |
| `drive.ts`, `hud.ts`, `throw-meter.ts` | Downs and score, HUD, throw power meter. |
