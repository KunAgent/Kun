// ---------------------------------------------------------------------------
// MemoryGraphAdapter -- stable interface boundary for memory graph operations.
//
// Default implementation delegates to the local JSONL-based memoryGraph.js.
// SaaS providers can supply a remote adapter by setting MEMORY_GRAPH_PROVIDER=remote
// and configuring MEMORY_GRAPH_REMOTE_URL / MEMORY_GRAPH_REMOTE_KEY.
//
// The adapter is designed so that the open-source evolver always works offline
// with the local implementation. Remote is optional and degrades gracefully.
// ---------------------------------------------------------------------------

const localGraph = require('./memoryGraph');

// ---------------------------------------------------------------------------
// Adapter interface contract (all methods must be implemented by providers):
//
//   getAdvice({ signals, genes, driftEnabled }) => { preferredGeneId, bannedGeneIds, currentSignalKey, explanation }
//   recordSignalSnapshot({ signals, observations }) => event
//   recordHypothesis({ signals, mutation, personality_state, selectedGene, selector, driftEnabled, selectedBy, capsulesUsed, observations }) => { hypothesisId, signalKey }
//   recordAttempt({ signals, mutation, personality_state, selectedGene, selector, driftEnabled, selectedBy, hypothesisId, capsulesUsed, observations }) => { actionId, signalKey }
//   recordOutcome({ signals, observations }) => event | null
//   recordExternalCandidate({ asset, source, signals }) => event | null
//   memoryGraphPath() => string
//   computeSignalKey(signals) => string
//   tryReadMemoryGraphEvents(limit) => event[]
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Local adapter (default) -- wraps memoryGraph.js without any behavior change
// ---------------------------------------------------------------------------

const localAdapter = {
  name: 'local',

  getAdvice(opts) {
    return localGraph.getMemoryAdvice(opts);
  },

  recordSignalSnapshot(opts) {
    return localGraph.recordSignalSnapshot(opts);
  },

  recordHypothesis(opts) {
    return localGraph.recordHypothesis(opts);
  },

  recordAttempt(opts) {
    return localGraph.recordAttempt(opts);
  },

  recordOutcome(opts) {
    return localGraph.recordOutcomeFromState(opts);
  },

  recordExternalCandidate(opts) {
    return localGraph.recordExternalCandidate(opts);
  },

  memoryGraphPath() {
    return localGraph.memoryGraphPath();
  },

  computeSignalKey(signals) {
    return localGraph.computeSignalKey(signals);
  },

  tryReadMemoryGraphEvents(limit) {
    return localGraph.tryReadMemoryGraphEvents(limit);
  },
};

// ---------------------------------------------------------------------------
// Remote adapter (SaaS) -- calls external KG service with local fallback
// ---------------------------------------------------------------------------

function buildRemoteAdapter() {
  const remoteUrl = process.env.MEMORY_GRAPH_REMOTE_URL || '';
  const remoteKey = process.env.MEMORY_GRAPH_REMOTE_KEY || '';
  const timeoutMs = Number(process.env.MEMORY_GRAPH_REMOTE_TIMEOUT_MS) || 5000;

  async function remoteCall(endpoint, body) {
    if (!remoteUrl) throw new Error('MEMORY_GRAPH_REMOTE_URL not configured');
    const url = `${remoteUrl.replace(/\/+$/, '')}${endpoint}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(remoteKey ? { Authorization: `Bearer ${remoteKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`remote_kg_error: ${res.status}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // Wrap remote call with local fallback -- ensures offline resilience.
  function withFallback(localFn, remoteFn) {
    return async function (...args) {
      try {
        return await remoteFn(...args);
      } catch (e) {
        // Fallback to local on any remote failure (network, timeout, config).
        return localFn(...args);
      }
    };
  }

  return {
    name: 'remote',

    // getAdvice is the primary candidate for remote enhancement (richer graph reasoning).
    getAdvice: withFallback(
      (opts) => localGraph.getMemoryAdvice(opts),
      async (opts) => {
        const result = await remoteCall('/kg/advice', {
          signals: opts.signals,
          genes: (opts.genes || []).map((g) => ({ id: g.id, category: g.category, type: g.type })),
          driftEnabled: opts.driftEnabled,
        });
        // Normalize remote response to match local contract.
        return {
          currentSignalKey: result.currentSignalKey || localGraph.computeSignalKey(opts.signals),
          preferredGeneId: result.preferredGeneId || null,
          bannedGeneIds: new Set(result.bannedGeneIds || []),
          explanation: Array.isArray(result.explanation) ? result.explanation : [],
        };
      }
    ),

    // Write operations: always write locally first, then async-sync to remote.
    // This preserves the append-only local graph as source of truth.
    recordSignalSnapshot(opts) {
      const ev = localGraph.recordSignalSnapshot(opts);
      remoteCall('/kg/ingest', { kind: 'signal', event: ev }).catch(() => {});
      return ev;
    },

    recordHypothesis(opts) {
      const result = localGraph.recordHypothesis(opts);
      remoteCall('/kg/ingest', { kind: 'hypothesis', event: result }).catch(() => {});
      return result;
    },

    recordAttempt(opts) {
      const result = localGraph.recordAttempt(opts);
      remoteCall('/kg/ingest', { kind: 'attempt', event: result }).catch(() => {});
      return result;
    },

    recordOutcome(opts) {
      const ev = localGraph.recordOutcomeFromState(opts);
      if (ev) {
        remoteCall('/kg/ingest', { kind: 'outcome', event: ev }).catch(() => {});
      }
      return ev;
    },

    recordExternalCandidate(opts) {
      const ev = localGraph.recordExternalCandidate(opts);
      if (ev) {
        remoteCall('/kg/ingest', { kind: 'external_candidate', event: ev }).catch(() => {});
      }
      return ev;
    },

    memoryGraphPath() {
      return localGraph.memoryGraphPath();
    },

    computeSignalKey(signals) {
      return localGraph.computeSignalKey(signals);
    },

    tryReadMemoryGraphEvents(limit) {
      return localGraph.tryReadMemoryGraphEvents(limit);
    },
  };
}

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

function resolveAdapter() {
  const provider = (process.env.MEMORY_GRAPH_PROVIDER || 'local').toLowerCase().trim();
  if (provider === 'remote') {
    return buildRemoteAdapter();
  }
  return localAdapter;
}

const adapter = resolveAdapter();

module.exports = adapter;
