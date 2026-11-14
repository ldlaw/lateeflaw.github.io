/* Pure geometry for the globe view (milestone M2.1). No DOM, no network, no storage, no clock: every function is a plain calculation, so the unit tests can
   check it against an independent reference. Coordinates are degrees; "earth vectors" are unit vectors (x toward longitude 0 on the equator, y toward 90 E,
   z toward the north pole); "view vectors" are the same points seen from the viewer: x to the right, y up, z toward the viewer. A point is on the visible
   side when its view z is not negative. This is an orthographic projection of a sphere: it draws where places are, nothing more. */
export const D2R = Math.PI / 180, R2D = 180 / Math.PI;
export const DEFAULT_CENTRE = Object.freeze({ lon: -15, lat: 20 });
export const MAX_LAT = 85;   // the view never tilts to a pole, so north stays up and the globe never rolls

export const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;
export const clampLat = (lat, max = MAX_LAT) => Math.max(-max, Math.min(max, lat));
export const normCentre = (c) => ({ lon: wrapLon(c.lon), lat: clampLat(c.lat) });
export const toVec = (lon, lat) => { const p = lat * D2R, l = lon * D2R, c = Math.cos(p); return [c * Math.cos(l), c * Math.sin(l), Math.sin(p)]; };
export const fromVec = (v) => ({ lon: Math.atan2(v[1], v[0]) * R2D, lat: Math.asin(Math.max(-1, Math.min(1, v[2]))) * R2D });
const norm = (v) => { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };

/* The viewer: where the globe is centred. Precomputes the rotation (about the pole by the centre longitude, then about the east axis by the centre latitude). */
export function viewer(centre) {
  const c = normCentre(centre), l0 = c.lon * D2R, p0 = c.lat * D2R;
  return { lon: c.lon, lat: c.lat, sl: Math.sin(l0), cl: Math.cos(l0), sp: Math.sin(p0), cp: Math.cos(p0) };
}
export function toView(v, o) {
  const x1 = v[0] * o.cl + v[1] * o.sl, y1 = -v[0] * o.sl + v[1] * o.cl, z1 = v[2];
  return [y1, -x1 * o.sp + z1 * o.cp, x1 * o.cp + z1 * o.sp];
}
export function fromView(w, o) {   // the inverse, used to find the place under a screen point
  const x1 = w[2] * o.cp - w[1] * o.sp, z1 = w[2] * o.sp + w[1] * o.cp, y1 = w[0];
  return [x1 * o.cl - y1 * o.sl, x1 * o.sl + y1 * o.cl, z1];
}
export const screen = (w, R, cx, cy) => [cx + R * w[0], cy - R * w[1]];

