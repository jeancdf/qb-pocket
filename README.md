# QB Pocket

Score-Hero-style American football prototype: you are the
quarterback. One play (Gun Trips Right — Smash). Snap, read
coverage, throw.

## Run

```bash
npm install
npm run dev
```

Opens a Madden-style vertical field camera (offense at the
bottom, downfield at the top). Scroll to zoom.

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
