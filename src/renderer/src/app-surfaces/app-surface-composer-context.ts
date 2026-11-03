import {
  ComposerContextAttachmentSchema,
  type ComposerContextAttachment,
  type JsonObject
} from '@kun/extension-api'
import { useChatStore } from '../store/chat-store'

const MAX_CHUNK_CHARS = 1_800
const MAX_CHUNKS = 7

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Page-provided JSON is untrusted and may not satisfy the composer context
 * reference rules (string length, path-like keys). Fall back to bounded JSON
 * text chunks so the model still sees the data without structural tricks.
 */
function safeReference(kind: string, label: string, data: unknown): JsonObject {
  const structured: JsonObject = { kind, source: label, data: data as JsonObject }
  if (ComposerContextAttachmentSchema.shape.reference.safeParse(structured).success) return structured
  const serialized = JSON.stringify(data ?? null) ?? 'null'
  const chunks: string[] = []
  for (let offset = 0; offset < serialized.length && chunks.length < MAX_CHUNKS; offset += MAX_CHUNK_CHARS) {
    chunks.push(`#${chunks.length + 1} ${serialized.slice(offset, offset + MAX_CHUNK_CHARS)}`)
  }
  return { kind, source: label, json: chunks, truncated: serialized.length > MAX_CHUNK_CHARS * MAX_CHUNKS }
}

/**
 * Attach (or replace) one app-surface context chip for the next message in a
 * thread. `key` identifies the producer so later updates replace the chip.
 */
export async function attachAppSurfaceContext(input: {
  threadId: string
  workspaceRoot: string
  key: string
  kind: 'gen-ui-state' | 'mcp-app-context'
  title: string
  summary: string
  label: string
  data: unknown
}): Promise<boolean> {
  const workspaceId = await sha256Hex(input.workspaceRoot.trim() || '__default__')
  const identity = await sha256Hex(JSON.stringify({ workspaceId, threadId: input.threadId, key: input.key }))
  const parsed = ComposerContextAttachmentSchema.safeParse({
    schemaVersion: 1,
    id: `app-${input.kind}-${identity.slice(0, 24)}`,
    title: input.title.trim().slice(0, 128) || 'App context',
    summary: input.summary.trim().slice(0, 1_024) || input.title.trim().slice(0, 128) || 'App context',
    reference: safeReference(input.kind, input.label.slice(0, 200), input.data),
    revision: Date.now(),
    generation: 0,
    attachmentId: `workspace-view-context:${identity}`,
    provenance: { source: 'workspace-view', workspaceId }
  })
  if (!parsed.success) return false
  const attachment: ComposerContextAttachment = parsed.data
  useChatStore.getState().attachComposerContext({
    workspaceRoot: input.workspaceRoot,
    threadId: input.threadId,
    attachment
  })
  return true
}

export function threadWorkspaceRoot(threadId: string): string {
  const state = useChatStore.getState()
  return state.threads.find((thread) => thread.id === threadId)?.workspace?.trim() ||
    state.workspaceRoot?.trim() || ''
}
