import type { KnowledgeBaseIndexStatus, KnowledgeBaseMount } from '../contracts/threads.js'

export const KNOWLEDGE_INDEX_SCHEMA_VERSION = 3
export const KNOWLEDGE_OFFICE_ARTIFACT_VERSION = 1
export const KNOWLEDGE_OFFICE_EXTRACTOR_VERSION = 'office-v1'

export type KnowledgeNodeKind =
  | 'root'
  | 'directory'
  | 'document'
  | 'section'
  | 'range'
  | 'page'
  | 'slide'
  | 'worksheet'
  | 'cell-range'

export type KnowledgeSourceFormat =
  | 'markdown'
  | 'text'
  | 'pdf'
  | 'doc'
  | 'docx'
  | 'xls'
  | 'xlsx'
  | 'ppt'
  | 'pptx'

export type KnowledgeTextLocation = {
  kind: 'text'
  lineStart: number
  lineEnd: number
}

export type KnowledgePdfLocation = {
  kind: 'pdf'
  pageStart: number
  pageEnd: number
}

export type KnowledgeWordLocation = {
  kind: 'word'
  paragraphStart: number
  paragraphEnd: number
  pageStart?: number
  pageEnd?: number
}

export type KnowledgePresentationLocation = {
  kind: 'presentation'
  slideStart: number
  slideEnd: number
}

export type KnowledgeSpreadsheetLocation = {
  kind: 'spreadsheet'
  sheetName: string
  range: string
}

export type KnowledgeSourceLocation =
  | KnowledgeTextLocation
  | KnowledgePdfLocation
  | KnowledgeWordLocation
  | KnowledgePresentationLocation
  | KnowledgeSpreadsheetLocation

export type KnowledgeNode = {
  id: string
  kind: KnowledgeNodeKind
  title: string
  summary: string
  parentId: string | null
  childIds: string[]
  relativePath?: string
  location?: KnowledgeSourceLocation
  evidenceKey?: string
}

export type KnowledgeReferenceEdge = {
  fromId: string
  toId: string
  label: string
}

/**
 * A link whose target lies outside this base — typically `[[../other/note]]`
 * reaching into a sibling workspace.
 *
 * Kept unresolved rather than discarded so a projection spanning several roots
 * can resolve it against the filesystem and draw the edge. Within a single base
 * it stays inert.
 */
export type KnowledgeExternalReferenceEdge = {
  fromId: string
  /** Base-relative path of the linking document. */
  sourcePath: string
  /** Raw link target exactly as written. */
  target: string
  label: string
}

export type KnowledgeDocument = {
  nodeId: string
  relativePath: string
  size: number
  mtimeMs: number
  /** Creation time where the filesystem reports one; 0 when unknown. */
  birthtimeMs?: number
  available: boolean
  format?: KnowledgeSourceFormat
  sourceSha256?: string
  artifactKey?: string
  extractorVersion?: string
  truncated?: boolean
  error?: string
}

export type StoredKnowledgeIndex = {
  version: typeof KNOWLEDGE_INDEX_SCHEMA_VERSION
  root: string
  fingerprint: string
  builtAt: string
  rootNodeId: string
  documents: KnowledgeDocument[]
  nodes: Record<string, KnowledgeNode>
  references: KnowledgeReferenceEdge[]
  /** Links that escape this base. Absent on indexes written before v3. */
  externalReferences?: KnowledgeExternalReferenceEdge[]
  diagnostics: string[]
}

export type KnowledgeSourceFile = {
  absolutePath: string
  relativePath: string
  size: number
  mtimeMs: number
  birthtimeMs?: number
  /**
   * Zero-byte source. Still indexed as a document node — an empty note is a real
   * file in a vault and belongs in the graph — but no content is extracted.
   */
  empty?: boolean
}

export type KnowledgeSourceScan = {
  root: string
  fingerprint: string
  files: KnowledgeSourceFile[]
  diagnostics: string[]
}

export type KnowledgeOfficeEvidenceChunk = {
  key: string
  kind: Extract<KnowledgeNodeKind, 'section' | 'range' | 'slide' | 'worksheet' | 'cell-range'>
  title: string
  summary: string
  parentKey?: string
  location: KnowledgeWordLocation | KnowledgePresentationLocation | KnowledgeSpreadsheetLocation
  text: string
}

export type KnowledgeOfficeArtifact = {
  version: typeof KNOWLEDGE_OFFICE_ARTIFACT_VERSION
  extractorVersion: typeof KNOWLEDGE_OFFICE_EXTRACTOR_VERSION
  sourceSha256: string
  format: Extract<KnowledgeSourceFormat, 'doc' | 'docx' | 'xls' | 'xlsx' | 'ppt' | 'pptx'>
  truncated: boolean
  chunks: KnowledgeOfficeEvidenceChunk[]
  diagnostics: string[]
}

export type KnowledgeCatalogResult = {
  mounts: Array<Omit<KnowledgeBaseMount, 'root'> & {
    status: KnowledgeBaseIndexStatus
    rootNodeId?: string
  }>
  matches: Array<{
    mountId: string
    node: KnowledgeNode
    structuralPath: string[]
    score: number
  }>
}

export type KnowledgeBrowseResult = {
  mountId: string
  node: KnowledgeNode
  children: KnowledgeNode[]
  references: Array<KnowledgeReferenceEdge & { target?: KnowledgeNode }>
  nextCursor: number | null
}

export type KnowledgeEvidence = {
  mountId: string
  mountName: string
  nodeId: string
  structuralPath: string[]
  relativePath: string
  location: KnowledgeSourceLocation
  format?: KnowledgeSourceFormat
  sourceSha256?: string
  documentTruncated?: boolean
  text: string
  truncated: boolean
}

export type KnowledgeReadResult = {
  notice: string
  evidence: KnowledgeEvidence[]
}
