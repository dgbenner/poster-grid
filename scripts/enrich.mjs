// Builds data/enrich/<pin-id>.json for each pin: place, nearby pins, facts with sources,
// images with author and licence, and the photo's colours.
//
//   node scripts/enrich.mjs                 all pins not yet enriched
//   node scripts/enrich.mjs --only a,b      just these ids
//   node scripts/enrich.mjs --uk            only pins in the UK
//   node scripts/enrich.mjs --force         redo pins that already have a file
//
// Posters may only state facts saved here. Images are Dan's own Waypoints photos
// (private use) or Wikimedia Commons files under CC0, public domain, CC BY or CC BY-SA.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, getJSON, download } from './lib/http.mjs';
import { placeFrom } from './lib/place.mjs';
import { dominantColors } from './lib/colors.mjs';

const args = process.argv.slice(2);
const flag = f => args.includes(f);
const opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const OWN_IMAGES = 'https://raw.githubusercontent.com/dgbenner/waypoints/main/images/';
const WIKI = 'https://en.wikipedia.org';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const MAX_COMMONS = 4;
const OUT = join(ROOT, 'data/enrich');

// Never use these as images: logos, album art, maps, flags, diagrams.
const BLOCK = /\b(logo|album|cover|sleeve|single|discography|flag|coat[ _]of[ _]arms|arms|crest|map|locator|location|diagram|plan|signature|icon|poster|ticket|screenshot|badge|seal)\b/i;
// Commons categories that mark a file as not a photo of the place.
const BLOCK_CATEGORY = /\b(maps?|logos?|album covers?|flags?|coats? of arms|diagrams?|heraldry)\b/i;
const LICENCE_OK = /^(cc0|public domain|pd\b|pd-|cc[ -]by(-sa)?([ -]\d(\.\d)?)?( [a-z]{2,})?$)/i;

