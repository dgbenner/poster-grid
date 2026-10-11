# Spec: Poster Grid

For Claude Code, in a **new folder**, `~/Sites/poster-grid`. This is its own project. It reads
Waypoints' pins but never writes to the Waypoints repo.

## What it is

A system that makes posters from Dan's Waypoints places, laid out on a strict typographic grid, plus
one page that shows them all. It has two jobs:

1. **Learn the grid.** Dan never studied grid systems formally. Every part of this project makes the
   grid visible: a grid lab, overlays on every poster, and critiques written in grid terms.
2. **Remember places.** Before a trip, Dan scrolls the gallery to see what he's collected, where it
   is, and what's near it. Big place names and county names help him learn English geography
   (Essex, Sussex and so on).

Posters are viewed on screen. They don't need to be print-ready.

Inspired by the "A. Artifacts" meteorite posters: one grid, 200 posters, a fixed header and footer,
and the model free to compose the middle.

## Agent story

> **As** Dan, **when** I run the poster command, **I want** posters of my Waypoints places on a strict
> grid, **so that** I learn the grid and remember places when planning trips.
> **It may:** read my pins, look up facts and free-licensed images, choose an idea per poster, place
> elements on grid cells, and ask a critic for a score.
> **It must never:** place anything off the grid, state a fact without a saved source, use an image
> without a free license and credit, use band logos or album art, or write to the Waypoints repo.
> **It decides:** the idea for each poster, the copy (from saved facts), the layout and the accent color.
> **It stops when:** each poster passes the checks and scores 7 or higher, or after 2 retries.
> **I'll know it works when:** I keep at least half the posters without changes, and I can name the
> county of every English place I've posted.

This is a **pipeline**: the steps per poster are always the same (enrich, idea, layout, check, critic,
render). Model judgment happens inside the idea, layout and critic steps.

---

## Phase 1: The grid lab (no AI)

A single page, `lab/index.html`, that teaches the grid by letting Dan change it.

- One blank A4 portrait page, shown at screen size.
- A switch for each part of the grid, each with a one-line explanation beside it:
  | Part | One-line explanation |
  | --- | --- |
  | Margins | The empty border that frames the content |
  | Columns | Vertical divisions that set where things can start and end |
  | Gutters | The gaps between columns, so content doesn't touch |
  | Baseline | Evenly spaced lines every line of text sits on |
  | Rows and modules | Horizontal divisions; where rows and columns cross are modules, the cells elements snap to |
- Controls: columns (4, 6, 8, 12), gutter width, margins, baseline (8, 10, 12 pt), rows per module.
- A sample poster that rearranges live as the numbers change.
- A **Play build** button: draws margins, then columns, then the baseline, then rows, then drops
  each element of the sample poster into its cells, one at a time.
- A font switch with three free (OFL) pairings. Default: Inter Tight (headlines), Inter (text),
  IBM Plex Mono (labels). Dan picks the final pairing here.

All grid settings live in `grid/grid.json`. Everything else reads from it.

**Done when:** Dan can change any grid number and see the sample poster and overlay update, and Play
build runs in order.

## Phase 2: The data

1. `scripts/fetch-pins`: download the pins file from the public Waypoints GitHub repo into
   `data/pins.json`. Read-only. Never commit to or edit the Waypoints repo.
2. `scripts/enrich`: for each pin, save `data/enrich/<pin-id>.json` with:
   - **Place:** city or town, county, region, country, from a reverse lookup of the pin's
     coordinates. For London, store "Greater London" plus the borough.
   - **Nearby:** other pins within 5 km, with distance, and pins in the same county.
   - **Facts:** the Wikipedia summary for the place, with its URL. The model may only use facts saved here.
   - **Images:** the pin's own photo if its license is known; otherwise free-licensed images from
     Wikimedia Commons. Accept only CC0, public domain, CC BY and CC BY-SA. Save author, license
     and source URL for each.
   - **Colors:** the photo's dominant colors, from code, not the model.
3. No band logos, album covers or screenshots from other sites, ever.

## Phase 3: The first 10 posters

