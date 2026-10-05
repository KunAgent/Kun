'use strict'
const assert = require('node:assert/strict')
const { roomWorkbenchSnapshot } = require('./smoke-agent-chat-workbench.cjs')

/** Real Electron controls and runtime, using the existing isolated offline model fixture. */
async function exerciseAgentModelControls({ page, request, poll, capture, resize, fixture, openPrivate, switchRooms, recordDiagnostic }) {
  assert.equal(fixture.snapshot().real, false, 'Agent model controls must use the disposable offline fixture')
  const assertions = []
  await openPrivate()
  const entry = await request(page, '/v1/agents/chat-entry')
  assert(entry.initialized && entry.agentId && entry.roomId, 'Normal private entry initializes an Agent and conversation')
  assert.equal((await roomWorkbenchSnapshot(page)).privateRoomId, entry.roomId)
  const initialAgent = (await request(page, '/v1/agents/' + entry.agentId)).agent
  await switchRooms()
  const rooms = page.locator('[data-room-surface="rooms"]')
  const sidebar = rooms.locator('.rooms-im-sidebar')
  await rooms.waitFor()
  await sidebar.waitFor()
  await sidebar.getByRole('button', { name: initialAgent.name, exact: true }).click()
  const waitForRoomsPrivate = async (roomId, name) => {
    await poll(async () => {
      const state = await roomWorkbenchSnapshot(page)
      return state.route === 'rooms' && state.roomsRoomId === roomId
    }, 15000, 'exact private conversation selected in Rooms: ' + roomId)
    await poll(async () => (await rooms.locator('.direct-chat-title strong').innerText().catch(() => '')) === name,
      15000, 'exact private recipient rendered in Rooms: ' + name)
    await rooms.locator('.rooms-composer .rooms-rich-input').waitFor()
  }
  await waitForRoomsPrivate(entry.roomId, initialAgent.name)
  assertions.push('Normal private bootstrap and Rooms navigation select the same exact conversation')
  const connections = await request(page, '/v1/model-connections')
  const offline = connections.providers.find((provider) => provider.configured && provider.kind === 'http')
  assert(offline && ['127.0.0.1', 'localhost'].includes(new URL(offline.baseUrl).hostname), 'Only the disposable loopback model fixture may be patched')
  await request(page, '/v1/model-connections/' + encodeURIComponent(offline.id), 'PATCH', {
    expectedRevision: connections.revision, models: [...new Set([...offline.models, 'rooms-model-alternative'])]
  })
  const open = () => sidebar.getByRole('button', { name: 'New conversation', exact: true }).click()
  const count = async () => (await request(page, '/v1/agents?limit=100')).agents.length
  const initialAgents = (await request(page, '/v1/agents?limit=100')).agents
  const startCount = initialAgents.length
  const initialIds = new Set(initialAgents.map((agent) => agent.id))
  await open()
  await page.getByRole('button', { name: 'Define in chat', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Choose a model for your new Agent', exact: true })
  await modal.getByLabel('Provider, account and model', { exact: true }).waitFor()
  assert.equal(await modal.getByRole('button', { name: 'Continue', exact: true }).isEnabled(), false)
  assert.equal(await count(), startCount)
  await capture('agent-models-create-unselected')
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(await count(), startCount)
  assertions.push('Open/cancel model selection performs no role creation')

  await open()
  await page.getByRole('button', { name: 'Define in chat', exact: true }).click()
  const catalog = await request(page, '/v1/agents/creation-models')
  const eligible = catalog.options.filter((item) => item.available && item.providerId)
  assert(eligible.length > 1, 'Offline model fixture must expose two eligible models')
  const selected = eligible[0]
  const key = JSON.stringify([selected.providerId, selected.accountId, selected.model])
  await modal.getByLabel('Provider, account and model', { exact: true }).selectOption(key)
  await capture('agent-models-create-selected')
  await modal.getByRole('button', { name: 'Continue', exact: true }).click()
  await poll(async () => await count() === startCount + 1, 15000, 'one explicitly configured Agent created')
  const created = (await request(page, '/v1/agents?limit=100')).agents.find((agent) => !initialIds.has(agent.id) && agent.name === 'New agent')
  assert(created, 'Chat-created Agent exists')
  assert.deepEqual(created.modelRef, JSON.parse(JSON.stringify({ providerId: selected.providerId, accountId: selected.accountId, model: selected.model })))
  await request(page, '/v1/agents/' + created.id + '/setup', 'POST', { clientRequestId: 'model-smoke-skip', action: 'skip' })
  const current = (await request(page, '/v1/agents/' + created.id + '/conversation', 'POST', {})).room
  await waitForRoomsPrivate(current.id, created.name)
  const picker = rooms.getByLabel('Model for this conversation', { exact: true })
  await picker.waitFor()
  await poll(async () => await picker.isEnabled() && await picker.inputValue() === key, 10000, 'composer model metadata loaded')
  assert.equal(await picker.inputValue(), key)
  await capture('agent-models-composer-light')
  const alternative = eligible.find((item) => JSON.stringify([item.providerId, item.accountId, item.model]) !== key)
  assert(alternative)
  const binding = { providerId: alternative.providerId, accountId: alternative.accountId, model: alternative.model }
  await picker.selectOption(JSON.stringify([binding.providerId, binding.accountId, binding.model]))
  await poll(async () => {
    const saved = (await request(page, '/v1/rooms/' + current.id)).room.privateModelRef
    return saved?.providerId === binding.providerId && saved?.accountId === binding.accountId && saved?.model === binding.model
  }, 10000, 'exact composer provider/account/model saved')
  assert.deepEqual((await request(page, '/v1/agents/' + created.id)).agent.modelRef, created.modelRef)
  assertions.push('Composer exposes exact model and conversation-only selection preserves role defaults')
  await resize(720, 800)
  await page.evaluate(async () => { const { applyTheme } = await import('/src/lib/apply-theme.ts'); applyTheme('dark') })
  await capture('agent-models-composer-dark-narrow')
  const overflow = await picker.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return rect.left < 0 || rect.right > innerWidth + 1
  })
  assert.equal(overflow, false)
  await resize(1360, 900)
  await page.evaluate(async () => { const { applyTheme } = await import('/src/lib/apply-theme.ts'); applyTheme('light') })

  await sidebar.getByRole('button', { name: 'Manage all Agents', exact: true }).click()
  const activePage = page.locator('[data-active-drawer-page="true"]')
  const directory = activePage.locator('.agent-directory')
  await directory.waitFor()
  const configure = directory.getByRole('button', { name: 'Configure ' + created.name, exact: true })
  await configure.waitFor()
  const overviewRow = directory.locator('.agent-directory-row').filter({
    has: page.getByRole('button', { name: 'Configure ' + created.name, exact: true })
  })
  const roleOptions = await request(page, '/v1/agents/' + created.id + '/models')
  const roleProvider = roleOptions.options.find((item) => JSON.stringify([item.providerId, item.accountId, item.model]) === key)
  const roleLabel = [roleProvider?.providerLabel ?? selected.providerId, selected.accountId, selected.model].filter(Boolean).join(' / ')
  await overviewRow.getByText(roleLabel, { exact: true }).waitFor()
  await capture('agent-models-manager-overview')
  await configure.click()
  await activePage.locator('.agent-detail-tabs').getByRole('button', { name: 'Models', exact: true }).click()
  await activePage.getByText('Model changes save immediately. Profile changes use the profile Save button.', { exact: true }).waitFor()
  const roleModel = activePage.getByLabel('Main model', { exact: true })
  await roleModel.waitFor()
  assert.equal(await roleModel.inputValue(), key, 'Manager displays the role default, not the conversation override')
  await capture('agent-models-manager-role-defaults')
  assertions.push('All-Agent manager opens inline role-default model configuration')
  // The workspace renders this drawer as an embedded region, not a modal dialog.
  const drawer = page.getByRole('region', { name: 'Room details', exact: true })
  await drawer.locator('.rooms-detail-titlebar').getByRole('button', { name: 'Close', exact: true }).click()
  await drawer.waitFor({ state: 'hidden' })

  await open()
  const newChat = page.getByRole('dialog', { name: 'New conversation', exact: true })
  await newChat.getByRole('button', { name: 'Group chat', exact: true }).click()
  const choices = newChat.locator('.direct-agent-choices > button').filter({ has: page.locator('strong') })
  await choices.nth(0).click()
  await choices.nth(1).click()
  const groupButton = newChat.locator('.direct-start-group')
  await groupButton.focus()
  const appearance = await groupButton.evaluate(async (element) => {
    const { bodyZoom } = await import('/src/lib/body-zoom.ts')
    const zoom = bodyZoom(), rect = element.getBoundingClientRect(), style = getComputedStyle(element)
    const clippedBy = []
    let visible = element.getClientRects().length > 0
    for (let current = element; current; current = current.parentElement) {
      const currentStyle = getComputedStyle(current)
      if (currentStyle.display === 'none' || currentStyle.visibility !== 'visible' || Number(currentStyle.opacity) === 0) visible = false
      if (current === element) continue
      const boundary = current.getBoundingClientRect()
      const clipsX = /^(auto|scroll|hidden|clip)$/.test(currentStyle.overflowX)
      const clipsY = /^(auto|scroll|hidden|clip)$/.test(currentStyle.overflowY)
      if (clipsX && (rect.left < boundary.left - .5 || rect.right > boundary.right + .5) ||
        clipsY && (rect.top < boundary.top - .5 || rect.bottom > boundary.bottom + .5)) {
        clippedBy.push(current.tagName + '.' + current.className)
      }
      // Modal dialogs render in the top layer; ancestors above them do not clip that layer.
      if (current.matches(':modal')) break
    }
    return { bodyZoom: zoom, layoutHeight: element.offsetHeight, visible, clippedBy,
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      viewport: { width: innerWidth, height: innerHeight },
      background: style.backgroundColor, color: style.color }
  })
  // Keep the actual native rendering and geometry even when an assertion fails.
  await capture('agent-models-group-primary')
  await recordDiagnostic?.('agent-models-group-primary-geometry', appearance)
  assert.equal(await groupButton.isEnabled(), true)
  assertPrimaryGroupGeometry(appearance)
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.direct-start-group').count(), 0)
  assertions.push('Group action has a 44px primary button, keyboard focus and cancellation')
  return { assertions, groupPrimaryGeometry: appearance, native: true, offline: true }
}
function transparentColor(value) {
  const color = String(value ?? '').trim().toLowerCase()
  if (!color || color === 'transparent') return true
  const slashAlpha = color.match(/\/\s*([\d.]+)%?\s*\)$/)
  if (slashAlpha) return Number(slashAlpha[1]) === 0
  const rgba = color.match(/^rgba\(([^)]+)\)$/)
  return Boolean(rgba && rgba[1].split(',').length === 4 && Number(rgba[1].split(',')[3].trim()) === 0)
}

