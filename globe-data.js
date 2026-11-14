/* globe-data.js: Internet data layer for the hero globe. Opt-in (?globe=data) and loaded only when the control document says enabled.
   One same-origin module: provider (fetch, validate, freshness), scheduler (measured links), evidence panel.
   It only ever reads DATA from the data origin; no code from there is executed. Any failure, or a disabled control document, removes
   everything this module added and leaves the unchanged reference globe. */

export const CONFIG = { viewPath: 'views/home.json', controlPath: 'control.json', linksDefault: 3, linksMin: 1, linksCap: 6, staticMax: 12, recheckMs: 300000, timeoutMs: 6000, maxBytes: 65536, tickMs: 800, refreshMs: 60000, desktopQuery: '(min-width: 901px)' };
// Freshness: PUBLICATION age (now - generated_at) and MEASUREMENT age (now - each pair's observed time) are separate clocks.
export const TH = { pairRecentS: 4500, pairAgingS: 10800, pairOldS: 86400, publicationOnTimeS: 5400, inputLagS: 1800, skewS: 300, recentShare: 0.5 };

const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, ID = /^[a-z0-9][a-z0-9-]{1,11}$/, LABEL = /^[A-Za-z0-9 .,()'-]{1,40}$/, FLAGS = ['few_results', 'aged', 'clock_unsynced', 'loss_observed'];
const SYN = 4000000000;   // identifiers above this are reserved for simulated data
const bad = (m) => { throw new Error('invalid view: ' + m); };
const num = (v, lo, hi, w) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi) || bad(w);
const int = (v, lo, hi, w) => (Number.isInteger(v) && v >= lo && v <= hi) || bad(w);
const ts = (v, w) => (typeof v === 'string' && TS.test(v) && Number.isFinite(Date.parse(v)) ? Date.parse(v) : bad(w));
const text = (v, max, w) => (typeof v === 'string' && v.length > 0 && v.length <= max && !/[<>]/.test(v)) || bad(w);
const url = (v, w) => (typeof v === 'string' && /^https:\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]{3,200}$/.test(v)) || bad(w);

