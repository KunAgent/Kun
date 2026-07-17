// ---------------------------------------------------------------------------
// directoryClient -- Agent capability directory API client.
// Provides semantic and keyword search for discovering agents, and
// fetches agent profiles including skills, reputation, and load status.
// ---------------------------------------------------------------------------

const { getNodeId, buildHubHeaders } = require('./a2aProtocol');

const HUB_URL = process.env.A2A_HUB_URL || process.env.EVOMAP_HUB_URL || 'https://evomap.ai';
const DIRECTORY_TIMEOUT_MS = 8000;

/**
 * Search agents by natural language query (semantic search).
 * @param {string} query - free-text query (e.g. "machine learning")
 * @param {{ limit?: number }} [opts]
 * @returns {Array<{ nodeId: string, score: number, domains: string[], reputation: number }> | null}
 */
async function searchByQuery(query, opts) {
  if (!query) return null;
  try {
    const params = new URLSearchParams({ q: query });
    if (opts?.limit) params.set('limit', String(opts.limit));

    const url = `${HUB_URL.replace(/\/+$/, '')}/a2a/directory/search?${params}`;
    const res = await fetch(url, {
      headers: buildHubHeaders(),
      signal: AbortSignal.timeout(DIRECTORY_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.results || data;
  } catch (err) {
    console.warn('[DirectoryClient] searchByQuery failed:', err?.message || err);
    return null;
  }
}

/**
 * Search agents by signal keywords.
 * @param {string[]} signals - keyword array (e.g. ["ml", "nlp"])
 * @param {{ limit?: number }} [opts]
 * @returns {Array | null}
 */
async function searchBySignals(signals, opts) {
  if (!Array.isArray(signals) || signals.length === 0) return null;
  try {
    const params = new URLSearchParams({ signals: signals.join(',') });
    if (opts?.limit) params.set('limit', String(opts.limit));

    const url = `${HUB_URL.replace(/\/+$/, '')}/a2a/directory/search?${params}`;
    const res = await fetch(url, {
      headers: buildHubHeaders(),
      signal: AbortSignal.timeout(DIRECTORY_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.results || data;
  } catch (err) {
    console.warn('[DirectoryClient] searchBySignals failed:', err?.message || err);
    return null;
  }
}

/**
 * Get a specific agent's profile.
 * @param {string} nodeId
 * @returns {{ nodeId: string, domains: string[], modelType: string, reputation: number, completedTasks: number, currentLoad: number, online: boolean } | null}
 */
async function getAgentProfile(nodeId) {
  if (!nodeId) return null;
  try {
    const url = `${HUB_URL.replace(/\/+$/, '')}/a2a/directory/profile/${encodeURIComponent(nodeId)}`;
    const res = await fetch(url, {
      headers: buildHubHeaders(),
      signal: AbortSignal.timeout(DIRECTORY_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn('[DirectoryClient] getAgentProfile failed:', err?.message || err);
    return null;
  }
}

/**
 * Discover agents relevant to a task (combines semantic + signal search).
 * @param {object} task - task object with .title and .signals
 * @param {{ limit?: number }} [opts]
 * @returns {Array | null}
 */
async function discoverForTask(task, opts) {
  if (!task) return null;
  const signals = (task.signals || '').split(',').map(s => s.trim()).filter(Boolean);
  const query = task.title || '';

  if (query) {
    return searchByQuery(query, opts);
  }
  if (signals.length > 0) {
    return searchBySignals(signals, opts);
  }
  return null;
}

module.exports = {
  searchByQuery,
  searchBySignals,
  getAgentProfile,
  discoverForTask,
};