/** offsetHeight uses layout CSS px; DOMRects already include the shell's body zoom. */
function assertPrimaryGroupGeometry(value) {
  const { bodyZoom, layoutHeight, rect, viewport, visible, clippedBy, background, color } = value
  assert(Number.isFinite(bodyZoom) && bodyZoom > 0, 'Primary button has a valid body zoom')
  assert(Number.isFinite(layoutHeight) && layoutHeight >= 44, 'Primary button is at least 44 layout CSS px high')
  assert(rect && ['left', 'top', 'right', 'bottom', 'width', 'height'].every((key) => Number.isFinite(rect[key])), 'Primary button has finite viewport geometry')
  assert(rect.width > 0 && rect.height > 0 && visible, 'Primary button is visibly rendered with positive dimensions')
  const normalizedHeight = rect.height / bodyZoom
  assert(normalizedHeight >= 44 - .1, 'Zoom-normalized primary button height is at least 44 CSS px (0.1px rounding tolerance)')
  assert(viewport && Number.isFinite(viewport.width) && viewport.width > 0 && Number.isFinite(viewport.height) && viewport.height > 0, 'Viewport has positive dimensions')
  assert(rect.left >= -.5 && rect.top >= -.5 && rect.right <= viewport.width + .5 && rect.bottom <= viewport.height + .5,
    'Primary button is fully inside the visual viewport')
  assert(Array.isArray(clippedBy) && clippedBy.length === 0, 'Primary button is not clipped by its ancestors')
  assert(!transparentColor(background) && !transparentColor(color), 'Primary button foreground and background are nontransparent')
  assert.notEqual(background, color, 'Primary button foreground differs from its background')
  return { normalizedHeight }
}
module.exports = { exerciseAgentModelControls, assertPrimaryGroupGeometry }