// Tolerant validation of the home view (contract v1): unknown fields are ignored, anything the page would draw or print is checked.
export function validateView(d) {
  if (!d || typeof d !== 'object' || d.schema !== 'lateeflaw.home-view' || !/^1\.\d{1,3}$/.test(d.schema_version)) bad('schema or major version');
  const gen = ts(d.generated_at, 'generated_at'), a = d.attribution || {};
  text(a.text, 240, 'attribution.text'); url(a.url, 'attribution.url'); url(a.terms_url, 'attribution.terms_url'); text(a.disclaimer, 240, 'attribution.disclaimer'); typeof a.simulated === 'boolean' || bad('attribution.simulated');
  (!a.simulated || (/^SIMULATED/.test(a.text) && !/ripe\.net/i.test(a.url + a.terms_url))) || bad('simulated data must say so and must not point at RIPE');
  if (!Array.isArray(d.nodes) || d.nodes.length < 1 || d.nodes.length > 32 || !Array.isArray(d.pairs) || d.pairs.length > 64 || !Array.isArray(d.gaps) || d.gaps.length > 64) bad('array sizes');
  const nodes = new Map();
  for (const n of d.nodes) { ID.test(n.id) && LABEL.test(n.label) && /^[A-Z]{2}$/.test(n.country) || bad('node ' + n.id); num(n.lat, -90, 90, 'lat'); num(n.lon, -180, 180, 'lon'); nodes.has(n.id) && bad('duplicate node'); nodes.set(n.id, { id: n.id, label: n.label, country: n.country, lat: n.lat, lon: n.lon }); }
  const seen = new Set(), pairs = [];
  for (const p of d.pairs) {
    const w = `pair ${p.src}>${p.dst}`; nodes.has(p.src) && nodes.has(p.dst) && p.src !== p.dst || bad(w + ' endpoints');
    const k = [p.src, p.dst].sort().join('|'); seen.has(k) && bad(w + ' duplicate'); seen.add(k);
    const nul = p.rtt_median === null; (nul && p.rtt_min === null) || (!nul && p.rtt_min !== null) || bad(w + ' rtt');
    if (!nul) { num(p.rtt_median, 0.05, 2000, w + ' rtt_median'); num(p.rtt_min, 0.05, 2000, w + ' rtt_min'); p.rtt_min <= p.rtt_median || bad(w + ' rtt order'); }
    num(p.loss_pct, 0, 100, w + ' loss'); int(p.sent, 1, 1000, w + ' sent'); int(p.measurement_id, 1, 4294967295, w + ' measurement_id'); int(p.probe_id, 1, 4294967295, w + ' probe_id');
    // simulated data lives in a reserved identifier range no real RIPE Atlas id has reached; a view that mixes the two is rejected, not drawn
    (a.simulated ? p.measurement_id > SYN && p.probe_id > SYN : p.measurement_id <= SYN && p.probe_id <= SYN) || bad(w + ' identifiers do not match the simulated flag');
    const obs = ts(p.observed, w + ' observed'), first = ts(p.observed_first, w + ' observed_first'); first <= obs || bad(w + ' time order');
    ['good', 'degraded', 'poor'].includes(p.quality) && Array.isArray(p.flags) && p.flags.length <= 4 && p.flags.every((f) => FLAGS.includes(f)) && ['present', 'missing'].includes(p.reverse) || bad(w + ' quality');
    pairs.push({ src: p.src, dst: p.dst, rtt: p.rtt_median, rttMin: p.rtt_min, loss: p.loss_pct, sent: p.sent, obsMs: obs, firstMs: first, quality: p.quality, flags: p.flags.slice(), msm: p.measurement_id, probe: p.probe_id, reverse: p.reverse });
  }
  const gaps = d.gaps.map((g) => { nodes.has(g.a) && nodes.has(g.b) || bad('gap'); return { a: g.a, b: g.b }; });
  const c = d.coverage || {}; ['directed_expected', 'directed_available', 'pairs_expected', 'pairs_published', 'pairs_missing'].forEach((k) => int(c[k], 0, 992, 'coverage.' + k));
  return { generatedMs: gen, simulated: a.simulated, attribution: { text: a.text, url: a.url, termsUrl: a.terms_url, disclaimer: a.disclaimer }, nodes, pairs, gaps, coverage: c };
}

