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
    npm run posters      # -> posters/<id>.json + posters/img/<id>.png; --pins a,b  --count n  --redo 2,4

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
- `posters/`: one JSON per poster (idea, copy, facts used, photo credit, grid cells, critic
  scores and notes, the full render spec) plus a PNG in `posters/img/`. `runs.jsonl` logs
  one line per poster. Needs `ANTHROPIC_API_KEY` in `.env.local` (this project's own key).
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
