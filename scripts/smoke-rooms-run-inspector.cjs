'use strict'
const assert = require('node:assert/strict')

async function monitor(page) {
  await page.evaluate(async () => {
    const { rendererRuntimeClient: client } = await import('/src/agent/runtime-client.ts')
    const request = client.runtimeRequest.bind(client)
    const start = client.startSse.bind(client), stop = client.stopSse.bind(client)
    const state = { mutations: [], opened: [], closed: [] }
    globalThis.__roomRunInspection = state
    client.runtimeRequest = (path, method = 'GET', ...args) => {
      if (method !== 'GET' && !path.endsWith('/read')) state.mutations.push({ path, method })
      return request(path, method, ...args)
    }
    client.startSse = (id, seq, stream, options) => {
      if (options?.scope === 'room-run') state.opened.push({ id, stream, options })
      return start(id, seq, stream, options)
    }
    client.stopSse = (id) => { state.closed.push(id); return stop(id) }
    globalThis.__restoreRunInspection = () => {
      client.runtimeRequest = request; client.startSse = start; client.stopSse = stop
    }
  })
}
async function inspected(page) {
  const state = await page.evaluate(() => globalThis.__roomRunInspection)
  assert.deepEqual(state.mutations, [], 'Viewing a run produced a mutating runtime request')
  assert(state.opened.length > 0, 'Run viewer never used its scoped SSE transport')
  assert(state.opened.every((entry) => state.closed.includes(entry.stream)), 'Closed run inspector retained its SSE stream')
  await page.evaluate(() => globalThis.__restoreRunInspection())
  return { subscriptions: state.opened.length, mutations: state.mutations.length }
}

async function viewRunningRoomRun({ page, request, roomId, poll, capture }) {
  const base = '/v1/rooms/' + roomId
  let current
  await poll(async () => {
    const topics = (await request(page, base + '/topics')).topics
    current = topics.flatMap((topic) => topic.members).find((member) => member.state === 'responding' && member.currentRunId)
    return Boolean(current)
  }, 15000, 'current activity has durable exact run identity')
  await monitor(page)
  const drawer = page.getByRole('dialog', { name: 'Room details', exact: true })
  const button = drawer.getByRole('button', { name: 'View current run', exact: true }).first()
  await button.click()
  const viewer = drawer.getByRole('region', { name: 'Run details', exact: true })
  await viewer.locator('.rooms-run-header').waitFor()
  assert.equal(await viewer.getAttribute('data-run-id'), current.currentRunId)
  assert((await viewer.innerText()).includes('Running') || (await viewer.innerText()).includes('Queued'))
  await capture('run-inspector-live')
  await drawer.getByRole('button', { name: 'Back to previous details', exact: true }).click()
  await button.waitFor()
  assert(await button.evaluate((node) => node === document.activeElement), 'Back did not restore the activity entry focus')
  await poll(() => page.evaluate(() => globalThis.__roomRunInspection.opened.every((entry) =>
    globalThis.__roomRunInspection.closed.includes(entry.stream))), 5000, 'run viewer unsubscribed')
  return { runId: current.currentRunId, ...await inspected(page) }
}

