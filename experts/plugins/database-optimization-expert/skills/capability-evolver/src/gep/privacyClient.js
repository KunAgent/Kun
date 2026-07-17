// ---------------------------------------------------------------------------
// privacyClient -- Hub privacy computing API client.
// Handles encrypted blob upload, sealed tool registration/execution,
// status polling, and result retrieval.
// ---------------------------------------------------------------------------

const { getNodeId, buildHubHeaders } = require('./a2aProtocol');
const { generateKey, encrypt, decrypt, pack, unpack } = require('./crypto');

const HUB_URL = process.env.A2A_HUB_URL || process.env.EVOMAP_HUB_URL || 'https://evomap.ai';
const PRIVACY_TIMEOUT_MS = 15000;

function privacyUrl(path) {
  return `${HUB_URL.replace(/\/+$/, '')}/a2a/privacy${path}`;
}

/**
 * Submit a privacy computing task to Hub.
 * @param {{ title: string, body?: string, signals?: string }} opts
 * @returns {{ taskId: string, status: string } | null}
 */
async function submitPrivacyTask(opts) {
  const nodeId = getNodeId();
  if (!nodeId) return null;

  try {
    const res = await fetch(privacyUrl('/submit'), {
      method: 'POST',
      headers: buildHubHeaders(),
      body: JSON.stringify({ ...opts, node_id: nodeId }),
      signal: AbortSignal.timeout(PRIVACY_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn('[PrivacyClient] submitPrivacyTask failed:', err?.message || err);
    return null;
  }
}

/**
 * Encrypt data locally and upload the encrypted blob to Hub.
 * Returns the blobId and the local key (caller must store the key).
 * @param {Buffer|string} plaintext
 * @param {{ privacyTaskId: string, label?: string }} opts
 * @returns {{ blobId: string, key: Buffer, iv: Buffer, authTag: Buffer } | null}
 */
async function uploadEncryptedBlob(plaintext, opts) {
  const nodeId = getNodeId();
  if (!nodeId || !opts?.privacyTaskId) return null;

  try {
    const key = generateKey();
    const parts = encrypt(plaintext, key);
    const packed = pack(parts);

    const body = JSON.stringify({
      node_id: nodeId,
      privacy_task_id: opts.privacyTaskId,
      label: opts.label || 'blob',
      data_base64: packed.toString('base64'),
      encryption: 'aes-256-gcm',
    });

    const res = await fetch(privacyUrl('/blob/upload'), {
      method: 'POST',
      headers: buildHubHeaders(),
      body,
      signal: AbortSignal.timeout(PRIVACY_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const resp = await res.json();
    return {
      blobId: resp.blob_id || resp.blobId,
      key,
      iv: parts.iv,
      authTag: parts.authTag,
    };
  } catch (err) {
    console.warn('[PrivacyClient] uploadEncryptedBlob failed:', err?.message || err);
    return null;
  }
}

/**
 * Execute a sealed tool on a previously uploaded blob.
 * @param {{ toolId: string, blobId: string }} opts
 * @returns {{ resultKey?: string, resultHash?: string, error?: string } | null}
 */
async function executeSealedTool(opts) {
  const nodeId = getNodeId();
  if (!nodeId || !opts?.toolId || !opts?.blobId) return null;

  try {
    const res = await fetch(privacyUrl('/tool/execute'), {
      method: 'POST',
      headers: buildHubHeaders(),
      body: JSON.stringify({
        toolId: opts.toolId,
        blobId: opts.blobId,
        node_id: nodeId,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      return { error: errBody.error || `http_${res.status}` };
    }
    return await res.json();
  } catch (err) {
    console.warn('[PrivacyClient] executeSealedTool failed:', err?.message || err);
    return { error: err?.message || 'network_error' };
  }
}

/**
 * Check status of a privacy task.
 * @param {string} taskId
 * @returns {{ status: string, progress?: number } | null}
 */
async function getPrivacyStatus(taskId) {
  if (!taskId) return null;
  try {
    const res = await fetch(privacyUrl(`/status/${encodeURIComponent(taskId)}`), {
      headers: buildHubHeaders(),
      signal: AbortSignal.timeout(PRIVACY_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Retrieve the encrypted result of a privacy task and decrypt it locally.
 * @param {string} taskId
 * @param {Buffer} key - the original encryption key
 * @returns {{ plaintext: Buffer, resultHash?: string } | null}
 */
async function getPrivacyResult(taskId, key) {
  if (!taskId || !key) return null;
  try {
    const res = await fetch(privacyUrl(`/result/${encodeURIComponent(taskId)}`), {
      headers: buildHubHeaders(),
      signal: AbortSignal.timeout(PRIVACY_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.encrypted_result_base64) return null;

    const packed = Buffer.from(data.encrypted_result_base64, 'base64');
    const parts = unpack(packed);
    const plaintext = decrypt(parts.ciphertext, key, parts.iv, parts.authTag);
    return { plaintext, resultHash: data.result_hash };
  } catch (err) {
    console.warn('[PrivacyClient] getPrivacyResult failed:', err?.message || err);
    return null;
  }
}

/**
 * List available sealed tool templates.
 * @returns {Array | null}
 */
async function getToolTemplates() {
  try {
    const res = await fetch(privacyUrl('/tool/templates'), {
      headers: buildHubHeaders(),
      signal: AbortSignal.timeout(PRIVACY_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.templates || data;
  } catch {
    return null;
  }
}

/**
 * Parse [PRIVACY_PARAMS] block from task body.
 * Returns { tool_id, blob_ids[] } or null if no block found.
 * @param {string} body
 * @returns {{ toolId: string, blobIds: string[] } | null}
 */
function parsePrivacyParams(body) {
  if (!body || typeof body !== 'string') return null;
  const start = body.indexOf('[PRIVACY_PARAMS]');
  const end = body.indexOf('[/PRIVACY_PARAMS]');
  if (start === -1 || end === -1 || end <= start) return null;

  const block = body.substring(start + '[PRIVACY_PARAMS]'.length, end).trim();
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
  const params = {};
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.substring(0, colon).trim();
    const val = line.substring(colon + 1).trim();
    params[key] = val;
  }

  if (!params.tool_id) return null;
  const blobIds = (params.blob_ids || '').split(',').map(s => s.trim()).filter(Boolean);
  return { toolId: params.tool_id, blobIds };
}

module.exports = {
  submitPrivacyTask,
  uploadEncryptedBlob,
  executeSealedTool,
  getPrivacyStatus,
  getPrivacyResult,
  getToolTemplates,
  parsePrivacyParams,
};
