import { computeGrid, distribute } from '../grid/grid.js';

const NS = 'http://www.w3.org/2000/svg';
const $ = (sel, root = document) => root.querySelector(sel);
const clone = o => JSON.parse(JSON.stringify(o));
const wait = ms => new Promise(r => setTimeout(r, ms));
const fmt = n => String(Math.round(n * 10) / 10);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const PARTS = [
  { key: 'margins', name: 'Margins', note: 'The empty border that frames the content' },
  { key: 'columns', name: 'Columns', note: 'Vertical divisions that set where things can start and end' },
  { key: 'gutters', name: 'Gutters', note: 'The gaps between columns, so content doesn’t touch' },
  { key: 'baseline', name: 'Baseline', note: 'Evenly spaced lines every line of text sits on' },
  { key: 'modules', name: 'Rows and modules', note: 'Horizontal divisions; where rows and columns cross are modules, the cells elements snap to' },
];

const CONTROLS = {
  margins:  { type: 'range', prop: 'margin', min: 18, max: 72, step: 3 },
  columns:  { type: 'seg', prop: 'columns', options: [4, 6, 8, 12] },
  gutters:  { type: 'range', prop: 'gutter', min: 0, max: 24, step: 1 },
  baseline: { type: 'seg', prop: 'baseline', options: [8, 10, 12] },
  modules:  { type: 'range', prop: 'linesPerModule', min: 2, max: 8, step: 1 },
};

// Placeholder content. Phase 1 has no data and states no facts; it only has the
// shapes of a real poster so the grid has something to hold.
const S = {
  title: 'Saffron Walden', county: 'Essex', country: 'England', category: 'Town',
  number: '01 / 10', photo: 'Placeholder', coords: ['52.02° N', '0.24° E'],
  body: 'Sample copy. Every line of this paragraph sits on the baseline. Change the baseline and the page resets its rhythm; change the columns and this block narrows or widens to the cells it spans.',
};

let saved, cfg, g;
let scale = 1;
let zoom = 'fit';
let run = 0;            // bumped on every render; a running build stops when it changes
let building = false;
let els = [];
const layers = {};
const show = { margins: true, columns: true, gutters: false, baseline: true, modules: false };
let stash = null;       // overlay state kept while G hides everything

init();

async function init() {
  try {
    const res = await fetch('../grid/grid.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    saved = await res.json();
  } catch {
    narrate('Could not load grid/grid.json. Start the lab with <b>npm run lab</b> and open it from that address.');
    return;
  }
  cfg = clone(saved);
  // Saving needs the local server (npm run lab); on the published site the file is read-only.
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) {
    $('.block.file').innerHTML = '<h2 class="block-title">grid/grid.json</h2><p class="hint">Read-only here. Changes are live in the lab but are only saved when it runs locally.</p>';
  }
  loadFonts(cfg.fonts.pairings);
  buildPanel();
  $('#play').addEventListener('click', playBuild);
  $('#save')?.addEventListener('click', save);
  $('#revert')?.addEventListener('click', () => { cfg = clone(saved); syncPanel(); render(); });
  $('#overlayAll').addEventListener('click', toggleAll);
  $('#zoom').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    zoom = b.dataset.zoom === 'fit' ? 'fit' : Number(b.dataset.zoom);
    $('#zoom').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
    render();
  });
  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'g' || e.key === 'G') toggleAll();
    if (e.key === 'p' || e.key === 'P') playBuild();
  });
  let t;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(render, 120); });
  document.fonts.addEventListener?.('loadingdone', () => { if (!building) render(); });
  render();
}

