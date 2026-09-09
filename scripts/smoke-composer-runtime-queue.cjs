'use strict'

const { createServer } = require('node:http')

async function startQueueSmokeModel() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(': waiting for explicit smoke interruption\n\n')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    close: async () => {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  }
}

async function assertRuntimeQueueBridge(page, workspaceRoot) {
  return page.evaluate(async (workspace) => {
    const request = async (path, method = 'GET', body) => {
      const result = await window.kunGui.runtimeRequest(path, method, body === undefined ? undefined : JSON.stringify(body))
      if (!result.ok) throw new Error(`${method} ${path}: ${result.body}`)
      return JSON.parse(result.body)
    }
    const created = await request('/v1/threads', 'POST', { workspace, title: 'Queue bridge smoke', model: 'deepseek-chat' })
    const threadId = created.threadId ?? created.thread?.id ?? created.id
    if (!threadId) throw new Error(`Missing thread id: ${JSON.stringify(created)}`)
    const base = `/v1/threads/${encodeURIComponent(threadId)}`
    try {
      const a = await request(`${base}/turns`, 'POST', { prompt: 'A', clientRequestId: 'smoke-a' })
      const b = await request(`${base}/turns`, 'POST', { prompt: 'B original', enqueueIfBusy: true, clientRequestId: 'smoke-b' })
      const c = await request(`${base}/turns`, 'POST', { prompt: 'C', enqueueIfBusy: true, clientRequestId: 'smoke-c' })
      if (b.status !== 'queued' || c.status !== 'queued') throw new Error('Smoke model did not hold A running')
      await request(`${base}/turns/${c.turnId}/queue-position`, 'PATCH', { beforeTurnId: b.turnId })
      const queue = await request(`${base}/queued-turns`)
      if (queue.queuedTurns[0]?.turnId !== c.turnId) throw new Error(`Runtime reorder failed: ${JSON.stringify({ queue, a: await request(`${base}/turns/${a.turnId}`) })}`)
      const { useChatStore } = await import('/src/store/chat-store.ts')
      useChatStore.setState({ activeThreadId: threadId, route: 'chat', busy: true,
        currentTurnId: a.turnId, queuedMessages: [
          { id: 'b', text: 'B original', deliveryState: 'in_flight', deliveryTurnId: b.turnId, clientRequestId: 'smoke-b' },
          { id: 'c', text: 'C', deliveryState: 'in_flight', deliveryTurnId: c.turnId, clientRequestId: 'smoke-c' }
        ] })
      let restoredText = ''
      const restored = await useChatStore.getState().restoreQueuedMessage('b', (message) => {
        restoredText = message.text
        return true
      })
      if (!restored || restoredText !== 'B original') throw new Error('Runtime-owned restore did not complete')
      await useChatStore.getState().removeQueuedMessage('c')
      const empty = await request(`${base}/queued-turns`)
      if (empty.queuedTurns.length) throw new Error('Cancelled rows remain in runtime queue')
      const running = await request(`${base}/turns/${a.turnId}`)
      if ((running.turn ?? running).status !== 'running') throw new Error('Cancelling B/C interrupted A')
      await request(`${base}/turns/${b.turnId}/cancel-queued`, 'POST')
      const edited = await request(`${base}/turns`, 'POST', { prompt: 'B edited', enqueueIfBusy: true, clientRequestId: 'smoke-b-edited' })
      if (edited.turnId === b.turnId) throw new Error('Edited submission reused the cancelled identity')
      await request(`${base}/turns/${edited.turnId}/cancel-queued`, 'POST')
      await request(`${base}/turns/${a.turnId}/interrupt`, 'POST', {})
      const resumed = await request(`${base}/queue/resume`, 'POST')
      if (resumed.started) throw new Error('Cancelled turns were resumed')
      return { threadId, restoredText, cancelled: [b.turnId, c.turnId], editedTurnId: edited.turnId }
    } finally {
      await request(base, 'DELETE').catch(() => undefined)
    }
  }, workspaceRoot)
}

module.exports = { startQueueSmokeModel, assertRuntimeQueueBridge }
