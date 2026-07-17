const fs = require('fs');
const path = require('path');
const { getRepoRoot, getMemoryDir, getGepAssetsDir } = require('../src/gep/paths');
const { normalizePersonalityState, personalityKey, defaultPersonalityState } = require('../src/gep/personality');

function readJsonIfExists(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    const raw = fs.readFileSync(p, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function readJsonlIfExists(p, limitLines = 5000) {
  try {
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, 'utf8');
    const lines = raw
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
    const recent = lines.slice(Math.max(0, lines.length - limitLines));
    return recent
      .map(l => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function pct(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return '0.0%';
  return `${(n * 100).toFixed(1)}%`;
}

function pad(s, n) {
  const str = String(s == null ? '' : s);
  if (str.length >= n) return str.slice(0, n);
  return str + ' '.repeat(n - str.length);
}

function scoreFromCounts(success, fail, avgScore) {
  const succ = Number(success) || 0;
  const fl = Number(fail) || 0;
  const total = succ + fl;
  const p = (succ + 1) / (total + 2); // Laplace smoothing
  const sampleWeight = Math.min(1, total / 8);
  const q = avgScore == null ? 0.5 : clamp01(avgScore);
  return p * 0.75 + q * 0.25 * sampleWeight;
}

function aggregateFromEvents(events) {
  const map = new Map();
  for (const ev of Array.isArray(events) ? events : []) {
    if (!ev || ev.type !== 'EvolutionEvent') continue;
    const ps = ev.personality_state && typeof ev.personality_state === 'object' ? ev.personality_state : null;
    if (!ps) continue;
    const key = personalityKey(normalizePersonalityState(ps));
    const cur = map.get(key) || {
      key,
      success: 0,
      fail: 0,
      n: 0,
      avg_score: 0.5,
      last_event_id: null,
      last_at: null,
      mutation: { repair: 0, optimize: 0, innovate: 0 },
      mutation_success: { repair: 0, optimize: 0, innovate: 0 },
    };
    const st = ev.outcome && ev.outcome.status ? String(ev.outcome.status) : 'unknown';
    if (st === 'success') cur.success += 1;
    else if (st === 'failed') cur.fail += 1;

    const sc = ev.outcome && Number.isFinite(Number(ev.outcome.score)) ? clamp01(Number(ev.outcome.score)) : null;
    if (sc != null) {
      cur.n += 1;
      cur.avg_score = cur.avg_score + (sc - cur.avg_score) / cur.n;
    }

    const cat = ev.intent ? String(ev.intent) : null;
    if (cat && cur.mutation[cat] != null) {
      cur.mutation[cat] += 1;
      if (st === 'success') cur.mutation_success[cat] += 1;
    }

    cur.last_event_id = ev.id || cur.last_event_id;
    const at = ev.meta && ev.meta.at ? String(ev.meta.at) : null;
    cur.last_at = at || cur.last_at;
    map.set(key, cur);
  }
  return Array.from(map.values());
}

function main() {
  const repoRoot = getRepoRoot();
  const memoryDir = getMemoryDir();
  const assetsDir = getGepAssetsDir();

  const personalityPath = path.join(memoryDir, 'personality_state.json');
  const model = readJsonIfExists(personalityPath, null);
  const current = model && model.current ? normalizePersonalityState(model.current) : defaultPersonalityState();
  const currentKey = personalityKey(current);

  const eventsPath = path.join(assetsDir, 'events.jsonl');
  const events = readJsonlIfExists(eventsPath, 10000);
  const evs = events.filter(e => e && e.type === 'EvolutionEvent');
  const agg = aggregateFromEvents(evs);

  // Prefer model.stats if present, but still show event-derived aggregation (ground truth).
  const stats = model && model.stats && typeof model.stats === 'object' ? model.stats : {};
  const statRows = Object.entries(stats).map(([key, e]) => {
    const entry = e && typeof e === 'object' ? e : {};
    const success = Number(entry.success) || 0;
    const fail = Number(entry.fail) || 0;
    const total = success + fail;
    const avg = Number.isFinite(Number(entry.avg_score)) ? clamp01(Number(entry.avg_score)) : null;
    const score = scoreFromCounts(success, fail, avg);
    return { key, success, fail, total, avg_score: avg, score, updated_at: entry.updated_at || null, source: 'model' };
  });

  const evRows = agg.map(e => {
    const success = Number(e.success) || 0;
    const fail = Number(e.fail) || 0;
    const total = success + fail;
    const avg = Number.isFinite(Number(e.avg_score)) ? clamp01(Number(e.avg_score)) : null;
    const score = scoreFromCounts(success, fail, avg);
    return { key: e.key, success, fail, total, avg_score: avg, score, updated_at: e.last_at || null, source: 'events', _ev: e };
  });

  // Merge rows by key (events take precedence for total/success/fail; model provides updated_at if events missing).
  const byKey = new Map();
  for (const r of [...statRows, ...evRows]) {
    const prev = byKey.get(r.key);
    if (!prev) {
      byKey.set(r.key, r);
      continue;
    }
    // Prefer events for counts and avg_score
    if (r.source === 'events') byKey.set(r.key, { ...prev, ...r });
    else byKey.set(r.key, { ...r, ...prev });
  }

  const merged = Array.from(byKey.values()).sort((a, b) => b.score - a.score);

  process.stdout.write(`Repo: ${repoRoot}\n`);
  process.stdout.write(`MemoryDir: ${memoryDir}\n`);
  process.stdout.write(`AssetsDir: ${assetsDir}\n\n`);

  process.stdout.write(`[Current Personality]\n`);
  process.stdout.write(`${currentKey}\n`);
  process.stdout.write(`${JSON.stringify(current, null, 2)}\n\n`);

  process.stdout.write(`[Personality Stats] (ranked by score)\n`);
  if (merged.length === 0) {
    process.stdout.write('(no stats yet; run a few cycles and solidify)\n');
    return;
  }

  const header =
    pad('rank', 5) +
    pad('total', 8) +
    pad('succ', 8) +
    pad('fail', 8) +
    pad('succ_rate', 11) +
    pad('avg', 7) +
    pad('score', 8) +
    'key';
  process.stdout.write(header + '\n');
  process.stdout.write('-'.repeat(Math.min(140, header.length + 40)) + '\n');

  const topN = Math.min(25, merged.length);
  for (let i = 0; i < topN; i++) {
    const r = merged[i];
    const succ = Number(r.success) || 0;
    const fail = Number(r.fail) || 0;
    const total = Number(r.total) || succ + fail;
    const succRate = total > 0 ? succ / total : 0;
    const avg = r.avg_score == null ? '-' : Number(r.avg_score).toFixed(2);
    const line =
      pad(String(i + 1), 5) +
      pad(String(total), 8) +
      pad(String(succ), 8) +
      pad(String(fail), 8) +
      pad(pct(succRate), 11) +
      pad(String(avg), 7) +
      pad(Number(r.score).toFixed(3), 8) +
      String(r.key);
    process.stdout.write(line + '\n');

    if (r._ev) {
      const ev = r._ev;
      const ms = ev.mutation || {};
      const mSucc = ev.mutation_success || {};
      const parts = [];
      for (const cat of ['repair', 'optimize', 'innovate']) {
        const n = Number(ms[cat]) || 0;
        if (n <= 0) continue;
        const s = Number(mSucc[cat]) || 0;
        parts.push(`${cat}:${s}/${n}`);
      }
      if (parts.length) process.stdout.write(`       mutation_success: ${parts.join(' | ')}\n`);
    }
  }

  process.stdout.write('\n');
  process.stdout.write(`[Notes]\n`);
  process.stdout.write(`- score is a smoothed composite of success_rate + avg_score (sample-weighted)\n`);
  process.stdout.write(`- current_key appears in the ranking once enough data accumulates\n`);
}

try {
  main();
} catch (e) {
  process.stderr.write((e && e.message) || String(e));
  process.stderr.write('\n');
  process.exit(1);
}

