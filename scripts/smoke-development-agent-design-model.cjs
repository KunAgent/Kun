'use strict'

const { createServer } = require('node:http')

const DESIGN_TITLE = 'Footer update entry'
const SCREENS = [
  { name: 'Sidebar footer', html: '<!doctype html><html><body style="margin:0;font:14px system-ui"><footer style="display:flex;align-items:center;gap:12px;padding:16px"><span>XingYu</span><button style="margin-left:auto;border-radius:999px;padding:6px 12px">Update ready</button></footer></body></html>' },
  { name: 'Update ready pill', html: '<div style="display:inline-flex;padding:8px 14px;border-radius:999px;background:#7c5cff;color:#fff;font:600 13px system-ui">Update ready</div>' }
]

/**
 * Offline OpenAI-compatible model for the Code-agent Design smoke. A Code turn
 * marked [agent-design-smoke] writes two screens with design_open in the same
 * turn, then finishes with a short summary.
 */
async function startAgentDesignModelFixture(model) {
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
    const lastUser = [...messages].reverse().find((entry) => entry.role === 'user')
    const text = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content ?? '')
    const tools = (body.tools ?? []).map((tool) => tool.function?.name).filter(Boolean)
    const toolResult = (id) => messages.find((entry) => entry.role === 'tool' && entry.tool_call_id === id)
    const call = (id, name, args) => ({ role: 'assistant', content: null,
      tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
    let message = { role: 'assistant', content: 'Done.' }
    let lane = 'other'
    if (text.includes('[agent-design-smoke]')) {
      lane = 'code'
      if (tools.includes('design_open') && !toolResult('design-open-1')) {
        message = call('design-open-1', 'design_open', { title: DESIGN_TITLE, target: 'web', screens: SCREENS })
      } else {
        message = { role: 'assistant', content: 'The footer update entry is on the design canvas.' }
      }
    } else if (text.includes('Design request from the coding agent')) {
      lane = 'design-pass'
    }
    observations.push({
      lane,
      toolCount: tools.length,
      designTools: tools.filter((name) => name.startsWith('design_')),
      userText: text.slice(0, 160),
      designOpenAdvertised: tools.includes('design_open'),
      canvasToolsAdvertised: tools.includes('design_canvas'),
      response: (message.tool_calls ?? []).map((entry) => entry.function.name)
    })
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ id: 'agent-design-smoke', object: 'chat.completion', created: 1,
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

module.exports = { startAgentDesignModelFixture, DESIGN_TITLE, SCREENS }
