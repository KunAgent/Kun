// GEP A2A Protocol - Standard message types and pluggable transport layer.
//
// Protocol messages:
//   hello    - capability advertisement and node discovery
//   publish  - broadcast an eligible asset (Capsule/Gene)
//   fetch    - request a specific asset by id or content hash
//   report   - send a ValidationReport for a received asset
//   decision - accept/reject/quarantine decision on a received asset
//   revoke   - withdraw a previously published asset
//
// Transport interface:
//   send(message, opts)    - send a protocol message
//   receive(opts)          - receive pending messages
//   list(opts)             - list available message files/streams
//
// Default transport: FileTransport (reads/writes JSONL to a2a/ directory).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getGepAssetsDir, getEvolverLogPath } = require('./paths');
const { computeAssetId } = require('./contentHash');
const { captureEnvFingerprint } = require('./envFingerprint');
const os = require('os');
const { getDeviceId } = require('./deviceId');

const PROTOCOL_NAME = 'gep-a2a';
const PROTOCOL_VERSION = '1.0.0';
const VALID_MESSAGE_TYPES = ['hello', 'publish', 'fetch', 'report', 'decision', 'revoke'];

const NODE_ID_RE = /^node_[a-f0-9]{12}$/;
const NODE_ID_DIR = path.join(os.homedir(), '.evomap');
const NODE_ID_FILE = path.join(NODE_ID_DIR, 'node_id');
const LOCAL_NODE_ID_FILE = path.resolve(__dirname, '..', '..', '.evomap_node_id');

let _cachedNodeId = null;

function _loadPersistedNodeId() {
  try {
    if (fs.existsSync(NODE_ID_FILE)) {
      const id = fs.readFileSync(NODE_ID_FILE, 'utf8').trim();
      if (id && NODE_ID_RE.test(id)) return id;
    }
  } catch {}
  try {
    if (fs.existsSync(LOCAL_NODE_ID_FILE)) {
      const id = fs.readFileSync(LOCAL_NODE_ID_FILE, 'utf8').trim();
      if (id && NODE_ID_RE.test(id)) return id;
    }
  } catch {}
  return null;
}

