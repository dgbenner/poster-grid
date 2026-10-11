# Poster Grid

Posters of Waypoints places on a strict typographic grid, plus a gallery of them all.
The grid is the point: the lab, every poster and the gallery overlay read it from
`grid/grid.json` through `grid/grid.js`.

Reads Waypoints pins; never writes to the Waypoints repo.

Personal project to make travel posters for my locations I want to visit and drive my own interest.

## Run

    npm run lab          # http://localhost:5190/lab/
    npm run fetch-pins   # Waypoints pins -> data/pins.json (read-only)
    npm run enrich       # -> data/enrich/<pin-id>.json; add --only id,id  --uk  --force
    npm run posters      # new posters; --series serif  --count n  --pins a,b  --skip a,b  --redo 2,4

## Layout

- `lab/`: the grid lab (Phase 1). Change the grid, play the build, save to grid.json.
- `grid/grid.json`: grid settings, the single source. `grid/grid.js`: grid geometry.
- `scripts/serve.mjs`: local server; also accepts saves of grid.json from the lab.
- `data/pins.json`: the pins as fetched. `data/enrich/`: one file per pin with place
  (ceremonial county for England; Greater London + borough for London), nearby pins,
  Wikipedia facts with URLs, images with author and licence, and dominant colours.
  `data/images/` and `data/cache/` are local only (gitignored).
- Images: Dan's own Waypoints photos are used, labelled `license: "personal"` (private
  use only, behind the password). Everything else is Wikimedia Commons under CC0, public
  domain, CC BY or CC BY-SA. No logos, album art, maps or flags.
- `posters/<id>/`: `poster.json` (number, series, published version, version list) and
  `v<n>.json` + `v<n>.png` per version (idea, copy, facts, photo credits, colours with roles,
  grid cells, critic scores and notes, render spec). Versions are never overwritten.
  `runs.jsonl` logs every poster and version; `data/feedback.jsonl` every feedback text.
  Needs `ANTHROPIC_API_KEY` in `.env.local` (this project's own key).
- `series/<slug>.json`: a series' font pairings, colour limit and ideas (Original, Serif).
- Feedback and versions: run `npm run lab`, open the viewer at the root, open a poster, type
  what should change, Make new version, then Use this version to publish it. These controls
  exist only on the local server; GitHub Pages shows each poster's published version.
- `render/poster.html`: draws any poster from its spec; `?id=<poster-id>` shows a saved one.
- `_source/`: the spec and the A. Artifacts reference set (screenshots + link).
  Reference site: https://a-artifacts.vercel.app/posters

## Phases

1. Grid lab (done when every grid number updates the sample poster and overlay, and Play build runs in order)
2. Data: fetch pins, enrich (place, nearby, facts, licensed images, colours)
3. First 10 posters
4. Gallery, overlay and poster editor
5. Trip maps and more ideas

Full spec: `_source/SPEC-poster-grid.md`.
