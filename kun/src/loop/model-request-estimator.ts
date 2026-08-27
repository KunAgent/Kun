import type { TurnItem } from '../contracts/items.js'
import type {
  ModelDocumentAttachment,
  ModelInputAttachment,
  ModelRequest,
  ModelTextAttachmentFallback,
  ModelToolSpec
} from '../ports/model-client.js'
import { ContextEstimator } from './context-estimator.js'

const CHARS_PER_TOKEN = 4

const estimator = new ContextEstimator(CHARS_PER_TOKEN)

export type ModelRequestInputTokenBreakdown = {
  tools: number
  system: number
  skills: number
  messages: number
  other: number
  total: number
}

export function estimateModelRequestInputTokens(request: ModelRequest): number {
  return estimateModelRequestInputTokenBreakdown(request).total
}

/**
 * Estimate the model-visible parts of one final request without mixing in
 * provider billing counters or earlier requests from the same thread.
 */
export function estimateModelRequestInputTokenBreakdown(
  request: ModelRequest,
  options?: { skillContextInstructions?: readonly string[] }
): ModelRequestInputTokenBreakdown {
  const { skill } = partitionContextInstructions(
    request.contextInstructions,
    options?.skillContextInstructions
  )
  const contextInstructions = estimateText(request.contextInstructions?.join('\n'))
  const requestSkillTokens = Math.min(contextInstructions, estimateText(skill.join('\n')))
  const skillContextItemTokens = estimateActiveSkillContextItems(request.history)
  const skills = requestSkillTokens + skillContextItemTokens
  const nonSkillContext = contextInstructions - requestSkillTokens
  const system =
    estimateText(request.systemPrompt) +
    estimateText(request.threadProfileInstruction) +
    estimateText(request.modeInstruction) +
    nonSkillContext
  const messages = Math.max(0, estimateItems(request.prefix) + estimateItems(request.history) - skillContextItemTokens)
  const tools = estimateTools(request.tools)
  const other =
    estimateTextFallbacks(request.attachmentTextFallbacks) +
    estimateDocuments(request.attachmentDocuments) +
    estimateImageAttachments(request.attachments) +
    estimateMessageAttachments(request.messageAttachments) +
    estimateText(request.requiredToolName) +
    estimateText(request.reasoningEffort) +
    estimateText(request.serviceTier)
  return {
    tools,
    system,
    skills,
    messages,
    other,
    total: tools + system + skills + messages + other
  }
}

function estimateMessageAttachments(
  attachments: ModelRequest['messageAttachments']
): number {
  if (!attachments) return 0
  return Object.values(attachments).reduce((sum, entry) => sum +
    estimateImageAttachments(entry.images) +
    estimateTextFallbacks(entry.textFallbacks) +
    estimateDocuments(entry.documents) +
    estimateText(entry.unavailable.map((item) => item.text).join('\n')), 0)
}

/**
 * Estimate the per-request token overhead that is sent on *every* turn
 * but is not part of the stored conversation items: the system prompt,
 * the few-shot prefix, the mode/context instructions, and the full tool
 * schemas. The item-only {@link ContextEstimator} ignores all of this,
 * which makes compaction under-trigger when no provider usage count is
 * available (e.g. the first turn after a process restart). Compaction
 * adds this overhead to its history estimate as a safety floor.
 */
export function estimateRequestOverheadTokens(input: {
  systemPrompt?: string
  threadProfileInstruction?: string
  modeInstruction?: string
  contextInstructions?: string[]
  prefix?: TurnItem[]
  tools?: readonly ModelToolSpec[]
}): number {
  let tokens = 0
  tokens += estimateText(input.systemPrompt)
  tokens += estimateText(input.threadProfileInstruction)
  tokens += estimateText(input.modeInstruction)
  tokens += estimateText(input.contextInstructions?.join('\n'))
  tokens += estimateItems(input.prefix)
  tokens += estimateTools(input.tools)
  return Math.max(0, tokens)
}

function estimateActiveSkillContextItems(items?: TurnItem[]): number {
  if (!items?.length) return 0
  return items.reduce((total, item) => {
    if (item.kind !== 'model_context') return total
    const skillTokens = activeSkillContextSections(item.text).reduce(
      (sectionTotal, section) => sectionTotal + estimateText(section),
      0
    )
    return total + Math.min(estimateItems([item]), skillTokens)
  }, 0)
}

function activeSkillContextSections(text: string): string[] {
  const sections: string[] = []
  const pattern = /<kun_context_update\b([^>]*)>[\s\S]*?<\/kun_context_update>/g
  for (const match of text.matchAll(pattern)) {
    const attributes = match[1] ?? ''
    if (
      /\bauthority="skill"/.test(attributes) &&
      /\bstate="active"/.test(attributes)
    ) {
      sections.push(match[0])
    }
  }
  return sections
}

function estimateItems(items?: TurnItem[]): number {
  return items && items.length > 0 ? estimator.estimateItems(items) : 0
}

function partitionContextInstructions(
  instructions: readonly string[] | undefined,
  skillInstructions: readonly string[] | undefined
): { skill: string[]; nonSkill: string[] } {
  if (!instructions?.length) return { skill: [], nonSkill: [] }
  if (!skillInstructions?.length) return { skill: [], nonSkill: [...instructions] }
  const remaining = new Map<string, number>()
  for (const instruction of skillInstructions) {
    remaining.set(instruction, (remaining.get(instruction) ?? 0) + 1)
  }
  const skill: string[] = []
  const nonSkill: string[] = []
  for (const instruction of instructions) {
    const count = remaining.get(instruction) ?? 0
    if (count > 0) {
      skill.push(instruction)
      if (count === 1) remaining.delete(instruction)
      else remaining.set(instruction, count - 1)
    } else {
      nonSkill.push(instruction)
    }
  }
  return { skill, nonSkill }
}

function estimateTools(tools?: readonly ModelToolSpec[]): number {
  if (!tools?.length) return 0
  return tools.reduce((sum, tool) => {
    return sum + estimateText([
      tool.name,
      tool.description,
      JSON.stringify(tool.inputSchema)
    ].join('\n'))
  }, 0)
}

function estimateTextFallbacks(fallbacks?: ModelTextAttachmentFallback[]): number {
  if (!fallbacks?.length) return 0
  return fallbacks.reduce((sum, attachment) => {
    return sum + estimateText([
      attachment.name,
      attachment.mimeType,
      String(attachment.byteSize),
      attachment.dataBase64
    ].join('\n'))
  }, 0)
}

function estimateDocuments(documents?: ModelDocumentAttachment[]): number {
  if (!documents?.length) return 0
  return documents.reduce((sum, document) => sum + estimateText([
    document.name,
    document.mimeType,
    document.text
  ].join('\n')), 0)
}

/**
 * Providers meter vision input differently from the base64 transport encoding.
 * Estimate from pixels when known (with a conservative fallback) so normal
 * image inputs are included in the hard cap without treating their 4/3 wire
 * encoding as text tokens.
 */
function estimateImageAttachments(attachments?: ModelInputAttachment[]): number {
  if (!attachments?.length) return 0
  return attachments.reduce((sum, attachment) => {
    const pixels = (attachment.width ?? 0) * (attachment.height ?? 0)
    const imageTokens = pixels > 0 ? Math.max(256, Math.ceil(pixels / 768)) : 2_048
    return sum + imageTokens + estimateText(`${attachment.name}\n${attachment.mimeType}`)
  }, 0)
}

function estimateText(text?: string): number {
  if (!text?.trim()) return 0
  return Math.max(1, estimator.estimateText(text))
}
