'use strict'
const assert = require('node:assert/strict')
const { mkdir, writeFile } = require('node:fs/promises')
const { join } = require('node:path')

// Runs inside smoke-development-direct-chat's disposable profile (--work-only):
// the Work sidebar's 会话/目录 views, the centered assistant with nothing open,
// a session that stays put while documents open, and the paper library entry.
async function workSnapshot(page) {
  return page.evaluate(async () => {
    const { useChatStore } = await import('/src/store/chat-store.ts')
    const { useWriteWorkspaceStore } = await import('/src/write/write-workspace-store.ts')
    const { useWorkSidebarStore } = await import('/src/write/work-sidebar-store.ts')
    const chat = useChatStore.getState()
    const write = useWriteWorkspaceStore.getState()
    const sidebar = useWorkSidebarStore.getState()
    return {
      route: chat.route,
      activeThreadId: chat.activeThreadId,
      workspaceRoot: write.workspaceRoot,
      workSurface: write.workSurface,
      activeFilePath: write.activeFilePath,
      sidebarView: sidebar.view,
      pin: sidebar.pin,
      stage: document.querySelector('[data-work-stage]')?.getAttribute('data-work-stage') ?? null
    }
  })
}

async function switchToWork(page) {
  await page.locator('[data-workspace-mode-trigger]').first().click()
  await page.locator('[role="menuitemradio"][data-workspace-mode="write"]').click()
  await page.locator('[data-workspace-mode-trigger][data-workspace-mode="write"]').first().waitFor()
}

