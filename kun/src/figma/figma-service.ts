import {
  FigmaError,
  FIGMA_DEFAULT_DEPTH,
  FIGMA_IMAGE_DOWNLOAD_GAP,
  FIGMA_IMAGE_FORMATS,
  FIGMA_MAX_DEPTH,
  FIGMA_MAX_IMAGE_SCALE,
  FIGMA_MIN_IMAGE_SCALE
} from './ports.js'
import type {
  FigmaAccount,
  FigmaFileInput,
  FigmaFileSummary,
  FigmaImageFormat,
  FigmaImageInput,
  FigmaImageResult,
  FigmaNodeSummary,
  FigmaNodesInput,
  FigmaNodesResult,
  FigmaPageSummary,
  FigmaReadServicePort
} from './ports.js'
import type { FigmaCredentialSource } from './figma-credential.js'
import { FigmaRestClient } from './figma-client.js'
import { parseFigmaNodeIds, parseFigmaReference } from './figma-link.js'
import { assertFigmaToken, FigmaRestTransport } from './figma-transport.js'

export type FigmaReadServiceOptions = {
  credentials: FigmaCredentialSource
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxBytes?: number
}

type UnknownRecord = Record<string, unknown>

/**
 * Read-only Figma service. Each public call resolves the token, validates the
 * link and id budget, issues exactly one REST request, and returns a bounded
 * summary. Binary image content is not fetched.
 */
export class FigmaReadService implements FigmaReadServicePort {
  private readonly credentials: FigmaCredentialSource
  private readonly client: FigmaRestClient

  constructor(options: FigmaReadServiceOptions) {
    this.credentials = options.credentials
    this.client = new FigmaRestClient(new FigmaRestTransport({
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      maxBytes: options.maxBytes
    }))
  }

  async identify(): Promise<FigmaAccount> {
    const payload = await this.client.getMe({ token: await this.token() })
    const id = text(payload.id, 128)
    if (!id) throw new FigmaError('invalid_response', 'Figma did not return an account identity.')
    return {
      id,
      ...(text(payload.handle, 128) ? { handle: text(payload.handle, 128)! } : {}),
      ...(text(payload.email, 256) ? { email: text(payload.email, 256)! } : {})
    }
  }

  async readFile(input: FigmaFileInput): Promise<FigmaFileSummary> {
    const { fileKey } = parseFigmaReference(input.link)
    const depth = readDepth(input.depth)
    const token = await this.token()
    const payload = await this.client.getFile(fileKey, { token, depth })
    return {
      fileKey,
      name: text(payload.name) ?? '',
      lastModified: text(payload.lastModified),
      version: text(payload.version),
      role: text(payload.role),
      depth,
      pages: depth > 1 ? pages(payload.document) : []
    }
  }

  async readNodes(input: FigmaNodesInput): Promise<FigmaNodesResult> {
    const reference = parseFigmaReference(input.link)
    const nodeIds = selectNodeIds(reference.nodeId, input.nodeIds)
    const token = await this.token()
    const payload = await this.client.getNodes(reference.fileKey, { token, nodeIds })
    const entries = record(payload.nodes)
    const nodes: FigmaNodeSummary[] = []
    const missingNodeIds: string[] = []
    for (const nodeId of nodeIds) {
      const node = summarizeNode(nodeId, entries?.[nodeId])
      if (node) nodes.push(node)
      else missingNodeIds.push(nodeId)
    }
    return { fileKey: reference.fileKey, nodes, missingNodeIds }
  }

  async exportImages(input: FigmaImageInput): Promise<FigmaImageResult> {
    const reference = parseFigmaReference(input.link)
    const nodeIds = selectNodeIds(reference.nodeId, input.nodeIds)
    const format = readFormat(input.format)
    const scale = readScale(input.scale)
    const token = await this.token()
    const payload = await this.client.getImages(reference.fileKey, { token, nodeIds, format, scale })
    if (typeof payload.err === 'string' && payload.err.trim()) {
      throw new FigmaError('invalid_input', 'Figma could not render those nodes. Check the node ids and format.')
    }
    const entries = record(payload.images) ?? {}
    const images: { nodeId: string; url: string }[] = []
    const missingNodeIds: string[] = []
    for (const nodeId of nodeIds) {
      const url = imageUrl(entries[nodeId])
      if (url) images.push({ nodeId, url })
      else missingNodeIds.push(nodeId)
    }
    return {
      fileKey: reference.fileKey,
      images,
      missingNodeIds,
      download: { supported: false, reason: FIGMA_IMAGE_DOWNLOAD_GAP }
    }
  }

  private async token(): Promise<string> {
    return assertFigmaToken(await this.credentials.readToken())
  }
}

function selectNodeIds(linkNodeId: string | undefined, explicit: readonly string[] | string | undefined): string[] {
  const hasExplicit = typeof explicit === 'string' ? explicit.trim().length > 0 : (explicit?.length ?? 0) > 0
  if (hasExplicit) return parseFigmaNodeIds(explicit)
  if (linkNodeId) return [linkNodeId]
  throw new FigmaError('invalid_input', 'Choose a Figma node: copy a node link or pass node ids.')
}

function readDepth(value: number | undefined): number {
  if (value === undefined) return FIGMA_DEFAULT_DEPTH
  if (!Number.isInteger(value) || value < 1 || value > FIGMA_MAX_DEPTH) {
    throw new FigmaError('invalid_input', `Figma depth must be a whole number from 1 to ${FIGMA_MAX_DEPTH}.`)
  }
  return value
}

function readFormat(value: FigmaImageFormat | undefined): FigmaImageFormat {
  if (value === undefined) return 'png'
  if (!(FIGMA_IMAGE_FORMATS as readonly string[]).includes(value)) {
    throw new FigmaError('invalid_input', `Figma images can be ${FIGMA_IMAGE_FORMATS.join(', ')}.`)
  }
  return value
}

function readScale(value: number | undefined): number {
  if (value === undefined) return 2
  if (!Number.isFinite(value) || value < FIGMA_MIN_IMAGE_SCALE || value > FIGMA_MAX_IMAGE_SCALE) {
    throw new FigmaError('invalid_input',
      `Figma image scale must be from ${FIGMA_MIN_IMAGE_SCALE} to ${FIGMA_MAX_IMAGE_SCALE}.`)
  }
  return value
}

function pages(document: unknown): FigmaPageSummary[] {
  const children = record(document)?.children
  if (!Array.isArray(children)) return []
  const result: FigmaPageSummary[] = []
  for (const child of children) {
    const page = record(child)
    const id = text(page?.id, 64)
    if (id) result.push({ id, name: text(page?.name) ?? '' })
  }
  return result
}

function summarizeNode(nodeId: string, value: unknown): FigmaNodeSummary | undefined {
  const document = record(record(value)?.document)
  if (!document) return undefined
  const children = document.children
  return {
    id: text(document.id, 64) ?? nodeId,
    name: text(document.name) ?? '',
    type: text(document.type, 64) ?? 'UNKNOWN',
    visible: document.visible !== false,
    childCount: Array.isArray(children) ? children.length : 0
  }
}

/** Signed Figma image URLs are https-only and never carry credentials. */
function imageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2_048) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined
  } catch {
    return undefined
  }
}

function record(value: unknown): UnknownRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as UnknownRecord
}

function text(value: unknown, max = 512): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}
