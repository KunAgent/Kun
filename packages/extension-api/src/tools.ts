import { z } from 'zod'
import { JsonObjectSchema, JsonValueSchema, type JsonObject, type JsonValue } from './common.js'
import { GeneratedArtifactsSchema } from './artifacts.js'

export const ToolSideEffectsSchema = z.enum(['none', 'read', 'write', 'external', 'destructive'])
export type ToolSideEffects = z.infer<typeof ToolSideEffectsSchema>

export const ExtensionToolDeclarationSchema = z.strictObject({
  id: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/),
  description: z.string().min(1).max(2048),
  inputSchema: JsonObjectSchema,
  outputSchema: JsonObjectSchema.optional(),
  sideEffects: ToolSideEffectsSchema.default('none'),
  idempotent: z.boolean().default(false),
  maxOutputBytes: z.number().int().min(1024).max(1024 * 1024).optional()
})
export type ExtensionToolDeclaration = z.infer<typeof ExtensionToolDeclarationSchema>
export type ExtensionToolDeclarationInput = z.input<typeof ExtensionToolDeclarationSchema>

export const ToolInvocationSchema = z.strictObject({
  invocationId: z.string().min(1).max(256),
  toolId: z.string().min(1).max(256),
  input: JsonObjectSchema,
  workspaceId: z.string().min(1).max(256).optional(),
  runId: z.string().min(1).max(256).optional(),
  threadId: z.string().min(1).max(256).optional(),
  deadline: z.string().datetime().optional()
})
export type ToolInvocation = z.infer<typeof ToolInvocationSchema>

export const ToolProgressSchema = z.strictObject({
  invocationId: z.string().min(1).max(256),
  message: z.string().min(1).max(4096).optional(),
  fraction: z.number().min(0).max(1).optional(),
  data: JsonValueSchema.optional()
})
export type ToolProgress = z.infer<typeof ToolProgressSchema>

export const ToolResultSchema = z.strictObject({
  content: JsonValueSchema,
  summary: z.string().max(4096).optional(),
  metadata: JsonObjectSchema.optional(),
  generatedArtifacts: GeneratedArtifactsSchema.optional()
})
export type ToolResult = z.infer<typeof ToolResultSchema>

export interface CancellationToken {
  readonly isCancellationRequested: boolean
  readonly onCancellationRequested: (listener: () => void) => { dispose(): void }
}

export interface ToolInvocationContext {
  readonly invocation: ToolInvocation
  readonly cancellation: CancellationToken
  reportProgress(progress: Omit<ToolProgress, 'invocationId'>): void | Promise<void>
}

export type ExtensionToolHandler<TInput extends JsonObject = JsonObject, TResult extends JsonValue = JsonValue> = (
  input: TInput,
  context: ToolInvocationContext
) => TResult | ToolResult | Promise<TResult | ToolResult>
