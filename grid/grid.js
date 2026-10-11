// Grid geometry. The lab, the poster renderer and the gallery overlay all compute
// the grid here, from grid/grid.json, so there is one definition of where things may go.
// Units are points. Columns, rows and cells are numbered from 1.

export function computeGrid(cfg) {
  const { page, margin, columns: C, gutter: G, baseline: B, linesPerModule: L } = cfg;
  const RG = cfg.rowGutterLines ?? 1;

  // The top margin snaps to the baseline, so baseline lines run down from the page top
  // and every module starts on one.
  const top = Math.max(B, Math.round(margin / B) * B);
  const left = margin;
  const width = page.width - 2 * margin;
  const colW = (width - (C - 1) * G) / C;

  // Rows are whole modules of L baselines with RG baselines between them. Whatever height
  // is left over after fitting whole rows goes to the bottom margin.
  const step = (L + RG) * B;
  const R = Math.max(1, Math.floor((page.height - top - margin + RG * B) / step));
  const height = R * L * B + (R - 1) * RG * B;
  const bottom = page.height - top - height;

  const columns = Array.from({ length: C }, (_, i) => ({ n: i + 1, x: left + i * (colW + G), w: colW }));
  const gutters = columns.slice(0, -1).map(c => ({ x: c.x + c.w, w: G }));
  const rows = Array.from({ length: R }, (_, i) => ({ n: i + 1, y: top + i * step, h: L * B }));
  const rowGutters = rows.slice(0, -1).map(r => ({ y: r.y + r.h, h: RG * B }));
  const baselines = Array.from({ length: Math.round(height / B) }, (_, i) => top + (i + 1) * B);

  function cell(col, colSpan, row, rowSpan) {
    const a = columns[col - 1], b = columns[col + colSpan - 2];
    const r0 = rows[row - 1], r1 = rows[row + rowSpan - 2];
    if (!a || !b || !r0 || !r1 || colSpan < 1 || rowSpan < 1) {
      throw new RangeError(`cell col ${col}+${colSpan}, row ${row}+${rowSpan} is off the grid`);
    }
    return { x: a.x, y: r0.y, w: b.x + b.w - a.x, h: r1.y + r1.h - r0.y };
  }

  return {
    page, baseline: B, linesPerModule: L,
    margins: { top, right: margin, bottom, left: margin },
    content: { x: left, y: top, w: width, h: height },
    columns, gutters, rows, rowGutters, baselines, cell,
  };
}

// Splits `total` columns into parts proportional to `weights`, each at least 1,
// handing leftovers to the largest remainders.
export function distribute(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map(w => (w / sum) * total);
  const out = raw.map(v => Math.max(1, Math.floor(v)));
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  for (let k = 0; left > 0; k++, left--) out[order[k % order.length]]++;
  for (let k = out.length - 1; left < 0 && k >= 0; k--) while (left < 0 && out[k] > 1) { out[k]--; left++; }
  return out;
}