/* Angular distance and the shortest-distance (great-circle) line between two places. These lines are for display only: they say nothing about network routes. */
export function angularDeg(a, b) { const A = toVec(a.lon, a.lat), B = toVec(b.lon, b.lat); return Math.acos(Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]))) * R2D; }
export function greatCircle(a, b, n = 32) {
  const A = toVec(a.lon, a.lat), B = toVec(b.lon, b.lat), d = Math.acos(Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
  if (d < 1e-9) return [A, B];
  if (Math.PI - d < 1e-9) {   // exactly opposite: every great circle through both is a shortest line, so take the one through the north pole (or the x axis at a pole)
    const P = Math.abs(A[2]) > 0.999 ? [1, 0, 0] : norm([-A[1], A[0], 0]), Q = [A[1] * P[2] - A[2] * P[1], A[2] * P[0] - A[0] * P[2], A[0] * P[1] - A[1] * P[0]], out = [];
    for (let i = 0; i <= n; i++) { const t = (Math.PI * i) / n, c = Math.cos(t), s2 = Math.sin(t); out.push([c * A[0] + s2 * Q[0], c * A[1] + s2 * Q[1], c * A[2] + s2 * Q[2]]); } return out;
  }
  const out = [], s = Math.sin(d);
  for (let i = 0; i <= n; i++) { const t = i / n, k1 = Math.sin((1 - t) * d) / s, k2 = Math.sin(t * d) / s; out.push([k1 * A[0] + k2 * B[0], k1 * A[1] + k2 * B[1], k1 * A[2] + k2 * B[2]]); }
  return out;
}
export const midpoint = (a, b) => fromVec(greatCircle(a, b, 2)[1]);

/* ---- clipping to the visible hemisphere (view z >= 0) ---- */
function cross0(p, q) {   // where the straight chord p -> q meets the horizon plane z = 0, pushed back onto the sphere
  const t = p[2] / (p[2] - q[2]);
  return norm([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]), 0]);
}
// A polyline of view vectors -> the pieces of it that are on the visible side, cut exactly at the horizon.
export function clipPolyline(ws) {
  const out = []; let cur = null;
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i], vis = w[2] >= 0;
    if (i > 0) {
      const p = ws[i - 1], pv = p[2] >= 0;
      if (pv && !vis) { cur.push(cross0(p, w)); if (cur.length > 1) out.push(cur); cur = null; }
      else if (!pv && vis) cur = [cross0(p, w)];
    }
    if (vis) { if (!cur) cur = []; cur.push(w); }
  }
  if (cur && cur.length > 1) out.push(cur);
  return out;
}
// A closed ring of view vectors -> one ring on the visible side, closed along the horizon (the shorter way round) where the ring leaves and re-enters the hemisphere.
export function clipRing(ws, stepDeg = 6) {
  const n = ws.length, items = []; if (!n) return [];
  let any = false, all = true;
  for (const w of ws) { if (w[2] >= 0) any = true; else all = false; }
  if (all) return ws.map((w) => [w[0], w[1], w[2]]);
  if (!any) return [];
  for (let i = 0; i < n; i++) {
    const cur = ws[i], prev = ws[(i + n - 1) % n], cv = cur[2] >= 0, pv = prev[2] >= 0;
    if (cv) { if (!pv) items.push({ v: cross0(prev, cur), tag: 'entry' }); items.push({ v: cur, tag: 'in' }); }
    else if (pv) items.push({ v: cross0(prev, cur), tag: 'exit' });
  }
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i]; out.push(it.v);
    if (it.tag === 'exit') {
      const nx = items[(i + 1) % items.length]; if (nx.tag !== 'entry') continue;
      const a0 = Math.atan2(it.v[1], it.v[0]); let da = Math.atan2(nx.v[1], nx.v[0]) - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da <= -Math.PI) da += 2 * Math.PI;
      const steps = Math.max(1, Math.ceil(Math.abs(da) / (stepDeg * D2R)));
      for (let k = 1; k < steps; k++) { const a = a0 + (da * k) / steps; out.push([Math.cos(a), Math.sin(a), 0]); }
    }
  }
  return out;
}

