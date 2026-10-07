'use strict'
const assert = require('node:assert/strict')
const { confirmAgentCreationModel } = require('./smoke-agent-creation-model.cjs')
const { createServer } = require('node:http')
const { readFile, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const { roomWorkbenchSnapshot } = require('./smoke-agent-chat-workbench.cjs')
const { collectWorkspaceFailureDiagnostics } = require('./smoke-personal-workspace-diagnostics.cjs')
const { captureCodeSidebarBaseline, createSidebarEvidence, readNativeBrowserGeometry,
  nativeBrowserGeometryIssues } = require('./smoke-personal-agent-workspace-sidebar.cjs')

// The model and static loopback page are fixtures; the native restart confirmation
// receives one exact, one-shot test response. Browser/tool consent stays real.
// Room identity, admission, tools, approvals, saved artifacts, browser policy,
// WebContentsView, renderer, preload, Manager and Runtime remain real.
async function startWorkspaceBrowserPage() {
  let pageRequests = 0
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/workspace-browser') {
      response.writeHead(404); response.end(); return
    }
    pageRequests++
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" })
    response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Personal workspace browser evidence</title>' +
      '<style>body{font:16px system-ui;background:#f5f7ff;color:#172444;padding:32px}main{max-width:600px}' +
      'h1{font-size:28px}p{line-height:1.6}strong{color:#2757ab}</style></head><body><main>' +
      '<h1>Personal workspace browser evidence</h1><p>This page is served only from the disposable loopback fixture.</p>' +
      '<p><strong>Real native browser, exact-origin consent, isolated session.</strong></p>' +
      '<p>No external assets, credentials, scripts or form submissions.</p></main></body></html>')
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { url: `http://127.0.0.1:${server.address().port}/workspace-browser`,
    snapshot: () => ({ pageRequests }),
    close: () => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)) } }
}

