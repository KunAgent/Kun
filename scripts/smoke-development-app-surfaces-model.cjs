'use strict'

const { createServer } = require('node:http')

const WIDGET_HTML = `<div id="amp-explorer" class="stack">
  <label class="form-label" for="amp">Amplitude <output id="amp-value">2</output></label>
  <input id="amp" class="form-range" type="range" min="1" max="5" step="1" value="2">
  <svg id="amp-wave" viewBox="0 0 320 120" width="320" height="120" aria-label="Sine wave"></svg>
  <div class="row">
    <button id="amp-save" class="btn">Save choice</button>
    <button id="amp-ask" class="btn btn-primary">Explain this amplitude</button>
  </div>
  <p id="amp-status" class="text-muted text-small" role="status"></p>
</div>
<script src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"></script>
<script>
  const root = document.getElementById('amp-explorer')
  const input = document.getElementById('amp')
  const wave = document.getElementById('amp-wave')
  const output = document.getElementById('amp-value')
  function draw() {
    const amp = Number(input.value)
    output.textContent = String(amp)
    let d = ''
    for (let x = 0; x <= 320; x += 4) d += (x ? 'L' : 'M') + x + ' ' + (60 - Math.sin(x / 25) * amp * 10).toFixed(1)
    wave.innerHTML = '<path d="' + d + '" fill="none" stroke="var(--viz-series-1)" stroke-width="2"></path>'
  }
  const saved = window.kun.widgetState && window.kun.widgetState.modelContent
  if (saved && typeof saved.amplitude === 'number') input.value = String(saved.amplitude)
  input.addEventListener('input', draw)
  document.getElementById('amp-save').addEventListener('click', () => {
    window.kun.setWidgetState({ modelContent: { amplitude: Number(input.value) }, privateContent: null })
      .then(() => { document.getElementById('amp-status').textContent = 'saved' })
  })
  document.getElementById('amp-ask').addEventListener('click', () => {
    window.kun.sendFollowUpMessage({ prompt: '[gen-ui-followup] Explain amplitude ' + input.value, title: 'Amplitude' })
      .then(() => { document.getElementById('amp-status').textContent = 'sent' })
      .catch(() => { document.getElementById('amp-status').textContent = 'not sent' })
  })
  draw()
  root.dataset.d3 = window.d3 ? window.d3.version : 'missing'
  root.dataset.ready = 'true'
</script>`

/** Offline OpenAI-compatible model that drives Gen UI and canvas MCP App tools. */
async function startAppSurfacesModelFixture(model) {
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
    const turnKey = (text.match(/\[(gen-ui-smoke|canvas-smoke|canvas-edit-smoke)-(\d+)\]/u) ?? [])
    if (turnKey[1] === 'gen-ui-smoke' && tools.includes('render_widget') && !toolResult(`gen-ui-${turnKey[2]}`)) {
      message = call(`gen-ui-${turnKey[2]}`, 'render_widget', { title: 'Amplitude explorer', html: WIDGET_HTML })
    } else if (turnKey[1] === 'canvas-smoke' && tools.includes('mcp_kun_canvas_canvas_create') && !toolResult(`canvas-${turnKey[2]}`)) {
      message = call(`canvas-${turnKey[2]}`, 'mcp_kun_canvas_canvas_create', {
        title: 'API cache database',
        elements: [
          { id: 'api', type: 'rectangle', x: 0, y: 0, width: 160, height: 70, label: { text: 'API' } },
          { id: 'cache', type: 'rectangle', x: 260, y: 0, width: 160, height: 70, label: { text: 'Cache' }, backgroundColor: '#ffec99' },
          { id: 'db', type: 'ellipse', x: 520, y: 0, width: 160, height: 70, label: { text: 'Database' } },
          { id: 'api-cache', type: 'arrow', x: 160, y: 35, width: 100, height: 0, start: { id: 'api' }, end: { id: 'cache' } },
          { id: 'cache-db', type: 'arrow', x: 420, y: 35, width: 100, height: 0, start: { id: 'cache' }, end: { id: 'db' } }
        ]
      })
    } else if (turnKey[1] === 'canvas-edit-smoke') {
      const boardId = (text.match(/\b(cb_[a-z0-9]{12})\b/u) ?? [])[1]
      const read = toolResult(`canvas-read-${turnKey[2]}`)
      if (boardId && !read && tools.includes('mcp_kun_canvas_canvas_read')) {
        message = call(`canvas-read-${turnKey[2]}`, 'mcp_kun_canvas_canvas_read', { boardId })
      } else if (boardId && read && !toolResult(`canvas-apply-${turnKey[2]}`)) {
        const revision = Number((String(read.content).match(/\\?"revision\\?":(\d+)/u) ?? [])[1])
        message = call(`canvas-apply-${turnKey[2]}`, 'mcp_kun_canvas_canvas_apply', {
          boardId,
          expectedRevision: revision,
          operationId: `smoke-edit-${turnKey[2]}`,
          operations: [
            { op: 'update', id: 'cache', props: { label: { text: 'Cache x2' }, backgroundColor: '#b2f2bb' } },
            { op: 'add', element: { id: 'cache-2', type: 'rectangle', x: 260, y: 120, width: 160, height: 70, label: { text: 'Cache replica' } } }
          ]
        })
      }
    }
    observations.push({ tools: tools.filter((name) => /render_widget|kun_canvas/u.test(name)), marker: turnKey[0] ?? null,
      response: (message.tool_calls ?? []).map((entry) => entry.function.name) })
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ id: 'app-surfaces-smoke', object: 'chat.completion', created: 1,
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

module.exports = { startAppSurfacesModelFixture }
