/* Shared visual encoding for every view of the dashboard (milestones M2.1 and M2.2: the flat map, the globe, the latency matrix, the distance chart and the loss list all use it).
   One definition of "what packet loss and round-trip time look like", so the views can never disagree: colour = packet loss in the window (cyan none observed,
   amber observed, red elevated), line width and pattern = round-trip time, a diamond or triangle as a second signal so loss is never colour-only.
   No DOM, no network, no storage: pure functions and text. */

/* ---- packet loss level. The data contract defines NO loss threshold (it only flags that a packet was lost), so this rule is the dashboard's own and is shown to the
   viewer. A fixed percentage would mislead with 30 packets per pair, where one chance drop is already 3.3%. "Elevated" therefore means: the lower end of the
   95% Wilson score interval for the true loss rate is above 1%. With 30 packets that is 2 or more lost; one lost packet stays "observed". ---- */
export const LOSS_RULE = { z: 1.96, above: 0.01 };
export function wilsonLower(k, n, z = LOSS_RULE.z) {
  if (!(n > 0) || !(k > 0)) return 0;
  const p = Math.min(1, k / n), z2 = z * z, d = 1 + z2 / n, c = p + z2 / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));
  return Math.max(0, (c - m) / d);
}
// The whole 95% Wilson score interval (lower, upper) for the true loss rate, as fractions. Shown by the loss list so a single lost packet is never presented as a precise rate.
export function wilsonInterval(k, n, z = LOSS_RULE.z) {
  if (!(n > 0)) return { lo: 0, hi: 0 };
  const p = Math.min(1, Math.max(0, k) / n), z2 = z * z, d = 1 + z2 / n, c = p + z2 / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));
  return { lo: k <= 0 ? 0 : Math.max(0, (c - m) / d), hi: k >= n ? 1 : Math.min(1, (c + m) / d) };   // exact at the ends: none lost has a lower end of 0, all lost an upper end of 1
}
export function lossLevel(loss, lost, sent) { if (!(loss > 0)) return 0; return lost > 0 && wilsonLower(lost, sent) > LOSS_RULE.above ? 2 : 1; }   // 0 none observed, 1 observed, 2 elevated
export function elevatedFrom(sent) { for (let k = 1; k <= sent; k++) if (wilsonLower(k, sent) > LOSS_RULE.above) return k; return null; }
export const LOSS_NAMES = ['none observed', 'observed', 'elevated'];

export const rttBand = (rtt) => (rtt === null ? 3 : rtt <= 50 ? 0 : rtt <= 150 ? 1 : rtt <= 250 ? 2 : 3);
export const BAND_LABELS = ['up to 50 ms', '51 to 150 ms', '151 to 250 ms', 'over 250 ms'];

const r1 = (x) => Math.round(x * 10) / 10;
// The class list of a connection line: one place decides how loss, round-trip time and selection look. state: { sel, hl, dim }.
export const arcClass = (row, state = {}) => `arc b${rttBand(row.rtt)} l${row.lossLevel}` + (state.sel ? ' sel' : '') + (state.hl ? ' hl' : '') + (state.dim ? ' dim' : '');
// The second signal for loss: a diamond (observed) or an upward triangle (elevated), centred on (x, y), u = user units per CSS pixel.
export const lossMarkPath = (x, y, u, level) => (level === 2 ? `M${r1(x)} ${r1(y - 5.5 * u)}l${r1(5.5 * u)} ${r1(10 * u)}${r1(-11 * u)} 0z` : `M${r1(x)} ${r1(y - 4 * u)}l${r1(4 * u)} ${r1(4 * u)}${r1(-4 * u)} ${r1(4 * u)}${r1(-4 * u)} ${r1(-4 * u)}z`);

