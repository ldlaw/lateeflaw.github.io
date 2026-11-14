/* internet-control.js: the control-plane monitor for the Internet Intelligence surfaces (milestone M3).
   One small module with no DOM access and no network code of its own: the page injects fetchControl(), the clock and the timers, so every rule below is
   tested with a virtual clock. It only DECIDES whether a surface may show data; the page obeys it. Only data is read; nothing fetched is executed.

   Rules (the defaults are the parameters approved in Gate 3A, D4):
   RECHECK   While the tab is visible the control document is re-checked every 60 s, jittered by +-25% (45 to 75 s), never more than once per 15 s whatever
             triggered it. A hidden tab does not poll. Becoming visible, focus, pageshow (including a restore from the back-forward cache), resume and online
             trigger a check if the last one is older than 15 s. The document may carry recheck_s (clamped to 30..600 s, and never more than 40% of the lease).
   LEASE     Data may be shown only while now < lastConfirmed + 10 min (or the document's own expiry, whichever is earlier). A valid, fresh, enabled response
             renews it. When it lapses the surface closes: "unreachable" if checks were failing, otherwise "expired" (the tab slept, was hidden, or lost its timers).
             The lease is judged against the wall clock whenever anything runs, so a throttled timer or a sleeping laptop cannot extend it. A clock that moves
             backwards closes the surface too.
   EXPIRY    A valid control document older than 24 h, or past its own expires_at (the publisher cannot ask for more than 24 h), is "expired", not enabled.
             A document dated more than 5 min in the future means the device clock is unreliable: the age cap is skipped and only the lease bounds trust.
   STALE     An ENABLED document older than one this tab has already seen is a stale copy: ignored, never renews the lease. A DISABLING document is always
             honoured, even if older (fail closed).
   FAIL      Off, unpublished (403, 404, 410), invalid JSON, wrong schema or major version: closed at once. Network error, timeout, 5xx, 429: the last good state
             stands until the lease lapses; an unreachable control is never treated as enabled for longer than the lease.
   RESTORE   After a closed state a surface re-opens only after fresh, valid, explicitly enabled responses: 2 of them at least 30 s apart (1 after a pure lease
             lapse with no failures, 1 on a first visit when the control was merely unreachable). After an explicit off the enabling document must also have a
             NEWER updated_at than the one that closed it. Any bad response resets the count, so flapping never re-opens. Checks continue while closed. */

export const DEFAULTS = Object.freeze({
  recheckMs: 60000, jitter: 0.25, minGapMs: 15000, timeoutMs: 6000, leaseMs: 600000, maxControlAgeMs: 86400000, skewMs: 300000,
  restoreConfirmations: 2, restoreGapMs: 30000, recheckMinMs: 30000, recheckMaxMs: 600000, logMax: 40
});
const LIMITS = { recheckMs: [200, 3600000], jitter: [0, 0.5], minGapMs: [0, 600000], timeoutMs: [200, 60000], leaseMs: [1000, 3600000], maxControlAgeMs: [1000, 172800000], skewMs: [0, 86400000],
  restoreConfirmations: [1, 5], restoreGapMs: [0, 600000], recheckMinMs: [100, 600000], recheckMaxMs: [1000, 3600000], logMax: [5, 200] };
export function resolveConfig(over = {}) {   // anything outside its limits falls back to the default; the page only passes overrides on localhost
  const out = { ...DEFAULTS };
  for (const k of Object.keys(LIMITS)) { const v = over[k]; if (typeof v === 'number' && Number.isFinite(v) && v >= LIMITS[k][0] && v <= LIMITS[k][1]) out[k] = v; }
  return Object.freeze(out);
}

