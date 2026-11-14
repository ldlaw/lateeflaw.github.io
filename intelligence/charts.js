/* Latency matrix, round-trip time versus distance, and the packet-loss list (milestone M2.2). Three more views of the SAME selection, filters and loss encoding as the map and the globe.
   Models are pure functions of the page's model (no DOM, no network, no storage) so tests can check them against an independent reference; the builders turn them into elements
   with textContent only. Nothing here keeps state: every call draws from the model it is given, and the page clears these views in the same pass as every other view when the control
   plane closes the surface.
   Honesty rules built into the wording: the data publishes ONE direction per pair, so the matrix is a triangle and never shows or estimates the other direction; the floor line in the
   distance chart is physics, not a measurement; and nothing here says a line or a point is the way packets travel. */
import { rttBand, LOSS_NAMES, wilsonInterval, MATRIX_NOTE, FLOOR_NOTE, DISTANCE_NOTE, SIM_DISTANCE_NOTE, REAL_DISTANCE_NOTE, LOSS_LIST_NOTE } from './encode.js';

const r1 = (x) => Math.round(x * 10) / 10, pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
export const ORDERS = [['alpha', 'Alphabetical'], ['west', 'West to east'], ['rtt', 'Median round-trip time']];

/* ================= pure models ================= */
const medianOf = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export function orderNodes(model, how) {
  const ns = [...model.nodes];   // already alphabetical by label
  if (how === 'west') ns.sort((a, b) => a.lon - b.lon || a.label.localeCompare(b.label));
  else if (how === 'rtt') { const med = new Map(ns.map((n) => [n.id, medianOf(model.rows.filter((r) => (r.src === n.id || r.dst === n.id) && r.rtt !== null).map((r) => r.rtt))])); ns.sort((a, b) => (med.get(a.id) ?? Infinity) - (med.get(b.id) ?? Infinity) || a.label.localeCompare(b.label)); }
  return ns;
}
// The triangle: row i holds the pairs (node i, node j) for every later node j. Each published pair appears in exactly ONE cell. dir says which way the pair was measured relative to the
// cell: 'rc' row to column, 'cr' column to row. shown = the current filters let the pair through.
export function matrixModel(model, how, shown) {
  const ns = orderNodes(model, how), byPair = new Map(); for (const r of model.rows) if (!byPair.has(pairKey(r.src, r.dst))) byPair.set(pairKey(r.src, r.dst), r);
  const rows = [];
  for (let i = 0; i < ns.length - 1; i++) {
    const cells = [];
    for (let j = i + 1; j < ns.length; j++) { const pair = byPair.get(pairKey(ns[i].id, ns[j].id)) || null; cells.push({ i, j, row: ns[i], col: ns[j], pair, dir: pair ? (pair.src === ns[i].id ? 'rc' : 'cr') : null, shown: !!pair && (!shown || shown.has(pair.id)) }); }
    rows.push({ node: ns[i], lead: i, cells });
  }
  return { nodes: ns, cols: ns.slice(1), rows, cellCount: rows.reduce((s, r) => s + r.cells.length, 0) };
}
// A "nice" axis: the smallest step from 1, 2, 2.5, 5 x 10^k that gives at most maxTicks intervals, and the first multiple of it that covers max.
export function niceScale(max, maxTicks) {
  const top0 = max > 0 ? max : 1, raw = top0 / Math.max(1, maxTicks), pow = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw), n = Math.ceil(top0 / step - 1e-9), ticks = [];
  for (let i = 0; i <= n; i++) ticks.push(+(i * step).toFixed(6));
  return { max: +(n * step).toFixed(6), step, ticks };
}
export function scatterModel(model, rows, W, H) {
  const M = { l: W < 480 ? 46 : 58, r: 26, t: 14, b: 46 }, pw = Math.max(40, W - M.l - M.r), ph = Math.max(60, H - M.t - M.b), all = model.rows;
  const kmMax = Math.max(1, ...all.map((r) => r.km)), rtMax = Math.max(1, ...all.filter((r) => r.rtt !== null).map((r) => r.rtt));
  const xs = niceScale(kmMax, Math.max(2, Math.floor(pw / 80))), ys = niceScale(rtMax, Math.max(2, Math.floor(ph / 38))), px = (km) => M.l + (km / xs.max) * pw, py = (v) => M.t + ph - (v / ys.max) * ph;
  const pts = rows.filter((r) => r.rtt !== null).map((r) => ({ id: r.id, row: r, km: r.km, rtt: r.rtt, level: r.lossLevel, x: px(r.km), y: py(r.rtt) })).sort((a, b) => a.km - b.km || a.id.localeCompare(b.id));
  const endKm = Math.min(xs.max, ys.max * 100), floor = { km1: endKm, ms1: endKm / 100, x0: px(0), y0: py(0), x1: px(endKm), y1: py(endKm / 100) };
  return { M, W, H, pw, ph, xs, ys, px, py, pts, floor, noReply: rows.length - pts.length };
}
export function stripModel(rows) {
  const items = rows.filter((r) => r.loss > 0).map((r) => { const w = wilsonInterval(r.lost, r.sent); return { row: r, lo: w.lo, hi: w.hi, p: r.sent ? r.lost / r.sent : 0 }; });
  items.sort((a, b) => b.lo - a.lo || b.row.lost - a.row.lost || a.row.id.localeCompare(b.row.id));
  const hiMax = Math.max(0.05, ...items.map((i) => i.hi)), max = [0.1, 0.2, 0.25, 0.5, 1].find((m) => m >= hiMax) || 1;
  return { items, max };
}

