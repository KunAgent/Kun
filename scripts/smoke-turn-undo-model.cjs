'use strict'

const { createServer } = require('node:http')

/**
 * Offline OpenAI-compatible model for the per-turn undo smoke. Each marked
 * prompt replays a fixed list of tool calls, one per request, then answers.
 *   [undo-smoke-1]  read + edit src/app.ts, write docs/notes.md, run a shell command
 *   [undo-smoke-2]  read + edit src/util.ts
 *   anything else   answer without tools
 * Kun's edit tool requires a read of the file first.
 */
const SCRIPTS = {
  'undo-smoke-1': [
    ['read', { path: 'src/app.ts' }],
    ['edit', { path: 'src/app.ts', oldText: 'export const greeting = "hello"', newText: 'export const greeting = "hello from Kun"' }],
    ['write', { path: 'docs/notes.md', content: '# Notes\n\nWritten by the agent.\n' }],
    ['bash', { command: 'echo generated > generated.txt' }]
  ],
  'undo-smoke-2': [
    ['read', { path: 'src/util.ts' }],
    ['edit', { path: 'src/util.ts', oldText: 'return a + b', newText: 'return Number(a) + Number(b)' }]
  ]
}

async function startTurnUndoModelFixture(model) {
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
    const messages = body.messages ?? []
    const lastUserIndex = messages.map((entry) => entry.role).lastIndexOf('user')
    const lastUser = messages[lastUserIndex]
    const text = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content ?? '')
    const marker = (text.match(/\[(undo-smoke-\d+)\]/u) ?? [])[1]
    const script = SCRIPTS[marker] ?? []
    // Tool results since the latest user message tell which step comes next.
    const done = messages.slice(lastUserIndex + 1).filter((entry) => entry.role === 'tool').length
    let message = { role: 'assistant', content: 'Done.' }
    if (done < script.length) {
      const [name, args] = script[done]
      message = {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: `${marker}-${done}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }]
      }
    }
    observations.push({ marker: marker ?? null, step: done, tool: message.tool_calls?.[0]?.function.name ?? null })
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ id: 'turn-undo-smoke', object: 'chat.completion', created: 1,
      model: body.model ?? model, choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
  return { baseUrl, snapshot: () => ({ baseUrl, observations }), close: () => new Promise((resolve) => server.close(resolve)) }
}

module.exports = { startTurnUndoModelFixture }
