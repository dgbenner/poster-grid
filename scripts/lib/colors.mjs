// Dominant colours of an image, from code. k-means on a 64×64 thumbnail.
import sharp from 'sharp';

const hex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

export async function dominantColors(file, k = 5) {
  const { data, info } = await sharp(file).resize(64, 64, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = [];
  for (let i = 0; i < data.length; i += info.channels) px.push([data[i], data[i + 1], data[i + 2]]);

  // Seed centres spread across the pixels sorted by brightness, so runs are repeatable.
  const sorted = [...px].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  let centres = Array.from({ length: k }, (_, i) => [...sorted[Math.floor((i + 0.5) * sorted.length / k)]]);
  let assign = new Array(px.length).fill(0);
  for (let iter = 0; iter < 12; iter++) {
    assign = px.map(p => {
      let best = 0, bd = Infinity;
      centres.forEach((c, j) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; best = j; } });
      return best;
    });
    centres = centres.map((c, j) => {
      const mine = px.filter((_, i) => assign[i] === j);
      return mine.length ? [0, 1, 2].map(ch => mine.reduce((s, p) => s + p[ch], 0) / mine.length) : c;
    });
  }
  const counts = centres.map((_, j) => assign.filter(a => a === j).length);
  const colors = centres
    .map((c, j) => ({ hex: hex(c), share: Math.round((counts[j] / px.length) * 1000) / 1000, ...hsl(c) }))
    .filter(c => c.share > 0)
    .sort((a, b) => b.share - a.share);

  // Strongest: the most saturated colour that covers a real part of the image and is
  // neither near-black nor near-white. Candidate for the poster's accent.
  const strongest = colors
    .filter(c => c.share >= 0.04 && c.l > 0.12 && c.l < 0.88)
    .sort((a, b) => b.s * Math.sqrt(b.share) - a.s * Math.sqrt(a.share))[0] || null;

  return {
    palette: colors.map(({ hex, share }) => ({ hex, share })),
    strongest: strongest && strongest.s > 0.2 ? strongest.hex : null,
  };
}
