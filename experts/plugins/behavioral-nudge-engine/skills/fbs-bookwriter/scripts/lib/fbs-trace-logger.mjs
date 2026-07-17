/**
 * FBS 执行轨迹（JSONL，按日轮转，Hermes 式可审计最小集）
 * 写入：bookRoot/.fbs/audit/trace-YYYY-MM-DD.jsonl
 */
import fs from 'fs';
import path from 'path';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const TRACE_VERSION = 1;

function auditDir(bookRoot) {
  return path.join(path.resolve(bookRoot), '.fbs', 'audit');
}

function tracePath(bookRoot) {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return path.join(auditDir(bookRoot), `trace-${y}-${m}-${day}.jsonl`);
}

function sanitizePayload(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && v.length > 2000) out[k] = `${v.slice(0, 2000)}…`;
    else if (typeof v === 'object' && v !== null && !Array.isArray(v)) out[k] = sanitizePayload(v);
    else out[k] = v;
  }
  return out;
}

/**
 * @param {object} opts
 * @param {string} opts.bookRoot
 * @param {string} opts.event
 * @param {string} [opts.script]
 * @param {number} [opts.exitCode]
 * @param {string} [opts.skillRoot]
 * @param {Record<string, unknown>} [opts.payloadSummary]
 * @param {string} [opts.message]
 */
export function appendTraceEvent(opts) {
  const bookRoot = opts?.bookRoot;
  if (!bookRoot || !String(bookRoot).trim()) return;
  const resolved = path.resolve(String(bookRoot).trim());
  if (!fs.existsSync(resolved)) return;

  const dir = auditDir(resolved);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return;
  }

  const p = tracePath(resolved);
  try {
    if (fs.existsSync(p) && fs.statSync(p).size > MAX_FILE_BYTES) {
      return;
    }
  } catch {
    /* ignore */
  }

  const line = JSON.stringify({
    v: TRACE_VERSION,
    ts: new Date().toISOString(),
    event: opts.event || 'error',
    script: opts.script || null,
    exitCode: typeof opts.exitCode === 'number' ? opts.exitCode : null,
    skillRoot: opts.skillRoot ? path.resolve(opts.skillRoot) : null,
    bookRoot: resolved,
    payloadSummary: sanitizePayload(opts.payloadSummary || {}),
    message: opts.message ? String(opts.message).slice(0, 500) : undefined,
  });

  try {
    fs.appendFileSync(p, `${line}\n`, 'utf8');
  } catch {
    /* ignore disk errors */
  }
}
