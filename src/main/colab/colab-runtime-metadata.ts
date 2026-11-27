import { encodeJupyterPath } from './jupyter-server-protocol'
import { resolveColabRemoteDir } from './colab-drive-protocol'
import type { UploadAccess } from './runtime-file-upload'
import type { ColabSessionArtifact } from '../../shared/colab/colab-types'

// Both APIs are Jupyter server handlers: neither sends work to the notebook's kernel.
export async function readRuntimeMetadata(access: UploadAccess, path: string, signal: AbortSignal): Promise<unknown> {
  const endpoint = await access(signal)
  signal.throwIfAborted()
  const url = new URL(`${endpoint.baseUrl.replace(/\/+$/, '')}/${path}`)
  if (endpoint.proxyToken) {
    url.searchParams.set('authuser', '0')
    url.searchParams.set('colab-runtime-proxy-token', endpoint.proxyToken)
  }
  const response = await fetch(url, { headers: { Accept: 'application/json', ...endpoint.headers }, redirect: 'error', signal })
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw new Error(`Runtime metadata unavailable (${response.status}).`)
  }
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 2 * 1024 * 1024) {
        await reader.cancel()
        throw new Error('Runtime metadata too large.')
      }
      chunks.push(Buffer.from(value))
    }
    // google.colab._serverextension prefixes resource JSON (but not Contents JSON).
    return JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\)\]\}'\r?\n/, ''))
  } finally {
    reader.releaseLock()
  }
}

type DirectoryEntry = { name: string; type: string; size?: number; last_modified?: string }

async function listDirectory(access: UploadAccess, path: string, signal: AbortSignal): Promise<DirectoryEntry[]> {
  const data = await readRuntimeMetadata(access, `api/contents/${encodeJupyterPath(path)}?type=directory`, signal) as {
    content?: DirectoryEntry[]; type?: string
  } | null
  if (data?.type !== 'directory' || !Array.isArray(data.content)) return []
  return data.content.filter((item) => typeof item?.name === 'string' && item.name &&
    !item.name.startsWith('.') && !/[\\/]/.test(item.name) && ![...item.name].some((c) => c.charCodeAt(0) < 32))
}

// Match the bounded, two-level artifact listing used by the final download scan.
export async function listLiveArtifacts(access: UploadAccess, remoteDir: string, signal: AbortSignal): Promise<ColabSessionArtifact[]> {
  const root = resolveColabRemoteDir(remoteDir).slice(1)
  const entries = await listDirectory(access, root, signal)
  const items: ColabSessionArtifact[] = []
  function appendFiles(entries: DirectoryEntry[], prefix: string, limit: number): void {
    for (const f of entries.filter((entry) => entry.type === 'file' || entry.type === 'notebook')
      .sort((a, b) => a.name.localeCompare(b.name)).slice(0, Math.min(limit, 40 - items.length))) {
      const name = prefix + f.name
      items.push({ name, remotePath: `${root}/${name}`, sizeBytes: f.size ?? 0 })
    }
  }
  appendFiles(entries, '', 40)
  for (const d of entries.filter((entry) => entry.type === 'directory')
    .sort((a, b) => (b.last_modified ?? '').localeCompare(a.last_modified ?? '')).slice(0, 20)) {
    if (items.length >= 40) break
    appendFiles(await listDirectory(access, `${root}/${d.name}`, signal), `${d.name}/`, 8)
  }
  return items
}
