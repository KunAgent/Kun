'use strict'

// OpenAI-compatible stand-in for the artifacts chat smoke. Streaming chat
// requests stay open until `release()` so the smoke can change the file while
// the turn is running; other requests (titles, model lists) answer at once.

const { createServer } = require('node:http')

async function startArtifactChatModel() {
  const held = new Set()
  const requests = []
  let released = false
  const finish = (response) => {
    const chunk = (delta, finishReason = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`
    response.end(`${chunk({ content: 'Widened the bars on slide 3.' })}${chunk({}, 'stop')}data: [DONE]\n\n`)
  }
  const server = createServer((request, response) => {
    if (request.url?.endsWith('/models')) {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ data: [{ id: 'deepseek-chat' }] }))
      return
    }
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      let input = {}
      try { input = JSON.parse(body || '{}') } catch { /* keep empty */ }
      requests.push(input)
      if (input.stream !== true) {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: 'Roadmap edits' }, finish_reason: 'stop' }] }))
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(': held for the artifacts chat smoke\n\n')
      if (released) finish(response)
      else held.add(response)
      response.on('close', () => held.delete(response))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    /** User message texts of the streaming chat requests, oldest first. */
    userTexts: () => requests.filter((input) => input.stream === true).flatMap((input) =>
      (input.messages ?? []).filter((message) => message.role === 'user').map((message) =>
        typeof message.content === 'string' ? message.content : JSON.stringify(message.content))),
    release: () => { released = true; for (const response of held) finish(response); held.clear() },
    close: async () => {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  }
}

module.exports = { startArtifactChatModel }
