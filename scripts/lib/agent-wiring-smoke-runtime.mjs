import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

// In-process gateway for the agent wiring smoke: real gateway handlers,
// route pool, middleware and trace store over a deterministic fake upstream.
export const MARKER = 'KUN_GATEWAY_OFFLINE_OK'
export const MIDDLEWARE_MARK = 'KUN_MIDDLEWARE_MARK'
export const FIXTURE_TOKEN = 'kun_local_offline_fixture_only'
export const UPSTREAM_SIGNATURE = 'upstream-thinking-signature-1'

/** Bundles current TypeScript sources so the smoke never tests stale dist. */
export async function loadWiringModules(root, temp) {
  const imports = [
    ['Router', 'server/router.ts'],
    ['startNodeHttpServer', 'server/node-http-server.ts'],
    ['gatewayChatCompletions, gatewayResponses, gatewayModels', 'server/routes/openai-model-gateway.ts'],
    ['gatewayMessages, gatewayCountTokens', 'server/routes/anthropic-messages-gateway.ts'],
    ['geminiGenerate, geminiModels', 'server/routes/gemini-gateway.ts'],
    ['gatewayHello, gatewayRouteTrace', 'server/routes/gateway-discovery-routes.ts'],
    ['gatewayRouteTraceStore', 'server/routes/gateway-route-trace.ts'],
    ['GatewayMiddlewareHost', 'server/routes/gateway-middleware.ts'],
    ['RoutePoolModelClient', 'adapters/model/route-pool-model-client.ts'],
    ['AgentWiringService, createWiringContext', 'agent-wiring/service.ts']
  ].map(([names, path]) => `export { ${names} } from ${JSON.stringify(join(root, 'kun/src', path))}`).join('\n')
  const output = join(temp, 'wiring-bundle.mjs')
  await build({ stdin: { contents: imports, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', target: 'node22',
    format: 'esm', outfile: output, logLevel: 'silent', external: ['electron'],
    // CommonJS dependencies (yaml, diff) call require() for Node built-ins.
    banner: { js: "import { createRequire as __kunCreateRequire } from 'node:module'; const require = __kunCreateRequire(import.meta.url);" } })
  return import(pathToFileURL(output).href)
}

export const CATALOG = [
  { id: 'local-model', displayName: 'Offline fixture', contextWindow: 200_000, maxOutputTokens: 32_000, reasoningLevels: ['low', 'medium', 'high'], reasoning: true, images: false },
  { id: 'local-small', displayName: 'Offline small', contextWindow: 128_000, maxOutputTokens: 8_000 }
]

function pools(agentId) {
  const base = { enabled: true, strategy: 'priority',
    failurePolicy: { failoverHttpStatusCodes: [429, 503], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: false },
    healthPolicy: { failureThreshold: 3, cooldownMs: 1000, halfOpenMaxAttempts: 1 } }
  const targets = [{ id: 't-default', providerId: 'offline', modelId: 'offline', enabled: true, weight: 1 },
    { id: 't-rule', providerId: 'offline-rule', modelId: 'offline', enabled: true, weight: 1 }]
  // The rule sends this agent's turns to the second member, proving attribution reached routing.
  const rules = [{ id: 'by-agent', enabled: true, use: 't-rule', when: { agents: [agentId] } }]
  return [{ ...base, id: 'offline', name: 'Offline fixture', modelId: 'local-model', targets, rules },
    { ...base, id: 'small', name: 'Offline small', modelId: 'local-small', targets, rules }]
}

const caps = () => ({ id: 'offline', inputModalities: ['text', 'image'], outputModalities: ['text'], messageParts: ['text'],
  supportsToolCalling: true, parallelTools: true, structuredOutput: true,
  reasoning: { supportedEfforts: ['off', 'auto', 'low', 'medium', 'high', 'max', 'xhigh'] },
  contextWindowTokens: 200_000, maxOutputTokens: 32_000 })

function readTool(request, workspace) {
  const path = join(workspace, 'fixture.txt')
  const names = ['Read', 'read', 'read_file', 'view', 'ReadFile', 'exec_command', 'shell_command', 'shell', 'Bash', 'bash']
  for (const name of names) {
    const tool = request.tools.find((candidate) => candidate.name === name || candidate.name.endsWith(`.${name}`))
    if (!tool) continue
    // Fill whichever path or command field the agent's own schema declares.
    const properties = Object.keys(tool.inputSchema?.properties ?? {})
    const args = {}
    for (const field of ['file_path', 'filePath', 'filepath', 'absolute_path', 'path']) {
      if (properties.includes(field)) { args[field] = field === 'path' && name === 'read' ? 'fixture.txt' : path; break }
    }
    for (const field of ['cmd', 'command']) if (properties.includes(field)) args[field] = 'cat fixture.txt'
    if (properties.includes('workdir')) args.workdir = workspace
    if (!Object.keys(args).length) args.path = path
    return { name: tool.name, args }
  }
  return null
}

/** A fake runtime whose upstream records what each call looked like. */
export function wiringRuntime(gateway, { agentId, state, workspace, middlewareDir, calls }) {
  const upstream = {
    provider: 'offline', model: 'offline',
    async *stream(request) {
      const call = { providerId: request.providerId, model: request.model, effort: request.reasoningEffort,
        systemHasMark: (request.systemPrompt ?? '').includes(MIDDLEWARE_MARK), toolCount: request.tools.length,
        historyKinds: request.history.map((item) => item.kind),
        replayedReasoning: request.history.some((item) => item.kind === 'assistant_reasoning'),
        restoredSignature: request.history.some((item) => item.kind === 'tool_call' &&
          item.providerMetadata?.anthropic?.thinkingBlocks?.some((block) => block.signature === UPSTREAM_SIGNATURE)),
        fixtureRead: request.history.some((item) => item.kind === 'tool_result' && JSON.stringify(item.output).includes('Offline fixture read successfully')) }
      calls.push(call)
      if (request.threadId?.startsWith('route-classifier:')) { yield { kind: 'completed', stopReason: 'stop' }; return }
      if (state.scenario === 'tools' && request.tools.length && !request.history.some((item) => item.kind === 'tool_result')) {
        const tool = readTool(request, workspace)
        if (tool) {
          call.fixtureTool = tool.name
          yield { kind: 'assistant_reasoning_delta', text: 'Plan: read the fixture.' }
          yield { kind: 'tool_call_complete', callId: 'offline-read-fixture', toolName: tool.name, arguments: tool.args,
            providerMetadata: { anthropic: { thinkingBlocks: [{ type: 'thinking', thinking: 'Plan: read the fixture.', signature: UPSTREAM_SIGNATURE }] } } }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
      }
      yield { kind: 'assistant_text_delta', text: MARKER }
      yield { kind: 'usage', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, cachedTokens: 0, cacheHitTokens: 0, cacheMissTokens: 10, cacheHitRate: 0, turns: 1 } }
      yield { kind: 'completed', stopReason: 'stop' }
    }
  }
  const routed = new gateway.RoutePoolModelClient(upstream, pools(agentId), caps)
  const runtime = {
    runtimeToken: 'offline_control_only', insecure: false,
    modelClient: routed,
    modelConnections: { snapshot: async () => ({ revision: 1, providers: ['offline', 'offline-rule'].map((id) => ({ id, name: id, kind: 'http',
      authType: 'api-key', configured: true, credentialStatus: 'ready', endpointFormat: 'chat_completions', models: ['offline'] })), failover: [] }) },
    modelGateway: {
      enabled: () => true, exposeProviderModels: () => false,
      pools: () => routed.routePools(), configuredPools: () => routed.configuredPools(),
      credentials: { verify: (value) => value === FIXTURE_TOKEN },
      modelCapabilities: caps,
      middleware: new gateway.GatewayMiddlewareHost(middlewareDir, () => [
        { id: 'mark', enabled: true, type: 'system-prompt', text: MIDDLEWARE_MARK, position: 'append' }])
    }
  }
  return runtime
}

/** Starts the gateway on an ephemeral loopback port; returns its origin and a request log. */
export async function startWiringGateway(gateway, runtime) {
  const router = new gateway.Router()
  const requests = []
  const routes = [
    ['GET', '/api/hello', gateway.gatewayHello], ['GET', '/v1/models', gateway.gatewayModels],
    ['POST', '/v1/chat/completions', gateway.gatewayChatCompletions], ['POST', '/v1/responses', gateway.gatewayResponses],
    ['POST', '/v1/messages', gateway.gatewayMessages], ['POST', '/v1/messages/count_tokens', gateway.gatewayCountTokens],
    ['GET', '/v1beta/models', gateway.geminiModels], ['GET', '/v1/kun/route', gateway.gatewayRouteTrace]
  ]
  for (const [method, path, handler] of routes) {
    router.add(method, path, async (request) => {
      const record = { method, path }
      requests.push(record)
      if (method === 'POST') await captureRequest(path, request)
      const response = await handler(runtime, request)
      record.status = response.status
      if (response.status >= 400) record.error = String(response instanceof Response ? await response.clone().text() : response.body).slice(0, 400)
      // Streams report failures inside a 200 body; keep the first error event for the report.
      else if (response instanceof Response) void response.clone().text().then((text) => {
        const index = text.indexOf('"error"')
        if (index >= 0) record.error = text.slice(Math.max(0, index - 20), index + 380)
      }).catch(() => undefined)
      return response
    })
  }
  router.add('POST', '/v1beta/models/*call', async (request, ctx) => {
    const record = { method: 'POST', path: `/v1beta/models/${ctx.params.call}` }
    requests.push(record)
    await captureRequest(record.path, request)
    const response = await gateway.geminiGenerate(runtime, request, ctx.params.call)
    record.status = response.status
    return response
  })
  const server = await gateway.startNodeHttpServer({ router, host: '127.0.0.1', port: 0 })
  return { origin: `http://127.0.0.1:${server.port}`, requests, close: () => server.close() }
}

/**
 * `KUN_WIRING_CAPTURE=<file>` appends each request's headers and the body
 * fields that could name a session, one JSON line per request, so session
 * attribution can follow what agents really send. Keys are redacted.
 */
async function captureRequest(path, request) {
  const file = process.env.KUN_WIRING_CAPTURE
  if (!file) return
  const secret = /^(authorization|x-api-key|x-goog-api-key|api-key)$/i
  const headers = Object.fromEntries([...request.headers].map(([name, value]) => [name, secret.test(name) ? '<redacted>' : value.slice(0, 200)]))
  let body = {}
  try { body = await request.clone().json() } catch { /* not JSON */ }
  const fields = {}
  const visit = (value, at, depth) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 2) return
    for (const [key, item] of Object.entries(value)) {
      const name = at ? `${at}.${key}` : key
      if (/session|user|metadata|cache|conversation|thread|prompt_id|request_id/i.test(key) && (typeof item !== 'object' || item === null)) fields[name] = String(item).slice(0, 300)
      else visit(item, name, depth + 1)
    }
  }
  visit(body, '', 0)
  const { appendFileSync } = await import('node:fs')
  appendFileSync(file, JSON.stringify({ path, headers, bodyKeys: Object.keys(body), fields }) + '\n')
}

/** Route traces filed under a caller's session: grows when an agent's own session id reached the gateway. */
export function sessionTraceCount(gateway, runtime) {
  return gateway.gatewayRouteTraceStore(runtime.modelGateway).sessions.size
}

export function lastTrace(gateway, runtime) {
  return gateway.gatewayRouteTraceStore(runtime.modelGateway).recent().traces.at(-1) ?? null
}

export const resolveRoot = (here) => resolve(here, '..')
