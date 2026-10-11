# Spec: Poster Grid additions (colors, serif series, more images, feedback versions)

For Claude Code, in the `poster-grid` repo. Four additions to what's built. Before starting, check
each section against the current code and adapt names to match it. Tell Dan anything that differs
from what this spec assumes.

---

## 1. Up to three colors from the photos

Today each poster gets one accent. Allow up to three colors, taken from the poster's own images.

**Code picks the candidates:**
- Pull 6 candidate colors from the poster's images with sharp.
- Drop candidates too close to each other (a difference under 20 in Lab color space) and near-grays.
- Keep the neutral base as is: paper, ink, gray. These don't count toward the limit.

**The designer picks and assigns:**
- Choose 0 to 3 of the candidates, and give each a role: `background`, `headline`, `accent`
  (rules, numbers, index boxes) or `panel` (the box behind an image).
- Union Jack red and blue remain an option for UK places and count toward the three.

**Code checks (added to the existing checks):**
- No more than 3 non-neutral colors on a poster.
- Text contrast: at least 4.5:1 for body text and 3:1 for text 24 pt and larger.
- Every color on the poster comes from the candidates, the national colors or the neutral base.

**Gallery:** show the poster's colors as small swatches with their hex values under the full-size view.

## 2. Series, starting with a serif-title series

A **series** is a named set of rules a run follows: font pairing, color limit and allowed ideas. The
same places can appear in more than one series, so Dan can compare them.

`series/<name>.json`:
```
{ "name": "Serif", "fonts": "serif-garamond", "maxColors": 3, "ideas": ["all"] }
```

Add three serif pairings (all free on Google Fonts). The serif is for titles only; text and labels stay sans and mono:

| Pairing id | Titles | Text | Labels | Why |
| --- | --- | --- | --- | --- |
| `serif-garamond` | EB Garamond | Inter | IBM Plex Mono | Closest to the Waypoints site title |
| `serif-bodoni` | Bodoni Moda | Inter | JetBrains Mono | High contrast, built for large sizes |
| `serif-newsreader` | Newsreader (72 pt optical size) | IBM Plex Sans | IBM Plex Mono | Editorial, holds up at poster scale |

Rules for serif titles:
- Large titles still sit on the baseline grid. Align the baseline of each title line to a grid line.
- Add all three pairings to the grid lab's font switch so Dan can try them on the sample poster first.

Commands: `npm run posters -- --series serif` makes or extends that series. The gallery gets a
**Series** filter.

## 3. More than one image per place

Today a place tends to get the same single image every time. Gather several, and use them.

**Enrichment, up to 8 images per place,** from these sources, in order:
1. Dan's own photos (when the trip-photo idea is built).
2. The pin's current photo.
3. The Wikidata image (property P18) for the place.
4. Images in the place's Wikimedia Commons category (Wikidata property P373).
5. Images used in the place's Wikipedia article.

Same rules as now: only CC0, public domain, CC BY and CC BY-SA, with author, license and source
saved. Add a minimum size of 1600 px on the long side and the existing soft-photo check. Save each
image's candidate colors for section 1.

**Selection:**
- The designer sees thumbnails of all the place's images (image input) and picks 1 to 3 that fit the idea.
- Ideas that need several images, such as Plates, Catalog and Closer, may use different images
  instead of repeating one.
- Code tracks which images each poster used. A new poster or version of the same place prefers
  images not used yet.

**Credits:** with more than one image, the PHOTO footer cell lists each one, such as
"A. Author, CC BY-SA 4.0; B. Author, CC0". If it doesn't fit, it moves to a credits line above the
footer, set in the label font.

## 4. Feedback field and new versions

In the gallery's full-size view, add a way to ask for a new version in Dan's words.

**Interface (full-size view only):**
- A text field labeled **What should change?**
- Quick buttons that fill the field: "Bigger title", "Different photo", "Fewer colors",
  "Try a serif title", "More empty space".
- A **Make new version** button. While it runs, show progress on the button; when done, show the
  new version.
- Versions as tabs: **v1, v2, v3**, each with the feedback that produced it and its critic score.
- A **Use this version** button marks which version is published.

**What happens:**
1. The local server receives `POST /api/revise` with the poster id and the feedback text.
2. The designer gets the current poster's data and image, the critic's notes and Dan's feedback,
   and makes a new design. Facts, image licenses and grid rules are unchanged.
3. Same checks and critic as always, plus one new critic score: **Followed the feedback (1–10)**.
   Below 7, retry once with the critic's notes.
4. The new version is saved as `posters/<id>/v<n>.json` and `v<n>.png`. Earlier versions are never overwritten.
5. Every feedback text is saved to `data/feedback.jsonl` with the poster id, version and date.

**Where it works:** only when the gallery is run through the local server, because generating needs
the Anthropic key. On GitHub Pages, the field and buttons are hidden, and the published version shows.

**Publishing:** the existing publish step publishes each poster's chosen version only.

---

## Done when

- A poster uses up to three photo colors with roles, and the checks reject a fourth color or poor contrast.
- `--series serif` produces posters with serif titles on the baseline grid, and the gallery filters by series.
- A place's posters draw on more than one image, with every image credited.
- Typing feedback and pressing Make new version produces v2 beside v1, with the feedback and scores
  shown, and Use this version changes what gets published.
- Nothing published on GitHub Pages exposes the feedback field.

Don't push until Dan has looked at it.
