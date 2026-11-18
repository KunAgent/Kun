import type { ApprovalActionEnvelope } from '../../contracts/approvals.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { callColabBridge, type ColabBridgeBinding } from './colab-bridge-client.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'

type NotebookPoll =
  | { status: 'running'; requestId: string }
  | { status: 'done'; requestId: string; result: NotebookAgentResult }

type NotebookAgentResult =
  | {
      ok: true
      notebookPath?: string
      runtime?: string
      cells?: Array<{ number: number; kind: string; status: string; executionCount: number | null; output: string }>
      variables?: Array<{ name: string; typeName: string; summary: string }>
    }
  | { ok: false; message: string }

/** Long-polls the GUI bridge until the open notebook page finishes the request. */
async function runNotebookRequest(
  binding: ColabBridgeBinding,
  path: string,
  body: Record<string, unknown>,
  context: ToolHostContext
): Promise<NotebookAgentResult> {
  let poll = await callColabBridge<NotebookPoll>(binding, path, body, context.abortSignal)
  while (poll.status === 'running') {
    if (context.abortSignal?.aborted) {
      await callColabBridge(binding, '/v1/notebook/interrupt', { workspaceRoot: body.workspaceRoot }).catch(() => undefined)
      return { ok: false, message: 'Notebook run was interrupted.' }
    }
    try {
      poll = await callColabBridge<NotebookPoll>(
        binding,
        '/v1/notebook/result',
        { requestId: poll.requestId },
        context.abortSignal
      )
    } catch (error) {
      if (context.abortSignal?.aborted) {
        await callColabBridge(binding, '/v1/notebook/interrupt', { workspaceRoot: body.workspaceRoot }).catch(() => undefined)
        return { ok: false, message: 'Notebook run was interrupted.' }
      }
      throw error
    }
  }
  return poll.result
}

function toToolResult(result: NotebookAgentResult): { output: unknown; isError?: boolean } {
  if (!result.ok) return { isError: true, output: { error: result.message } }
  return { output: result }
}

export function buildColabNotebookTools(
  binding: ColabBridgeBinding,
  shouldAdvertise: (context: ToolHostContext) => boolean
): LocalTool[] {
  const runCellsTool: LocalTool = LocalToolHost.defineTool({
    name: 'notebook_run_cells',
    description:
      'Run cells of the notebook open in the Kun Colab page on its connected kernel (Google Colab runtime or Jupyter server) and return each cell status and output. Outputs also appear in the notebook UI and are saved to the .ipynb. Save your .ipynb edits before calling this. Use this instead of colab_run for notebook work.',
    toolKind: 'command_execution',
    sideEffect: 'unknown',
    effects: {
      network: true,
      externalWrite: true,
      processExecution: true,
      guiAutomation: false
    },
    policy: 'on-request',
    shouldAdvertise,
    inputSchema: {
      type: 'object',
      properties: {
        cells: {
          type: 'array',
          items: { type: 'integer', minimum: 1 },
          description: '1-based cell numbers to run in order. Omit to run all code cells.'
        },
        path: {
          type: 'string',
          description: 'Workspace-relative .ipynb path. Omit to use the notebook currently open in the Colab page.'
        }
      },
      additionalProperties: false
    },
    buildApprovalAction: (call, context): ApprovalActionEnvelope => {
      const args = call.arguments
      const cells = Array.isArray(args.cells) ? args.cells.join(', ') : 'all code cells'
      const path = typeof args.path === 'string' && args.path ? args.path : 'open notebook'
      return {
        version: 1,
        kind: 'external-effect',
        toolName: 'notebook_run_cells',
        providerId: 'colab',
        providerKind: 'gui',
        toolKind: 'command_execution',
        effects: { network: true, externalWrite: true, processExecution: true, guiAutomation: false },
        arguments: args,
        workspace: context.workspace || process.cwd(),
        targets: [{ kind: 'command', value: `${path}: ${cells}`.slice(0, 500) }],
        reason: `Run notebook cells (${cells}) in ${path} on the connected kernel.`
      }
    },
    buildApprovalSummary: (action) => action.reason ?? 'Run notebook cells',
    execute: async (args, context) => {
      try {
        const result = await runNotebookRequest(
          binding,
          '/v1/notebook/run',
          {
            workspaceRoot: context.workspace || '',
            ...(Array.isArray(args.cells) ? { cells: args.cells } : {}),
            ...(typeof args.path === 'string' ? { path: args.path } : {})
          },
          context
        )
        return toToolResult(result)
      } catch (error) {
        return { isError: true, output: { error: error instanceof Error ? error.message : String(error) } }
      }
    }
  })

  const variablesTool: LocalTool = LocalToolHost.defineTool({
    name: 'notebook_variables',
    description:
      'Read-only list of user variables (name, type, shape/size summary) in the kernel connected to the notebook open in the Kun Colab page.',
    toolKind: 'tool_call',
    sideEffect: 'read-only',
    effects: {
      network: true,
      externalWrite: false,
      processExecution: false,
      guiAutomation: false
    },
    policy: 'auto',
    shouldAdvertise,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (_args, context) => {
      try {
        const result = await runNotebookRequest(
          binding,
          '/v1/notebook/variables',
          { workspaceRoot: context.workspace || '' },
          context
        )
        return toToolResult(result)
      } catch (error) {
        return { isError: true, output: { error: error instanceof Error ? error.message : String(error) } }
      }
    }
  })

  return [runCellsTool, variablesTool]
}
