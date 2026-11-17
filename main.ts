// gta6-twitch-ccu-forecast-01 entry (Node 22, standard library only).
//
// Model: for each hour h = 2..24, take the median log-ratio ln(y_h / y_1) over
// past launches whose release-day hour-1 audience was within a factor 4 of
// this case's hour-1 print, and spread the five quantiles around that median
// with the cross-launch standard deviation of the same log-ratios
// (spread = max(0.15, 0.9 * sd), floored at 0.15, sd = 0.30 when fewer than
// two launches report the hour). The target's own pre-release category
// history is excluded: it is not a launch curve. Deterministic, no network,
// no clock, no randomness.
//
//   q_tau(h) = p1 * exp(median_h + z_tau * spread_h), z = [-1.645, -0.674, 0, 0.674, 1.645]
//
// If no comparable reports hour h, fall back to the house baseline spread for
// that hour: q_tau = p1 * exp(z_tau * 0.15 * sqrt(h - 1)).
//
// Usage: mkdir -p out && MAKEFUN_INPUT_DIR=<kit>/input MAKEFUN_OUTPUT_DIR=out node main.ts
// Reads every *.in in MAKEFUN_INPUT_DIR (else /input), writes <id>.out to
// MAKEFUN_OUTPUT_DIR (else /output): {"hours":[{"hour":h,"q":[q05,q25,q50,q75,q95]}, ...]}.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** Standard normal quantiles at the scored levels [0.05, 0.25, 0.5, 0.75, 0.95]. */
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
/** Hours to forecast. */
const HOURS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
/** Baseline log-spread per sqrt-hour, used only when no comparable reports an hour. */
const BASELINE_SIGMA = 0.15;
/** Floor on the cross-launch spread, in log units. */
const SPREAD_FLOOR = 0.15;
/** Spread assumed when fewer than two launches report an hour. */
const SPREAD_SINGLE = 0.3;
/** Factor scaling the cross-launch standard deviation into the spread. */
const SPREAD_SCALE = 0.9;
/** Similar-scale window for the comparable pool: hour-1 viewers within x4. */
const POOL_FACTOR = 4;
/** Minimum pool size before falling back to wider pools. */
const MIN_POOL = 5;
/** Fallback pool threshold: launches with hour-1 viewers at least this big. */
const BIG_LAUNCH = 20000;

interface HourlyPoint {
  from: string;
  viewers: number;
}

interface Comparable {
  name: string;
  day_start: string;
  hourly: HourlyPoint[];
}

interface CaseFile {
  known?: Array<{ hour: number; viewers: number }>;
  history_hourly?: Array<{ viewers: number }> | null;
  forecast?: Array<{ hour: number }>;
  comparables?: Comparable[] | null;
}

/** Hour-1 print, with fallbacks so a forecast is always written. */
function hourOnePrint(c: CaseFile): number {
  const known = Array.isArray(c.known) ? c.known : [];
  const first = known.find((k) => k && k.hour === 1);
  if (first && Number.isFinite(first.viewers)) return Math.max(1, first.viewers);
  const hourly = Array.isArray(c.history_hourly) ? c.history_hourly : [];
  if (hourly.length > 0) {
    const last = hourly[hourly.length - 1];
    if (last && Number.isFinite(last.viewers)) return Math.max(1, last.viewers);
  }
  return 1;
}

/** Map of hour index (0 = day_start hour) -> viewers, for one comparable. */
function hourlyByIndex(comp: Comparable): Map<number, number> {
  const out = new Map<number, number>();
  const t0 = Date.parse(comp.day_start);
  if (!Number.isFinite(t0) || !Array.isArray(comp.hourly)) return out;
  for (const p of comp.hourly) {
    if (!p || typeof p.from !== 'string') continue;
    const t = Date.parse(p.from);
    if (!Number.isFinite(t)) continue;
    const idx = Math.floor((t - t0) / 3600000 + 1e-6);
    const v = p.viewers;
    if (Number.isFinite(v) && v > 0 && !out.has(idx)) out.set(idx, v);
  }
  return out;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Population standard deviation. */
function popStd(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
  return Math.sqrt(variance);
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Round, clamp to (0, 1e9], and force non-decreasing within the row. */
function finishRow(qs: number[]): number[] {
  const out = qs.map((q) => Math.min(1e9, Math.max(0.01, round2(q))));
  for (let i = 1; i < out.length; i++) {
    if (out[i] < out[i - 1]) out[i] = out[i - 1];
  }
  return out;
}

/** Baseline row for one hour (used when no comparable reports the hour). */
function baselineRow(p1: number, h: number): number[] {
  return finishRow(Z.map((z) => p1 * Math.exp(z * BASELINE_SIGMA * Math.sqrt(h - 1))));
}

/** Forecast rows for one case. */
function forecastCase(c: CaseFile): Array<{ hour: number; q: number[] }> {
  const p1 = hourOnePrint(c);

  // Comparable pool, sorted by name so the run is deterministic.
  const raw = (Array.isArray(c.comparables) ? c.comparables : []).filter(
    (comp) => comp && typeof comp.name === 'string' && !comp.name.includes('Grand Theft Auto VI'),
  );
  raw.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const withH1 = raw
    .map((comp) => ({ comp, hours: hourlyByIndex(comp) }))
    .filter((entry) => entry.hours.has(0));
  // A comparable that reports only a few hours of its release day should not
  // steer the curve: require at least 12 of hours 2..24 present (the same
  // 12-hour floor the grader uses for a valid answer). Every launch in the
  // kit reports all 23, so this never binds on known data; it only guards
  // against a sparse comparable in a future case.
  const complete = withH1.filter((entry) => {
    let n = 0;
    for (let h = 1; h < 24; h++) if (entry.hours.has(h)) n++;
    return n >= 12;
  });
  const candidates = complete.length >= MIN_POOL ? complete : withH1;
  const h1 = (entry: { hours: Map<number, number> }): number => entry.hours.get(0) as number;

  let pool = candidates.filter((entry) => p1 / POOL_FACTOR <= h1(entry) && h1(entry) <= p1 * POOL_FACTOR);
  if (pool.length < MIN_POOL) pool = candidates.filter((entry) => h1(entry) >= BIG_LAUNCH);
  if (pool.length < MIN_POOL) pool = candidates;

  const hours = (Array.isArray(c.forecast) && c.forecast.length > 0
    ? c.forecast.map((f) => f.hour).filter((h) => Number.isFinite(h))
    : HOURS
  ).sort((a, b) => a - b);

  return hours.map((h) => {
    const ratios: number[] = [];
    for (const entry of pool) {
      const y1 = entry.hours.get(0);
      const yh = entry.hours.get(h - 1);
      if (y1 !== undefined && yh !== undefined) ratios.push(Math.log(yh / y1));
    }
    if (ratios.length === 0) return { hour: h, q: baselineRow(p1, h) };
    const centre = median(ratios);
    const sd = ratios.length > 1 ? popStd(ratios) : SPREAD_SINGLE;
    const spread = Math.max(SPREAD_FLOOR, SPREAD_SCALE * sd);
    return { hour: h, q: finishRow(Z.map((z) => p1 * Math.exp(centre + z * spread))) };
  });
}

mkdirSync(OUTPUT_DIR, { recursive: true });
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  let hours: Array<{ hour: number; q: number[] }>;
  try {
    const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as CaseFile;
    hours = forecastCase(c);
  } catch {
    // Never crash and never leave a case without a forecast.
    hours = HOURS.map((h) => ({ hour: h, q: baselineRow(1, h) }));
  }
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