function loadFonts(pairings) {
  const families = pairings.flatMap(p => p.google);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${families.map(f => 'family=' + f).join('&')}&display=swap`;
  document.head.append(link);
}

const pairing = () => cfg.fonts.pairings.find(p => p.id === cfg.fonts.active) || cfg.fonts.pairings[0];

// ---------- Panel ----------

function buildPanel() {
  const box = $('#parts');
  for (const part of PARTS) {
    const ctl = CONTROLS[part.key];
    const sec = document.createElement('section');
    sec.className = 'part';
    sec.dataset.part = part.key;
    sec.innerHTML = `
      <div class="part-head">
        <label class="switch"><input type="checkbox" aria-label="Show ${part.name.toLowerCase()}"><span class="track"><span class="knob"></span></span></label>
        <span class="swatch sw-${part.key}" aria-hidden="true"></span>
        <h3>${part.name}</h3>
        <output></output>
      </div>
      <p class="note">${part.note}</p>
      <div class="control"></div>`;
    sec.querySelector('input').addEventListener('change', e => { show[part.key] = e.target.checked; stash = null; applyVisibility(); });
    const c = sec.querySelector('.control');
    if (ctl.type === 'range') {
      const r = Object.assign(document.createElement('input'), { type: 'range', min: ctl.min, max: ctl.max, step: ctl.step });
      r.setAttribute('aria-label', part.name);
      r.addEventListener('input', () => { cfg[ctl.prop] = Number(r.value); render(); });
      c.append(r);
    } else {
      const seg = document.createElement('div');
      seg.className = 'seg';
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', part.name);
      for (const v of ctl.options) {
        const b = Object.assign(document.createElement('button'), { type: 'button', textContent: v });
        b.addEventListener('click', () => { cfg[ctl.prop] = v; syncPanel(); render(); });
        seg.append(b);
      }
      c.append(seg);
    }
    box.append(sec);
  }

  const pb = $('#pairings');
  for (const p of cfg.fonts.pairings) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pairing';
    b.dataset.id = p.id;
    b.innerHTML = `
      <span class="p-head" style="font-family:'${p.headline.family}';font-weight:${p.headline.weight}">${p.headline.family}</span>
      <span class="p-text" style="font-family:'${p.text.family}'">Text in ${p.text.family}</span>
      <span class="p-label" style="font-family:'${p.label.family}'">Labels in ${p.label.family}</span>`;
    b.addEventListener('click', () => { cfg.fonts.active = p.id; syncPanel(); render(); });
    pb.append(b);
  }
  syncPanel();
}

function syncPanel() {
  for (const part of PARTS) {
    const sec = $(`.part[data-part="${part.key}"]`);
    const ctl = CONTROLS[part.key];
    sec.querySelector('input[type="checkbox"]').checked = show[part.key];
    sec.classList.toggle('off', !show[part.key]);
    if (ctl.type === 'range') sec.querySelector('input[type="range"]').value = cfg[ctl.prop];
    else sec.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', Number(b.textContent) === cfg[ctl.prop]));
  }
  document.querySelectorAll('.pairing').forEach(b => b.setAttribute('aria-pressed', b.dataset.id === cfg.fonts.active));
}

function updateOutputs() {
  const C = g.columns.length, R = g.rows.length;
  const out = {
    margins: `${cfg.margin} pt`,
    columns: `${C} × ${fmt(g.columns[0].w)} pt`,
    gutters: `${cfg.gutter} pt`,
    baseline: `${cfg.baseline} pt`,
    modules: `${cfg.linesPerModule} lines → ${R} rows`,
  };
  for (const k in out) $(`.part[data-part="${k}"] output`).textContent = out[k];
}

function updateReadout() {
  const C = g.columns.length, R = g.rows.length, m = g.margins;
  const body = typeFor('body');
  const over = els.filter(e => e.overflow);
  const rows = [
    ['Page', `${g.page.name} · ${fmt(g.page.width)} × ${fmt(g.page.height)} pt`],
    ['Margins (t r b l)', `${fmt(m.top)} ${fmt(m.right)} ${fmt(m.bottom)} ${fmt(m.left)}`],
    ['Bottom margin', `absorbs ${fmt(m.bottom - cfg.margin)} pt left over`],
    ['Column width', `${fmt(g.columns[0].w)} pt`],
    ['Module', `${fmt(g.columns[0].w)} × ${fmt(g.rows[0].h)} pt`],
    ['Grid', `${C} columns × ${R} rows = ${C * R} modules`],
    ['Baselines', `${g.baselines.length} lines, ${cfg.baseline} pt apart`],
    ['Body text', `${fmt(body.size)} pt on ${fmt(body.lh)} pt leading`],
    ['Fit check', over.length ? `${over.length} overflow${over.length > 1 ? 's' : ''}: ${over.map(e => e.name).join(', ')}` : 'all text fits its cells', over.length ? 'bad' : 'good'],
  ];
  $('#readout').innerHTML = rows.map(([k, v, cls]) => `<dt>${k}</dt><dd class="${cls || ''}">${v}</dd>`).join('');
}

function updateDirty() {
  if (!$('#save')) return;
  const dirty = JSON.stringify(cfg) !== JSON.stringify(saved);
  $('#save').disabled = !dirty;
  $('#revert').disabled = !dirty;
  if (dirty) $('#status').textContent = 'unsaved changes';
  else if ($('#status').textContent === 'unsaved changes') $('#status').textContent = '';
}

async function save() {
  $('#status').textContent = 'saving…';
  try {
    const res = await fetch('../grid/grid.json', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cfg, null, 2),
    });
    if (!res.ok) throw new Error(await res.text());
    saved = clone(cfg);
    $('#status').textContent = 'saved';
  } catch (err) {
    $('#status').textContent = `not saved: ${err.message}`;
  }
  updateDirty();
}

// ---------- Render ----------

async function render() {
  const id = ++run;
  if (building) { building = false; setPlay(); }
  g = computeGrid(cfg);
  fitPage();
  drawOverlay();
  applyVisibility();
  updateOutputs();
  updateDirty();
  const p = pairing();
  await Promise.all([p.headline, p.text, p.label].map(f => document.fonts.load(`${f.weight} 40px "${f.family}"`))).catch(() => {});
  if (id !== run) return;
  layoutSample();
  updateReadout();
  narrate(idleText());
}

function idleText() {
  return 'Hover an element to see the cells it occupies. <b>G</b> toggles the overlay. <b>P</b> plays the build.';
}

function fitPage() {
  const vp = $('#viewport');
  const { width: W, height: H } = cfg.page;
  scale = zoom === 'fit'
    ? Math.max(0.2, Math.min((vp.clientWidth - 40) / W, (vp.clientHeight - 40) / H))
    : zoom * 4 / 3; // 100% = real size: 1 pt = 4/3 CSS px
  const paper = $('#paper');
  paper.style.width = W + 'px';
  paper.style.height = H + 'px';
  paper.style.transform = `scale(${scale})`;
  $('#paperWrap').style.width = W * scale + 'px';
  $('#paperWrap').style.height = H * scale + 'px';
  vp.classList.toggle('scrolling', zoom !== 'fit');
}

function svg(tag, attrs = {}, text) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
}

function drawOverlay() {
  const ov = $('#overlay'), hl = $('#hl');
  const { width: W, height: H } = g.page;
  for (const s of [ov, hl]) {
    s.setAttribute('viewBox', `0 0 ${W} ${H}`);
    s.setAttribute('width', W);
    s.setAttribute('height', H);
  }
  ov.replaceChildren();
  hl.replaceChildren();
  const c = g.content;
  const layer = key => (layers[key] = ov.appendChild(svg('g', { class: key })));

  const m = layer('margins');
  m.append(svg('path', { class: 'm-fill', 'fill-rule': 'evenodd', d: `M0 0H${W}V${H}H0Z M${c.x} ${c.y}V${c.y + c.h}H${c.x + c.w}V${c.y}Z` }));
  m.append(svg('rect', { class: 'm-line', x: c.x, y: c.y, width: c.w, height: c.h }));

  const cols = layer('columns');
  for (const k of g.columns) {
    const grp = svg('g');
    grp.append(svg('rect', { x: k.x, y: c.y, width: k.w, height: c.h }));
    grp.append(svg('text', { x: k.x + k.w / 2, y: c.y - 5 }, k.n));
    cols.append(grp);
  }

  const gut = layer('gutters');
  for (const k of g.gutters) gut.append(svg('rect', { x: k.x, y: c.y, width: k.w, height: c.h }));

  const mods = layer('modules');
  for (const r of g.rows) {
    const grp = svg('g');
    for (const k of g.columns) grp.append(svg('rect', { x: k.x, y: r.y, width: k.w, height: r.h }));
    grp.append(svg('text', { x: c.x - 5, y: r.y + 6 }, r.n));
    mods.append(grp);
  }

  const base = layer('baseline');
  for (const y of g.baselines) base.append(svg('line', { x1: c.x, x2: c.x + c.w, y1: y, y2: y }));
}

function applyVisibility() {
  for (const k of Object.keys(show)) if (layers[k]) layers[k].style.display = show[k] ? '' : 'none';
  syncPanel();
}

function toggleAll() {
  if (building) return;
  const any = Object.values(show).some(Boolean);
  if (any) { stash = { ...show }; for (const k in show) show[k] = false; }
  else Object.assign(show, stash || { margins: true, columns: true, gutters: true, baseline: true, modules: true });
  applyVisibility();
}

// ---------- Sample poster ----------

// Returns element specs in grid terms only: column start, column span, row start, row span.
function planSample() {
  const C = g.columns.length, R = g.rows.length;
  const out = [];
  const add = (name, kind, c, cs, r, rs, content, extra = {}) => out.push({ name, kind, c, cs, r, rs, content, ...extra });

  // Header: four labels across row 1, number set flush right.
  const head = [['Header: series', 'WAYPOINTS'], ['Header: title', S.title], ['Header: county', S.county], ['Header: number', S.number]];
  let c = 1;
  distribute(C, [1, 2, 2, 1]).forEach((cs, i) => {
    add(head[i][0], 'label', c, cs, 1, 1, head[i][1], { right: i === 3 });
    c += cs;
  });

  // Footer: a rule and a five-column table. Fewer than five columns needs two rows.
  const footRows = C >= 5 ? 1 : 2;
  const first = 2, last = R - footRows;
  const mid = last - first + 1;

  if (mid >= 2) {
    const h = clamp(Math.round(mid * 0.34), 1, mid - 1);
    add('Headline', 'headline', 1, C, first, h, S.county);
    const r0 = first + h, rest = mid - h;
    const pc = Math.round(C * 2 / 3);
    add('Photo', 'photo', 1, pc, r0, rest, '');
    const tc = pc + 1, tw = C - pc;
    const placeRs = Math.max(1, Math.round(rest * 0.2));
    add('Place name', 'subhead', tc, tw, r0, placeRs, S.title);
    const left = rest - placeRs;
    const coordsRs = left >= 2 ? 1 : 0;
    const bodyRs = Math.min(Math.max(1, Math.round(rest * 0.45)), left - coordsRs);
    if (bodyRs >= 1) add('Body text', 'body', tc, tw, r0 + placeRs, bodyRs, S.body);
    if (coordsRs) add('Coordinates', 'mono', tc, tw, last, 1, S.coords.join('<br>'));
  }

  const foot = [['Place', S.title], ['County', S.county], ['Country', S.country], ['Category', S.category], ['Photo', S.photo]];
  const fr = R - footRows + 1;
  add('Footer: rule', 'rule', 1, C, fr, footRows, '');
  if (C >= 5) {
    c = 1;
    distribute(C, [1, 2, 1, 1, 1]).forEach((cs, i) => { add(`Footer: ${foot[i][0].toLowerCase()}`, 'foot', c, cs, fr, 1, foot[i]); c += cs; });
  } else {
    foot.slice(0, 4).forEach((f, i) => add(`Footer: ${f[0].toLowerCase()}`, 'foot', i + 1, 1, fr, 1, f));
    add('Footer: photo', 'foot', 1, C, fr + 1, 1, foot[4]);
  }
  return out;
}

// Type sizes come from the baseline: leading is always a whole number of baselines.
function typeFor(kind) {
  const B = cfg.baseline, p = pairing();
  const lead = B * Math.max(1, Math.round(12 / B));
  switch (kind) {
    case 'label':
    case 'foot': return { font: p.label, size: Math.min(lead * 0.6, 7.2), lh: lead };
    case 'mono': return { font: p.label, size: Math.min(lead * 0.62, 7.5), lh: lead };
    case 'body': return { font: { ...p.text, weight: 500 }, size: Math.min(lead * 0.8, 10.5), lh: lead };
    case 'subhead': { const lh = B * Math.ceil(26 / B); return { font: { ...p.headline, weight: Math.max(p.headline.weight, 400) }, size: lh * 0.82, lh, fit: true, ratio: 1.15 }; }
    case 'headline': return { font: p.headline, size: 100, lh: 100, fit: true, ratio: 0.86, nowrap: true };
  }
}

function layoutSample() {
  const box = $('#els');
  box.replaceChildren();
  els = planSample().map(spec => placeElement(box, spec));
  els.forEach(setType);
}

function placeElement(box, spec) {
  const rect = g.cell(spec.c, spec.cs, spec.r, spec.rs);
  const node = document.createElement('div');
  node.className = `el k-${spec.kind}${spec.right ? ' right' : ''}${spec.kind === 'rule' ? ' k-rule' : ''}`;
  Object.assign(node.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px' });
  if (spec.kind === 'photo') {
    node.innerHTML = `<div class="ph"><span class="what">PHOTO · ${spec.cs} × ${spec.rs} MODULES</span><span class="tag">1</span><span class="bar"></span></div>`;
  } else if (spec.kind === 'foot') {
    node.innerHTML = `<div class="txt"><span class="probe"></span><span class="lbl">${spec.content[0]}</span><br><span class="val">${spec.content[1]}</span></div>`;
  } else if (spec.kind !== 'rule') {
    node.innerHTML = `<div class="txt"><span class="probe"></span>${spec.content}</div>`;
  }
  const item = { ...spec, rect, node, overflow: false };
  node.addEventListener('mouseenter', () => hover(item));
  node.addEventListener('mouseleave', () => hover(null));
  box.append(node);
  return item;
}

function setType(item) {
  const txt = item.node.querySelector('.txt');
  if (!txt) return;
  const t = typeFor(item.kind), B = cfg.baseline;
  txt.style.fontFamily = `"${t.font.family}"`;
  txt.style.fontWeight = t.font.weight;
  if (t.nowrap) txt.style.whiteSpace = 'nowrap';
  if (item.kind === 'foot') txt.querySelector('.val').style.fontFamily = `"${pairing().text.family}"`;

  let { size, lh } = t;
  if (item.kind === 'headline') {
    // Fit the word to the full width of its cells, then set leading to whole baselines.
    txt.style.fontSize = '100px';
    txt.style.width = 'max-content';
    size = 100 * item.rect.w / txt.offsetWidth * 0.99;
    txt.style.width = '';
    lh = Math.max(B, Math.ceil(size * t.ratio / B) * B);
  }
  for (let i = 0; i < 40; i++) {
    txt.style.fontSize = size + 'px';
    txt.style.lineHeight = lh + 'px';
    snap(item, txt, size, lh);
    if (!item.overflow || !t.fit) break;
    size *= 0.94;
    lh = Math.max(B, Math.ceil(size * t.ratio / B) * B);
  }
  item.node.classList.toggle('overflow', item.overflow);
}

// Moves a text block down until its first baseline lands on a baseline of the grid.
// Elements start on module tops, which are always baselines, so whole-baseline leading
// keeps every following line on the grid too.
function snap(item, txt, size, lh) {
  const B = cfg.baseline;
  txt.style.transform = '';
  const probe = txt.querySelector('.probe');
  const b = (probe.getBoundingClientRect().top - txt.getBoundingClientRect().top) / scale;
  const shift = Math.ceil(b / B - 1e-6) * B - b;
  txt.style.transform = `translateY(${shift}px)`;
  const lines = Math.max(1, Math.round(txt.offsetHeight / lh));
  const lastBaseline = shift + b + (lines - 1) * lh;
  // Text may sit on the module's bottom baseline; descenders hang into the gutter below.
  item.overflow = lastBaseline > item.rect.h + 0.5 || txt.scrollWidth > item.rect.w + 0.5;
}

// ---------- Hover ----------

function describe(it) {
  const C = g.columns.length, R = g.rows.length;
  const span = (a, n) => (n === 1 ? `${a}` : `${a}–${a + n - 1}`);
  return `<b>${it.name}</b> · columns ${span(it.c, it.cs)} (${it.cs} of ${C}) · rows ${span(it.r, it.rs)} (${it.rs} of ${R})`;
}

function drawCells(it) {
  const hl = $('#hl');
  hl.replaceChildren();
  if (!it) return;
  for (let c = it.c; c < it.c + it.cs; c++) {
    for (let r = it.r; r < it.r + it.rs; r++) {
      const m = g.cell(c, 1, r, 1);
      hl.append(svg('rect', { class: 'hl-mod', x: m.x, y: m.y, width: m.w, height: m.h }));
    }
  }
  hl.append(svg('rect', { class: 'hl-box', x: it.rect.x, y: it.rect.y, width: it.rect.w, height: it.rect.h }));
}

function hover(it) {
  if (building) return;
  drawCells(it);
  narrate(it ? describe(it) : idleText());
}

function narrate(html) { $('#narration').innerHTML = html; }

// ---------- Play build ----------

function setPlay() {
  $('#play').classList.toggle('running', building);
  $('#playLabel').textContent = building ? 'Stop' : 'Play build';
}

function reveal(nodes, stagger = 0, dur = 400, from = {}, to = {}) {
  const list = [...nodes];
  const anims = list.map((n, i) => n.animate(
    [{ opacity: 0, ...from }, { opacity: 1, ...to }],
    { duration: dur, delay: i * stagger, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' },
  ));
  return anims.length ? anims[anims.length - 1].finished.catch(() => {}) : Promise.resolve();
}

async function playBuild() {
  if (building) { render(); return; }
  const id = run;
  building = true;
  setPlay();
  const alive = () => id === run && building;
  const C = g.columns.length, R = g.rows.length;

  drawCells(null);
  for (const k in layers) layers[k].style.display = 'none';
  els.forEach(e => (e.node.style.opacity = 0));
  await wait(300);

  const steps = [
    ['margins', `<b>Margins</b> · the empty border that frames the content`, () => reveal([layers.margins], 0, 700), 500],
    ['columns', `<b>Columns</b> · ${C} vertical divisions; things start and end on their edges`, () => reveal(layers.columns.children, 70, 350), 400],
    ['gutters', `<b>Gutters</b> · ${cfg.gutter} pt between columns, so content doesn’t touch`, () => reveal(layers.gutters.children, 50, 300), 500],
    ['baseline', `<b>Baseline</b> · ${g.baselines.length} lines every ${cfg.baseline} pt; all text sits on them`, () => reveal(layers.baseline.children, Math.min(25, 1100 / g.baselines.length), 220), 400],
    ['modules', `<b>Rows and modules</b> · ${R} rows of ${cfg.linesPerModule} baselines; ${C * R} modules to snap to`, () => reveal(layers.modules.children, 90, 350), 600],
  ];
  for (const [key, text, fn, pause] of steps) {
    if (!alive()) return;
    narrate(text);
    layers[key].style.display = '';
    await fn();
    await wait(pause);
  }

  for (const it of els) {
    if (!alive()) return;
    drawCells(it);
    narrate(describe(it));
    await wait(320);
    if (!alive()) return;
    it.node.style.opacity = '';
    await reveal([it.node], 0, 420, { transform: 'translateY(-14px)' }, { transform: 'translateY(0)' });
    await wait(180);
  }
  if (!alive()) return;
  drawCells(null);
  narrate(`<b>Built.</b> ${els.length} elements, every one placed on whole modules.`);
  building = false;
  setPlay();
  applyVisibility();
}