const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
export const parseTs = (s) => (typeof s === 'string' && TS.test(s) ? Date.parse(s) : NaN);
export function validControl(c, surface = 'dashboard') {
  return !!c && typeof c === 'object' && c.schema === 'lateeflaw.internet-control' && /^1\.\d{1,3}$/.test(String(c.schema_version)) && typeof c.enabled === 'boolean' && !!c.surfaces && typeof c.surfaces === 'object'
    && typeof c.surfaces[surface] === 'boolean' && ['home', 'dashboard'].every((k) => c.surfaces[k] === undefined || typeof c.surfaces[k] === 'boolean') && Number.isFinite(parseTs(c.updated_at))
    && (c.reason === null || c.reason === undefined || (typeof c.reason === 'string' && c.reason.length <= 80 && !/[<>]/.test(c.reason)))
    && (c.expires_at === undefined || Number.isFinite(parseTs(c.expires_at))) && (c.recheck_s === undefined || (typeof c.recheck_s === 'number' && Number.isFinite(c.recheck_s) && c.recheck_s > 0 && c.recheck_s <= 86400));
}

// res: { status, json } | { status, invalid } | { status } | { error }. Pure: no state, no clock but the one passed in.
export function judgeResponse(res, { surface = 'dashboard', nowMs, maxUpdatedMs = 0, cfg = DEFAULTS }) {
  if (!res || res.error) return { kind: 'unreachable', why: 'The control document could not be reached (network error or timeout).' };
  if ([403, 404, 410].includes(res.status)) return { kind: 'off', cause: 'unpublished', why: `The control document is not published (HTTP ${res.status}), which counts as off.` };
  if (res.status !== 200) return { kind: 'unreachable', why: `The control document request failed (HTTP ${res.status}).` };
  if (res.invalid) return { kind: 'invalid', why: 'The control document is not valid JSON.' };
  const c = res.json; if (!validControl(c, surface)) return { kind: 'invalid', why: 'The control document does not have the expected structure or version.' };
  const updatedMs = parseTs(c.updated_at), reason = c.reason || null;
  if (!c.enabled || !c.surfaces[surface]) return { kind: 'off', cause: 'document', updatedMs, reason, why: c.enabled ? `The ${surface} surface is switched off in the control document.` : 'The control document says the data feature is switched off.' };
  const skew = updatedMs > nowMs + cfg.skewMs, own = c.expires_at !== undefined, expiresMs = Math.min(own ? parseTs(c.expires_at) : Infinity, updatedMs + cfg.maxControlAgeMs);
  if (!skew && nowMs >= expiresMs) return { kind: 'expired', cause: 'document', updatedMs, why: own && parseTs(c.expires_at) <= updatedMs + cfg.maxControlAgeMs ? 'The control document has passed its own expiry time.' : `The control document is older than ${Math.round(cfg.maxControlAgeMs / 3600000)} hours.` };
  if (updatedMs < maxUpdatedMs) return { kind: 'stale', updatedMs, why: 'An enabling control document older than one already seen (a stale copy) was ignored.' };
  const recheckMs = c.recheck_s !== undefined ? Math.min(cfg.recheckMaxMs, Math.max(cfg.recheckMinMs, c.recheck_s * 1000)) : null;
  return { kind: 'on', control: c, updatedMs, expiresMs, skew, recheckMs };
}

const fmtDur = (ms) => (ms < 60000 ? `${Math.round(ms / 1000)} s` : ms % 60000 === 0 ? `${ms / 60000} min` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);

