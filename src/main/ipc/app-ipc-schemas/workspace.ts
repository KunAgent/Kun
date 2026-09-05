import { z } from 'zod'
import {
  CONVERSATION_EXPORT_FORMATS,
  CONVERSATION_EXPORT_MAX_MARKDOWN_CHARS
} from '../../../shared/conversation-export'
import { WRITE_EXPORT_FORMATS } from '../../../shared/write-export'
import { WRITE_INFOGRAPHIC_MAX_TEXT_CHARS } from '../../../shared/write-infographic'
import {
  MAX_WORKSPACE_SPREADSHEET_CELL_TEXT_CHARS,
  MAX_WORKSPACE_SPREADSHEET_FORMULA_CHARS,
  MAX_WORKSPACE_SPREADSHEET_MUTATION_BYTES,
  MAX_WORKSPACE_SPREADSHEET_MUTATIONS
} from '../../../shared/workspace-spreadsheet'
import {
  MAX_BODY_BYTES,
  MAX_BRANCH_LENGTH,
  MAX_CHANNEL_TEXT_LENGTH,
  MAX_CONFIG_FILE_BYTES,
  MAX_EDITOR_COMPLETION_TEXT,
  MAX_EDITOR_ID_LENGTH,
  MAX_ID_LENGTH,
  MAX_PATH_LENGTH,
  MAX_SAVE_FILE_BASE64_BYTES,
  MAX_SKILL_FILE_BYTES,
  MAX_URL_LENGTH,
  defaultPathSchema,
  optionalTrimmedString,
  trimmedString
} from './common'
import { optionalModelIdSchema } from './settings'
export const skillSaveFilePayloadSchema = z
  .object({
    rootPath: trimmedString(MAX_PATH_LENGTH),
    skillName: trimmedString(128),
    content: z.string().max(MAX_SKILL_FILE_BYTES),
    manifestContent: z.string().max(MAX_SKILL_FILE_BYTES).optional()
  })
  .strict()

export const skillGithubImportPayloadSchema = z
  .object({
    rootPath: trimmedString(MAX_PATH_LENGTH),
    // Defense-in-depth: reject any explicit non-https scheme at the IPC
    // boundary (http/file/javascript/data/etc.). Scheme-less input is allowed
    // because the importer normalizes it to https before parsing; only the
    // host-check inside `importSkillsFromGitHub` is authoritative, but barring
    // dangerous schemes here narrows what ever reaches the importer.
    url: z
      .string()
      .trim()
      .min(1)
      .max(MAX_URL_LENGTH)
      .refine((value) => !/^[a-z][a-z0-9+.-]*:/i.test(value) || /^https:\/\//i.test(value), {
        message: 'GitHub skill import URL must use https.'
      })
  })
  .strict()

export const skillListPayloadSchema = z
  .object({
    workspaceRoot: z.string().trim().max(MAX_PATH_LENGTH).optional()
  })
  .strict()

export const rootPathSchema = trimmedString(MAX_PATH_LENGTH)
export const localPdfTextTargetPayloadSchema = z
  .object({
    path: rootPathSchema
  })
  .strict()
export const localOfficeDocumentTargetPayloadSchema = z
  .object({
    path: rootPathSchema.refine(isAbsolutePath, {
      message: 'Office document path must be absolute'
    })
  })
  .strict()
export const deepseekConfigContentSchema = z.string().max(MAX_CONFIG_FILE_BYTES)

export const workspaceRootSchema = trimmedString(MAX_PATH_LENGTH)
export const workspaceCreationTimesPayloadSchema = z
  .object({
    // A sidebar surfaces a few dozen roots at most; the cap is defensive only.
    workspaceRoots: z.array(workspaceRootSchema).max(256)
  })
  .strict()
export const kunProjectConfigWorkspacePayloadSchema = z
  .object({
    workspaceRoot: workspaceRootSchema.refine(isAbsolutePath, {
      message: 'workspaceRoot must be an absolute path'
    })
  })
  .strict()

