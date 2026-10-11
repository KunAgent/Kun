import { recordProviderInferenceEvidence } from '../../services/provider-catalog-operations.js'
import { createHash, randomUUID } from 'node:crypto'
import { ModelUtilityRequestSchema } from '../../contracts/model-utility.js'
import { LOCAL_MODEL_GATEWAY_PROVIDER_ID } from '../../contracts/model-route-pool.js'
import type { GatewayUsageRecorder } from '../../services/gateway-usage-service.js'
import { makeModelRequest, nextGatewayChunk } from './model-gateway-core.js'
import { strictRuntimeTokenAuthorized } from './gateway-request-guard.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse } from '../response.js'
import type { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'

/** Text-only helper calls share the Runtime's provider clients, scheduler and configuration. */
export function registerModelUtilityRoutes(router: Router, runtime: ServerRuntime): void {
  router.add('POST', '/v1/model-requests', async (request) => {
    if (!strictRuntimeTokenAuthorized(request, runtime.runtimeToken)) return jsonResponse({ message: 'unauthorized' }, 401)
    const body = await readJsonBody(request, 2 * 1024 * 1024, request.signal)
    if (!body.ok) return body.response
    const parsed = ModelUtilityRequestSchema.safeParse(body.value)
    if (!parsed.success) return jsonResponse({ message: 'Invalid text model request' }, 400)
    const input = parsed.data
    if (!runtime.modelClient || !runtime.modelConnections) return jsonResponse({ message: 'Model runtime is unavailable' }, 503)
    const snapshot = await runtime.modelConnections.snapshot()
    try { await runtime.modelConnections.assertActiveConfiguration?.(snapshot.revision) }
    catch { return jsonResponse({ message: 'Provider configuration is not active' }, 503) }
    const connection = snapshot.providers.find((provider) => provider.id === input.providerId)
    const route = input.providerId === LOCAL_MODEL_GATEWAY_PROVIDER_ID && runtime.modelGateway?.configuredPools?.()
      .some((pool) => pool.enabled && pool.modelId === input.model)
    if (!route && (!connection?.configured || connection.enabled === false)) return jsonResponse({ message: 'The selected provider connection is unavailable' }, 409)
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(input.timeoutMs)])
    let recorder: GatewayUsageRecorder | undefined
    let iterator: AsyncIterator<import('../../ports/model-client.js').ModelStreamChunk> | undefined
    try {
      if (runtime.modelGateway?.usage) {
        const hash = createHash('sha256').update(`kun-model-utility:${input.purpose}`).digest('hex').slice(0, 32)
        const clientId = `gc_${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`
        recorder = await runtime.modelGateway.usage.begin({ source: 'utility',
          client: { clientId, name: input.purpose, credentialKind: 'client' }, sessionHeader: null,
          requestedModelId: input.model, resolved: { model: input.model, providerId: input.providerId } })
      }
      const modelRequest = makeModelRequest({ model: input.model, messages: input.messages, max_tokens: input.maxOutputTokens,
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        ...(input.jsonMode ? { response_format: { type: 'json_object' } } : {}), stream: false },
      signal, input.providerId, recorder?.attribution ?? { threadId: `utility_${input.purpose}`, turnId: randomUUID() })
      modelRequest.beforeProviderDispatch = () => runtime.modelConnections!.assertActiveConfiguration(snapshot.revision)
      modelRequest.requestId = modelRequest.turnId
      modelRequest.deadlineAt = Date.now() + input.timeoutMs
      if (input.fim && connection?.baseUrl && new URL(connection.baseUrl).hostname === 'api.deepseek.com' &&
          connection.endpointFormat === 'chat_completions') modelRequest.fim = input.fim
      let text = '', completed = false
      iterator = runtime.modelClient.stream(modelRequest)[Symbol.asyncIterator]()
      for (;;) {
        const next = await nextGatewayChunk(iterator, signal)
        if (next.done) break
        const chunk = next.value
        recorder?.observe(chunk)
        if (chunk.kind === 'assistant_text_delta') {
          text += chunk.text
          if (text.length > 1024 * 1024) throw new Error('Model response exceeded its size limit')
        }
        if (chunk.kind === 'tool_call_delta' || chunk.kind === 'tool_call_complete') throw new Error('A text-only model request returned a tool call')
        if (chunk.kind === 'error') {
          await recorder?.finish('failed')
          const status = chunk.failure?.httpStatus
          return jsonResponse({ ok: false, message: status === 404
            ? 'Provider returned HTTP 404. Check Base URL and endpoint format in provider settings.'
            : `Provider model request failed${status ? ` (HTTP ${status})` : ''}. Check the connection and model settings.` })
        }
        if (chunk.kind === 'completed') { completed = chunk.stopReason !== 'error'; break }
      }
      if (!completed) throw new Error('The provider response ended before completion')
      await recorder?.finish('completed')
      if (input.purpose === 'provider-test' && connection) await recordProviderInferenceEvidence(runtime.modelConnections, connection.id, input.model, snapshot.revision).catch(() => undefined)
      return jsonResponse({ ok: true, text })
    } catch {
      await recorder?.finish(signal.aborted ? 'cancelled' : 'failed').catch(() => undefined)
      return jsonResponse({ ok: false, message: signal.aborted ? 'Model request cancelled or timed out.' : 'The model request could not be completed.' })
    } finally { void iterator?.return?.().catch(() => undefined) }
  })
}
