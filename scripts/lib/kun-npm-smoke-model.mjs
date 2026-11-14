import { createServer } from 'node:http'

export const FIXTURE_REPLY = 'kun-npm-fixture-ok'

function scriptedTool(body, options) {
  const messages = body.messages ?? []
  const prompt = JSON.stringify(messages.filter(message => message.role === 'user').map(message => message.content))
  if (prompt.includes('KUN_ARTIFACT_CHILD_ONLY')) return undefined
  const count = messages.filter(message => message.role === 'tool').length
  const names = (body.tools ?? []).map(tool => tool.function?.name)
  let script
  if (prompt.includes('KUN_ARTIFACT_VERIFY_LIFECYCLE') && options.lifecycleCommand) {
    script = [[names.find(name => name?.includes('fixture_echo')), { value: 'lifecycle' }],
      ['bash', { command: options.lifecycleCommand }]]
  }
  if (prompt.includes('KUN_ARTIFACT_VERIFY_GOAL')) script = [
    ['create_goal', { objective: 'Record one fixture planning task' }],
    ['task_create', { clientRequestId: 'artifact-task', title: 'Fixture task record' }],
    ['update_goal', { status: 'complete' }]
  ]
  if (prompt.includes('KUN_ARTIFACT_VERIFY_PLAN')) script = [['create_plan', {
    title: 'Artifact fixture', markdown: '# Artifact fixture\n\n## Goal\nVerify standalone plan storage.\n\n## Steps\n1. Read the fixture.\n2. Verify the result.\n\n## Validation\nRun the local fixture check.\n'
  }]]
  if (prompt.includes('KUN_ARTIFACT_VERIFY_INPUT')) script = [[names.includes('request_user_input') ? 'request_user_input' : 'user_input', {
    questions: [{ id: 'choice', header: 'Fixture', question: 'Choose A or B for this fixture.', options: [
      { label: 'A', description: 'First fixture choice', recommended: true },
      { label: 'B', description: 'Second fixture choice', recommended: false }
    ] }]
  }]]
  if (prompt.includes('KUN_ARTIFACT_VERIFY_APPROVAL_')) {
    const decision = prompt.includes('APPROVAL_allow') ? 'allow' : 'deny'
    script = [['write', { path: `approval-${decision}.txt`, content: 'approved fixture write' }]]
  }
  if (prompt.includes('KUN_ARTIFACT_VERIFY_CHILD')) script = [['delegate_task', {
    label: 'Artifact fixture child', prompt: 'KUN_ARTIFACT_CHILD_ONLY: Return the fixture marker without using tools.'
  }]]
  if (prompt.includes('KUN_ARTIFACT_VERIFY_EXTENSION')) {
    const alias = names.find(name => name?.startsWith('ext_') && name.endsWith('_echo'))
    script = [[alias ?? 'extension_tool_call', alias ? {} : {
      canonicalToolId: 'extension:artifact.fixture/echo', arguments: {}
    }]]
  }
  return script?.[count]
}

function toolStream([name, args], model) {
  const chunk = { id: 'smoke-tool', object: 'chat.completion.chunk', model,
    choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0,
      id: 'smoke-' + name, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }] }
  const end = { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 } }
  return `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n`
}

export function chatStream(text, model) {
  return [
    { id: 'smoke-chat', object: 'chat.completion.chunk', model,
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
    { id: 'smoke-chat', object: 'chat.completion.chunk', model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 } }
  ].map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'
}

export function messagesStream(text) {
  return [
    { type: 'message_start', message: { id: 'smoke-message', type: 'message', role: 'assistant',
      model: 'kun-npm-fixture', content: [], usage: { input_tokens: 20, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } },
    { type: 'message_stop' }
  ].map((chunk) => `event: ${chunk.type}\ndata: ${JSON.stringify(chunk)}\n\n`).join('')
}

export function responsesStream(text) {
  const response = { id: 'smoke-response', object: 'response', status: 'completed',
    output: [{ id: 'smoke-output', type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text, annotations: [] }] }],
    usage: { input_tokens: 20, output_tokens: 4, total_tokens: 24 } }
  return [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
    { type: 'response.output_text.delta', item_id: 'smoke-output', output_index: 0, content_index: 0, delta: text },
    { type: 'response.completed', response }
  ].map((chunk) => `event: ${chunk.type}\ndata: ${JSON.stringify(chunk)}\n\n`).join('')
}

export async function startFixtureModel(options = {}) {
  const requests = []
  const server = createServer(async (request, response) => {
    try {
      let text = ''
      for await (const part of request) text += part
      const body = text ? JSON.parse(text) : {}
      requests.push({ path: request.url, body })
      if (request.method === 'GET' && request.url.endsWith('/models')) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ data: [{ id: 'kun-npm-fixture', object: 'model' }] }))
        return
      }
      if (request.method !== 'POST') { response.writeHead(404); response.end(); return }
      const messages = request.url.endsWith('/messages')
      const responses = request.url.endsWith('/responses')
      if (JSON.stringify((body.messages ?? []).filter(message => message.role === 'user').at(-1)?.content)
        ?.includes('KUN_ARTIFACT_VERIFY_WAIT')) {
        const timer = setTimeout(() => response.end('fixture wait elapsed'), 30_000)
        response.once('close', () => clearTimeout(timer))
        return
      }
      if (body.stream === false) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(messages
          ? { id: 'smoke-message', type: 'message', role: 'assistant', content: [{ type: 'text', text: FIXTURE_REPLY }], stop_reason: 'end_turn', usage: { input_tokens: 20, output_tokens: 4 } }
          : responses
            ? { id: 'smoke-response', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: FIXTURE_REPLY }] }], usage: { input_tokens: 20, output_tokens: 4 } }
            : { id: 'smoke-chat', choices: [{ index: 0, message: { role: 'assistant', content: FIXTURE_REPLY }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 } }))
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      const call = !messages && !responses ? scriptedTool(body, options) : undefined
      response.end(call ? toolStream(call, body.model) : messages ? messagesStream(FIXTURE_REPLY)
        : responses ? responsesStream(FIXTURE_REPLY) : chatStream(FIXTURE_REPLY, body.model))
    } catch {
      response.writeHead(500); response.end('invalid fixture request')
    }
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  return { url: `http://127.0.0.1:${server.address().port}`, requests,
    close: () => new Promise((done) => { server.closeAllConnections(); server.close(done) }) }
}