function _persistNodeId(id) {
  try {
    if (!fs.existsSync(NODE_ID_DIR)) {
      fs.mkdirSync(NODE_ID_DIR, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(NODE_ID_FILE, id, { encoding: 'utf8', mode: 0o600 });
    return;
  } catch {}
  try {
    fs.writeFileSync(LOCAL_NODE_ID_FILE, id, { encoding: 'utf8', mode: 0o600 });
    return;
  } catch {}
}

function generateMessageId() {
  return 'msg_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
}

function getNodeId() {
  if (_cachedNodeId) return _cachedNodeId;

  if (process.env.A2A_NODE_ID) {
    _cachedNodeId = String(process.env.A2A_NODE_ID);
    return _cachedNodeId;
  }

  const persisted = _loadPersistedNodeId();
  if (persisted) {
    _cachedNodeId = persisted;
    return _cachedNodeId;
  }

  console.warn('[a2aProtocol] A2A_NODE_ID is not set. Computing node ID from device fingerprint. ' +
    'This ID may change across machines or environments. ' +
    'Set A2A_NODE_ID after registering at https://evomap.ai to use a stable identity.');

  const deviceId = getDeviceId();
  const agentName = process.env.AGENT_NAME || 'default';
  const raw = deviceId + '|' + agentName + '|' + process.cwd();
  const computed = 'node_' + crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12);

  _persistNodeId(computed);
  _cachedNodeId = computed;
  return _cachedNodeId;
}

// --- Base message builder ---

function buildMessage(params) {
  if (!params || typeof params !== 'object') {
    throw new Error('buildMessage requires a params object');
  }
  const messageType = params.messageType;
  const payload = params.payload;
  const senderId = params.senderId;
  if (!VALID_MESSAGE_TYPES.includes(messageType)) {
    throw new Error('Invalid message type: ' + messageType + '. Valid: ' + VALID_MESSAGE_TYPES.join(', '));
  }
  return {
    protocol: PROTOCOL_NAME,
    protocol_version: PROTOCOL_VERSION,
    message_type: messageType,
    message_id: generateMessageId(),
    sender_id: senderId || getNodeId(),
    timestamp: new Date().toISOString(),
    payload: payload || {},
  };
}

// --- Typed message builders ---

function buildHello(opts) {
  const o = opts || {};
  return buildMessage({
    messageType: 'hello',
    senderId: o.nodeId,
    payload: {
      capabilities: o.capabilities || {},
      gene_count: typeof o.geneCount === 'number' ? o.geneCount : null,
      capsule_count: typeof o.capsuleCount === 'number' ? o.capsuleCount : null,
      env_fingerprint: captureEnvFingerprint(),
    },
  });
}

function buildPublish(opts) {
  const o = opts || {};
  const asset = o.asset;
  if (!asset || !asset.type || !asset.id) {
    throw new Error('publish: asset must have type and id');
  }
  const assetIdVal = asset.asset_id || computeAssetId(asset);
  const nodeSecret = getHubNodeSecret();
  if (!nodeSecret) {
    throw new Error('publish: node_secret is required for signing. Run hello first to obtain one.');
  }
  const signature = crypto.createHmac('sha256', nodeSecret).update(assetIdVal).digest('hex');
  return buildMessage({
    messageType: 'publish',
    senderId: o.nodeId,
    payload: {
      asset_type: asset.type,
      asset_id: assetIdVal,
      local_id: asset.id,
      asset: asset,
      signature: signature,
    },
  });
}

// Build a bundle publish message containing Gene + Capsule (+ optional EvolutionEvent).
// Hub requires payload.assets = [Gene, Capsule] since bundle enforcement was added.
function buildPublishBundle(opts) {
  const o = opts || {};
  const gene = o.gene;
  const capsule = o.capsule;
  const event = o.event || null;
  if (!gene || gene.type !== 'Gene' || !gene.id) {
    throw new Error('publishBundle: gene must be a valid Gene with type and id');
  }
  if (!capsule || capsule.type !== 'Capsule' || !capsule.id) {
    throw new Error('publishBundle: capsule must be a valid Capsule with type and id');
  }
  if (o.modelName && typeof o.modelName === 'string') {
    gene.model_name = o.modelName;
    capsule.model_name = o.modelName;
  }
  gene.asset_id = computeAssetId(gene);
  capsule.asset_id = computeAssetId(capsule);
  const geneAssetId = gene.asset_id;
  const capsuleAssetId = capsule.asset_id;
  const nodeSecret = getHubNodeSecret();
  if (!nodeSecret) {
    throw new Error('publishBundle: node_secret is required for signing. Run hello first to obtain one.');
  }
  const signatureInput = [geneAssetId, capsuleAssetId].sort().join('|');
  const signature = crypto.createHmac('sha256', nodeSecret).update(signatureInput).digest('hex');
  const assets = [gene, capsule];
  if (event && event.type === 'EvolutionEvent') {
    if (o.modelName && typeof o.modelName === 'string') {
      event.model_name = o.modelName;
    }
    event.asset_id = computeAssetId(event);
    assets.push(event);
  }
  const publishPayload = {
    assets: assets,
    signature: signature,
  };
  if (o.chainId && typeof o.chainId === 'string') {
    publishPayload.chain_id = o.chainId;
  }
  return buildMessage({
    messageType: 'publish',
    senderId: o.nodeId,
    payload: publishPayload,
  });
}

function buildFetch(opts) {
  const o = opts || {};
  const fetchPayload = {
    asset_type: o.assetType || null,
    local_id: o.localId || null,
    content_hash: o.contentHash || null,
  };
  if (Array.isArray(o.signals) && o.signals.length > 0) {
    fetchPayload.signals = o.signals;
  }
  if (o.searchOnly === true) {
    fetchPayload.search_only = true;
  }
  if (Array.isArray(o.assetIds) && o.assetIds.length > 0) {
    fetchPayload.asset_ids = o.assetIds;
  }
  return buildMessage({
    messageType: 'fetch',
    senderId: o.nodeId,
    payload: fetchPayload,
  });
}

function buildReport(opts) {
  const o = opts || {};
  return buildMessage({
    messageType: 'report',
    senderId: o.nodeId,
    payload: {
      target_asset_id: o.assetId || null,
      target_local_id: o.localId || null,
      validation_report: o.validationReport || null,
    },
  });
}

function buildDecision(opts) {
  const o = opts || {};
  const validDecisions = ['accept', 'reject', 'quarantine'];
  if (!validDecisions.includes(o.decision)) {
    throw new Error('decision must be one of: ' + validDecisions.join(', '));
  }
  return buildMessage({
    messageType: 'decision',
    senderId: o.nodeId,
    payload: {
      target_asset_id: o.assetId || null,
      target_local_id: o.localId || null,
      decision: o.decision,
      reason: o.reason || null,
    },
  });
}

function buildRevoke(opts) {
  const o = opts || {};
  return buildMessage({
    messageType: 'revoke',
    senderId: o.nodeId,
    payload: {
      target_asset_id: o.assetId || null,
      target_local_id: o.localId || null,
      reason: o.reason || null,
    },
  });
}

// --- Validation ---

function isValidProtocolMessage(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (msg.protocol !== PROTOCOL_NAME) return false;
  if (!msg.message_type || !VALID_MESSAGE_TYPES.includes(msg.message_type)) return false;
  if (!msg.message_id || typeof msg.message_id !== 'string') return false;
  if (!msg.timestamp || typeof msg.timestamp !== 'string') return false;
  return true;
}

// Try to extract a raw asset from either a protocol message or a plain asset object.
// This enables backward-compatible ingestion of both old-format and new-format payloads.
function unwrapAssetFromMessage(input) {
  if (!input || typeof input !== 'object') return null;
  // If it is a protocol message with a publish payload, extract the asset.
  if (input.protocol === PROTOCOL_NAME && input.message_type === 'publish') {
    const p = input.payload;
    if (p && p.asset && typeof p.asset === 'object') return p.asset;
    return null;
  }
  // If it is a plain asset (Gene/Capsule/EvolutionEvent), return as-is.
  if (input.type === 'Gene' || input.type === 'Capsule' || input.type === 'EvolutionEvent') {
    return input;
  }
  return null;
}

// --- File Transport ---

function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.warn('[a2aProtocol] ensureDir failed:', dir, e && e.message || e);
  }
}

function defaultA2ADir() {
  return process.env.A2A_DIR || path.join(getGepAssetsDir(), 'a2a');
}

