/* Shareable state (M2.3): the view as a URL fragment. Pure (no DOM, network, storage or clock). A link carries ids and settings, never data and never the typed search text. Parsing is strict: allowlisted keys,
   each key at most once, 512 characters at most (a longer link is refused whole), values of 64 characters at most, each value checked against its own domain; what fails is dropped and counted. resolve() then checks ids against the loaded data. */
export const MAX_LEN = 512;
export const VIEWS = ['map', 'globe', 'matrix', 'distance', 'loss'], TABS = ['pairs', 'prov', 'fresh'], LENSES = ['rtt', 'loss'], ORDERS = ['alpha', 'west', 'rtt'], ZOOMS = ['world', 'americas', 'emea', 'apac'], LOSSES = ['any', 'lossy', 'clean'];
export const SORT_KEYS = ['pair', 'rtt', 'rttMin', 'loss', 'obs', 'age', 'quality', 'km'];
export const fresh = () => ({ view: 'map', tab: 'pairs', sel: { type: null, id: null }, filters: { node: 'all', country: 'all', rttMin: null, rttMax: null, loss: 'any', text: '', hideLevels: [], hideBands: [] }, sort: { key: 'rtt', dir: 'desc' }, zoom: 'world', lens: 'rtt', order: 'alpha', centre: { lon: -15, lat: 20 } });

const ID = /^[a-z0-9][a-z0-9-]{1,11}$/, wrap = (x) => ((((x + 180) % 360) + 360) % 360) - 180, f = (s) => s.filters;
// Each key: get(state) gives the value's text, or null when it is the default; set(state, text) stores it and says whether the text was valid.
const en = (list, k, o = (s) => s) => ({ get: (s) => (o(s)[k] === list[0] ? null : o(s)[k]), set: (s, v) => list.includes(v) && ((o(s)[k] = v), true) });
const num = (k) => ({ get: (s) => { const v = f(s)[k]; return typeof v === 'number' && v >= 0 && isFinite(v) ? String(Math.min(1e5, Math.round(v * 1e3) / 1e3)) : null; }, set: (s, v) => /^\d{1,6}(\.\d{1,3})?$/.test(v) && v <= 1e5 && ((f(s)[k] = +v), true) });
const ints = (k, max) => ({ get: (s) => [...new Set(f(s)[k])].filter((n) => n >= 0 && n <= max).sort().join(',') || null, set: (s, v) => v.split(',').every((x) => x.length === 1 && x <= max) && v.length < 2 * max + 2 && ((f(s)[k] = [...new Set(v.split(','))].map(Number).sort()), true) });
const fld = (k, re) => ({ get: (s) => (f(s)[k] === 'all' ? null : f(s)[k]), set: (s, v) => re.test(v) && ((f(s)[k] = v), true) });
const sel = (type, get, ok) => ({ get: (s) => (s.sel.type === type ? get(s.sel.id) : null), set: (s, v) => ok(v) && !s.sel.type && ((s.sel = { type, id: v.replace(',', '>') }), true) });
const F = {
  v: en(VIEWS, 'view'), t: en(TABS, 'tab'), n: sel('node', (id) => id, (v) => ID.test(v)), p: sel('pair', (id) => id.replace('>', ','), (v) => v.split(',').length === 2 && v.split(',').every((x) => ID.test(x))),
  fn: fld('node', ID), fc: fld('country', /^[A-Z]{2}$/),
  rmin: num('rttMin'), rmax: num('rttMax'), fl: en(LOSSES, 'loss', f),
  // RC14 (2026-11-14): the search text a person types is NOT part of a link. It is never written, and a q= part in a link that arrives is an unknown key: dropped and counted.
  hl: ints('hideLevels', 2), hb: ints('hideBands', 3),
  s: { get: (s) => (s.sort.key === 'rtt' && s.sort.dir === 'desc' ? null : s.sort.key + '.' + s.sort.dir), set: (s, v) => { const m = /^(\w+)\.(asc|desc)$/.exec(v); return !!m && SORT_KEYS.includes(m[1]) && ((s.sort = { key: m[1], dir: m[2] }), true); } },
  z: en(ZOOMS, 'zoom'), l: en(LENSES, 'lens'), o: en(ORDERS, 'order'),
  g: { get: (s) => { const lon = wrap(Math.round(s.centre.lon)) + 0, lat = Math.max(-85, Math.min(85, Math.round(s.centre.lat))) + 0; return s.view === 'globe' && isFinite(lon + lat) && !(lon === -15 && lat === 20) ? lon + ',' + lat : null; },
    set: (s, v) => { const m = /^(-?\d{1,3}),(-?\d{1,2})$/.exec(v); if (!m || Math.abs(m[1]) > 180 || Math.abs(m[2]) > 85) return false; s.centre = { lon: wrap(+m[1]) + 0, lat: +m[2] + 0 }; return true; } }
};

