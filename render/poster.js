// Draws one poster from its render spec and measures it. Used by the pipeline (through
// Playwright, via window.renderPoster) and by the gallery (poster.html?id=<poster-id>).
// Element positions are grid cells only; this file turns cells into points.
import { computeGrid } from '../grid/grid.js';

const loadedFonts = new Map();

// Resolves once the pairing's stylesheet is in, so the @font-face rules exist before
// document.fonts.load asks for them. Measuring with a fallback font would mis-fit type.
function loadFonts(pairing) {
  const href = `https://fonts.googleapis.com/css2?${pairing.google.map(f => 'family=' + f).join('&')}&display=block`;
  if (!loadedFonts.has(href)) {
    loadedFonts.set(href, new Promise(resolve => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = link.onerror = resolve;
      document.head.append(link);
    }));
  }
  return loadedFonts.get(href);
}

// Type sizes come from the baseline: leading is always a whole number of baselines.
function typeFor(el, B, p) {
  const lead = B * Math.max(1, Math.round(12 / B));
  switch (el.kind) {
    case 'label':
    case 'foot': return { font: p.label, size: Math.min(lead * 0.6, 7.2), lh: lead };
    case 'mono': return { font: p.label, size: Math.min(lead * 0.62, 7.5), lh: lead };
    case 'list': return { font: p.text, size: Math.min(lead * 0.8, 10), lh: lead };
    case 'text':
      if (el.style === 'lead') {
        const lh = B * Math.ceil(22 / B);
        return { font: { ...p.text, weight: 500 }, size: lh * 0.78, lh };
      }
      return { font: p.text, size: Math.min(lead * 0.8, 10), lh: lead };
    case 'headline': return { font: p.headline, size: 100, lh: 100, fit: true, ratio: 0.88 };
  }
  return null;
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function build(el, rect) {
  const node = document.createElement('div');
  node.className = `el k-${el.kind} c-${el.color || 'ink'}${el.align === 'right' ? ' al-right' : ''}${el.style ? ' s-' + el.style : ''}`;
  node.dataset.id = el.id;
  Object.assign(node.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px' });

  if (el.kind === 'photo') {
    const fx = (el.focus?.[0] ?? 0.5) * 100, fy = (el.focus?.[1] ?? 0.5) * 100;
    node.innerHTML = `<img alt="" src="${esc(el.src)}" style="object-position:${fx}% ${fy}%;transform-origin:${fx}% ${fy}%;transform:scale(${el.zoom || 1})">`
      + (el.tag ? `<span class="tag">${esc(el.tag)}</span>` : '');
  } else if (el.kind === 'pinfield') {
    node.innerHTML = pinfield(el, rect);
  } else if (el.kind === 'foot') {
    node.innerHTML = `<div class="txt"><span class="probe"></span><span class="lbl">${esc(el.label)}</span><br><span class="val">${esc(el.value)}</span></div>`;
  } else if (el.kind === 'list') {
    node.innerHTML = `<div class="txt"><span class="probe"></span>${(el.items || []).map(it =>
      `<div class="row"><span class="n">${esc(it.n)}</span><span class="name">${esc(it.name)}</span><span class="km">${esc(it.km)}</span></div>`).join('')}</div>`;
  } else if (el.kind !== 'rule') {
    node.innerHTML = `<div class="txt"><span class="probe"></span>${esc(el.text).replace(/\n/g, '<br>')}</div>`;
  }
  return node;
}

// All pins as dots, projected into the element's cells; this pin in the accent colour.
function pinfield(el, rect) {
  const pts = el.dots?.points || [];
  if (!pts.length) return '';
  const lat0 = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const k = Math.cos(lat0 * Math.PI / 180);
  const xy = ([lat, lng]) => [lng * k, -lat];
  const all = pts.map(xy);
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 6;
  const s = Math.min((rect.w - 2 * pad) / (maxX - minX || 1), (rect.h - 2 * pad) / (maxY - minY || 1));
  const ox = (rect.w - (maxX - minX) * s) / 2, oy = (rect.h - (maxY - minY) * s) / 2;
  const place = p => { const [x, y] = xy(p); return [ox + (x - minX) * s, oy + (y - minY) * s]; };
  const dots = pts.map(p => { const [x, y] = place(p); return `<circle class="dot" cx="${x}" cy="${y}" r="1.5"/>`; }).join('');
  const rings = (el.dots.ring || []).map(p => { const [x, y] = place(p); return `<circle class="ring" cx="${x}" cy="${y}" r="4"/>`; }).join('');
  const [hx, hy] = place(el.dots.here);
  return `<svg viewBox="0 0 ${rect.w} ${rect.h}">${dots}${rings}<circle class="here" cx="${hx}" cy="${hy}" r="4"/></svg>`;
}

const capCanvas = document.createElement('canvas').getContext('2d');
function capHeight(font, size) {
  capCanvas.font = `${font.weight} ${size}px "${font.family}"`;
  return capCanvas.measureText('H').actualBoundingBoxAscent;
}

// Puts the first baseline on a grid baseline. Body text takes the next baseline below
// where it would naturally sit; a headline hangs instead: its capitals start at the top
// of its first row and its baseline is the first grid baseline below the cap height.
function measure(txt, B, scale, hang) {
  txt.style.transform = '';
  const probe = txt.querySelector('.probe');
  const b = (probe.getBoundingClientRect().top - txt.getBoundingClientRect().top) / scale;
  const target = hang ? Math.max(B, Math.ceil(hang / B - 1e-6) * B) : Math.ceil(b / B - 1e-6) * B;
  const shift = target - b;
  txt.style.transform = `translateY(${shift}px)`;
  return { b, shift };
}

// Sets type, snaps the first baseline to the grid, and reports whether text leaves its cells.
function setType(el, node, rect, B, p, scale) {
  const txt = node.querySelector('.txt');
  if (!txt) return { overflow: false };
  const t = typeFor(el, B, p);
  txt.style.fontFamily = `"${t.font.family}"`;
  txt.style.fontWeight = t.font.weight;
  if (el.kind === 'foot') txt.querySelector('.val').style.fontFamily = `"${p.text.family}"`;
  if (el.kind === 'list') txt.querySelectorAll('.n, .km').forEach(n => { n.style.fontFamily = `"${p.label.family}"`; n.style.fontSize = '0.75em'; });

  let { size, lh } = t;
  if (el.kind === 'headline') {
    // Largest size at which the widest line fills the cells' width.
    txt.style.fontSize = '100px';
    txt.style.lineHeight = '100px';
    txt.style.width = 'max-content';
    size = 100 * rect.w / txt.offsetWidth * 0.985;
    txt.style.width = '';
    lh = Math.max(B, Math.ceil(size * t.ratio / B) * B);
  }
  let result;
  for (let i = 0; i < 60; i++) {
    txt.style.fontSize = size + 'px';
    txt.style.lineHeight = lh + 'px';
    const hang = el.kind === 'headline' ? capHeight(t.font, size) : 0;
    const { b, shift } = measure(txt, B, scale, hang);
    const lines = Math.max(1, Math.round(txt.offsetHeight / lh));
    const lastBaseline = shift + b + (lines - 1) * lh;
    // Text may sit on the cells' bottom baseline; descenders hang into the gutter.
    const overflow = lastBaseline > rect.h + 0.5 || txt.scrollWidth > rect.w + 0.5;
    result = { overflow, size: Math.round(size * 10) / 10, leading: lh, lines };
    if (!overflow || !t.fit) break;
    size *= 0.96;
    lh = Math.max(B, Math.ceil(size * t.ratio / B) * B);
  }
  return result;
}

export async function renderPoster(spec, { scale = 1 } = {}) {
  const g = computeGrid(spec.grid);
  const B = spec.grid.baseline;
  const p = spec.pairing;
  await loadFonts(p);
  const root = document.getElementById('poster');
  Object.assign(root.style, { width: g.page.width + 'px', height: g.page.height + 'px' });
  for (const [k, v] of Object.entries(spec.theme)) root.style.setProperty('--' + k, v);
  root.replaceChildren();

  const fonts = [p.headline, p.text, p.label, { ...p.text, weight: 500 }];
  await Promise.all(fonts.map(f => document.fonts.load(`${f.weight} 40px "${f.family}"`))).catch(() => {});
  const missing = fonts.filter(f => !document.fonts.check(`${f.weight} 40px "${f.family}"`)).map(f => f.family);

  // Photos and pin fields underneath, type on top.
  const under = new Set(['photo', 'pinfield']);
  const ordered = [...spec.elements].sort((a, b) => (under.has(b.kind) ? 1 : 0) - (under.has(a.kind) ? 1 : 0));
  const report = {};
  const imgs = [];
  for (const el of ordered) {
    const rect = g.cell(el.c, el.cs, el.r, el.rs);
    const node = build(el, rect);
    root.append(node);
    if (el.kind === 'photo') imgs.push(node.querySelector('img'));
    report[el.id] = { rect, ...setType(el, node, rect, B, p, scale) };
  }
  await Promise.all(imgs.map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
  for (const img of imgs) {
    const id = img.closest('.el').dataset.id;
    report[id].natural = [img.naturalWidth, img.naturalHeight];
  }
  report._fontsMissing = [...new Set(missing)];
  report._images = imgs.map(i => ({ src: i.getAttribute('src'), ok: i.naturalWidth > 0 }));
  return report;
}

window.renderPoster = renderPoster;

// Standalone: poster.html?id=<poster-id> renders a saved poster.
const id = new URLSearchParams(location.search).get('id');
if (id) {
  fetch(`../posters/${encodeURIComponent(id)}.json`, { cache: 'no-store' })
    .then(r => r.json())
    .then(poster => renderPoster(poster.render));
}
window.posterReady = true;
