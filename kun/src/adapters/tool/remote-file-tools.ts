/**
 * Target-aware file tools (Issue #647, fixes the local/remote split).
 *
 * When a thread is bound to an SSH target, read/write/edit/ls/find/grep must run
 * on the REMOTE host — not the local machine — otherwise the agent reads local
 * code, edits local files, but runs commands on the server (a dangerous
 * environment split). These helpers implement each file op over the system ssh
 * executor using portable POSIX commands, apply the protected-path guard
 * (deny → error, confirm → real approval BEFORE the op), and tag every result
 * with the target/host/remote dir so the model never confuses environments.
 */

import type { RemoteExecutionHandle, RemoteFileOperation } from '../../ports/remote-execution.js'
import { createHash } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { createApprovalRequest } from '../../domain/approval.js'
import { shellQuoteRemote } from '../../remote/ssh-command.js'
import { isSshTarget } from '../../remote/remote-target.js'
import {
  applyEditsToNormalizedContent,
  detectLineEnding,
  firstChangedLine,
  generateDisplayDiff,
  generateUnifiedPatch,
  normalizeToLF,
  restoreLineEndings,
  stripBom
} from './edit-diff.js'
import { parseEditInstructions } from './builtin-tool-utils.js'

export type RemoteFileToolResult = { output: Record<string, unknown>; isError?: boolean }

const REMOTE_READ_BYTE_CAP = 1_048_576 // 1 MiB safety cap on remote read output.

function targetMeta(handle: RemoteExecutionHandle): { target: 'ssh'; host: string; remoteDir?: string } {
  const target = handle.describe().target
  return {
    target: 'ssh',
    host: isSshTarget(target) ? target.alias : 'local',
    ...(isSshTarget(target) && target.remoteDir ? { remoteDir: target.remoteDir } : {})
  }
}

/**
 * Apply the unified run-mode + protected-path gate. Returns a blocking result
 * when the op must not proceed (deny, or a confirm the user rejected);
 * undefined means proceed. EVERY remote file op routes through here so the
 * observe-mode mutation block and the protected-path policy are enforced in one
 * place (including list/search, so secrets cannot be probed via grep/find).
 */
async function gateRemoteFile(
  handle: RemoteExecutionHandle,
  context: ToolHostContext,
  operation: RemoteFileOperation,
  path: string,
  recursive = false
): Promise<RemoteFileToolResult | undefined> {
  const guard = handle.guardFile({ operation, path, recursive })
  const meta = targetMeta(handle)
  if (guard.decision === 'deny') {
    return { output: { ...meta, path, operation, decision: 'deny', error: `blocked: ${guard.reasons.join('; ')}` }, isError: true }
  }
  if (guard.decision === 'confirm') {
    const mutates = operation === 'create' || operation === 'write' || operation === 'edit' || operation === 'delete'
    const approval = createApprovalRequest({
      id: `appr_remotefile_${context.turnId}_${Math.random().toString(36).slice(2, 8)}`,
      threadId: context.threadId,
      turnId: context.turnId,
      toolName: mutates ? 'edit' : 'read',
      summary: `${operation} protected remote path on ${meta.host}: ${path}\nRisk: ${guard.reasons.join('; ')}`
    })
    const decision = await context.awaitApproval(approval)
    if (decision !== 'allow') {
      return { output: { ...meta, path, operation, decision: 'confirm', approved: false, error: 'remote file access was not approved' }, isError: true }
    }
  }
  return undefined
}

function statusUnknownResult(meta: Record<string, unknown>, path: string, stderr: string): RemoteFileToolResult {
  return {
    output: { ...meta, path, statusUnknown: true, stderr, note: 'connection dropped before the result was confirmed; not auto-replayed' },
    isError: true
  }
}

