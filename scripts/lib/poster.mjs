// Builds a poster's render spec from a design (the model's grid plan) and checks it.
// The fixed frame (header, footer, colours) is made here by code, never by the model.
import { computeGrid, distribute } from '../../grid/grid.js';

export const IDEAS = {
  'place-name-at-scale': 'Place name at scale: the city or county name fills the page; the place sits inside it.',
  'location-decides-layout': 'Location decides layout: the photo sits in the grid cell matching where the place is in the country.',
  'closer': 'Closer: one photo three times, each larger, stepping across the grid.',
  'nearby': 'Nearby: the place plus its nearby pins, listed with distances.',
};

export const UNION_JACK = { red: '#C8102E', blue: '#012169' };

const PAPERS = {
  light: { paper: '#EBEAE5', ink: '#1D1D1B', muted: '#5F5E58', rule: '#B9B8B1' },
  dark: { paper: '#161615', ink: '#EDECE7', muted: '#A3A29B', rule: '#3A3A37' },
};

// ---------- Colour ----------

function luminance(hex) {
  const v = hex.replace('#', '').match(/../g).map(h => parseInt(h, 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

// Accent options for a poster: each photo's strongest colour plus the Union Jack red and
// blue for UK places, kept only where it reads at 4.5:1 on that paper.
export function accentOptions(enrich) {
  const out = [];
  const seen = new Set();
  const add = (hex, source) => {
    hex = hex.toUpperCase();
    if (seen.has(hex)) return;
    seen.add(hex);
    out.push({
      hex, source,
      light: Math.round(contrast(hex, PAPERS.light.paper) * 10) / 10,
      dark: Math.round(contrast(hex, PAPERS.dark.paper) * 10) / 10,
    });
  };
  enrich.images.forEach((im, i) => im.colors?.strongest && add(im.colors.strongest, `photo ${i}`));
  if (enrich.place?.sovereign === 'United Kingdom') {
    add(UNION_JACK.red, 'Union Jack red');
    add(UNION_JACK.blue, 'Union Jack blue');
  }
  return out.filter(o => o.light >= 4.5 || o.dark >= 4.5);
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
  return [image.author, image.license].filter(Boolean).join(', ');
}

function frame(g, { title, enrich, pin, number, total, image }) {
  const C = g.columns.length, R = g.rows.length;
  const { footRows } = middleRows(g);
  const place = enrich.place;
  const county = place.borough ? `${place.county} · ${place.borough}` : place.county;
  const els = [];
  let c = 1;
  const head = [['WAYPOINTS'], [title], [county], [`${String(number).padStart(2, '0')} / ${String(total).padStart(2, '0')}`]];
  distribute(C, [1, 2, 2, 1]).forEach((cs, i) => {
    els.push({ id: `header-${i + 1}`, name: ['Header: series', 'Header: title', 'Header: county', 'Header: number'][i], kind: 'label', frame: true, c, cs, r: 1, rs: 1, text: head[i][0], align: i === 3 ? 'right' : 'left', color: 'ink' });
    c += cs;
  });
  const cat = pin.category ? pin.category[0].toUpperCase() + pin.category.slice(1) : '';
  const foot = [['Place', cleanName(pin.name)], ['County', county], ['Country', place.country], ['Category', cat], ['Photo', photoCredit(image)]];
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
  return els;
}

// ---------- Spec ----------

const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export function buildSpec({ design, gridCfg, enrich, pin, allEnrich, number, total }) {
  const g = computeGrid(gridCfg);
  const pairing = gridCfg.fonts.pairings.find(p => p.id === design.pairing) || gridCfg.fonts.pairings[0];
  const paper = PAPERS[design.paper] || PAPERS.light;
  const theme = { ...paper, accent: design.accent };

  const firstPhoto = design.elements.find(e => e.kind === 'photo');
  const image = firstPhoto ? enrich.images[firstPhoto.image] : null;

  const middle = design.elements.map((e, i) => {
    const el = {
      id: `el-${i + 1}`, name: e.name || `${e.kind} ${i + 1}`, kind: e.kind,
      c: e.col, cs: e.col_span, r: e.row, rs: e.row_span,
      color: e.color || 'ink', align: e.align || 'left', over: !!e.over,
    };
    if (e.kind === 'headline' || e.kind === 'text' || e.kind === 'label') { el.text = e.text || ''; if (e.kind === 'text') el.style = e.style || 'body'; }
    if (e.kind === 'photo') {
      const im = enrich.images[e.image];
      el.image = e.image;
      el.src = im ? `../${im.file}` : '';
      el.zoom = e.zoom || 1;
      el.focus = [e.focus_x ?? 0.5, e.focus_y ?? 0.5];
      if (e.tag) el.tag = e.tag;
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

  const elements = [...frame(g, { title: design.poster_title, enrich, pin, number, total, image }), ...middle];
  return { grid: gridCfg, pairing, theme, elements };
}

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

export function checkSpec(spec, { design, enrich, report, factText }) {
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

  // 4. Contrast at least 4.5:1, against the paper or, for text over a photo, the photo's main colour.
  for (const e of mid) {
    if (!['headline', 'text', 'label', 'list'].includes(e.kind)) continue;
    const fg = spec.theme[e.color] || spec.theme.ink;
    let bg = spec.theme.paper;
    if (e.over) {
      const photo = mid.find(p => p.kind === 'photo' && hit(box(p), box(e)));
      const main = photo && enrich.images[photo.image]?.colors?.palette?.[0]?.hex;
      if (main) bg = main;
    }
    const ratio = contrast(fg, bg);
    if (ratio < 4.5) problems.push({ check: 'contrast', msg: `${where(e)}: ${e.color} ${fg} on ${bg} is ${ratio.toFixed(1)}:1, needs 4.5:1` });
  }

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