export const kunProjectConfigWritePayloadSchema = kunProjectConfigWorkspacePayloadSchema.extend({
  content: deepseekConfigContentSchema
}).strict()

export const kunProjectConfigTrustPayloadSchema = z.discriminatedUnion('trusted', [
  kunProjectConfigWorkspacePayloadSchema.extend({
    trusted: z.literal(true),
    expectedDigest: z.string().trim().regex(/^[a-fA-F0-9]{64}$/)
  }).strict(),
  kunProjectConfigWorkspacePayloadSchema.extend({
    trusted: z.literal(false)
  }).strict()
])

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[a-z]:[\\/]/i.test(value) || value.startsWith('\\\\')
}
export const gitBranchPayloadSchema = z
  .object({
    workspaceRoot: workspaceRootSchema,
    branch: trimmedString(MAX_BRANCH_LENGTH)
  })
  .strict()

export const gitCheckpointCreatePayloadSchema = z
  .object({
    workspaceRoot: workspaceRootSchema,
    threadId: trimmedString(MAX_ID_LENGTH),
    checkpointId: trimmedString(MAX_ID_LENGTH * 4).optional()
  })
  .strict()

export const gitCheckpointRestorePayloadSchema = z
  .object({
    checkpointId: trimmedString(MAX_ID_LENGTH * 4),
    allowPartialRestore: z.boolean().optional(),
    expectedThreadId: trimmedString(MAX_ID_LENGTH).optional(),
    expectedWorkspaceRoot: workspaceRootSchema.optional()
  })
  .strict()

export const worktreeOptionalRootSchema = z.object({
  projectPath: trimmedString(MAX_PATH_LENGTH),
  poolIndex: z.number().int().min(0).max(2),
  taskId: trimmedString(MAX_BRANCH_LENGTH),
  force: z.boolean().optional(),
  worktreeRoot: optionalTrimmedString(MAX_PATH_LENGTH)
}).strict()

export const worktreePoolSchema = z.object({
  projectPath: trimmedString(MAX_PATH_LENGTH),
  worktreeRoot: optionalTrimmedString(MAX_PATH_LENGTH)
}).strict()

export const worktreePoolIndexSchema = z.object({
  projectPath: trimmedString(MAX_PATH_LENGTH),
  poolIndex: z.number().int().min(0).max(2),
  worktreeRoot: optionalTrimmedString(MAX_PATH_LENGTH)
}).strict()

export const worktreeMergeSchema = z.object({
  projectPath: trimmedString(MAX_PATH_LENGTH),
  poolIndex: z.number().int().min(0).max(2),
  commitMessage: optionalTrimmedString(4_000),
  worktreeRoot: optionalTrimmedString(MAX_PATH_LENGTH)
}).strict()

export const worktreePathSchema = z.object({
  worktreePath: trimmedString(MAX_PATH_LENGTH)
}).strict()

export const gitWorktreeRemoveSchema = z.object({
  workspaceRoot: workspaceRootSchema,
  worktreePath: trimmedString(MAX_PATH_LENGTH)
}).strict()

export const worktreeProjectPathSchema = z.object({
  projectPath: trimmedString(MAX_PATH_LENGTH)
}).strict()

export const worktreeContinueMergeSchema = z.object({
  projectPath: trimmedString(MAX_PATH_LENGTH),
  message: optionalTrimmedString(4_000)
}).strict()

export const worktreeCommitSchema = z.object({
  worktreePath: trimmedString(MAX_PATH_LENGTH),
  message: trimmedString(4_000)
}).strict()

export const openEditorPathPayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    editorId: optionalTrimmedString(MAX_EDITOR_ID_LENGTH),
    line: z.number().int().positive().max(1_000_000).optional(),
    column: z.number().int().positive().max(1_000_000).optional(),
    openPolicy: z.enum(['presentation-artifact', 'generated-document-artifact']).optional(),
    expectedSha256: z.string().trim().regex(/^[a-f0-9]{64}$/i).optional()
  })
  .strict()

