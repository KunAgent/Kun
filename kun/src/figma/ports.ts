/**
 * Read-only Figma REST connector surface.
 *
 * The host composition supplies both the personal access token and the network
 * transport. This module never reads credentials from the environment or disk,
 * never puts a token in a URL, and never exposes one in errors or results.
 * Only read operations exist: file metadata, node subtrees, and rendered image
 * links. There is no write, comment, or project-mutation capability.
 */

/** Fixed upstream origin: no model- or user-supplied base URL is accepted. */
export const FIGMA_API_ORIGIN = 'https://api.figma.com'
/** Figma rejects oversized id batches; each service call makes exactly one request. */
export const FIGMA_MAX_NODE_IDS_PER_REQUEST = 50
export const FIGMA_MAX_RESPONSE_BYTES = 8 * 1024 * 1024
export const FIGMA_REQUEST_TIMEOUT_MS = 20_000
export const FIGMA_MAX_RETRY_AFTER_MS = 60_000
/** Depth 2 returns the document plus its pages, which is the bounded default. */
export const FIGMA_DEFAULT_DEPTH = 2
export const FIGMA_MAX_DEPTH = 4

export const FIGMA_IMAGE_FORMATS = ['png', 'jpg', 'svg', 'pdf'] as const
export type FigmaImageFormat = (typeof FIGMA_IMAGE_FORMATS)[number]
export const FIGMA_MIN_IMAGE_SCALE = 0.01
export const FIGMA_MAX_IMAGE_SCALE = 4

/**
 * Image bytes are deliberately not downloaded yet: Kun's attachment store is
 * the only safe sink for binary content, and it is not wired to this connector.
 * The read call therefore returns signed Figma image links plus this gap.
 */
export const FIGMA_IMAGE_DOWNLOAD_GAP =
  'Kun returns Figma image links only. Writing them into the attachment store is not wired yet.'

export type FigmaErrorCode =
  | 'invalid_link'
  | 'invalid_input'
  | 'credential_missing'
  | 'credential_invalid'
  | 'not_found'
  | 'access_denied'
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'invalid_response'
  | 'response_too_large'

export class FigmaError extends Error {
  constructor(
    readonly code: FigmaErrorCode,
    message: string,
    readonly retryAfterMs?: number
  ) {
    super(message)
    this.name = 'FigmaError'
  }
}

export type FigmaFileReference = {
  fileKey: string
  nodeId?: string
}

export type FigmaFileInput = {
  /** A figma.com file, design, or board link pasted by the user. */
  link: string
  /** Document depth: 1 is the document node, 2 adds pages. */
  depth?: number
}

export type FigmaNodesInput = {
  link: string
  /** Explicit node ids; defaults to the link's node-id when present. */
  nodeIds?: readonly string[] | string
}

export type FigmaImageInput = {
  link: string
  nodeIds?: readonly string[] | string
  format?: FigmaImageFormat
  scale?: number
}

export type FigmaPageSummary = {
  id: string
  name: string
}

export type FigmaFileSummary = {
  fileKey: string
  name: string
  lastModified: string | null
  version: string | null
  role: string | null
  depth: number
  pages: FigmaPageSummary[]
}

export type FigmaNodeSummary = {
  id: string
  name: string
  type: string
  visible: boolean
  childCount: number
}

export type FigmaNodesResult = {
  fileKey: string
  nodes: FigmaNodeSummary[]
  /** Node ids Figma answered with `null`; never a hard failure. */
  missingNodeIds: string[]
}

export type FigmaImageLink = {
  nodeId: string
  url: string
}

export type FigmaImageResult = {
  fileKey: string
  images: FigmaImageLink[]
  missingNodeIds: string[]
  download: { supported: false; reason: string }
}

export type FigmaAccount = {
  id: string
  handle?: string
  email?: string
}

export interface FigmaReadServicePort {
  /** Verifies the stored token and returns the account it belongs to. */
  identify(): Promise<FigmaAccount>
  readFile(input: FigmaFileInput): Promise<FigmaFileSummary>
  readNodes(input: FigmaNodesInput): Promise<FigmaNodesResult>
  exportImages(input: FigmaImageInput): Promise<FigmaImageResult>
}