export function serialize(s) {   // a part that would take the link past 512 characters is left out rather than written as a link the parser would refuse (no reachable state gets there now that the search text is not in a link)
  const out = []; let len = -1;
  for (const k in F) { let v, e = null; try { v = F[k].get(s); e = v === null ? null : encodeURIComponent(v).replace(/%2C/g, ','); } catch (x) { e = null; } if (e !== null && len + e.length + k.length + 2 <= MAX_LEN) { out.push(k + '=' + e); len += e.length + k.length + 2; } }
  return out.join('&');
}
// kind: 'empty', 'anchor' (a plain in-page anchor such as #main: not a link, left alone) or 'link'; applied: parts accepted; dropped: parts refused
export function parse(frag) {
  const s = fresh(), h = String(frag == null ? '' : frag).replace(/^#/, ''), r = (kind, applied = 0, dropped = 0) => ({ state: s, kind, applied, dropped });
  if (!h) return r('empty'); if (!h.includes('=') && /^[A-Za-z][\w:.-]*$/.test(h)) return r('anchor'); if (h.length > MAX_LEN) return r('link', 0, 1);
  const parts = h.split('&'), seen = new Set(); let applied = 0, dropped = 0;
  for (const part of parts) {
    const i = part.indexOf('='), k = part.slice(0, i < 0 ? undefined : i); let v = null; try { v = i < 0 ? null : decodeURIComponent(part.slice(i + 1)); } catch (e) { /* malformed percent-encoding */ }
    if (!Object.hasOwn(F, k) || v === null || v.length > 64 || seen.has(k) || !F[k].set(s, v)) dropped++; else { seen.add(k); applied++; }
  }
  return r('link', applied, dropped);
}
// ctx: { nodes, pairs, countries, zooms: arrays of ids (country codes for countries); visible(filters) -> array of the pair ids those filters show }. Drops what the loaded data does not have and counts it.
export function resolve(state, ctx) {
  const r = JSON.parse(JSON.stringify(state)); let dropped = 0; const no = (bad) => { if (bad) dropped++; return bad; };
  if (no(r.filters.node !== 'all' && !ctx.nodes.includes(r.filters.node))) r.filters.node = 'all';
  if (no(r.filters.country !== 'all' && !ctx.countries.includes(r.filters.country))) r.filters.country = 'all';
  if (no(r.zoom !== 'world' && !ctx.zooms.includes(r.zoom))) r.zoom = 'world';
  if (no((r.sel.type === 'node' && !ctx.nodes.includes(r.sel.id)) || (r.sel.type === 'pair' && !(ctx.pairs.includes(r.sel.id) && ctx.visible(r.filters).includes(r.sel.id))))) r.sel = { type: null, id: null };
  if (no(r.view !== 'globe' && (r.centre.lon !== -15 || r.centre.lat !== 20))) r.centre = { lon: -15, lat: 20 };
  return { state: r, dropped };
}
