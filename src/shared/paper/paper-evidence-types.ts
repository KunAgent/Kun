import { z } from 'zod'
import { paperRectSchema } from './paper-marks-types'

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/)
const text = z.string().max(16000)
export const paperClaimKindSchema = z.enum(['author-reported', 'user-judgment', 'ai-inference'])
export const paperEvidenceVerificationSchema = z.enum(['unverified', 'user-verified', 'rejected'])
export const paperVersionSnapshotSchema = z.object({
  canonicalId: z.string().min(1).max(500),
  // Only explicit versioned provenance is recorded; a canonical arXiv ID has no version.
  arxivVersion: z.string().regex(/^v[1-9]\d*$/).optional(),
  citeKey: z.string().min(1).max(300),
  title: z.string().min(1),
  pdfFile: z.string().min(1),
  pdfSha256: z.string().regex(/^[a-f0-9]{64}$/),
  pdfBytes: z.number().int().nonnegative(),
  capturedAt: z.string()
}).strict()
export type PaperVersionSnapshot = z.infer<typeof paperVersionSnapshotSchema>

export const paperEvidenceEditableSchema = z.object({
  interpretation: text,
  conditions: text,
  question: text,
  claimKind: paperClaimKindSchema,
  // Semantic, explicit user judgment; never set by a successful quote match.
  verification: paperEvidenceVerificationSchema
}).strict()
export const paperEvidencePatchSchema = paperEvidenceEditableSchema.partial().strict()
export type PaperEvidencePatch = z.infer<typeof paperEvidencePatchSchema>
export const paperEvidenceSchema = paperEvidenceEditableSchema.extend({
  id,
  unitDir: z.string().min(1),
  sourceMarkId: id,
  sourceKind: z.enum(['highlight', 'visual']),
  originalQuote: z.string().max(8000),
  anchor: z.object({ page: z.number().int().positive(), rects: z.array(paperRectSchema).min(1).max(64) }).strict(),
  // A private immutable copy survives deletion/replacement of the source visual mark.
  imagePath: z.string().optional(),
  paperVersion: paperVersionSnapshotSchema,
  mechanical: z.object({
    versionBinding: z.enum(['bound', 'legacy-unbound']),
    quoteMatch: z.enum(['matched', 'not-found', 'unavailable', 'not-applicable']),
    pageCount: z.number().int().positive().optional(),
    textPartial: z.boolean(),
    checkedAt: z.string()
  }).strict(),
  createdAt: z.string(),
  updatedAt: z.string()
}).strict()
export type PaperEvidence = z.infer<typeof paperEvidenceSchema>

export const PAPER_MATRIX_AXES = ['task', 'method', 'dataset', 'metric', 'result', 'conditions', 'limitations', 'dataset-version', 'split', 'model-size', 'training-resources', 'code'] as const
export const paperMatrixAxisSchema = z.enum(PAPER_MATRIX_AXES)
export type PaperMatrixAxis = z.infer<typeof paperMatrixAxisSchema>
export const paperMatrixCellSchema = z.object({
  unitDir: z.string().min(1),
  axis: paperMatrixAxisSchema,
  value: text,
  status: z.enum(['not-reported', 'reported']),
  evidenceIds: z.array(id).max(200),
  comparability: z.enum(['unknown', 'comparable', 'not-comparable']),
  comparabilityReason: text,
  // Manual cell edits are preserved when adding rows/axes.
  updatedAt: z.string()
}).strict()
export type PaperMatrixCell = z.infer<typeof paperMatrixCellSchema>
export const paperMatrixRowSchema = z.object({
  unitDir: z.string().min(1), title: z.string().min(1), canonicalId: z.string().min(1), citeKey: z.string().min(1)
}).strict()
export const paperComparisonMatrixSchema = z.object({
  id, title: z.string().trim().min(1).max(200),
  rows: z.array(paperMatrixRowSchema).max(100),
  axes: z.array(paperMatrixAxisSchema).min(1).max(PAPER_MATRIX_AXES.length),
  cells: z.array(paperMatrixCellSchema).max(1200),
  createdAt: z.string(), updatedAt: z.string()
}).strict()
export type PaperComparisonMatrix = z.infer<typeof paperComparisonMatrixSchema>
export const paperMatrixPatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  addUnitDirs: z.array(z.string().trim().min(1).max(4096)).max(100).optional(),
  addAxes: z.array(paperMatrixAxisSchema).max(PAPER_MATRIX_AXES.length).optional(),
  cells: z.array(paperMatrixCellSchema.omit({ updatedAt: true })).max(1200).optional()
}).strict()
export type PaperMatrixPatch = z.infer<typeof paperMatrixPatchSchema>

export const paperEvidenceWorkspaceSchema = z.object({
  version: z.literal(1), revision: z.number().int().nonnegative(),
  evidence: z.array(paperEvidenceSchema).max(20000),
  matrices: z.array(paperComparisonMatrixSchema).max(500)
}).strict()
export type PaperEvidenceWorkspace = z.infer<typeof paperEvidenceWorkspaceSchema>
export type PaperEvidenceFailure = { ok: false; code: string; message: string }
export type PaperEvidenceResult = { ok: true; revision: number; items: PaperEvidence[] } | PaperEvidenceFailure
export type PaperMatricesResult = { ok: true; revision: number; matrices: PaperComparisonMatrix[] } | PaperEvidenceFailure

type Scope = { workspaceRoot: string }
export type PaperEvidenceSourceResult = {
  ok: true
  status: 'current' | 'stale' | 'missing' | 'legacy-unbound'
  unitDir: string
  pdfFile?: string
  page: number
  title: string
  citeKey: string
  expectedSha256: string
  currentSha256?: string
  message: string
} | PaperEvidenceFailure
export type PaperEvidenceMaterialResult = {
  ok: true
  paperVersion: PaperVersionSnapshot | null
  sourceText: string
  pageCount: number
  extractedPages: number[]
  missingTextPages: number[]
  textPartial: boolean
  abstractOnly: boolean
  figuresStatus: 'none' | 'ok' | 'partial' | 'failed'
  figuresSource?: string
  figureConfidence: { high: number; medium: number; low: number }
  figuresVersionBound: boolean
} | PaperEvidenceFailure
export type PaperEvidenceApi = {
  paperEvidenceSource: (payload: Scope & { evidenceId: string }) => Promise<PaperEvidenceSourceResult>
  paperEvidenceMaterial: (payload: Scope & { unitDir: string }) => Promise<PaperEvidenceMaterialResult>
  paperEvidenceRead: (payload: Scope & { unitDir?: string }) => Promise<PaperEvidenceResult>
  paperEvidencePromote: (payload: Scope & { unitDir: string; markId: string; expectedRevision: number }) => Promise<PaperEvidenceResult>
  paperEvidenceUpdate: (payload: Scope & { evidenceId: string; expectedRevision: number; patch: PaperEvidencePatch }) => Promise<PaperEvidenceResult>
  paperMatricesRead: (payload: Scope) => Promise<PaperMatricesResult>
  paperMatrixCreate: (payload: Scope & { title: string; unitDirs: string[]; axes: PaperMatrixAxis[]; expectedRevision: number }) => Promise<PaperMatricesResult>
  paperMatrixUpdate: (payload: Scope & { matrixId: string; expectedRevision: number; patch: PaperMatrixPatch }) => Promise<PaperMatricesResult>
}
