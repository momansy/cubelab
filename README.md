# CubeLab — 3×3 Rubik's Cube Simulator

A professional, single‑page Rubik's Cube simulator built with plain HTML, CSS and
JavaScript. No build step, no dependencies, works fully offline.

## Run it

Just open `index.html` in a modern browser, or serve the folder:

```bash
python -m http.server 4173
```

then visit <http://localhost:4173>.

## Features

- **Real 3‑D cube** rendered with CSS 3D transforms — swipe stickers to turn
  rows and columns, drag the background to orbit, scroll to zoom and
  double‑click to reset the view.
- **Full move set**: outer faces (`U D L R F B`), middle slices (`M E S`),
  wide turns (`u d l r f b`) and whole‑cube rotations (`x y z`) — each with
  prime (`′`) and double (`²`) variants.
- **Keyboard control** — press a letter for a clockwise turn, `Shift`+letter for
  counter‑clockwise. `Space` scrambles, `Backspace` undoes.
- **Random scrambles** using WCA‑style notation, shown in the panel.
- **Speed‑cubing timer** that arms after a scramble, starts on the first move and
  stops the instant the cube is solved. Best time and Ao5 are tracked for the
  session and stored in `localStorage`.
- **Auto‑Solve** replays the inverse of every move since the last solved state.
- **Undo**, **Reset**, adjustable turn speed and an auto‑rotate view toggle.
- **Move history** log and a solved‑state detector based on the actual sticker
  layout (so whole‑cube rotations still count as solved).

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup and control layout |
| `styles.css` | Theme, 3‑D stage and responsive layout |
| `app.js` | Cube model, turn engine, timer and UI wiring |

## How the cube works

Each of the 27 cubies stores an integer grid position and a 3×3 integer
orientation matrix. A turn moves the affected cubies into a pivot `<div>`,
animates that pivot with a CSS transition, then "bakes" the rotation back into
every cubie's own matrix. All rotations are exact 90° integer matrices, so the
state never drifts.