function fileTransportSend(message, opts) {
  const dir = (opts && opts.dir) || defaultA2ADir();
  const subdir = path.join(dir, 'outbox');
  ensureDir(subdir);
  const filePath = path.join(subdir, message.message_type + '.jsonl');
  fs.appendFileSync(filePath, JSON.stringify(message) + '\n', 'utf8');
  return { ok: true, path: filePath };
}

function fileTransportReceive(opts) {
  const dir = (opts && opts.dir) || defaultA2ADir();
  const subdir = path.join(dir, 'inbox');
  if (!fs.existsSync(subdir)) return [];
  const MAX_FILES = 50;
  const MAX_FILE_BYTES = 256 * 1024;
  const files = fs.readdirSync(subdir).filter(function (f) { return f.endsWith('.jsonl'); }).slice(0, MAX_FILES);
  const messages = [];
  for (let fi = 0; fi < files.length; fi++) {
    try {
      const filePath = path.join(subdir, files[fi]);
      const stat = fs.statSync(filePath);
      let raw;
      if (stat.size <= MAX_FILE_BYTES) {
        raw = fs.readFileSync(filePath, 'utf8');
      } else {
        const fd = fs.openSync(filePath, 'r');
        try {
          const buf = Buffer.alloc(MAX_FILE_BYTES);
          fs.readSync(fd, buf, 0, MAX_FILE_BYTES, stat.size - MAX_FILE_BYTES);
          raw = buf.toString('utf8');
          const firstNl = raw.indexOf('\n');
          if (firstNl >= 0) raw = raw.slice(firstNl + 1);
        } finally {
          fs.closeSync(fd);
        }
      }
      const lines = raw.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      for (let li = 0; li < lines.length; li++) {
        try {
          const msg = JSON.parse(lines[li]);
          if (msg && msg.protocol === PROTOCOL_NAME) messages.push(msg);
        } catch (e) {
          console.warn('[a2aProtocol] Malformed JSON line in inbox file ' + files[fi] + ' (line ' + (li + 1) + '):', e && e.message || e);
        }
      }
    } catch (e) {
      console.warn('[a2aProtocol] Failed to read inbox file:', files[fi], e && e.message || e);
    }
  }
  return messages;
}

function fileTransportList(opts) {
  const dir = (opts && opts.dir) || defaultA2ADir();
  const subdir = path.join(dir, 'outbox');
  if (!fs.existsSync(subdir)) return [];
  return fs.readdirSync(subdir).filter(function (f) { return f.endsWith('.jsonl'); });
}

// --- HTTP Transport (connects to evomap-hub) ---

function httpTransportSend(message, opts) {
  const hubUrl = (opts && opts.hubUrl) || process.env.A2A_HUB_URL;
  if (!hubUrl) return { ok: false, error: 'A2A_HUB_URL not set' };
  const timeoutMs = (opts && opts.timeoutMs) || require('../config').HTTP_TRANSPORT_TIMEOUT_MS;
  const endpoint = hubUrl.replace(/\/+$/, '') + '/a2a/' + message.message_type;
  const body = JSON.stringify(message);
  return fetch(endpoint, {
    method: 'POST',
    headers: buildHubHeaders(),
    body: body,
    signal: AbortSignal.timeout(timeoutMs),
  })
    .then(function (res) {
      if (!res.ok) return res.text().then(function (t) { return { ok: false, error: 'HTTP ' + res.status + ': ' + t.slice(0, 200) }; });
      return res.json().then(function (data) { return { ok: true, response: data }; });
    })
    .catch(function (err) { return { ok: false, error: err.message }; });
}

function httpTransportReceive(opts) {
  const hubUrl = (opts && opts.hubUrl) || process.env.A2A_HUB_URL;
  if (!hubUrl) return Promise.resolve([]);
  const timeoutMs = (opts && opts.timeoutMs) || require('../config').HTTP_TRANSPORT_TIMEOUT_MS;
  const assetType = (opts && opts.assetType) || null;
  const signals = (opts && Array.isArray(opts.signals)) ? opts.signals : null;
  const fetchMsg = buildFetch({ assetType: assetType, signals: signals });
  const endpoint = hubUrl.replace(/\/+$/, '') + '/a2a/fetch';
  return fetch(endpoint, {
    method: 'POST',
    headers: buildHubHeaders(),
    body: JSON.stringify(fetchMsg),
    signal: AbortSignal.timeout(timeoutMs),
  })
    .then(function (res) {
      if (!res.ok) { console.warn('[a2aProtocol] httpTransportReceive HTTP ' + res.status); return { payload: { results: [] } }; }
      return res.json();
    })
    .then(function (data) {
      if (data && data.payload && Array.isArray(data.payload.results)) {
        return data.payload.results;
      }
      return [];
    })
    .catch(function (err) {
      console.warn('[a2aProtocol] httpTransportReceive failed:', err && err.message || err);
      return [];
    });
}

function httpTransportList() {
  return ['http'];
}

// --- Heartbeat ---

let _heartbeatTimer = null;
let _heartbeatStartedAt = null;
let _heartbeatConsecutiveFailures = 0;
let _heartbeatTotalSent = 0;
let _heartbeatTotalFailed = 0;
let _heartbeatFpSent = false;
let _latestAvailableWork = [];
let _latestOverdueTasks = [];
let _latestSkillStoreHint = null;
let _latestNoveltyHint = null;
let _latestCapabilityGaps = [];
let _pendingCommitmentUpdates = [];
let _latestHubEvents = [];
let _pollInflight = false;
let _cachedHubNodeSecret = null;
let _cachedHubNodeSecretAt = 0;
const _SECRET_CACHE_TTL_MS = require('../config').SECRET_CACHE_TTL_MS;
let _heartbeatIntervalMs = 0;
let _heartbeatRunning = false;