export function createMonitor(opts) {
  const o = { surface: 'dashboard', cfg: DEFAULTS, now: () => Date.now(), setTimer: (f, ms) => setTimeout(f, ms), clearTimer: (h) => clearTimeout(h), random: () => Math.random(), visible: () => true, fetchControl: null, onChange: () => {}, ...opts };
  const cfg = resolveConfig(o.cfg);
  const S = { running: false, gen: 0, phase: 'starting', cause: null, why: null, reason: null, since: 0, lastCheckMs: 0, lastOkMs: 0, leaseDeadlineMs: 0, leaseCause: 'lease', failures: 0, streak: 0, streakAtMs: 0, need: 1, requireNewer: true, badUpdatedMs: 0, lastUpdatedMs: 0, maxUpdatedMs: 0,
    control: null, updatedMs: 0, expiresMs: 0, docRecheckMs: null, skew: false, nextCheckMs: null, checks: 0, inFlight: false, inFlightSince: 0, timer: null, leaseTimer: null, log: [], bad: null };
  const logEv = (kind, detail) => { S.log.push({ t: o.now(), kind, detail: detail || '' }); if (S.log.length > cfg.logMax) S.log.shift(); };
  const snapshot = () => ({ phase: S.phase, cause: S.cause, why: S.why, reason: S.reason, since: S.since, lastCheckMs: S.lastCheckMs, lastOkMs: S.lastOkMs, leaseDeadlineMs: S.phase === 'enabled' ? S.leaseDeadlineMs : null, failures: S.failures,
    streak: S.streak, need: S.need, nextCheckMs: S.nextCheckMs, checks: S.checks, control: S.control, updatedMs: S.updatedMs, expiresMs: S.expiresMs, recheckMs: S.docRecheckMs || cfg.recheckMs, skew: S.skew, paused: !o.visible(), inFlight: S.inFlight, log: S.log.slice(), cfg });
  const notify = (kind, detail) => { try { o.onChange(snapshot(), { kind, detail: detail || '' }); } catch (e) { /* a broken listener must not stop the monitor */ } };

  function clearLease() { o.clearTimer(S.leaseTimer); S.leaseTimer = null; }
  function armLease() {
    clearLease(); if (S.phase !== 'enabled') return;
    S.leaseTimer = o.setTimer(() => { S.leaseTimer = null; if (evaluateLease(o.now())) { schedule(); } }, Math.max(0, S.leaseDeadlineMs - o.now()) + 1);
  }
  function enterBad(phase, cause, why, t, x) {
    const was = S.phase; S.phase = phase; S.cause = cause; S.why = why; S.reason = x.reason || null; clearLease(); S.streak = 0; S.need = x.need; S.requireNewer = x.requireNewer; S.badUpdatedMs = x.updatedMs || 0;
    S.bad = { phase, cause, why, reason: S.reason }; if (was !== phase) { S.since = t; logEv(phase, why); notify(phase, why); }
  }
  function renew(r, t) {
    S.lastOkMs = t; S.control = r.control; S.updatedMs = r.updatedMs; S.lastUpdatedMs = r.updatedMs; S.expiresMs = r.expiresMs; S.docRecheckMs = r.recheckMs; S.skew = r.skew;
    S.leaseDeadlineMs = Math.min(t + cfg.leaseMs, r.expiresMs); S.leaseCause = r.expiresMs < t + cfg.leaseMs ? 'document' : 'lease'; armLease();
  }
  function enable(r, t, how) {
    const was = S.phase; S.phase = 'enabled'; S.cause = null; S.why = null; S.reason = null; S.bad = null; S.streak = 0; S.failures = 0; S.since = t; renew(r, t);
    logEv(how, how === 'restored' ? `fresh, valid and enabled; confirmed ${S.need} time${S.need > 1 ? 's' : ''}` : 'control document is valid and enabled'); notify(how); return was;
  }
  function evaluateLease(t) {   // true if the surface was closed just now
    if (S.phase !== 'enabled') return false;
    const backwards = t < S.lastOkMs || t < S.lastCheckMs - 1000; if (!backwards && t < S.leaseDeadlineMs) return false;
    if (!backwards && S.leaseCause === 'document') { enterBad('expired', 'document', 'The control document passed its expiry time and was not replaced.', t, { need: cfg.restoreConfirmations, requireNewer: true, updatedMs: S.updatedMs }); return true; }
    const failed = S.failures > 0;
    enterBad(failed ? 'unreachable' : 'expired', backwards ? 'clock' : 'lease', backwards ? 'The device clock moved backwards, so the lease cannot be trusted.' : failed ? `No confirmation within the ${fmtDur(cfg.leaseMs)} lease; the last ${S.failures} check${S.failures > 1 ? 's' : ''} failed.` : `No confirmation within the ${fmtDur(cfg.leaseMs)} lease (the tab was hidden, asleep or offline).`,
      t, { need: failed || backwards ? cfg.restoreConfirmations : 1, requireNewer: false, updatedMs: S.lastUpdatedMs });
    return true;
  }
  function revertToBad(t, why) { S.streak = 0; if (S.bad) { S.phase = S.bad.phase; S.cause = S.bad.cause; S.why = S.bad.why; S.reason = S.bad.reason; } logEv('restore-reset', why); notify('restore-reset', why); }

  function apply(r, t) {
    if (r.kind === 'unreachable') {
      S.failures++; logEv('check-failed', r.why);
      if (S.phase === 'enabled') evaluateLease(t);
      else if (S.phase === 'starting') enterBad('unreachable', 'startup', r.why, t, { need: 1, requireNewer: false, updatedMs: 0 });
      else if (S.phase === 'restoring') revertToBad(t, r.why);
      return;
    }
    if (r.kind === 'stale') { logEv('stale-ignored', r.why); if (S.phase === 'enabled') evaluateLease(t); return; }
    if (r.updatedMs) S.maxUpdatedMs = Math.max(S.maxUpdatedMs, r.updatedMs);
    const hadFailures = S.failures; S.failures = 0;
    if (r.kind === 'off') return enterBad('disabled', r.cause, r.why, t, { reason: r.reason, need: cfg.restoreConfirmations, requireNewer: true, updatedMs: r.updatedMs });
    if (r.kind === 'invalid') return enterBad('invalid', null, r.why, t, { need: cfg.restoreConfirmations, requireNewer: false, updatedMs: S.maxUpdatedMs });
    if (r.kind === 'expired') return enterBad('expired', 'document', r.why, t, { need: cfg.restoreConfirmations, requireNewer: true, updatedMs: r.updatedMs });
    // r.kind === 'on'
    if (S.phase === 'enabled') { renew(r, t); if (hadFailures) logEv('confirmed', `confirmed again after ${hadFailures} failed check${hadFailures > 1 ? 's' : ''}`); return; }
    if (S.phase === 'starting') { enable(r, t, 'enabled'); return; }
    const newer = S.requireNewer ? r.updatedMs > S.badUpdatedMs : r.updatedMs >= S.badUpdatedMs;
    if (!newer) { logEv('stale-ignored', 'an enabling document that is not newer than the one that closed the surface was ignored'); notify('stale-ignored'); return; }
    if (S.streak === 0 || t - S.streakAtMs >= cfg.restoreGapMs) { S.streak++; S.streakAtMs = t; }
    if (S.streak >= S.need) { enable(r, t, 'restored'); return; }
    S.phase = 'restoring'; S.cause = null; S.why = `Confirmation ${S.streak} of ${S.need}; the next one counts after ${fmtDur(cfg.restoreGapMs)}.`; S.control = r.control; logEv('restoring', S.why); notify('restoring', S.why);
  }

  function delayFor() {
    const t = o.now(); let d;
    if (S.phase === 'restoring') d = Math.max(cfg.restoreGapMs, cfg.minGapMs) * (1 + cfg.jitter * o.random());   // never earlier than the gap that makes the next confirmation count
    else d = Math.min(S.docRecheckMs || cfg.recheckMs, cfg.leaseMs * 0.4) * (1 + cfg.jitter * (2 * o.random() - 1));   // never more than 40% of the lease, so at least two attempts fit inside one
    return Math.max(Math.round(d), cfg.minGapMs - (t - S.lastCheckMs), 0);
  }
  function schedule(atMost) {   // atMost: an upper bound for the delay, used by wake() so a signal that arrives inside the minimum gap is answered when the gap ends
    o.clearTimer(S.timer); S.timer = null; if (!S.running || !o.visible()) { S.nextCheckMs = null; return; }
    const d = atMost === undefined ? delayFor() : Math.min(delayFor(), Math.max(atMost, 0)); S.nextCheckMs = o.now() + d; S.timer = o.setTimer(() => { S.timer = null; check('timer'); }, d);
  }
  async function check(trigger, { force = false } = {}) {
    if (!S.running) return; let t = o.now();
    if (S.inFlight) { if (t - S.inFlightSince > cfg.timeoutMs * 2) { S.inFlight = false; S.gen++; apply({ kind: 'unreachable', why: 'The control request never answered.' }, t); } else return; }   // a check that never answers is abandoned and counted as a failure
    if (!force && trigger !== 'timer' && S.lastCheckMs && t - S.lastCheckMs < cfg.minGapMs) { schedule(); return; }
    S.inFlight = true; S.inFlightSince = t; S.lastCheckMs = t; S.checks++; const gen = ++S.gen; schedule();   // arm the next check now, so a request that never answers cannot stall the monitor
    let res; try { res = await o.fetchControl(); } catch (e) { res = { error: String((e && e.name) || 'error') }; }
    if (!S.running || S.gen !== gen) return; S.inFlight = false; t = o.now(); evaluateLease(t);
    apply(judgeResponse(res, { surface: o.surface, nowMs: t, maxUpdatedMs: S.maxUpdatedMs, cfg }), t); schedule(); notify('check');
  }
  function wake(trigger) {   // anything that proves the tab is alive again: judge the lease against the wall clock first, then check if due
    if (!S.running) return; const t = o.now(), closed = evaluateLease(t);
    if (closed) logEv('lapsed-on-wake', trigger);
    if (!S.lastCheckMs || t - S.lastCheckMs >= cfg.minGapMs) check(trigger);
    else {   // inside the minimum gap. Closed or failing: check as soon as the gap allows instead of waiting a whole interval. Healthy, restoring or a request in flight: as before.
      const soon = !S.inFlight && (S.failures > 0 || (S.phase !== 'enabled' && S.phase !== 'restoring'));
      schedule(soon ? cfg.minGapMs - (t - S.lastCheckMs) : undefined); if (closed) notify('lapsed');
    }
  }
  return {
    start() { if (S.running) return; S.running = true; S.since = o.now(); logEv('start', `surface ${o.surface}, interval ${fmtDur(cfg.recheckMs)}, lease ${fmtDur(cfg.leaseMs)}`); return check('start', { force: true }); },
    stop() { S.running = false; o.clearTimer(S.timer); o.clearTimer(S.leaseTimer); S.timer = S.leaseTimer = null; },
    checkNow(trigger = 'manual') { return check(trigger, { force: true }); },
    visibilityChanged() { if (!S.running) return; const vis = o.visible(); logEv(vis ? 'visible' : 'hidden', vis ? 'polling resumes' : 'polling paused'); if (!vis) { o.clearTimer(S.timer); S.timer = null; S.nextCheckMs = null; notify('hidden'); } else wake('visible'); },
    nudge(trigger) { if (o.visible()) wake(trigger); },
    judgeLease() { const closed = evaluateLease(o.now()); if (closed) { schedule(); notify('lapsed'); } return closed; },
    allowData: () => S.phase === 'enabled', snapshot, config: cfg
  };
}

// Browser wiring: every signal that a tab is alive again. Returns a function that removes the listeners.
export function watchPage(monitor, win, doc) {
  const on = (t, ev, fn) => { t.addEventListener(ev, fn); return () => t.removeEventListener(ev, fn); };
  const off = [on(doc, 'visibilitychange', () => monitor.visibilityChanged()), on(win, 'focus', () => monitor.nudge('focus')), on(win, 'pageshow', () => monitor.nudge('pageshow')), on(win, 'online', () => monitor.nudge('online')), on(doc, 'resume', () => monitor.nudge('resume'))];
  return () => off.forEach((f) => f());
}
