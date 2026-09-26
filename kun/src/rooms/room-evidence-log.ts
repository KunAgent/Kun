import { constants } from 'node:fs'
import { copyFile, link, mkdir, open, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, relative, isAbsolute, basename, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { isBackgroundShellOutputPath } from '../services/background-shell-output.js'
import type { RoomRuntimeDeps } from './room-runtime-types.js'
import { roomFingerprint } from './room-service.js'

export type StoredRoomLog = { file?: string; artifactId?: string; bytes: number; originalBytes?: number; truncated: boolean; reason?: string }
const inside = (root: string, path: string) => {
  const rel = relative(root, path)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')))
}
export async function preserveRoomLog(deps: Pick<RoomRuntimeDeps, 'dataDir' | 'artifacts'>, artifactId: string, callId: string, output: Record<string, unknown>,
  origin?: { nativeTool: boolean; threadId: string }): Promise<StoredRoomLog> {
  const directory = join(deps.dataDir, 'rooms', 'evidence')
  await mkdir(directory, { recursive: true })
  const dataRoot = await realpath(deps.dataDir)
  const canonical = await realpath(directory)
  if (!inside(dataRoot, canonical)) throw new Error('room evidence directory escapes runtime storage')
  const file = roomFingerprint({ artifactId, callId }) + '.log'
  const destination = join(canonical, file)
  const temporary = join(canonical, file + '.' + randomUUID() + '.tmp')
  let copied = false, reason: string | undefined = output._roomOutputUnavailable ?
    'The canonical output record was unavailable; command metadata is retained.' : undefined
  const candidate = output.output_file ?? output.full_output_path
  const nativePath = async (candidate: string) => {
    const source = await realpath(candidate)
    const foreground = dirname(source) === await realpath(tmpdir()) && /^kun-bash-[a-f0-9]{16}\.log$/.test(basename(source))
    const background = origin && isBackgroundShellOutputPath(source, { runtimeDataDir: dataRoot, threadId: origin.threadId }) &&
      basename(source) === String(output.session_id) + '.output'
    if (!origin?.nativeTool || (!foreground && !background) || !(await stat(source)).isFile()) throw new Error('log source is not a native execution output')
    return source
  }
  if (deps.artifacts) {
    // Production uses the existing Manager-owned artifact data plane. Each
    // retained output is bounded independently from its command's exit evidence.
    const cap = 8 * 1024 * 1024
    let text = [output.output, output.stdout, output.stderr].filter((value): value is string => typeof value === 'string').join('\n')
    let truncated = Boolean(output.output_truncated || output.truncation)
    let originalBytes = Buffer.byteLength(text)
    if (typeof candidate === 'string' && candidate) {
      try {
        const handle = await open(await nativePath(candidate), 'r')
        try {
          originalBytes = (await handle.stat()).size
          const buffer = Buffer.alloc(Math.min(originalBytes, cap))
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
          text = buffer.subarray(0, completePrefix(buffer.subarray(0, bytesRead))).toString('utf8')
          reason = undefined
          truncated = originalBytes > cap
        } finally { await handle.close() }
      } catch { reason = 'The original full output was unavailable; the retained excerpt is shown.'; truncated = true }
    }
    if (Buffer.byteLength(text) > cap) { text = roomTextPage(text, 0, cap).text; truncated = true }
    if (originalBytes > cap) reason = 'The retained output is limited to 8 MiB; the original output was larger.'
    try {
      const saved = await deps.artifacts.put({ content: text, mimeType: 'text/plain', source: 'bash',
        origin: 'rooms:' + artifactId, linkedOwners: ['rooms:' + artifactId], maxInlineChars: 0 })
      return { artifactId: saved.meta.id, bytes: saved.meta.byteSize, originalBytes, truncated, reason }
    } catch {
      return { bytes: 0, originalBytes, truncated: true, reason: 'The output archive was unavailable; execution evidence is retained separately.' }
    }
  }
  if (typeof candidate === 'string' && candidate) {
    try {
      const source = await nativePath(candidate)
      await copyFile(source, temporary, constants.COPYFILE_EXCL)
      const handle = await open(temporary, 'r')
      try { await handle.sync() } finally { await handle.close() }
      await link(temporary, destination)
      copied = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') copied = true
      else reason = 'The original full output file was unavailable; the recorded excerpt is preserved.'
    } finally { await rm(temporary, { force: true }) }
  }
  if (!copied) {
    const text = [output.output, output.stdout, output.stderr].filter((value): value is string => typeof value === 'string').join('\n')
    if (!text && !reason && ![output.output, output.stdout, output.stderr].some((value) => typeof value === 'string')) reason = 'No textual output was retained by this execution.'
    try {
      await writeFile(temporary, text, { flag: 'wx', mode: 0o600 })
      const handle = await open(temporary, 'r')
      try { await handle.sync() } finally { await handle.close() }
      await link(temporary, destination)
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    finally { await rm(temporary, { force: true }) }
  }
  return { file, bytes: (await stat(destination)).size,
    truncated: !copied && Boolean(output.output_truncated || output.truncation || (candidate && reason)), reason }
}
function completePrefix(buffer: Buffer) {
  let start = buffer.length - 1
  while (start >= 0 && (buffer[start] & 0xc0) === 0x80) start--
  if (start < 0) return buffer.length
  const byte = buffer[start]
  const width = byte < 0x80 ? 1 : byte < 0xe0 ? 2 : byte < 0xf0 ? 3 : 4
  return start + width > buffer.length ? start : buffer.length
}
export function roomTextPage(text: string, offset = 0, limit = 65536) {
  const bytes = Buffer.from(text)
  const slice = bytes.subarray(offset, offset + limit)
  const length = completePrefix(slice)
  return { text: slice.subarray(0, length).toString('utf8'), bytes: bytes.length,
    nextCursor: offset + length < bytes.length ? offset + length : undefined }
}
export async function readRoomLog(deps: Pick<RoomRuntimeDeps, 'dataDir' | 'artifacts'>, log: StoredRoomLog, offset = 0, limit = 65536) {
  if (log.artifactId) {
    const text = await deps.artifacts?.readRange(log.artifactId, { offset, length: limit })
    if (text === null || text === undefined) return { text: '', bytes: 0, missing: true, reason: 'The retained output artifact is unavailable.' }
    const consumed = Buffer.byteLength(text)
    return { text, bytes: log.bytes, nextCursor: offset + consumed < log.bytes ? offset + consumed : undefined,
      truncated: log.truncated, reason: log.reason, originalBytes: log.originalBytes }
  }
  if (!log.file) return { text: '', bytes: 0, missing: true, reason: log.reason ?? 'No retained output is available.' }
  if (!/^[a-f0-9]{64}\.log$/.test(log.file)) throw new Error('invalid room evidence reference')
  const directory = await realpath(join(deps.dataDir, 'rooms', 'evidence'))
  const path = await realpath(join(directory, log.file))
  if (!inside(await realpath(deps.dataDir), directory) || !inside(directory, path)) throw new Error('room evidence escaped runtime storage')
  const handle = await open(path, 'r')
  try {
    const size = (await handle.stat()).size
    const buffer = Buffer.alloc(Math.min(limit, Math.max(0, size - offset)))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
    const length = completePrefix(buffer.subarray(0, bytesRead))
    return { text: buffer.subarray(0, length).toString('utf8'), bytes: size,
      nextCursor: offset + length < size ? offset + length : undefined, truncated: log.truncated, reason: log.reason }
  } finally { await handle.close() }
}
