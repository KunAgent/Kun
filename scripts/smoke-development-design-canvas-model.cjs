'use strict'

const { createServer } = require('node:http')

const SECTION_TITLE = 'One tray: progress lives behind the composer'
const SCREENS = [
  { name: 'Tray collapsed', accent: '#2f6fed', rows: ['Wire token refresh into auth-store', 'Add login form validation', 'Unit tests for auth-store'] },
  { name: 'Task list open', accent: '#16a34a', rows: ['Done: token refresh', 'Doing: login form validation', 'Next: auth-store tests'] },
  { name: 'Workers open', accent: '#7c3aed', rows: ['Tester is running auth specs', 'Writer drafts the changelog', '2 workers active'] },
  { name: 'Approval inline', accent: '#ea580c', rows: ['Allow write to src/main/session-store.ts?', 'Allow once', 'Always allow in this task'] }
]

function screenHtml(screen) {
  const rows = screen.rows.map((row, index) => `
      <li class="row${index === 1 ? ' current' : ''}"><span class="dot"></span><span>${row}</span><em>${index === 1 ? 'in progress' : index === 0 ? 'done' : 'queued'}</em></li>`).join('')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${screen.name}</title>
<style>
  :root { --accent: ${screen.accent}; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1f2329; background: #fafaf9; }
  main { padding: 40px 48px; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  p.lead { margin: 0 0 24px; color: #6b7280; }
  .card { border: 1px solid #e5e7eb; border-radius: 14px; background: #fff; padding: 8px; box-shadow: 0 8px 24px rgba(15,23,42,.06); }
  ul { list-style: none; margin: 0; padding: 0; }
  .row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 10px; }
  .row.current { background: #f3f4f6; font-weight: 600; }
  .row em { margin-left: auto; font-style: normal; font-size: 12px; color: #9ca3af; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); }
  .composer { margin-top: 20px; border: 1px solid #e5e7eb; border-radius: 16px; background: #fff; padding: 16px 18px; display: flex; align-items: center; gap: 12px; color: #9ca3af; }
  .send { margin-left: auto; width: 32px; height: 32px; border-radius: 50%; background: #111827; }
</style>
</head>
<body>
<main>
  <h1>${screen.name}</h1>
  <p class="lead">Token refresh moved into auth-store; now adding login form validation.</p>
  <section class="card"><ul>${rows}
  </ul></section>
  <div class="composer">Keep typing to queue the next change...<span class="send"></span></div>
</main>
</body>
</html>
`
}

/**
 * Offline OpenAI-compatible model for the Design canvas chrome smoke. A Code
 * turn marked [design-canvas-smoke] writes four screens with design_open in the
 * same turn.
 */
async function startDesignCanvasModelFixture(model) {
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
    if (text.includes('[design-canvas-smoke]')) {
      lane = 'code'
      if (tools.includes('design_open') && !toolResult('design-open-1')) {
        message = call('design-open-1', 'design_open', {
          title: 'Composer tray redesign',
          target: 'web',
          note: SECTION_TITLE,
          screens: SCREENS.map((screen) => ({ name: screen.name, html: screenHtml(screen), width: 960, height: 640 }))
        })
      } else {
        message = { role: 'assistant', content: 'The four tray states are on the design canvas.' }
      }
    }
    observations.push({
      lane,
      toolCount: tools.length,
      userText: text.slice(0, 160),
      response: (message.tool_calls ?? []).map((entry) => entry.function.name)
    })
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ id: 'design-canvas-smoke', object: 'chat.completion', created: 1,
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

module.exports = { startDesignCanvasModelFixture, SCREENS, SECTION_TITLE }
