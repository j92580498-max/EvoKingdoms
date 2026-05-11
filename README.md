# EvoKingdoms

A browser-based life simulator that fuses two ideas:

- **The Life Engine** — cellular organisms with DNA, anatomy, mutation, energy and natural
  selection on a 2D grid.
- **Super WorldBox** — humans, tribes, kingdoms, wars, buildings, and god-tools
  (brushes, disasters) that act on a procedurally-generated world.

The simulation runs entirely in the browser using HTML5 Canvas and vanilla
ES modules — no build step, no backend.

## Run

Just open `index.html` in any modern browser, or serve the folder with any static
server (e.g. `python3 -m http.server`).

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Controls

| Tool                 | What it does                                           |
| -------------------- | ------------------------------------------------------ |
| Pause / Play / Speed | Control simulation tick rate                           |
| Era                  | `Primordial` (cells only) → `Sentient` (humans appear) |
| Brushes              | Grass, water, mountain, sand, lava, food, organism    |
| Disasters            | Meteor, earthquake, plague, flood                      |
| Inspect              | Click an organism / human / tile for details          |

## Eras

1. **Primordial Era** — only cellular organisms exist. They evolve from a
   single producer-mouth seed via mutation and natural selection.
2. **Sentient Era** — once organisms become complex enough (or you press
   *Advance Era*), humans spawn from the most evolved colonies. They form
   tribes, found villages, build castles, declare war, advance through tech
   ages, and conquer the map.

## Architecture

```
js/
  main.js          entry point + game loop
  config.js        tunable constants
  utils.js         RNG, name generators, math helpers
  world.js         the grid + terrain + tick driver
  cell.js          cell type definitions (Producer, Mouth, Mover, ...)
  organism.js      organism body + DNA + behavior
  civilization.js  humans, tribes, kingdoms, wars, tech
  god.js           brush + disaster tools
  renderer.js      canvas drawing for every layer
  ui.js            DOM controls panel
  stats.js         population / kingdom statistics
```

## License

MIT