/* ---- wording. Lines on a map or a globe join two measured places; they say nothing about the path packets take, and the page must never suggest they do. ---- */
export const LINE_NOTE = {
  map: 'Arcs join the two endpoints for display only. They are not routes or traceroutes.',
  globe: 'Lines join the two endpoints along the shortest distance on a sphere, for display only. They are not routes or traceroutes.'
};
export const LOSS_CAUTION = 'An elevated value describes this one window of measurements. It is not a diagnosis of network health.';
/* M2.2 wording. One direction per pair is what the data publishes; the matrix never shows, estimates or implies the other one. The distance chart's floor is physics, not a measurement. */
export const MATRIX_NOTE = 'Each cell is one pair, measured in one direction only. The arrow says which: → from the row to the column, ← from the column to the row. The opposite direction is not published, so it is not shown and not estimated; the empty half of the table is not missing data.';
export const FLOOR_NOTE = 'The dashed line is a physical floor, not a measurement: the round-trip time light would need in glass fibre over a straight line of that length (distance divided by 100 km per millisecond). Real packets do not travel along it.';
export const DISTANCE_NOTE = 'Distance is the shortest distance over the Earth’s surface between the two places. It says nothing about the way packets travel.';
export const SIM_DISTANCE_NOTE = 'Simulated round-trip times are generated from distance, so the near-straight band of points is an artefact of the simulation, not a property of the Internet.';
export const REAL_DISTANCE_NOTE = 'A point well above the floor means a longer way round, equipment, queuing or all of them. This data cannot say which.';
export const LOSS_LIST_NOTE = 'Only pairs with at least one lost packet are listed. Every other pair lost nothing in its window, which is not a guarantee about other times.';

// The legend as data: the page turns it into elements, and every swatch and band is also a filter button (group 'loss' or 'band', index idx; count = pairs it covers).
// view: 'map' | 'globe' | 'matrix' | 'distance' | 'loss'. counts: { loss: [n0, n1, n2], band: [n0, n1, n2, n3] }, optional.
const TITLES = {
  map: ['Line colour: packet loss in this window', 'Line style: round-trip time'], globe: ['Line colour: packet loss in this window', 'Line style: round-trip time'],
  matrix: ['Cell marker: packet loss in this window', 'Cell shade: round-trip time'], distance: ['Point colour and shape: packet loss in this window', 'Round-trip time (vertical axis)'], loss: ['Packet loss in this window', 'Round-trip time']
};
const VIEW_NOTES = { map: LINE_NOTE.map, globe: LINE_NOTE.globe };   // the matrix, chart and loss list carry their own notes inside the view
export function legendModel({ sim, sent, view = 'map', counts = null }) {
  const sims = sim ? ' (simulated)' : '', from = elevatedFrom(sent), out = [], t = TITLES[view] || TITLES.map, cnt = (g, i) => (counts && counts[g] ? counts[g][i] : undefined);
  out.push({ type: 'title', text: t[0] });
  out.push({ type: 'swatch', group: 'loss', idx: 0, count: cnt('loss', 0), line: 'l0', shape: null, text: ' none observed' }, { type: 'swatch', group: 'loss', idx: 1, count: cnt('loss', 1), line: 'l1', shape: 'dia', text: ` loss observed${sims}` }, { type: 'swatch', group: 'loss', idx: 2, count: cnt('loss', 2), line: 'l2', shape: 'tri', text: ` elevated loss${sims}` });
  out.push({ type: 'title', text: t[1] });
  BAND_LABELS.forEach((x, i) => out.push({ type: 'band', group: 'band', idx: i, count: cnt('band', i), band: i, text: ` ${x}` }));
  out.push({ type: 'note', text: 'Select an entry to hide or show those pairs in every view. Selecting it again brings them back.' });
  if (VIEW_NOTES[view]) out.push({ type: 'note', text: VIEW_NOTES[view] });
  out.push({ type: 'note', text: `Cyan means no packet was lost in this one window of ${sent} packets. It does not mean the path is healthy at other times. Elevated means loss above 1% with 95% confidence${from ? ` (${from} or more of ${sent} lost)` : ''}; the Provenance tab explains the rule.` });
  out.push({ type: 'note', text: LOSS_CAUTION });
  return out;
}