Pick 10 English pins across at least 5 counties, including at least 3 in London.

### The fixed frame (same on every poster)

- **Header:** mono labels: `WAYPOINTS`, poster title, county, `NN / total`.
- **Footer:** a five-column table: `PLACE`, `COUNTY`, `COUNTRY`, `CATEGORY`, `PHOTO` (author and license).
- **Colors:** a black, white and gray base. One accent per poster, either the photo's strongest
  color or, as an option for UK places, Union Jack red or blue. Code checks text contrast is at least 4.5:1.

### How each poster is made

1. **Idea.** The model picks one idea from the list below and states it in one sentence, such as
   "The club is small; its fame is large, so the name fills the page."
2. **Copy.** The model writes the headline and one or two sentences using only saved facts.
3. **Layout.** The model returns grid positions, not pixels: each element gets column start, column
   span, row start and row span. All text, including big headlines, sits on the baseline.
4. **Checks (code).** Nothing outside the margins, no text overflowing its cells, no unintended
   overlaps (such as a scale bar across a photo), contrast passes, no stray punctuation from data.
5. **Critic (model).** Scores idea, grid use, hierarchy, type and color from 1 to 10, and writes its
   notes in grid terms: "the headline spans 9 of 12 columns; the caption sits one module too low."
   Below 7, back to step 1, up to 2 retries.
6. **Render.** Code draws the poster as HTML and saves a PNG with Playwright.

Each poster is saved as `posters/<id>.json` (the idea, copy, palette, elements and cells, critic
scores) and `posters/img/<id>.png`.

### Ideas for the first 10

| Idea | What it does |
| --- | --- |
| Place name at scale | The city or county name fills the page; the place sits inside it |
| Location decides layout | The photo sits in the grid cell matching where the place is in the country |
| Closer | One photo three times, each larger, stepping across the grid |
| Nearby | The place plus its nearby pins, listed with distances |

Code makes sure no idea is used twice in a row and that all four appear.

## Phase 4: The gallery and the overlay

`gallery/index.html`, for Dan only, run locally.

- All posters in a grid, newest first, each with its number.
- Filters: country, county, city, category, idea.
- Click a poster to see it full size at `#<number>`.
- **Grid overlay:** press `G` or a button to show margins, columns, modules and baseline over the
  poster. Hovering an element highlights the cells it occupies. **Play build** animates the poster
  being assembled, the same as in the lab.
- **Keep / Redo** buttons under each poster, saved to `data/ratings.json`. Ideas Dan keeps are picked
  more often in later runs; ideas he rejects, less.
- The critic's notes in grid terms appear under the full-size poster.
- **Poster editor** (added 2026-10-10): edit one poster by hand. Drag and resize elements in whole
  modules with the grid always visible; changes save back to `posters/<id>.json`, re-render, and
  Play build replays the edited version.

## Phase 5: Trip maps and more ideas

- **Trip map:** a poster per city or county, starting with London. Places become numbered stops on
  lines that run only horizontal, vertical or at 45°, in the style of a transit map. Version 1 snaps
  each place's real position to the nearest grid module and connects neighbors with angled lines.
  A list beside the map gives each stop's name and what it's near.
- **County poster:** one per county, with the county name at scale and all its pins.
- **Big number:** a count, such as the number of places in a county, at full scale.
- **Columns as time:** each column is a decade; events from saved facts placed in their column.
- **Catalog sheet:** every place in a category on one poster.

## Later (not now)

- Trip booklets: a printable booklet per city, with notes on why each place was saved.
- Risograph color separations for printing.
- Paired posters whose grid continues across two places with a connection.

## Logging

Append one line per poster to `runs.jsonl`: `{ at, pin_id, idea, retries, scores, tokens_in, tokens_out, ms }`.

## Start with

Phase 1, then show Dan the lab before starting Phase 2. Don't push anything until Dan has looked at it.

## Reading for Dan

- Josef Müller-Brockmann, *Grid Systems in Graphic Design*: the classic.
- Timothy Samara, *Making and Breaking the Grid*: the practical one.
