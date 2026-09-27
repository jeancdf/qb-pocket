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

## Controls

- **SNAP** or Space — hike the ball
- Hold the mouse on the grass (or hold keys **1–5** on a receiver),
  release to throw. A short hold floats a lob; a long hold ropes a
  bullet. Hold too long and the ball sails. **Esc** cancels.
- HUD row click — quick touch pass
- Accuracy drops under pressure and on the move. Balls can be
  dropped, broken up, tipped, and intercepted.
- **RESET** or R — same play again

Green ring = open. Yellow = window. Red = covered. Hold the
ball too long and the ends sack you.

## Stack

Vite + TypeScript + Three.js. 1 yard = 1 world unit.

## Where things live (`src/game/`)

| File | What it owns |
| --- | --- |
| `game.ts` | `FootballGame`: phases, inputs, charging and releasing a throw, drive results. Glue only; put new rules in a module below. |
| `camera.ts` | The only code that moves the camera. Stays behind the QB, no side offset. |
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
| `players.ts`, `rig.ts`, `pose-blend.ts` | Player actor, body model and animation poses. |
| `field.ts`, `materials.ts`, `scene-kit.ts` | Field, team kits, renderer, lights, aim ring, route lines. |
| `drive.ts`, `hud.ts`, `throw-meter.ts` | Downs and score, HUD, throw power meter. |