async function exercisePersonalAgentWorkspace({ page, request, poll, capture, recordDiagnostic, fixture, application, resize, openPrivate, workspaceRoot }) {
  assert.equal(fixture.snapshot().real, false, 'The workspace smoke must never use account credentials')
  const website = await startWorkspaceBrowserPage()
  const assertions = [], approvals = [], nativeBrowserEvidence = []
  const sidebar = createSidebarEvidence({ page, poll, capture, recordDiagnostic, resize })
  let diagnosticRoomId, diagnosticExecution
  const editor = () => page.locator('.rooms-composer .rooms-rich-input')
  const wrapper = () => page.locator('[data-room-agent-browser]:visible')
  const rail = () => page.locator('.rooms-workbench-rail')
  const sidebarRow = (roomId) => page.locator('.sidebar-agent-chats [data-sidebar-entry="room:' + roomId + '"] .sidebar-agent-chat-row')
  const activity = (id) => request(page, `/v1/rooms/${id}/direct`)
  const collapseWorkspacePanel = async (threadId) => {
    const panel = page.locator('[data-room-workbench-panel]:visible')
    if (await panel.count()) {
      await panel.getByRole('button', { name: 'Collapse right sidebar', exact: true }).first().click()
      await panel.waitFor({ state: 'hidden' })
    }
    if (threadId) await poll(async () => !(await browserState(threadId)).visible, 15000, 'collapsed browser is no longer visible')
  }
  const send = async (text) => {
    // Exercise the normal collapse/send/reopen flow without forcing a click.
    // Geometry checks separately prove the docked sidebar leaves the composer clear.
    await collapseWorkspacePanel()
    await editor().fill(text)
    await editor().press('Enter')
  }
  const openBrowser = async () => {
    if (!await wrapper().count()) await rail().locator('[data-room-tool="browser"]').click()
    await wrapper().waitFor()
  }
  const browserState = (threadId) => page.evaluate((id) => window.kunGui.getBrowserUseState(id), threadId)
  const allowTool = async (label) => {
    const next = application.waitForEvent('window')
    await page.getByRole('button', { name: 'Review and allow', exact: true }).first().click()
    const consent = await next
    await consent.getByRole('button', { name: 'Allow once', exact: true }).waitFor()
    assert(!await consent.evaluate(() => Boolean(window.kunGui)), 'Protected consent does not expose the workbench bridge')
    if (label) await capture(label, consent)
    await consent.getByRole('button', { name: 'Allow once', exact: true }).click()
    approvals.push(label ?? 'protected-tool-consent')
  }
  const completed = async (roomId, previous) => {
    let value
    await poll(async () => {
      const data = await activity(roomId)
      if (data.approvals.length) await allowTool()
      const current = data.requests[0]
      assert(!current || !['failed', 'recovery_required'].includes(current.status), JSON.stringify(data))
      if (current?.id !== previous && current?.status === 'completed' && !data.active) { value = current; return true }
      return false
    }, 60000, 'real runtime completed the artifact request')
    return value
  }
  const assertLiveBinding = async (roomId, execution) => {
    await poll(async () => await wrapper().getAttribute('data-state') === 'live', 15000, 'live browser execution binding')
    for (const [key, value] of Object.entries({ 'room-id': roomId, 'run-id': execution.runId,
      'thread-id': execution.threadId, 'turn-id': execution.turnId })) {
      assert(value, `Execution has ${key}`)
      assert.equal(await wrapper().getAttribute('data-' + key), value)
    }
  }
  const captureBrowserContents = async (name) => {
    let geometry
    await poll(async () => {
      geometry = await readNativeBrowserGeometry({ page, application, url: website.url })
      return nativeBrowserGeometryIssues(geometry).length === 0
    }, 15000, 'actual native browser bounds follow the visible renderer host')
    await recordDiagnostic(name + '-geometry', geometry)
    let evidence
    await capture(name, { screenshot: async ({ path }) => {
      const result = await application.evaluate(async ({ webContents }, url) => {
        const contents = webContents.getAllWebContents().find((item) => !item.isDestroyed() && item.getURL() === url)
        if (!contents) throw new Error('Real Browser Use WebContents was not created')
        const preferences = contents.getLastWebPreferences()
        return { id: contents.id, title: contents.getTitle(), url: contents.getURL(),
          security: { sandbox: preferences.sandbox, nodeIntegration: preferences.nodeIntegration, contextIsolation: preferences.contextIsolation },
          isolated: await contents.executeJavaScript('typeof window.kunGui === "undefined" && typeof require === "undefined"'),
          png: (await contents.capturePage()).toPNG().toString('base64') }
      }, website.url)
      const { png, ...metadata } = result
      evidence = { ...metadata, geometry }
      assert.equal(metadata.security.sandbox, true)
      assert.equal(metadata.security.nodeIntegration, false)
      assert.equal(metadata.security.contextIsolation, true)
      assert.equal(metadata.isolated, true)
      await writeFile(path, Buffer.from(png, 'base64'))
    } })
    nativeBrowserEvidence.push(evidence)
  }
  const assertNoOverflow = async () => {
    assert((await page.evaluate(() => window.innerWidth)) < 768, 'Actually crossed the narrow breakpoint')
    assert(await page.locator('[data-rooms-workspace]').evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      'Private workspace must not overflow horizontally')
  }
  const openSavedFiles = async () => {
    await rail().getByRole('button', { name: 'Files', exact: true }).click()
    await page.locator('.direct-file-list:visible').waitFor()
  }
  try {
    const codeBaseline = await captureCodeSidebarBaseline({ page, workspaceRoot, fixture, poll, sidebar })
    await openPrivate()
    const entry = await request(page, '/v1/agents/chat-entry')
    assert(entry.roomId && entry.agentId)
    diagnosticRoomId = entry.roomId
    const firstAgent = (await request(page, '/v1/agents')).agents.find((value) => value.id === entry.agentId)
    assert(firstAgent)
    await openBrowser()
    await poll(async () => await wrapper().getAttribute('data-state') === 'idle', 15000, 'empty private browser')
    assert.equal(await wrapper().locator('[data-browser-use-variant]').count(), 0)
    assert.equal(fixture.snapshot().mainCalls, 0, 'Opening the private workspace does not invoke a model')
    await sidebar.privateCapture('workspace-01-empty-browser-wide', '[data-room-agent-browser]')
    await sidebar.pointerResize('private', '[data-room-agent-browser]')
    await sidebar.resizeTo(760, 780)
    await sidebar.privateCapture('sidebar-private-empty-browser-narrow', '[data-room-agent-browser]')
    await sidebar.resizeTo(1360, 900)
    assertions.push('An empty Agent workspace opens a browser placeholder without binding an old Code task')

    await collapseWorkspacePanel()
    await prepareWorkspaceApprovalMode({ page, application, request, poll, roomId: entry.roomId, capture })
    await send('WORKSPACE_ARTIFACT Create workspace-evidence.txt and attach the saved file to your final reply.')
    await page.getByRole('button', { name: 'Review and allow', exact: true }).first().waitFor()
    await capture('workspace-02-real-write-approval')
    await allowTool('workspace-03-protected-write-consent')
    const artifactRun = await completed(entry.roomId)
    const direct = await activity(entry.roomId)
    assert.equal(await readFile(join(direct.workspace.path, 'workspace-evidence.txt'), 'utf8'), 'Saved personal workspace artifact v1\n')
    const messages = (await request(page, `/v1/rooms/${entry.roomId}/messages`)).messages
    const source = messages.find((message) => message.originRunId === artifactRun.runId &&
      message.references?.some((ref) => ref.kind === 'agent_file' && ref.artifactId))
    assert(source, 'The real send_im_message tool published a durable saved-artifact reference')
    const artifact = source.references.find((ref) => ref.kind === 'agent_file' && ref.artifactId)
    await page.locator('#room-message-' + source.id).waitFor()
    // Prove the preview reads the immutable version rather than a mutable workspace file.
    await writeFile(join(direct.workspace.path, 'workspace-evidence.txt'), 'Mutable working copy changed after publication\n')
    const draft = 'Keep this private draft while inspecting the workspace.'
    await editor().fill(draft)
    const scope = await roomWorkbenchSnapshot(page)
    await openSavedFiles()
    const savedFiles = () => page.locator('.direct-file-list:visible')
    await savedFiles().getByRole('textbox', { name: 'Search saved files', exact: true }).fill('missing-smoke-file')
    await savedFiles().getByText('No files match your search', { exact: true }).waitFor()
    assert.equal(await savedFiles().getByRole('button', { name: /workspace-evidence/ }).count(), 0)
    await savedFiles().getByRole('textbox', { name: 'Search saved files', exact: true }).fill('workspace-evidence')
    const saved = savedFiles().getByRole('button', { name: /workspace-evidence\.txt/ }).first()
    await saved.waitFor()
    await sidebar.privateCapture('workspace-04-saved-artifact-search', '.direct-file-list')
    await sidebar.resizeTo(760, 780)
    await sidebar.privateCapture('sidebar-private-saved-files-narrow', '.direct-file-list')
    await sidebar.resizeTo(1360, 900)
    await saved.click()
    const preview = () => page.locator('.rooms-content-preview:visible')
    await poll(async () => (await preview().innerText()).includes('Saved personal workspace artifact v1'), 15000, 'immutable artifact preview')
    assert(!(await preview().innerText()).includes('Mutable working copy changed'))
    assert.deepEqual(await roomWorkbenchSnapshot(page), scope)
    assert.equal(await editor().innerText(), draft)
    await sidebar.privateCapture('workspace-05-saved-artifact-preview-wide', '.rooms-content-preview')
    await sidebar.resizeTo(760, 780)
    await assertNoOverflow()
    await sidebar.privateCapture('workspace-06-saved-artifact-preview-narrow', '.rooms-content-preview')
    await sidebar.resizeTo(1360, 900)
    await preview().getByRole('button', { name: 'View source conversation', exact: true }).click()
    await poll(async () => page.locator('#room-message-' + source.id).evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return rect.bottom > 0 && rect.top < window.innerHeight
    }), 15000, 'artifact source conversation is in view')
    assert.deepEqual(await roomWorkbenchSnapshot(page), scope)
    assert.equal(await editor().innerText(), draft)
    await capture('workspace-07-artifact-source-conversation')
    assertions.push('Files searches the saved Agent library; immutable preview and source jump preserve recipient, project scope and draft')

    await openBrowser()
    await send('WORKSPACE_BROWSER_OPEN ' + website.url + ' Inspect this isolated development page and wait for the smoke controller.')
    let active
    await poll(async () => {
      const data = await activity(entry.roomId)
      assert(!data.active || !['failed', 'recovery_required'].includes(data.active.status), JSON.stringify(data))
      if (data.execution?.turnId) { active = data.execution; return true }
      return false
    }, 30000, 'authoritative admitted private execution')
    diagnosticExecution = active
    await openBrowser()
    await assertLiveBinding(entry.roomId, active)
    await capture('workspace-08-active-before-browser')
    await page.getByRole('button', { name: 'Review and allow', exact: true }).first().waitFor()
    await allowTool('workspace-09-protected-browser-tool-consent')
    const originButton = page.getByRole('button', { name: 'Allow origin once', exact: true })
    await originButton.waitFor()
    assert.equal(website.snapshot().pageRequests, 0, 'No page request occurs before exact-origin consent')
    const pending = await browserState(active.threadId)
    assert.equal(pending.pendingOriginConsent?.origin, new URL(website.url).origin)
    assert.equal(pending.mode, 'local-development')
    await sidebar.privateCapture('workspace-10-real-origin-consent-wide', '[data-room-agent-browser]')
    await sidebar.resizeTo(760, 780)
    await assertNoOverflow()
    await sidebar.privateCapture('workspace-11-real-origin-consent-narrow', '[data-room-agent-browser]')
    await sidebar.resizeTo(1360, 900)
    await originButton.click()
    await poll(async () => {
      const state = await browserState(active.threadId)
      assert(state.lifecycle !== 'error', JSON.stringify(state))
      return fixture.holding() && state.lifecycle === 'ready' && state.visible && state.mounted && state.tabs.length === 1
    }, 45000, 'real browser open, visible mount and held model continuation')
    assert(website.snapshot().pageRequests > 0)
    await assertLiveBinding(entry.roomId, active)
    await collapseWorkspacePanel(active.threadId)
    await editor().fill(draft)
    await openBrowser()
    await assertLiveBinding(entry.roomId, active)
    await poll(async () => (await browserState(active.threadId)).visible, 15000, 'browser visible after composer draft edit')
    await sidebar.privateCapture('workspace-12-live-browser-workbench', '[data-room-agent-browser]')
    await sidebar.resizeTo(760, 780)
    await sidebar.privateCapture('sidebar-private-live-browser-narrow', '[data-room-agent-browser]')
    await captureBrowserContents('sidebar-private-live-browser-webcontents-narrow')
    await sidebar.resizeTo(1360, 900)
    await poll(async () => (await browserState(active.threadId)).visible, 15000, 'native browser stays visible after resizing')
    await captureBrowserContents('workspace-13-real-browser-webcontents')
    await wrapper().getByRole('button', { name: 'Take control', exact: true }).click()
    await poll(async () => (await browserState(active.threadId)).controlOwner === 'manual', 15000, 'actual browser manual takeover')
    await sidebar.privateCapture('workspace-13b-manual-browser-control', '[data-room-agent-browser]')
    await wrapper().getByRole('button', { name: 'Return to agent', exact: true }).click()
    await poll(async () => (await browserState(active.threadId)).controlOwner === 'agent', 15000, 'actual browser control returned to Agent')
    assertions.push('Take control and Return to agent update the actual native browser manager ownership')

    const sourceBubble = page.locator('#room-message-' + source.id)
    await sourceBubble.hover()
    await sourceBubble.getByRole('button', { name: 'More actions', exact: true }).click()
    await page.locator('.rooms-message-run-source').getByRole('button', { name: 'View Agent session', exact: true }).click()
    await openBrowser()
    await poll(async () => await wrapper().getAttribute('data-state') === 'historical', 15000, 'historical run cannot gain live browser authority')
    assert.equal(await wrapper().locator('[data-browser-use-variant]').count(), 0)
    await poll(async () => !(await browserState(active.threadId)).visible, 15000, 'historical inspection hides the native browser')
    await capture('workspace-13c-historical-session-read-only')
    await wrapper().getByRole('button', { name: 'Show current browser', exact: true }).click()
    await assertLiveBinding(entry.roomId, active)
    await poll(async () => (await browserState(active.threadId)).visible, 15000, 'explicit return to current browser')
    assertions.push('Selecting the historical artifact run is read-only until explicitly returning to the current execution')
    assertions.push('Real browser_use passes protected Kun tool consent and exact-origin consent, then loads only the local fixture in a sandboxed native view')

    await page.locator('.sidebar-agent-chats').getByRole('button', { name: 'New conversation', exact: true }).click()
    await page.getByRole('button', { name: 'Define in chat', exact: true }).click()
    const createdModelRef = await confirmAgentCreationModel({ page, request })
    let other
    await poll(async () => {
      other = (await request(page, '/v1/agents')).agents.find((value) => value.id !== entry.agentId)
      const selected = (await roomWorkbenchSnapshot(page)).conversationRoomId
      return Boolean(other && selected && selected !== entry.roomId)
    }, 15000, 'select another private Agent while the old browser is active')
    assert.deepEqual(other.modelRef, createdModelRef)
    const otherRoomId = (await roomWorkbenchSnapshot(page)).conversationRoomId
    assert(otherRoomId)
    await openBrowser()
    await poll(async () => await wrapper().getAttribute('data-state') === 'idle', 15000, 'second Agent has no live browser')
    assert.equal(await wrapper().getAttribute('data-room-id'), otherRoomId)
    assert.equal(await wrapper().locator('[data-browser-use-variant]').count(), 0)
    await poll(async () => !(await browserState(active.threadId)).visible, 15000, 'old Agent native browser unmounted after switching')
    await capture('workspace-14-other-agent-browser-idle')
    await openSavedFiles()
    await page.locator('.direct-file-list:visible').getByRole('textbox', { name: 'Search saved files', exact: true }).fill('workspace-evidence')
    await page.locator('.direct-file-list:visible').getByText('No files match your search', { exact: true }).waitFor()
    assert.equal(await page.locator('.direct-file-list:visible').getByRole('button', { name: /workspace-evidence/ }).count(), 0)
    await capture('workspace-15-other-agent-files-isolated')
    await openPrivate(firstAgent.name)
    await openBrowser()
    await assertLiveBinding(entry.roomId, active)
    assert.equal(await editor().innerText(), draft)
    await wrapper().getByRole('button', { name: 'Stop', exact: true }).click()
    await poll(async () => (await browserState(active.threadId)).lifecycle === 'stopped', 15000, 'actual Browser Stop')
    assert.equal((await activity(entry.roomId)).execution?.turnId, active.turnId, 'Browser Stop retains the original request control')
    await capture('workspace-15b-browser-stopped')
    await collapseWorkspacePanel(active.threadId)
    await capture('workspace-15c-browser-collapsed-stop-response-visible')
    await page.getByRole('button', { name: 'Stop response', exact: true }).click()
    await poll(async () => {
      const data = await activity(entry.roomId)
      return !data.execution && ['stopping', 'cancelled'].includes(data.requests.find((item) => item.runId === active.runId)?.status)
    }, 15000, 'Stop acknowledged before releasing the model fixture')
    fixture.release()
    await poll(async () => {
      const data = await activity(entry.roomId)
      return !data.active && data.requests.find((item) => item.runId === active.runId)?.status === 'cancelled'
    }, 20000, 'durable response cancellation')
    await openBrowser()
    await poll(async () => ['idle', 'historical'].includes(await wrapper().getAttribute('data-state')), 15000, 'cancelled execution cannot supervise the old browser')
    assert.equal(await wrapper().locator('[data-browser-use-variant]').count(), 0)
    assert.equal((await browserState(active.threadId)).visible, false)
    const stoppedMessages = (await request(page, `/v1/rooms/${entry.roomId}/messages`)).messages
    assert(!stoppedMessages.some((message) => message.originRunId === active.runId && message.deliveryPhase === 'final'),
      'Stopping cannot publish a late final message from the held model response')
    await sidebar.recoveryCapture('workspace-16-stopped-browser-detached', entry.roomId)
    await sidebar.resizeTo(760, 780)
    await sidebar.recoveryCapture('workspace-16b-stopped-recovery-narrow', entry.roomId)
    await sidebar.resizeTo(1360, 900)
    assertions.push('Switching Agent hides the original native view and files; stopping clears live browser authority without losing the draft')

    // A real, admitted response is interrupted by the explicit desktop Runtime
    // restart path. The exact resulting terminal/recovery status is evidence.
    await send('HOLD_RESPONSE WORKSPACE_RESTART Recovery must retain the original request and never automatically resend it.')
    let restarting
    await poll(async () => {
      const data = await activity(entry.roomId)
      if (fixture.holding() && data.execution?.turnId) { restarting = data.execution; return true }
      return false
    }, 20000, 'held request admitted before Runtime restart')
    diagnosticExecution = restarting
    await openBrowser()
    await assertLiveBinding(entry.roomId, restarting)
    assert.notEqual(restarting.turnId, active.turnId, 'Continuous conversation has a fresh turn identity')
    assert.equal(await wrapper().getByRole('button', { name: 'Allow origin once', exact: true }).count(), 0)
    assert.equal((await browserState(restarting.threadId)).visible, false, 'The prior turn browser cannot become visible in a new turn')
    await collapseWorkspacePanel(restarting.threadId)
    await editor().fill(draft)
    await openBrowser()
    await assertLiveBinding(entry.roomId, restarting)
    const beforeRestart = await activity(entry.roomId)
    const callsBeforeRestart = fixture.snapshot().mainCalls
    await capture('workspace-17-before-runtime-restart')
    await restartOwnedRuntime(page, application)
    fixture.release()
    let recovered
    await poll(async () => {
      try {
        const data = await activity(entry.roomId)
        const current = data.requests.find((item) => item.id === restarting.requestId)
        if (current && ['failed', 'cancelled', 'recovery_required'].includes(current.status)) { recovered = current; return true }
      } catch { return false }
      return false
    }, 60000, 'same interrupted request reconciled after actual Runtime restart')
    assert.equal(recovered.runId, restarting.runId)
    assert.equal(recovered.threadId, restarting.threadId)
    assert.equal(recovered.turnId, restarting.turnId)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('[data-workspace-mode-trigger]').first().waitFor()
    await openPrivate(firstAgent.name)
    assert.equal(await editor().innerText(), draft)
    await openBrowser()
    await poll(async () => ['idle', 'historical', 'unavailable'].includes(await wrapper().getAttribute('data-state')), 15000, 'reload cannot reattach recovered browser')
    assert.equal(await wrapper().locator('[data-browser-use-variant]').count(), 0)
    const afterRestart = await activity(entry.roomId)
    assert.deepEqual(afterRestart.requests.map((item) => item.id), beforeRestart.requests.map((item) => item.id))
    assert.equal(fixture.snapshot().mainCalls, callsBeforeRestart, 'Runtime restart and renderer reload must not replay an interrupted request')
    assert(!(await browserState(restarting.threadId)).sessionId, 'Runtime restart destroys transient browser authority')
    await sidebar.recoveryCapture('workspace-18-restart-recovery-no-replay', entry.roomId)
    await sidebar.resizeTo(760, 780)
    await sidebar.recoveryCapture('workspace-18b-restart-recovery-narrow', entry.roomId)
    await sidebar.resizeTo(1360, 900)
    assert.equal(fixture.snapshot().mainCalls, callsBeforeRestart, 'Inspecting recovery controls must not replay the request')
    await openSavedFiles()
    await page.locator('.direct-file-list:visible').getByRole('button', { name: /workspace-evidence\.txt/ }).first().click()
    await poll(async () => (await page.locator('.rooms-content-preview:visible').innerText()).includes('Saved personal workspace artifact v1'), 15000, 'saved artifact survives real restart')
    await capture('workspace-19-restored-artifact-preview')
    assertions.push('Real Runtime restart reconciles the same interrupted request; reload preserves draft/artifact with no browser session or automatic model replay')

    // Leave for the Code project task, then reopen the conversation from the Code sidebar.
    await page.getByRole('button', { name: /^Code sidebar comparison/ }).first().click()
    await poll(async () => (await roomWorkbenchSnapshot(page)).route === 'chat', 15000, 'Code project task selected')
    await sidebarRow(entry.roomId).click()
    await waitForPrivateRoomSurface(page, entry.roomId)
    assert.equal((await roomWorkbenchSnapshot(page)).conversationRoomId, entry.roomId)
    await openBrowser()
    assert.equal(await wrapper().getAttribute('data-room-id'), entry.roomId)
    assert.equal(await wrapper().locator('[data-browser-use-variant]').count(), 0)
    assert.equal(await editor().innerText(), draft)
    await capture('workspace-20-code-private-workspace')
    assertions.push('Reopening the conversation from the Code sidebar exposes the same private workspace without reviving a historical browser')
    sidebar.assertSharedChrome()
    assertions.push('Stopped and restarted recovery actions remain inside their conversation without horizontal overflow at wide and narrow sizes')
    assertions.push('Actual Code and private Agent screenshots share tab-header and rail dimensions; native pointer drags and narrow-window geometry keep private controls unclipped')
    return { codeBaseline, sidebarComparison: sidebar.snapshot(), assertions, roomId: entry.roomId, otherRoomId, artifact, sourceMessageId: source.id, artifactRunId: artifactRun.runId,
      browserExecution: active, restartExecution: restarting, recoveryStatus: recovered.status, approvals,
      website: website.snapshot(), nativeBrowserEvidence,
      fixtureBoundary: { mocked: ['deterministic loopback model responses', 'static loopback browser page', 'one exact native Runtime restart confirmation response'],
        actual: ['Electron renderer/preload/main', 'Manager and Runtime', 'request/run/thread/turn admission',
          'protected tool consent', 'exact-origin browser consent and SSRF policy', 'sandboxed Browser Use WebContentsView',
          'saved artifact publication/search/preview/source', 'Code-mode baseline and private sidebar geometry',
          'native pointer resize and BrowserWindow wide/narrow sizes', 'Runtime restart and renderer reload'] } }
  } catch (error) {
    try {
      const diagnostic = await collectWorkspaceFailureDiagnostics({ page, request, roomId: diagnosticRoomId,
        execution: diagnosticExecution, fixture, website })
      await recordDiagnostic('workspace-failure-diagnostics', diagnostic)
    } catch (diagnosticError) {
      // Preserve the original assertion even when the renderer/runtime has gone.
      process.stderr.write('Workspace diagnostic capture failed: ' + String(diagnosticError?.message ?? diagnosticError) + '\n')
    }
    throw error
  } finally { fixture.release(); await website.close() }
}
// Electron native dialogs are not renderer pages. Stub only this disposable
// application's exact restart question, once; all tool/browser consent is clicked
// through its real existing UI. Never intercept a broad class of approvals.
// Restart can transiently invalidate the inspector's evaluation context on
// macOS. Retry only this read or cleanup, once, while the same Electron owner
// is alive. Never repeat the restart or the native confirmation action.
async function evaluateAfterRestart(application, operation) {
  try { return await application.evaluate(operation) }
  catch (error) {
    const owner = application.process()
    if (!String(error).includes('Execution context was destroyed') ||
      !owner || owner.exitCode !== null || owner.signalCode !== null) throw error
    return application.evaluate(operation)
  }
}
async function assertNativeRestartConsent(application) {
  const calls = await evaluateAfterRestart(application, () => globalThis.__workspaceSmokeRestartDialog.calls)
  assert.equal(calls, 1, 'Native Runtime restart must be confirmed exactly once')
}
async function restartOwnedRuntime(page, application) {
  await application.evaluate(({ dialog }) => {
    const state = { original: dialog.showMessageBox, calls: 0 }
    globalThis.__workspaceSmokeRestartDialog = state
    // The main process words this question in the OS locale, not the renderer language.
    const questions = [
      ['Restart desktop Runtime', 'Stop and restart the Runtime owned by this desktop app?', ['Restart desktop Runtime', 'Cancel']],
      ['重启桌面 Runtime', '停止并重新启动当前桌面应用拥有的 Runtime？', ['重启桌面 Runtime', '取消']]
    ]
    dialog.showMessageBox = async (...args) => {
      const options = args.at(-1)
      if (state.calls === 0 && questions.some(([title, message, buttons]) => options?.title === title &&
        options.message === message && JSON.stringify(options.buttons) === JSON.stringify(buttons))) {
        state.calls++
        dialog.showMessageBox = state.original
        return { response: 0, checkboxChecked: false }
      }
      return state.original.apply(dialog, args)
    }
  })
  try {
    const result = await page.evaluate(() => window.kunGui.restartKunServe())
    assert.equal(result.accepted, true, JSON.stringify(result))
    await assertNativeRestartConsent(application)
  } finally {
    await evaluateAfterRestart(application, ({ dialog }) => {
      const state = globalThis.__workspaceSmokeRestartDialog
      if (state) dialog.showMessageBox = state.original
      delete globalThis.__workspaceSmokeRestartDialog
    })
  }
}
// Selection updates before the Code conversation has loaded and rendered its recipient.
// Clicking the rail during that gap can be lost when the new room resets tabs.
async function waitForPrivateRoomSurface(page, roomId) {
  const surface = page.locator('[data-room-surface="agent-chat"][data-private-chat="true"][data-room-id=' + JSON.stringify(roomId) + ']')
  const ready = { state: 'visible', timeout: 15000 }
  await surface.waitFor(ready)
  await surface.locator('.rooms-composer .rooms-rich-input').waitFor(ready)
  await surface.locator('.rooms-workbench-rail [data-room-tool="browser"]').waitFor(ready)
  return surface
}
// Start by proving the product default, then explicitly select the restricted
// policy needed by this scenario's real approval/consent assertions.
async function prepareWorkspaceApprovalMode({ page, application, request, poll, roomId, capture }) {
  const path = `/v1/rooms/${roomId}/direct/permissions`
  assert.equal((await request(page, path)).mode, 'full-access')
  const picker = page.locator('.room-permission-picker')
  await picker.locator('[data-permission-mode="full-access"]').waitFor()
  await capture('workspace-personal-full-access-default')
  await picker.getByRole('button', { name: 'Tool permission', exact: true }).click()
  const next = application.waitForEvent('window')
  await page.locator('[role="menuitemradio"][data-permission-mode="ask-for-approval"]').click()
  const consent = await next
  const apply = consent.getByRole('button', { name: 'Apply settings', exact: true })
  await apply.waitFor()
  assert(!await consent.evaluate(() => Boolean(window.kunGui)), 'Permission consent stays protected')
  await capture('workspace-select-restricted-consent', consent)
  await apply.click()
  await poll(async () => (await request(page, path)).mode === 'ask-for-approval', 15000, 'explicit restricted policy saved')
  await picker.locator('[data-permission-mode="ask-for-approval"]').waitFor()
}
module.exports = { exercisePersonalAgentWorkspace, startWorkspaceBrowserPage, waitForPrivateRoomSurface, assertNativeRestartConsent, prepareWorkspaceApprovalMode }