/* ================= words ================= */
const ms = (v) => (v === null ? 'no reply' : Math.round(v) + ' ms'), pct = (f) => r1(f * 100) + '%';
export const lossWords = (r) => (r.lost > 0 ? `${r.lost} of ${r.sent} packets lost, ${LOSS_NAMES[r.lossLevel]} loss` : r.loss > 0 ? 'some packet loss observed' : 'no packet loss observed');
export const pairLabel = (r) => `${r.srcLabel} to ${r.dstLabel}, ${ms(r.rtt)}, ${lossWords(r)}`;
const km0 = (km) => Math.round(km).toLocaleString('en-US') + ' km';

/* ================= builders ================= */
export function createCharts({ el, se, clear }) {
  const simHead = (box, ctx) => { if (!ctx.sim) return; const h = el('div', 'sim-head'); h.append(el('span', 'chip sim-chip', 'Simulated'), el('span', null, 'Simulated values. No measurement was made.')); box.append(h); };
  const relState = (ctx, r) => { const s = ctx.sel, isSel = s.type === 'pair' && s.id === r.id, hl = s.type === 'node' && (r.src === s.id || r.dst === s.id); return { isSel, hl, dim: !!s.type && !isSel && !hl }; };
  const shape = (level) => (level === 2 ? el('span', 'tri') : level === 1 ? el('span', 'dia') : null);
  const hover = (node, ctx, r) => { const on = (e) => ctx.tip.show(ctx.rowTip(r), e); node.addEventListener('pointerenter', on); node.addEventListener('pointermove', on); node.addEventListener('pointerleave', ctx.tip.hide); };
  const rove = (items, to) => { for (const x of items) x.setAttribute('tabindex', x === to ? '0' : '-1'); to.focus({ preventScroll: false }); };

  /* ---------- latency matrix ---------- */
  // Built ONCE and kept: a redraw replaces only the cells of the header row, the rows and the notes (Chrome keeps an object alive per new, re-attached or re-styled thead table: review/m2.2.1).
  let mx = null;
  function matrixShell(box) {
    if (mx && mx.box === box && mx.wrap.parentNode === box) return mx;
    clear(box); const top = el('div', 'mx-top'), wrap = el('div', 'mx-scroll'), t = el('table', 'mx'), hr = el('tr', 'mx-head'), tb = el('tbody'); t.append(el('caption', 'sr', MATRIX_NOTE)); t.createTHead().append(hr); t.append(tb); wrap.append(t); box.append(top, wrap);
    const m = mx = { box, top, wrap, t, hr, tb, cells: [] };
    t.addEventListener('focusin', (e) => {   // WCAG 2.2 2.4.11: the browser scrolls a focused cell into the box, but not out from under the sticky headers or clear of the edge that would cut its ring off (review/m2.2.2)
      const c = e.target.closest && e.target.closest('.mx-cell'), k = hr.firstElementChild; if (!c || !k) return;
      const q = wrap.getBoundingClientRect(), r = c.getBoundingClientRect(), s = k.getBoundingClientRect(), g = 6, x0 = Math.max(q.left + wrap.clientLeft, s.right) + g, y0 = Math.max(q.top + wrap.clientTop, s.bottom) + g, x1 = q.left + wrap.clientLeft + wrap.clientWidth - g, y1 = q.top + wrap.clientTop + wrap.clientHeight - g;
      wrap.scrollLeft += r.left < x0 ? r.left - x0 : r.right > x1 ? r.right - x1 : 0; wrap.scrollTop += r.top < y0 ? r.top - y0 : r.bottom > y1 ? r.bottom - y1 : 0;
    });
    t.addEventListener('keydown', (e) => {   // arrow-key navigation over the cells that are shown; Home and End within a row, with Ctrl across the whole triangle
      const cells = m.cells, cur = e.target.closest && e.target.closest('.mx-cell'); if (!cur || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return; e.preventDefault();
      const rr = +cur.dataset.r, cc = +cur.dataset.c, at = (b) => ({ r: +b.dataset.r, c: +b.dataset.c }); let to = null;
      if (e.key === 'ArrowRight') to = cells.filter((b) => at(b).r === rr && at(b).c > cc).sort((a, b) => at(a).c - at(b).c)[0];
      else if (e.key === 'ArrowLeft') to = cells.filter((b) => at(b).r === rr && at(b).c < cc).sort((a, b) => at(b).c - at(a).c)[0];
      else if (e.key === 'ArrowDown') to = cells.filter((b) => at(b).c === cc && at(b).r > rr).sort((a, b) => at(a).r - at(b).r)[0];
      else if (e.key === 'ArrowUp') to = cells.filter((b) => at(b).c === cc && at(b).r < rr).sort((a, b) => at(b).r - at(a).r)[0];
      else { const pool = e.ctrlKey ? cells : cells.filter((b) => at(b).r === rr); to = e.key === 'Home' ? pool[0] : pool[pool.length - 1]; }
      if (to) rove(cells, to);
    });
    return m;
  }
  function clearMatrix() { if (!mx) return; mx.top.replaceChildren(); mx.hr.replaceChildren(); mx.tb.replaceChildren(); mx.cells = []; }
  function renderMatrix(box, ctx) {
    const m = matrixShell(box), top = []; simHead({ append: (n) => top.push(n) }, ctx);
    const M = matrixModel(ctx.model, ctx.order, ctx.shown), wide = ctx.wide, short = (n) => n.id.toUpperCase();
    const shownN = M.rows.reduce((s, r) => s + r.cells.filter((c) => c.shown).length, 0);
    top.push(el('p', 'view-sum', `${shownN} of ${M.cellCount} pairs shown, nodes in ${ORDERS.find((o) => o[0] === ctx.order)[1].toLowerCase()} order. ${ctx.lens === 'loss' ? 'Cells are coloured by packet loss.' : 'Cells are shaded by round-trip time.'} The number in a cell is the median round-trip time in milliseconds.`), el('p', 'view-note mx-note', MATRIX_NOTE));
    m.top.replaceChildren(...top); m.t.setAttribute('data-lens', ctx.lens);
    const nodeHead = (n, scope, label) => { const th = el('th'); th.scope = scope; const b = el('button', 'mx-node', label); b.type = 'button'; b.setAttribute('data-id', n.id); b.setAttribute('aria-pressed', String(ctx.sel.type === 'node' && ctx.sel.id === n.id)); b.setAttribute('aria-label', `${n.label}, ${n.country}. ${scope === 'row' ? 'Row' : 'Column'} header. Press to highlight its pairs.`); b.addEventListener('click', () => ctx.onNode(n.id)); th.append(b); return th; };
    const corner = el('td', 'mx-corner'); corner.append(el('span', 'sr', 'Locations')); m.hr.replaceChildren(corner, ...M.cols.map((c) => nodeHead(c, 'col', short(c))));
    const trs = [], cells = [];
    for (const row of M.rows) {
      const tr = el('tr'); tr.append(nodeHead(row.node, 'row', wide ? row.node.label : short(row.node)));
      if (row.lead) { const v = el('td', 'mx-void'); v.colSpan = row.lead; tr.append(v); }
      for (const c of row.cells) {
        const td = el('td'), r = c.pair;
        if (!r) { td.className = 'mx-gap'; td.textContent = 'no data'; tr.append(td); continue; }
        const st = relState(ctx, r), b = el('button', `mx-cell b${rttBand(r.rtt)} l${r.lossLevel}` + (st.isSel ? ' sel' : '') + (st.hl ? ' hl' : '') + (st.dim ? ' dim' : '') + (c.shown ? '' : ' off')); b.type = 'button';
        b.setAttribute('data-id', r.id); b.setAttribute('data-level', String(r.lossLevel)); b.setAttribute('data-band', String(rttBand(r.rtt))); b.setAttribute('data-dir', c.dir); b.setAttribute('data-r', String(c.i)); b.setAttribute('data-c', String(c.j));
        b.setAttribute('aria-label', pairLabel(r) + `. Only this direction is published.` + (c.shown ? '' : ' Hidden by the current filters.')); b.setAttribute('aria-pressed', String(st.isSel)); b.tabIndex = -1;
        if (!c.shown) b.disabled = true; else cells.push(b);
        b.append(el('span', 'mx-dir', c.dir === 'rc' ? '→' : '←'), el('span', 'mx-v', r.rtt === null ? '—' : String(Math.round(r.rtt)))); const s = shape(r.lossLevel); if (s) b.append(s);
        b.addEventListener('click', () => ctx.onPair(r.id)); hover(b, ctx, r); td.append(b); tr.append(td);
      }
      trs.push(tr);
    }
    m.tb.replaceChildren(...trs); m.cells = cells;
    const home = cells.find((b) => b.classList.contains('sel')) || cells[0]; if (home) home.tabIndex = 0;
  }

  /* ---------- round-trip time versus distance ---------- */
  function renderScatter(box, ctx) {
    clear(box); simHead(box, ctx);
    const W = Math.max(200, Math.round(box.clientWidth || 720)), H = W < 520 ? 320 : Math.round(Math.min(460, W * 0.5)), D = scatterModel(ctx.model, ctx.rows, W, H), wide = W >= 520;
    const svg = se('svg', { viewBox: `0 0 ${W} ${H}`, role: 'group', preserveAspectRatio: 'xMidYMid meet' }); svg.classList.add('sc');
    const n = D.pts.length, kms = D.pts.map((p) => p.km), rts = D.pts.map((p) => p.rtt), below = D.pts.filter((p) => p.rtt < p.km / 100).length;
    const sum = n ? `${n} of ${ctx.model.rows.length} pairs plotted. Distances ${km0(Math.min(...kms))} to ${km0(Math.max(...kms))}; median round-trip times ${ms(Math.min(...rts))} to ${ms(Math.max(...rts))}. ` + (below ? `${below} points lie below the physical floor, which cannot be right and points to a problem with the data.` : 'Every plotted point lies above the physical floor.') : 'No pair is plotted: none matches the filters.';
    svg.setAttribute('aria-label', `Chart of median round-trip time against distance. ${sum}`);
    const defs = se('defs'), pat = se('pattern', { id: 'scwm', width: 190, height: 96, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(-18)' }); pat.append(Object.assign(se('text', { x: 6, y: 52 }, 'wm'), { textContent: 'SIMULATED' }));
    const hatch = se('pattern', { id: 'schatch', width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }); hatch.append(se('line', { x1: 0, y1: 0, x2: 0, y2: 7 }, 'sc-hatchline')); defs.append(pat, hatch); svg.append(defs);
    svg.append(se('rect', { x: 0, y: 0, width: W, height: H }, 'sc-bg')); if (ctx.sim) svg.append(se('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#scwm)' }, 'wmrect'));
    const g0 = se('g', { 'aria-hidden': 'true' });
    for (const v of D.ys.ticks) { const y = r1(D.py(v)); g0.append(se('line', { x1: D.M.l, x2: D.M.l + D.pw, y1: y, y2: y }, 'sc-grid')); const t = se('text', { x: D.M.l - 7, y: r1(y + 4), 'text-anchor': 'end' }, 'sc-tick'); t.textContent = String(v); g0.append(t); }
    for (const v of D.xs.ticks) { const x = r1(D.px(v)); g0.append(se('line', { x1: x, x2: x, y1: D.M.t, y2: D.M.t + D.ph }, 'sc-grid')); const t = se('text', { x, y: D.M.t + D.ph + 16, 'text-anchor': 'middle' }, 'sc-tick'); t.textContent = v.toLocaleString('en-US'); g0.append(t); }
    g0.append(se('rect', { x: D.M.l, y: D.M.t, width: D.pw, height: D.ph }, 'sc-frame'));
    const xt = se('text', { x: r1(D.M.l + D.pw / 2), y: H - 8, 'text-anchor': 'middle' }, 'sc-axis'); xt.textContent = wide ? 'Distance between the two places (km, shortest over the surface)' : 'Distance (km)'; const yt = se('text', { transform: `translate(13 ${r1(D.M.t + D.ph / 2)}) rotate(-90)`, 'text-anchor': 'middle' }, 'sc-axis'); yt.textContent = wide ? 'Median round-trip time (ms)' : 'RTT (ms)'; g0.append(xt, yt);
    const F = D.floor, poly = [[F.x0, F.y0], [F.x1, F.y1], ...(F.km1 < D.xs.max ? [[D.px(D.xs.max), F.y1]] : []), [D.px(D.xs.max), F.y0]];
    g0.append(se('polygon', { points: poly.map((p) => r1(p[0]) + ',' + r1(p[1])).join(' ') }, 'sc-below'), se('line', { x1: r1(F.x0), y1: r1(F.y0), x2: r1(F.x1), y2: r1(F.y1), 'data-km': F.km1, 'data-ms': F.ms1 }, 'sc-floor'));
    const fl = se('text', { x: r1(D.px(D.xs.max) - 6), y: r1(D.M.t + D.ph - 12), 'text-anchor': 'end' }, 'sc-floorlabel'); fl.textContent = D.pw >= 440 ? 'Physical floor: light in fibre, straight line (not a measurement)' : D.pw >= 260 ? 'Physical floor (not a measurement)' : 'Physical floor'; g0.append(fl);   // the longer the room, the more it says; the notes under the chart say the rest
    svg.append(g0);
    const gp = se('g'), btns = [], coarse = ctx.coarse;
    D.pts.forEach((p) => {
      const st = relState(ctx, p.row), lensDim = ctx.lens === 'loss' && p.level === 0 && !st.isSel;
      const g = se('g', { transform: `translate(${r1(p.x)} ${r1(p.y)})`, role: 'button', tabindex: '-1', 'data-id': p.id, 'data-level': p.level, 'data-km': p.km, 'data-rtt': p.rtt, 'aria-pressed': String(st.isSel), 'aria-label': `${pairLabel(p.row)}, ${km0(p.km)} apart` },
        `sc-pt l${p.level}` + (st.isSel ? ' sel' : '') + (st.hl ? ' hl' : '') + (st.dim ? ' dim' : '') + (lensDim ? ' quiet' : '') + (ctx.lens === 'loss' && p.level > 0 ? ' strong' : ''));
      g.append(se('circle', { r: coarse ? 22 : 13 }, 'sc-hit')); if (st.isSel) g.append(se('circle', { r: 12 }, 'sc-halo'));
      g.append(se('path', { d: p.level === 2 ? 'M0 -7l6.5 11.5h-13z' : p.level === 1 ? 'M0 -7l6.5 7-6.5 7-6.5-7z' : 'M-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0z' }, 'sc-mark'));
      g.addEventListener('click', () => ctx.onPair(p.id)); g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctx.onPair(p.id); } }); hover(g, ctx, p.row);
      btns.push(g); gp.append(g);
    });
    svg.append(gp); const fig = el('div', 'sc-fig'); fig.append(svg); box.append(fig);
    const home = btns.find((b) => b.classList.contains('sel')) || btns[0]; if (home) home.setAttribute('tabindex', '0');
    svg.addEventListener('keydown', (e) => {
      const cur = e.target.closest && e.target.closest('.sc-pt'); if (!cur || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return; e.preventDefault();
      const i = btns.indexOf(cur), j = e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : Math.max(0, Math.min(btns.length - 1, i + (e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : -1))); rove(btns, btns[j]);
    });
    box.append(el('p', 'view-sum', sum + (D.noReply ? ` ${D.noReply} pairs with no reply are not plotted.` : '')));
    const notes = el('ul', 'view-notes'); for (const t2 of [DISTANCE_NOTE, FLOOR_NOTE, ctx.sim ? SIM_DISTANCE_NOTE : REAL_DISTANCE_NOTE]) notes.append(el('li', null, t2)); box.append(notes);
    const tb = el('button', 'btn small', 'Open the pairs table sorted by distance'); tb.type = 'button'; tb.setAttribute('data-act', 'table'); tb.addEventListener('click', ctx.onTable); box.append(tb);
  }

  /* ---------- packet-loss list ---------- */
  function renderStrip(box, ctx) {
    clear(box); simHead(box, ctx);
    const S = stripModel(ctx.rows), total = ctx.rows.length;
    box.append(el('p', 'view-sum', S.items.length ? `${S.items.length} of ${total} shown pairs lost at least one packet in their window, listed from the most certain loss rate down. The bar is the 95% interval for the true loss rate; the tick inside it is the share actually lost; the line at 1% is where the dashboard calls loss elevated.` : `No packet was lost on any of the ${total} shown pairs in their windows. ${LOSS_LIST_NOTE}`));
    const wrap = el('div', 'ls-wrap');
    if (S.items.length) {
      const ax = el('div', 'ls-axis'); ax.setAttribute('aria-hidden', 'true'); for (const f of [0, 0.5, 1]) { const s = el('span', null, pct(S.max * f)); s.style.left = f * 100 + '%'; ax.append(s); } wrap.append(ax);
      const ul = el('ul', 'ls'); ul.setAttribute('aria-label', 'Pairs with packet loss');
      for (const it of S.items) {
        const r = it.row, st = relState(ctx, r), li = el('li'), b = el('button', `ls-row l${r.lossLevel}` + (st.isSel ? ' sel' : '') + (st.hl ? ' hl' : '') + (st.dim ? ' dim' : '')); b.type = 'button';
        b.setAttribute('data-id', r.id); b.setAttribute('data-level', String(r.lossLevel)); b.setAttribute('aria-pressed', String(st.isSel)); b.setAttribute('aria-label', `${pairLabel(r)}. 95% interval for the true loss rate ${pct(it.lo)} to ${pct(it.hi)}.`);
        const name = el('span', 'ls-name'); name.append(el('b', null, `${r.srcLabel} → ${r.dstLabel}`)); const s = shape(r.lossLevel); if (s) name.append(document.createTextNode(' '), s); name.append(document.createTextNode(' ' + LOSS_NAMES[r.lossLevel]));
        const num = el('span', 'ls-num', `${r.lost} of ${r.sent} lost (${r1(it.p * 100)}%), 95% interval ${pct(it.lo)} to ${pct(it.hi)}`);
        const tr = el('span', 'ls-track'); tr.setAttribute('aria-hidden', 'true'); const iv = el('i', 'ls-int'), pt = el('i', 'ls-pt'), th = el('i', 'ls-thr'); iv.style.left = (it.lo / S.max) * 100 + '%'; iv.style.width = Math.max(0.6, ((it.hi - it.lo) / S.max) * 100) + '%'; pt.style.left = (it.p / S.max) * 100 + '%'; th.style.left = (0.01 / S.max) * 100 + '%'; tr.append(iv, pt, th);
        b.append(name, num, tr); b.addEventListener('click', () => ctx.onPair(r.id)); hover(b, ctx, r); li.append(b); ul.append(li);
      }
      wrap.append(ul);
    }
    box.append(wrap, el('p', 'view-note', LOSS_LIST_NOTE));
  }

  /* ---------- the line under the view switch: what is selected here ---------- */
  function renderBar(bar, ctx) {
    clear(bar); const s = ctx.sel; let mode = 'idle', text = ctx.hint;
    if (s.type === 'pair') { const r = ctx.model.rowById.get(s.id); mode = 'fits'; text = `Selected: ${r.srcLabel} to ${r.dstLabel}, ${ms(r.rtt)}, ${lossWords(r)}.`; }
    else if (s.type === 'node') { const n = ctx.model.nodeById.get(s.id); mode = 'fits'; text = `Selected: ${n.label}. Its pairs are highlighted.`; }
    bar.setAttribute('data-mode', mode); bar.className = 'framebar ' + mode; bar.append(el('span', 'frame-note', text));
    if (s.type) { const b = el('button', 'btn small back', 'Clear selection'); b.type = 'button'; b.addEventListener('click', ctx.onClear); bar.append(b); }
  }
  return { renderMatrix, clearMatrix, renderScatter, renderStrip, renderBar };
}
