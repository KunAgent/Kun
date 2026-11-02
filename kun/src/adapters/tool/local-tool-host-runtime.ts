import type { ToolHostContext } from '../../ports/tool-host.js'
import { toolResultTextWithoutImages } from '../../loop/tool-result-image.js'
import { prepareToolResultImageBudget } from '../../loop/tool-result-image-budget.js'

export function isUnknownOutcomeError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'unknownOutcome' in error && error.unknownOutcome === true)
}

const ARTIFACT_OUTPUT_THRESHOLD_BYTES = 128 * 1024

export async function offloadLargeToolOutput(
  output: unknown,
  toolName: string,
  context: ToolHostContext
): Promise<unknown> {
  const prepared = prepareToolResultImageBudget(output)
  output = prepared.output
  const imageFields = prepared.imageFields
  if (!context.artifactStore) return output
  let content: string
  try {
    content = imageFields ? toolResultTextWithoutImages(output)
      : typeof output === 'string' ? output : JSON.stringify(output)
  } catch {
    return output
  }
  if (Buffer.byteLength(content, 'utf8') <= ARTIFACT_OUTPUT_THRESHOLD_BYTES) return output
  try {
    const stored = await context.artifactStore.put({ content, source: 'tool', origin: toolName })
    return {
      artifactId: stored.meta.id,
      byteSize: stored.meta.byteSize,
      lineCount: stored.meta.lineCount,
      truncated: stored.summary.truncated,
      preview: stored.summary.inline,
      ...imageFields
    }
  } catch {
    return output
  }
}

export function hookContext(
  context: ToolHostContext
): Pick<
  ToolHostContext,
  | 'threadId'
  | 'turnId'
  | 'workspace'
  | 'threadMode'
  | 'approvalPolicy'
  | 'sandboxMode'
  | 'clientSurface'
> {
  return {
    threadId: context.threadId,
    turnId: context.turnId,
    workspace: context.workspace,
    approvalPolicy: context.approvalPolicy,
    ...(context.clientSurface ? { clientSurface: context.clientSurface } : {}),
    ...(context.sandboxMode ? { sandboxMode: context.sandboxMode } : {}),
    ...(context.threadMode ? { threadMode: context.threadMode } : {})
  }
}

export function hookErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `tool hook failed: ${message}`
}