export async function remoteRead(handle: RemoteExecutionHandle, args: Record<string, unknown>, context: ToolHostContext): Promise<RemoteFileToolResult> {
  const path = typeof args.path === 'string' ? args.path.trim() : ''
  if (!path) return { output: { error: 'path is required' }, isError: true }
  const blocked = await gateRemoteFile(handle, context, 'read', path)
  if (blocked) return blocked
  const meta = targetMeta(handle)
  const q = shellQuoteRemote(path)
  const offset = toPositiveInt(args.offset)
  const limit = toPositiveInt(args.limit)
  // Read the file DIRECTLY (no `cat | head` pipe): a pipe would mask a missing
  // file because the pipe's exit status is `head`'s success. `head`/`sed` open
  // the file themselves and exit non-zero when it is absent.
  const command = offset || limit
    ? `sed -n ${shellQuoteRemote(`${offset ?? 1},${(offset ?? 1) + (limit ?? 2000) - 1}p`)} -- ${q}`
    : `head -c ${REMOTE_READ_BYTE_CAP + 1} -- ${q}`
  const result = await handle.exec(command, { ...(context.abortSignal ? { signal: context.abortSignal } : {}) })
  if (result.statusUnknown) return statusUnknownResult(meta, path, result.stderr)
  if (result.exitCode !== 0) {
    return { output: { ...meta, path, error: result.stderr.trim() || `read failed (exit ${result.exitCode})` }, isError: true }
  }
  // Byte-cap the line-window output in JS (the executor also caps overall).
  let stdout = result.stdout
  let truncated = result.truncated === true
  if (Buffer.byteLength(stdout, 'utf8') > REMOTE_READ_BYTE_CAP) {
    const decoder = new StringDecoder('utf8')
    stdout = decoder.write(Buffer.from(stdout, 'utf8').subarray(0, REMOTE_READ_BYTE_CAP))
    truncated = true
  }
  const content = stdout.replace(/\r\n/g, '\n')
  return {
    output: {
      ...meta,
      path,
      content: truncated ? `${content}\n\n[truncated at ${REMOTE_READ_BYTE_CAP} bytes — use offset/limit for a specific range]` : content,
      truncated,
      ...(offset ? { start_line: offset } : {})
    }
  }
}

export async function remoteWrite(handle: RemoteExecutionHandle, args: Record<string, unknown>, context: ToolHostContext): Promise<RemoteFileToolResult> {
  const path = typeof args.path === 'string' ? args.path.trim() : ''
  const content = typeof args.content === 'string' ? args.content : null
  if (!path || content == null) return { output: { error: 'path and content are required' }, isError: true }
  const blocked = await gateRemoteFile(handle, context, 'write', path)
  if (blocked) return blocked
  const meta = targetMeta(handle)
  const q = shellQuoteRemote(path)
  const command = atomicReplaceCommand(q)
  const result = await handle.exec(command, {
    input: content,
    ...(context.abortSignal ? { signal: context.abortSignal } : {})
  })
  if (result.statusUnknown) return statusUnknownResult(meta, path, result.stderr)
  if (result.exitCode !== 0) {
    return { output: { ...meta, path, error: result.stderr.trim() || `write failed (exit ${result.exitCode})` }, isError: true }
  }
  return { output: { ...meta, path, bytes_written: Buffer.byteLength(content, 'utf8') } }
}

