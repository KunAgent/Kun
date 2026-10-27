'use strict'
const assert = require('node:assert/strict')
const { mkdir, writeFile } = require('node:fs/promises')
const { join } = require('node:path')

// Runs inside smoke-development-direct-chat's disposable profile (--work-only):
// the Work spine — space → session → what is open. The home, a session that
// keeps the turn while documents and the library open beside each other,
// importing papers (with dedupe), a background batch interpretation, a
// draft, reopening a session with its tabs, and archive with undo.
async function workSnapshot(page) {
  return page.evaluate(async () => {
    const { useChatStore } = await import('/src/store/chat-store.ts')
    const { useWriteWorkspaceStore } = await import('/src/write/write-workspace-store.ts')
    const { useWorkSessionStore } = await import('/src/write/work-session-store.ts')
    const { writeWorkspaceKey } = await import('/src/write/write-thread-registry.ts')
    const { activePaperViewId } = await import('/src/write/write-editor-layout.ts')
    const chat = useChatStore.getState()
    const write = useWriteWorkspaceStore.getState()
    return {
      route: chat.route,
      activeThreadId: chat.activeThreadId,
      workspaceRoot: write.workspaceRoot,
      workSurface: write.workSurface,
      activeFilePath: write.activeFilePath,
      paperView: activePaperViewId(write.editorLayout),
      tabs: write.editorLayout.groups.flatMap((group) => group.tabs.map((tab) => tab.path ?? tab.boardId ?? tab.view)),
      currentSession: useWorkSessionStore.getState().current[writeWorkspaceKey(write.workspaceRoot)] ?? null,
      stage: document.querySelector('[data-work-stage]')?.getAttribute('data-work-stage') ?? null,
      context: document.querySelector('[data-work-context]')?.getAttribute('data-work-context') ?? null
    }
  })
}

async function switchToWork(page) {
  await page.locator('[role="tab"][data-workspace-mode="write"]').click()
  await page.locator('[data-workspace-mode-trigger][data-workspace-mode="write"]').first().waitFor()
}

/** A one-page PDF with real text, so import, identification and reading work offline. */
function minimalPdf(title, lines) {
  const escape = (value) => value.replace(/[\\()]/g, (char) => `\\${char}`)
  const content = [`BT /F1 20 Tf 72 720 Td (${escape(title)}) Tj ET`,
    ...lines.map((line, index) => `BT /F1 11 Tf 72 ${686 - index * 16} Td (${escape(line)}) Tj ET`)].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let body = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body)
}

async function seedWorkSpace(root) {
  await mkdir(join(root, 'notes'), { recursive: true })
  await mkdir(join(root, 'reports'), { recursive: true })
  await mkdir(join(root, 'inbox'), { recursive: true })
  await writeFile(join(root, 'README.md'), '# Quarterly plan\n\nDraft the plan for the next quarter.\n')
  await writeFile(join(root, 'notes', 'meeting.md'), '# Meeting notes\n\n- Ship the Work sidebar\n- Review papers\n')
  await writeFile(join(root, 'reports', 'summary.md'), '# Summary\n\nKey findings go here.\n')
  const pdfs = [
    join(root, 'inbox', 'action-schemas.pdf'),
    join(root, 'inbox', 'agentless-repair.pdf')
  ]
  await writeFile(pdfs[0], minimalPdf('Action Schemas for Tool-Using Agents', [
    'Abstract. We bind tool schemas to contracts so malformed calls are rejected before execution.',
    'Section 1 introduces the specification; Section 2 evaluates three agent frameworks.'
  ]))
  await writeFile(pdfs[1], minimalPdf('Agentless Repository Repair', [
    'Abstract. A localization and repair pipeline fixes repository issues without an agent loop.',
    'We report results on a benchmark of real GitHub issues.'
  ]))
  return pdfs
}