export const workspaceFileTargetPayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    line: z.number().int().positive().max(1_000_000).optional(),
    column: z.number().int().positive().max(1_000_000).optional()
  })
  .strict()

/**
 * Unlike generic file reads, Office previews are always scoped to an
 * explicitly selected workspace. This prevents a renderer from using the
 * preview renderer as an arbitrary local-file reader.
 */
export const workspaceOfficePreviewTargetPayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: workspaceRootSchema,
    expectedSha256: z.string().trim().regex(/^[a-f0-9]{64}$/i).optional()
  })
  .strict()

export const workspaceOfficeSemanticTargetPayloadSchema = workspaceOfficePreviewTargetPayloadSchema

const spreadsheetColorSchema = z.string().trim().max(64).regex(
  /^(?:#[0-9a-f]{6}|[0-9a-f]{6}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|[a-z][a-z0-9]*)$/i
)
const spreadsheetBorderSchema = z.object({
  style: z.enum(['none', 'thin', 'medium', 'thick', 'double', 'dashed', 'dotted']),
  color: spreadsheetColorSchema.nullable().optional()
}).strict()
const spreadsheetStyleSchema = z.object({
  fontFamily: z.string().trim().min(1).max(128).nullable().optional(),
  fontSize: z.number().finite().min(1).max(409).nullable().optional(),
  bold: z.boolean().nullable().optional(),
  italic: z.boolean().nullable().optional(),
  underline: z.enum(['none', 'single', 'double']).nullable().optional(),
  strike: z.boolean().nullable().optional(),
  fontColor: spreadsheetColorSchema.nullable().optional(),
  fillColor: spreadsheetColorSchema.nullable().optional(),
  horizontalAlignment: z.enum(['left', 'center', 'right', 'justify', 'fill', 'distributed']).nullable().optional(),
  verticalAlignment: z.enum(['top', 'center', 'bottom']).nullable().optional(),
  wrap: z.boolean().nullable().optional(),
  numberFormat: z.string().max(256).nullable().optional(),
  textRotation: z.number().int().min(0).max(255).nullable().optional(),
  borders: z.object({
    top: spreadsheetBorderSchema.nullable().optional(),
    right: spreadsheetBorderSchema.nullable().optional(),
    bottom: spreadsheetBorderSchema.nullable().optional(),
    left: spreadsheetBorderSchema.nullable().optional()
  }).strict().optional()
}).strict().refine((value) => (
  Object.keys(value).some((key) => key !== 'borders') ||
  Boolean(value.borders && Object.keys(value.borders).length > 0)
), { message: 'A spreadsheet style mutation cannot be empty.' })
const spreadsheetSheetNameSchema = z.string().trim().min(1).max(31)
  .refine((value) => !Array.from(value).some((character) => ':\\/?*[]'.includes(character)), {
    message: 'Invalid XLSX worksheet name.'
  })
const spreadsheetAddressSchema = z.string().trim().regex(/^[A-Z]{1,3}[1-9]\d{0,6}$/)
  .refine(isExcelCellAddress, { message: 'Cell address exceeds XLSX bounds.' })
const spreadsheetRangeSchema = z.string().trim().regex(/^[A-Z]{1,3}[1-9]\d{0,6}:[A-Z]{1,3}[1-9]\d{0,6}$/)
  .refine((value) => value.split(':').every(isExcelCellAddress), {
    message: 'Cell range exceeds XLSX bounds.'
  })
const spreadsheetCellMutationSchema = z.object({
  kind: z.literal('cell'),
  sheetName: spreadsheetSheetNameSchema,
  address: spreadsheetAddressSchema,
  value: z.union([
    z.string().max(MAX_WORKSPACE_SPREADSHEET_CELL_TEXT_CHARS),
    z.number().finite(),
    z.boolean(),
    z.null()
  ]).optional(),
  formula: z.string().max(MAX_WORKSPACE_SPREADSHEET_FORMULA_CHARS).nullable().optional(),
  style: spreadsheetStyleSchema.optional()
}).strict().refine((value) => (
  Object.prototype.hasOwnProperty.call(value, 'value') ||
  Object.prototype.hasOwnProperty.call(value, 'formula') ||
  value.style !== undefined
), { message: 'A cell mutation must change content or style.' })
const spreadsheetMergeMutationSchema = z.object({
  kind: z.literal('merge'),
  sheetName: spreadsheetSheetNameSchema,
  range: spreadsheetRangeSchema,
  merged: z.boolean()
}).strict()
const spreadsheetDimensionFields = {
  sheetName: spreadsheetSheetNameSchema,
  size: z.number().finite().min(0).max(4_096).nullable().optional(),
  hidden: z.boolean().nullable().optional()
}
const spreadsheetRowMutationSchema = z.object({
  kind: z.literal('row'),
  ...spreadsheetDimensionFields,
  index: z.number().int().min(1).max(1_048_576)
}).strict().refine((value) => (
  Object.prototype.hasOwnProperty.call(value, 'size') ||
  Object.prototype.hasOwnProperty.call(value, 'hidden')
), { message: 'A dimension mutation must change size or visibility.' })
const spreadsheetColumnMutationSchema = z.object({
  kind: z.literal('column'),
  ...spreadsheetDimensionFields,
  index: z.number().int().min(1).max(16_384)
}).strict().refine((value) => (
  Object.prototype.hasOwnProperty.call(value, 'size') ||
  Object.prototype.hasOwnProperty.call(value, 'hidden')
), { message: 'A dimension mutation must change size or visibility.' })
const spreadsheetMutationSchema = z.discriminatedUnion('kind', [
  spreadsheetCellMutationSchema,
  spreadsheetMergeMutationSchema,
  spreadsheetRowMutationSchema,
  spreadsheetColumnMutationSchema
])

export const workspaceSpreadsheetSavePayloadSchema = z.object({
  path: trimmedString(MAX_PATH_LENGTH),
  workspaceRoot: workspaceRootSchema,
  expectedSha256: z.string().trim().regex(/^[a-f0-9]{64}$/i),
  mutations: z.array(spreadsheetMutationSchema).min(1).max(MAX_WORKSPACE_SPREADSHEET_MUTATIONS)
}).strict().superRefine((value, context) => {
  if (Buffer.byteLength(JSON.stringify(value.mutations), 'utf8') <= MAX_WORKSPACE_SPREADSHEET_MUTATION_BYTES) return
  context.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['mutations'],
    message: `Spreadsheet mutations exceed ${MAX_WORKSPACE_SPREADSHEET_MUTATION_BYTES} bytes.`
  })
})

