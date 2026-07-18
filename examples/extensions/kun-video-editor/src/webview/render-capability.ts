const MAX_RENDER_CAPABILITY_DETAILS = 16
const MAX_IDENTIFIER_LENGTH = 160
const MAX_TEXT_LENGTH = 512

export type RenderCapabilityDetail = {
  nodeId: string
  nodeType?: string
  capability: string
  message?: string
  guidance?: string
}

/**
 * Preserve the Host's bounded, structured capability evidence for the View.
 * The View must not infer unsupported nodes from a generic error code because
 * one render can contain several independently unsupported effects or codecs.
 */
export function renderCapabilityDetails(value: unknown): RenderCapabilityDetail[] {
  if (!isRecord(value)) return []
  const candidates = [
    ...array(value.unsupportedNodes),
    ...array(value.advancedIssues)
  ]
  const details: RenderCapabilityDetail[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue
    const nodeId = boundedIdentifier(candidate.nodeId)
    const capability = boundedIdentifier(candidate.capability)
    if (!nodeId || !capability) continue
    const key = `${nodeId}\u0000${capability}`
    if (seen.has(key)) continue
    seen.add(key)
    const nodeType = boundedIdentifier(candidate.nodeType)
    const message = boundedText(candidate.message)
    const guidance = boundedText(candidate.guidance)
    details.push({
      nodeId,
      capability,
      ...(nodeType ? { nodeType } : {}),
      ...(message ? { message } : {}),
      ...(guidance ? { guidance } : {})
    })
    if (details.length >= MAX_RENDER_CAPABILITY_DETAILS) break
  }
  return details
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function boundedIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.normalize('NFKC').trim()
  if (!normalized || normalized.length > MAX_IDENTIFIER_LENGTH) return undefined
  return normalized
}

function boundedText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.normalize('NFKC').trim()
  if (!normalized) return undefined
  return normalized.slice(0, MAX_TEXT_LENGTH)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
