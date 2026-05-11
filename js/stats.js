// Compute live counts for the sidebar.

import { CELL_DEFS } from "./cell.js";

export function computeStats(world) {
  let alive = 0;
  let totalCells = 0;
  let maxCells = 0;
  const cellHist = {};
  for (const o of world.organisms) {
    if (!o.alive) continue;
    alive++;
    totalCells += o.cells.length;
    if (o.cells.length > maxCells) maxCells = o.cells.length;
    for (const c of o.cells) cellHist[c.type] = (cellHist[c.type] || 0) + 1;
  }
  let humansAlive = 0;
  for (const h of world.humans) if (h.alive) humansAlive++;
  const wars = world.kingdoms.filter((k) => k.warTarget).length / 2;

  return {
    tick: world.tick,
    era: world.era,
    organisms: alive,
    avgCells: alive ? (totalCells / alive).toFixed(1) : "0.0",
    maxCells,
    cellHist,
    humans: humansAlive,
    kingdoms: world.kingdoms.filter((k) => k.population > 0).length,
    wars,
    buildings: world.buildings.length,
  };
}

export function renderStats(stats, el) {
  const cellRows = Object.entries(stats.cellHist)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `<span class="k">${CELL_DEFS[t]?.name || "?"}</span><span class="v">${n}</span>`)
    .join("");
  el.innerHTML = `
    <span class="k">Tick</span><span class="v">${stats.tick}</span>
    <span class="k">Organisms</span><span class="v">${stats.organisms}</span>
    <span class="k">Avg cells</span><span class="v">${stats.avgCells}</span>
    <span class="k">Largest</span><span class="v">${stats.maxCells}</span>
    <span class="k">Humans</span><span class="v">${stats.humans}</span>
    <span class="k">Kingdoms</span><span class="v">${stats.kingdoms}</span>
    <span class="k">Wars</span><span class="v">${stats.wars}</span>
    <span class="k">Buildings</span><span class="v">${stats.buildings}</span>
    ${cellRows}
  `;
}
