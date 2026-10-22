import {
  ComposerContextAttachmentSchema,
  type ComposerContextAttachment
} from '@kun/extension-api'
import { useChatStore } from '../store/chat-store'
import { workspaceRootScopeKey } from './workspace-path'

/**
 * Terminal output attached to the Code composer ("send to Kun"). Lines travel
 * as `> ` quoted chunks: composer-context strings are capped at 2,048
 * characters and may not start like an absolute path, and the whole reference
 * stays under 16 KB.
 */
export const TERMINAL_OUTPUT_KIND = 'terminal-output'
const MAX_CHUNK_CHARS = 1_900
const MAX_LINE_CHARS = 300
// UTF-8 bytes of quoted output; the rest of the reference fits in what remains of 16 KB.
const MAX_OUTPUT_BYTES = 13_000
const RELEVANT_PATTERN = /error|fail|✗|×|exception|traceback|panic|fatal|warn|expected|assert|denied|not found|cannot|undefined/i

export type TerminalOutputDraft = {
  source: 'command' | 'selection'
  command?: string
  exitCode?: number | null
  durationMs?: number
  /** Directory label (never absolute; `~/…` or the folder name). */
  cwdLabel?: string
  lines: string[]
}

export type TerminalOutputDisplay = {
  source: 'command' | 'selection'
  command?: string
  exitCode?: number | null
  lineCount: number
  preview: string[]
  omitted: number
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Keep failure-relevant lines (with two lines of context), the first lines
 * and the tail; gaps become one "… N lines" marker.
 */
export function selectRelevantLines(lines: readonly string[]): { lines: string[]; omitted: number } {
  if (lines.length <= 40) return { lines: [...lines], omitted: 0 }
  const keep = new Set<number>()
  for (let index = 0; index < 2; index += 1) keep.add(index)
  for (let index = Math.max(0, lines.length - 12); index < lines.length; index += 1) keep.add(index)
  lines.forEach((line, index) => {
    if (!RELEVANT_PATTERN.test(line)) return
    for (let offset = -2; offset <= 2; offset += 1) {
      if (index + offset >= 0 && index + offset < lines.length) keep.add(index + offset)
    }
  })
  const result: string[] = []
  let omitted = 0
  let gap = 0
  lines.forEach((line, index) => {
    if (keep.has(index)) {
      if (gap) result.push(`… ${gap} lines omitted`)
      gap = 0
      result.push(line)
    } else {
      gap += 1
      omitted += 1
    }
  })
  if (gap) result.push(`… ${gap} lines omitted`)
  return { lines: result, omitted }
}

const encoder = new TextEncoder()
function lineBytes(line: string): number {
  return encoder.encode(line).byteLength + 3
}

/** Head and tail within the byte budget. */
function fitBudget(lines: readonly string[]): { lines: string[]; truncated: boolean } {
  const clipped = lines.map((line) => line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line)
  const total = clipped.reduce((sum, line) => sum + lineBytes(line), 0)
  if (total <= MAX_OUTPUT_BYTES) return { lines: clipped, truncated: false }
  const head: string[] = []
  const tail: string[] = []
  let used = 0
  for (let index = 0; index < clipped.length && used + lineBytes(clipped[index]!) < MAX_OUTPUT_BYTES * 0.3; index += 1) {
    head.push(clipped[index]!)
    used += lineBytes(clipped[index]!)
  }
  for (let index = clipped.length - 1; index >= head.length && used + lineBytes(clipped[index]!) < MAX_OUTPUT_BYTES; index -= 1) {
    tail.unshift(clipped[index]!)
    used += lineBytes(clipped[index]!)
  }
  const skipped = clipped.length - head.length - tail.length
  return { lines: skipped > 0 ? [...head, `… ${skipped} lines omitted`, ...tail] : [...head, ...tail], truncated: skipped > 0 }
}

export function chunkQuotedLines(lines: readonly string[]): string[] {
  const chunks: string[] = []
  let current = ''
  for (const line of lines) {
    const quoted = line ? `> ${line}` : '>'
    if (current && current.length + quoted.length + 1 > MAX_CHUNK_CHARS) {
      chunks.push(current)
      current = ''
    }
    current = current ? `${current}\n${quoted}` : quoted.slice(0, MAX_CHUNK_CHARS)
  }
  if (current) chunks.push(current)
  return chunks
}

export async function createTerminalOutputAttachment(input: {
  workspaceRoot: string
  draft: TerminalOutputDraft
  now?: number
}): Promise<ComposerContextAttachment> {
  const { draft } = input
  const fitted = fitBudget(draft.lines)
  const chunks = chunkQuotedLines(fitted.lines)
  const workspaceId = await sha256Hex(input.workspaceRoot.trim() || '__default__')
  const command = draft.command?.trim() ? `$ ${draft.command.trim()}`.slice(0, 500) : undefined
  const identity = await sha256Hex(JSON.stringify({ workspaceId, command, chunks }))
  const title = draft.source === 'selection'
    ? 'Terminal selection'
    : (command ? command.slice(2, 120) : 'Terminal output')
  const status = typeof draft.exitCode === 'number' ? `exit ${draft.exitCode}` : draft.source === 'selection' ? 'selection' : 'output'
  return ComposerContextAttachmentSchema.parse({
    schemaVersion: 1,
    id: `terminal-output-${identity.slice(0, 24)}`,
    title,
    summary: `Terminal ${status} · ${draft.lines.length} lines${draft.cwdLabel ? ` · ${draft.cwdLabel}` : ''}`,
    reference: {
      kind: TERMINAL_OUTPUT_KIND,
      schemaVersion: 1,
      source: draft.source,
      ...(command ? { command } : {}),
      ...(typeof draft.exitCode === 'number' ? { exitCode: draft.exitCode } : {}),
      ...(typeof draft.durationMs === 'number' ? { durationMs: Math.round(draft.durationMs) } : {}),
      ...(draft.cwdLabel && !draft.cwdLabel.startsWith('/') ? { directory: draft.cwdLabel.slice(0, 200) } : {}),
      lineCount: draft.lines.length,
      truncated: fitted.truncated,
      output: chunks
    },
    revision: Math.max(0, Math.floor(input.now ?? Date.now())),
    generation: 0,
    attachmentId: `workspace-selection-context:${identity}`,
    provenance: { source: 'workspace-selection', workspaceId }
  })
}

/** Chip data rebuilt from an attached reference. */
export function terminalOutputFromComposerContext(attachment: ComposerContextAttachment): TerminalOutputDisplay | null {
  const reference = attachment.reference as Record<string, unknown>
  if (reference.kind !== TERMINAL_OUTPUT_KIND || !Array.isArray(reference.output)) return null
  const lines = reference.output
    .filter((chunk): chunk is string => typeof chunk === 'string')
    .flatMap((chunk) => chunk.split('\n').map((line) => line.replace(/^> ?/, '')))
  return {
    source: reference.source === 'selection' ? 'selection' : 'command',
    ...(typeof reference.command === 'string' ? { command: reference.command.replace(/^\$ /, '') } : {}),
    ...(typeof reference.exitCode === 'number' ? { exitCode: reference.exitCode } : {}),
    lineCount: typeof reference.lineCount === 'number' ? reference.lineCount : lines.length,
    preview: lines,
    omitted: 0
  }
}

function activeComposerWorkspaceRoot(): string {
  const state = useChatStore.getState()
  const threadWorkspace = state.activeThreadId
    ? state.threads.find((thread) => thread.id === state.activeThreadId)?.workspace
    : undefined
  return threadWorkspace?.trim() || state.workspaceRoot.trim()
}

/**
 * Attach to the Code composer. Fails (returns false) outside the Code chat or
 * when the terminal belongs to a different workspace than the composer.
 */
export async function attachTerminalOutput(input: {
  workspaceRoot: string
  draft: TerminalOutputDraft
}): Promise<boolean> {
  const initial = useChatStore.getState()
  const workspaceRoot = input.workspaceRoot.trim() || activeComposerWorkspaceRoot()
  if (initial.route !== 'chat' || workspaceRootScopeKey(workspaceRoot) !== workspaceRootScopeKey(activeComposerWorkspaceRoot())) return false
  const threadId = initial.activeThreadId ?? undefined
  const attachment = await createTerminalOutputAttachment({ workspaceRoot, draft: input.draft })
  const state = useChatStore.getState()
  if (state.route !== 'chat' || state.activeThreadId !== (threadId ?? null)) return false
  state.attachComposerContext({ workspaceRoot, threadId, attachment })
  const attached = useChatStore.getState().extensionComposerContexts.some(
    (event) => event.attachment.attachmentId === attachment.attachmentId
  )
  if (attached) {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>('[data-primary-floating-composer] .ds-composer-textarea, .ds-floating-composer .ds-composer-textarea')?.focus()
    })
  }
  return attached
}
