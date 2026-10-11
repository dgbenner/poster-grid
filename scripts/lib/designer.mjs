// The two model steps: the designer (idea, copy, layout in grid cells) and the critic
// (scores and notes in grid terms). Everything else in the pipeline is code.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import sharp from 'sharp';
import { computeGrid } from '../../grid/grid.js';
import { ROOT } from './http.mjs';
import { IDEAS, ROLES, middleRows } from './poster.mjs';

export const MODEL = 'claude-opus-5-5';
const client = new Anthropic();

// Server-side refusal fallback: a declined request is retried on the default fallback model.
const BASE = { model: MODEL, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', thinking: { type: 'adaptive' } };

const Element = z.object({
  name: z.string(),
  kind: z.enum(['headline', 'text', 'label', 'photo', 'list', 'pinfield']),
  col: z.number().int(), col_span: z.number().int(), row: z.number().int(), row_span: z.number().int(),
  text: z.string().nullable(),
  style: z.enum(['lead', 'body']).nullable(),
  color: z.enum(['ink', 'muted', 'accent', 'headline']).nullable(),
  align: z.enum(['left', 'right']).nullable(),
  image: z.number().int().nullable(),
  zoom: z.number().nullable(), focus_x: z.number().nullable(), focus_y: z.number().nullable(),
  tag: z.string().nullable(),
  items: z.array(z.string()).nullable(),
  over: z.boolean(),
  panel: z.boolean(),
});

const Design = z.object({
  idea: z.enum(Object.keys(IDEAS)),
  idea_sentence: z.string(),
  poster_title: z.string(),
  pairing: z.string(),
  paper: z.enum(['light', 'dark']),
  colors: z.array(z.object({ hex: z.string(), role: z.enum(ROLES) })),
  elements: z.array(Element),
  facts_used: z.array(z.string()),
});

const Scores = { idea: z.number().int(), grid: z.number().int(), hierarchy: z.number().int(), type: z.number().int(), color: z.number().int() };
const Critique = z.object({ scores: z.object(Scores), notes: z.array(z.string()), summary: z.string() });
// With Dan's feedback, the critic also scores how well the new version followed it.
const CritiqueFeedback = z.object({ scores: z.object({ ...Scores, followed: z.number().int() }), notes: z.array(z.string()), summary: z.string() });

const DESIGN_SYSTEM = `You design posters for Dan's Waypoints: places he has saved and wants to remember before a trip. Each poster sits on a strict typographic grid, in the Swiss tradition of Müller-Brockmann, and is viewed on screen. Dan is learning grid systems from these posters, so the grid should be legible in the result: clear alignments, deliberate spans, generous empty modules.

Hard rules:
- Place every element by grid cells only: column start, column span, row start, row span, numbered from 1. Use only the middle rows you are given; the header and footer rows are drawn by code.
- Elements must not overlap, except text over a photo when you set over=true for that text.
- State only facts found in the saved facts you are given. Never add a date, number, name or claim that is not in them. Dan's note is his own words, not a fact source.
- Copy is short: a headline, then one or two sentences. Plain, precise British English. No exclamation marks.
- Big place names and county names help Dan learn English geography; use them where the idea allows.
- Colour: paper, ink and grey are the neutral base. On top of it choose 0 to 3 colours from the candidates given, each with one role: background (replaces the paper; ink flips to suit it), headline (the headline's colour), accent (rules, list numbers, index tags, the pin marker) or panel (a block of colour behind a photo, with the photo inset by one baseline; set panel=true on that photo). Restraint is fine: one colour, or none, is often strongest. Text needs 4.5:1 contrast, or 3:1 when set at 24 pt or more.

Element kinds:
- headline: one or a few words, scaled by code to fill the width of its cells. Use "\\n" for a line break. Give it enough rows for its lines.
- text: style "lead" (larger, a sentence) or "body" (smaller, up to two sentences).
- label: a short mono uppercase label.
- photo: one of the numbered images. zoom (1 to 4) and focus_x, focus_y (0 to 1) set the crop. tag is an optional small marker such as "1". A poster may use 1 to 3 different images; prefer images marked as not used before.
- list: pin ids from the nearby lists; code adds names and distances.
- pinfield: a dot plot of all of Dan's pins in the country, with this one in the accent colour and pins in the same county ringed. Useful for showing where a place is.
Colours on elements: ink, muted, accent or headline (the headline role's colour).

Text needs room: at body size a single column holds about 3 words per line, so a two-sentence body wants at least 3 or 4 columns and enough rows. Code measures every element and will tell you if text overflows its cells.`;

function cleanFact(s) {
  return (s || '')
    .replace(/\s*\([^()]*(\/[^()]*\/|listen|pronounced|IPA)[^()]*\)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function factText(enrich) {
  const f = enrich.facts;
  const p = enrich.place;
  return [f.pin?.title, f.pin?.description, cleanFact(f.pin?.extract), f.town?.title, f.town?.description, cleanFact(f.town?.extract),
    p.town, p.county, p.borough, p.country, enrich.name].filter(Boolean).join(' \n');
}

function gridBrief(gridCfg) {
  const g = computeGrid(gridCfg);
  const { first, last } = middleRows(g);
  const C = g.columns.length, R = g.rows.length;
  return {
    g, first, last,
    text: `Grid: A4 portrait, ${C} columns of ${g.columns[0].w.toFixed(1)} pt with ${gridCfg.gutter} pt gutters, ${R} rows of ${gridCfg.linesPerModule} baselines (${g.rows[0].h} pt) with one baseline between rows. Baseline ${gridCfg.baseline} pt. Row 1 is the fixed header; row${R - last > 1 ? 's' : ''} ${last + 1}${R - last > 1 ? `–${R}` : ''} the fixed footer. You may use columns 1–${C} and rows ${first}–${last}.`,
  };
}

// Where the place sits in England, as a cell in the middle rows, for "location decides layout".
function locationCell(enrich, g, first, last) {
  const box = { n: 55.81, s: 49.95, w: -5.72, e: 1.76 };
  const C = g.columns.length;
  const x = (enrich.lng - box.w) / (box.e - box.w), y = (box.n - enrich.lat) / (box.n - box.s);
  return { col: Math.min(C, Math.max(1, Math.ceil(x * C))), row: Math.min(last, Math.max(first, first + Math.floor(y * (last - first + 1)))) };
}

async function imageBlock(file) {
  const buf = await sharp(join(ROOT, file)).resize(640, 640, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } };
}

export async function designBrief({ enrich, gridCfg, allowedIdeas, candidates, series, usedImages = new Set() }) {
  const { g, first, last, text: grid } = gridBrief(gridCfg);
  const f = enrich.facts;
  const p = enrich.place;
  const loc = locationCell(enrich, g, first, last);
  const imgs = enrich.images;
  const pairings = gridCfg.fonts.pairings.filter(x => series.fonts.includes(x.id));
  const content = [];
  const lines = [
    grid,
    '',
    `Series: ${series.name}. Font pairings for this series (pick one): ${pairings.map(x => `${x.id} = ${x.name}`).join('; ')}. At most ${series.maxColors} colours beyond the neutral base.`,
    '',
    `Ideas you may use for this poster (pick one): ${allowedIdeas.map(k => `\n- ${k}: ${IDEAS[k]}`).join('')}`,
    allowedIdeas.includes('location-decides-layout') ? `For location-decides-layout, this place's position in England falls at about column ${loc.col}, row ${loc.row}.` : '',
    '',
    `Place: ${enrich.name}`,
    `Town: ${p.town || '—'} · County: ${p.county}${p.borough ? ` · Borough: ${p.borough}` : ''} · Country: ${p.country}`,
    `Category: ${enrich.category}${enrich.themes?.length ? ` (${enrich.themes.join(', ')})` : ''}`,
    `Dan's note (not a fact source): ${enrich.note?.text || '—'}`,
    '',
    'Saved facts (the only facts you may state):',
    f.pin ? `[${f.pin.url}] ${f.pin.title}${f.pin.description ? ` (${f.pin.description})` : ''}: ${cleanFact(f.pin.extract)}` : '(no article for the place itself)',
    f.town && f.town.url !== f.pin?.url ? `[${f.town.url}] ${f.town.title}${f.town.description ? ` (${f.town.description})` : ''}: ${cleanFact(f.town.extract)}` : '',
    '',
    `Nearby pins within 5 km: ${enrich.nearby.within5km.map(n => `${n.id} "${n.name}" ${n.km} km`).join('; ') || 'none'}`,
    `Other pins in ${p.county}: ${enrich.nearby.sameCounty.map(n => `${n.id} "${n.name}" ${n.km} km`).join('; ') || 'none'}`,
    '',
    `Colour candidates (contrast on light paper / dark paper): ${candidates.map(c => `${c.hex} from ${c.source} (${c.light} / ${c.dark})`).join('; ')}`,
    '',
    `Images (attached below in this order; index, kind, size, whether a poster of this place has used it):`,
    ...imgs.map((im, i) => `${i}: ${im.kind === 'upload' ? 'uploaded by Dan with his feedback' : im.kind === 'personal' ? "Dan's own Waypoints photo" : `Commons, ${im.title?.replace(/^File:/, '')}`}${im.width ? `, ${im.width}×${im.height}` : ''}, ${usedImages.has(im.file) ? 'used before' : 'not used yet'}`),
  ];
  content.push({ type: 'text', text: lines.filter(l => l !== '').join('\n').replace(/\n{3,}/g, '\n\n') });
  for (const [i, im] of imgs.entries()) {
    content.push({ type: 'text', text: `Image ${i}:` });
    content.push(await imageBlock(im.file));
  }
  content.push({ type: 'text', text: 'Design the poster. State the idea in one sentence, as in "The club is small; its fame is large, so the name fills the page." List the URLs of the facts you used.' });
  return content;
}

// A new version from Dan's words: the same brief, plus the current version as data and
// as an image, the critic's notes on it, and the feedback.
export async function reviseBrief({ brief, current, png, feedback, uploads = [] }) {
  const data = (await sharp(png).resize(1000, 1414, { fit: 'inside' }).png().toBuffer()).toString('base64');
  const { idea, title, pairing, paper, colors, elements } = current;
  return [
    ...brief.slice(0, -1),
    { type: 'text', text: `The current version of this poster, as designed:\n${JSON.stringify({ idea: idea.key, idea_sentence: idea.sentence, poster_title: title, pairing, paper, colors, elements })}` },
    { type: 'text', text: 'The current version, rendered:' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data } },
    { type: 'text', text: `The critic's notes on it:\n${(current.critic?.notes || []).map(n => `- ${n}`).join('\n') || '(none)'}` },
    { type: 'text', text: `Dan's feedback, which this version must follow:\n"${feedback}"${uploads.length ? `\n\nDan attached ${uploads.length} image${uploads.length > 1 ? 's' : ''} with it: image${uploads.length > 1 ? 's' : ''} ${uploads.join(', ')} in the list above. Use them as his words say: as a photo on the poster, or as a reference for the look.` : ''}\n\nMake a new version that does what Dan asks. Keep what he did not ask to change unless it must move to make room. Facts, image licences and grid rules are unchanged. Return the whole design.` },
  ];
}

function addUsage(total, u) {
  total.tokens_in += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  total.tokens_out += u.output_tokens || 0;
}

async function call({ system, messages, schema, effort, usage }) {
  const res = await client.beta.messages.parse({
    ...BASE,
    max_tokens: 16000,
    output_config: { effort, format: betaZodOutputFormat(schema) },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
  });
  addUsage(usage, res.usage);
  if (res.stop_reason === 'refusal') throw new Error(`model declined: ${res.stop_details?.category || 'no category'}`);
  if (res.stop_reason === 'max_tokens') throw new Error('model ran out of tokens');
  if (!res.parsed_output) throw new Error('model returned no design');
  return res;
}

// A design conversation. Feedback turns are appended, never edited, so the model keeps
// its earlier reasoning.
export function designer({ usage }) {
  const messages = [];
  return {
    async first(content) {
      messages.push({ role: 'user', content });
      const res = await call({ system: DESIGN_SYSTEM, messages, schema: Design, effort: 'high', usage });
      messages.push({ role: 'assistant', content: res.content });
      return res.parsed_output;
    },
    async revise(text) {
      messages.push({ role: 'user', content: [{ type: 'text', text }] });
      const res = await call({ system: DESIGN_SYSTEM, messages, schema: Design, effort: 'high', usage });
      messages.push({ role: 'assistant', content: res.content });
      return res.parsed_output;
    },
  };
}

const CRITIC_SYSTEM = `You are a strict critic of Swiss-style typographic posters, teaching a designer who is new to grid systems. Score each poster from 1 to 10 on: idea (is the stated idea clear and worth it), grid (are elements placed with intent on the grid, with meaningful spans and empty modules), hierarchy (does the eye know where to go), type (sizes, line lengths, rag, pairing), color (paper, accent, photo working together). 7 means good enough to keep without changes.

Write every note in grid terms, naming columns, rows, spans and modules, for example: "the headline spans 9 of 12 columns; the caption sits one module too low." Each note should say what to change. Do not comment on facts or the fixed header and footer text.

When Dan's feedback is given, also score followed (1 to 10): how fully this version does what he asked, and say in a note what it did or missed.`;

export async function critique({ png, gridCfg, layout, design, usage, feedback = null }) {
  const { text: grid } = gridBrief(gridCfg);
  const data = (await sharp(png).resize(1000, 1414, { fit: 'inside' }).png().toBuffer()).toString('base64');
  const res = await call({
    system: CRITIC_SYSTEM,
    schema: feedback ? CritiqueFeedback : Critique,
    effort: 'medium',
    usage,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data } },
        { type: 'text', text: `${grid}\n\nStated idea: ${design.idea_sentence}\n\nColours: ${(design.colors || []).map(c => `${c.hex} as ${c.role}`).join(', ') || 'neutral base only'}\n\nElements, in grid terms:\n${layout}${feedback ? `\n\nDan's feedback this version was made to follow: "${feedback}"` : ''}\n\nScore this poster and give your notes.` },
      ],
    }],
  });
  const c = res.parsed_output;
  const vals = Object.values(c.scores);
  return { ...c, mean: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 };
}