export const workspaceSpreadsheetConvertPayloadSchema = z.object({
  path: trimmedString(MAX_PATH_LENGTH),
  workspaceRoot: workspaceRootSchema,
  expectedSha256: z.string().trim().regex(/^[a-f0-9]{64}$/i)
}).strict()

function isExcelCellAddress(value: string): boolean {
  const match = /^([A-Z]+)([1-9]\d*)$/.exec(value)
  if (!match || Number(match[2]) > 1_048_576) return false
  let column = 0
  for (const character of match[1]!) column = column * 26 + character.charCodeAt(0) - 64
  return column >= 1 && column <= 16_384
}

export const workspaceFileRevealTargetPayloadSchema = workspaceFileTargetPayloadSchema.extend({
  workspaceRoot: trimmedString(MAX_PATH_LENGTH)
})

export const workspaceDirectoryTargetPayloadSchema = z
  .object({
    path: optionalTrimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const workspaceFileWritePayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    content: z.string().max(MAX_BODY_BYTES),
    expectedMtimeMs: z.number().finite().nonnegative().optional(),
    force: z.boolean().optional()
  })
  .strict()

export const workspacePreviewLeaseTargetPayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const workspacePreviewLeaseReleasePayloadSchema = z
  .object({
    leaseId: z.string().trim().regex(/^[A-Za-z0-9_-]{32,128}$/)
  })
  .strict()

