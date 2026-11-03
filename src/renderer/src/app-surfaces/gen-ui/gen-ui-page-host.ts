import { parseGenUiWidgetState } from '../../../../../kun/src/contracts/gen-ui'
import i18n from '../../i18n'
import { appSandboxApi, subscribeAppSandbox } from '../app-sandbox-client'
import { openAppLink, sendAppFollowUp } from '../app-surface-actions'
import { attachAppSurfaceContext, threadWorkspaceRoot } from '../app-surface-composer-context'
import { appRuntimeRequest } from '../app-runtime-request'

type JsonRpcRequest = { jsonrpc: '2.0'; id?: string | number; method?: string; params?: Record<string, unknown> }

export const GEN_UI_MIN_HEIGHT = 80
export const GEN_UI_MAX_HEIGHT = 10_000

function isRequest(value: unknown): value is JsonRpcRequest {
  return Boolean(value) && typeof value === 'object' && (value as { jsonrpc?: unknown }).jsonrpc === '2.0' &&
    typeof (value as { method?: unknown }).method === 'string'
}

/**
 * Host side of the private Gen UI page protocol for one live instance.
 * Pages get exactly four capabilities: save their state snapshot, ask for a
 * follow-up message, open an http(s) link, and report their content height.
 */
export function attachGenUiPageHost(input: {
  instanceId: string
  threadId: string
  widgetId: string
  title: string
  onHeight: (height: number) => void
  onPageError: (message: string) => void
}): () => void {
  const respond = (id: string | number | undefined, payload: { result?: unknown; error?: string }): void => {
    if (id === undefined) return
    const message = payload.error === undefined
      ? { jsonrpc: '2.0', id, result: payload.result ?? {} }
      : { jsonrpc: '2.0', id, error: { code: -32000, message: payload.error } }
    void appSandboxApi()?.post(input.instanceId, message)
  }

  const saveState = async (params: Record<string, unknown> | undefined): Promise<void> => {
    const state = parseGenUiWidgetState(params?.state)
    const response = await appRuntimeRequest(
      `/v1/threads/${encodeURIComponent(input.threadId)}/gen-ui/state/${input.widgetId}`,
      'PUT',
      { state }
    )
    if (!response.ok) throw new Error(response.message)
    if (state.modelContent !== null) {
      await attachAppSurfaceContext({
        threadId: input.threadId,
        workspaceRoot: threadWorkspaceRoot(input.threadId),
        key: `gen-ui:${input.widgetId}`,
        kind: 'gen-ui-state',
        title: i18n.t('common:appSurfaceWidgetStateChip', { title: input.title }),
        summary: i18n.t('common:appSurfaceWidgetStateSummary'),
        label: input.title,
        data: state.modelContent
      })
    }
  }

  const handle = async (message: JsonRpcRequest): Promise<void> => {
    const params = message.params ?? {}
    switch (message.method) {
      case 'kun/gen-ui/size': {
        const height = Number(params.height)
        if (Number.isFinite(height)) {
          input.onHeight(Math.min(GEN_UI_MAX_HEIGHT, Math.max(GEN_UI_MIN_HEIGHT, Math.ceil(height))))
        }
        return
      }
      case 'kun/gen-ui/log':
        input.onPageError(String(params.message ?? '').slice(0, 300))
        return
      case 'kun/gen-ui/ready':
        return
      case 'kun/gen-ui/state':
        try {
          await saveState(params)
          respond(message.id, { result: {} })
        } catch (error) {
          respond(message.id, { error: error instanceof Error ? error.message : 'Could not save state' })
        }
        return
      case 'kun/gen-ui/follow-up': {
        const sent = await sendAppFollowUp({
          instanceId: input.instanceId,
          threadId: input.threadId,
          prompt: String(params.prompt ?? ''),
          ...(typeof params.title === 'string' ? { title: params.title } : {}),
          appLabel: input.title
        }).catch(() => false)
        respond(message.id, { result: { sent } })
        return
      }
      case 'kun/gen-ui/open-link': {
        const opened = await openAppLink({
          instanceId: input.instanceId,
          url: String(params.href ?? ''),
          appLabel: input.title
        }).catch(() => false)
        respond(message.id, opened ? { result: {} } : { error: 'The link was not opened.' })
        return
      }
      default:
        respond(message.id, { error: `Unsupported method ${message.method}` })
    }
  }

  return subscribeAppSandbox(input.instanceId, (message) => {
    if (isRequest(message)) void handle(message)
  })
}