export async function remoteEdit(handle: RemoteExecutionHandle, args: Record<string, unknown>, context: ToolHostContext): Promise<RemoteFileToolResult> {
  const path = typeof args.path === 'string' ? args.path.trim() : ''
  const edits = parseEditInstructions(args)
  if (!path || edits.length === 0) return { output: { error: 'path and at least one edit are required' }, isError: true }
  const blocked = await gateRemoteFile(handle, context, 'edit', path)
  if (blocked) return blocked
  const meta = targetMeta(handle)
  const q = shellQuoteRemote(path)
  // Read the CURRENT content directly (no `| head` cap): edit must operate on
  // the whole file, then write it back. Capping the read would silently
  // truncate any file larger than the cap on write-back (data loss). Instead we
  // read in full and REFUSE the edit if the executor reports truncation.
  const readResult = await handle.exec(`cat -- ${q}`, { ...(context.abortSignal ? { signal: context.abortSignal } : {}) })
  if (readResult.statusUnknown) return statusUnknownResult(meta, path, readResult.stderr)
  if (readResult.exitCode !== 0) {
    return { output: { ...meta, path, error: readResult.stderr.trim() || `edit read failed (exit ${readResult.exitCode})` }, isError: true }
  }
  if (readResult.truncated) {
    return {
      output: { ...meta, path, error: 'file is too large to edit safely over SSH (read was truncated); refusing to avoid data loss. Edit it on the remote host or split the change.' },
      isError: true
    }
  }
  const { bom, text: source } = stripBom(readResult.stdout)
  const lineEnding = detectLineEnding(source)
  const normalizedSource = normalizeToLF(source)
  let applied: { baseContent: string; newContent: string }
  try {
    applied = applyEditsToNormalizedContent(normalizedSource, edits, path)
  } catch (error) {
    return { output: { ...meta, path, error: error instanceof Error ? error.message : String(error) }, isError: true }
  }
  const next = bom + restoreLineEndings(applied.newContent, lineEnding)
  const expectedHash = createHash('sha256').update(readResult.stdout, 'utf8').digest('hex')
  const writeResult = await handle.exec(atomicReplaceCommand(q, expectedHash), {
    input: next,
    ...(context.abortSignal ? { signal: context.abortSignal } : {})
  })
  if (writeResult.statusUnknown) return statusUnknownResult(meta, path, writeResult.stderr)
  if (writeResult.exitCode === 65 || writeResult.stderr.includes('REMOTE_EDIT_CONFLICT')) {
    return {
      output: { ...meta, path, conflict: true, error: 'remote file changed since it was read; edit refused to avoid overwriting the out-of-band change. Re-read the file and re-apply.' },
      isError: true
    }
  }
  if (writeResult.exitCode !== 0) {
    return { output: { ...meta, path, error: writeResult.stderr.trim() || `edit write failed (exit ${writeResult.exitCode})` }, isError: true }
  }
  return {
    output: {
      ...meta,
      path,
      replacements: edits.length,
      bytes_written: Buffer.byteLength(next, 'utf8'),
      diff: generateDisplayDiff(applied.baseContent, applied.newContent),
      patch: generateUnifiedPatch(path, applied.baseContent, applied.newContent),
      first_changed_line: firstChangedLine(applied.baseContent, applied.newContent)
    }
  }
}

/**
 * Read stdin into a same-directory temporary file and atomically rename it over
 * the target. For edits, verify the previously-read SHA-256 under a cooperative
 * lock immediately before rename. The lock prevents Kun writers racing each
 * other; the hash detects unrelated writers before replacement.
 */
function atomicReplaceCommand(quotedPath: string, expectedHash?: string): string {
  const verify = expectedHash
    ? `actual=$(if command -v sha256sum >/dev/null 2>&1; then sha256sum -- ${quotedPath} | awk '{print $1}'; else shasum -a 256 -- ${quotedPath} | awk '{print $1}'; fi) && ` +
      `if [ "$actual" != ${shellQuoteRemote(expectedHash)} ]; then echo REMOTE_EDIT_CONFLICT >&2; exit 65; fi && `
    : ''
  return `d=$(dirname -- ${quotedPath}) && b=$(basename -- ${quotedPath}) && mkdir -p -- "$d" && ` +
    `tmp=$(mktemp "$d/.${'$'}b.kun.XXXXXX") && lock=${quotedPath}.kun-lock && ` +
    `cleanup(){ rm -f -- "$tmp"; rmdir -- "$lock" 2>/dev/null || true; }; trap cleanup EXIT HUP INT TERM && ` +
    `cat > "$tmp" && if ! mkdir -- "$lock" 2>/dev/null; then echo REMOTE_EDIT_BUSY >&2; exit 75; fi && ` +
    verify +
    `if [ -e ${quotedPath} ]; then mode=$(stat -c %a -- ${quotedPath} 2>/dev/null || stat -f %Lp -- ${quotedPath}) && chmod "$mode" "$tmp"; fi && ` +
    `mv -f -- "$tmp" ${quotedPath}`
}

export async function remoteLs(handle: RemoteExecutionHandle, args: Record<string, unknown>, context: ToolHostContext): Promise<RemoteFileToolResult> {
  const path = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : '.'
  const limit = toPositiveInt(args.limit) ?? 500
  const blocked = await gateRemoteFile(handle, context, 'list', path)
  if (blocked) return blocked
  const meta = targetMeta(handle)
  // Run `ls` DIRECTLY (no `| head` pipe): a pipe masks ls's exit status (the
  // pipeline reports head's success), so a missing dir or a permission-denied
  // would look like an empty listing. Cap the line count in JS instead.
  const command = `ls -1Ap -- ${shellQuoteRemote(path)}`
  const result = await handle.exec(command, { ...(context.abortSignal ? { signal: context.abortSignal } : {}) })
  if (result.statusUnknown) return statusUnknownResult(meta, path, result.stderr)
  if (result.exitCode !== 0) {
    return { output: { ...meta, path, error: result.stderr.trim() || `ls failed (exit ${result.exitCode})` }, isError: true }
  }
  const allNames = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  const names = allNames.slice(0, limit)
  return { output: { ...meta, path, names, truncated: allNames.length > limit || result.truncated === true } }
}

