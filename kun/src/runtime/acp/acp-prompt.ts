/**
 * `session/prompt` block assembly (docs/ade/03 §6 `buildPromptBlocks`).
 * Ordering: deterministic handoff brief → instruction blocks + user request →
 * image/file payloads → client-surface instruction last. The harness's own
 * system prompt is never touched — Kun's per-turn instructions arrive as
 * trailing text blocks instead.
 */
import { isPathInsideOrEqual } from '../../adapters/tool/workspace-path.js'
import type { UserTurnItem } from '../../contracts/items.js'

export type AcpPromptContentBlock = { type: string } & Record<string, unknown>

export type AcpPromptInput = {
  /** Deterministic handoff brief; present only when the session is fresh. */
  handoffBrief?: string
  /** Portable transcript fallback when the deterministic handoff is disabled. */
  historyTranscript?: string
  /** Per-turn instruction text (thread prompt, persona, goal instructions). */
  instructionBlocks: readonly string[]
  /** userMessageTextWithComposerContexts output. */
  userText: string
  /** Base64 payloads when the agent advertises promptCapabilities.image. */
  images: readonly { mediaType: string; base64: string }[]
  /**
   * Attachment display names/paths for the no-image-capability fallback:
   * the model gets a file-path hint instead of binary data (02 §6.2).
   */
  attachmentPaths: readonly string[]
  imageCapable: boolean
  /** Workspace-contained file references → resource_link blocks. */
  fileReferences: readonly UserFileRef[]
  workspacePath?: string
  clientSurfaceInstruction?: string
}

type UserFileRef = { path: string; relativePath?: string; name?: string; kind?: 'file' | 'directory' }

export function buildAcpPromptBlocks(input: AcpPromptInput): AcpPromptContentBlock[] {
  const blocks: AcpPromptContentBlock[] = []
  const handoff = input.handoffBrief?.trim()
  if (handoff) {
    blocks.push({ type: 'text', text: handoff })
  }

  const textSections: string[] = []
  if (!handoff && input.historyTranscript?.trim()) {
    textSections.push(
      [
        'Earlier conversation in this thread (context — continue it; do not restart):',
        '<prior_conversation>',
        input.historyTranscript.trim(),
        '</prior_conversation>'
      ].join('\n')
    )
  }
  const instructions = input.instructionBlocks
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
  if (instructions.length) textSections.push(instructions.join('\n\n'))
  const userText = input.userText.trim()
  if (userText) {
    textSections.push(
      textSections.length > 0 ? `Current request:\n${userText}` : userText
    )
  }
  if (textSections.length) {
    blocks.push({ type: 'text', text: textSections.join('\n\n') })
  }

  if (input.images.length && input.imageCapable) {
    for (const image of input.images) {
      blocks.push({ type: 'image', data: image.base64, mimeType: image.mediaType })
    }
  } else if (input.attachmentPaths.length) {
    blocks.push({
      type: 'text',
      text: [
        'The user attached files. Read them through the workspace file tools:',
        ...input.attachmentPaths.map((path) => `- ${path}`)
      ].join('\n')
    })
  }

  for (const ref of input.fileReferences) {
    const target = ref.path?.trim()
    if (!target) continue
    if (
      input.workspacePath &&
      !isPathInsideOrEqual(input.workspacePath, target)
    ) {
      continue
    }
    blocks.push({
      type: 'resource_link',
      uri: `file://${target}`,
      name: ref.name ?? ref.relativePath ?? target
    })
  }

  const surface = input.clientSurfaceInstruction?.trim()
  if (surface) blocks.push({ type: 'text', text: surface })
  return blocks
}

/** Resolve user attachments: images when capable, else path fallback. */
export function attachmentFallbackPaths(
  userItem: Pick<UserTurnItem, 'fileReferences'> | undefined
): string[] {
  return (userItem?.fileReferences ?? [])
    .map((ref) => ref.path?.trim())
    .filter((path): path is string => Boolean(path))
}
