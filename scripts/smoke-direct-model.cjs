'use strict'
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { readFile } = require('node:fs/promises')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { homedir } = require('node:os')

// A loopback model-only fixture. It never creates Rooms/Agents/requests.
// Real mode forwards isolated prompts using the existing configured DeepSeek account.
async function startDirectModel({ real = false } = {}) {
  let credential, upstream, realModel
  if (real) {
    const dataDir = join(homedir(), '.kun/data')
    const registry = JSON.parse(await readFile(join(dataDir, 'model-connections.v1.json'), 'utf8'))
    const provider = registry.profiles.deepseek
    assert(provider?.kind === 'http' && provider.endpointFormat === 'chat_completions' && provider.credentialRef)
    const root = resolve(__dirname, '../kun/dist')
    const { createSecretEncryptor, defaultSecretCommandRunner } = await import(pathToFileURL(join(root, 'security/secret-store.js')))
    const { ExtensionCredentialStore } = await import(pathToFileURL(join(root, 'services/extension-credential-store.js')))
    const keyProvider = await createSecretEncryptor({ keyFilePath: join(dataDir, 'secret.key'), run: defaultSecretCommandRunner, canBootstrapKeyFileFallback: () => false })
    const store = new ExtensionCredentialStore({ dataDir, profileId: 'default', keyProvider })
    credential = (await store.get(provider.credentialRef))?.apiKey
    assert(credential, 'Configured model credential is unavailable')
    upstream = provider.baseUrl.replace(/\/$/, '') + '/chat/completions'
    realModel = registry.defaultProviderId === 'deepseek' ? registry.defaultModel : provider.selectedModel
    assert(provider.models.includes(realModel))
  }
  const stats = { real, model: realModel ?? 'deepseek-chat', calls: 0, mainCalls: 0, backgroundCalls: 0, byPrompt: {}, models: {}, blocked: 0 }
  let held = false, releaseHold = () => {}, lastPrompt = 'background'
  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: realModel ?? 'deepseek-chat' }, { id: 'deepseek-reasoner' }] })); return }
      const chunks = []; for await (const chunk of request) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString())
      const messages = body.messages ?? []
      const user = [...messages].reverse().find((item) => item.role === 'user' && JSON.stringify(item.content).includes('User message:'))
      const prompt = user ? JSON.stringify(user.content).split('User message:').at(-1).slice(0, 500) : undefined
      if (prompt) lastPrompt = prompt
      const count = (stats.byPrompt[lastPrompt] ?? 0) + 1
      stats.byPrompt[lastPrompt] = count; stats.calls++; stats.models[body.model] = (stats.models[body.model] ?? 0) + 1
      if (prompt) stats.mainCalls++; else stats.backgroundCalls++
      if (real && (count > 10 || stats.calls > 80)) { stats.blocked++; response.writeHead(429); response.end('{"error":{"message":"Acceptance model-call budget reached"}}'); return }
      if (real) {
        const abort = new AbortController()
        response.on('close', () => abort.abort())
        const result = await fetch(upstream, { method: 'POST', signal: abort.signal, headers: { Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, model: realModel, max_tokens: Math.min(body.max_tokens ?? 2048, 2048), thinking: { type: 'disabled' }, reasoning_effort: undefined }) })
        response.writeHead(result.status, { 'Content-Type': result.headers.get('content-type') ?? 'application/json' })
        for await (const chunk of result.body) response.write(chunk)
        response.end(); return
      }
      if (prompt?.includes('HOLD_RESPONSE') && !held) { held = true; await new Promise((resolve) => { releaseHold = resolve }); held = false }
      const memory = JSON.stringify(messages).includes('agent_memory_capture')
      const last = messages.at(-1)
      let content = memory ? '{"candidates":[]}' : prompt ? '你好！我可以帮你处理问题和文件。' : 'Private chat'
      let tool
      if (prompt && last?.role !== 'tool' && !memory) {
        const command = prompt.includes('PROJECT_FILE') ? { path: 'project-result.txt', content: 'project verified\n' } :
          prompt.includes('UPDATE_FILE') ? { path: 'hello.txt', content: 'updated by Kun\n' } :
          prompt.includes('CREATE_FILE') ? { path: 'hello.txt', content: 'hello from Kun\n' } : undefined
        if (command) tool = { id: 'call_' + stats.calls, type: 'function', function: { name: 'write', arguments: JSON.stringify(command) } }
      }
      if (last?.role === 'tool') content = '文件已完成，并保存在当前工作目录。'
      if (body.stream === false) {
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content, ...(tool ? { tool_calls: [tool] } : {}) }, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 10 } })); return
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const send = (delta, finish_reason = null) => response.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] }) + '\n\n')
      if (tool) send({ tool_calls: [{ index: 0, ...tool }] })
      else { send({ content: content.slice(0, 5) }); await new Promise((resolve) => setTimeout(resolve, 90)); send({ content: content.slice(5) }) }
      send({}, tool ? 'tool_calls' : 'stop')
      response.write('data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 } }) + '\n\n')
      response.end('data: [DONE]\n\n')
    } catch (error) {
      if (!response.destroyed) { response.writeHead(500); response.end(JSON.stringify({ error: { message: real ? 'Real model request failed' : String(error) } })) }
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { baseUrl: 'http://127.0.0.1:' + server.address().port, snapshot: () => stats, holding: () => held, release: () => releaseHold(),
    close: () => { releaseHold(); server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)) } }
}
module.exports = { startDirectModel }