export async function remoteFind(handle: RemoteExecutionHandle, args: Record<string, unknown>, context: ToolHostContext): Promise<RemoteFileToolResult> {
  const pattern = typeof args.pattern === 'string' ? args.pattern.trim() : ''
  if (!pattern) return { output: { error: 'pattern is required' }, isError: true }
  const path = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : '.'
  const limit = toPositiveInt(args.limit) ?? 200
  const blocked = await gateRemoteFile(handle, context, 'search', path, true)
  if (blocked) return blocked
  const meta = targetMeta(handle)
  const flag = pattern.includes('/') ? '-path' : '-name'
  const findPattern = pattern.includes('/') ? `*${pattern}*` : pattern
  // Run `find` DIRECTLY: no `| head` (which would mask find's exit status) and
  // no `2>/dev/null` (which would silently hide a bad path / permission error).
  // `find` still lists accessible files even when a subdir is unreadable and
  // exits non-zero, so a non-zero exit with matches is a partial-success
  // warning, while a non-zero exit with NO matches is a real error.
  const command = `find ${shellQuoteRemote(path)} -type f ${flag} ${shellQuoteRemote(findPattern)}`
  const result = await handle.exec(command, { ...(context.abortSignal ? { signal: context.abortSignal } : {}) })
  if (result.statusUnknown) return statusUnknownResult(meta, path, result.stderr)
  const allMatches = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  if (result.exitCode !== 0 && allMatches.length === 0) {
    return { output: { ...meta, path, pattern, error: result.stderr.trim() || `find failed (exit ${result.exitCode})` }, isError: true }
  }
  const matches = allMatches.slice(0, limit)
  return {
    output: {
      ...meta,
      path,
      pattern,
      matches,
      backend: 'find',
      truncated: allMatches.length > limit || result.truncated === true,
      ...(result.exitCode !== 0 && result.stderr.trim() ? { warning: result.stderr.trim() } : {})
    }
  }
}

export async function remoteGrep(handle: RemoteExecutionHandle, args: Record<string, unknown>, context: ToolHostContext): Promise<RemoteFileToolResult> {
  const pattern = typeof args.pattern === 'string' ? args.pattern : ''
  if (!pattern.trim()) return { output: { error: 'pattern is required' }, isError: true }
  const path = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : '.'
  const limit = toPositiveInt(args.limit) ?? 200
  const ignoreCase = args.ignoreCase === true
  const literal = args.literal === true
  const blocked = await gateRemoteFile(handle, context, 'search', path, true)
  if (blocked) return blocked
  const meta = targetMeta(handle)
  const flags = ['-rnI', ignoreCase ? '-i' : '', literal ? '-F' : '-E'].filter(Boolean).join(' ')
  // Run `grep` DIRECTLY: no `| head` (masks grep's exit) and no `2>/dev/null`
  // (hides real errors). grep's exit code is meaningful: 0 = matches found,
  // 1 = no matches (NOT an error here), >=2 = a real error (bad path, bad
  // regex, unreadable file). Cap the line count in JS.
  const command = `grep ${flags} -- ${shellQuoteRemote(pattern)} ${shellQuoteRemote(path)}`
  const result = await handle.exec(command, { ...(context.abortSignal ? { signal: context.abortSignal } : {}) })
  if (result.statusUnknown) return statusUnknownResult(meta, path, result.stderr)
  if (result.exitCode !== null && result.exitCode >= 2) {
    return { output: { ...meta, path, pattern, error: result.stderr.trim() || `grep failed (exit ${result.exitCode})` }, isError: true }
  }
  const allRows = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  const matches = allRows.slice(0, limit).map((row) => {
    const parsed = row.match(/^(.*?):(\d+):(.*)$/)
    return parsed ? { path: parsed[1], line: Number(parsed[2]), text: parsed[3] } : { text: row }
  })
  return {
    output: {
      ...meta,
      path,
      pattern,
      ignore_case: ignoreCase,
      literal,
      backend: 'grep',
      matches,
      truncated: allRows.length > limit || result.truncated === true
    }
  }
}

function toPositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
}
