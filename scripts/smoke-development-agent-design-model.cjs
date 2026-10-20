'use strict'

const { createServer } = require('node:http')

const DESIGN_BRIEF = 'Move the update button from the top bar into the sidebar footer, next to the account row. Show a compact "Update ready" pill.'

/**
 * Offline OpenAI-compatible model for the Code-agent Design smoke. A Code turn
 * marked [agent-design-smoke] calls design_open; the Design pass that the
 * workbench starts afterwards draws on the board with design_canvas.
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
    if (text.includes('Design request from the coding agent')) {
      lane = 'design-pass'
      if (tools.includes('design_canvas') && !toolResult('design-draw-1')) {
        message = call('design-draw-1', 'design_canvas', {
          action: 'update_shapes',
          ops: [
            { op: 'add', shape: { type: 'rect', name: 'Sidebar footer', x: 0, y: 0, width: 320, height: 96,
              cornerRadius: 12, fills: [{ type: 'solid', color: '#F4F4F5', opacity: 1 }] } },
            { op: 'add', shape: { type: 'rect', name: 'Update ready pill', x: 176, y: 30, width: 120, height: 36,
              cornerRadius: 18, fills: [{ type: 'solid', color: '#7C5CFF', opacity: 1 }] } }
          ]
        })
      } else {
        message = { role: 'assistant', content: 'Drafted the sidebar footer update entry on the canvas.' }
      }
    } else if (text.includes('[agent-design-smoke]')) {
      lane = 'code'
      if (tools.includes('design_open') && !toolResult('design-open-1')) {
        message = call('design-open-1', 'design_open', {
          title: 'Footer update entry',
          brief: DESIGN_BRIEF,
          target: 'web'
        })
      } else {
        message = { role: 'assistant', content: 'I queued a design pass for the footer update entry.' }
      }
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

module.exports = { startAgentDesignModelFixture, DESIGN_BRIEF }
