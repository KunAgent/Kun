import {
  ExtensionApiError,
  type ExtensionContext,
  type JsonObject,
  type JsonValue,
  type ToolInvocationContext,
  type ToolResult
} from '@kun/extension-api'
import {
  PresentationParseError,
  parsePresentationOperations,
  stableStringify,
  validatePresentationProject,
  type PresentationOperation
} from '../shared/presentation.js'
import {
  PresentationProjectService,
  type PresentationApplyResult,
  type PresentationReadResult,
  type ServiceControl
} from './presentation-project-service.js'
import {
  MAX_TOOL_CHANGED_IDS,
  MAX_TOOL_ISSUES,
  presentationCommandContributions,
  presentationToolDeclarations
} from './tool-contracts.js'

export const PRESENTATION_CHANGED_CHANNEL = 'presentation.changed' as const

export interface PresentationChangedPayload {
  readonly path: string
  readonly revision: number
  readonly source: 'command' | 'tool'
  readonly changedIds: string[]
}

export async function activate(context: ExtensionContext): Promise<void> {
  const service = new PresentationProjectService(context.workspace)
  await registerCommands(context, service)
  await registerTools(context, service)
}

export async function deactivate(): Promise<void> {
  // Kun disposes command and tool registrations and cancels pending invocations.
}

async function registerCommands(
  context: ExtensionContext,
  service: PresentationProjectService
): Promise<void> {
  const handlers: Record<string, (input: JsonObject) => Promise<JsonValue>> = {
    'presentation-create': async (input) => {
      const result = await service.create({
        path: requiredString(input, 'path'),
        ...optionalStringProperty(input, 'title')
      })
      await notifyChanged(context, {
        path: result.path,
        revision: result.project.revision,
        source: 'command',
        changedIds: [result.project.id, ...result.project.slides.map(({ id }) => id)]
      })
      return toJson(result)
    },
    'presentation-load': async (input) =>
      toJson(await service.read(requiredString(input, 'path'))),
    'presentation-save': async (input) => {
      const result = await service.apply({
        path: requiredString(input, 'path'),
        expectedRevision: requiredNumber(input, 'expectedRevision'),
        operations: operationsFrom(input),
        ...optionalStringProperty(input, 'operationId')
      })
      if (!result.idempotentReplay) {
        await notifyChanged(context, changeFromApply(result, 'command'))
      }
      return toJson({ ...result, revision: result.currentRevision })
    },
    'presentation-export-copy': async (input) => {
      const result = await service.exportCopy({
        path: requiredString(input, 'path'),
        destinationPath: requiredString(input, 'destinationPath'),
        expectedRevision: requiredNumber(input, 'expectedRevision')
      })
      if (!result.idempotentReplay) {
        await notifyChanged(context, {
          path: result.destinationPath,
          revision: result.revision,
          source: 'command',
          changedIds: []
        })
      }
      return toJson(result)
    }
  }

  for (const declaration of presentationCommandContributions) {
    const handler = handlers[declaration.id]
    context.subscriptions.add(
      await context.commands.registerCommand(declaration.id, async (args) =>
        handler(asObject(args))
      )
    )
  }
}