/* ---- the coastline and the graticule, prepared once as flat arrays of earth vectors (x, y, z, x, y, z, ...) ---- */
export const flat = (vecs) => { const f = new Float64Array(vecs.length * 3); for (let i = 0; i < vecs.length; i++) { f[3 * i] = vecs[i][0]; f[3 * i + 1] = vecs[i][1]; f[3 * i + 2] = vecs[i][2]; } return f; };
const viewAt = (f, i, o) => { const x = f[3 * i], y = f[3 * i + 1], z = f[3 * i + 2], x1 = x * o.cl + y * o.sl; return [-x * o.sl + y * o.cl, -x1 * o.sp + z * o.cp, x1 * o.cp + z * o.sp]; };
// Each ring keeps a bounding cap (its centre c and the sine of its angular radius s), so a ring wholly behind the globe costs one test and a ring wholly in front needs no clipping.
export function prepareLand(rings, maxStepDeg = 4) {   // long edges are subdivided so they curve with the sphere near the horizon
  return rings.map((r) => {
    const out = [];
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], A = toVec(a[0], a[1]), B = toVec(b[0], b[1]); out.push(A);
      const d = Math.acos(Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]))) * R2D, k = Math.floor(d / maxStepDeg);
      for (let j = 1; j <= k; j++) { const t = j / (k + 1); out.push(norm([A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1]), A[2] + t * (B[2] - A[2])])); }
    }
    let sx = 0, sy = 0, sz = 0; for (const v of out) { sx += v[0]; sy += v[1]; sz += v[2]; } const c = norm([sx, sy, sz]); let rho = 0;
    for (const v of out) rho = Math.max(rho, Math.acos(Math.max(-1, Math.min(1, v[0] * c[0] + v[1] * c[1] + v[2] * c[2]))));
    return { f: flat(out), c, s: Math.sin(Math.min(Math.PI / 2, rho + 1e-9)), wide: rho + 1e-9 >= Math.PI / 2 };
  });
}
export function graticule(stepDeg = 30, sampleDeg = 5) {   // meridians and parallels as flat polylines of earth vectors
  const lines = [];
  for (let lon = -180; lon < 180; lon += stepDeg) { const l = []; for (let lat = -90; lat <= 90; lat += sampleDeg) l.push(toVec(lon, lat)); lines.push(flat(l)); }
  for (let lat = -90 + stepDeg; lat < 90; lat += stepDeg) { const l = []; for (let lon = -180; lon <= 180; lon += sampleDeg) l.push(toVec(lon, lat)); lines.push(flat(l)); }
  return lines;
}
const r1 = (x) => Math.round(x * 10) / 10;
// A flat polyline of earth vectors -> an SVG path of its visible pieces, cut exactly at the horizon (no allocation: this runs for every line on every frame).
export function polylinePath(f, o, R, cx, cy) {
  const n = f.length / 3, cl = o.cl, sl = o.sl, cp = o.cp, sp = o.sp; let d = '', open = false, px = 0, py = 0, pz = 0;
  for (let i = 0; i < n; i++) {
    const x = f[3 * i], y = f[3 * i + 1], z = f[3 * i + 2], x1 = x * cl + y * sl, xv = -x * sl + y * cl, yv = -x1 * sp + z * cp, zv = x1 * cp + z * sp;
    if (zv >= 0) {
      if (i > 0 && !open) { const t = pz / (pz - zv), qx = px + t * (xv - px), qy = py + t * (yv - py), nn = Math.hypot(qx, qy) || 1; d += 'M' + r1(cx + R * (qx / nn)) + ' ' + r1(cy - R * (qy / nn)) + 'L'; } else d += open ? 'L' : 'M';
      d += r1(cx + R * xv) + ' ' + r1(cy - R * yv); open = true;
    } else if (open) { const t = pz / (pz - zv), qx = px + t * (xv - px), qy = py + t * (yv - py), nn = Math.hypot(qx, qy) || 1; d += 'L' + r1(cx + R * (qx / nn)) + ' ' + r1(cy - R * (qy / nn)); open = false; }
    px = xv; py = yv; pz = zv;
  }
  return d;
}
// The view position [x, y] of the sample of a flat polyline that is nearest its middle among those at least minZ above the horizon, or null if none is. Where a line's loss mark goes.
export function midVisible(f, o, minZ = 0.05) {
  const n = f.length / 3, mid = (n - 1) >> 1;
  for (let k = 0; k <= mid + 1; k++) for (const i of k ? [mid - k, mid + k] : [mid]) { if (i < 0 || i >= n) continue; const w = viewAt(f, i, o); if (w[2] >= minZ) return [w[0], w[1]]; }
  return null;
}
export function landPath(prepared, o, R, cx, cy) {   // every ring, clipped to the visible side and closed along the horizon
  let d = '';
  for (const g of prepared) {
    const cz = (g.c[0] * o.cl + g.c[1] * o.sl) * o.cp + g.c[2] * o.sp; if (cz < -g.s && !g.wide) continue;   // wholly behind the globe
    const f = g.f, n = f.length / 3;
    if (cz >= g.s && !g.wide) { let t = 'M'; for (let i = 0; i < n; i++) { const x = f[3 * i], y = f[3 * i + 1], z = f[3 * i + 2], x1 = x * o.cl + y * o.sl, xv = -x * o.sl + y * o.cl, yv = -x1 * o.sp + z * o.cp; t += (i ? 'L' : '') + r1(cx + R * xv) + ' ' + r1(cy - R * yv); } d += t + 'Z'; continue; }   // wholly in front: no clipping
    const ws = new Array(n); for (let i = 0; i < n; i++) ws[i] = viewAt(f, i, o); const c = clipRing(ws); if (c.length < 3) continue; d += 'M' + c.map((w) => r1(cx + R * w[0]) + ' ' + r1(cy - R * w[1])).join('L') + 'Z';
  }
  return d;
}

