'use strict'

const { createServer } = require('node:http')
const { roomsHarnessModelResponse } = require('./smoke-rooms-harness-fixture.cjs')

/** Offline responses still exercise the real loop, tool admission, and worker host. */
async function startModelFixture(model, options = {}) {
  const counters = { requests: 0, workerCreates: 0, workerWrites: 0, workerMessages: 0 }
  const observations = []
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && /\/models(?:\?|$)/u.test(request.url ?? '')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ object: 'list', data: [{ id: model, object: 'model' }] }))
      return
    }
    if (request.method !== 'POST' || !/\/chat\/completions$/u.test(request.url ?? '')) {
      response.writeHead(404); response.end(); return
    }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    counters.requests += 1
    const messages = body.messages ?? []
    const text = messages.filter((entry) => entry.role === 'user')
      .map((entry) => typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content ?? '')).join('\n')
    const supports = (name) => (body.tools ?? []).some((tool) => tool.function?.name === name)
    const completed = (id) => messages.some((entry) => entry.tool_call_id === id)
    observations.push({ model: body.model,
      tools: (body.tools ?? []).map((tool) => tool.function?.name).filter(Boolean),
      createMarker: text.includes('[ade-smoke-create-worker]'),
      workerMarker: text.includes('[ade-smoke-worker-file]'),
      followupMarker: text.includes('[ade-smoke-worker-message]') })
    let message = { role: 'assistant', content: 'Done.' }
    const call = (id, name, args) => ({ role: 'assistant', content: null,
      tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
    const rooms = options.workspaceRoot ? roomsHarnessModelResponse({ text, messages, supports, completed, call, workspaceRoot: options.workspaceRoot }) : null
    if (rooms) message = rooms
    else if (text.includes('[ade-smoke-create-worker]') && supports('worker_create') && !completed('smoke-worker-create')) {
      counters.workerCreates += 1
      message = call('smoke-worker-create', 'worker_create', {
        label: 'Smoke worker',
        task: '[ade-smoke-worker-file] Create smoke-worker.txt with the text "Worker smoke ready" and finish.',
        agent: { harnessId: 'kun', providerId: 'deepseek', model: body.model, credentialMode: 'provider' },
        workspace: { isolation: 'worktree', startFrom: { kind: 'current-head' } },
        lifecycle: 'persistent'
      })
    } else if (text.includes('[ade-smoke-worker-file]') && !supports('worker_create') && supports('write') && !completed('smoke-worker-write')) {
      counters.workerWrites += 1
      message = call('smoke-worker-write', 'write', { path: 'smoke-worker.txt', content: 'Worker smoke ready\n' })
    } else if (text.includes('[ade-smoke-worker-message]')) {
      counters.workerMessages += 1
      message.content = 'Worker follow-up received.'
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ id: 'ade-smoke', object: 'chat.completion', created: 1,
      model: body.model ?? model, choices: [{ index: 0, message,
        finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
  return { baseUrl, snapshot: () => ({ kind: 'offline-tool-fixture', baseUrl, ...counters, observations }),
    close: () => new Promise((resolve) => server.close(resolve)) }
}

module.exports = { startModelFixture }