async function registerTools(
  context: ExtensionContext,
  service: PresentationProjectService
): Promise<void> {
  const handlers: Record<
    string,
    (input: JsonObject, invocation: ToolInvocationContext) => Promise<ToolResult>
  > = {
    'presentation-create': async (input, invocation) => {
      const result = await service.create({
        path: requiredString(input, 'path'),
        ...optionalStringProperty(input, 'title')
      }, toolControl(invocation))
      const warnings = validatePresentationProject(result.project).warnings
      const boundedWarnings = bounded(warnings, MAX_TOOL_ISSUES)
      await notifyChanged(context, {
        path: result.path,
        revision: result.project.revision,
        source: 'tool',
        changedIds: [result.project.id, ...result.project.slides.map(({ id }) => id)]
      })
      return toolResult(
        {
          path: result.path,
          revision: result.project.revision,
          contentSha256: result.contentSha256,
          warnings: boundedWarnings.items,
          warningCount: boundedWarnings.count,
          warningsTruncated: boundedWarnings.truncated
        },
        `Created ${result.path} at revision ${result.project.revision}`
      )
    },
    'presentation-read': async (input, invocation) => {
      const result = await service.read(requiredString(input, 'path'), toolControl(invocation))
      return toolResult(result, `Read ${result.path} at revision ${result.project.revision}`)
    },
    'presentation-apply': async (input, invocation) => {
      const result = await service.apply({
        path: requiredString(input, 'path'),
        expectedRevision: requiredNumber(input, 'expectedRevision'),
        operationId: optionalString(input, 'operationId') ?? invocation.invocation.invocationId,
        operations: operationsFrom(input)
      }, toolControl(invocation))
      if (!result.idempotentReplay) {
        await notifyChanged(context, changeFromApply(result, 'tool'))
      }
      const changedIds = bounded(result.changedIds, MAX_TOOL_CHANGED_IDS)
      const warnings = bounded(result.warnings, MAX_TOOL_ISSUES)
      return toolResult({
        path: result.path,
        resultingRevision: result.resultingRevision,
        currentRevision: result.currentRevision,
        contentSha256: result.contentSha256,
        changedIds: changedIds.items,
        changedIdCount: changedIds.count,
        changedIdsTruncated: changedIds.truncated,
        warnings: warnings.items,
        warningCount: warnings.count,
        warningsTruncated: warnings.truncated,
        idempotentReplay: result.idempotentReplay
      }, result.idempotentReplay
        ? `Replayed operation receipt at revision ${result.resultingRevision}`
        : `Applied operations as revision ${result.resultingRevision}`)
    },
    'presentation-validate': async (input, invocation) => {
      const result = await service.validate(requiredString(input, 'path'), toolControl(invocation))
      const errors = bounded(result.errors, MAX_TOOL_ISSUES)
      const warnings = bounded(result.warnings, MAX_TOOL_ISSUES)
      return toolResult({
        path: result.path,
        revision: result.revision,
        valid: result.valid,
        errors: errors.items,
        errorCount: errors.count,
        errorsTruncated: errors.truncated,
        warnings: warnings.items,
        warningCount: warnings.count,
        warningsTruncated: warnings.truncated
      }, result.valid
        ? `Validated ${result.path} with ${result.warnings.length} warning(s)`
        : `Validation failed for ${result.path}`)
    },
    'presentation-export-copy': async (input, invocation) => {
      const result = await service.exportCopy({
        path: requiredString(input, 'path'),
        destinationPath: requiredString(input, 'destinationPath'),
        expectedRevision: requiredNumber(input, 'expectedRevision')
      }, toolControl(invocation))
      if (!result.idempotentReplay) {
        await notifyChanged(context, {
          path: result.destinationPath,
          revision: result.revision,
          source: 'tool',
          changedIds: []
        })
      }
      return toolResult(result, result.idempotentReplay
        ? `Verified existing copy ${result.destinationPath}`
        : `Exported copy to ${result.destinationPath}`)
    }
  }

  for (const declaration of presentationToolDeclarations) {
    const handler = handlers[declaration.id]
    context.subscriptions.add(
      await context.tools.registerTool(declaration, (input, invocation) =>
        handler(input, invocation)
      )
    )
  }
}

function changeFromApply(
  result: PresentationApplyResult,
  source: PresentationChangedPayload['source']
): PresentationChangedPayload {
  return {
    path: result.path,
    revision: result.currentRevision,
    source,
    changedIds: result.changedIds
  }
}

async function notifyChanged(
  context: ExtensionContext,
  payload: PresentationChangedPayload
): Promise<void> {
  try {
    await context.ui.postMessage({ channel: PRESENTATION_CHANGED_CHANNEL, payload: toJson(payload) })
  } catch {
    // A closed or unavailable View cannot invalidate an already verified write.
  }
}

function toolControl(invocation: ToolInvocationContext): ServiceControl {
  return {
    isCancellationRequested: () => invocation.cancellation.isCancellationRequested,
    reportProgress: (progress) => invocation.reportProgress(progress)
  }
}

function toolResult(content: unknown, summary: string): ToolResult {
  return { content: toJson(content), summary }
}

function bounded<T>(values: readonly T[], limit: number): {
  items: T[]
  count: number
  truncated: boolean
} {
  return {
    items: values.slice(0, limit),
    count: values.length,
    truncated: values.length > limit
  }
}

function asObject(value: JsonValue | undefined): JsonObject {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError('Command input must be an object')
  }
  return value
}

function requiredString(input: JsonObject, key: string): string {
  const value = input[key]
  if (typeof value !== 'string') throw new TypeError(`${key} must be a string`)
  return value
}

function requiredNumber(input: JsonObject, key: string): number {
  const value = input[key]
  if (typeof value !== 'number') throw new TypeError(`${key} must be a number`)
  return value
}

function optionalString(input: JsonObject, key: string): string | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new TypeError(`${key} must be a string`)
  return value
}

function optionalStringProperty(
  input: JsonObject,
  key: string
): { [key: string]: string } | Record<string, never> {
  const value = input[key]
  if (value === undefined) return {}
  if (typeof value !== 'string') throw new TypeError(`${key} must be a string`)
  return { [key]: value }
}

export function operationsFrom(input: JsonObject): PresentationOperation[] {
  try {
    return parsePresentationOperations(input.operations)
  } catch (error) {
    if (error instanceof ExtensionApiError) throw error
    const issues = error instanceof PresentationParseError
      ? error.issues.slice(0, MAX_TOOL_ISSUES)
      : [{
          code: 'invalid_operations',
          path: '$operations',
          message: error instanceof Error ? error.message.slice(0, 4096) : 'Operations could not be parsed'
        }]
    throw new ExtensionApiError({
      code: 'VALIDATION_FAILED',
      message: 'Presentation operations did not pass deep validation',
      operation: 'presentation.operations.parse',
      retryable: false,
      details: { issues }
    })
  }
}

function toJson(value: unknown): JsonValue {
  return JSON.parse(stableStringify(value)) as JsonValue
}

export type {
  PresentationApplyResult,
  PresentationReadResult
}
