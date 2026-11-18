import type { ApprovalActionEnvelope } from '../../contracts/approvals.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { callColabBridge, type ColabBridgeBinding } from './colab-bridge-client.js'
import { buildColabNotebookTools } from './colab-notebook-tools.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'

export const KUN_COLAB_BRIDGE_URL_ENV = 'KUN_COLAB_BRIDGE_URL'
export const KUN_COLAB_BRIDGE_TOKEN_ENV = 'KUN_COLAB_BRIDGE_TOKEN'

function resolveColabBridgeBinding(): ColabBridgeBinding | null {
  const url = process.env[KUN_COLAB_BRIDGE_URL_ENV]?.trim()
  const token = process.env[KUN_COLAB_BRIDGE_TOKEN_ENV]?.trim()
  if (!url || !token) return null
  return { url, token }
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Aborted'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason ?? new Error('Aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function buildColabToolProviders(options?: {
  binding?: ColabBridgeBinding | null
}): CapabilityToolProvider[] {
  const binding = options?.binding !== undefined ? options.binding : resolveColabBridgeBinding()
  if (!binding) return []

  const guiOnly = (context: ToolHostContext): boolean => context.clientSurface === 'gui'

  const colabStatusTool: LocalTool = LocalToolHost.defineTool({
    name: 'colab_status',
    description:
      'Read-only check of Google Colab connections, Compute Unit (CU) balances, active training sessions, metrics, and recent logs for the current workspace.',
    toolKind: 'tool_call',
    sideEffect: 'read-only',
    effects: {
      network: true,
      externalWrite: false,
      processExecution: false,
      guiAutomation: false
    },
    policy: 'auto',
    shouldAdvertise: guiOnly,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Optional session id or session name to inspect.'
        }
      },
      additionalProperties: false
    },
    execute: async (args, context) => {
      try {
        const status = await callColabBridge<Record<string, unknown>>(
          binding,
          '/v1/colab/status',
          {
            workspaceRoot: context.workspace || '',
            ...(typeof args.sessionId === 'string' ? { sessionId: args.sessionId } : {})
          },
          context.abortSignal
        )
        return { output: status }
      } catch (error) {
        return {
          isError: true,
          output: { error: error instanceof Error ? error.message : String(error) }
        }
      }
    }
  })

  const colabRunTool: LocalTool = LocalToolHost.defineTool({
    name: 'colab_run',
    description:
      'Create a Google Colab GPU/CPU session for the current workspace, sync selected files, run a training command, stream progress, download output artifacts back to the workspace, and optionally auto-stop the VM when finished. Consumes Compute Units (CU) on the user-selected connection.',
    toolKind: 'command_execution',
    sideEffect: 'unknown',
    effects: {
      network: true,
      externalWrite: true,
      processExecution: true,
      guiAutomation: false
    },
    policy: 'on-request',
    shouldAdvertise: guiOnly,
    inputSchema: {
      type: 'object',
      properties: {
        entryCommand: {
          type: 'string',
          description: 'Training command to run in /content, e.g. "python train.py --epochs 10 --out outputs/".'
        },
        accelerator: {
          type: 'string',
          enum: ['T4', 'L4', 'A100', 'CPU'],
          description: 'Colab hardware accelerator. Defaults to T4.'
        },
        syncPaths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Relative files or directories from the workspace to upload before running.'
        },
        outputRemoteDir: {
          type: 'string',
          description: 'Remote directory under /content to download after completion (default "outputs/").'
        },
        outputLocalDir: {
          type: 'string',
          description: 'Local workspace directory where outputs are downloaded (default "./outputs").'
        },
        maxRuntimeHours: {
          type: 'number',
          minimum: 0.5,
          maximum: 24,
          description: 'Maximum runtime hours before automatic termination (default 3).'
        },
        autoStop: {
          type: 'boolean',
          description: 'Automatically stop the Colab runtime when the command finishes or fails (default true).'
        },
        connectionId: {
          type: 'string',
          description: 'Optional connection id or name. Omit to use the workspace active connection.'
        },
        reason: {
          type: 'string',
          description: 'Short explanation shown in the approval card for why this GPU/session is requested.'
        },
        waitForCompletion: {
          type: 'boolean',
          description: 'Wait until the training command finishes and outputs are downloaded (default true).'
        }
      },
      required: ['entryCommand'],
      additionalProperties: false
    },
    buildApprovalAction: async (call, context): Promise<ApprovalActionEnvelope> => {
      const args = call.arguments
      const accel = typeof args.accelerator === 'string' ? args.accelerator.toUpperCase() : 'T4'
      const maxHours = typeof args.maxRuntimeHours === 'number' ? args.maxRuntimeHours : 3
      const cmd = typeof args.entryCommand === 'string' ? args.entryCommand : 'python train.py'
      let requireUser = true
      let connSummary = '当前工作区默认连接'
      let rateCu = accel === 'A100' ? 11.8 : accel === 'L4' ? 4.8 : accel === 'CPU' ? 0.1 : 1.8
      let balanceSuffix = ''

      try {
        const preview = await callColabBridge<{
          requireApprovalForAgent: boolean
          connection: { name: string; email: string; balanceCu: number | null } | null
          acceleratorSpec: { estimatedCuPerHour: number }
        }>(
          binding,
          '/v1/colab/preview',
          {
            workspaceRoot: context.workspace || '',
            accelerator: accel,
            ...(typeof args.connectionId === 'string' ? { connectionId: args.connectionId } : {})
          },
          context.abortSignal
        )
        requireUser = preview.requireApprovalForAgent
        rateCu = preview.acceleratorSpec?.estimatedCuPerHour ?? rateCu
        if (preview.connection) {
          connSummary = `${preview.connection.name} · ${preview.connection.email}`
          if (preview.connection.balanceCu !== null) {
            balanceSuffix = `（余额 ${preview.connection.balanceCu} CU）`
          }
        }
      } catch {
        // Keep conservative requireUser = true if preview fails.
      }

      const maxCu = Number((rateCu * maxHours).toFixed(1))
      const userReason = typeof args.reason === 'string' && args.reason.trim() ? args.reason.trim() : ''
      const fullReason = [
        `连接：${connSummary}`,
        `加速器：${accel} · ~${rateCu} CU/h`,
        `命令：${cmd}`,
        `上限：${maxHours} 小时 · 最多 ~${maxCu} CU${balanceSuffix}`,
        ...(userReason ? [`原因：${userReason}`] : [])
      ].join('\n')

      return {
        version: 1,
        kind: 'external-effect',
        toolName: 'colab_run',
        providerId: 'colab',
        providerKind: 'gui',
        toolKind: 'command_execution',
        effects: {
          network: true,
          externalWrite: true,
          processExecution: true,
          guiAutomation: false
        },
        arguments: args,
        workspace: context.workspace || process.cwd(),
        targets: [{ kind: 'command', value: cmd.slice(0, 500) }],
        reason: fullReason,
        ...(requireUser ? { requiresUserDecision: true, reviewerRequirement: 'user' as const } : {})
      }
    },
    buildApprovalSummary: (action) =>
      `创建 Colab 会话（将消耗 CU）\n${action.reason}`,
    execute: async (args, context, onUpdate) => {
      try {
        const started = await callColabBridge<{
          ok: boolean
          message?: string
          session?: {
            id: string
            sessionName: string
            connectionName: string
            connectionEmail: string
            accelerator: string
            phase: string
            consumedCu: number
            estimatedTotalCu: number
            progressSummary?: string
          }
        }>(
          binding,
          '/v1/colab/start',
          {
            workspaceRoot: context.workspace || '',
            entryCommand: args.entryCommand,
            accelerator: args.accelerator ?? 'T4',
            syncPaths: Array.isArray(args.syncPaths) ? args.syncPaths : [],
            outputRemoteDir: args.outputRemoteDir ?? 'outputs/',
            outputLocalDir: args.outputLocalDir ?? './outputs',
            maxRuntimeHours: args.maxRuntimeHours ?? 3,
            autoStop: args.autoStop ?? true,
            ...(typeof args.connectionId === 'string' ? { connectionId: args.connectionId } : {})
          },
          context.abortSignal
        )
        if (!started.ok || !started.session) {
          return {
            isError: true,
            output: { error: started.message || '启动 Colab 会话失败。' }
          }
        }

        const sessionId = started.session.id
        const waitForCompletion = args.waitForCompletion !== false
        if (!waitForCompletion) {
          return {
            output: {
              colabRun: {
                kind: 'colab_run',
                sessionId,
                sessionName: started.session.sessionName,
                connectionLabel: `${started.session.connectionName} · ${started.session.connectionEmail}`,
                accelerator: started.session.accelerator,
                entryCommand: String(args.entryCommand),
                phase: started.session.phase,
                consumedCu: started.session.consumedCu,
                estimatedTotalCu: started.session.estimatedTotalCu
              }
            }
          }
        }

        for (;;) {
          await sleepWithAbort(2_500, context.abortSignal)
          const poll = await callColabBridge<{
            sessions: Array<{
              id: string
              sessionName: string
              connectionName: string
              connectionEmail: string
              accelerator: string
              phase: string
              consumedCu: number
              estimatedTotalCu: number
              progressSummary?: string
              logTail: string[]
              artifacts: Array<{ name: string; sizeBytes: number }>
              errorMessage?: string
            }>
          }>(
            binding,
            '/v1/colab/status',
            { sessionId, workspaceRoot: context.workspace || '' },
            context.abortSignal
          )
          const current = poll.sessions[0]
          if (!current) break

          const marker = {
            kind: 'colab_run',
            sessionId: current.id,
            sessionName: current.sessionName,
            connectionLabel: `${current.connectionName} · ${current.connectionEmail}`,
            accelerator: current.accelerator,
            entryCommand: String(args.entryCommand),
            phase: current.phase,
            progressSummary: current.progressSummary,
            consumedCu: current.consumedCu,
            estimatedTotalCu: current.estimatedTotalCu,
            artifacts: current.artifacts,
            errorMessage: current.errorMessage
          }
          await onUpdate?.({ output: { colabRun: marker } })

          if (['completed', 'failed', 'stopped', 'disconnected'].includes(current.phase)) {
            return {
              isError: current.phase === 'failed' || current.phase === 'disconnected',
              output: {
                colabRun: marker,
                logTail: current.logTail.slice(-30)
              }
            }
          }
        }

        return { output: { sessionId, status: 'ended' } }
      } catch (error) {
        return {
          isError: true,
          output: { error: error instanceof Error ? error.message : String(error) }
        }
      }
    }
  })

  const colabStopTool: LocalTool = LocalToolHost.defineTool({
    name: 'colab_stop',
    description:
      'Immediately stop a running Google Colab session to halt Compute Unit (CU) billing.',
    toolKind: 'tool_call',
    sideEffect: 'unknown',
    effects: {
      network: true,
      externalWrite: true,
      processExecution: false,
      guiAutomation: false
    },
    policy: 'auto',
    shouldAdvertise: guiOnly,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session id or session name to stop.'
        }
      },
      required: ['sessionId'],
      additionalProperties: false
    },
    execute: async (args, context) => {
      try {
        const res = await callColabBridge<Record<string, unknown>>(
          binding,
          '/v1/colab/stop',
          { sessionId: String(args.sessionId ?? '') },
          context.abortSignal
        )
        return { output: res }
      } catch (error) {
        return {
          isError: true,
          output: { error: error instanceof Error ? error.message : String(error) }
        }
      }
    }
  })

  return [
    {
      id: 'colab',
      kind: 'gui',
      enabled: true,
      available: true,
      tools: [colabStatusTool, colabRunTool, colabStopTool, ...buildColabNotebookTools(binding, guiOnly)]
    }
  ]
}