const km = (a, b) => {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const stripHtml = s => (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
// "Richerman (talk) 11:03, 28 February 2008" -> "Richerman"; "mattbuck (category)" -> "mattbuck".
const cleanAuthor = a => stripHtml(a).replace(/\s*\((talk|category|contribs)\).*$/i, '').replace(/\s+\d{1,2}:\d{2},.*$/, '').trim() || null;
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['the', 'of', 'and', 'a', 'de', 'la', 'le', 'du', 'des', 'site', 'st']);
const tokens = s => norm(s).split(' ').filter(t => t.length > 2 && !STOP.has(t));

// "Lake District (Keswick, Scafell Pike)" -> "Lake District"; "Greenwich / GMT" -> "Greenwich".
const cleanName = n => n.replace(/\(.*?\)/g, '').split(/\s+[—–]\s+|\s+-\s+|\s*\/\s*/)[0].trim();

// ---------- Place ----------

async function lookupPlace(pin) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${pin.lat}&lon=${pin.lng}&zoom=14&addressdetails=1&accept-language=en`;
  const res = await getJSON(url);
  return { ...placeFrom(res?.address), source: 'OpenStreetMap Nominatim', sourceUrl: url, displayName: res?.display_name || null };
}

// ---------- Facts ----------

async function summary(title) {
  const s = await getJSON(`${WIKI}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`);
  if (!s || s.type !== 'standard' || !s.extract) return null;
  return s;
}

function factFrom(s, how, pin) {
  return {
    title: s.title,
    description: s.description || null,
    extract: s.extract,
    url: s.content_urls?.desktop?.page || `${WIKI}/wiki/${encodeURIComponent(s.title.replace(/ /g, '_'))}`,
    coordinates: s.coordinates ? { lat: s.coordinates.lat, lng: s.coordinates.lon } : null,
    km: s.coordinates ? round(km(pin, { lat: s.coordinates.lat, lng: s.coordinates.lon }), 1) : null,
    matchedBy: how,
    leadImage: s.originalimage?.source || null,
    source: 'Wikipedia',
  };
}

// The part of an article title that names the thing: "The Black Friar, Blackfriars" -> "The Black Friar".
const coreTokens = title => tokens(title.replace(/\(.*?\)/g, '').split(',')[0]);

const sameSet = (a, b) => a.length === b.length && a.every(t => b.includes(t));

// True when one name contains the other: "Solsbury Hill" fits "Little Solsbury Hill",
// but "The World's End, Camden" does not fit "Camden".
function namesFit(want, title) {
  const core = coreTokens(title);
  if (!want.length || !core.length) return false;
  return want.every(t => core.includes(t)) || core.every(t => want.includes(t));
}

// Finds the Wikipedia article for a name near a point. An article only counts if its
// name fits the one we want and its coordinates are within maxKm, so a same-named
// place elsewhere, or a different thing nearby, is never used.
// Articles about these are never the place itself.
const NOT_A_PLACE = /constituency|football club|diocese|electoral (ward|division)|railway station|parish church of|school\b/i;

async function findArticle(name, pin, maxKm, { strict = false } = {}) {
  const want = tokens(name);
  // Strict: the article's name must be exactly the name we want, for towns ("Windsor",
  // not "Windsor Castle"). A ", County" suffix is still fine.
  const fits = t => strict ? sameSet(want, coreTokens(t)) : namesFit(want, t);
  const tried = new Set();
  const attempt = async (title, how) => {
    if (!title || tried.has(title)) return null;
    tried.add(title);
    const s = await summary(title);
    if (!s?.coordinates || !fits(s.title) || NOT_A_PLACE.test(s.description || '')) return null;
    const d = km(pin, { lat: s.coordinates.lat, lng: s.coordinates.lon });
    return d <= maxKm ? factFrom(s, how, pin) : null;
  };

  const exact = await attempt(name, 'title');
  if (exact) return exact;

  // Several articles can fit a short name ("Camden": Camden Town, Camden Underworld).
  // Keep every one that fits and is close enough, then take the closest name: the one
  // that adds fewest words, preferring search rank over mere nearness.
  const search = await getJSON(`${WIKI}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&srlimit=6&format=json`);
  const geo = await getJSON(`${WIKI}/w/api.php?action=query&list=geosearch&gscoord=${pin.lat}|${pin.lng}&gsradius=3000&gslimit=30&format=json`);
  const candidates = [
    ...(search?.query?.search || []).map(r => [r.title, 'search']),
    ...(geo?.query?.geosearch || []).map(g => [g.title, 'nearby article']),
  ].filter(([t]) => fits(t)).slice(0, 8);
  const hits = [];
  for (const [i, [title, how]] of candidates.entries()) {
    const hit = await attempt(title, how);
    if (hit) hits.push({ hit, extra: Math.abs(coreTokens(hit.title).length - want.length), i });
  }
  hits.sort((a, b) => a.extra - b.extra || a.i - b.i);
  return hits[0]?.hit || null;
}

async function findTownArticle(place, pin) {
  if (place.county === 'Greater London') {
    if (!place.borough) return null;
    // Boroughs go by their official titles; try those exactly before any looser search,
    // or "Greenwich" slides to Greenwich Borough F.C.
    for (const t of [`London Borough of ${place.borough}`, `Royal Borough of ${place.borough}`, place.borough]) {
      const s = await summary(t);
      if (s?.coordinates && km(pin, { lat: s.coordinates.lat, lng: s.coordinates.lon }) <= 15) return factFrom(s, 'title', pin);
    }
    return findArticle(place.borough, pin, 15, { strict: true });
  }
  if (!place.town) return null;
  return await findArticle(place.town, pin, 20, { strict: true })
    || (place.county ? await findArticle(`${place.town}, ${place.county}`, pin, 20, { strict: true }) : null);
}

// ---------- Images ----------

function fileTitleFromUrl(u) {
  const m = u && u.match(/\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/);
  return m ? 'File:' + decodeURIComponent(m[1]) : null;
}

async function commonsInfo(titles) {
  const out = [];
  for (let i = 0; i < titles.length; i += 40) {
    const batch = titles.slice(i, i + 40);
    const res = await getJSON(`${COMMONS}?action=query&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1600&format=json&titles=${encodeURIComponent(batch.join('|'))}`);
    const pages = Object.values(res?.query?.pages || {});
    for (const t of batch) {
      const p = pages.find(x => x.title === t || x.title === t.replace(/_/g, ' '));
      if (p?.imageinfo?.[0]) out.push({ title: p.title, info: p.imageinfo[0] });
    }
  }
  return out;
}

function acceptCommons({ title, info }) {
  const m = info.extmetadata || {};
  const licence = stripHtml(m.LicenseShortName?.value);
  const desc = stripHtml(m.ImageDescription?.value);
  if (info.mime !== 'image/jpeg') return 'not a photo';
  if (info.width < 1000) return 'too small';
  if (m.NonFree?.value) return 'non-free';
  if (!LICENCE_OK.test(licence) || /\b(nc|nd)\b/i.test(licence)) return `licence ${licence || 'unknown'}`;
  if (BLOCK.test(title) || BLOCK.test(desc.slice(0, 200))) return 'logo/map/album filter';
  if (BLOCK_CATEGORY.test(stripHtml(m.Categories?.value))) return 'map/logo category';
  return null;
}

async function gatherImages(pin, pinFact) {
  const dir = join(ROOT, 'data/images', pin.id);
  const images = [];
  const rejected = [];

  // Dan's own Waypoints photos: private use only.
  for (const f of pin.images || []) {
    if (BLOCK.test(f)) { rejected.push({ title: f, why: 'logo/map/album filter' }); continue; }
    const local = join(dir, 'own-' + f);
    if (await download(OWN_IMAGES + encodeURIComponent(f), local)) {
      images.push({
        kind: 'personal', file: `data/images/${pin.id}/own-${f}`, source: OWN_IMAGES + encodeURIComponent(f),
        author: null, license: 'personal', licenseUrl: null,
        note: 'From Dan’s Waypoints pin. Original source and licence unknown; private use only.',
      });
    }
  }

  // Commons, best first: the article's lead image, then files named after the place
  // (from the article or near the pin), then other files nearest the pin. Article
  // images that don't name the place are skipped; they are usually navigation boxes.
  const want = [...new Set([...tokens(cleanName(pin.name)), ...(pinFact ? coreTokens(pinFact.title) : [])])];
  const overlap = t => { const have = tokens(t.replace(/^File:/, '').replace(/\.[a-z]+$/i, '')); return want.filter(w => have.includes(w)).length; };
  const named = t => overlap(t) > 0;
  const byOverlap = list => list.filter(named).map((t, i) => [t, overlap(t), i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map(([t]) => t);
  const lead = pinFact?.leadImage ? [fileTitleFromUrl(pinFact.leadImage)] : [];
  let fromArticle = [];
  if (pinFact) {
    const res = await getJSON(`${WIKI}/w/api.php?action=query&prop=images&imlimit=50&format=json&titles=${encodeURIComponent(pinFact.title)}`);
    for (const p of Object.values(res?.query?.pages || {})) for (const im of p.images || []) fromArticle.push(im.title);
  }
  const geo = await getJSON(`${COMMONS}?action=query&list=geosearch&gscoord=${pin.lat}|${pin.lng}&gsradius=400&gsnamespace=6&gslimit=20&format=json`);
  const nearby = (geo?.query?.geosearch || []).map(g => g.title);
  const titles = [...lead, ...byOverlap([...fromArticle, ...nearby]), ...nearby.filter(t => !named(t))];
  const unique = [...new Set(titles.filter(t => t && /\.jpe?g$/i.test(t)))];

  let n = 0;
  const infos = await commonsInfo(unique);
  for (const c of unique.map(t => infos.find(i => i.title === t.replace(/_/g, ' '))).filter(Boolean)) {
    if (n >= MAX_COMMONS) break;
    const why = acceptCommons(c);
    if (why) { rejected.push({ title: c.title, why }); continue; }
    const m = c.info.extmetadata || {};
    const name = `commons-${++n}.jpg`;
    if (!(await download(c.info.thumburl || c.info.url, join(dir, name)))) { n--; continue; }
    images.push({
      kind: 'commons', file: `data/images/${pin.id}/${name}`, title: c.title,
      source: c.info.descriptionurl, author: cleanAuthor(m.Artist?.value),
      license: stripHtml(m.LicenseShortName?.value), licenseUrl: m.LicenseUrl?.value || null,
      width: c.info.width, height: c.info.height,
    });
  }

  for (const im of images) {
    try { im.colors = await dominantColors(join(ROOT, im.file)); } catch { im.colors = null; }
  }
  return { images, rejected };
}

// ---------- Run ----------

async function enrichPin(pin) {
  const place = await lookupPlace(pin);
  const name = cleanName(pin.name);
  const townFact = await findTownArticle(place, pin);
  // A pin that is the town ("Newcastle" in Newcastle upon Tyne) uses the town's article.
  const isTown = townFact && place.town && tokens(name).length && tokens(name).every(t => tokens(place.town).includes(t));
  const pinFact = isTown ? { ...townFact, matchedBy: 'town' } : await findArticle(name, pin, 25);
  const { images, rejected } = await gatherImages(pin, pinFact);
  return {
    id: pin.id,
    name: pin.name,
    lat: pin.lat,
    lng: pin.lng,
    enrichedAt: new Date().toISOString(),
    place,
    nearby: null,
    facts: { pin: pinFact, town: townFact },
    note: { text: pin.blurb || null, by: 'Dan', isFact: false },
    category: pin.category, themes: pin.themes || [],
    images,
    rejectedImages: rejected,
    colors: images[0]?.colors || null,
  };
}

async function main() {
  const pins = JSON.parse(await readFile(join(ROOT, 'data/pins.json'), 'utf8'));
  await mkdir(OUT, { recursive: true });
  const done = new Set((await readdir(OUT)).map(f => f.replace(/\.json$/, '')));
  const only = opt('--only')?.split(',');
  let todo = pins.filter(p => (only ? only.includes(p.id) : true));
  if (flag('--uk')) todo = todo.filter(p => p.macroRegion === 'uk');
  if (!flag('--force')) todo = todo.filter(p => !done.has(p.id));

  console.log(`enriching ${todo.length} of ${pins.length} pins`);
  let i = 0, failed = 0;
  const worker = async () => {
    while (todo.length) {
      const pin = todo.shift();
      const n = ++i;
      try {
        const e = await enrichPin(pin);
        await writeFile(join(OUT, pin.id + '.json'), JSON.stringify(e, null, 2) + '\n');
        const p = e.place;
        console.log(`${String(n).padStart(3)} ${pin.id} · ${p.town || '?'}, ${p.county || '?'}${p.borough ? ` (${p.borough})` : ''} · facts ${e.facts.pin ? '✓' : '·'}${e.facts.town ? '✓' : '·'} · ${e.images.length} img`);
      } catch (err) {
        failed++;
        console.log(`${String(n).padStart(3)} ${pin.id} FAILED ${err.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 3 }, worker));

  await linkNearby(pins);
  console.log(`done${failed ? `, ${failed} failed` : ''}`);
}

// Second pass over every enriched pin: pins within 5 km, and pins in the same county.
async function linkNearby(pins) {
  const files = (await readdir(OUT)).filter(f => f.endsWith('.json'));
  const all = await Promise.all(files.map(async f => JSON.parse(await readFile(join(OUT, f), 'utf8'))));
  const byId = new Map(all.map(e => [e.id, e]));
  for (const e of all) {
    const within5km = pins
      .filter(p => p.id !== e.id)
      .map(p => ({ id: p.id, name: p.name, km: round(km(e, p), 2) }))
      .filter(p => p.km <= 5)
      .sort((a, b) => a.km - b.km);
    const sameCounty = e.place?.county
      ? all.filter(o => o.id !== e.id && o.place?.county === e.place.county && o.place?.country === e.place.country)
          .map(o => ({ id: o.id, name: o.name, km: round(km(e, o), 1) }))
          .sort((a, b) => a.km - b.km)
      : [];
    e.nearby = { within5km, sameCounty };
    await writeFile(join(OUT, e.id + '.json'), JSON.stringify(byId.get(e.id), null, 2) + '\n');
  }
}

main();
