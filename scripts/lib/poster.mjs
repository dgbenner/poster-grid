// Builds a poster's render spec from a design (the model's grid plan) and checks it.
// The fixed frame (header, footer, colours) is made here by code, never by the model.
import { computeGrid, distribute } from '../../grid/grid.js';

export const IDEAS = {
  'place-name-at-scale': 'Place name at scale: the city or county name fills the page; the place sits inside it.',
  'location-decides-layout': 'Location decides layout: the photo sits in the grid cell matching where the place is in the country.',
  'closer': 'Closer: the place seen three times, each larger, stepping across the grid; one photo cropped closer each time, or different photos moving in.',
  'nearby': 'Nearby: the place plus its nearby pins, listed with distances.',
};

export const UNION_JACK = { red: '#C8102E', blue: '#012169' };
export const ROLES = ['background', 'headline', 'accent', 'panel'];

// The neutral base. These never count toward a poster's colour limit.
const PAPERS = {
  light: { paper: '#EBEAE5', ink: '#1D1D1B', muted: '#5F5E58', rule: '#B9B8B1' },
  dark: { paper: '#161615', ink: '#EDECE7', muted: '#A3A29B', rule: '#3A3A37' },
};
const NEUTRALS = new Set(Object.values(PAPERS).flatMap(p => Object.values(p)));

// ---------- Colour ----------

const rgb = hex => hex.replace('#', '').match(/../g).map(h => parseInt(h, 16));
const toHex = c => '#' + c.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase();