const fmt = (s) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : s < 86400 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.floor(s / 86400)} d ${Math.round((s % 86400) / 3600)} h`);
export const fmtAge = fmt;
// States: RECENT | AGING | OLD | EXPIRED. Chip wording never says "live".
export function classify(nowMs, v, th = TH) {
  const flags = [], suspect = v.generatedMs > nowMs + th.skewS * 1000, M = v.simulated ? 'values' : 'measurements', Mc = M[0].toUpperCase() + M.slice(1);   // simulated data is never called a measurement
  // a visitor clock that cannot be trusted cannot date anything: every pair is shown as aging (dim, no pulses, no relative ages)
  const pairs = v.pairs.map((p) => { const age = (nowMs - p.obsMs) / 1000; return { p, ageS: Math.round(age), cls: suspect ? 'aging' : age < -th.skewS ? 'excluded' : age <= th.pairRecentS ? 'recent' : age <= th.pairAgingS ? 'aging' : age <= th.pairOldS ? 'old' : 'expired' }; });
  const live = pairs.filter((x) => x.cls === 'recent' || x.cls === 'aging' || x.cls === 'old'), recent = pairs.filter((x) => x.cls === 'recent');
  const publishedAgeS = Math.round((nowMs - v.generatedMs) / 1000), newestAgeS = live.length ? Math.min(...live.map((x) => x.ageS)) : null;
  let state, chip = null;
  if (suspect) { state = 'AGING'; chip = `${Mc} from ${new Date(Math.max(...v.pairs.map((p) => p.obsMs))).toISOString().slice(11, 16)} UTC`; flags.push('client_clock_suspect'); }
  else if (!live.length) state = 'EXPIRED';
  else if (recent.length / v.pairs.length >= th.recentShare && publishedAgeS <= th.publicationOnTimeS) { state = 'RECENT'; chip = `Recent ${M} · newest ${fmt(newestAgeS)} ago`; }
  else if (newestAgeS <= th.pairAgingS) { state = 'AGING'; const oldest = Math.max(...live.map((x) => x.ageS)); chip = oldest - newestAgeS > 1800 ? `${Mc} from ${fmt(newestAgeS)} to ${fmt(oldest)} ago` : `${Mc} from ${fmt(newestAgeS)} ago`; }
  else if (newestAgeS <= th.pairOldS) { state = 'OLD'; chip = `Last ${M} ${fmt(newestAgeS)} ago`; }
  else state = 'EXPIRED';
  if (!suspect && publishedAgeS > th.publicationOnTimeS) flags.push('publication_late');
  if (!suspect && live.length && (v.generatedMs - (nowMs - newestAgeS * 1000)) / 1000 > th.inputLagS) flags.push('collector_inputs_old');
  if (chip && v.simulated) chip = 'Simulated test data · ' + chip;
  return { state, chip, publishedAgeS, newestAgeS, pairs, counts: { total: pairs.length, recent: recent.length }, flags };
}

// RTT -> look. One hue, four brightness bands; pulse time grows with RTT (an effect scale, not real speed); amber arrival ring when packets were lost.
export function mapper(e) {
  const rtt = e.measurement ? e.measurement.value : 150, lost = e.measurement && e.measurement.loss > 0;
  return { color: [0.157, 0.878, 1], intensity: rtt <= 50 ? 1 : rtt <= 150 ? 0.85 : rtt <= 250 ? 0.7 : 0.55, travel: Math.min(9, 1.5 + 0.014 * rtt), base: 0.3, ring: lost ? [0.94, 0.71, 0.16] : null };
}
export function makeEvent(v, p) {
  const s = v.nodes.get(p.src), d = v.nodes.get(p.dst), sim = v.simulated;
  return { id: `atlas-${p.msm}-${p.src}-${p.dst}-${p.obsMs}`, type: 'rtt', timestamp: p.obsMs, observedAt: p.obsMs, evidence: sim ? 'illustrative' : 'measured', severity: 'info',
    source: { lat: s.lat, lon: s.lon, label: s.label, countryCode: s.country }, destination: { lat: d.lat, lon: d.lon, label: d.label, countryCode: d.country },
    attribution: { provider: sim ? 'simulated' : 'ripe-atlas', simulated: sim, label: v.attribution.text.slice(0, 120), url: v.attribution.url },
    measurement: { value: p.rtt, unit: 'ms', metric: 'rtt_median', loss: p.loss }, network: { probeId: p.probe } };
}
export const clampLinks = (n) => Math.min(CONFIG.linksCap, Math.max(CONFIG.linksMin, Number.isInteger(n) ? n : CONFIG.linksDefault));
export function shuffled(n, seed) { const a = Array.from({ length: n }, (_, i) => i); let s = (seed >>> 0) || 1; for (let i = n - 1; i > 0; i--) { s = (s * 1664525 + 1013904223) >>> 0; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function validControl(c) { return c && typeof c === 'object' && c.schema === 'lateeflaw.internet-control' && /^1\.\d{1,3}$/.test(c.schema_version) && typeof c.enabled === 'boolean' && c.surfaces && typeof c.surfaces.home === 'boolean'; }
async function fetchDoc(u) {
  const r = await fetch(u, { cache: 'no-cache', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(CONFIG.timeoutMs) });
  if (!r.ok) return { status: r.status };
  if (+r.headers.get('content-length') > CONFIG.maxBytes) throw new Error('document too large');
  const t = await r.text(); if (t.length > CONFIG.maxBytes) throw new Error('document too large');
  return { status: 200, json: JSON.parse(t) };
}
/* Evidence panel: a chip (state and age, a real button) that opens a table of every pair with its provenance. Absolutely positioned inside the hero,
   so nothing in the hero moves. All text is set with textContent; links are built from validated integers and https URLs only. */
const CSS = `.gd-wrap{position:absolute;right:clamp(16px,3vw,40px);bottom:20px;z-index:3;display:flex;flex-direction:column;align-items:flex-end;gap:8px;max-width:calc(100% - 32px)}
.gd-wrap[hidden]{display:none}
.gd-chip{display:inline-flex;align-items:center;gap:8px;font:11px/1.2 'Share Tech Mono',monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--text);background:rgba(8,13,26,.84);border:1px solid var(--border);padding:7px 11px;cursor:pointer;max-width:100%;text-align:left}
.gd-chip:hover{border-color:var(--accent)}.gd-chip:focus-visible,.gd-panel a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.gd-dot{width:8px;height:8px;border-radius:50%;background:var(--accent);flex:none}.gd-s-RECENT .gd-dot{background:var(--green)}.gd-s-OLD .gd-dot{background:var(--gold)}
.gd-panel{width:min(700px,calc(100vw - 32px));max-height:min(62vh,520px);overflow:auto;background:rgba(8,13,26,.97);border:1px solid var(--border);padding:14px 16px;color:var(--text);font:13px/1.5 'Barlow',sans-serif}
.gd-panel h2{font:600 15px/1.2 'Barlow Condensed',sans-serif;letter-spacing:.06em;text-transform:uppercase;margin:0 0 6px}
.gd-panel p,.gd-panel ul{margin:0 0 8px;padding:0}.gd-panel ul{list-style:none}.gd-panel li{margin:0 0 2px}.gd-panel .gd-m{color:var(--muted)}.gd-panel a{color:var(--accent)}
.gd-panel table{border-collapse:collapse;width:100%;min-width:560px;font:12px/1.4 'Share Tech Mono',monospace;margin:8px 0}.gd-panel caption{text-align:left;color:var(--muted);padding-bottom:4px}
.gd-panel th,.gd-panel td{text-align:left;padding:3px 8px 3px 0;border-bottom:1px solid var(--border);white-space:nowrap}.gd-panel th{color:var(--muted);font-weight:400}.gd-panel tr.gd-old td{color:var(--muted)}
.gd-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.gd-wrap[data-simulated] .gd-chip,.gd-wrap[data-simulated] .gd-panel{border-style:dashed;border-color:var(--gold)}.gd-wrap[data-simulated] .gd-dot{background:var(--gold);border-radius:1px;transform:rotate(45deg)}.gd-wrap[data-simulated] .gd-panel h2{color:var(--gold)}`;
function buildUi(hero, view) {
  const doc = hero.ownerDocument, el = (t, c, x) => { const e = doc.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }, utc = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  const style = el('style'); style.id = 'gd-style'; style.textContent = CSS; doc.head.appendChild(style);
  const wrap = el('div', 'gd-wrap'), chip = el('button', 'gd-chip'), label = el('span'), panel = el('div', 'gd-panel'), sr = el('span', 'gd-sr'); let last = null, lastState = '';
  chip.type = 'button'; chip.setAttribute('aria-expanded', 'false'); chip.setAttribute('aria-controls', 'gd-panel'); chip.append(el('span', 'gd-dot'), label);
  panel.id = 'gd-panel'; panel.hidden = true; panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', view.simulated ? 'Simulated test data' : 'Measurement evidence'); sr.setAttribute('role', 'status'); sr.setAttribute('aria-live', 'polite');
  wrap.append(panel, chip, sr); hero.appendChild(wrap);
  function render() {
    if (!last) return; const c = last, v = view, now = Date.now(), pairs = [...c.pairs].sort((a, b) => (v.nodes.get(a.p.src).label + v.nodes.get(a.p.dst).label).localeCompare(v.nodes.get(b.p.src).label + v.nodes.get(b.p.dst).label));
    const sim = v.simulated; panel.textContent = ''; panel.append(el('h2', null, sim ? 'Simulated test data: not real measurements' : 'Measured round-trip times'));
    panel.append(el('p', null, `${c.chip || ''}. Published ${utc(v.generatedMs)} UTC (${fmtAge(Math.max(0, c.publishedAgeS))} ago). ` + (sim ? 'These values come from a model, not from the network. They exist to test hosting, caching and the kill switch.' : 'Each figure is the median of up to 10 results per pair, about 36 minutes of measurements.')));
    const note = { publication_late: 'Publication is late.', collector_inputs_old: 'The collector reused old results.', client_clock_suspect: 'Your device clock disagrees with the publication time, so relative ages are hidden.' };
    for (const f of c.flags) panel.append(el('p', 'gd-m', note[f] || f));
    const legend = sim ? ['Bright links are simulated pairs, one direction shown per pair. Dim lines are decorative.', 'Rings mark simulated endpoints. City names are reused for realism only. An amber ring means simulated packet loss.', 'Pulse time grows with the simulated RTT. It is an effect scale, not real speed.', v.attribution.disclaimer]
      : ['Bright links are measured pairs, one direction shown per pair. Dim lines are decorative.', 'Rings mark RIPE Atlas anchors. An amber ring means packets were lost.', 'Pulse time grows with the measured RTT. It is an effect scale, not real speed.', v.attribution.disclaimer];
    const ul = el('ul'); for (const t of legend) ul.append(el('li', null, t)); panel.append(ul);
    const tb = el('table'), cap = el('caption', null, sim ? 'Simulated round-trip time and packet loss per city pair' : 'Median round-trip time and packet loss per anchor pair'), head = el('tr'), body = el('tbody');
    tb.append(cap, el('thead')); tb.tHead.append(head); for (const h of ['From', 'To', sim ? 'Simulated RTT' : 'Median RTT', 'Loss', sim ? 'Generated (UTC)' : 'Observed (UTC)', 'Age', 'Quality', sim ? 'Source' : 'Measurement']) { const th = el('th', null, h); th.scope = 'col'; head.append(th); }
    for (const x of pairs) {
      const p = x.p, tr = el('tr', x.cls === 'recent' ? '' : 'gd-old'), q = el('td', null, p.quality + (p.flags.length ? ' (' + p.flags.join(', ').replace(/_/g, ' ') + ')' : '')), m = el('td');
      if (sim) m.textContent = 'simulated';   // no link: there is no RIPE Atlas measurement behind a simulated row
      else { const a = el('a', null, '#' + p.msm); a.href = `https://atlas.ripe.net/measurements/${p.msm}/`; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.setAttribute('aria-label', `RIPE Atlas measurement ${p.msm}`); m.append(a); }
      tr.append(el('td', null, v.nodes.get(p.src).label), el('td', null, v.nodes.get(p.dst).label), el('td', null, p.rtt === null ? 'no reply' : p.rtt.toFixed(1) + ' ms'), el('td', null, `${p.loss}% of ${p.sent}`), el('td', null, utc(p.obsMs)), el('td', null, c.flags.includes('client_clock_suspect') ? 'n/a' : fmtAge(Math.max(0, (now - p.obsMs) / 1000))), q, m); body.append(tr);
    }
    tb.append(body); panel.append(tb);
    const k = v.coverage, miss = v.pairs.filter((p) => p.reverse === 'missing').length;
    panel.append(el('p', 'gd-m', `${k.pairs_published} of ${k.pairs_expected} pairs have data${v.gaps.length ? ` (no data for ${v.gaps.map((g) => v.nodes.get(g.a).label + '-' + v.nodes.get(g.b).label).join(', ')})` : ''}. ${miss} pairs have no usable measurement in the other direction.`));
    const at = el('p', 'gd-m');
    if (sim) { const l = el('a', null, v.attribution.url.replace(/^https:\/\//, '')); l.href = v.attribution.url; l.target = '_blank'; l.rel = 'noopener noreferrer'; at.append(v.attribution.text + ' Source code: ', l, '. No measurement service is involved.'); }
    else { const l = el('a', null, v.attribution.text); l.href = v.attribution.url; l.target = '_blank'; l.rel = 'noopener noreferrer'; at.append(l, ' Terms: ', Object.assign(el('a', null, 'RIPE Atlas Service Terms'), { href: v.attribution.termsUrl, target: '_blank', rel: 'noopener noreferrer' }), '. This site is not affiliated with or endorsed by the RIPE NCC.'); }
    panel.append(at);
  }
  function toggle(open) { const o = open === undefined ? panel.hidden : open; panel.hidden = !o; chip.setAttribute('aria-expanded', String(o)); if (o) render(); }
  const onKey = (e) => { if (e.key === 'Escape' && !panel.hidden) { toggle(false); chip.focus(); } };
  chip.addEventListener('click', () => toggle()); doc.addEventListener('keydown', onKey);
  return {
    update(c) { last = c; wrap.hidden = false; wrap.className = 'gd-wrap gd-s-' + c.state; if (view.simulated) wrap.setAttribute('data-simulated', 'true'); label.textContent = c.chip; if (c.state !== lastState) { sr.textContent = c.chip; lastState = c.state; } if (!panel.hidden) render(); },
    hide() { wrap.hidden = true; toggle(false); },
    destroy() { doc.removeEventListener('keydown', onKey); wrap.remove(); style.remove(); }
  };
}

export async function start(globe, hero, { origin, control }) {
  if (!globe || !globe.supported || typeof globe.setMarkers !== 'function' || !validControl(control) || !control.enabled || !control.surfaces.home) return null;
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname), q = new URLSearchParams(location.search);
  const cfg = { ...CONFIG }; if (local && Number(q.get('globe-data-recheck')) > 0) cfg.recheckMs = Number(q.get('globe-data-recheck'));
  let linksMax = clampLinks(q.get('globe-links') === null ? CONFIG.linksDefault : Number(q.get('globe-links')));
  let view; try { const r = await fetchDoc(origin + cfg.viewPath); if (r.status !== 200) throw new Error('view HTTP ' + r.status); view = validateView(r.json); } catch (e) { console.warn('[globe-data] not started: ' + e.message); return null; }

  const desktop = matchMedia(cfg.desktopQuery), bus = new GlobeTelemetry.Bus(), S = { disabled: false, state: null, cls: null, order: [], cursor: 0, orderKey: '', lastCheck: Date.now(), failures: 0, timers: [], ui: null };
  bus.on((ev) => globe.ingestEvent(ev));
  const ui = () => S.ui || (S.ui = buildUi(hero, view));
  const clearVisuals = (mode) => { try { globe.clearData(); if (mode !== false && globe.o.traffic.mode !== 'reference') globe.update({ traffic: { mode: 'reference' } }); } catch (e) { } if (S.ui) S.ui.hide(); };

  function apply() {
    if (S.disabled) return;
    if (!desktop.matches) { S.state = 'DESKTOP-ONLY'; return clearVisuals(); }
    const c = S.cls = classify(Date.now(), view); S.state = c.state;
    if (c.state === 'EXPIRED') return clearVisuals();
    if (globe.o.traffic.mode !== 'composite') globe.update({ traffic: { mode: 'composite' }, telemetry: { mapper } });
    const recentNodes = new Set(); c.pairs.forEach((x) => { if (x.cls === 'recent') { recentNodes.add(x.p.src); recentNodes.add(x.p.dst); } });
    const dim = c.state === 'RECENT' ? 0.55 : c.state === 'AGING' ? 0.4 : 0.28, hi = c.state === 'RECENT' ? 0.95 : dim + 0.1;
    globe.setMarkers([...view.nodes.values()].map((n) => ({ lon: n.lon, lat: n.lat, alpha: recentNodes.has(n.id) ? hi : dim })));
    if (c.state === 'RECENT' && !globe.static) {
      globe.setLinks([]);
      const key = c.pairs.map((x) => (x.cls === 'recent' ? 1 : 0)).join('');
      if (key !== S.orderKey) { S.orderKey = key; S.order = shuffled(c.pairs.length, view.generatedMs).filter((i) => c.pairs[i].cls === 'recent' && c.pairs[i].p.rtt !== null); S.cursor = 0; }
    } else {   // no pulses: dim static links, newest first, never more than staticMax
      const alpha = { recent: 0.3, aging: 0.2, old: 0.11 };
      globe.setLinks(c.pairs.filter((x) => alpha[x.cls]).sort((a, b) => b.p.obsMs - a.p.obsMs).slice(0, cfg.staticMax).map((x) => ({ src: view.nodes.get(x.p.src), dst: view.nodes.get(x.p.dst), alpha: alpha[x.cls] })));
      S.order = []; S.orderKey = '';
    }
    ui().update(c, view);
  }
  function tick() {   // at most one new measured link per tick, never more than linksMax at once
    if (S.disabled || S.state !== 'RECENT' || globe.static || globe.paused || globe.inView === false || document.hidden || !S.order.length) return;
    if (globe.ev.arcs.filter(Boolean).length >= linksMax) return;
    const p = view.pairs[S.order[S.cursor++ % S.order.length]]; if (p) bus.push(makeEvent(view, p));
  }
  function disable(reason) {
    if (S.disabled) return; S.disabled = true; S.state = 'DISABLED'; S.timers.forEach(clearInterval); S.timers = [];
    document.removeEventListener('visibilitychange', onFocus); removeEventListener('focus', onFocus); desktop.removeEventListener && desktop.removeEventListener('change', apply);
    clearVisuals(); if (S.ui) { S.ui.destroy(); S.ui = null; } console.info('[globe-data] disabled: ' + reason);
  }
  async function recheck(force) {   // control document, at most once per cfg.recheckMs; 404/invalid/off disables, outages count three strikes
    const now = Date.now(); if (S.disabled || (!force && now - S.lastCheck < cfg.recheckMs)) return; S.lastCheck = now;
    try {
      const r = await fetchDoc(origin + cfg.controlPath);
      if (r.status === 200 && validControl(r.json) && r.json.enabled && r.json.surfaces.home) { S.failures = 0; return; }
      if (r.status === 200 || [403, 404, 410].includes(r.status)) return disable('control document says off or is invalid');
      S.failures++;
    } catch (e) { if (e instanceof SyntaxError) return disable('control document is not valid JSON'); S.failures++; }
    if (S.failures >= 3) disable('control document unreachable three times');
  }
  function onFocus() { if (!document.hidden) recheck(false); }
  document.addEventListener('visibilitychange', onFocus); addEventListener('focus', onFocus); desktop.addEventListener && desktop.addEventListener('change', apply);
  S.timers.push(setInterval(tick, cfg.tickMs), setInterval(apply, cfg.refreshMs));
  apply();
  const api = { get state() { return S.state; }, get cls() { return S.cls; }, get linksMax() { return linksMax; }, setLinksMax(n) { linksMax = clampLinks(n); }, apply, recheck, disable, view };
  if (local) window.__globeData = api;
  return api;
}