/* ---- orientation: dragging, stepping, centring ---- */
// Grab the surface and move it with the pointer. Longitude steps are widened by 1 / cos(latitude) (at most 4 times) so the place under the pointer follows it at high latitudes too.
export function dragCentre(c, dx, dy, R) { const k = Math.min(4, 1 / Math.max(0.05, Math.cos(c.lat * D2R))); return normCentre({ lon: c.lon - ((dx * k) / R) * R2D, lat: c.lat + (dy / R) * R2D }); }
// Exact grab: the centre that puts the earth vector P (the place that was under the pointer when the drag began) under the pointer now, at unit-disk position (x, y)
// (x right, y up; a pointer outside the disk is pulled to the rim). The view has no roll, so there is a pitch (latitude) and a yaw (longitude) to find; of the two
// yaws that work, the one nearest the current centre is taken. Returns null when no centre within +-85 degrees of latitude can do it (the place is too near a pole).
export function grabCentre(P, x, y, cur) {
  const r2 = x * x + y * y, s = r2 > 1 ? 1 / Math.sqrt(r2) : 1, xv = x * s, yv = y * s, zv = Math.sqrt(Math.max(0, 1 - xv * xv - yv * yv)), rho = Math.hypot(P[0], P[1]);
  if (rho < 1e-6 || Math.abs(xv) > rho + 1e-12) return null;
  const alpha = Math.atan2(P[1], P[0]), a = Math.asin(Math.max(-1, Math.min(1, xv / rho))); let best = null, bestD = Infinity;
  for (const l0 of [alpha - a, alpha - Math.PI + a]) {
    const u0 = rho * Math.cos(alpha - l0); let phi = Math.atan2(P[2], u0) - Math.atan2(yv, zv); while (phi > Math.PI) phi -= 2 * Math.PI; while (phi <= -Math.PI) phi += 2 * Math.PI;
    if (Math.abs(phi) > MAX_LAT * D2R) continue; const c = normCentre({ lon: l0 * R2D, lat: phi * R2D }), w = toView(P, viewer(c)); if (Math.hypot(w[0] - xv, w[1] - yv, w[2] - zv) > 1e-6) continue;
    const d = Math.abs(wrapLon(c.lon - cur.lon)) + Math.abs(c.lat - cur.lat); if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}
export const stepCentre = (c, dLon, dLat) => normCentre({ lon: c.lon + dLon, lat: c.lat + dLat });
// The shortest way from one centre to another, for an animation: longitude never takes the long way round.
export function lerpCentre(a, b, t) { let dl = wrapLon(b.lon - a.lon); return normCentre({ lon: a.lon + dl * t, lat: a.lat + (b.lat - a.lat) * t }); }
export const sameCentre = (a, b, eps = 0.01) => Math.abs(wrapLon(a.lon - b.lon)) < eps && Math.abs(a.lat - b.lat) < eps;

/* Is the whole line between two places on the visible side, with a margin (minZ is the sine of the angle above the horizon)? */
export function lineVisible(a, b, o, minZ = 0.05) { return greatCircle(a, b, 24).every((v) => toView(v, o)[2] >= minZ); }
export function placeVisible(p, o, minZ = 0) { return toView(toVec(p.lon, p.lat), o)[2] >= minZ; }
// A centre that shows a pair: the midpoint of its line (both ends are then half the line's length from the centre, so each is above the horizon while that is under
// 2 x acos(minZ), about 174 degrees for the 0.05 margin used here). A pair further apart than that cannot show both ends at once.
export const FIT_LIMIT_DEG = 2 * Math.acos(0.05) * R2D;
export function centreForPair(a, b) { return normCentre(midpoint(a, b)); }
export const pairFits = (a, b) => angularDeg(a, b) <= FIT_LIMIT_DEG;
// The middle of a group of places (their mean direction), for the region presets.
export function centreOf(places) {
  let x = 0, y = 0, z = 0; for (const p of places) { const v = toVec(p.lon, p.lat); x += v[0]; y += v[1]; z += v[2]; }
  return normCentre(fromVec(norm([x, y, z])));
}