const NODE_SECRET_FILE = path.join(NODE_ID_DIR, 'node_secret');

function _loadPersistedNodeSecret() {
  try {
    if (fs.existsSync(NODE_SECRET_FILE)) {
      const s = fs.readFileSync(NODE_SECRET_FILE, 'utf8').trim();
      if (s && /^[a-f0-9]{64}$/i.test(s)) return s;
    }
  } catch {}
  return null;
}

function _persistNodeSecret(secret) {
  try {
    if (!fs.existsSync(NODE_ID_DIR)) {
      fs.mkdirSync(NODE_ID_DIR, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(NODE_SECRET_FILE, secret, { encoding: 'utf8', mode: 0o600 });
  } catch (e) {
    console.warn('[a2aProtocol] Failed to persist node secret:', e && e.message || e);
  }
}

function getHubUrl() {
  return process.env.A2A_HUB_URL || process.env.EVOMAP_HUB_URL || '';
}

function buildHubHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const secret = getHubNodeSecret();
  if (secret) headers['Authorization'] = 'Bearer ' + secret;
  return headers;
}

function sendHelloToHub() {
  const hubUrl = getHubUrl();
  if (!hubUrl) return Promise.resolve({ ok: false, error: 'no_hub_url' });

  const endpoint = hubUrl.replace(/\/+$/, '') + '/a2a/hello';
  const nodeId = getNodeId();
  const msg = buildHello({ nodeId: nodeId, capabilities: {} });
  msg.sender_id = nodeId;

  return fetch(endpoint, {
    method: 'POST',
    headers: buildHubHeaders(),
    body: JSON.stringify(msg),
    signal: AbortSignal.timeout(require('../config').HELLO_TIMEOUT_MS),
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      const secret = (data && data.payload && data.payload.node_secret)
        || (data && data.node_secret)
        || null;
      if (secret && /^[a-f0-9]{64}$/i.test(secret)) {
        _cachedHubNodeSecret = secret;
        _cachedHubNodeSecretAt = Date.now();
        _persistNodeSecret(secret);
      }
      return { ok: true, response: data };
    })
    .catch(function (err) { return { ok: false, error: err.message }; });
}

function getHubNodeSecret() {
  if (process.env.A2A_NODE_SECRET) return process.env.A2A_NODE_SECRET;
  const now = Date.now();
  if (_cachedHubNodeSecret && (now - _cachedHubNodeSecretAt) < _SECRET_CACHE_TTL_MS) {
    return _cachedHubNodeSecret;
  }
  const persisted = _loadPersistedNodeSecret();
  if (persisted) {
    _cachedHubNodeSecret = persisted;
    _cachedHubNodeSecretAt = now;
    return persisted;
  }
  if (process.env.A2A_HUB_TOKEN) return process.env.A2A_HUB_TOKEN;
  return null;
}

let _heartbeatInFlight = false;

function _scheduleNextHeartbeat(delayMs) {
  if (!_heartbeatRunning) return;
  if (_heartbeatTimer) clearTimeout(_heartbeatTimer);
  const delay = delayMs || _heartbeatIntervalMs;
  _heartbeatTimer = setTimeout(function () {
    if (!_heartbeatRunning) return;
    if (_heartbeatInFlight) return;
    _heartbeatInFlight = true;
    sendHeartbeat()
      .catch(function (err) {
        console.warn('[Heartbeat] Scheduled heartbeat failed:', err && err.message || err);
      })
      .then(function () {
        _heartbeatInFlight = false;
        _scheduleNextHeartbeat();
      });
  }, delay);
  if (_heartbeatTimer.unref) _heartbeatTimer.unref();
}

function sendHeartbeat() {
  const hubUrl = getHubUrl();
  if (!hubUrl) return Promise.resolve({ ok: false, error: 'no_hub_url' });

  const endpoint = hubUrl.replace(/\/+$/, '') + '/a2a/heartbeat';
  const nodeId = getNodeId();
  const bodyObj = {
    node_id: nodeId,
    sender_id: nodeId,
    version: PROTOCOL_VERSION,
    uptime_ms: _heartbeatStartedAt ? Date.now() - _heartbeatStartedAt : 0,
    timestamp: new Date().toISOString(),
  };

  const meta = {};

  if (process.env.WORKER_ENABLED === '1') {
    const domains = (process.env.WORKER_DOMAINS || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    meta.worker_enabled = true;
    meta.worker_domains = domains;
    meta.max_load = Math.max(1, Number(process.env.WORKER_MAX_LOAD) || 5);
  }

  const modelTier = (process.env.EVOLVER_MODEL_TIER || '').trim();
  if (modelTier) {
    meta.model_tier = modelTier;
  }

  if (_pendingCommitmentUpdates.length > 0) {
    meta.commitment_updates = _pendingCommitmentUpdates.splice(0);
  }

  if (!_heartbeatFpSent) {
    try {
      const fp = captureEnvFingerprint();
      if (fp && fp.evolver_version) {
        meta.env_fingerprint = fp;
        _heartbeatFpSent = true;
      }
    } catch (e) {
      console.warn('[a2aProtocol] Failed to capture env fingerprint:', e && e.message || e);
    }
  }

  if (Object.keys(meta).length > 0) {
    bodyObj.meta = meta;
  }

  const body = JSON.stringify(bodyObj);

  _heartbeatTotalSent++;

  return fetch(endpoint, {
    method: 'POST',
    headers: buildHubHeaders(),
    body: body,
    signal: AbortSignal.timeout(require('../config').HEARTBEAT_TIMEOUT_MS),
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data && (data.error === 'rate_limited' || data.status === 'rate_limited')) {
        const retryMs = Number(data.retry_after_ms) || 0;
        const policy = data.policy || {};
        const windowMs = Number(policy.window_ms) || 0;
        const backoff = retryMs > 0 ? retryMs + 5000 : (windowMs > 0 ? windowMs + 5000 : _heartbeatIntervalMs);
        if (backoff > _heartbeatIntervalMs) {
          console.warn('[Heartbeat] Rate limited by hub. Next attempt in ' + Math.round(backoff / 1000) + 's. ' +
            'Consider increasing HEARTBEAT_INTERVAL_MS to >= ' + (windowMs || backoff) + 'ms.');
          _scheduleNextHeartbeat(backoff);
        }
        return { ok: false, error: 'rate_limited', retryMs: backoff };
      }
      if (data && data.status === 'unknown_node') {
        console.warn('[Heartbeat] Node not registered on hub. Sending hello to re-register...');
        return sendHelloToHub().then(function (helloResult) {
          if (helloResult.ok) {
            console.log('[Heartbeat] Re-registered with hub successfully.');
            _heartbeatConsecutiveFailures = 0;
          } else {
            console.warn('[Heartbeat] Re-registration failed: ' + (helloResult.error || 'unknown'));
          }
          return { ok: helloResult.ok, response: data, reregistered: helloResult.ok };
        });
      }
      if (Array.isArray(data.available_work)) {
        _latestAvailableWork = data.available_work;
      }
      if (Array.isArray(data.overdue_tasks) && data.overdue_tasks.length > 0) {
        _latestOverdueTasks = data.overdue_tasks;
        console.warn('[Commitment] ' + data.overdue_tasks.length + ' overdue task(s) detected via heartbeat.');
      }
      if (data.skill_store) {
        _latestSkillStoreHint = data.skill_store;
        if (data.skill_store.eligible && data.skill_store.published_skills === 0) {
          console.log('[Skill Store] ' + data.skill_store.hint);
        }
      }
      if (data.novelty && typeof data.novelty === 'object') {
        _latestNoveltyHint = data.novelty;
      }
      if (Array.isArray(data.capability_gaps) && data.capability_gaps.length > 0) {
        _latestCapabilityGaps = data.capability_gaps;
      }
      if (data.circle_experience && typeof data.circle_experience === 'object') {
        console.log('[EvolutionCircle] Active circle: ' + (data.circle_experience.circle_id || '?') + ' (' + (data.circle_experience.member_count || 0) + ' members)');
      }
      if (data.has_pending_events) {
        _fetchHubEvents().catch(function (err) {
          console.warn('[Events] Poll failed:', err && err.message || err);
        });
      }
      _heartbeatConsecutiveFailures = 0;
      try {
        const logPath = getEvolverLogPath();
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        const now = new Date();
        try {
          fs.utimesSync(logPath, now, now);
        } catch (e) {
          if (e && e.code === 'ENOENT') {
            try {
              const fd = fs.openSync(logPath, 'a');
              fs.closeSync(fd);
              fs.utimesSync(logPath, now, now);
            } catch (innerErr) {
              console.warn('[Heartbeat] Failed to create evolver_loop.log: ' + innerErr.message);
            }
          } else {
            console.warn('[Heartbeat] Failed to touch evolver_loop.log: ' + e.message);
          }
        }
      } catch (outerErr) {
        console.warn('[Heartbeat] Failed to ensure evolver_loop.log: ' + outerErr.message);
      }
      return { ok: true, response: data };
    })
    .catch(function (err) {
      _heartbeatConsecutiveFailures++;
      _heartbeatTotalFailed++;
      if (_heartbeatConsecutiveFailures === 3) {
        console.warn('[Heartbeat] 3 consecutive failures. Network issue? Last error: ' + err.message);
      } else if (_heartbeatConsecutiveFailures === 10) {
        console.warn('[Heartbeat] 10 consecutive failures. Hub may be unreachable. (' + err.message + ')');
      } else if (_heartbeatConsecutiveFailures % 50 === 0) {
        console.warn('[Heartbeat] ' + _heartbeatConsecutiveFailures + ' consecutive failures. (' + err.message + ')');
      }
      return { ok: false, error: err.message };
    });
}

function getLatestAvailableWork() {
  return _latestAvailableWork;
}

function consumeAvailableWork() {
  const work = _latestAvailableWork;
  _latestAvailableWork = [];
  return work;
}

function getOverdueTasks() {
  return _latestOverdueTasks;
}

function getSkillStoreHint() {
  return _latestSkillStoreHint;
}

function consumeOverdueTasks() {
  const tasks = _latestOverdueTasks;
  _latestOverdueTasks = [];
  return tasks;
}

function getNoveltyHint() {
  return _latestNoveltyHint;
}

function getCapabilityGaps() {
  return _latestCapabilityGaps;
}

/**
 * Fetch pending high-priority events from the hub via long-poll.
 * Called automatically when heartbeat returns has_pending_events: true.
 * Results are stored in _latestHubEvents and can be consumed via consumeHubEvents().
 */
function _fetchHubEvents() {
  if (_pollInflight) return Promise.resolve([]);
  const hubUrl = getHubUrl();
  if (!hubUrl) return Promise.resolve([]);
  _pollInflight = true;

  const nodeId = getNodeId();
  const endpoint = hubUrl.replace(/\/+$/, '') + '/a2a/events/poll';
  const body = JSON.stringify({
    protocol: 'gep-a2a',
    protocol_version: PROTOCOL_VERSION,
    message_type: 'events_poll',
    message_id: 'poll_' + Date.now(),
    timestamp: new Date().toISOString(),
    sender_id: nodeId,
    payload: {},
  });

  return fetch(endpoint, {
    method: 'POST',
    headers: buildHubHeaders(),
    body: body,
    signal: AbortSignal.timeout(require('../config').EVENT_POLL_TIMEOUT_MS),
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      const events = (data && Array.isArray(data.events))
        ? data.events
        : (data && data.payload && Array.isArray(data.payload.events))
          ? data.payload.events
          : [];
      if (events.length > 0) {
        _latestHubEvents = _latestHubEvents.concat(events);
        var MAX_BUFFERED_EVENTS = 200;
        if (_latestHubEvents.length > MAX_BUFFERED_EVENTS) {
          var dropped = _latestHubEvents.length - MAX_BUFFERED_EVENTS;
          _latestHubEvents = _latestHubEvents.slice(-MAX_BUFFERED_EVENTS);
          console.warn('[Events] Buffer overflow: dropped ' + dropped + ' oldest event(s).');
        }
        console.log('[Events] Received ' + events.length + ' pending event(s): ' +
          events.map(function (e) { return e.type; }).join(', '));
      }
      return events;
    })
    .catch(function (err) {
      console.warn('[Events] Poll error:', err && err.message || err);
      return [];
    })
    .finally(function () {
      _pollInflight = false;
    });
}

/**
 * Returns all buffered hub events (does not clear the buffer).
 */
function getHubEvents() {
  return _latestHubEvents;
}

/**
 * Returns and clears all buffered hub events.
 */
function consumeHubEvents() {
  const events = _latestHubEvents;
  _latestHubEvents = [];
  return events;
}

/**
 * Queue a commitment deadline update to be sent with the next heartbeat.
 * @param {string} taskId
 * @param {string} deadlineIso - ISO-8601 deadline
 * @param {boolean} [isAssignment] - true if this is a WorkAssignment
 */
function queueCommitmentUpdate(taskId, deadlineIso, isAssignment) {
  if (!taskId || !deadlineIso) return;
  _pendingCommitmentUpdates.push({
    task_id: taskId,
    deadline: deadlineIso,
    assignment: !!isAssignment,
  });
}

function startHeartbeat(intervalMs) {
  if (_heartbeatRunning) return;
  _heartbeatIntervalMs = intervalMs || require('../config').HEARTBEAT_INTERVAL_MS;
  _heartbeatStartedAt = Date.now();
  _heartbeatRunning = true;

  sendHelloToHub().then(function (r) {
    if (r.ok) console.log('[Heartbeat] Registered with hub. Node: ' + getNodeId());
    else console.warn('[Heartbeat] Hello failed (will retry via heartbeat): ' + (r.error || 'unknown'));
  }).catch(function (err) {
    console.warn('[Heartbeat] Hello during startup failed:', err && err.message || err);
  }).then(function () {
    if (!_heartbeatRunning) return;
    // First heartbeat after hello completes, with enough gap to avoid rate limit
    _scheduleNextHeartbeat(Math.max(require('../config').HEARTBEAT_FIRST_DELAY_MS, _heartbeatIntervalMs));
  });
}

function stopHeartbeat() {
  _heartbeatRunning = false;
  if (_heartbeatTimer) {
    clearTimeout(_heartbeatTimer);
    _heartbeatTimer = null;
  }
}

function getHeartbeatStats() {
  return {
    running: _heartbeatRunning,
    uptimeMs: _heartbeatStartedAt ? Date.now() - _heartbeatStartedAt : 0,
    totalSent: _heartbeatTotalSent,
    totalFailed: _heartbeatTotalFailed,
    consecutiveFailures: _heartbeatConsecutiveFailures,
  };
}

// --- Transport registry ---

const transports = {
  file: {
    send: fileTransportSend,
    receive: fileTransportReceive,
    list: fileTransportList,
  },
  http: {
    send: httpTransportSend,
    receive: httpTransportReceive,
    list: httpTransportList,
  },
};

function getTransport(name) {
  const n = String(name || process.env.A2A_TRANSPORT || 'file').toLowerCase();
  const t = transports[n];
  if (!t) throw new Error('Unknown A2A transport: ' + n + '. Available: ' + Object.keys(transports).join(', '));
  return t;
}

function registerTransport(name, impl) {
  if (!name || typeof name !== 'string') throw new Error('transport name required');
  if (!impl || typeof impl.send !== 'function' || typeof impl.receive !== 'function') {
    throw new Error('transport must implement send() and receive()');
  }
  transports[name] = impl;
}

// --- Hub Infrastructure Helpers ---
// These wrap the agent infrastructure endpoints added to evomap-hub,
// enabling evolver instances to self-provision, transfer credits,
// manage identity, and query audit logs programmatically.

function _hubPost(pathSuffix, body, timeoutMs) {
  var hubUrl = getHubUrl();
  if (!hubUrl) return Promise.resolve({ ok: false, error: 'no_hub_url' });
  var endpoint = hubUrl.replace(/\/+$/, '') + pathSuffix;
  var timeout = timeoutMs || require('../config').HTTP_TRANSPORT_TIMEOUT_MS;
  return fetch(endpoint, {
    method: 'POST',
    headers: buildHubHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  })
    .then(function (res) {
      if (!res.ok) return res.text().then(function (t) { return { ok: false, status: res.status, error: t.slice(0, 400) }; });
      return res.json().then(function (data) { return { ok: true, data: data }; });
    })
    .catch(function (err) { return { ok: false, error: err.message }; });
}

function _hubGet(pathSuffix, timeoutMs) {
  var hubUrl = getHubUrl();
  if (!hubUrl) return Promise.resolve({ ok: false, error: 'no_hub_url' });
  var endpoint = hubUrl.replace(/\/+$/, '') + pathSuffix;
  var timeout = timeoutMs || require('../config').HTTP_TRANSPORT_TIMEOUT_MS;
  return fetch(endpoint, {
    method: 'GET',
    headers: buildHubHeaders(),
    signal: AbortSignal.timeout(timeout),
  })
    .then(function (res) {
      if (!res.ok) return res.text().then(function (t) { return { ok: false, status: res.status, error: t.slice(0, 400) }; });
      return res.json().then(function (data) { return { ok: true, data: data }; });
    })
    .catch(function (err) { return { ok: false, error: err.message }; });
}

/**
 * Self-provision a machine account on the hub.
 * POST /a2a/provision
 */
function hubSelfProvision(opts) {
  var nodeId = (opts && opts.nodeId) || getNodeId();
  return _hubPost('/a2a/provision', {
    node_id: nodeId,
    sender_id: nodeId,
    label: (opts && opts.label) || undefined,
    description: (opts && opts.description) || undefined,
  });
}

/**
 * Programmatically top up credits on the hub.
 * POST /a2a/credit/topup
 */
function hubCreditTopUp(amount, opts) {
  var nodeId = (opts && opts.nodeId) || getNodeId();
  var safeAmount = Math.max(0, Number(amount) || 0);
  return _hubPost('/a2a/credit/topup', {
    node_id: nodeId,
    sender_id: nodeId,
    amount: safeAmount,
    idempotency_key: (opts && opts.idempotencyKey) || undefined,
  });
}

/**
 * Transfer credits to another agent on the hub.
 * POST /a2a/credit/transfer
 */
function hubCreditTransfer(toNodeId, amount, opts) {
  var fromNodeId = (opts && opts.fromNodeId) || getNodeId();
  var safeAmount = Math.max(0, Number(amount) || 0);
  return _hubPost('/a2a/credit/transfer', {
    from_node_id: fromNodeId,
    sender_id: fromNodeId,
    to_node_id: toNodeId,
    amount: safeAmount,
    reason: (opts && opts.reason) || 'agent_transfer',
    reference_id: (opts && opts.referenceId) || undefined,
    meta: (opts && opts.meta) || undefined,
  });
}

/**
 * Get transfer fee estimate.
 * GET /a2a/credit/transfer/estimate?amount=N
 */
function hubTransferEstimate(amount) {
  return _hubGet('/a2a/credit/transfer/estimate?amount=' + (Number(amount) || 0));
}

/**
 * Get own transfer history.
 * GET /a2a/credit/transfer/history?node_id=...
 */
function hubTransferHistory(opts) {
  var nodeId = (opts && opts.nodeId) || getNodeId();
  var limit = (opts && opts.limit) || 20;
  var offset = (opts && opts.offset) || 0;
  var dir = (opts && opts.direction) || '';
  var qs = 'node_id=' + encodeURIComponent(nodeId) + '&limit=' + limit + '&offset=' + offset;
  if (dir) qs += '&direction=' + encodeURIComponent(dir);
  return _hubGet('/a2a/credit/transfer/history?' + qs);
}

/**
 * Get portable identity profile of any node.
 * GET /a2a/identity/:nodeId
 */
function hubGetIdentity(nodeId) {
  var nid = nodeId || getNodeId();
  return _hubGet('/a2a/identity/' + encodeURIComponent(nid));
}

/**
 * Get a verifiable reputation attestation.
 * GET /a2a/identity/:nodeId/attestation
 */
function hubGetAttestation(nodeId) {
  var nid = nodeId || getNodeId();
  return _hubGet('/a2a/identity/' + encodeURIComponent(nid) + '/attestation');
}

/**
 * Verify a reputation attestation.
 * POST /a2a/identity/verify
 */
function hubVerifyAttestation(attestation) {
  return _hubPost('/a2a/identity/verify', attestation);
}

/**
 * Set a DID document for the current node.
 * POST /a2a/identity/did
 */
function hubSetDid(didDocument, didMethod) {
  var nodeId = getNodeId();
  return _hubPost('/a2a/identity/did', {
    node_id: nodeId,
    sender_id: nodeId,
    did_document: didDocument,
    did_method: didMethod || 'did:evomap',
  });
}

/**
 * Get own audit logs.
 * GET /a2a/audit/:nodeId
 */
function hubGetAuditLogs(opts) {
  var nodeId = (opts && opts.nodeId) || getNodeId();
  var limit = (opts && opts.limit) || 50;
  var offset = (opts && opts.offset) || 0;
  var qs = '?limit=' + limit + '&offset=' + offset;
  if (opts && opts.action) qs += '&action=' + encodeURIComponent(opts.action);
  if (opts && opts.since) qs += '&since=' + encodeURIComponent(opts.since);
  if (opts && opts.until) qs += '&until=' + encodeURIComponent(opts.until);
  return _hubGet('/a2a/audit/' + encodeURIComponent(nodeId) + qs);
}

/**
 * Get a generated work report.
 * GET /a2a/audit/:nodeId/report
 */
function hubGetWorkReport(opts) {
  var nodeId = (opts && opts.nodeId) || getNodeId();
  var days = (opts && opts.days) || 7;
  return _hubGet('/a2a/audit/' + encodeURIComponent(nodeId) + '/report?days=' + days);
}

/**
 * Open a Server-Sent Events stream for real-time hub notifications.
 * Returns an object with { ok, eventSource, close() } on success.
 * The caller should attach event listeners to eventSource.
 * GET /a2a/events/stream?node_id=...
 */
function hubOpenEventStream(opts) {
  var hubUrl = getHubUrl();
  if (!hubUrl) return { ok: false, error: 'no_hub_url' };

  var nodeId = (opts && opts.nodeId) || getNodeId();
  var durationMs = (opts && opts.durationMs) || 300000;
  var qs = 'node_id=' + encodeURIComponent(nodeId) + '&duration_ms=' + durationMs;
  var endpoint = hubUrl.replace(/\/+$/, '') + '/a2a/events/stream?' + qs;

  try {
    var EventSource = require('eventsource');
    var esOpts = {};
    var secret = getHubNodeSecret();
    if (secret) {
      esOpts.headers = { 'Authorization': 'Bearer ' + secret };
    }
    var es = new EventSource(endpoint, esOpts);
    return {
      ok: true,
      eventSource: es,
      close: function () { es.close(); },
    };
  } catch (err) {
    return { ok: false, error: 'eventsource_not_available: ' + (err.message || err) };
  }
}

// ---------------------------------------------------------------------------
// Managed SSE stream -- starts/stops alongside the heartbeat loop.
// Events are buffered into _hubEvents for consumption by evolve.js.
// Falls back gracefully to poll-based events if SSE is unavailable.
// ---------------------------------------------------------------------------

var _activeStream = null;
var _sseReconnectTimer = null;
var _sseReconnectMs = 5000;
var _sseMaxReconnectMs = 120000;

function startEventStream() {
  if (_activeStream) return;
  if (process.env.EVOLVER_SSE_DISABLED === '1') return;

  var result = hubOpenEventStream({ durationMs: 600000 });
  if (!result.ok) {
    console.log('[SSE] Event stream unavailable: ' + (result.error || 'unknown') + ' (falling back to poll)');
    return;
  }

  _activeStream = result;
  _sseReconnectMs = 5000;
  console.log('[SSE] Event stream connected');

  result.eventSource.onmessage = function (ev) {
    try {
      var parsed = JSON.parse(ev.data);
      if (parsed && parsed.type) {
        if (!_hubEvents) _hubEvents = [];
        _hubEvents.push(parsed);
      }
    } catch (e) {}
  };

  result.eventSource.onerror = function () {
    console.warn('[SSE] Stream error, will reconnect in ' + Math.round(_sseReconnectMs / 1000) + 's');
    stopEventStream();
    _sseReconnectTimer = setTimeout(function () {
      _sseReconnectTimer = null;
      startEventStream();
    }, _sseReconnectMs);
    _sseReconnectMs = Math.min(_sseReconnectMs * 2, _sseMaxReconnectMs);
  };
}

function stopEventStream() {
  if (_activeStream) {
    try { _activeStream.close(); } catch (e) {}
    _activeStream = null;
  }
  if (_sseReconnectTimer) {
    clearTimeout(_sseReconnectTimer);
    _sseReconnectTimer = null;
  }
}

function isEventStreamActive() {
  return _activeStream !== null;
}

module.exports = {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  VALID_MESSAGE_TYPES,
  getNodeId,
  buildMessage,
  buildHello,
  buildPublish,
  buildPublishBundle,
  buildFetch,
  buildReport,
  buildDecision,
  buildRevoke,
  isValidProtocolMessage,
  unwrapAssetFromMessage,
  getTransport,
  registerTransport,
  fileTransportSend,
  fileTransportReceive,
  fileTransportList,
  httpTransportSend,
  httpTransportReceive,
  httpTransportList,
  sendHeartbeat,
  sendHelloToHub,
  startHeartbeat,
  stopHeartbeat,
  getHeartbeatStats,
  getLatestAvailableWork,
  consumeAvailableWork,
  getOverdueTasks,
  consumeOverdueTasks,
  getSkillStoreHint,
  queueCommitmentUpdate,
  getHubUrl,
  getHubNodeSecret,
  buildHubHeaders,
  getNoveltyHint,
  getCapabilityGaps,
  getHubEvents,
  consumeHubEvents,
  hubSelfProvision,
  hubCreditTopUp,
  hubCreditTransfer,
  hubTransferEstimate,
  hubTransferHistory,
  hubGetIdentity,
  hubGetAttestation,
  hubVerifyAttestation,
  hubSetDid,
  hubGetAuditLogs,
  hubGetWorkReport,
  hubOpenEventStream,
  startEventStream,
  stopEventStream,
  isEventStreamActive,
};