export const workspaceFileSaveAsPayloadSchema = z
  .object({
    suggestedName: optionalTrimmedString(255),
    sourcePath: optionalTrimmedString(MAX_PATH_LENGTH),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    dataBase64: z.string().max(MAX_SAVE_FILE_BASE64_BYTES).optional(),
    mimeType: optionalTrimmedString(255)
  })
  .strict()
  .refine((payload) => Boolean(payload.sourcePath || payload.dataBase64), {
    message: 'Either sourcePath or dataBase64 is required.'
  })

export const workspaceFileCreatePayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    content: z.string().max(MAX_BODY_BYTES).optional()
  })
  .strict()

export const workspaceDirectoryCreatePayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const workspaceClipboardImageSavePayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    currentFilePath: trimmedString(MAX_PATH_LENGTH),
    imageDirectory: optionalTrimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const workspaceImagePickPayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    currentFilePath: optionalTrimmedString(MAX_PATH_LENGTH),
    imageDirectory: optionalTrimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const workspaceImageBytesSavePayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    dataBase64: z.string().max(MAX_SAVE_FILE_BASE64_BYTES),
    mimeType: optionalTrimmedString(255),
    imageDirectory: optionalTrimmedString(MAX_PATH_LENGTH),
    fileName: optionalTrimmedString(255)
  })
  .strict()

export const workspaceEntryRenamePayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    newName: trimmedString(255)
  })
  .strict()

export const workspaceEntryDeletePayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const workspaceFileWatchPayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    mode: z.enum(['content', 'signal']).optional()
  })
  .strict()

export const writeRetrievalPayloadSchema = z
  .object({
    workspaceRoot: defaultPathSchema,
    currentFilePath: defaultPathSchema,
    query: z.string().trim().min(1).max(MAX_CHANNEL_TEXT_LENGTH),
    maxSnippets: z.number().int().min(1).max(8).optional(),
    includeCurrentFile: z.boolean().optional()
  })
  .strict()

export const writeDocumentSha256PayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    filePath: trimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const writeExportPayloadSchema = z
  .object({
    path: optionalTrimmedString(MAX_PATH_LENGTH),
    title: optionalTrimmedString(200),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    format: z.enum(WRITE_EXPORT_FORMATS),
    content: z.string().max(MAX_BODY_BYTES)
  })
  .strict()
  .refine((payload) => Boolean(payload.path || payload.title), {
    message: 'An export path or title is required.'
  })

export const conversationExportPayloadSchema = z
  .object({
    title: trimmedString(200),
    format: z.enum(CONVERSATION_EXPORT_FORMATS),
    markdown: z.string().min(1).max(CONVERSATION_EXPORT_MAX_MARKDOWN_CHARS),
    defaultFileName: trimmedString(200)
  })
  .strict()

export const memoryMarkdownExportPayloadSchema = z
  .object({
    markdown: z.string().max(MAX_BODY_BYTES),
    defaultFileName: optionalTrimmedString(200)
  })
  .strict()

export const designExportPayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    format: z.enum(['html', 'pdf']),
    filename: optionalTrimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const writeRichClipboardPayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    content: z.string().max(MAX_BODY_BYTES)
  })
  .strict()

