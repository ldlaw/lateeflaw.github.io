/* Internet Intelligence dashboard (milestones M1, M1.1, M2.1, M2.2, M3).
   Reads the SAME validated documents as the homepage globe and reuses its validator (validateView) and freshness classifier (classify),
   so the two surfaces can never disagree about what is simulated or how old a value is. Only DATA is read from the data origin; no code is
   executed from it. Every string from data is set with textContent. No library, no storage, no cookies, no third-party script.
   M3 control behaviour: internet-control.js decides whether this surface may show data (automatic re-checks of a visible tab, a bounded lease, expiry, hysteresis
   before it re-opens); this page obeys it: when the answer is not "enabled" the data is REMOVED from memory and from the page, no data request is made, and the
   page re-opens only when the monitor says so. The manual buttons remain as a supplement. */
import { validateView, classify, fmtAge, TH } from '../globe-data.js';
import LAND from './land.js';
import { createMonitor, watchPage } from '../internet-control.js';
import { createGlobe } from './globe.js';
import { createCharts } from './charts.js';
import { parse, serialize, resolve, fresh as freshState } from './state.js';
import { DEFAULT_CENTRE, viewer, normCentre, sameCentre, centreForPair, pairFits, lineVisible, placeVisible, angularDeg } from './geo.js';
import { LOSS_RULE, wilsonLower, lossLevel, elevatedFrom, LOSS_NAMES, rttBand, BAND_LABELS, arcClass, lossMarkPath, legendModel } from './encode.js';

export { LOSS_RULE, wilsonLower, lossLevel, elevatedFrom, LOSS_NAMES, rttBand, BAND_LABELS };   // the packet-loss rule and the bands live in encode.js, shared by every view

export const CONFIG = {
  defaultOrigin: 'https://ldlaw.github.io/internet-data/v1/',   // the data repository's own GitHub Pages path (user decision 2026-11-14: no DNS change). Local testing overrides it with ?data-origin=
  controlPath: 'control.json', viewPath: 'views/home.json', timeoutMs: 6000, maxBytes: 65536, tickMs: 30000, cooldownMs: 5000
};
const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/* ================= pure logic (exported so tests can exercise it without a browser) ================= */

const D2R = Math.PI / 180, r1 = (x) => Math.round(x * 10) / 10;
export const MAP = { w: 720, h: 284, top: 84, centerY: 142 };   // equirectangular, 2 user units per degree, latitude 84 (top) to -58
export const project = (lon, lat) => [(lon + 180) * 2, (MAP.top - lat) * 2];

// Same formula as the collector's hav() in internet-data/src/contract.mjs (a test keeps them equal).
export function distanceKm(a, b) { const R = 6371, dLa = (b.lat - a.lat) * D2R, dLo = (b.lon - a.lon) * D2R, h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
export const fibreBoundMs = (km) => km / 100;   // round trip at two thirds of c: 2 x km / 200,000 km/s
export function median(xs) { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

export function arcPoints(a, b, n = 48) {
  const v = (p) => [Math.cos(p.lat * D2R) * Math.cos(p.lon * D2R), Math.cos(p.lat * D2R) * Math.sin(p.lon * D2R), Math.sin(p.lat * D2R)];
  const A = v(a), B = v(b), d = Math.acos(Math.min(1, Math.max(-1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
  if (d < 1e-9) return [{ lon: a.lon, lat: a.lat }, { lon: b.lon, lat: b.lat }];
  const out = [];
  for (let i = 0; i <= n; i++) { const t = i / n, s1 = Math.sin((1 - t) * d) / Math.sin(d), s2 = Math.sin(t * d) / Math.sin(d), x = s1 * A[0] + s2 * B[0], y = s1 * A[1] + s2 * B[1], z = s1 * A[2] + s2 * B[2]; out.push({ lon: Math.atan2(y, x) / D2R, lat: Math.asin(Math.max(-1, Math.min(1, z))) / D2R }); }
  return out;
}
export function lonLatPath(points) {   // a new sub-path wherever the line crosses the antimeridian, so it never streaks across the map
  let d = '', prev = null;
  for (const p of points) { const [x, y] = project(p.lon, p.lat); d += (prev === null || Math.abs(p.lon - prev) > 180 ? 'M' : 'L') + r1(x) + ' ' + r1(y); prev = p.lon; }
  return d;
}
export const arcPath = (a, b) => lonLatPath(arcPoints(a, b));
export const arcMid = (a, b) => arcPoints(a, b, 2)[1];
export function landPath(rings = LAND) { return rings.map((r) => 'M' + r.map(([lo, la]) => { const [x, y] = project(lo, la); return r1(x) + ' ' + r1(y); }).join('L') + 'Z').join(''); }

// Map windows. The viewBox always matches the container's aspect ratio, so the map fills its box at every width.
export function worldView(aspect) { const w = MAP.w, h = w / aspect; return [0, MAP.centerY - h / 2, w, h]; }
export function fitView(box, aspect) {
  let [x0, y0] = project(box.lonMin, box.latMax); const [x1, y1] = project(box.lonMax, box.latMin); let w = x1 - x0, h = y1 - y0;
  if (w / h < aspect) { const nw = h * aspect; x0 -= (nw - w) / 2; w = nw; } else { const nh = w / aspect; y0 -= (nh - h) / 2; h = nh; }
  if (w >= MAP.w) return worldView(aspect);
  x0 = Math.min(Math.max(0, x0), MAP.w - w);
  return [x0, y0, w, h];
}
// Longitude bands, not data: they only decide which nodes a map window zooms to.
export function regionBoxes(nodes, pad = 14) {
  const bands = [['americas', 'Americas', 'Americas', (n) => n.lon < -30], ['emea', 'Europe, Africa, Middle East', 'EMEA', (n) => n.lon >= -30 && n.lon < 75], ['apac', 'Asia and Pacific', 'Asia-Pacific', (n) => n.lon >= 75]], out = [];
  for (const [id, label, short, test] of bands) {
    const ns = nodes.filter(test); if (!ns.length) continue;
    out.push({ id, label, short, box: { lonMin: Math.max(-180, Math.min(...ns.map((n) => n.lon)) - pad), lonMax: Math.min(180, Math.max(...ns.map((n) => n.lon)) + pad), latMin: Math.max(-58, Math.min(...ns.map((n) => n.lat)) - pad), latMax: Math.min(84, Math.max(...ns.map((n) => n.lat)) + pad) } });
  }
  return out;
}
/* ---- pair-aware framing (M1.1). The map is a flat strip of 720 user units that repeats every 360 degrees. Arcs are kept UNWRAPPED (longitude may leave
   -180..180), so an arc that crosses the antimeridian is one contiguous piece, and the view may extend past either edge: the land and the arcs are drawn
   again, shifted by 720, wherever the view needs them. No library, and not the globe projection. ---- */
export function arcPointsUnwrapped(a, b, n = 48) {
  const pts = arcPoints(a, b, n), out = [{ lon: pts[0].lon, lat: pts[0].lat }]; let prev = pts[0].lon;
  for (let i = 1; i < pts.length; i++) { const lon = pts[i].lon + 360 * Math.round((prev - pts[i].lon) / 360); out.push({ lon, lat: pts[i].lat }); prev = lon; }
  return out;
}
export function arcExtent(points) {   // bounding box in user units of the unwrapped arc
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of points) { const [x, y] = project(p.lon, p.lat); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, x1, y0, y1 };
}
export const unwrappedPath = (points, k = 0) => points.map((p, i) => { const [x, y] = project(p.lon, p.lat); return (i ? 'L' : 'M') + r1(x + MAP.w * k) + ' ' + r1(y); }).join('');
export function tileOffsets(x0, x1, vb) { const out = []; for (let k = -2; k <= 2; k++) if (x1 + MAP.w * k > vb[0] && x0 + MAP.w * k < vb[0] + vb[2]) out.push(k); return out; }   // which 720-unit copies touch the view
export const wrapX = (x, vb) => x + MAP.w * Math.round((vb[0] + vb[2] / 2 - x) / MAP.w);   // the copy of x nearest the middle of the view
export function viewContains(vb, e, margin = 0.05) {   // does ONE copy of the whole arc fit inside the view, with a margin?
  const mx = vb[2] * margin, my = vb[3] * margin;
  for (let k = -2; k <= 2; k++) if (e.x0 + MAP.w * k >= vb[0] + mx && e.x1 + MAP.w * k <= vb[0] + vb[2] - mx && e.y0 >= vb[1] + my && e.y1 <= vb[1] + vb[3] - my) return true;
  return false;
}
// A view that shows both endpoints and the whole arc: the arc's box plus padding (at least 14 units, at least 20% of the box), never narrower than minW, at the container's aspect ratio.
export function pairView(a, b, aspect, { padFrac = 0.2, minPad = 14, minW = 150 } = {}) {
  const e = arcExtent(arcPointsUnwrapped(a, b)), cx = (e.x0 + e.x1) / 2, cy = (e.y0 + e.y1) / 2;
  let w = Math.max(e.x1 - e.x0 + 2 * Math.max(padFrac * (e.x1 - e.x0), minPad), minW), h = Math.max(e.y1 - e.y0 + 2 * Math.max(padFrac * (e.y1 - e.y0), minPad), minW / aspect);
  if (w / h < aspect) w = h * aspect; else h = w / aspect;
  if (w >= MAP.w) return worldView(aspect);
  return [cx - w / 2, cy - h / 2, w, h];
}

// Greedy label placement in CSS pixels: right, left, above, below; no label may cover another label or another marker, or leave the map.
// priority: ids placed first (they get the best spot and are never dropped). omitBlocked: a label with no free spot is left out (null) instead of overlapping.
export function placeLabels(items, { charPx = 6.3, h = 12, gap = 9, bounds = null, priority = null, omitBlocked = false } = {}) {
  const sides = ['right', 'left', 'top', 'bottom'], dots = items.map((i) => ({ id: i.id, x0: i.x - 6, y0: i.y - 6, x1: i.x + 6, y1: i.y + 6 })), taken = [], out = new Map();
  const box = (it, s) => { const w = it.text.length * charPx; return s === 'right' ? { x0: it.x + gap - 1, y0: it.y - h / 2, x1: it.x + gap + w, y1: it.y + h / 2 } : s === 'left' ? { x0: it.x - gap - w, y0: it.y - h / 2, x1: it.x - gap + 1, y1: it.y + h / 2 } : s === 'top' ? { x0: it.x - w / 2, y0: it.y - gap - h, x1: it.x + w / 2, y1: it.y - gap } : { x0: it.x - w / 2, y0: it.y + gap, x1: it.x + w / 2, y1: it.y + gap + h }; };
  const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const inside = (b) => !bounds || (b.x0 >= 0 && b.x1 <= bounds.w && b.y0 >= 0 && b.y1 <= bounds.h);
  const prio = (i) => (priority && priority.has(i.id) ? 0 : 1);
  for (const it of [...items].sort((a, b) => prio(a) - prio(b) || a.x - b.x || a.y - b.y)) {
    let pick = null;
    for (const s of sides) { const b = box(it, s); if (inside(b) && !taken.some((t) => hit(t, b)) && !dots.some((d) => d.id !== it.id && hit(d, b))) { pick = { side: s, box: b }; break; } }
    if (!pick && omitBlocked && prio(it) === 1) { out.set(it.id, null); continue; }
    if (!pick) pick = { side: 'right', box: box(it, 'right'), overlap: true };
    taken.push(pick.box); out.set(it.id, pick.side);
  }
  return out;
}

export const fmtMs = (v) => (v === null ? 'no reply' : v.toFixed(1) + ' ms');
export const fmtPct = (v) => Math.round(v * 10) / 10 + '%';
export const utcDateTime = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
export const utcTime = (ms) => new Date(ms).toISOString().slice(11, 19);
export const fmtKm = (km) => Math.round(km).toLocaleString('en-US') + ' km';
export const fmtDur = (s) => (s < 3600 ? `${Math.round(s / 60)} min` : s % 3600 === 0 ? `${s / 3600} h` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);   // thresholds, e.g. 75 min -> "1 h 15 min", 24 h

// One row per published pair, with the derived values this page adds (each is labelled "derived" where it is shown).
export function buildModel(view, cls) {
  const nodes = [...view.nodes.values()].sort((a, b) => a.label.localeCompare(b.label));
  const rows = cls.pairs.map(({ p, ageS, cls: c }) => {
    const a = view.nodes.get(p.src), b = view.nodes.get(p.dst), km = distanceKm(a, b), bound = fibreBoundMs(km);
    const lost = Math.round(p.loss * p.sent / 100);
    return { id: `${p.src}>${p.dst}`, src: p.src, dst: p.dst, srcLabel: a.label, dstLabel: b.label, srcCountry: a.country, dstCountry: b.country, rtt: p.rtt, rttMin: p.rttMin, loss: p.loss, sent: p.sent, lost, lossLevel: lossLevel(p.loss, lost, p.sent),
      obsMs: p.obsMs, firstMs: p.firstMs, windowMin: Math.round((p.obsMs - p.firstMs) / 60000), ageS, cls: c, quality: p.quality, flags: p.flags, msm: p.msm, probe: p.probe, reverse: p.reverse, km, boundMs: bound, ratio: p.rtt === null ? null : p.rtt / bound };
  });
  return { nodes, nodeById: view.nodes, rows, rowById: new Map(rows.map((r) => [r.id, r])) };
}
export function kpis(model) {
  const rows = model.rows, rtts = rows.filter((r) => r.rtt !== null).map((r) => r.rtt), slowest = rows.filter((r) => r.rtt !== null).sort((a, b) => b.rtt - a.rtt || a.id.localeCompare(b.id))[0] || null;
  return { pairs: rows.length, medianOfMedians: median(rtts), lossy: rows.filter((r) => r.loss > 0).length, elevated: rows.filter((r) => r.lossLevel === 2).length, lostPackets: rows.reduce((s, r) => s + r.lost, 0), sentPackets: rows.reduce((s, r) => s + r.sent, 0), slowest };
}
export function nodeSummary(model, id) {
  const rows = model.rows.filter((r) => r.src === id || r.dst === id), rtts = rows.filter((r) => r.rtt !== null).map((r) => r.rtt);
  return { rows, count: rows.length, min: rtts.length ? Math.min(...rtts) : null, median: median(rtts), max: rtts.length ? Math.max(...rtts) : null, lossy: rows.filter((r) => r.loss > 0).length };
}

/* ---- filters and sorting ---- */
export const DEFAULT_FILTERS = Object.freeze({ node: 'all', country: 'all', rttMin: null, rttMax: null, loss: 'any', text: '', hideLevels: Object.freeze([]), hideBands: Object.freeze([]) });   // hideLevels / hideBands: the legend entries switched off
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
const hideSet = (v, max) => (Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= max))].sort((a, b) => a - b) : []);
export function normalizeFilters(f = {}) { return { node: typeof f.node === 'string' && f.node ? f.node : 'all', country: typeof f.country === 'string' && f.country && f.country.length <= 8 ? f.country : 'all', hideLevels: hideSet(f.hideLevels, 2), hideBands: hideSet(f.hideBands, 3), rttMin: num(f.rttMin), rttMax: num(f.rttMax), loss: ['any', 'lossy', 'clean'].includes(f.loss) ? f.loss : 'any', text: String(f.text || '').trim().slice(0, 60) }; }
export const filtersActive = (f) => { const n = normalizeFilters(f); return n.node !== 'all' || n.country !== 'all' || n.hideLevels.length > 0 || n.hideBands.length > 0 || n.rttMin !== null || n.rttMax !== null || n.loss !== 'any' || n.text !== ''; };
const hay = (r) => [r.srcLabel, r.dstLabel, r.src, r.dst, r.srcCountry, r.dstCountry, r.quality, r.flags.join(' ').replace(/_/g, ' '), r.msm, r.probe].join(' ').toLowerCase();
export function applyFilters(rows, f0) {
  const f = normalizeFilters(f0), toks = f.text.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => (f.node === 'all' || r.src === f.node || r.dst === f.node) && (f.country === 'all' || r.srcCountry === f.country || r.dstCountry === f.country) && !f.hideLevels.includes(r.lossLevel) && !f.hideBands.includes(rttBand(r.rtt)) && (f.rttMin === null || (r.rtt !== null && r.rtt >= f.rttMin)) && (f.rttMax === null || (r.rtt !== null && r.rtt <= f.rttMax))
    && (f.loss === 'any' || (f.loss === 'lossy' ? r.loss > 0 : r.loss === 0)) && (!toks.length || toks.every((t) => hay(r).includes(t))));
}
export const SORTS = {
  pair: { label: 'Pair', get: (r) => r.srcLabel + ' ' + r.dstLabel, first: 'asc' }, rtt: { label: 'Median RTT', get: (r) => r.rtt, first: 'desc' }, rttMin: { label: 'Min RTT', get: (r) => r.rttMin, first: 'desc' },
  loss: { label: 'Packet loss', get: (r) => r.loss, first: 'desc' }, obs: { label: 'Observed', get: (r) => r.obsMs, first: 'desc' }, age: { label: 'Age', get: (r) => r.ageS, first: 'asc' },
  quality: { label: 'Quality', get: (r) => ({ good: 0, degraded: 1, poor: 2 })[r.quality], first: 'desc' }, km: { label: 'Distance', get: (r) => r.km, first: 'desc' }
};
export function sortRows(rows, key, dir) {
  const g = (SORTS[key] || SORTS.rtt).get, s = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => { const x = g(a), y = g(b); if (x === y) return a.id.localeCompare(b.id); if (x === null || x === undefined) return 1; if (y === null || y === undefined) return -1; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * s; });
}