async function seedWorkSpace(root) {
  await mkdir(join(root, 'notes'), { recursive: true })
  await mkdir(join(root, 'reports'), { recursive: true })
  await writeFile(join(root, 'README.md'), '# Quarterly plan\n\nDraft the plan for the next quarter.\n')
  await writeFile(join(root, 'notes', 'meeting.md'), '# Meeting notes\n\n- Ship the Work sidebar\n- Review papers\n')
  await writeFile(join(root, 'reports', 'summary.md'), '# Summary\n\nKey findings go here.\n')
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
  // as a workspace; use durable folders beside the smoke repository instead.
  const space = join(workspaceRoot, '季度工作')
  const library = join(workspaceRoot, '论文资料')
  await seedWorkSpace(space)
  await mkdir(library, { recursive: true })
  await page.evaluate(async (root) => {
    const { useWriteWorkspaceStore } = await import('/src/write/write-workspace-store.ts')
    await useWriteWorkspaceStore.getState().addWriteWorkspace(root)
  }, space)
  await poll(async () => (await workSnapshot(page)).workspaceRoot === space, 30_000, 'mounted work space')
  const initial = await workSnapshot(page)

  // Default: sessions view, nothing open, assistant fills the center.
  await page.locator('[data-work-sidebar="sessions"]').waitFor()
  await page.locator('[data-work-home]').waitFor({ timeout: 30_000 })
  steps.home = await workSnapshot(page)
  assert.equal(steps.home.sidebarView, 'sessions')
  assert.equal(steps.home.stage, 'conversation')
  await page.waitForTimeout(600)
  await capture('work-01-home')

  // Sending from the home starts a new session in the mounted space.
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
    await recordDiagnostic('work-send-failure', await page.evaluate(async () => {
      const { useChatStore } = await import('/src/store/chat-store.ts')
      const { useWorkSidebarStore } = await import('/src/write/work-sidebar-store.ts')
      const { useWriteWorkspaceStore } = await import('/src/write/write-workspace-store.ts')
      const chat = useChatStore.getState()
      const write = useWriteWorkspaceStore.getState()
      return { error: chat.error, route: chat.route, busy: chat.busy, runtime: chat.runtimeConnection,
        activeThreadId: chat.activeThreadId, input: chat.input, sidebar: useWorkSidebarStore.getState(),
        workspaceRoot: write.workspaceRoot, activeFilePath: write.activeFilePath,
        writeThreads: chat.threads.filter((thread) => thread.agentSurface === 'write').map((thread) => thread.id) }
    }))
    throw error
  }
  if (process.argv.includes('--work-debug')) {
    await page.waitForTimeout(6000)
    await recordDiagnostic('work-debug-after-send', await page.evaluate(async () => {
      const { useChatStore } = await import('/src/store/chat-store.ts')
      const state = useChatStore.getState()
      return { error: state.error, busy: state.busy, activeThreadId: state.activeThreadId, blocks: state.blocks.length,
        input: state.input, thread: state.threads.find((thread) => thread.id === state.activeThreadId) ?? null }
    }))
    await capture('work-debug-after-send')
  }
  await poll(async () => page.evaluate(async () => {
    const { useChatStore } = await import('/src/store/chat-store.ts')
    const state = useChatStore.getState()
    const thread = state.threads.find((candidate) => candidate.id === state.activeThreadId)
    return !state.busy && state.blocks.length >= 2 && thread?.latestTurnStatus === 'completed'
  }), 60_000, 'assistant reply')
  steps.session = await workSnapshot(page)
  assert.equal(steps.session.pin?.threadId, steps.session.activeThreadId)
  await page.locator(`[data-work-session="${steps.session.activeThreadId}"]`).waitFor({ timeout: 30_000 })
  await page.waitForTimeout(600)
  await capture('work-02-session')

  // Opening a document docks the same session to the right (sessions view).
  await page.evaluate(async (root) => {
    const { useWriteWorkspaceStore } = await import('/src/write/write-workspace-store.ts')
    await useWriteWorkspaceStore.getState().openFile(root, root + '/README.md')
  }, initial.workspaceRoot)
  await poll(async () => (await workSnapshot(page)).stage === 'documents', 15_000, 'documents stage')
  await page.waitForTimeout(800)
  steps.sessionDoc = await workSnapshot(page)
  assert.equal(steps.sessionDoc.activeThreadId, steps.session.activeThreadId, 'session stays while a document opens')
  await capture('work-03-session-doc')

  // Files view: switching views keeps the session; the conversation only
  // follows the document once another one opens.
  await page.locator('[data-work-sidebar-view="files"]').click()
  await page.locator('[data-work-directory]').waitFor()
  await page.waitForTimeout(800)
  steps.files = await workSnapshot(page)
  assert.equal(steps.files.activeThreadId, steps.session.activeThreadId, 'view switch keeps the session')
  await capture('work-04-files')
  await page.evaluate(async (root) => {
    const { useWriteWorkspaceStore } = await import('/src/write/write-workspace-store.ts')
    await useWriteWorkspaceStore.getState().openFile(root, root + '/notes/meeting.md')
  }, initial.workspaceRoot)
  await poll(async () => (await workSnapshot(page)).activeThreadId !== steps.session.activeThreadId,
    15_000, 'document-scoped conversation after opening another file')
  await page.waitForTimeout(600)
  steps.filesOtherDoc = await workSnapshot(page)
  assert.equal(steps.filesOtherDoc.pin, null, 'files view releases the pin when the document changes')
  await capture('work-04b-files-other-doc')

  const views = []
  if (process.argv.includes('--work-papers')) {
    const sessionRow = page.locator(`[data-work-session="${steps.session.activeThreadId}"] .work-session-row`)
    const openSessionFromSidebar = async () => {
      await page.locator('[data-work-sidebar-view="sessions"]').click()
      const group = page.locator('[data-work-session-group="space"]').filter({ has: page.locator('.work-session-group-name', { hasText: '季度工作' }) })
      if (!(await sessionRow.count())) await group.locator('.work-session-group-toggle').click()
      await sessionRow.click()
      await poll(async () => (await workSnapshot(page)).workSurface === 'docs', 30_000, 'documents surface again')
    }
    // Picking a library in the directory view mounts it without any mode switch.
    await page.evaluate(async (root) => {
      const { switchPaperLibrary } = await import('/src/paper/paper-mode-actions.ts')
      await switchPaperLibrary(root)
    }, library)
    await poll(async () => (await workSnapshot(page)).workSurface === 'papers', 30_000, 'papers surface')
    await page.waitForTimeout(2000)
    await capture('work-05a-library-files')
    await openSessionFromSidebar()
    await page.locator('[data-work-nav="library"]').click()
    await poll(async () => (await workSnapshot(page)).workSurface === 'papers', 30_000, 'papers surface from nav')
    await page.waitForTimeout(2000)
    await capture('work-05-library')
    steps.library = await workSnapshot(page)
    // Choosing a session of a work space leaves the library again.
    await openSessionFromSidebar()
    await page.waitForTimeout(800)
    steps.reopened = await workSnapshot(page)
    assert.equal(steps.reopened.activeThreadId, steps.session.activeThreadId)
    await capture('work-06-reopened-session')
    views.push('papers')
  }
  // 新建会话 in the sessions view starts a draft: an empty conversation that
  // the first send turns into a session of the mounted space.
  await page.locator('[data-work-sidebar-view="sessions"]').click()
  await page.locator('[data-work-primary-actions] .sidebar-new-task').click()
  await poll(async () => {
    const state = await workSnapshot(page)
    return state.pin?.threadId === '' && !state.activeThreadId
  }, 15_000, 'new session draft')
  await page.waitForTimeout(600)
  steps.draft = await workSnapshot(page)
  await capture('work-07-new-session-draft')
  assert.equal((await workSnapshot(page)).route, 'write')

  // Archiving a session offers Undo, which puts the row back.
  const archivedRow = page.locator(`[data-work-session="${steps.session.activeThreadId}"]`)
  await archivedRow.hover()
  await archivedRow.locator('.work-session-menu').click()
  await page.locator('[data-work-session-action="archive"]').click()
  await archivedRow.waitFor({ state: 'detached', timeout: 15_000 })
  const undo = page.locator('[data-work-notice-action]')
  await undo.waitFor({ timeout: 15_000 })
  await capture('work-08-archived-undo')
  await undo.click()
  await archivedRow.waitFor({ timeout: 30_000 })
  steps.restored = await workSnapshot(page)

  // The header's archive icon leads to Settings → Archives, where Code keeps them too.
  await page.locator('[data-work-sidebar="sessions"] .work-sidebar-head-actions button').nth(1).click()
  await poll(async () => page.evaluate(async () => {
    const { useChatStore } = await import('/src/store/chat-store.ts')
    const state = useChatStore.getState()
    return state.route === 'settings' && state.settingsSection === 'archives'
  }), 15_000, 'Settings archives')
  await page.waitForTimeout(1200)
  await capture('work-09-settings-archives')
  await recordDiagnostic('work-layout', { steps, views })
  return { steps, views }
}

module.exports = { exerciseWorkLayout, switchToWork, workSnapshot }