function luminance(hex) {
  const v = rgb(hex).map(c => c / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

// CIE Lab (D65), for judging how different two colours look.
export function lab(hex) {
  const [r, g, b] = rgb(hex).map(c => c / 255).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
const chroma = hex => { const [, a, b] = lab(hex); return Math.hypot(a, b); };
const mix = (a, b, t) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));

// Up to 6 colour candidates from a place's photos: each photo's palette, weighted by how
// much of the photo a colour covers and how vivid it is, minus near-greys and colours
// within 20 (Lab) of one already chosen. Union Jack red and blue are added for UK places.
export function colorCandidates(enrich, imageIdx = null) {
  const pool = [];
  enrich.images.forEach((im, i) => {
    if (imageIdx && !imageIdx.includes(i)) return;
    for (const c of im.colors?.palette || []) pool.push({ hex: c.hex.toUpperCase(), source: `photo ${i}`, weight: c.share * chroma(c.hex) });
  });
  const picked = [];
  for (const c of pool.filter(c => chroma(c.hex) >= 15).sort((a, b) => b.weight - a.weight)) {
    if (picked.length === 6) break;
    if (picked.every(p => deltaE(p.hex, c.hex) >= 20)) picked.push(c);
  }
  const out = picked.map(({ hex, source }) => ({ hex, source }));
  if (enrich.place?.sovereign === 'United Kingdom') {
    out.push({ hex: UNION_JACK.red, source: 'Union Jack red' }, { hex: UNION_JACK.blue, source: 'Union Jack blue' });
  }
  return out.map(c => ({
    ...c,
    light: Math.round(contrast(c.hex, PAPERS.light.paper) * 10) / 10,
    dark: Math.round(contrast(c.hex, PAPERS.dark.paper) * 10) / 10,
  }));
}

// The poster's palette: the neutral base, adjusted to a coloured background when one is
// chosen, plus the designer's colours in their roles. Ink is whichever of the two neutral
// inks reads better on the background.
export function themeFor(design) {
  const base = PAPERS[design.paper] || PAPERS.light;
  const role = r => (design.colors || []).find(c => c.role === r)?.hex?.toUpperCase();
  const theme = { ...base };
  const bg = role('background');
  if (bg) {
    theme.paper = bg;
    theme.ink = contrast(PAPERS.light.ink, bg) >= contrast(PAPERS.dark.ink, bg) ? PAPERS.light.ink : PAPERS.dark.ink;
    const muted = mix(theme.ink, bg, 0.3);
    theme.muted = contrast(muted, bg) >= 4.5 ? muted : theme.ink;
    theme.rule = mix(theme.ink, bg, 0.7);
  }
  theme.headline = role('headline') || theme.ink;
  theme.accent = role('accent') || theme.ink;
  theme.panel = role('panel') || null;
  return theme;
}

// ---------- Frame ----------

export function middleRows(g) {
  const footRows = g.columns.length >= 5 ? 1 : 2;
  return { first: 2, last: g.rows.length - footRows, footRows };
}

const cleanName = n => n.replace(/\(.*?\)/g, '').split(/\s+[—–]\s+|\s+-\s+|\s*\/\s*/)[0].trim();

export function photoCredit(image) {
  if (!image) return 'No photo';
  if (image.kind === 'personal') return 'Waypoints photo, personal use';
  // Attached images may not be Dan's own photos, so they are credited as supplied by him.
  if (image.kind === 'upload') return 'Supplied by Dan, personal use';
  return [image.author, image.license].filter(Boolean).join(', ');
}

// Identical credits (two of Dan's photos, say) are listed once.
export const photoCredits = images => images.length ? [...new Set(images.map(photoCredit))].join('; ') : 'No photo';

function frame(g, { title, enrich, pin, number, total, images, creditsLine, series }) {
  const C = g.columns.length, R = g.rows.length;
  const { footRows } = middleRows(g);
  const place = enrich.place;
  const county = place.borough ? `${place.county} · ${place.borough}` : place.county;
  const els = [];
  let c = 1;
  const tag = series && series !== 'Original' ? `${series.toUpperCase()} · ` : '';
  const head = [['WAYPOINTS'], [title], [county], [`${tag}${String(number).padStart(2, '0')} / ${String(total).padStart(2, '0')}`]];
  distribute(C, [1, 2, 2, 1]).forEach((cs, i) => {
    els.push({ id: `header-${i + 1}`, name: ['Header: series', 'Header: title', 'Header: county', 'Header: number'][i], kind: 'label', frame: true, c, cs, r: 1, rs: 1, text: head[i][0], align: i === 3 ? 'right' : 'left', color: 'ink' });
    c += cs;
  });
  const cat = pin.category ? pin.category[0].toUpperCase() + pin.category.slice(1) : '';
  const foot = [['Place', cleanName(pin.name)], ['County', county], ['Country', place.country], ['Category', cat], ['Photo', creditsLine ? 'Credits below' : photoCredits(images)]];
  const fr = R - footRows + 1;
  els.push({ id: 'footer-rule', name: 'Footer: rule', kind: 'rule', frame: true, c: 1, cs: C, r: fr, rs: footRows });
  if (C >= 5) {
    c = 1;
    distribute(C, [1, 2, 1, 1, 1]).forEach((cs, i) => {
      els.push({ id: `footer-${i + 1}`, name: `Footer: ${foot[i][0].toLowerCase()}`, kind: 'foot', frame: true, c, cs, r: fr, rs: 1, label: foot[i][0], value: foot[i][1] });
      c += cs;
    });
  } else {
    foot.slice(0, 4).forEach((f, i) => els.push({ id: `footer-${i + 1}`, name: `Footer: ${f[0].toLowerCase()}`, kind: 'foot', frame: true, c: i + 1, cs: 1, r: fr, rs: 1, label: f[0], value: f[1] }));
    els.push({ id: 'footer-5', name: 'Footer: photo', kind: 'foot', frame: true, c: 1, cs: C, r: fr + 1, rs: 1, label: foot[4][0], value: foot[4][1] });
  }
  // Credits that don't fit the PHOTO cell run along the footer's last baseline, full width.
  if (creditsLine) {
    const L = g.linesPerModule;
    els.push({ id: 'credits', name: 'Footer: credits', kind: 'credits', frame: true, c: 1, cs: C, r: R, rs: 1, text: '\n'.repeat(Math.max(0, L - 1)) + `Photos: ${photoCredits(images)}` });
  }
  return els;
}

// ---------- Spec ----------

const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export function buildSpec({ design, gridCfg, enrich, pin, allEnrich, number, total, series, creditsLine = false }) {
  const g = computeGrid(gridCfg);
  const pairing = gridCfg.fonts.pairings.find(p => p.id === design.pairing) || gridCfg.fonts.pairings[0];
  const theme = themeFor(design);
  const used = imagesUsed(design);
  const images = used.map(i => enrich.images[i]).filter(Boolean);

  const middle = design.elements.map((e, i) => {
    const el = {
      id: `el-${i + 1}`, name: e.name || `${e.kind} ${i + 1}`, kind: e.kind,
      c: e.col, cs: e.col_span, r: e.row, rs: e.row_span,
      color: e.color || (e.kind === 'headline' ? 'headline' : 'ink'), align: e.align || 'left', over: !!e.over,
    };
    if (e.kind === 'headline' || e.kind === 'text' || e.kind === 'label') { el.text = e.text || ''; if (e.kind === 'text') el.style = e.style || 'body'; }
    if (e.kind === 'photo') {
      const im = enrich.images[e.image];
      el.image = e.image;
      el.src = im ? `../${im.file}` : '';
      el.zoom = e.zoom || 1;
      el.focus = [e.focus_x ?? 0.5, e.focus_y ?? 0.5];
      if (e.tag) el.tag = e.tag;
      if (e.panel) el.panel = true;
    }
    if (e.kind === 'list') {
      const near = [...enrich.nearby.within5km, ...enrich.nearby.sameCounty];
      el.items = (e.items || []).map((id, k) => {
        const n = near.find(x => x.id === id);
        return n ? { id, n: String(k + 1).padStart(2, '0'), name: cleanName(n.name), km: `${round(n.km)} km` } : { id, missing: true };
      });
    }
    if (e.kind === 'pinfield') {
      const country = enrich.place.country;
      const others = allEnrich.filter(o => o.place?.country === country);
      el.dots = {
        points: others.map(o => [o.lat, o.lng]),
        here: [enrich.lat, enrich.lng],
        ring: enrich.nearby.sameCounty.map(n => allEnrich.find(o => o.id === n.id)).filter(Boolean).map(o => [o.lat, o.lng]),
      };
    }
    return el;
  });

  const elements = [...frame(g, { title: design.poster_title, enrich, pin, number, total, images, creditsLine, series }), ...middle];
  return { grid: gridCfg, pairing, theme, elements };
}

// Distinct images a design uses, in order of first use.
export const imagesUsed = design => [...new Set(design.elements.filter(e => e.kind === 'photo' && Number.isInteger(e.image)).map(e => e.image))];

// ---------- Checks (code, not model) ----------

// "Stray punctuation from data": citation marks, empty brackets, doubled or dangling
// punctuation, unbalanced brackets and quotes, HTML entities.
export function punctuationProblems(s) {
  const out = [];
  if (/\[\d+\]|\[citation needed\]/i.test(s)) out.push('citation marker');
  if (/\(\s*[;,]?\s*\)/.test(s)) out.push('empty brackets');
  if (/\s[,.;:!?]/.test(s)) out.push('space before punctuation');
  if (/([,;:])\1|[,;:][.]|\.\.(?!\.)/.test(s)) out.push('doubled punctuation');
  if (/[,;:(—–-]\s*$/.test(s)) out.push('dangling punctuation at end');
  if (/^\s*[,.;:)]/.test(s)) out.push('punctuation at start');
  if (/ {2,}/.test(s)) out.push('double space');
  if (/&[a-z]+;|&#\d+;/.test(s)) out.push('HTML entity');
  if ((s.match(/\(/g) || []).length !== (s.match(/\)/g) || []).length) out.push('unbalanced brackets');
  if ((s.match(/"/g) || []).length % 2) out.push('unbalanced quotes');
  return out;
}

// Every number in the copy must appear in the saved facts.
export function unsourcedNumbers(s, sources) {
  const nums = s.match(/\d[\d,.]*\d|\d/g) || [];
  const hay = sources.replace(/(\d),(\d{3})/g, '$1$2');
  return nums.map(n => n.replace(/,(\d{3})/g, '$1').replace(/\.$/, '')).filter(n => !hay.includes(n));
}

export function checkSpec(spec, { design, enrich, report, factText, candidates, maxColors }) {
  const g = computeGrid(spec.grid);
  const C = g.columns.length, R = g.rows.length;
  const { first, last } = middleRows(g);
  const problems = [];
  const where = e => `${e.name} (columns ${e.c}–${e.c + e.cs - 1}, rows ${e.r}–${e.r + e.rs - 1})`;
  const mid = spec.elements.filter(e => !e.frame);

  // 1. On the grid, inside the margins, inside the middle rows.
  for (const e of mid) {
    const ints = [e.c, e.cs, e.r, e.rs].every(Number.isInteger);
    if (!ints || e.cs < 1 || e.rs < 1 || e.c < 1 || e.c + e.cs - 1 > C || e.r < 1 || e.r + e.rs - 1 > R) {
      problems.push({ check: 'off-grid', msg: `${where(e)} is off the ${C}×${R} grid` });
    } else if (e.r < first || e.r + e.rs - 1 > last) {
      problems.push({ check: 'frame', msg: `${where(e)} enters the fixed header or footer; use rows ${first}–${last}` });
    }
  }

  // 2. No text leaving its cells (measured in the browser).
  for (const e of spec.elements) {
    if (report?.[e.id]?.overflow) problems.push({ check: 'overflow', msg: `${where(e)}: text overflows its cells; give it more cells or fewer words` });
  }

  // 3. No unintended overlaps. Text may sit over a photo only when marked "over".
  const box = e => ({ c0: e.c, c1: e.c + e.cs - 1, r0: e.r, r1: e.r + e.rs - 1 });
  const hit = (a, b) => !(a.c1 < b.c0 || b.c1 < a.c0 || a.r1 < b.r0 || b.r1 < a.r0);
  for (let i = 0; i < mid.length; i++) {
    for (let j = i + 1; j < mid.length; j++) {
      const a = mid[i], b = mid[j];
      if (!hit(box(a), box(b))) continue;
      const photo = [a, b].find(e => e.kind === 'photo');
      const other = photo === a ? b : a;
      const intended = photo && other.over && ['headline', 'label', 'text'].includes(other.kind);
      if (!intended) problems.push({ check: 'overlap', msg: `${where(a)} overlaps ${where(b)}` });
    }
  }

  // 4. Contrast: 4.5:1 for text, 3:1 for text set at 24 pt or larger. Against the paper
  // or, for text over a photo, the photo's main colour. Frame text included.
  const bgOf = e => {
    if (!e.over) return spec.theme.paper;
    const photo = mid.find(p => p.kind === 'photo' && hit(box(p), box(e)));
    return (photo && enrich.images[photo.image]?.colors?.palette?.[0]?.hex) || spec.theme.paper;
  };
  for (const e of spec.elements) {
    if (!['headline', 'text', 'label', 'list', 'foot', 'credits'].includes(e.kind)) continue;
    const fg = e.kind === 'foot' || e.kind === 'credits' ? spec.theme.ink : spec.theme[e.color] || spec.theme.ink;
    const bg = bgOf(e);
    const size = report?.[e.id]?.size ?? 0;
    const need = size >= 24 ? 3 : 4.5;
    const ratio = contrast(fg, bg);
    if (ratio < need) problems.push({ check: 'contrast', msg: `${where(e)}: ${e.color || 'ink'} ${fg} on ${bg} is ${ratio.toFixed(1)}:1, needs ${need}:1${size >= 24 ? ' (large text)' : ''}` });
  }
  if (spec.theme.muted !== spec.theme.ink && contrast(spec.theme.muted, spec.theme.paper) < 4.5) {
    problems.push({ check: 'contrast', msg: `muted ${spec.theme.muted} on ${spec.theme.paper} is below 4.5:1` });
  }

  // 4b. Colours: at most the series limit (never more than 3) beyond the neutral base, each
  // taken from the candidates or the national colours, one role each.
  const colors = design.colors || [];
  const allowed = new Set((candidates || []).map(c => c.hex.toUpperCase()));
  const limit = Math.min(3, maxColors ?? 3);
  if (colors.length > limit) problems.push({ check: 'colors', msg: `${colors.length} colours; this series allows ${limit} beyond paper, ink and grey` });
  for (const c of colors) {
    const hex = (c.hex || '').toUpperCase();
    if (!allowed.has(hex) && !NEUTRALS.has(hex)) problems.push({ check: 'colors', msg: `${hex} (${c.role}) is not one of the candidate colours` });
  }
  const roles = colors.map(c => c.role);
  if (new Set(roles).size !== roles.length) problems.push({ check: 'colors', msg: `each role takes one colour; got ${roles.join(', ')}` });
  if (mid.some(e => e.panel) && !spec.theme.panel) problems.push({ check: 'colors', msg: 'a photo asks for a panel but no colour has the panel role' });

  // 5. Clean copy: no stray punctuation, no numbers without a saved source.
  const strings = [design.poster_title, ...mid.filter(e => e.text).map(e => e.text)];
  for (const s of strings) {
    for (const p of punctuationProblems(s)) problems.push({ check: 'punctuation', msg: `"${s}": ${p}` });
    for (const n of unsourcedNumbers(s, factText)) problems.push({ check: 'facts', msg: `"${s}": the number ${n} is not in the saved facts` });
  }

  // 6. Headlines break between words, never inside one: "Maccles / field" or
  // "North / umberland" teach the wrong name.
  const words = new Set((factText.match(/[\p{L}'’-]+/gu) || []).map(w => w.toLowerCase()));
  for (const e of mid.filter(e => e.kind === 'headline' && e.text.includes('\n'))) {
    const lines = e.text.split('\n').map(l => l.trim());
    for (let k = 0; k < lines.length - 1; k++) {
      const a = lines[k].split(/\s+/).pop(), b = lines[k + 1].split(/\s+/)[0];
      const joined = (a + b).toLowerCase().replace(/[^\p{L}'’-]/gu, '');
      if (words.has(joined)) problems.push({ check: 'word-break', msg: `${where(e)}: the line break splits "${a + b}"; break between words only` });
    }
  }

  // 7. Photos must not be enlarged past their resolution: at least 1.25 source pixels per
  // point after the crop and zoom, so they stay sharp on screen.
  for (const e of mid.filter(e => e.kind === 'photo')) {
    const nat = report?.[e.id]?.natural, rect = report?.[e.id]?.rect;
    if (!nat?.[0] || !rect) continue;
    const ptPerPx = Math.max(rect.w / nat[0], rect.h / nat[1]) * (e.zoom || 1);
    if (ptPerPx > 0.8) problems.push({ check: 'resolution', msg: `${where(e)}: image ${e.image} is ${nat[0]}×${nat[1]} px, enlarged ${(ptPerPx * 1.25).toFixed(1)}× past sharp at this size and zoom; use less zoom, fewer cells or a larger image` });
  }

  // 8. References resolve.
  for (const e of mid) {
    if (e.color && !['ink', 'muted', 'accent', 'headline'].includes(e.color)) problems.push({ check: 'colors', msg: `${where(e)}: unknown colour ${e.color}` });
    if (e.kind === 'photo' && !enrich.images[e.image]) problems.push({ check: 'image', msg: `${where(e)}: no image ${e.image}` });
    if (e.kind === 'list' && (e.items || []).some(it => it.missing)) problems.push({ check: 'list', msg: `${where(e)}: list names a pin that is not nearby` });
  }
  for (const f of report?._fontsMissing || []) problems.push({ check: 'fonts', msg: `font did not load: ${f}` });
  for (const im of report?._images || []) if (!im.ok) problems.push({ check: 'image', msg: `image failed to load: ${im.src}` });

  return problems;
}

// The poster in grid terms, for the critic and the gallery.
export function describeLayout(spec) {
  const g = computeGrid(spec.grid);
  const C = g.columns.length, R = g.rows.length;
  return spec.elements.filter(e => !e.frame).map(e => {
    const what = e.text ? ` "${e.text.replace(/\n/g, ' / ').slice(0, 60)}"` : e.kind === 'photo' ? ` image ${e.image}${e.zoom > 1 ? ` at ${e.zoom}×` : ''}` : '';
    return `${e.name} [${e.kind}${what}]: columns ${e.c}–${e.c + e.cs - 1} (${e.cs} of ${C}), rows ${e.r}–${e.r + e.rs - 1} (${e.rs} of ${R})${e.over ? ', over the photo' : ''}`;
  }).join('\n');
}
