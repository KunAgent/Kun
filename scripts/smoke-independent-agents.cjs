'use strict'
const assert = require('node:assert/strict')

const MARK = 'INDEPENDENT_AGENT_SMOKE'
const INPUT = 'Discuss a question or describe the work to do…'
const textParts = (messages) => messages.flatMap((message) => typeof message.content === 'string'
  ? [message.content] : (message.content ?? []).flatMap((part) => part.text ? [part.text] : []))
function objects(messages) {
  return textParts(messages).flatMap((text) => text.split('\n')).flatMap((line) => {
    try { return [JSON.parse(line)] } catch { return [] }
  })
}
function independentAgentModelFixture() {
  const state = { agentResponses: 0, agentTriages: 0, agentMemoryCalls: 0, agentHandoffResponses: 0 }
  return { snapshot: () => ({ ...state }), respond({ body, prompt, called, tool }) {
    const inputs = objects(body.messages)
    const memory = inputs.findLast((value) => value.operation === 'agent_memory_capture')
    if (memory) {
      state.agentMemoryCalls++
      const user = memory.sources?.find((source) => source.author === 'user' && source.text.includes(MARK + ': remember'))
      return { content: JSON.stringify({ candidates: user ? [{
        content: 'Reports use Chinese and include source links.', type: 'preference', confidence: .95, importance: .7,
        tags: [], sourceIds: [user.id], durability: 'durable', comparisons: []
      }] : [] }) }
    }
    if (!JSON.stringify(body.messages).includes(MARK)) return null
    if (JSON.stringify(body.messages).includes('Decide whether this member has a concrete new contribution')) {
      state.agentTriages++
      return { content: JSON.stringify({ action: 'skip', reason: 'The addressed teammate already has the useful contribution.' }) }
    }
    if (prompt.includes('Provide read-only assistance for this scoped Agent handoff')) {
      state.agentHandoffResponses++
      if (!called('read_room_updates')) return { content: '', toolCalls: tool('read_room_updates', {}) }
      if (!called('send_room_message')) return { content: '', toolCalls: tool('send_room_message', {
        body: MARK + ': scoped helper result; no code execution was authorized.'
      }) }
      return { content: 'Submitted.' }
    }
    if (!prompt.includes('Participate as this Kun room member')) return null
    state.agentResponses++
    if (!called('read_room_updates')) return { content: '', toolCalls: tool('read_room_updates', {}) }
    if (!called('send_room_message')) return { content: '', toolCalls: tool('send_room_message', {
      body: MARK + ': I will use Chinese reports with source links. The current work remains read-only.'
    }) }
    return { content: 'Submitted.' }
  } }
}

