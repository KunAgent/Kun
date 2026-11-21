import { randomUUID } from 'node:crypto'
import { open } from 'node:fs/promises'
import { basename, posix } from 'node:path'
import type { RuntimeUploadProgress, RuntimeUploadResult } from '../../shared/colab/runtime-upload'
import { encodeJupyterPath } from './jupyter-server-protocol'

export const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024
const METADATA_LIMIT = 128 * 1024

export type UploadAccess = (signal: AbortSignal) => Promise<{
  baseUrl: string
  headers?: Record<string, string>
  proxyToken?: string
}>
export type UploadOptions = {
  signal?: AbortSignal
  onProgress?: (progress: RuntimeUploadProgress) => void
}
type FileModel = { path?: string; type?: string; size?: number | null }

async function readModel(response: Response): Promise<FileModel> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Missing file metadata.')
  const chunks: Buffer[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > METADATA_LIMIT) throw new Error('Unexpectedly large file metadata.')
      chunks.push(Buffer.from(value))
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as FileModel
  } catch {
    await reader.cancel().catch(() => undefined)
    throw new Error('The runtime did not return valid file metadata.')
  } finally {
    reader.releaseLock()
  }
}

export async function uploadRuntimeFiles(
  files: readonly { localPath: string; remotePath: string }[],
  access: UploadAccess,
  { signal, onProgress }: UploadOptions = {},
  fetchImpl: typeof fetch = fetch
): Promise<RuntimeUploadResult> {
  const directories = new Set<string>()
  let uploadedCount = 0
  let fileName = ''

  async function request(method: string, path: string, body?: object, cleanup = false): Promise<FileModel | null> {
    const timeout = AbortSignal.timeout(cleanup ? 10_000 : 180_000)
    const requestSignal = signal && !cleanup ? AbortSignal.any([signal, timeout]) : timeout
    const endpoint = await access(requestSignal)
    const url = new URL(`${endpoint.baseUrl.replace(/\/+$/, '')}/api/contents/${encodeJupyterPath(path)}`)
    if (method === 'GET') url.searchParams.set('content', '0')
    if (endpoint.proxyToken) {
      url.searchParams.set('authuser', '0')
      url.searchParams.set('colab-runtime-proxy-token', endpoint.proxyToken)
    }
    const res = await fetchImpl(url.toString(), {
      method,
      headers: { Accept: 'application/json', ...(body && { 'Content-Type': 'application/json' }), ...endpoint.headers },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
      signal: requestSignal
    }).catch(() => { throw new Error('Could not reach the runtime. Check the connection and try again.') })
    if (!res.ok || method === 'DELETE') {
      await res.body?.cancel()
      if (method === 'GET' && res.status === 404) return null
      if (!res.ok) throw new Error(`Runtime file request failed (HTTP ${res.status}).`)
      return null
    }
    const model = await readModel(res)
    if (!model || model.path !== (method === 'PATCH' ? (body as { path: string }).path : path)) {
      throw new Error('The runtime did not confirm the expected file path.')
    }
    return model
  }

  async function ensureParents(path: string): Promise<void> {
    const parent = posix.dirname(path)
    if (parent === '.' || directories.has(parent)) return
    await ensureParents(parent)
    const dir = await request('GET', parent) ?? await request('PUT', parent, { type: 'directory' })
    if (dir?.type !== 'directory') throw new Error('The upload destination is not a directory.')
    directories.add(parent)
  }

  try {
    for (const { localPath, remotePath } of files) {
      signal?.throwIfAborted()
      fileName = basename(localPath)
      if (remotePath.includes('\\') || remotePath.split('/').some((s) => !s || s === '.' || s === '..')) {
        throw new Error('Invalid runtime file path.')
      }
      const handle = await open(localPath, 'r')
      let temporaryPath: string | undefined
      try {
        const source = await handle.stat()
        if (!source.isFile()) throw new Error('Select a regular file.')
        const report = (transferredBytes: number): void => onProgress?.({
          fileName, fileIndex: uploadedCount + 1, fileCount: files.length, transferredBytes, totalBytes: source.size
        })
        report(0)
        await ensureParents(remotePath)
        const multipart = source.size > UPLOAD_CHUNK_BYTES
        if (multipart) {
          if (await request('GET', remotePath)) throw new Error('A file with this name already exists. Choose a different name.')
          // Ordinary FileContentsManager accepts chunked PUTs but silently overwrites each chunk.
          // Stage under a unique, non-hidden name until the server confirms the cumulative size.
          temporaryPath = posix.join(posix.dirname(remotePath), `kun-upload-${randomUUID()}.part`)
        }
        const path = temporaryPath ?? remotePath
        const buffer = Buffer.allocUnsafe(Math.min(source.size, UPLOAD_CHUNK_BYTES))
        let offset = 0
        let index = 0
        do {
          signal?.throwIfAborted()
          const length = Math.min(buffer.length, source.size - offset)
          let filled = 0
          while (filled < length) {
            const { bytesRead } = await handle.read(buffer, filled, length - filled, offset + filled)
            if (!bytesRead) throw new Error('The local file changed during upload.')
            filled += bytesRead
          }
          offset += length
          index += 1
          const model = await request('PUT', path, {
            type: 'file', format: 'base64', content: buffer.subarray(0, length).toString('base64'),
            ...(multipart && { chunk: offset === source.size ? -1 : index })
          })
          if (typeof model?.size === 'number' && model.size !== offset) {
            throw new Error('The runtime did not store the expected number of bytes. Check chunked upload support.')
          }
          report(offset)
        } while (offset < source.size)
        if (temporaryPath) {
          const saved = await request('GET', temporaryPath)
          const current = await handle.stat()
          if (saved?.size !== source.size || current.size !== source.size || current.mtimeMs !== source.mtimeMs) {
            throw new Error('The uploaded size or local file changed. The model was not published.')
          }
          await request('PATCH', temporaryPath, { path: remotePath })
          temporaryPath = undefined
        }
        uploadedCount += 1
      } finally {
        await handle.close()
        // Never delete a destination, even if the response to the final rename was lost.
        if (temporaryPath) await request('DELETE', temporaryPath, undefined, true).catch(() => undefined)
      }
    }
    return { ok: true, uploadedCount }
  } catch (error) {
    if (signal?.aborted) return { ok: false, canceled: true, uploadedCount }
    const detail = error instanceof Error ? error.message : 'Upload failed.'
    return { ok: false, message: fileName ? `${fileName}: ${detail}` : detail, uploadedCount }
  }
}
