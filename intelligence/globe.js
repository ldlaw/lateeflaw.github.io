/* The globe view (milestone M2.1): an SVG orthographic globe that draws what the flat map draws, from the same model, with the same selection and the same
   packet-loss encoding. Hand-rolled, no library. The element set is built once and then updated in place while the globe turns, so dragging only rewrites
   attributes. It holds NO data of its own: setData() is given the model and clear() removes every trace of it, which is what the kill switch calls.
   Lines are shortest-distance lines on a sphere for display only. They are not routes. Every string from data is set with textContent. */
import { DEFAULT_CENTRE, viewer, toView, fromView, toVec, grabCentre, greatCircle, flat, prepareLand, graticule, landPath, polylinePath, midVisible, dragCentre, stepCentre, lerpCentre, normCentre, sameCentre } from './geo.js';
import { arcClass, lossMarkPath } from './encode.js';

const NS = 'http://www.w3.org/2000/svg', r1 = (x) => Math.round(x * 10) / 10, STEP_DEG = 15, DRAG_PX = 5, TWEEN_MS = 350, MIN_Z = 0.02;
const se = (tag, attrs, cls) => { const e = document.createElementNS(NS, tag); if (cls) e.setAttribute('class', cls); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); return e; };

export function createGlobe({ svg, rings, placeLabels, tip, reducedMotion = () => false, onSelectPair = () => {}, onSelectNode = () => {}, onClear = () => {}, onRotate = () => {} }) {
  const land = prepareLand(rings), grat = graticule(), G = { centre: { ...DEFAULT_CENTRE }, w: 0, h: 0, R: 0, cx: 0, cy: 0, data: null, key: '', nodeKey: '', els: null, raf: 0, tween: null, drag: null, last: null };
  const times = []; let timeIx = 0;   // the last 600 redraw durations in ms (local measurement only)
  const stat = (ms) => { times[timeIx++ % 600] = ms; };

  function size() { const w = svg.clientWidth || 600, h = svg.clientHeight || w; if (w === G.w && h === G.h && G.els) return false; G.w = w; G.h = h; G.R = Math.max(40, Math.min(w, h) / 2 - 4); G.cx = w / 2; G.cy = h / 2; G.frameDirty = true; svg.setAttribute('viewBox', `0 0 ${w} ${h}`); return true; }

  /* ---- build (once per data set) ---- */
  function buildFrame() {
    svg.replaceChildren();
    const defs = se('defs'), pat = se('pattern', { id: 'gwm', width: 190, height: 96, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(-18)' }); const t = se('text', { x: 6, y: 52 }, 'wm'); t.textContent = 'SIMULATED'; pat.append(t); defs.append(pat);
    const ocean = se('circle', {}, 'ocean'), wm = se('circle', { fill: 'url(#gwm)' }, 'wmcircle'), gr = se('path', {}, 'grat'), ld = se('path', {}, 'land'), rim = se('circle', {}, 'rim');
    const gArcs = se('g', { 'aria-hidden': 'true' }), gMarks = se('g', { 'aria-hidden': 'true' }), gHits = se('g', { 'aria-hidden': 'true' }), gNodes = se('g');
    svg.append(defs, ocean, wm, gr, ld, gArcs, gMarks, gHits, gNodes, rim);
    G.els = { ocean, wm, gr, ld, rim, gArcs, gMarks, gHits, gNodes, arcs: new Map(), nodes: new Map(), casing: null }; G.frameDirty = true;
  }
  function buildSets(d) {
    const E = G.els; E.gArcs.replaceChildren(); E.gMarks.replaceChildren(); E.gHits.replaceChildren(); E.gNodes.replaceChildren(); E.arcs.clear(); E.nodes.clear(); E.casing = null;
    for (const r of d.rows) {
      const A = d.nodeById.get(r.src), B = d.nodeById.get(r.dst), vecs = flat(greatCircle(A, B, 32)), arc = se('path', {}, ''), hit = se('path', { 'data-id': r.id }, 'arc-hit'), mark = r.lossLevel > 0 ? se('path', { 'data-id': r.id }, `lossmark l${r.lossLevel}`) : null;
      arc.setAttribute('data-id', r.id); hit.addEventListener('pointerenter', (e) => tip.show(d.rowTip(r), e)); hit.addEventListener('pointermove', (e) => tip.show(d.rowTip(r), e)); hit.addEventListener('pointerleave', tip.hide);
      E.gArcs.append(arc); if (mark) E.gMarks.append(mark); E.gHits.append(hit); E.arcs.set(r.id, { r, vecs, arc, hit, mark, d: null, md: null, hitD: null });
    }
    for (const n of d.nodes) {
      const g = se('g', { tabindex: '0', role: 'button', 'data-id': n.id }, 'node'), lab = se('text', {}, 'nl'); g.append(se('circle', { r: d.coarse ? 22 : 15 }, 'nhit'), se('circle', { r: 6 }, 'ring'), se('circle', { r: 2.4 }, 'core'), lab);
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onSelectNode(n.id); } });
      g.addEventListener('pointerenter', (e) => tip.show(d.nodeTip(n), e)); g.addEventListener('pointermove', (e) => tip.show(d.nodeTip(n), e)); g.addEventListener('pointerleave', tip.hide);
      E.gNodes.append(g); E.nodes.set(n.id, { n, g, lab, vec: toVec(n.lon, n.lat), z: 1, side: null, shown: true });
    }
  }

  /* ---- selection classes and the selected pair's halo ---- */
  function applyState(d) {
    const E = G.els, selNode = d.sel.type === 'node' ? d.sel.id : null, selPair = d.sel.type === 'pair' ? d.rowById.get(d.sel.id) : null, anySel = !!(selNode || selPair), touch = new Set(), ends = selPair ? new Set([selPair.src, selPair.dst]) : new Set();
    for (const r of d.rows) touch.add(r.src), touch.add(r.dst);
    for (const [id, e] of E.arcs) {
      const isSel = !!selPair && selPair.id === id, hl = !!selNode && (e.r.src === selNode || e.r.dst === selNode), dim = anySel && !isSel && !hl, cls = arcClass(e.r, { sel: isSel, hl, dim });
      if (e.cls !== cls) { e.arc.setAttribute('class', cls); e.cls = cls; if (e.mark) e.mark.setAttribute('class', `lossmark l${e.r.lossLevel}` + (dim ? ' dim' : '')); }
    }
    if (E.casing) { E.casing.remove(); E.casing = null; }
    if (selPair) { const e = E.arcs.get(selPair.id); if (e) { E.casing = se('path', { 'data-id': selPair.id }, 'arc-casing'); E.casing.setAttribute('d', e.d || ''); E.gArcs.append(E.casing, e.arc); } }   // the halo sits directly under the selected line, which is drawn last
    for (const [id, e] of E.nodes) {
      const isSel = selNode === id, isEnd = ends.has(id), cls = 'node' + (isSel ? ' sel' : '') + (isEnd ? ' end' : '') + (selPair && !isEnd ? ' faded' : '') + (d.filtersActive && !touch.has(id) ? ' idle' : '');
      if (e.cls !== cls) { e.g.setAttribute('class', cls); e.cls = cls; }
      e.g.setAttribute('aria-pressed', String(isSel)); e.g.setAttribute('aria-label', d.nodeAria(e.n, isSel)); e.isEnd = isEnd;
    }
    G.selPair = selPair; G.ends = ends;
  }

  /* ---- drawing: one pass, attributes only ---- */
    function redraw(lazy) {   // lazy: while the globe is being dragged or animated the invisible hit paths are left alone and caught up afterwards
    const d = G.data, E = G.els; if (!d || !E) return; const t0 = performance.now(), o = viewer(G.centre), R = G.R, cx = G.cx, cy = G.cy;
    if (G.frameDirty) { for (const el of [E.ocean, E.wm, E.rim]) { el.setAttribute('r', R); el.setAttribute('cx', cx); el.setAttribute('cy', cy); } G.frameDirty = false; }
    E.ld.setAttribute('d', landPath(land, o, R, cx, cy)); { let gd = ''; for (const l of grat) gd += polylinePath(l, o, R, cx, cy); E.gr.setAttribute('d', gd); }
    for (const e of E.arcs.values()) {
      const dd = polylinePath(e.vecs, o, R, cx, cy);
      if (dd !== e.d) { e.d = dd; e.arc.setAttribute('d', dd); }
      if (!lazy && e.hitD !== e.d) { e.hitD = e.d; e.hit.setAttribute('d', e.d); }
      const show = dd !== ''; if (show !== e.shown) { e.shown = show; const v = show ? null : 'none'; for (const x of [e.arc, e.hit, e.mark]) if (x) (v ? x.setAttribute('display', v) : x.removeAttribute('display')); }
      if (e.mark) { const w = show ? midVisible(e.vecs, o) : null, md = w ? lossMarkPath(cx + R * w[0], cy - R * w[1], 1, e.r.lossLevel) : ''; if (md !== e.md) { e.md = md; if (md) { e.mark.setAttribute('d', md); e.mark.removeAttribute('display'); } else e.mark.setAttribute('display', 'none'); } }
      if (G.selPair && G.selPair.id === e.r.id && E.casing && E.casing.getAttribute('d') !== dd) E.casing.setAttribute('d', dd);
    }
    const items = [], pos = new Map(), focused = document.activeElement;
    for (const e of E.nodes.values()) {
      const w = toView(e.vec, o), vis = w[2] >= MIN_Z, x = cx + R * w[0], y = cy - R * w[1]; e.z = w[2]; e.shown = vis;
      if (vis) { e.g.setAttribute('transform', `translate(${r1(x)} ${r1(y)})`); if (e.hidden) { e.hidden = false; e.g.removeAttribute('display'); e.g.setAttribute('tabindex', '0'); e.g.removeAttribute('aria-hidden'); } items.push({ id: e.n.id, x, y, text: d.nodeLabel(e.n) }); pos.set(e.n.id, [x, y]); }
      else if (!e.hidden) { e.hidden = true; e.g.setAttribute('display', 'none'); e.g.setAttribute('tabindex', '-1'); e.g.setAttribute('aria-hidden', 'true'); }
    }
    const sides = placeLabels(items, { bounds: { w: G.w, h: G.h }, priority: G.ends, omitBlocked: !!G.selPair });
    for (const e of E.nodes.values()) {
      if (e.hidden) continue; const side = sides.get(e.n.id), tx = side === 'right' ? [9, 4, 'start'] : side === 'left' ? [-9, 4, 'end'] : side === 'top' ? [0, -11, 'middle'] : [0, 19, 'middle'], key = side + '|' + d.nodeLabel(e.n) + '|' + (e.isEnd ? 1 : 0);
      if (e.labKey !== key) { e.labKey = key; if (side) { e.lab.setAttribute('x', tx[0]); e.lab.setAttribute('y', tx[1]); e.lab.setAttribute('text-anchor', tx[2]); e.lab.setAttribute('class', 'nl' + (e.isEnd ? ' end' : '')); e.lab.textContent = d.nodeLabel(e.n); e.lab.removeAttribute('display'); } else e.lab.setAttribute('display', 'none'); }
    }
    if (focused && focused.closest && focused.closest('.node') && focused.closest('.node').getAttribute('aria-hidden') === 'true') svg.focus({ preventScroll: true });
    stat(performance.now() - t0);
  }
  const schedule = () => { if (!G.raf) G.raf = requestAnimationFrame(() => { G.raf = 0; redraw(true); }); };
  const visibleCount = () => { let n = 0; if (G.els) for (const e of G.els.nodes.values()) if (!e.hidden) n++; return n; };
  function label() {
    const d = G.data; if (!d) return; const c = G.centre, ns = c.lat >= 0 ? 'north' : 'south', ew = c.lon >= 0 ? 'east' : 'west';
    svg.setAttribute('aria-label', `Globe of ${d.nodes.length} ${d.sim ? 'simulated ' : ''}locations and ${d.rows.length} of ${d.total} connections, centred on ${Math.round(Math.abs(c.lat))} degrees ${ns}, ${Math.round(Math.abs(c.lon))} degrees ${ew}. ${visibleCount()} locations in view. Arrow keys turn the globe.`);
  }
  function emit(source) { label(); onRotate({ ...G.centre }, source); }

  /* ---- public: data, orientation ---- */
  function setData(d) {
    G.data = d; size(); if (!G.els) buildFrame();
    const nk = d.nodes.map((n) => n.id + n.label).join('|'), rk = d.rows.map((r) => r.id + ':' + r.lossLevel + ':' + r.rtt).join('|') + '#' + nk + (d.coarse ? 'c' : '');
    if (rk !== G.key) { G.key = rk; buildSets(d); }
    if (d.sim) G.els.wm.removeAttribute('display'); else G.els.wm.setAttribute('display', 'none');
    applyState(d); redraw(); label();
  }
  const resize = () => { if (G.els && size()) { redraw(); label(); } };
  function setCentre(c, { animate = true, source = 'api' } = {}) {
    cancelTween(); const to = normCentre(c);
    if (!animate || reducedMotion() || sameCentre(to, G.centre, 0.05)) { G.centre = to; redraw(); emit(source); return; }
    const from = { ...G.centre }, t0 = performance.now();
    G.tween = { raf: 0 }; const step = (now) => { const t = Math.min(1, (now - t0) / TWEEN_MS), k = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2; G.centre = lerpCentre(from, to, k); redraw(t < 1); if (t < 1) G.tween.raf = requestAnimationFrame(step); else { G.tween = null; G.centre = to; emit(source); } };
    G.tween.raf = requestAnimationFrame(step);
  }
  function cancelTween() { if (G.tween) { cancelAnimationFrame(G.tween.raf); G.tween = null; } }
  const turn = (dLon, dLat, source) => setCentre(stepCentre(G.centre, dLon, dLat), { animate: false, source });

  /* ---- the kill switch: remove everything this view knows ---- */
  function clear() {   // the orientation is a view setting, not data, so it survives; everything else goes
    cancelTween(); if (G.raf) { cancelAnimationFrame(G.raf); G.raf = 0; } G.drag = null; G.data = null; G.key = ''; G.els = null; G.selPair = null; G.ends = null; svg.replaceChildren(); svg.removeAttribute('aria-label'); svg.classList.remove('dragging'); G.w = G.h = 0; times.length = 0; timeIx = 0;
  }

  /* ---- input: pointer (mouse, touch, pen) and keyboard ---- */
  const target = (t) => (t && t.closest ? t.closest('.arc-hit, .node') : null);
  svg.addEventListener('pointerdown', (e) => { if (!G.els || (e.pointerType === 'mouse' && e.button !== 0)) return; cancelTween(); const r = svg.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, x = (sx - G.cx) / G.R, y = -(sy - G.cy) / G.R, inside = x * x + y * y <= 1; G.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx, sy, c: { ...G.centre }, moved: false, target: target(e.target), grab: inside ? fromView([x, y, Math.sqrt(1 - x * x - y * y)], viewer(G.centre)) : null }; });
  svg.addEventListener('pointermove', (e) => {
    const dr = G.drag; if (!dr || e.pointerId !== dr.id) return; const dx = e.clientX - dr.x, dy = e.clientY - dr.y;
    if (!dr.moved) { if (Math.hypot(dx, dy) < DRAG_PX) return; if (e.pointerType === 'touch' && Math.abs(dy) > Math.abs(dx)) { G.drag = null; return; }   // a vertical swipe on a phone is the page scrolling, not a turn
      dr.moved = true; try { svg.setPointerCapture(e.pointerId); } catch (x) { /* the pointer is gone */ } svg.classList.add('dragging'); tip.hide(); }
    const c = dr.grab ? grabCentre(dr.grab, (dr.sx + dx - G.cx) / G.R, -(dr.sy + dy - G.cy) / G.R, G.centre) : null; G.centre = c || dragCentre(dr.c, dx, dy, G.R); schedule();   // the place under the pointer stays under it; the simple turn is only a fallback near the poles
  });
  const endDrag = (e, cancelled) => {
    const dr = G.drag; if (!dr || e.pointerId !== dr.id) return; G.drag = null; svg.classList.remove('dragging'); try { svg.releasePointerCapture(e.pointerId); } catch (x) { /* released */ }
    if (dr.moved && cancelled) { G.centre = dr.c; redraw(); emit('cancel'); return; }   // the browser took the gesture over (scrolling): nothing turned
    if (dr.moved) { redraw(); emit('drag'); return; }
    if (cancelled || !G.els) return; const t = dr.target; if (t && t.classList.contains('arc-hit')) onSelectPair(t.getAttribute('data-id')); else if (t) onSelectNode(t.getAttribute('data-id')); else onClear();
  };
  svg.addEventListener('pointerup', (e) => endDrag(e, false)); svg.addEventListener('pointercancel', (e) => endDrag(e, true));
  svg.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || !G.els) return; const s = (e.shiftKey ? 2 : 1) * STEP_DEG;
    const m = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, s], ArrowDown: [0, -s] }[e.key];
    if (m) { e.preventDefault(); turn(m[0], m[1], 'key'); } else if (e.key === 'Home') { e.preventDefault(); setCentre(DEFAULT_CENTRE, { animate: false, source: 'key' }); }
  });

  return { setData, redraw, resize, setCentre, turn, clear, getCentre: () => ({ ...G.centre }), isAnimating: () => !!G.tween, step: STEP_DEG, inView: visibleCount,
    stats() { const a = times.filter((x) => x !== undefined).slice().sort((x, y) => x - y), q = (p) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : null); return { n: a.length, p50: q(0.5), p95: q(0.95), max: a.length ? a[a.length - 1] : null }; },
    resetStats() { times.length = 0; timeIx = 0; }, has: () => !!G.els };
}
