const fs = require('fs');
const { appendEventJsonl } = require('../src/gep/assetStore');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function readTextIfExists(p) {
  try {
    if (!p) return '';
    if (!fs.existsSync(p)) return '';
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function parseInput(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  // Accept JSON array or single JSON.
  try {
    const maybe = JSON.parse(raw);
    if (Array.isArray(maybe)) return maybe;
    if (maybe && typeof maybe === 'object') return [maybe];
  } catch (e) {}

  // Fallback: JSONL.
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      out.push(obj);
    } catch (e) {}
  }
  return out;
}

function isValidEvolutionEvent(ev) {
  if (!ev || ev.type !== 'EvolutionEvent') return false;
  if (!ev.id || typeof ev.id !== 'string') return false;
  // parent may be null or string
  if (!(ev.parent === null || typeof ev.parent === 'string')) return false;
  if (!ev.intent || typeof ev.intent !== 'string') return false;
  if (!Array.isArray(ev.signals)) return false;
  if (!Array.isArray(ev.genes_used)) return false;
  // GEP v1.4: mutation + personality are mandatory evolution dimensions
  if (!ev.mutation_id || typeof ev.mutation_id !== 'string') return false;
  if (!ev.personality_state || typeof ev.personality_state !== 'object') return false;
  if (ev.personality_state.type !== 'PersonalityState') return false;
  for (const k of ['rigor', 'creativity', 'verbosity', 'risk_tolerance', 'obedience']) {
    const v = Number(ev.personality_state[k]);
    if (!Number.isFinite(v) || v < 0 || v > 1) return false;
  }
  if (!ev.blast_radius || typeof ev.blast_radius !== 'object') return false;
  if (!Number.isFinite(Number(ev.blast_radius.files))) return false;
  if (!Number.isFinite(Number(ev.blast_radius.lines))) return false;
  if (!ev.outcome || typeof ev.outcome !== 'object') return false;
  if (!ev.outcome.status || typeof ev.outcome.status !== 'string') return false;
  const score = Number(ev.outcome.score);
  if (!Number.isFinite(score) || score < 0 || score > 1) return false;

  // capsule_id is optional, but if present must be string or null.
  if (!('capsule_id' in ev)) return true;
  return ev.capsule_id === null || typeof ev.capsule_id === 'string';
}

function main() {
  const args = process.argv.slice(2);
  const inputPath = args.find(a => a && !a.startsWith('--')) || '';
  const text = inputPath ? readTextIfExists(inputPath) : readStdin();
  const items = parseInput(text);

  let appended = 0;
  for (const it of items) {
    if (!isValidEvolutionEvent(it)) continue;
    appendEventJsonl(it);
    appended += 1;
  }

  process.stdout.write(`appended=${appended}\n`);
}

try {
  main();
} catch (e) {
  process.stderr.write(`${e && e.message ? e.message : String(e)}\n`);
  process.exit(1);
}

