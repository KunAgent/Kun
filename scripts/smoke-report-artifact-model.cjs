'use strict'

// OpenAI-compatible stand-in for the data report smoke. The first chat turn
// answers with one `report_open` tool call; once the tool result is in the
// history it answers with a short summary. Other requests answer at once.

const { createServer } = require('node:http')

const SMOKE_REPORT = {
  title: 'Kun user overview',
  subtitle: 'Accounts, real usage and the last 7 days. Shanghai time.',
  asOf: '10/27 23:10',
  sources: ['auth.users', 'code_activity', 'room_activity'],
  blocks: [
    {
      type: 'stats',
      items: [
        { label: 'Registered', value: 502, note: 'Auth accounts' },
        { label: 'Active users', value: 359, delta: '71.5%', tone: 'positive', note: 'With Code or Room activity' },
        { label: 'Activity records', value: 17726, note: 'Code + Room' }
      ]
    },
    { type: 'text', title: 'Last 7 days', body: 'Active = distinct accounts with Code or Room activity that day.' },
    {
      type: 'chart',
      width: 'half',
      chart: {
        version: 1, type: 'line', title: 'Daily active users',
        data: [['10/21', 93], ['10/22', 93], ['10/23', 99], ['10/24', 73], ['10/25', 65], ['10/26', 107], ['10/27', 100]]
          .map(([day, dau]) => ({ day, dau })),
        x: { field: 'day', label: 'Date' },
        series: [{ field: 'dau', label: 'DAU', color: 'accent' }]
      }
    },
    {
      type: 'chart',
      width: 'half',
      chart: {
        version: 1, type: 'bar', title: 'New sign-ups',
        data: [['10/21', 27], ['10/22', 28], ['10/23', 24], ['10/24', 11], ['10/25', 15], ['10/26', 26], ['10/27', 28]]
          .map(([day, signups]) => ({ day, signups })),
        x: { field: 'day', label: 'Date' },
        series: [{ field: 'signups', label: 'Sign-ups', color: 'warning' }]
      }
    }
  ]
}

const chunk = (delta, finishReason = null) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`

function hasToolResult(input) {
  return (input.messages ?? []).some((message) => message.role === 'tool')
}

function offersReportTool(input) {
  return (input.tools ?? []).some((tool) => tool?.function?.name === 'report_open')
}

async function startReportArtifactModel() {
  const requests = []
  const server = createServer((request, response) => {
    if (request.url?.endsWith('/models')) {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ data: [{ id: 'deepseek-chat' }] }))
      return
    }
    let body = ''
    request.on('data', (part) => { body += part })
    request.on('end', () => {
      let input = {}
      try { input = JSON.parse(body || '{}') } catch { /* keep empty */ }
      requests.push(input)
      if (input.stream !== true) {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: 'User data' }, finish_reason: 'stop' }] }))
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      if (!hasToolResult(input) && offersReportTool(input)) {
        const call = { index: 0, id: 'call_report_smoke', type: 'function', function: { name: 'report_open', arguments: JSON.stringify(SMOKE_REPORT) } }
        response.end(`${chunk({ role: 'assistant', tool_calls: [call] })}${chunk({}, 'tool_calls')}data: [DONE]\n\n`)
        return
      }
      const text = hasToolResult(input)
        ? 'About 71% of registered accounts are active; DAU dipped on 10/25 and recovered to 100.'
        : 'User data'
      response.end(`${chunk({ content: text })}${chunk({}, 'stop')}data: [DONE]\n\n`)
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    toolNames: () => [...new Set(requests.flatMap((input) => (input.tools ?? []).map((tool) => tool?.function?.name)).filter(Boolean))],
    close: async () => {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  }
}

module.exports = { SMOKE_REPORT, startReportArtifactModel }