async function exerciseWorkLayout({ page, poll, capture, recordDiagnostic, resize, workspaceRoot }) {
  const steps = {}
  await resize(1440, 900)
  if (process.argv.includes('--work-code')) {
    await page.waitForTimeout(1500)
    await capture('work-00-code')
  }
  await switchToWork(page)
  await poll(async () => Boolean((await workSnapshot(page)).workspaceRoot), 30_000, 'Work workspace root')
  // The isolated HOME sits under the OS temp root, which the app never treats
  // as a workspace; use a durable folder beside the smoke repository instead.
  const space = join(workspaceRoot, '季度工作')
  const pdfs = await seedWorkSpace(space)
  await page.evaluate(async (root) => {
    const { useWriteWorkspaceStore } = await import('/src/write/write-workspace-store.ts')
    await useWriteWorkspaceStore.getState().addWriteWorkspace(root)
  }, space)
  await poll(async () => (await workSnapshot(page)).workspaceRoot === space, 30_000, 'mounted space')

  // Home: the space switcher, the three sections, the assistant in the center.
  await page.locator('[data-work-home]').waitFor({ timeout: 30_000 })
  for (const section of ['sessions', 'files', 'papers']) await page.locator(`[data-work-section="${section}"]`).waitFor()
  assert.equal(await page.locator('[data-work-space-name]').innerText(), '季度工作')
  steps.home = await workSnapshot(page)
  assert.equal(steps.home.stage, 'conversation')
  await page.waitForTimeout(600)
  await capture('work-01-home')

  // The first send turns the draft into a session of the space.
  await poll(async () => page.evaluate(async () => {
    const { useChatStore } = await import('/src/store/chat-store.ts')
    return useChatStore.getState().runtimeConnection === 'ready'
  }), 60_000, 'runtime ready')
  const composer = page.locator('[data-work-assistant="stage"] textarea').first()
  await composer.fill('CREATE_FILE 根据会议纪要写一份季度总结')
  const send = page.locator('[data-work-assistant="stage"] .ds-composer-primary-action').first()
  await poll(async () => send.isEnabled(), 30_000, 'composer ready to send')
  await send.click()
  try {
    await poll(async () => Boolean((await workSnapshot(page)).activeThreadId), 30_000, 'new Work session')
  } catch (error) {
    await recordDiagnostic('work-send-failure', await workSnapshot(page))
    throw error
  }
  await poll(async () => page.evaluate(async () => {
    const { useChatStore } = await import('/src/store/chat-store.ts')
    const state = useChatStore.getState()
    const thread = state.threads.find((candidate) => candidate.id === state.activeThreadId)
    return !state.busy && state.blocks.length >= 2 && thread?.latestTurnStatus === 'completed'
  }), 60_000, 'assistant reply')
  steps.session = await workSnapshot(page)
  assert.equal(steps.session.currentSession, steps.session.activeThreadId, 'the new session is the current one')
  const sessionId = steps.session.activeThreadId
  await page.locator(`[data-work-session="${sessionId}"]`).waitFor({ timeout: 30_000 })
  await page.waitForTimeout(600)
  await capture('work-02-session')

  // Opening documents never switches the session; they become its context.
  await page.locator('[data-work-directory]').getByText('README.md', { exact: true }).click()
  await poll(async () => (await workSnapshot(page)).stage === 'documents', 15_000, 'documents stage')
  await page.locator('[data-work-context="file"]').waitFor({ timeout: 15_000 })
  steps.document = await workSnapshot(page)
  assert.equal(steps.document.activeThreadId, sessionId, 'session stays while a document opens')
  await page.evaluate(async (root) => {
    const { useWriteWorkspaceStore } = await import('/src/write/write-workspace-store.ts')
    await useWriteWorkspaceStore.getState().openFile(root, root + '/notes/meeting.md')
  }, space)
  await poll(async () => (await workSnapshot(page)).activeFilePath === `${space}/notes/meeting.md`, 15_000, 'second document')
  await page.waitForTimeout(800)
  steps.otherDocument = await workSnapshot(page)
  assert.equal(steps.otherDocument.activeThreadId, sessionId, 'session stays when another document opens')
  await capture('work-03-session-doc')

  // Swap slots: the session takes the main area and the files dock beside it.
  await page.locator('[data-work-swap-slots="session"]').click()
  await poll(async () => (await workSnapshot(page)).stage === 'swapped', 15_000, 'swapped stage')
  await page.locator('.work-side-document').waitFor({ timeout: 15_000 })
  await page.locator('[data-work-context="file"]').waitFor({ timeout: 15_000 })
  const swapBox = await page.evaluate(() => {
    const side = document.querySelector('.work-side-document')?.getBoundingClientRect()
    const main = document.querySelector('[data-work-assistant="stage"]')?.getBoundingClientRect()
    return { sideLeft: side?.left ?? 0, sideWidth: side?.width ?? 0, mainRight: main?.right ?? 0, mainWidth: main?.width ?? 0 }
  })
  assert.ok(swapBox.sideWidth > 300 && swapBox.mainWidth > swapBox.sideWidth, 'session is wider main slot, file is the side slot')
  assert.ok(swapBox.mainRight <= swapBox.sideLeft + 1, 'session sits left of the docked file')
  steps.swapped = await workSnapshot(page)
  assert.equal(steps.swapped.activeThreadId, sessionId, 'swapping keeps the session')
  await page.waitForTimeout(600)
  await capture('work-03b-swapped')
  // Picking a file in the sidebar puts it back in the main slot.
  await page.locator('[data-work-directory]').getByText('README.md', { exact: true }).click()
  await poll(async () => (await workSnapshot(page)).stage === 'documents', 15_000, 'documents stage after file pick')

  // The library is a tab of the space, next to the documents.
  await page.locator('[data-work-nav="library"]').click()
  await poll(async () => (await workSnapshot(page)).paperView === 'library', 15_000, 'library tab')
  steps.library = await workSnapshot(page)
  assert.equal(steps.library.activeThreadId, sessionId, 'session stays when the library opens')
  assert.ok(steps.library.tabs.length >= 3, 'library opens beside the documents')
  assert.equal(steps.library.workSurface, 'docs')
  await page.waitForTimeout(800)
  await capture('work-04-library')

  // Import two PDFs (as a drop would): each is reported, then offered for reading.
  const importPdfs = async () => page.evaluate(async (paths) => {
    const { usePaperImportDraft } = await import('/src/paper/paper-import-draft.ts')
    const { usePaperModeStore } = await import('/src/paper/paper-mode-store.ts')
    usePaperImportDraft.getState().queue(paths)
    usePaperModeStore.getState().setImportDialogOpen(true)
  }, pdfs)
  await importPdfs()
  const summary = page.locator('[data-testid="paper-import-summary"]')
  await summary.waitFor({ timeout: 60_000 })
  steps.importSummary = await summary.innerText()
  assert.match(steps.importSummary, /2/)
  await page.waitForTimeout(400)
  await capture('work-05-import-summary')
  // The same files again are reported as already there.
  await page.keyboard.press('Escape')
  await page.locator('[data-testid="paper-import-dialog"]').waitFor({ state: 'detached', timeout: 10_000 })
  await importPdfs()
  await poll(async () => /2/.test(await summary.innerText().catch(() => '')) &&
    (await page.locator('[data-testid="paper-import-dialog"]').innerText()).includes('已在论文中'), 60_000, 'dedupe report')
  steps.reimportSummary = await summary.innerText()
  await poll(async () => (await page.locator('[data-work-section="papers"] [data-paper-tree-row], [data-work-section="papers"] button').count()) > 2,
    30_000, 'papers listed in the sidebar')

  // Interpret both in the background: the visible session never changes.
  await page.locator('[data-testid="paper-import-interpret"]').click()
  await page.locator('[data-testid="paper-batch-dialog"]').waitFor({ timeout: 10_000 })
  await page.evaluate(async () => {
    const { useChatStore } = await import('/src/store/chat-store.ts')
    const state = useChatStore.getState()
    // A fixed model is required for paper reading; use the configured default.
    if (!state.composerProviderId || !state.composerModel || state.composerModel === 'auto') {
      const group = state.composerModelGroups?.find((candidate) => candidate.modelIds?.length)
      if (group) useChatStore.setState({ composerProviderId: group.providerId, composerModel: group.modelIds[0] })
    }
  })
  await page.locator('[data-testid="paper-batch-consent"]').check()
  await page.waitForTimeout(300)
  await capture('work-06-batch-dialog')
  await page.locator('[data-testid="paper-batch-start"]').click()
  await page.locator('[data-testid="paper-batch-panel"]').waitFor({ timeout: 15_000 })
  await poll(async () => page.evaluate(async () => {
    const { usePaperBatchInterpret } = await import('/src/paper/paper-batch-interpret.ts')
    const job = usePaperBatchInterpret.getState().job
    return Boolean(job && !job.running)
  }), 180_000, 'batch interpretation')
  steps.batch = await page.evaluate(async () => {
    const { usePaperBatchInterpret } = await import('/src/paper/paper-batch-interpret.ts')
    return usePaperBatchInterpret.getState().job
  })
  steps.afterBatch = await workSnapshot(page)
  assert.equal(steps.afterBatch.activeThreadId, sessionId, 'the batch runs in the background')
  assert.ok(steps.batch.items.some((item) => item.status === 'done'), `batch read at least one paper: ${JSON.stringify(steps.batch.items)}`)
  await page.locator('[data-paper-sessions]').first().waitFor({ timeout: 15_000 })
  // Every interpreted paper is a session of the space, listed in the sidebar.
  for (const item of steps.batch.items.filter((entry) => entry.threadId)) {
    await page.locator(`[data-work-session="${item.threadId}"]`).waitFor({ timeout: 15_000 })
  }
  await page.waitForTimeout(600)
  await capture('work-07-batch-done')

  // New session: an empty draft; nothing is created until the first send.
  await page.locator('[data-work-primary-actions] .sidebar-new-task').click()
  await poll(async () => {
    const state = await workSnapshot(page)
    return state.currentSession === '' && !state.activeThreadId
  }, 15_000, 'new session draft')
  await page.locator('[data-work-session-draft]').waitFor({ timeout: 10_000 })
  steps.draft = await workSnapshot(page)
  await page.waitForTimeout(600)
  await capture('work-08-new-session-draft')

  // Reopening the first session brings it back as the current session.
  await page.locator(`[data-work-session="${sessionId}"] .work-session-row`).click()
  await poll(async () => (await workSnapshot(page)).activeThreadId === sessionId, 15_000, 'reopened session')
  steps.reopened = await workSnapshot(page)
  assert.equal(steps.reopened.currentSession, sessionId)
  await page.waitForTimeout(800)
  await capture('work-09-reopened-session')

  // Archiving a session offers Undo, which puts the row back.
  const archivedRow = page.locator(`[data-work-session="${sessionId}"]`)
  await archivedRow.hover()
  await archivedRow.locator('.work-session-menu').click()
  await page.locator('[data-work-session-action="archive"]').click()
  await archivedRow.waitFor({ state: 'detached', timeout: 15_000 })
  const undo = page.locator('[data-work-notice-action]')
  await undo.waitFor({ timeout: 15_000 })
  await capture('work-10-archived-undo')
  await undo.click()
  await archivedRow.waitFor({ timeout: 30_000 })

  // Archived sessions live under Settings → Archives, as in Code.
  await page.locator('[data-work-section="sessions"] .work-section-menu').click()
  await page.locator('[data-work-sessions-action="archives"]').click()
  await poll(async () => page.evaluate(async () => {
    const { useChatStore } = await import('/src/store/chat-store.ts')
    const state = useChatStore.getState()
    return state.route === 'settings' && state.settingsSection === 'archives'
  }), 15_000, 'Settings archives')
  await page.waitForTimeout(1200)
  await capture('work-11-settings-archives')
  await recordDiagnostic('work-layout', { steps })
  return { steps }
}

module.exports = { exerciseWorkLayout, minimalPdf, switchToWork, workSnapshot }
