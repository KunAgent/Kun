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
      'Create a Google Colab GPU/CPU session for the current workspace, mount Google Drive (/content/drive) by default for large models and checkpoints, sync selected files, run a training command, stream progress, and optionally auto-stop the VM after flushing Drive writes. Consumes Compute Units (CU) on the user-selected connection.',
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
          description:
            'Training command to run in /content, e.g. "python train.py --output_dir /content/drive/MyDrive/checkpoints/run1". Save large model checkpoints to /content/drive/MyDrive/... so they persist.'
        },
        accelerator: {
          type: 'string',
          enum: ['T4', 'L4', 'G4', 'A100', 'H100', 'V6E1', 'V5E1', 'CPU'],
          description:
            'Colab hardware accelerator: GPUs T4 (15GB), L4 (24GB), G4 (96GB), A100 (40/80GB), H100 (80GB); TPUs V6E1 (v6e-1), V5E1 (v5e-1); or CPU. Defaults to T4.'
        },
        highMem: {
          type: 'boolean',
          description:
            'Request a High-RAM VM shape (--high-mem) when supported by the accelerator (CPU, T4, A100).'
        },
        syncPaths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Relative files or directories from the workspace to upload before running.'
        },
        outputRemoteDir: {
          type: 'string',
          description:
            'Remote directory under /content (e.g. "/content/drive/MyDrive/checkpoints" or "outputs/"). Paths inside /content/drive stay persisted in Google Drive without downloading multi-GB weights locally.'
        },
        outputLocalDir: {
          type: 'string',
          description: 'Local workspace directory where non-Drive outputs are downloaded (default "./outputs").'
        },
        mountDrive: {
          type: 'boolean',
          description:
            'Mount Google Drive at /content/drive before running (default true). Keep enabled when loading large models or saving training checkpoints.'
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
      const defaultRates: Record<string, number> = {
        T4: 1.8,
        L4: 4.8,
        G4: 8.8,
        A100: 11.8,
        H100: 18.1,
        V6E1: 4.1,
        V5E1: 2.9,
        CPU: 0.1
      }
      let rateCu = defaultRates[accel] ?? 1.8
      let accelLabel = accel === 'V6E1' ? 'v6e-1 TPU' : accel === 'V5E1' ? 'v5e-1 TPU' : accel
      let balanceSuffix = ''

      try {
        const preview = await callColabBridge<{
          requireApprovalForAgent: boolean
          connection: { name: string; email: string; balanceCu: number | null } | null
          acceleratorSpec: { estimatedCuPerHour: number; fullLabel?: string }
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
        accelLabel = preview.acceleratorSpec?.fullLabel ?? accelLabel
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
      const mountDrive = args.mountDrive !== false
      const highMemSuffix = args.highMem === true ? '（高内存）' : ''
      const userReason = typeof args.reason === 'string' && args.reason.trim() ? args.reason.trim() : ''
      const fullReason = [
        `连接：${connSummary}`,
        `加速器：${accelLabel}${highMemSuffix} · ~${rateCu} CU/h`,
        ...(mountDrive ? ['云盘：自动挂载 /content/drive（持久化模型与 Checkpoint）'] : []),
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
            ...(typeof args.highMem === 'boolean' ? { highMem: args.highMem } : {}),
            syncPaths: Array.isArray(args.syncPaths) ? args.syncPaths : [],
            outputRemoteDir: args.outputRemoteDir ?? 'outputs/',
            outputLocalDir: args.outputLocalDir ?? './outputs',
            mountDrive: args.mountDrive !== false,
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