async function exerciseFinishedRoomRuns({ page, request, roomId, messages, poll, capture, fixture, resize }) {
  const base = '/v1/rooms/' + roomId
  const replies = messages.filter((message) => message.authorKind === 'member' && message.status === 'final')
  assert(replies.length >= 2 && replies.every((message) => message.originRunId), 'Published peer replies lack runtime run origins')
  const rows = (await request(page, base + '/runs?limit=50')).runs
  assert(rows.some((run) => run.phase === 'triage' && run.outcome === 'skipped'), 'Skipped participation checks disappeared')
  assert(rows.some((run) => run.status === 'cancelled'), 'Stopped unpublished response disappeared')
  const older = replies.find((message) => message.body.includes('explicit backpressure'))
  assert(older, 'Missing earlier topic response')
  const detail = await request(page, `${base}/runs/${older.originRunId}`)
  const before = fixture.snapshot()
  await monitor(page)
  const drawer = page.getByRole('dialog', { name: 'Room details', exact: true })
  if (await drawer.isVisible()) await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  const message = page.locator('#room-message-' + older.id)
  await message.getByRole('button', { name: 'View this run', exact: true }).click()
  const viewer = drawer.getByRole('region', { name: 'Run details', exact: true })
  await viewer.getByText('Published', { exact: false }).waitFor()
  assert.equal(await viewer.getAttribute('data-run-id'), older.originRunId)
  assert.equal(await viewer.getByRole('button', { name: 'Open this run in Code', exact: true }).getAttribute('data-thread-target-turn-id'), detail.run.turnId)
  await viewer.getByText('Tool result', { exact: true }).first().click()
  const tool = viewer.locator('.rooms-run-item').filter({ hasText: 'Tool result' }).first()
  await tool.getByRole('button', { name: 'Read full recorded content', exact: true }).click()
  await tool.getByText(/characters loaded/).waitFor()
  await capture('run-inspector-completed-tools')
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async (value) => {
      const { applyTheme } = await import('/src/lib/apply-theme.ts')
      applyTheme(value)
    }, theme)
    await resize(760, 780)
    await page.waitForTimeout(200)
    const bounds = await drawer.boundingBox(), viewport = await page.evaluate(() => innerWidth)
    assert(bounds.x >= 0 && bounds.x + bounds.width <= viewport + 1, 'Run inspector exceeds narrow viewport')
    await capture('run-inspector-narrow-' + theme)
  }
  await resize(1360, 900)
  await viewer.getByRole('button', { name: 'Open this run in Code', exact: true }).click()
  await poll(async () => page.evaluate(async ({ threadId, turnId }) => {
    const { useChatStore } = await import('/src/store/chat-store.ts')
    const { useThreadTurnTarget } = await import('/src/components/chat/thread-turn-target.ts')
    return useChatStore.getState().activeThreadId === threadId && useThreadTurnTarget.getState().target?.turnId === turnId
  }, { threadId: detail.run.threadId, turnId: detail.run.turnId }), 20000, 'Code exact turn target selected')
  const target = page.locator(`[data-turn-id="${detail.run.turnId}"]`)
  await target.waitFor()
  await poll(() => target.evaluate((node) => {
    const rect = node.getBoundingClientRect()
    return rect.top < innerHeight && rect.bottom > 0
  }), 5000, 'Code exact turn is in viewport')
  await capture('run-inspector-code-exact-turn')
  await poll(() => page.evaluate(() => globalThis.__roomRunInspection.opened.every((entry) =>
    globalThis.__roomRunInspection.closed.includes(entry.stream))), 5000, 'Code navigation closed run subscription')
  const monitoring = await inspected(page)
  assert.deepEqual(fixture.snapshot(), before, 'Run inspection invoked the offline model')
  return { inspectedRunId: older.originRunId, threadId: detail.run.threadId, turnId: detail.run.turnId,
    exactOrigin: true, triageHistory: true, cancelledHistory: true, codeTargetVisible: true, ...monitoring }
}
async function exerciseTaskRoomRuns({ page, request, roomId, taskId, poll, capture }) {
  const runs = (await request(page, `/v1/rooms/${roomId}/runs?task_id=${taskId}&limit=50`)).runs
  assert(runs.some((run) => run.phase === 'execution'), 'Task execution run missing')
  assert(runs.some((run) => run.phase === 'review'), 'Task review run missing')
  assert(runs.some((run) => run.phase === 'integration'), 'Task integration run missing')
  const messages = (await request(page, `/v1/rooms/${roomId}/messages?limit=100`)).messages
  let noticesChecked = 0
  for (const notice of messages.filter((message) => message.taskId === taskId && message.authorKind === 'member' &&
    !message.originRunId && !message.id.startsWith('progress-' + taskId + '-'))) {
    const row = page.locator('#room-message-' + notice.id)
    if (!await row.count()) continue
    assert.equal(await row.getByRole('button', { name: 'View this run', exact: true }).count(), 0,
      'Task status notice pretends to be a model response')
    noticesChecked++
  }
  assert(noticesChecked > 0, 'No task status notice was checked')
  const drawer = page.getByRole('dialog', { name: 'Room details', exact: true })
  const list = drawer.getByRole('region', { name: 'Current and past runs', exact: true })
  await list.getByRole('button').filter({ hasText: 'Execution' }).first().click()
  const viewer = drawer.getByRole('region', { name: 'Run details', exact: true })
  await viewer.locator('.rooms-run-header').waitFor()
  const runId = await viewer.getAttribute('data-run-id')
  assert(runs.some((run) => run.id === runId && run.phase === 'execution'), 'Task entry selected wrong run phase')
  await capture('run-inspector-task-execution')
  await drawer.getByRole('button', { name: 'Back to previous details', exact: true }).click()
  await poll(() => list.isVisible(), 5000, 'run inspector returned to same task history')
  return { execution: true, review: true, integration: true, noticesChecked, inspectedRunId: runId }
}
module.exports = { viewRunningRoomRun, exerciseFinishedRoomRuns, exerciseTaskRoomRuns }