async function exerciseIndependentAgents({ page, request, poll, capture, fixture, resize }) {
  const screenshots = [], assertions = []
  const shot = async (name) => { await capture('agents-' + name); screenshots.push(name) }
  const panel = () => page.getByRole('dialog', { name: 'Room details', exact: true })
  const active = () => panel().locator('[data-active-drawer-page="true"]')
  const composer = () => page.locator('[data-rooms-workspace] > section').first().locator(':scope > .rooms-composer')
  const sections = page.getByRole('navigation', { name: 'Conversation sections', exact: true })
  const count = () => Object.values(fixture.snapshot()).reduce((sum, value) => sum + (typeof value === 'number' ? value : 0), 0)
  const close = async () => { if (await panel().count()) await panel().getByRole('button', { name: 'Close', exact: true }).click() }
  const send = async (body) => {
    await composer().getByLabel('Automatic intent', { exact: true }).selectOption('discussion')
    await composer().getByRole('textbox', { name: INPUT, exact: true }).fill(body)
    await composer().getByRole('button', { name: 'Send', exact: true }).click()
    await poll(() => composer().getByRole('textbox', { name: INPUT, exact: true }).innerText().then((value) => value.trim() === ''), 10000, 'private send acknowledged')
  }
  const quiet = async (ids, roomId) => {
    let stableSince = 0, lastCount = count()
    await poll(async () => {
      const states = await Promise.all(ids.map((id) => request(page, '/v1/agents/' + id + '/memory-work')))
      const actors = await request(page, '/v1/agents?limit=100')
      const topics = roomId ? (await request(page, '/v1/rooms/' + roomId + '/topics')).topics : []
      const idle = (!roomId || topics.length > 0 && topics.every((topic) => topic.status === 'idle')) &&
        states.every((state) => !state.jobs.some((job) => ['pending', 'running'].includes(job.status))) &&
        ids.every((id) => !actors.activities?.[id]?.runs.length)
      const nowCount = count()
      if (!idle || nowCount !== lastCount) stableSince = 0
      else stableSince ||= Date.now()
      lastCount = nowCount
      return stableSince > 0 && Date.now() - stableSince >= 1800
    }, 30000, 'native Agent responses and memory jobs settle')
  }
  await sections.getByRole('button', { name: 'Agents', exact: true }).click()
  await page.getByRole('region', { name: 'Agents', exact: true }).waitFor()
  const beforeCreate = count()
  await page.getByRole('button', { name: 'Create Agent', exact: true }).click()
  await active().getByLabel('Name', { exact: true }).fill('Ada independent fixture')
  await active().getByLabel('Job / title', { exact: true }).fill('Evidence and scoped collaboration')
  await active().getByLabel('Long-term responsibilities', { exact: true }).fill(MARK + ': provide concise evidence and respect the current scope.')
  await active().getByRole('button', { name: 'Save', exact: true }).click()
  await active().getByRole('button', { name: 'Chat privately with this Agent', exact: true }).waitFor()
  const agents = await request(page, '/v1/agents?search=Ada%20independent%20fixture')
  assert.equal(agents.agents.length, 1)
  const ada = agents.agents[0]
  const bea = (await request(page, '/v1/agents', 'POST', { clientRequestId: 'independent-bea', name: 'Bea independent fixture',
    instructions: MARK + ': inspect only the supplied evidence.', defaultRole: 'reviewer' })).agent
  await active().getByRole('button', { name: 'Chat privately with this Agent', exact: true }).click()
  await page.getByRole('heading', { name: ada.name, exact: true, level: 1 }).waitFor()
  const direct = (await request(page, '/v1/agents/' + ada.id + '/conversation', 'POST', {})).room
  const repeated = (await request(page, '/v1/agents/' + ada.id + '/conversation', 'POST', {})).room
  assert.equal(direct.id, repeated.id)
  assert.equal(count(), beforeCreate, 'Creating/opening Agents must not call a model')
  await shot('private-empty')
  assertions.push('UI creates a durable Agent and opening its unique private chat performs no model work')
  await send(MARK + ': remember that reports use Chinese and include source links.')
  await poll(async () => (await request(page, '/v1/agents/' + ada.id + '/memories')).memories.length === 1, 30000, 'automatic scoped memory is persisted')
  await quiet([ada.id], direct.id)
  const portraitBounds = await page.locator('.agent-directory-row .rooms-avatar-art').evaluateAll((elements) =>
    elements.map((element) => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })))
  assert(portraitBounds.length >= 3 && portraitBounds.every((bounds) => bounds.width >= 16 && bounds.height >= 16),
    'Agent directory portraits must retain their image dimensions')
  const learned = (await request(page, '/v1/agents/' + ada.id + '/memories')).memories[0]
  assert.equal(learned.memory.agentContext.sourceConversationId, direct.id)
  assert.equal(learned.memory.agentContext.shared, false)
  await shot('private-response')
  const group = (await request(page, '/v1/rooms', 'POST', { clientRequestId: 'independent-group', name: 'Independent Agent scope group', collaborationMode: 'peer',
    defaultMemberId: 'ada', members: [ada, bea].map((agent, index) => ({ id: index ? 'bea' : 'ada',
      participantAgentId: agent.id, displayName: agent.name, presetId: agent.presetId,
      role: agent.defaultRole, roleNotes: '', enabled: true, allowedRepositoryIds: [], revision: 0 })) })).room
  const chooseGroup = async () => {
    await close(); await sections.getByRole('button', { name: 'Groups', exact: true }).click()
    await page.getByRole('button', { name: group.name, exact: true }).click()
    await page.getByRole('heading', { name: group.name, exact: true }).waitFor()
  }
  await chooseGroup()
  await send(MARK + ': explain how Chinese reports should link sources in this group.')
  await quiet([ada.id, bea.id], group.id)
  const firstRuns = (await request(page, '/v1/rooms/' + group.id + '/runs?member_id=ada&phase=discussion')).runs
  assert(firstRuns.length > 0)
  const beforeSharing = await request(page, '/v1/rooms/' + group.id + '/runs/' + firstRuns[0].id)
  assert(!beforeSharing.context?.memoryIds?.includes(learned.memory.id), 'Unshared private memory reached a group')
  assertions.push('one identity participates in a private chat and a group, while work memory stays isolated')
  await sections.getByRole('button', { name: 'Agents', exact: true }).click()
  await page.getByRole('region', { name: 'Agents', exact: true }).getByRole('button', { name: ada.name, exact: true }).click()
  await page.getByRole('heading', { name: ada.name, exact: true, level: 1 }).waitFor()
  await composer().getByRole('textbox', { name: INPUT, exact: true }).fill('PRIVATE_DRAFT_SURVIVES_MEMORY_VIEW')
  const beforeView = count()
  await page.locator('.agent-collaboration-strip').getByRole('button', { name: 'Agent profile and memory', exact: true }).click()
  await active().getByRole('button', { name: 'Memory', exact: true }).click()
  const memoryPanel = active().getByRole('region', { name: 'Long-term memory', exact: true })
  const entry = memoryPanel.locator('.agent-memory-entry').filter({ hasText: learned.memory.content }).last()
  await entry.waitFor()
  await shot('memory-source')
  await entry.getByRole('button', { name: 'Memory visibility', exact: true }).click()
  await entry.getByLabel('General preference for this Agent', { exact: true }).check()
  await entry.getByRole('button', { name: 'Save', exact: true }).click()
  await poll(async () => (await request(page, '/v1/agents/' + ada.id + '/memories')).memories[0].memory.agentContext.shared, 10000, 'explicit universal preference saved')
  const sharedEntry = memoryPanel.locator('.agent-memory-entry').filter({ hasText: learned.memory.content }).last()
  await sharedEntry.getByRole('button', { name: 'Correct', exact: true }).click()
  await sharedEntry.getByRole('textbox', { name: 'Memory content', exact: true }).fill('Reports use Chinese, source links, and a short conclusion.')
  await sharedEntry.getByRole('button', { name: 'Save', exact: true }).click()
  await poll(async () => (await request(page, '/v1/agents/' + ada.id + '/memories')).memories[0].memory.content.includes('short conclusion'), 10000, 'memory correction saved')
  await shot('memory-corrected')
  await close()
  assert((await composer().getByRole('textbox', { name: INPUT, exact: true }).innerText()).includes('PRIVATE_DRAFT_SURVIVES_MEMORY_VIEW'))
  assert.equal(count(), beforeView, 'Memory viewing/correction/sharing must not call a model')
  await chooseGroup()
  await send(MARK + ': explain how Chinese reports should link sources and include a conclusion in this group.')
  await quiet([ada.id, bea.id], group.id)
  const nextRuns = (await request(page, '/v1/rooms/' + group.id + '/runs?member_id=ada&phase=discussion')).runs
  const afterSharing = await request(page, '/v1/rooms/' + group.id + '/runs/' + nextRuns[0].id)
  assert(afterSharing.context?.memoryIds?.includes(learned.memory.id), 'Explicitly shared memory was not injected')
  assert(afterSharing.context.prompt.includes('short conclusion'))
  assertions.push('memory correction and explicit sharing change future scoped retrieval without background execution')
  await page.getByRole('button', { name: 'Agent collaboration', exact: true }).click()
  await active().getByText('Request help from an Agent', { exact: true }).click()
  await active().getByRole('button', { name: 'Choose a helper', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Choose a helper', exact: true })
  await picker.getByLabel('Search Agents', { exact: true }).fill(bea.name)
  await picker.getByRole('button').filter({ hasText: bea.name }).click()
  await active().getByLabel('What should the Agent help with?', { exact: true }).fill(MARK + ': give a scoped independent check, without executing code.')
  await active().getByRole('button', { name: 'Send collaboration request', exact: true }).click()
  await poll(async () => {
    const jobs = (await request(page, '/v1/agent-handoffs?source_room_id=' + group.id)).handoffs
    const failed = jobs.find((job) => job.status === 'failed' || job.status === 'recovery_required')
    if (failed) {
      const detail = await request(page, '/v1/agent-handoffs/' + failed.id)
      const items = failed.runId ? await request(page, '/v1/rooms/' + failed.pairRoomId + '/runs/' + failed.runId + '/items') : null
      throw new Error('Handoff failed: ' + JSON.stringify({ detail, items }))
    }
    return jobs.some((job) => job.status === 'completed')
  }, 30000, 'native handoff completes')
  await quiet([ada.id, bea.id], group.id)
  const handoffs = await request(page, '/v1/agent-handoffs?source_room_id=' + group.id)
  const handoff = handoffs.handoffs.find((job) => job.status === 'completed')
  assert(handoff.runId)
  await shot('handoff-completed')
  await active().getByRole('button', { name: 'Open Agent conversation', exact: true }).first().click()
  const pair = (await request(page, '/v1/rooms/' + handoff.pairRoomId)).room
  await page.getByRole('heading', { name: pair.name, exact: true }).waitFor()
  assert.equal(await composer().count(), 0, 'Agent-to-Agent transcript must be read-only for user sends')
  const pairMessages = (await request(page, '/v1/rooms/' + pair.id + '/messages')).messages
  assert(pairMessages.some((message) => message.originRunId === handoff.runId))
  assert.equal((await request(page, '/v1/rooms/' + group.id + '/tasks')).tasks.length, 0)
  assertions.push('explicit collaboration uses the native queue, creates an inspectable pair chat, and creates no code tasks')
  await shot('pair-conversation')
  const beforeRead = count()
  await page.getByRole('button', { name: 'View this run', exact: true }).first().click()
  await active().getByRole('region', { name: 'Run details', exact: true }).waitFor()
  assert.equal(await active().getByRole('region', { name: 'Run details', exact: true }).getAttribute('data-run-id'), handoff.runId)
  await shot('exact-handoff-run')
  await close()
  assert.equal(count(), beforeRead)
  await sections.getByRole('button', { name: 'Agents', exact: true }).click()
  await page.getByRole('region', { name: 'Agents', exact: true }).getByRole('button', { name: ada.name, exact: true }).click()
  await page.getByRole('heading', { name: ada.name, exact: true, level: 1 }).waitFor()
  assert((await composer().getByRole('textbox', { name: INPUT, exact: true }).innerText()).includes('PRIVATE_DRAFT_SURVIVES_MEMORY_VIEW'))
  await page.locator('.agent-collaboration-strip').getByRole('button', { name: 'Agent profile and memory', exact: true }).click()
  await active().getByRole('button', { name: 'Memory', exact: true }).click()
  await active().getByRole('button', { name: 'Forget', exact: true }).first().click()
  await poll(async () => (await request(page, '/v1/agents/' + ada.id + '/memories')).memories.length === 0, 10000, 'forgotten memory excluded')
  await shot('memory-forgotten')
  await close()
  await page.getByRole('button', { name: 'Agent features', exact: true }).click()
  const features = page.getByRole('dialog', { name: 'Agent features', exact: true })
  const collaboration = features.getByLabel('Agent collaboration', { exact: true })
  await poll(async () => await collaboration.isEnabled() && await collaboration.isChecked(), 10000, 'feature controls loaded')
  await collaboration.uncheck()
  await poll(async () => !(await request(page, '/v1/agents/features')).features.collaboration, 10000, 'collaboration can be disabled independently')
  await poll(() => collaboration.isEnabled(), 10000, 'feature save finished')
  await collaboration.check()
  await poll(async () => (await request(page, '/v1/agents/features')).features.collaboration, 10000, 'collaboration restored')
  await page.keyboard.press('Escape')
  await page.locator('.agent-collaboration-strip').getByRole('button', { name: 'Agent profile and memory', exact: true }).click()
  await active().getByRole('button', { name: 'Archive Agent', exact: true }).click()
  await active().getByRole('button', { name: 'Restore', exact: true }).waitFor()
  await shot('archived-profile')
  await active().getByRole('button', { name: 'Restore', exact: true }).click()
  await active().getByRole('button', { name: 'Archive Agent', exact: true }).waitFor()
  for (const theme of ['dark', 'light']) {
    await page.evaluate(async (value) => { const { applyTheme } = await import('/src/lib/apply-theme.ts'); applyTheme(value) }, theme)
    await resize(960, 780)
    await shot('narrow-' + theme)
  }
  await resize(1360, 900); await close()
  await sections.getByRole('button', { name: 'Groups', exact: true }).click()
  assertions.push('archive/restore, independent feature controls, exact run inspection, draft restoration, and narrow themes')
  return { agentIds: [ada.id, bea.id], privateRoomId: direct.id, groupRoomId: group.id, pairRoomId: pair.id,
    memoryId: learned.memory.id, handoffId: handoff.id, runId: handoff.runId, screenshots, assertions }
}
module.exports = { independentAgentModelFixture, exerciseIndependentAgents }
