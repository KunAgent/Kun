// Append-only asset call log for tracking Hub asset interactions per evolution run.
// Log file: {evolution_dir}/asset_call_log.jsonl

const fs = require('fs');
const path = require('path');
const { getEvolutionDir } = require('./paths');

function getLogPath() {
  return path.join(getEvolutionDir(), 'asset_call_log.jsonl');
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Append a single asset call record to the log.
 *
 * @param {object} entry
 * @param {string} entry.run_id
 * @param {string} entry.action - hub_search_hit | hub_search_miss | asset_reuse | asset_reference | asset_publish | asset_publish_skip
 * @param {string} [entry.asset_id]
 * @param {string} [entry.asset_type]
 * @param {string} [entry.source_node_id]
 * @param {string} [entry.chain_id]
 * @param {number} [entry.score]
 * @param {string} [entry.mode] - direct | reference
 * @param {string[]} [entry.signals]
 * @param {string} [entry.reason]
 * @param {object} [entry.extra]
 */
function logAssetCall(entry) {
  if (!entry || typeof entry !== 'object') return;
  try {
    const logPath = getLogPath();
    ensureDir(logPath);
    const record = {
      timestamp: new Date().toISOString(),
      ...entry,
    };
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n', 'utf8');
  } catch (e) {
    // Non-fatal: never block evolution for logging failure
  }
}

/**
 * Read asset call log entries with optional filters.
 *
 * @param {object} [opts]
 * @param {string} [opts.run_id] - filter by run_id
 * @param {string} [opts.action] - filter by action type
 * @param {number} [opts.last] - only return last N entries
 * @param {string} [opts.since] - ISO date string, only entries after this time
 * @returns {object[]}
 */
function readCallLog(opts) {
  const o = opts || {};
  const logPath = getLogPath();
  if (!fs.existsSync(logPath)) return [];

  const raw = fs.readFileSync(logPath, 'utf8');
  const lines = raw.split('\n').filter(Boolean);

  let entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch (e) { /* skip corrupt lines */ }
  }

  if (o.since) {
    const sinceTs = new Date(o.since).getTime();
    if (Number.isFinite(sinceTs)) {
      entries = entries.filter(e => new Date(e.timestamp).getTime() >= sinceTs);
    }
  }

  if (o.run_id) {
    entries = entries.filter(e => e.run_id === o.run_id);
  }

  if (o.action) {
    entries = entries.filter(e => e.action === o.action);
  }

  if (o.last && Number.isFinite(o.last) && o.last > 0) {
    entries = entries.slice(-o.last);
  }

  return entries;
}

/**
 * Summarize asset call log (for CLI display).
 *
 * @param {object} [opts] - same filters as readCallLog
 * @returns {object} summary with totals and per-action counts
 */
function summarizeCallLog(opts) {
  const entries = readCallLog(opts);
  const actionCounts = {};
  const assetsSeen = new Set();
  const runsSeen = new Set();

  for (const e of entries) {
    const a = e.action || 'unknown';
    actionCounts[a] = (actionCounts[a] || 0) + 1;
    if (e.asset_id) assetsSeen.add(e.asset_id);
    if (e.run_id) runsSeen.add(e.run_id);
  }

  return {
    total_entries: entries.length,
    unique_assets: assetsSeen.size,
    unique_runs: runsSeen.size,
    by_action: actionCounts,
    entries,
  };
}

module.exports = {
  logAssetCall,
  readCallLog,
  summarizeCallLog,
  getLogPath,
};
