---
name: korea100studio
description: >-
  Turn any process — described in natural language, a table, or data — into a
  vertical swimlane process board (SVG, optional PNG), audit its composition
  quality, and render a stage-ordered reveal animation. Use when the user wants
  to visualize a workflow, procedure, approval flow, or who-does-what-when across
  actors and stages. Works in Claude Code and Codex.
---

# korea100studio

A vertical swimlane process-board renderer. Lanes (columns) are actors; stages
(rows) are ordered phases, top to bottom. You author a small JSON file
(`board-v1`), then drive everything through one CLI: `scripts/board.mjs`.

## Workflow

1. **Elicit the process.** From whatever the user gives you (a description, a
   table, a policy document, raw notes), identify:
   - **lanes** — the actors/roles/departments involved (columns, left→right)
   - **stages** — the ordered phases the process moves through (rows, top→bottom)
   - **nodes** — one card per actor-action within a stage (`lane` × `stage` × `label`)
   - **edges** — how nodes connect: `sequence` (normal flow), `message`
     (info/handoff between lanes), `loop` (rework/return path)

2. **Write a `board-v1` JSON file.** Start from `templates/board.template.json`
   or `fixtures/generic-sample.json`. Full field reference:
   `schemas/board-v1.schema.json`. Mapping guidance and a worked example:
   `references/authoring.md`.

3. **Render, audit, and iterate** with the CLI (see below) until `audit`
   reports zero node-piercings and metrics are within budget.

## CLI

All commands: `node scripts/board.mjs <command> <board.json> [options]`

```bash
# Render an SVG (default profile). --png also emits a rasterized PNG if
# librsvg or cairosvg is installed; --profile picks a visual profile.
node scripts/board.mjs render fixtures/generic-sample.json --out board.svg
node scripts/board.mjs render fixtures/gov-sample.json --out board.svg --png --profile gov

# Print composition-quality metrics and score (see references/composition-quality.md)
node scripts/board.mjs audit fixtures/generic-sample.json

# Validate schema + composition budgets. --strict exits non-zero on budget violations.
node scripts/board.mjs validate fixtures/generic-sample.json --strict

# Render a stage-ordered reveal animation (self-contained animated SVG)
node scripts/board.mjs motion fixtures/generic-sample.json --out board.motion.svg

# Sanity-check that a file is a well-formed SVG (useful after hand-editing one)
node scripts/board.mjs check board.svg
```

If `--profile` is omitted, it falls back to the board's own `"profile"`
field, then to `default`.

## Validate–render loop

Don't just render once and stop. After `render`, run `audit`:

```bash
node scripts/board.mjs audit board.json
```

- **`nodePiercings` must be 0.** This is the worst readability sin — an edge
  routed behind an unrelated card, hidden by z-order. The renderer's gutter
  router already keeps in-row and return edges out from behind cards for
  typical boards; if piercings still show up, it usually means two nodes in
  the same lane/stage are too close, or an edge spans many stages. Fix by
  reordering stages, splitting a node, or rerouting via an intermediate node.
- **`crossings`, `bendsPerEdgeMax`, `routeStretchMax`, `adjustedLabels`** are
  soft-budgeted (see `references/composition-quality.md` for the exact
  thresholds and what each means). A few crossings are normal in busy
  processes; treat repeated budget violations as a signal to simplify the
  graph (fewer cross-lane edges, shorter loops) rather than a hard blocker.
- Use `validate --strict` in scripts/CI to fail the build on budget
  violations; use plain `audit` interactively while iterating.

## Profiles

- **`default`** — neutral, English labels, blue/slate palette. Use for
  general-purpose workflows.
- **`gov`** — korea100's Korean-government look: Korean badge labels (선행/핵심/후속/병목/회귀),
  Korean chrome text (legend, axis labels, footer notes), `refsLabel: "조문"`
  for citing statutes, and a violet accent. Use for Korean administrative/
  legal procedures, especially when nodes carry `refs` citing law articles.

Full emphasis→badge mapping, how `refs`/`refsLabel` render, and how to add a
new profile: `references/profiles.md`.

## Reference files

- `references/authoring.md` — how to map a natural-language process onto
  board-v1 fields, with a fully worked example.
- `references/composition-quality.md` — what `audit`'s metrics mean and the
  budget thresholds.
- `references/profiles.md` — `default` vs `gov` profile details and how to
  extend `scripts/lib/profiles.mjs` with a new one.
- `schemas/board-v1.schema.json` — the authoritative JSON Schema.
- `templates/board.template.json` — minimal starting skeleton.
- `fixtures/generic-sample.json`, `fixtures/gov-sample.json` — full working
  examples for each profile.