export function viewExtras(raw) {
  const out = {};
  if (raw && typeof raw.dataset_id === 'string' && /^[a-z0-9][a-z0-9.-]{2,47}$/.test(raw.dataset_id)) out.datasetId = raw.dataset_id;
  if (raw && raw.selection === 'freshest-direction') out.selection = raw.selection;
  return out;
}

/* ================= browser part ================= */

const GATES = {
  off: ['Dashboard switched off', 'The data source says this dashboard is off. Its data has been removed from this page.'], invalid: ['Control document not valid', 'The page cannot trust the control document, so it stays closed and its data has been removed.'],
  unreachable: ['Cannot reach the control document', 'The page cannot confirm that the dashboard is on, so it stays closed and its data has been removed.'], ctlexpired: ['Control confirmation expired', 'The page could not confirm the control document in time, so it closed itself and removed its data.'],
  restoring: ['Restoring', 'The control document says on again. The page re-opens only after fresh, repeated confirmation.'], error: ['Data could not be used', 'The control document says the dashboard is on, but the data did not load or did not pass validation.'],
  expired: ['No usable data', 'Every published value is older than 24 hours, so nothing is drawn. The provenance and freshness details are still available.']
};
const STATE_NAME = { RECENT: 'Recent', AGING: 'Aging', OLD: 'Old', EXPIRED: 'Expired' };