const writeInlineEditRecentEditSchema = z
  .object({
    source: z.enum(['user', 'inline-edit']),
    ageMs: z.number().int().min(0).max(24 * 60 * 60 * 1_000),
    filePath: optionalTrimmedString(MAX_PATH_LENGTH),
    from: z.number().int().min(0).max(MAX_BODY_BYTES),
    to: z.number().int().min(0).max(MAX_BODY_BYTES),
    deletedText: z.string().max(8_000),
    insertedText: z.string().max(8_000),
    beforeContext: z.string().max(4_000),
    afterContext: z.string().max(4_000),
    instruction: z.string().trim().min(1).max(10_000).optional(),
    scopeKind: z.enum(['selection', 'paragraph']).optional()
  })
  .strict()
  .refine((edit) => edit.to >= edit.from, {
    message: 'Recent edit end must be greater than or equal to start.'
  })

const writeInlineCompletionEditCandidateSchema = z
  .object({
    kind: z.enum(['selection', 'paragraph']),
    from: z.number().int().min(0).max(MAX_BODY_BYTES),
    to: z.number().int().min(0).max(MAX_BODY_BYTES),
    startLine: z.number().int().positive().max(1_000_000),
    startColumn: z.number().int().positive().max(1_000_000),
    endLine: z.number().int().positive().max(1_000_000),
    endColumn: z.number().int().positive().max(1_000_000),
    original: z.string().max(MAX_EDITOR_COMPLETION_TEXT),
    selectedText: z.string().max(50_000).optional()
  })
  .strict()
  .refine((scope) => scope.to >= scope.from, {
    message: 'Completion edit candidate end must be greater than or equal to start.'
  })

export const writeInlineCompletionPayloadSchema = z
  .object({
    prefix: z.string().max(MAX_EDITOR_COMPLETION_TEXT),
    suffix: z.string().max(MAX_EDITOR_COMPLETION_TEXT),
    mode: z.enum(['short', 'long', 'edit']).optional(),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    currentFilePath: optionalTrimmedString(MAX_PATH_LENGTH),
    cursor: z
      .object({
        line: z.number().int().positive().max(1_000_000),
        column: z.number().int().min(0).max(1_000_000)
      })
      .strict(),
    context: z
      .object({
        language: trimmedString(64),
        currentLinePrefix: z.string().max(20_000),
        currentLineSuffix: z.string().max(20_000),
        previousLine: z.string().max(20_000),
        previousNonEmptyLine: z.string().max(20_000),
        nextLine: z.string().max(20_000),
        indentation: z.string().max(2_000),
        signals: z
          .object({
            list: z.boolean(),
            quote: z.boolean(),
            heading: z.boolean(),
            table: z.boolean(),
            atLineEnd: z.boolean(),
            endsWithSentencePunctuation: z.boolean(),
            previousLineEndsWithSentencePunctuation: z.boolean(),
            prefersNewLineCompletion: z.boolean(),
            paragraphBreakOpportunity: z.boolean()
          })
          .strict()
      })
      .strict(),
    policy: z
      .object({
        name: trimmedString(128),
        instruction: z.string().max(50_000),
        acceptanceCriteria: z.array(z.string().max(5_000)).max(12),
        rejectionCriteria: z.array(z.string().max(5_000)).max(12)
      })
      .strict(),
    preview: z
      .object({
        local: z.string().max(5_000),
        documentTail: z.string().max(20_000)
      })
      .strict(),
    editCandidate: writeInlineCompletionEditCandidateSchema.optional(),
    recentEdits: z.array(writeInlineEditRecentEditSchema).max(12).optional(),
    model: optionalModelIdSchema
  })
  .strict()

export const writeInfographicPayloadSchema = z
  .object({
    text: trimmedString(WRITE_INFOGRAPHIC_MAX_TEXT_CHARS),
    filePath: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    imageDir: optionalTrimmedString(MAX_PATH_LENGTH),
    kind: z.enum(['infographic', 'design']).optional(),
    referenceImagePath: optionalTrimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const writePrototypeFilePayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH)
  })
  .strict()