async function fetchJson(url, timeoutMs = CONFIG.timeoutMs) {
  const r = await fetch(url, { cache: 'no-cache', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) return { status: r.status };
  if (+r.headers.get('content-length') > CONFIG.maxBytes) throw new Error('document too large');
  const t = await r.text(); if (t.length > CONFIG.maxBytes) throw new Error('document too large');
  try { return { status: 200, json: JSON.parse(t) }; } catch (e) { return { status: 200, invalid: true }; }
}

function boot() {
  const $ = (id) => document.getElementById(id), SVGNS = 'http://www.w3.org/2000/svg';
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const se = (tag, attrs, cls) => { const e = document.createElementNS(SVGNS, tag); if (cls) e.setAttribute('class', cls); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); return e; };
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };
  const a = (href, text) => { const e = el('a', null, text); e.href = href; e.target = '_blank'; e.rel = 'noopener noreferrer'; return e; };
  const q = new URLSearchParams(location.search), local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  let origin = local && /^https?:\/\/[^\s<>"']+$/.test(q.get('data-origin') || '') ? q.get('data-origin') : CONFIG.defaultOrigin; if (!origin.endsWith('/')) origin += '/';
  let globeCtl = null;   // the globe controller, created the first time the globe is shown
  const S = { origin, phase: 'loading', mode: 'map', lens: 'rtt', order: 'alpha', globe: { prev: null, auto: null }, mon: null, viewGen: 0, loadingView: false, viewRequests: 0, refused: 0, view: null, raw: null, extras: {}, cls: null, model: null, regions: [], filters: { ...DEFAULT_FILTERS }, sort: { key: 'rtt', dir: 'desc' },
    sel: { type: null, id: null }, zoom: 'world', tab: 'pairs', visible: [], errorText: '', gateKey: '', landD: null, frameOff: false, framed: false, fitsBase: true, arcs: new Map() };
  const sim = () => (S.view ? S.view.simulated : true), W = () => (sim() ? 'values' : 'measurements');
  const ageText = (s) => (S.cls && S.cls.flags.includes('client_clock_suspect') ? 'n/a' : fmtAge(Math.max(0, s)));
  const live = (msg) => { clearTimeout(soonT); const n = $('live'); n.textContent = ''; requestAnimationFrame(() => { n.textContent = msg; }); };
  const charts = createCharts({ el, se, clear }), STAGE = ['matrix', 'distance', 'loss'];
  // A class, never the hidden attribute, takes the stage and the matrix box off the page (the hidden attribute re-styles the thead table below them; review/m2.2.1).
  const off = (id, on) => $(id).classList.toggle('is-off', on);
  const wide = () => (($(({ map: 'map', globe: 'globewrap' })[S.mode] || 'stage').clientWidth) || 720) >= 560;
  const clearStage = () => { charts.clearMatrix(); for (const id of ['scwrap', 'lswrap', 'stagebar']) clear($(id)); off('stage', true); };

  /* ---------- shareable state (M2.3): the current view as a link in the URL fragment (state.js) ---------- */
  // L.on: the link has been applied to the data now loaded. The address bar is written only then, so while the surface is closed (or before its data is in) the fragment stays exactly as it was and is applied on restore.
  const L = { on: false, t: 0, msg: '', centre: null };
  const dropText = (n) => `${n} ${n === 1 ? 'part' : 'parts'} of this link did not apply.`, note = (t) => { $('link-note').textContent = t; }, say = (t) => { note(t); live(t); };
  const liveState = () => ({ view: S.mode, tab: S.tab, sel: S.sel, filters: S.filters, sort: S.sort, zoom: S.zoom, lens: S.lens, order: S.order, centre: globeCtl && globeCtl.has() ? (globeCtl.isAnimating() && S.globe.auto ? S.globe.auto : globeCtl.getCentre()) : { lon: -15, lat: 20 } });
  function useState(s) { S.mode = s.view; S.tab = s.tab; S.sel = s.sel; S.filters = normalizeFilters(s.filters); S.sort = s.sort; S.zoom = s.zoom; S.lens = s.lens; S.order = s.order; S.frameOff = false; S.globe.prev = S.globe.auto = null; L.centre = s.centre; $('mx-order').value = s.order; if (!STAGE.includes(s.view)) clearStage(); }
  function applyLink(frag) {   // a link is applied wholesale (what it does not mention is the default); an empty fragment or a plain anchor such as #main is not a link. Returns the announcement.
    const p = parse(frag); if (p.kind !== 'link') return ''; let n = p.dropped;
    if (p.applied) { const m = S.model, r = resolve(p.state, { nodes: m.nodes.map((x) => x.id), pairs: m.rows.map((x) => x.id), countries: m.nodes.map((x) => x.country), zooms: ['world', ...S.regions.map((x) => x.id)], visible: (f) => applyFilters(m.rows, normalizeFilters(f)).map((x) => x.id) }); useState(r.state); n += r.dropped; }
    note(n ? dropText(n) : ''); return ((p.applied ? 'Link applied. ' : '') + (n ? dropText(n) : '')).trim();
  }
  const applyCentre = () => { if (L.centre && globeCtl && globeCtl.has()) globeCtl.setCentre(L.centre, { animate: false, source: 'link' }); L.centre = null; };
  function syncUrl(now) {   // at most one write per 250 ms (history.replaceState: Back and Forward keep their meaning); the state is read when the write happens
    const go = () => { L.t = 0; if (!L.on || !S.model || !monitor.allowData()) return; const f = serialize(liveState()); if (f === location.hash.slice(1)) return; try { history.replaceState(history.state, '', location.pathname + location.search + (f ? '#' + f : '')); } catch (e) { /* the address bar is optional */ } };
    if (now) { clearTimeout(L.t); go(); } else if (!L.t) L.t = setTimeout(go, 250);
  }

  /* ---------- data loading (fail closed) ---------- */
  async function getView() {
    let res; try { res = await fetchJson(S.origin + CONFIG.viewPath); } catch (e) { return { ok: false, why: 'The data could not be reached or was too large.' }; }
    if (res.status !== 200) return { ok: false, why: `The data request failed (HTTP ${res.status}).` };
    if (res.invalid) return { ok: false, why: 'The data is not valid JSON.' };
    try { return { ok: true, view: validateView(res.json), raw: res.json }; } catch (e) { return { ok: false, why: 'The data failed validation: ' + String(e.message).replace(/^invalid view: /, '') + '.' }; }
  }
  function dropData() { L.on = false; clearTimeout(L.t); L.t = 0; L.centre = null; $('link-text').value = ''; $('link-box').hidden = true; note(''); if (globeCtl) globeCtl.clear(); clearStage(); S.globe.prev = S.globe.auto = null; S.view = S.raw = S.cls = S.model = null; S.visible = []; S.sel = { type: null, id: null }; S.extras = {}; S.frameOff = false; S.framed = false; S.arcs.clear(); }
  function adoptView(view, raw) {
    S.view = view; S.raw = raw; S.extras = viewExtras(raw); S.arcs.clear(); reclassify(); S.regions = regionBoxes(S.model.nodes);
    if (S.zoom !== 'world' && !S.regions.some((r) => r.id === S.zoom)) S.zoom = 'world';
    if (S.sel.type === 'node' && !S.model.nodeById.has(S.sel.id)) S.sel = { type: null, id: null };   // a pair that vanished is dropped by computeVisible()
    if (S.filters.node !== 'all' && !S.model.nodeById.has(S.filters.node)) S.filters.node = 'all';
  }
  function reclassify() { S.cls = classify(Date.now(), S.view); S.model = buildModel(S.view, S.cls); }

  /* ---------- control plane (M3): internet-control.js decides, this page obeys ---------- */
  const over = {};
  if (local) for (const [k, p] of [['recheckMs', 'recheck-ms'], ['leaseMs', 'lease-ms'], ['minGapMs', 'min-gap-ms'], ['restoreGapMs', 'restore-gap-ms'], ['timeoutMs', 'timeout-ms'], ['jitter', 'jitter'], ['restoreConfirmations', 'confirmations']]) { if (q.get(p) !== null && Number.isFinite(Number(q.get(p)))) over[k] = Number(q.get(p)); }   // test and demo timings: localhost only
  const monitor = createMonitor({ surface: 'dashboard', cfg: over, fetchControl: () => fetchJson(S.origin + CONFIG.controlPath, monitor.config.timeoutMs), onChange: onMonitor, visible: () => !document.hidden });
  const MON_PHASE = { starting: 'loading', disabled: 'off', expired: 'expired', invalid: 'invalid', unreachable: 'unreachable', restoring: 'restoring' };
  const derivePhase = () => { const m = S.mon ? S.mon.phase : 'starting'; return m === 'enabled' ? (S.view ? 'ready' : S.errorText ? 'error' : 'loading') : MON_PHASE[m]; };
  async function loadView(reason) {   // the single gate in front of every data request
    if (!monitor.allowData()) { S.refused++; return false; }
    const gen = ++S.viewGen; S.loadingView = true; S.errorText = ''; if (!S.view) render(); S.viewRequests++;
    const r = await getView();
    if (gen !== S.viewGen) return false;   // the surface closed (or another load started) while the request was in flight: its answer is discarded
    S.loadingView = false; if (!monitor.allowData()) return false;
    if (!r.ok) { dropData(); S.errorText = r.why; render(); live(GATES.error[0]); return false; }
    adoptView(r.view, r.raw); if (!L.on) { L.msg = applyLink(location.hash); L.on = true; } render(); applyCentre(); live((reason === 'restored' ? 'Control restored. ' : '') + `Data loaded: ${S.model.rows.length} pairs, state ${S.cls.state.toLowerCase()}` + (L.msg ? ' ' + L.msg : '')); L.msg = ''; return true;
  }
  function onMonitor(snap, ev) {
    const was = S.mon ? S.mon.phase : null; S.mon = snap;
    if (snap.phase !== 'enabled' && (S.view || S.loadingView)) { S.viewGen++; S.loadingView = false; dropData(); S.errorText = ''; }   // fail closed: the data leaves memory and the page, it is not just hidden
    if (snap.phase === 'enabled' && !S.view && !S.loadingView && !S.errorText) loadView(ev.kind === 'restored' ? 'restored' : 'enabled');
    if (snap.phase !== was) { announce(snap, ev); render(); } else renderControlUi();
  }
  function announce(m, ev) {
    const msg = { disabled: 'Dashboard switched off. Its data was removed from the page.', expired: m.cause === 'document' ? 'The control document expired. Data removed from the page.' : 'Control confirmation expired. Data removed from the page.', invalid: 'Control document not valid. Data removed from the page.',
      unreachable: 'Control document unreachable. Data removed from the page.', restoring: `Restoring: confirmation ${m.streak} of ${m.need}.` }[m.phase];
    if (msg) live(msg); else if (m.phase === 'enabled' && ev.kind === 'restored') live('Control restored. Loading data.');
  }
  function renderControlUi() { S.phase = derivePhase(); document.body.setAttribute('data-phase', S.phase); renderStatus(); renderGate(!!(S.model && S.cls.state === 'EXPIRED')); renderCtl(); }
  let cdTimer = 0;
  function cooldown() { for (const id of ['btn-check', 'btn-refresh']) $(id).disabled = true; clearTimeout(cdTimer); cdTimer = setTimeout(() => { for (const id of ['btn-check', 'btn-refresh']) $(id).disabled = false; }, CONFIG.cooldownMs); }

  /* ---------- render ---------- */
  function render() {
    S.phase = derivePhase(); const hasData = !!S.model, expired = hasData && S.cls.state === 'EXPIRED';
    document.body.setAttribute('aria-busy', String(S.loadingView || (S.mon ? S.mon.phase === 'starting' : true))); document.body.setAttribute('data-phase', S.phase); document.body.setAttribute('data-sim', sim() ? '1' : '0'); document.body.setAttribute('data-state', hasData ? S.cls.state : S.phase);
    document.title = 'Internet Intelligence | Lateef Law' + (hasData ? (sim() ? ' (simulated data)' : '') : '');
    if (hasData) applyViewUi();
    renderStatus(); renderBanner(); renderGate(expired); renderCtl();
    $('app').hidden = !hasData; $('dataonly').hidden = !hasData || expired; $('tab-pairs').hidden = expired;
    // fail closed: when nothing may be shown (switched off, error, expired) no numbers are left in the page, hidden or not
    if (!hasData || expired) { if (globeCtl) globeCtl.clear(); charts.clearMatrix(); for (const id of ['kpis', 'map', 'legend', 'chips', 'zoombar', 'tbody', 'cards', 'inspector', 'framebar', 'globebar', 'globectl', 'scwrap', 'lswrap', 'stagebar']) clear($(id)); $('globebox').hidden = true; off('stage', true); S.globeKey = ''; $('framebar').hidden = true; $('framebar').setAttribute('data-mode', 'idle'); $('f-count').textContent = ''; const ns = $('f-node'); clear(ns); ns.append(new Option('All nodes', 'all')); const cs = $('f-country'); clear(cs); cs.append(new Option('All countries', 'all')); }
    if (!hasData) { clear($('panel-prov')); clear($('panel-fresh')); return; }
    if (expired && S.tab === 'pairs') S.tab = 'prov';
    if (!expired) { renderKpis(); renderNodeOptions(); renderCountryOptions(); writeFilters(); renderDataViews(); }
    renderTabs();
  }
  // Re-rendering replaces elements; keep keyboard focus on "the same" control (same node, row or card by data-id, otherwise the same position).
  function keepFocus(fn) {
    const a = document.activeElement, root = a && a !== document.body && a.closest ? a.closest('#chips, #cards, #tbody, #zoombar, #map, #inspector, #legend, #stage') : null; let k = null;
    if (root) { const item = a.closest('[data-id]') || a; k = { root: root.id, id: item.getAttribute('data-id'), idx: [...root.querySelectorAll('button, .node')].indexOf(a.closest('.node') || a) }; }
    fn(); if (!k) return;
    const r = $(k.root), all = [...r.querySelectorAll('button, .node')]; let t = null;
    if (k.root === 'inspector') { t = r.querySelector('h2'); if (t) t.tabIndex = -1; }
    else if (k.id) { t = [...r.querySelectorAll('[data-id]')].find((x) => x.getAttribute('data-id') === k.id); if (t && k.root === 'tbody') t = t.querySelector('.rowbtn'); }
    if (!t && k.idx >= 0) t = all[Math.min(k.idx, all.length - 1)];
    if (t) t.focus({ preventScroll: true });
  }
  function chipState() {
    if (S.model) return S.cls.state; return ({ loading: 'LOADING', off: 'SWITCHED OFF', invalid: 'CONTROL INVALID', unreachable: 'CONTROL UNREACHABLE', expired: 'CONTROL EXPIRED', restoring: 'RESTORING', error: 'DATA ERROR' })[S.phase] || 'DATA ERROR';
  }
  const secText = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} s`; };
  const nextIn = () => { const m = S.mon; if (!m || m.paused) return 'paused while the tab is hidden'; return m.nextCheckMs ? `about ${secText(m.nextCheckMs - Date.now())}` : 'soon'; };
  function ctlText() {
    const m = S.mon, now = Date.now(); if (!m) return 'Control: checking';
    if (m.phase === 'enabled') return `Control: enabled · confirmed ${secText(now - m.lastOkMs)} ago · lease ${secText(m.leaseDeadlineMs - now)} left · next check ${nextIn()}` + (m.failures ? ` · ${m.failures} failed` : '');
    return `Control: ${({ starting: 'checking', disabled: 'switched off', expired: m.cause === 'document' ? 'document expired' : 'confirmation expired', invalid: 'invalid', unreachable: 'unreachable', restoring: `restoring ${m.streak} of ${m.need}` })[m.phase]} · data removed · next check ${nextIn()}`;
  }
  function renderStatus() {
    const st = chipState(), tone = S.model ? ({ RECENT: 'g', AGING: 'y', OLD: 'y', EXPIRED: 'm' })[st] : st === 'LOADING' ? 'm' : st === 'RESTORING' ? 'y' : 'r', chip = $('st-chip');
    chip.className = 'chip tone-' + tone; clear(chip); chip.append(el('i', 'dot'), document.createTextNode(st));
    chip.setAttribute('data-state', st);
    const pub = $('st-pub'), newest = $('st-newest'), ctl = $('st-ctl');
    if (S.model) {
      const c = S.cls, suspect = c.flags.includes('client_clock_suspect');
      pub.textContent = `Published ${utcTime(S.view.generatedMs)}Z` + (suspect ? ' (age hidden: device clock disagrees)' : ` (${fmtAge(Math.max(0, c.publishedAgeS))} ago)`);
      const newestMs = Math.max(...S.view.pairs.map((p) => p.obsMs)); newest.textContent = `Newest ${W() === 'values' ? 'value' : 'measurement'} ${utcTime(newestMs).slice(0, 5)}Z` + (suspect ? '' : ` (${fmtAge(Math.max(0, (Date.now() - newestMs) / 1000))} ago)`);
    } else { pub.textContent = 'Published: no data loaded'; newest.textContent = ''; }
    ctl.textContent = ctlText();
  }
  function renderBanner() {
    const b = $('banner'); clear(b);
    if (!S.view) { b.hidden = true; return; }
    b.hidden = false; b.className = 'banner ' + (sim() ? 'sim' : 'real'); b.setAttribute('data-simulated', String(sim()));
    if (sim()) { b.append(el('span', 'dia'), el('strong', null, S.view.attribution.text)); }
    else { b.append(a(S.view.attribution.url, S.view.attribution.text), document.createTextNode(' Terms: '), a(S.view.attribution.termsUrl, 'RIPE Atlas Service Terms'), document.createTextNode('. This site is not affiliated with or endorsed by the RIPE NCC.')); }
  }
  function renderGate(expiredData) {
    const g = $('gate'), body = $('gate-body'), m = S.mon, key = expiredData ? 'expired' : S.model ? null : S.phase === 'error' ? 'error' : ({ off: 'off', invalid: 'invalid', unreachable: 'unreachable', expired: 'ctlexpired', restoring: 'restoring' })[S.phase] || null;
    g.hidden = !key; if (!key) { S.gateKey = ''; return; }
    const gk = [key, m && m.why, m && m.reason, m && m.lastOkMs, m && m.need, S.errorText, S.view ? S.view.generatedMs : 0].join('|'); if (gk === S.gateKey && body.firstChild) return; S.gateKey = gk; clear(body);
    body.append(el('h2', null, GATES[key][0]), el('p', null, GATES[key][1]));
    if (key === 'error') { body.append(el('p', 'gate-why', S.errorText)); return; }
    if (key === 'expired') { body.append(el('p', 'gate-why', `The data was published ${utcDateTime(S.view.generatedMs)} UTC and every value in it is older than 24 hours.`)); return; }
    body.append(el('p', 'gate-why', m.why || ''));
    if (m.reason) body.append(el('p', 'gate-why', (key === 'restoring' ? 'It was switched off with this reason: ' : 'Reason given: ') + m.reason));
    if (m.lastOkMs) body.append(el('p', 'gate-why', `Last confirmed enabled at ${utcTime(m.lastOkMs)}Z.`));
    const p = el('p', 'gate-note'), clock = el('span', null, nextIn()); clock.id = 'gate-clock'; p.append(document.createTextNode('No data is requested while this page is closed. Checking again in '), clock, document.createTextNode(`. It re-opens by itself after ${m.need} fresh, enabled confirmation${m.need > 1 ? `s at least ${secText(monitor.config.restoreGapMs)} apart` : ''}.`)); body.append(p);
  }
  function renderKpis() {
    const k = kpis(S.model), box = $('kpis'), cov = S.view.coverage; clear(box);
    const tile = (label, value, sub) => { const t = el('div', 'kpi'); t.append(el('small', null, label), el('strong', null, value), el('em', null, sub)); box.append(t); };
    tile('Pairs with data', `${k.pairs} / ${cov.pairs_expected}`, `${cov.pairs_missing} without data, directed ${cov.directed_available} of ${cov.directed_expected}`);
    tile('Median of pair medians', k.medianOfMedians === null ? 'none' : fmtMs(k.medianOfMedians), 'derived from all pairs');
    tile('Pairs with packet loss', `${k.lossy} of ${k.pairs}`, `${k.lostPackets} of ${k.sentPackets} packets lost in total, ${k.elevated} pairs elevated`);
    tile('Slowest pair', k.slowest ? fmtMs(k.slowest.rtt) : 'none', k.slowest ? `${k.slowest.srcLabel} to ${k.slowest.dstLabel}` : '');
  }
  function renderNodeOptions() {
    const sel = $('f-node'), cur = S.filters.node; clear(sel); sel.append(new Option('All nodes', 'all'));
    for (const n of S.model.nodes) sel.append(new Option(`${n.label} (${n.country})`, n.id));
    if (cur !== 'all' && !S.model.nodeById.has(cur)) S.filters.node = 'all';
  }
  function renderCountryOptions() {   // country names from the browser's own Intl data (no library, no request); the two-letter code if it has none
    const sel = $('f-country'), cur = S.filters.country, codes = [...new Set(S.model.nodes.map((n) => n.country))]; let dn = null; try { dn = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) { dn = null; }
    const name = (c) => { let t = c; try { t = (dn && dn.of(c)) || c; } catch (e) { t = c; } return t === c ? c : `${t} (${c})`; };
    clear(sel); sel.append(new Option('All countries', 'all')); for (const c of codes.sort((x, y) => name(x).localeCompare(name(y)))) sel.append(new Option(name(c), c));
    if (cur !== 'all' && !codes.includes(cur)) S.filters.country = 'all';
  }
  function writeFilters() { const f = S.filters; $('f-node').value = f.node; $('f-country').value = f.country; $('f-rttmin').value = f.rttMin === null ? '' : f.rttMin; $('f-rttmax').value = f.rttMax === null ? '' : f.rttMax; $('f-loss').value = f.loss; if ($('f-text') !== document.activeElement) $('f-text').value = f.text; $('sortSel').value = S.sort.key; }

  function computeVisible() { S.visible = sortRows(applyFilters(S.model.rows, S.filters), S.sort.key, S.sort.dir); if (S.sel.type === 'pair' && !S.visible.some((r) => r.id === S.sel.id)) { S.sel = { type: null, id: null }; S.frameOff = false; return true; } return false; }
  function renderDataViews(cleared) {
    const dropped = computeVisible() || cleared; syncUrl(); renderCount(); renderView(); renderTable(); renderInspector(); renderChips();
    if (dropped) live('Selection cleared because that pair is hidden by the filters');
  }
  function renderCount() { const n = S.visible.length, t = S.model.rows.length; $('f-count').textContent = `${n} of ${t} pairs shown` + (filtersActive(S.filters) ? ' (filtered)' : ''); }

  /* ---------- map ---------- */
  const tip = $('tip');
  function showTip(text, e) { tip.textContent = text; tip.hidden = false; const r = tip.getBoundingClientRect(); tip.style.left = Math.min(e.clientX + 14, innerWidth - r.width - 8) + 'px'; tip.style.top = Math.min(e.clientY + 16, innerHeight - r.height - 8) + 'px'; }
  const hideTip = () => { tip.hidden = true; };
  const rowTip = (r) => `${r.srcLabel} to ${r.dstLabel}: ${fmtMs(r.rtt)}, ${r.lost ? r.lost + ' of ' + r.sent + ' packets lost' + (r.lossLevel === 2 ? ' (elevated)' : '') : r.loss > 0 ? 'some packet loss' : 'no packet loss observed'}${sim() ? ' (simulated)' : ''}`;

  // The window the user chose (World or a region), unless a pair is selected whose whole arc does not fit in it: then a window that shows both endpoints and the arc.
  function currentView(aspect) {
    const base = S.zoom === 'world' ? worldView(aspect) : fitView(S.regions.find((r) => r.id === S.zoom).box, aspect), selPair = S.sel.type === 'pair' ? S.model.rowById.get(S.sel.id) : null;
    S.framed = false; S.fitsBase = true; if (!selPair) return base;
    const g = arcGeom(selPair); S.fitsBase = viewContains(base, g.e); if (S.fitsBase || S.frameOff) return base;
    S.framed = true; return pairView(S.model.nodeById.get(selPair.src), S.model.nodeById.get(selPair.dst), aspect);
  }
  function arcGeom(r) { let g = S.arcs.get(r.id); if (!g) { const pts = arcPointsUnwrapped(S.model.nodeById.get(r.src), S.model.nodeById.get(r.dst)); g = { pts, e: arcExtent(pts) }; S.arcs.set(r.id, g); } return g; }

  function renderMap() {
    const svg = $('map'), m = S.model, cw = svg.clientWidth || 720, ch = svg.clientHeight || 284, aspect = cw / ch, vb = currentView(aspect), u = vb[2] / cw;
    svg.setAttribute('viewBox', vb.map(r1).join(' ')); svg.setAttribute('aria-label', `Map of ${m.nodes.length} ${sim() ? 'simulated ' : ''}locations and ${S.visible.length} of ${m.rows.length} connections`);
    clear(svg);
    const defs = se('defs'), pat = se('pattern', { id: 'wm', width: 190, height: 96, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(-18)' }); pat.append(Object.assign(se('text', { x: 6, y: 52 }, 'wm'), { textContent: 'SIMULATED' })); defs.append(pat); svg.append(defs);
    svg.append(se('rect', { x: -2000, y: -2000, width: 5000, height: 5000 }, 'ocean')); if (sim()) svg.append(se('rect', { x: -2000, y: -2000, width: 5000, height: 5000, fill: 'url(#wm)' }, 'wmrect'));
    if (!S.landD) S.landD = landPath(); for (const k of tileOffsets(0, MAP.w, vb)) svg.append(se('path', { d: S.landD, ...(k ? { transform: `translate(${MAP.w * k} 0)` } : {}) }, 'land'));   // extra copies only when the view reaches past an edge
    const gArcs = se('g', { 'aria-hidden': 'true' }), gHits = se('g', { 'aria-hidden': 'true' }), gMarks = se('g', { 'aria-hidden': 'true' }), gNodes = se('g');
    const selNode = S.sel.type === 'node' ? S.sel.id : null, selPair = S.sel.type === 'pair' ? S.model.rowById.get(S.sel.id) : null, anySel = !!(selNode || selPair), touch = new Set();
    for (const r of S.visible) {
      const A = m.nodeById.get(r.src), B = m.nodeById.get(r.dst), g = arcGeom(r), ks = tileOffsets(g.e.x0, g.e.x1, vb), offs = ks.length ? ks : [0], d = offs.map((k) => unwrappedPath(g.pts, k)).join(''), isSel = selPair && selPair.id === r.id, hl = selNode && (r.src === selNode || r.dst === selNode);
      const dim = anySel && !isSel && !hl; touch.add(r.src); touch.add(r.dst);
      if (isSel) gArcs.append(se('path', { d, 'data-id': r.id }, 'arc-casing'));   // a white halo under the selected arc, so it stands out without changing its loss colour
      gArcs.append(se('path', { d, 'data-id': r.id }, arcClass(r, { sel: isSel, hl, dim })));
      const hit = se('path', { d, 'data-id': r.id }, 'arc-hit'); hit.addEventListener('click', (e) => { e.stopPropagation(); selectPair(r.id); }); hit.addEventListener('pointerenter', (e) => showTip(rowTip(r), e)); hit.addEventListener('pointermove', (e) => showTip(rowTip(r), e)); hit.addEventListener('pointerleave', hideTip); gHits.append(hit);
      if (r.lossLevel > 0) { const mid = g.pts[24], [x, y] = project(mid.lon, mid.lat); gMarks.append(se('path', { d: offs.map((k) => lossMarkPath(x + MAP.w * k, y, u, r.lossLevel)).join(''), 'data-id': r.id }, `lossmark l${r.lossLevel}` + (dim ? ' dim' : ''))); }
    }
    const ends = selPair ? new Set([selPair.src, selPair.dst]) : new Set(), pos = new Map(m.nodes.map((n) => { const [x, y] = project(n.lon, n.lat); return [n.id, [wrapX(x, vb), y]]; }));
    const items = m.nodes.map((n) => ({ id: n.id, x: (pos.get(n.id)[0] - vb[0]) / u, y: (pos.get(n.id)[1] - vb[1]) / u, text: wide() ? n.label : n.id.toUpperCase() }));
    const sides = placeLabels(items, { bounds: { w: cw, h: ch }, priority: ends, omitBlocked: !!selPair }), coarse = matchMedia('(pointer: coarse)').matches;
    for (const n of m.nodes) {
      const [x, y] = pos.get(n.id), side = sides.get(n.id), isSel = selNode === n.id, isEnd = ends.has(n.id);
      const g = se('g', { transform: `translate(${r1(x)} ${r1(y)}) scale(${u.toFixed(4)})`, tabindex: '0', role: 'button', 'aria-pressed': String(isSel), 'aria-label': `${n.label}, ${n.country}. ${nodeSummary(m, n.id).count} pairs. ${isSel ? 'Selected. Press to clear.' : 'Press to select.'}`, 'data-id': n.id },
        'node' + (isSel ? ' sel' : '') + (isEnd ? ' end' : '') + (selPair && !isEnd ? ' faded' : '') + (filtersActive(S.filters) && !touch.has(n.id) ? ' idle' : ''));
      g.append(se('circle', { r: coarse ? 22 : 15 }, 'nhit'), se('circle', { r: 6 }, 'ring'), se('circle', { r: 2.4 }, 'core'));
      const tx = side === 'right' ? { x: 9, y: 4, anchor: 'start' } : side === 'left' ? { x: -9, y: 4, anchor: 'end' } : side === 'top' ? { x: 0, y: -11, anchor: 'middle' } : { x: 0, y: 19, anchor: 'middle' };
      if (side) { const t = se('text', { x: tx.x, y: tx.y, 'text-anchor': tx.anchor }, 'nl' + (isEnd ? ' end' : '')); t.textContent = wide() ? n.label : n.id.toUpperCase(); g.append(t); }
      g.addEventListener('click', (e) => { e.stopPropagation(); selectNode(n.id); }); g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectNode(n.id); } });
      g.addEventListener('pointerenter', (e) => showTip(`${n.label} (${n.country}), ${nodeSummary(m, n.id).count} pairs${sim() ? ', simulated location' : ''}`, e)); g.addEventListener('pointermove', (e) => showTip(`${n.label} (${n.country}), ${nodeSummary(m, n.id).count} pairs${sim() ? ', simulated location' : ''}`, e)); g.addEventListener('pointerleave', hideTip);
      gNodes.append(g);
    }
    svg.append(gArcs, gMarks, gHits, gNodes);
    renderZoom(); renderLegend();
  }
  const regionNames = () => (S.zoom === 'world' ? ['World', 'World'] : (() => { const r = S.regions.find((x) => x.id === S.zoom); return [r.label, r.short]; })());
  function renderZoom() {
    const bar = $('zoombar'); clear(bar);
    for (const [id, label, short] of [['world', 'World', 'World'], ...S.regions.map((r) => [r.id, r.label, r.short])]) {
      const b = el('button', 'btn small', wide() ? label : short); b.type = 'button'; b.setAttribute('data-zoom', id); b.setAttribute('aria-pressed', String(!S.framed && S.zoom === id)); b.setAttribute('aria-label', 'Map view: ' + label);
      b.addEventListener('click', () => { S.zoom = id; syncUrl(); S.frameOff = true; keepFocus(() => renderMap()); live('Map view: ' + label); }); bar.append(b);
    }
    renderFrameBar();
  }
  // While the map is framed on a pair, say so and offer the way back to the window the user had chosen; if they went back and the pair is out of view, offer to frame it again.
  function renderFrameBar() {
    // The bar is always present and always the same height, so selecting a pair never moves the map under the pointer. Its mode: idle, fits, framed or reframe.
    const fb = $('framebar'); clear(fb); fb.hidden = false; const r = S.sel.type === 'pair' ? S.model.rowById.get(S.sel.id) : null, [label, short] = regionNames(), w = wide(), mode = !r ? 'idle' : S.framed ? 'framed' : S.frameOff && !S.fitsBase ? 'reframe' : 'fits';
    fb.setAttribute('data-mode', mode); fb.className = 'framebar ' + mode;
    if (mode === 'idle') fb.append(el('span', 'frame-note', 'Select a connection to see both of its ends.'));
    else if (mode === 'fits') fb.append(el('span', 'frame-note', w ? `${r.srcLabel} and ${r.dstLabel} are both in this view.` : 'Both ends are in view.'));
    else if (mode === 'framed') {
      const back = el('button', 'btn small back', w ? `Back to ${label}` : `Back to ${short}`); back.type = 'button'; back.setAttribute('data-back', '1'); back.setAttribute('aria-label', `Return to the previous map view: ${label}`);
      back.addEventListener('click', () => { S.frameOff = true; renderMap(); const z = $('zoombar').querySelector(`[data-zoom="${S.zoom}"]`); if (z) z.focus({ preventScroll: true }); live(`Map view: ${label}`); });
      fb.append(el('span', 'frame-note', w ? `Framed to show both ends: ${r.srcLabel} and ${r.dstLabel}.` : 'Framed on both ends.'), back);
    } else {
      const again = el('button', 'btn small back', 'Show both ends'); again.type = 'button'; again.setAttribute('data-reframe', '1');
      again.addEventListener('click', () => { S.frameOff = false; keepFocus(() => renderMap()); live('Map framed to show both endpoints'); });
      fb.append(el('span', 'frame-note', w ? `${r.srcLabel} and ${r.dstLabel} are not both in this view.` : 'Pair not fully in view.'), again);
    }
  }
  function renderLegend() {
    const ul = $('legend'); clear(ul); const rows = S.model.rows, sent = Math.max(...rows.map((r) => r.sent)), line = S.mode === 'map' || S.mode === 'globe';
    const counts = { loss: [0, 1, 2].map((l) => rows.filter((r) => r.lossLevel === l).length), band: [0, 1, 2, 3].map((b) => rows.filter((r) => rttBand(r.rtt) === b).length) };
    const swatch = (it) => { const cls = it.type === 'band' ? 'b' + it.band : it.line; if (!line) return el('span', 'sw ' + cls); const s = se('svg', { width: 28, height: 10, 'aria-hidden': 'true' }); s.append(se('line', { x1: 1, y1: 5, x2: 27, y2: 5 }, 'lg ' + (it.type === 'band' ? 'n ' : '') + cls)); return s; };
    for (const it of legendModel({ sim: sim(), sent, view: S.mode, counts })) {
      if (it.type === 'title') ul.append(el('li', 'lg-title', it.text)); else if (it.type === 'note') ul.append(el('li', 'lg-note', it.text));
      else {
        const off = (it.group === 'loss' ? S.filters.hideLevels : S.filters.hideBands).includes(it.idx), li = el('li'), b = el('button', 'lg-btn'); b.type = 'button'; b.setAttribute('data-id', (it.group === 'loss' ? 'l' : 'b') + it.idx); b.setAttribute('aria-pressed', String(!off));
        b.setAttribute('aria-label', `${it.group === 'loss' ? 'Packet loss' : 'Round-trip time'}: ${it.text.trim()}, ${it.count} pairs`); b.append(swatch(it)); if (it.shape) b.append(el('span', it.shape)); b.append(document.createTextNode(`${it.text.trim()} (${it.count})`));
        b.addEventListener('click', () => toggleLegend(it)); li.append(b); ul.append(li);
      }
    }
  }
  function toggleLegend(it) {
    const key = it.group === 'loss' ? 'hideLevels' : 'hideBands', cur = S.filters[key], hide = !cur.includes(it.idx);
    S.filters = normalizeFilters({ ...S.filters, [key]: hide ? [...cur, it.idx] : cur.filter((x) => x !== it.idx) }); keepFocus(() => renderDataViews());
    live(`${it.text.trim()}: ${hide ? 'hidden' : 'shown'}. ${S.visible.length} of ${S.model.rows.length} pairs shown.`);
  }
  function renderChips() {
    const box = $('chips'); clear(box);
    for (const n of S.model.nodes) { const b = el('button', 'btn chip-btn' + (S.sel.type === 'node' && S.sel.id === n.id ? ' on' : ''), wide() ? n.label : n.id.toUpperCase()); b.type = 'button'; b.setAttribute('aria-pressed', String(S.sel.type === 'node' && S.sel.id === n.id)); b.setAttribute('aria-label', `${n.label}, ${n.country}`); b.addEventListener('click', () => selectNode(n.id)); box.append(b); }
  }

  /* ---------- globe view (M2.1) ---------- */
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function ensureGlobe() {
    if (globeCtl) return globeCtl;
    globeCtl = createGlobe({ svg: $('globe'), rings: LAND, placeLabels, tip: { show: showTip, hide: hideTip }, reducedMotion: reduced,
      onSelectPair: (id) => selectPair(id, 'globe'), onSelectNode: (id) => selectNode(id, 'globe'), onClear: () => clearSelection('globe'), onRotate: onGlobeRotate });
    return globeCtl;
  }
  const MODES = { map: ['Map', 'v-map', 'Map view'], globe: ['Globe', 'v-globe', 'Globe view. Arrow keys turn the globe.'], matrix: ['Latency matrix', 'v-matrix', 'Latency matrix. One cell per pair, one direction each.'], distance: ['Round-trip time versus distance', 'v-dist', 'Round-trip time versus distance chart'], loss: ['Packet loss', 'v-loss', 'Packet loss list'] };
  function applyViewUi() {
    const m = S.mode, st = STAGE.includes(m); $('mapwrap').hidden = m !== 'map'; $('zoombar').hidden = m !== 'map'; if (m !== 'map') $('framebar').hidden = true; $('globebox').hidden = m !== 'globe'; off('stage', !st);
    off('mxbox', m !== 'matrix'); $('scbox').hidden = m !== 'distance'; $('lsbox').hidden = m !== 'loss'; $('lenssw').hidden = !(m === 'matrix' || m === 'distance'); $('map-h').textContent = MODES[m][0];
    for (const k in MODES) $(MODES[k][1]).setAttribute('aria-pressed', String(k === m)); for (const k of ['rtt', 'loss']) $('l-' + k).setAttribute('aria-pressed', String(S.lens === k));
  }
  function setMode(m, announce = true) {
    if (m === S.mode) return; S.mode = m; syncUrl(); applyViewUi(); if (!STAGE.includes(m)) clearStage();
    if (S.model) { if (m === 'globe') { renderGlobe(); if (S.sel.type) { globeFocusSelection(false); renderGlobeBar(); } } else renderView(); }
    if (announce) live(MODES[m][2]);
  }
  function renderView() { if (S.mode === 'globe') renderGlobe(); else if (S.mode === 'map') renderMap(); else renderStage(); }
  function renderStage() {   // matrix, distance chart or loss list: all drawn from S.model and the same filters, selection and legend as the map
    applyViewUi(); if (S.mode !== 'matrix') charts.clearMatrix(); for (const id of ['scwrap', 'lswrap']) if (id !== ({ distance: 'scwrap', loss: 'lswrap' })[S.mode]) clear($(id));
    const c = { model: S.model, rows: S.visible, shown: new Set(S.visible.map((r) => r.id)), sel: S.sel, lens: S.lens, order: S.order, sim: sim(), wide: wide(), coarse: matchMedia('(pointer: coarse)').matches, tip: { show: showTip, hide: hideTip }, rowTip,
      onPair: (id) => selectPair(id, 'stage'), onNode: (id) => selectNode(id, 'stage'), onClear: () => clearSelection('stage'), onTable: openPairsTable, hint: ({ matrix: 'Select a cell to see its details.', distance: 'Select a point to see its details.', loss: 'Select a row to see its details.' })[S.mode] };
    charts.renderBar($('stagebar'), c); if (S.mode === 'matrix') charts.renderMatrix($('mxwrap'), c); else if (S.mode === 'distance') charts.renderScatter($('scwrap'), c); else charts.renderStrip($('lswrap'), c); renderLegend();
  }
  function openPairsTable() { S.tab = 'pairs'; S.sort = { key: 'km', dir: 'asc' }; renderDataViews(); renderTabs(); $('tab-pairs').focus(); live('Pairs table sorted by distance, nearest first'); }
  function renderGlobe() {
    const g = ensureGlobe(), m = S.model; applyViewUi(); S.wideG = wide();   // measured once here and on resize, never inside the drawing loop (reading a width there forces a layout on every frame)
    const count = (n) => nodeSummary(m, n.id).count;
    g.setData({ nodes: m.nodes, nodeById: m.nodeById, rows: S.visible, rowById: m.rowById, total: m.rows.length, sel: S.sel, filtersActive: filtersActive(S.filters), sim: sim(), coarse: matchMedia('(pointer: coarse)').matches, rowTip,
      nodeTip: (n) => `${n.label} (${n.country}), ${count(n)} pairs${sim() ? ', simulated location' : ''}`, nodeLabel: (n) => (S.wideG ? n.label : n.id.toUpperCase()),
      nodeAria: (n, isSel) => `${n.label}, ${n.country}. ${count(n)} pairs. ${isSel ? 'Selected. Press to clear.' : 'Press to select.'}` });
    buildGlobeControls(); updateGlobeControls(); renderGlobeBar(); renderLegend();
  }
  const presets = () => [['world', 'World', 'World', { ...DEFAULT_CENTRE }], ...S.regions.map((r) => [r.id, r.label, r.short, normCentre({ lon: (r.box.lonMin + r.box.lonMax) / 2, lat: (r.box.latMin + r.box.latMax) / 2 })])];
  function buildGlobeControls() {   // built once per data set, so keyboard focus survives every turn
    const key = S.regions.map((r) => r.id).join(','); if (S.globeKey === key && $('globectl').firstChild) return; S.globeKey = key;
    const box = $('globectl'); clear(box);
    const group = (label, cls) => { const g = el('span', 'gc-group' + (cls ? ' ' + cls : '')); g.setAttribute('role', 'group'); g.setAttribute('aria-label', label); box.append(g); return g; };
    const btn = (g, text, label, fn, attrs) => { const b = el('button', 'btn small', text); b.type = 'button'; b.setAttribute('aria-label', label); for (const k in attrs || {}) b.setAttribute(k, attrs[k]); b.addEventListener('click', fn); g.append(b); return b; };
    const pg = group('Turn the globe to a region');
    for (const [id, label, , centre] of presets()) btn(pg, label, 'Turn the globe to: ' + label, () => { globeCtl.setCentre(centre, { source: 'preset' }); live('Globe turned to ' + label); }, { 'data-centre': id });
    const tg = group('Turn the globe a step');
    for (const [id, text, label, dl, dt] of [['w', 'West', 'Turn the globe west', -1, 0], ['e', 'East', 'Turn the globe east', 1, 0], ['n', 'North', 'Turn the globe north', 0, 1], ['s', 'South', 'Turn the globe south', 0, -1]]) btn(tg, text, label, () => globeCtl.turn(dl * globeCtl.step, dt * globeCtl.step, 'button'), { 'data-turn': id });
    const sg = group('Turn to the selection', 'gc-sel'); btn(sg, 'Turn to selection', 'Turn the globe to show the selected pair or location', () => { globeFocusSelection(true); renderGlobeBar(); $('globe').focus({ preventScroll: true }); }, { 'data-turn': 'sel' });
  }
  function updateGlobeControls() {
    if (!globeCtl || !globeCtl.has()) return; const c = globeCtl.getCentre(), w = wide();
    for (const [id, label, short, centre] of presets()) { const b = $('globectl').querySelector(`[data-centre="${id}"]`); if (b) { b.textContent = w ? label : short; b.setAttribute('aria-pressed', String(sameCentre(c, centre, 1))); } }
    const sel = $('globectl').querySelector('[data-turn="sel"]'); if (sel) sel.disabled = !S.sel.type;
  }
  // Turn so the selection is in view, only when it is not (a click on the globe itself never moves it). force: turn even when it is in view.
  function globeFocusSelection(force) {
    const g = globeCtl, m = S.model; if (!g || !m || !S.sel.type) return; const o = viewer(g.getCentre()); let target = null;
    if (S.sel.type === 'pair') { const r = m.rowById.get(S.sel.id), A = m.nodeById.get(r.src), B = m.nodeById.get(r.dst); if (force || !lineVisible(A, B, o, 0.05)) target = centreForPair(A, B); }
    else { const n = m.nodeById.get(S.sel.id); if (force || !placeVisible(n, o, 0.1)) target = normCentre({ lon: n.lon, lat: n.lat }); }
    if (!target) return; S.globe.prev = { ...g.getCentre() }; S.globe.auto = target; g.setCentre(target, { source: 'select' });
  }
  function onGlobeRotate(c, src) {
    if (['drag', 'key', 'button', 'preset'].includes(src)) S.globe.prev = null;
    syncUrl(); updateGlobeControls(); renderGlobeBar(); if (['drag', 'key', 'button'].includes(src)) liveSoon(`Globe turned. ${globeCtl.inView()} of ${S.model.nodes.length} locations in view.`);
  }
  let soonT = 0; const liveSoon = (msg) => { clearTimeout(soonT); soonT = setTimeout(() => live(msg), 600); };   // key repeat must not flood the screen reader
  function renderGlobeBar() {
    const bar = $('globebar'); clear(bar); if (!S.model || !globeCtl || !globeCtl.has()) return;
    const g = globeCtl, cur = g.isAnimating() && S.globe.auto ? S.globe.auto : g.getCentre(), o = viewer(cur), m = S.model, w = wide(), turned = !!S.globe.prev && !!S.globe.auto && sameCentre(cur, S.globe.auto, 0.6);
    let mode = 'idle', note = 'Select a connection to see both of its ends. Drag the globe or use the arrow keys to turn it.', act = null;
    const back = ['Back', 'Return to the previous view of the globe', () => { const p = S.globe.prev; S.globe.prev = S.globe.auto = null; g.setCentre(p, { source: 'back' }); $('globe').focus({ preventScroll: true }); live('Globe turned back'); }];
    if (S.sel.type === 'pair') {
      const r = m.rowById.get(S.sel.id), A = m.nodeById.get(r.src), B = m.nodeById.get(r.dst), fits = lineVisible(A, B, o, 0.05);
      if (fits) { mode = turned ? 'recentred' : 'fits'; note = turned ? (w ? `Turned to show both ends: ${r.srcLabel} and ${r.dstLabel}.` : 'Turned to show both ends.') : (w ? `${r.srcLabel} and ${r.dstLabel} are both in view.` : 'Both ends are in view.'); if (turned) act = back; }
      else if (!pairFits(A, B)) { mode = 'far'; note = w ? `${r.srcLabel} and ${r.dstLabel} are ${Math.round(angularDeg(A, B))} degrees apart, too far for both ends to show at once, so the line is cut at the edge of the globe.` : 'Too far apart for both ends: the line is cut at the edge.'; if (turned) act = back; }
      else { mode = 'reframe'; note = w ? `${r.srcLabel} and ${r.dstLabel} are not both in view.` : 'Pair not fully in view.'; act = ['Show both ends', 'Turn the globe to show both ends', () => { globeFocusSelection(true); renderGlobeBar(); $('globe').focus({ preventScroll: true }); }]; }
    } else if (S.sel.type === 'node') {
      const n = m.nodeById.get(S.sel.id);
      if (placeVisible(n, o, 0.1)) { mode = turned ? 'recentred' : 'fits'; note = `${n.label} is in view.` ; if (turned) act = back; }
      else { mode = 'reframe'; note = `${n.label} is on the far side.`; act = [`Turn to ${w ? n.label : n.id.toUpperCase()}`, `Turn the globe to show ${n.label}`, () => { globeFocusSelection(true); renderGlobeBar(); $('globe').focus({ preventScroll: true }); }]; }
    }
    bar.setAttribute('data-mode', mode); bar.className = 'framebar ' + mode; bar.append(el('span', 'frame-note', note));
    if (act) { const b = el('button', 'btn small back', act[0]); b.type = 'button'; b.setAttribute('aria-label', act[1]); b.addEventListener('click', act[2]); bar.append(b); }
  }

  /* ---------- table and cards ---------- */
  const COLS = [['pair', 'Pair (direction shown)', false], ['rtt', 'Median RTT', true], ['rttMin', 'Min RTT', true], ['loss', 'Packet loss', true], ['obs', 'Observed (UTC)', true], ['age', 'Age', true], ['quality', 'Quality', false], ['km', 'Distance', true]];
  function buildThead() {
    const tr = $('thead-row'); clear(tr);
    for (const [key, label, numeric] of COLS) { const th = el('th'); th.scope = 'col'; if (numeric) th.className = 'n'; th.setAttribute('data-key', key); const b = el('button', 'sortbtn', label); b.type = 'button'; b.addEventListener('click', () => setSort(key)); th.append(b); tr.append(th); }
    const sel = $('sortSel'); clear(sel); for (const k of Object.keys(SORTS)) sel.append(new Option(SORTS[k].label, k));
  }
  function setSort(key) { if (S.sort.key === key) S.sort.dir = S.sort.dir === 'asc' ? 'desc' : 'asc'; else S.sort = { key, dir: SORTS[key].first }; renderDataViews(); live(`Sorted by ${SORTS[key].label}, ${S.sort.dir === 'asc' ? 'ascending' : 'descending'}`); }
  function lossText(r) { return (r.loss > 0 ? `${fmtPct(r.loss)} (${r.lost} of ${r.sent})` : `0% (0 of ${r.sent})`) + (r.lossLevel === 2 ? ' elevated' : ''); }
  const lossShape = (r) => (r.lossLevel === 2 ? el('span', 'tri') : r.lossLevel === 1 ? el('span', 'dia') : null);   // a shape as well as a colour, so loss is never colour-only
  function renderTable() {
    for (const th of $('thead-row').children) { const k = th.getAttribute('data-key'); th.setAttribute('aria-sort', S.sort.key === k ? (S.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'); }
    $('sortDir').textContent = S.sort.dir === 'asc' ? 'Ascending' : 'Descending'; $('sortSel').value = S.sort.key;
    const tb = $('tbody'), ul = $('cards'); clear(tb); clear(ul);
    const selNode = S.sel.type === 'node' ? S.sel.id : null;
    if (!S.visible.length) { const tr = el('tr', 'empty'), td = el('td', null, 'No pairs match these filters.'); td.colSpan = COLS.length; tr.append(td); tb.append(tr); ul.append(el('li', 'empty', 'No pairs match these filters.')); return; }
    for (const r of S.visible) {
      const isSel = S.sel.type === 'pair' && S.sel.id === r.id, hl = selNode && (r.src === selNode || r.dst === selNode), cls = (isSel ? 'on ' : '') + (hl ? 'hl ' : '') + (r.cls !== 'recent' ? 'old' : '');
      const tr = el('tr', cls.trim()); tr.setAttribute('data-id', r.id);
      const c0 = el('td'), b = el('button', 'rowbtn', `${r.srcLabel} → ${r.dstLabel}`); b.type = 'button'; if (isSel) b.setAttribute('aria-current', 'true'); c0.append(b); tr.append(c0);
      const cell = (text, n) => { const td = el('td', n ? 'n' : null, text); tr.append(td); return td; };
      cell(fmtMs(r.rtt), true); cell(r.rttMin === null ? 'no reply' : fmtMs(r.rttMin), true);
      const lc = el('td', 'n' + (r.lossLevel === 2 ? ' red' : r.loss > 0 ? ' amb' : '')), shp = lossShape(r); if (shp) lc.append(shp, document.createTextNode(' ')); lc.append(document.createTextNode(lossText(r))); tr.append(lc);
      cell(utcDateTime(r.obsMs), true); const age = cell(ageText(r.ageS), true); age.setAttribute('data-age', String(r.ageS)); cell(r.quality + (r.flags.length ? ' (' + r.flags.join(', ').replace(/_/g, ' ') + ')' : ''), false); cell(fmtKm(r.km), true);
      tb.append(tr);
      const li = el('li'), cb = el('button', 'pc' + (isSel ? ' on' : '') + (hl ? ' hl' : '')); cb.type = 'button'; cb.setAttribute('data-id', r.id); if (isSel) cb.setAttribute('aria-current', 'true');
      cb.append(el('b', null, `${r.srcLabel} → ${r.dstLabel}`), el('span', null, fmtMs(r.rtt)), el('span', r.lossLevel === 2 ? 'red' : r.loss > 0 ? 'amb' : '', (r.lossLevel === 2 ? '▲ ' : r.loss > 0 ? '◆ ' : '') + lossText(r)), el('span', 'dim', `${r.quality} · ${utcDateTime(r.obsMs).slice(11)}Z`));
      li.append(cb); ul.append(li);
    }
  }

  /* ---------- selection ---------- */
  function selectNode(id, from) { S.frameOff = false; S.sel = S.sel.type === 'node' && S.sel.id === id ? { type: null, id: null } : { type: 'node', id }; afterSelect(from); const n = S.model.nodeById.get(id); live(S.sel.type ? `Selected ${n.label}` : 'Selection cleared'); }
  function selectPair(id, from) {
    S.frameOff = false; S.sel = S.sel.type === 'pair' && S.sel.id === id ? { type: null, id: null } : { type: 'pair', id }; afterSelect(from); const r = S.model.rowById.get(id);
    live(S.sel.type ? `Selected ${r.srcLabel} to ${r.dstLabel}.` + (S.mode === 'map' && S.framed ? ` The map now shows both endpoints. Use Back to ${regionNames()[0]} to return.` : '') : 'Selection cleared');
  }
  function clearSelection(from) { if (!S.sel.type) return; S.frameOff = false; S.sel = { type: null, id: null }; afterSelect(from); live('Selection cleared'); }
  function afterSelect(from) {
    hideTip(); syncUrl(); if (!S.sel.type) S.globe.prev = S.globe.auto = null;
    keepFocus(() => { renderView(); renderTable(); renderInspector(); renderChips(); });
    if (S.mode === 'globe' && from !== 'globe' && S.sel.type) { globeFocusSelection(false); renderGlobeBar(); }
  }

  /* ---------- inspector ---------- */
  function dl(pairs) { const d = el('dl'); for (const [k, v, cls] of pairs) { d.append(el('dt', null, k)); const dd = el('dd', cls || null); if (v instanceof Node) dd.append(v); else dd.textContent = v; d.append(dd); } return d; }
  function renderInspector() {
    const box = $('inspector'); clear(box); const m = S.model;
    const head = (kicker, title, sub) => { if (sim()) box.append(el('span', 'chip sim-chip', 'Simulated')); box.append(el('p', 'kick', kicker), el('h2', 't', title)); if (sub) box.append(el('p', 'sub', sub)); };
    if (S.sel.type === 'node') {
      const n = m.nodeById.get(S.sel.id), s = nodeSummary(m, n.id), vis = s.rows.filter((r) => S.visible.some((v) => v.id === r.id)).length;
      head('Node', n.label, `${n.country} · ${n.lat.toFixed(2)}, ${n.lon.toFixed(2)}${sim() ? ' · simulated location' : ''}`);
      box.append(dl([['Pairs', `${s.count} (${vis} shown by the filters)`], ['Median RTT of its pairs', s.median === null ? 'none' : fmtMs(s.median)], ['Fastest and slowest', s.min === null ? 'none' : `${fmtMs(s.min)} and ${fmtMs(s.max)}`], ['Pairs with packet loss', String(s.lossy)]]), el('p', 'derived', 'Summary values are derived by this page from the published pairs.'));
      const actions = el('div', 'actions'), f = el('button', 'btn small', 'Filter to this node'); f.type = 'button'; f.addEventListener('click', () => { S.filters.node = n.id; writeFilters(); renderDataViews(); live(`Filtered to ${n.label}`); });
      const c = el('button', 'btn small', 'Clear selection'); c.type = 'button'; c.addEventListener('click', clearSelection); actions.append(f, c); box.append(actions);
      box.append(el('h3', null, 'Its pairs'));
      const ul = el('ul', 'pairlist'); for (const r of sortRows(s.rows, 'rtt', 'desc')) { const li = el('li'), b = el('button', 'linkbtn'); b.type = 'button'; const other = r.src === n.id ? r.dstLabel : r.srcLabel; const val = el('span', 'n', fmtMs(r.rtt)), shp = lossShape(r); if (shp) val.append(document.createTextNode(' '), shp); b.append(document.createTextNode(`${r.src === n.id ? '→' : '←'} ${other}`), val); b.addEventListener('click', () => selectPair(r.id)); li.append(b); ul.append(li); } box.append(ul);
    } else if (S.sel.type === 'pair') {
      const r = m.rowById.get(S.sel.id);
      head('Pair', `${r.srcLabel} → ${r.dstLabel}`, 'Direction as published: source to target. The other direction is not in this view.');
      box.append(dl([['Median RTT', fmtMs(r.rtt)], ['Min RTT', r.rttMin === null ? 'no reply' : fmtMs(r.rttMin)], ['Packet loss', r.loss > 0 ? `${r.lost} of ${r.sent} packets (${fmtPct(r.loss)})` : `none of ${r.sent} packets`, r.lossLevel === 2 ? 'red' : r.loss > 0 ? 'amb' : ''],
        ['Loss level', r.lossLevel === 2 ? `elevated: above ${LOSS_RULE.above * 100}% with 95% confidence` : r.lossLevel === 1 ? 'observed, not enough to call elevated' : 'none observed in this window. This does not mean the path is healthy.', r.lossLevel === 2 ? 'red' : r.loss > 0 ? 'amb' : ''],
        ['Window', `${utcDateTime(r.firstMs).slice(11)} to ${utcDateTime(r.obsMs).slice(11)} UTC, ${r.windowMin} min`], ['Observed', utcDateTime(r.obsMs) + ' UTC'], ['Age', ageText(r.ageS)], ['Quality', r.quality + (r.flags.length ? ' · ' + r.flags.join(', ').replace(/_/g, ' ') : '')], ['Other direction', r.reverse === 'present' ? 'has data (values not in this view)' : 'no usable data']]));
      box.append(el('h3', null, 'Provenance'));
      box.append(dl([['Source', sim() ? 'simulated, no RIPE Atlas measurement' : 'RIPE Atlas ping'], ['Measurement id', sim() ? String(r.msm) : a(`https://atlas.ripe.net/measurements/${r.msm}/`, '#' + r.msm)], ['Probe id', String(r.probe)], ['Dataset', S.extras.datasetId || 'not stated']]));
      box.append(el('h3', null, 'Derived by this page'));
      box.append(dl([['Great-circle distance', fmtKm(r.km)], ['Fibre lower bound', fmtMs(r.boundMs)], ['RTT over bound', r.ratio === null ? 'none' : r.ratio.toFixed(2) + 'x']]), el('p', 'derived', sim() ? 'Simulated RTT is generated from distance, so this ratio says nothing about the real Internet.' : 'Distance is between the published node coordinates. The bound is distance / 100 ms, the physical minimum in fibre.'));
      const actions = el('div', 'actions'); for (const nid of [r.src, r.dst]) { const b = el('button', 'btn small', 'Open ' + m.nodeById.get(nid).label); b.type = 'button'; b.addEventListener('click', () => selectNode(nid)); actions.append(b); } const c = el('button', 'btn small', 'Clear selection'); c.type = 'button'; c.addEventListener('click', clearSelection); actions.append(c); box.append(actions);
    } else {
      head('Details', 'Select a node or a connection', null);
      box.append(el('p', null, 'Click a node or an arc on the map, a chip below it, or a row in the table. The details, provenance and derived values appear here.'), el('p', 'derived', sim() ? 'Everything on this page is simulated data.' : ''));
    }
  }

  /* ---------- tabs: provenance, freshness ---------- */
  function renderTabs() {
    for (const t of ['pairs', 'prov', 'fresh']) { const on = S.tab === t; $('tab-' + t).setAttribute('aria-selected', String(on)); $('tab-' + t).tabIndex = on ? 0 : -1; $('panel-' + t).hidden = !on; }
    renderProvenance(); renderFreshness();
  }
  function renderProvenance() {
    const p = $('panel-prov'); clear(p); if (!S.model) return; const v = S.view, c = v.coverage;
    p.append(el('h2', null, 'Provenance'));
    p.append(dl([['Source', sim() ? 'SIMULATED: generated by the collector, not measured' : 'RIPE Atlas'], ['Dataset', S.extras.datasetId || 'not stated'], ['Selection rule', S.extras.selection === 'freshest-direction' ? 'freshest direction per pair' : 'not stated'], ['Published', utcDateTime(v.generatedMs) + ' UTC'],
      ['Coverage', `${c.pairs_published} of ${c.pairs_expected} pairs published, ${c.pairs_missing} without data; ${c.directed_available} of ${c.directed_expected} directed observations available`], ['Gaps', v.gaps.length ? v.gaps.map((g) => `${v.nodes.get(g.a).label}-${v.nodes.get(g.b).label}`).join(', ') : 'none']]));
    p.append(el('h3', null, 'Attribution'), el('p', null, v.attribution.text), el('p', 'derived', v.attribution.disclaimer));
    const links = el('p', 'derived'); links.append(sim() ? document.createTextNode('Source code: ') : document.createTextNode('Source: '), a(v.attribution.url, v.attribution.url.replace(/^https:\/\//, '')), sim() ? document.createTextNode('. No measurement service is involved.') : document.createTextNode(''));
    p.append(links);
    const sents = [...new Set(S.model.rows.map((r) => r.sent))].sort((a, b) => a - b), per = sents.map((n) => `${n} packets: ${elevatedFrom(n) === null ? 'never' : elevatedFrom(n) + ' or more lost'}`).join('; ');
    p.append(el('h3', null, 'How packet loss is classified'), el('p', null, `None observed: no packet was lost in the window. Observed: at least one packet was lost, but not enough to be confident the true loss rate is above 1%. Elevated: the lower end of the 95% Wilson score interval for the true loss rate is above 1%. For the sample sizes in this data, elevated starts at: ${per}.`),
      el('p', 'derived', 'This rule belongs to this dashboard. The data contract defines no loss threshold, only a flag when any packet was lost. A fixed percentage would mislead with so few packets: one chance drop out of 30 is already 3.3%. No loss observed describes one window of a few dozen packets. It is not a guarantee that a path is healthy, and the colours never say so.'));
    const ids = new Set(v.pairs.map((x) => x.msm)), probes = new Set(v.pairs.map((x) => x.probe));
    p.append(el('h3', null, 'Identifiers'), el('p', null, `${ids.size} distinct measurement ids and ${probes.size} distinct probe ids across ${v.pairs.length} pairs. Every pair shows its own ids in the details panel.` + (sim() ? ' Simulated ids live in a reserved range above 4,000,000,000 that no real RIPE Atlas id has reached; a view that mixes simulated and real ids is refused.' : '')));
  }
  function renderFreshness() {
    const p = $('panel-fresh'); clear(p); if (!S.model) return; const c = S.cls, counts = { recent: 0, aging: 0, old: 0, expired: 0, excluded: 0 }; for (const x of c.pairs) counts[x.cls]++;
    const newestMs = Math.max(...S.view.pairs.map((x) => x.obsMs)), oldestMs = Math.min(...S.view.pairs.map((x) => x.obsMs)), suspect = c.flags.includes('client_clock_suspect');
    p.append(el('h2', null, 'Freshness and control'), el('p', null, S.cls.chip || 'No chip: nothing usable.'));
    p.append(dl([['State', STATE_NAME[c.state]], ['Publication age', suspect ? 'hidden (device clock disagrees)' : fmtAge(Math.max(0, c.publishedAgeS))], ['Newest and oldest value', `${utcDateTime(newestMs).slice(11)}Z and ${utcDateTime(oldestMs).slice(11)}Z`],
      ['Pairs by age class', `${counts.recent} recent, ${counts.aging} aging, ${counts.old} old, ${counts.expired} expired`], ['Flags', c.flags.length ? c.flags.join(', ').replace(/_/g, ' ') : 'none']]));
    p.append(el('h3', null, 'How the state is decided'));
    const ul = el('ul', 'rules'); for (const t of [`Recent: at least half the pairs are newer than ${fmtDur(TH.pairRecentS)} and the publication is not older than ${fmtDur(TH.publicationOnTimeS)}.`, `Aging: the newest pair is not older than ${fmtDur(TH.pairAgingS)}.`, `Old: the newest pair is not older than ${fmtDur(TH.pairOldS)}.`, 'Expired: everything is older, so nothing is drawn.', `If the device clock is more than ${fmtDur(TH.skewS)} ahead of the publication, relative ages are hidden and every pair counts as aging.`]) ul.append(el('li', null, t)); p.append(ul);
    p.append(el('p', 'limit', 'The control document, its lease and the automatic re-checks are shown in the Control monitor panel below.'));
  }
  const KINDS = { start: 'start', enabled: 'enabled', confirmed: 'confirmed', 'check-failed': 'check failed', disabled: 'switched off', expired: 'expired', invalid: 'invalid', unreachable: 'unreachable', restoring: 'restoring', restored: 'restored', 'restore-reset': 'restore reset', 'stale-ignored': 'stale copy ignored', hidden: 'tab hidden', visible: 'tab visible', 'lapsed-on-wake': 'lapsed while away' };
  // Built once; a redraw replaces only the list and the rows (review/m2.2.1).
  let ctlUi = null;
  function renderCtl() {
    const box = $('ctl-body'), m = S.mon; if (!m) { clear(box); ctlUi = null; return; } const now = Date.now(), c = monitor.config, tm = (ms) => (ms ? utcTime(ms) + 'Z' : 'never');
    const state = { starting: 'checking', enabled: 'enabled', disabled: 'switched off' + (m.cause === 'unpublished' ? ' (control document not published)' : ''), expired: m.cause === 'document' ? 'expired (the control document passed its expiry)' : m.cause === 'clock' ? 'expired (the device clock moved backwards)' : 'expired (no confirmation within the lease)', invalid: 'invalid', unreachable: 'unreachable', restoring: `restoring: ${m.streak} of ${m.need} confirmations` }[m.phase];
    const d = dl([['State', state], ['Last confirmed', m.lastOkMs ? `${tm(m.lastOkMs)}, ${secText(now - m.lastOkMs)} ago` : 'never'], ['Lease', m.phase === 'enabled' ? `until ${tm(m.leaseDeadlineMs)}, ${secText(m.leaseDeadlineMs - now)} left` : 'none: the surface is closed'], ['Next check', nextIn()],
      ['Checks', `${m.checks} sent${m.failures ? ', ' + m.failures + ' failing in a row' : ''}`], ['Interval', `${secText(m.recheckMs)} jittered by ±${Math.round(c.jitter * 100)}%, never under ${secText(c.minGapMs)} apart; none while the tab is hidden`], ['Lease length', secText(c.leaseMs)], ['Re-open rule', `${c.restoreConfirmations} fresh enabled confirmations at least ${secText(c.restoreGapMs)} apart (1 after a pure lease lapse); after a switch-off the document must also be newer`],
      ['Document', m.control ? `updated ${m.control.updated_at.slice(11, 19)}Z${m.control.expires_at ? ', expires ' + m.control.expires_at.slice(11, 19) + 'Z' : ''}${m.skew ? ' (dated in the future: device clock unreliable)' : ''}` : 'none yet'], ['Data requests', `${S.viewRequests} sent, ${S.refused} refused while closed`]]);
    const dds = d.querySelectorAll('dd'); dds[1].setAttribute('data-live', 'last'); dds[2].setAttribute('data-live', 'lease'); dds[3].setAttribute('data-live', 'next');
    if (!ctlUi || ctlUi.box !== box || ctlUi.w.parentNode !== box) {
      clear(box); const dlEl = el('dl'), tbl = el('table', 'ctl-log'), cap = el('caption', null, 'Events, newest first'), hd = el('tr'); for (const h of ['Time (UTC)', 'Event', 'Detail']) { const th = el('th', null, h); th.scope = 'col'; hd.append(th); } tbl.append(cap, el('thead')); tbl.tHead.append(hd);
      const tb = el('tbody'); tbl.append(tb); const w = el('div', 'ctl-logwrap'); w.tabIndex = 0; w.setAttribute('role', 'region'); w.setAttribute('aria-label', 'Control events, scrollable'); w.append(tbl); box.append(dlEl, w); ctlUi = { box, dl: dlEl, tb, w };
    }
    ctlUi.dl.replaceChildren(...d.childNodes); ctlUi.tb.replaceChildren(...[...m.log].reverse().map((e) => { const tr = el('tr'); tr.append(el('td', null, utcTime(e.t)), el('td', null, KINDS[e.kind] || e.kind), el('td', null, e.detail)); return tr; }));
  }
  function statusClock() {   // once a second: the countdowns only, nothing is fetched
    if (document.hidden || !S.mon) return; $('st-ctl').textContent = ctlText(); const gc = $('gate-clock'); if (gc) gc.textContent = nextIn(); const m = S.mon, now = Date.now(), live2 = (k) => document.querySelector(`#ctl-body dd[data-live="${k}"]`);
    const a = live2('last'), l = live2('lease'), n = live2('next'); if (a) a.textContent = m.lastOkMs ? `${utcTime(m.lastOkMs)}Z, ${secText(now - m.lastOkMs)} ago` : 'never'; if (l) l.textContent = m.phase === 'enabled' ? `until ${utcTime(m.leaseDeadlineMs)}Z, ${secText(m.leaseDeadlineMs - now)} left` : 'none: the surface is closed'; if (n) n.textContent = nextIn();
  }
  function setTab(t) { S.tab = t; syncUrl(); renderTabs(); }

  /* ---------- wiring ---------- */
  function wire() {
    buildThead();
    for (const k in MODES) $(MODES[k][1]).addEventListener('click', () => setMode(k));
    for (const k of ['rtt', 'loss']) $('l-' + k).addEventListener('click', () => { S.lens = k; syncUrl(); if (S.model) renderView(); applyViewUi(); live(k === 'loss' ? 'Coloured by packet loss' : 'Coloured by round-trip time'); });
    $('mx-order').addEventListener('input', () => { S.order = $('mx-order').value; syncUrl(); if (S.model && S.mode === 'matrix') keepFocus(() => renderView()); live('Locations in order: ' + $('mx-order').selectedOptions[0].textContent.toLowerCase()); });
    let sw = 0, sr = 0; new ResizeObserver(() => { const w = $('stage').clientWidth; if (!S.model || !STAGE.includes(S.mode) || !w || w === sw) return; sw = w; cancelAnimationFrame(sr); sr = requestAnimationFrame(() => { renderStage(); renderChips(); }); }).observe($('stage'));
    new ResizeObserver(() => { if (globeCtl && S.mode === 'globe' && S.model && globeCtl.has()) { S.wideG = wide(); globeCtl.resize(); updateGlobeControls(); renderGlobeBar(); } }).observe($('globewrap'));
    $('btn-check').addEventListener('click', () => { cooldown(); live('Checking the control document'); monitor.checkNow('manual'); });
    $('btn-refresh').addEventListener('click', async () => { cooldown(); live('Checking the control document'); await monitor.checkNow('manual'); if (monitor.allowData()) loadView('refresh'); });
    const onFilter = () => { S.filters = normalizeFilters({ node: $('f-node').value, country: $('f-country').value, hideLevels: S.filters.hideLevels, hideBands: S.filters.hideBands, rttMin: $('f-rttmin').value, rttMax: $('f-rttmax').value, loss: $('f-loss').value, text: $('f-text').value }); if (S.model) { renderDataViews(); } };
    for (const id of ['f-node', 'f-country', 'f-rttmin', 'f-rttmax', 'f-loss']) $(id).addEventListener('input', onFilter);
    let ft = 0; $('f-text').addEventListener('input', () => { clearTimeout(ft); ft = setTimeout(onFilter, 120); });
    $('filters').addEventListener('submit', (e) => e.preventDefault());
    $('f-reset').addEventListener('click', () => { S.filters = { ...DEFAULT_FILTERS }; $('f-text').value = ''; writeFilters(); if (S.model) { renderDataViews(); live('Filters reset'); } });
    $('sortSel').addEventListener('input', () => { S.sort = { key: $('sortSel').value, dir: SORTS[$('sortSel').value].first }; renderDataViews(); });
    $('sortDir').addEventListener('click', () => { S.sort.dir = S.sort.dir === 'asc' ? 'desc' : 'asc'; renderDataViews(); });
    $('tbody').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) selectPair(tr.getAttribute('data-id')); });
    $('cards').addEventListener('click', (e) => { const b = e.target.closest('button[data-id]'); if (b) selectPair(b.getAttribute('data-id')); });
    $('map').addEventListener('click', () => clearSelection('map'));
    const tabs = ['pairs', 'prov', 'fresh']; for (const t of tabs) { $('tab-' + t).addEventListener('click', () => setTab(t)); $('tab-' + t).addEventListener('keydown', (e) => { const vis = tabs.filter((x) => !$('tab-' + x).hidden), i = vis.indexOf(t); const go = (j) => { const n = vis[(j + vis.length) % vis.length]; setTab(n); $('tab-' + n).focus(); }; if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); } else if (e.key === 'Home') { e.preventDefault(); go(0); } else if (e.key === 'End') { e.preventDefault(); go(vis.length - 1); } }); }
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName)) clearSelection(); });
    let rt = 0, lastW = 0; new ResizeObserver(() => { const w = $('map').clientWidth; if (!S.model || !w || w === lastW) return; lastW = w; cancelAnimationFrame(rt); rt = requestAnimationFrame(() => { renderMap(); renderChips(); }); }).observe($('mapwrap'));
    window.addEventListener('hashchange', () => { if (!L.on || !S.model || location.hash.slice(1) === serialize(liveState())) return; const m = applyLink(location.hash); if (m) { render(); applyCentre(); live(m); } });   // a link pasted into an open tab; an anchor such as #main is ignored
    $('btn-copy').addEventListener('click', async () => {
      const f = serialize(liveState()), url = location.href.split('#')[0] + (f ? '#' + f : ''), box = $('link-text'); let ok = true; try { await navigator.clipboard.writeText(url); } catch (e) { ok = false; }
      $('link-box').hidden = ok; if (!ok) { box.value = url; box.focus(); box.select(); }
      say((ok ? 'Link copied.' : 'Cannot copy here. The link is selected: press Ctrl+C.') + (S.filters.text.trim() !== '' ? ' The search text is not part of a link.' : ''));
    });
    $('btn-reset-view').addEventListener('click', () => { useState(freshState()); $('link-box').hidden = true; render(); applyCentre(); syncUrl(true); say('View reset.'); });
    setInterval(tick, CONFIG.tickMs); setInterval(statusClock, 1000);
  }
  function tick() {   // ages and the state move with the clock; nothing is re-fetched
    if (document.hidden || !S.view) return; const was = S.cls.state; reclassify();
    if (was !== S.cls.state && (was === 'EXPIRED' || S.cls.state === 'EXPIRED')) { render(); return; }
    document.body.setAttribute('data-state', S.cls.state); renderStatus(); renderFreshness();
    for (const c of document.querySelectorAll('td[data-age]')) { const r = S.model.rowById.get(c.parentElement.getAttribute('data-id')); if (r) c.textContent = ageText(r.ageS); }
  }

  wire(); watchPage(monitor, window, document); monitor.start();
  if (local) window.__dash = { S, CONFIG, monitor, charts, loadView, tick, setMode, liveState, link: L, syncUrl, applyLink, get globe() { return globeCtl; }, selectNode, selectPair, clearSelection, setSort, get visible() { return S.visible; } };
}

if (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-dash')) boot();
