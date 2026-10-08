'use strict'
const assert = require('node:assert/strict')
const { mkdir, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const { minimalPdf, switchToWork, workSnapshot } = require('./smoke-work-layout.cjs')

// Runs inside smoke-development-direct-chat's disposable profile
// (--work-assistant-only): the Work assistant is Code's Agent plus the open
// document. A paper is open; the composer carries Code's Agent menu
// ("Kun · Work" + external Agents), sending never opens a dialog, the paper
// travels as context, and a reading purpose is one click.
const PAPER_DIR = 'papers/swe-explore'
const PAPER_TITLE = 'SWE-Explore: Benchmarking How Coding Agents Explore Repositories'

async function seedPaperSpace(root) {
  const unit = join(root, PAPER_DIR)
  await mkdir(unit, { recursive: true })
  await writeFile(join(unit, 'paper.pdf'), minimalPdf(PAPER_TITLE, [
    'Abstract. SWE-Explore asks an explorer to return a ranked list of relevant code regions.',
    'Section 4 reports line-level coverage, ranking and context efficiency.'
  ]))
  await writeFile(join(unit, 'paper.md'), `# ${PAPER_TITLE}\n\n<!-- page 1 -->\nSWE-Explore covers 848 issues across 10 languages.\n`)
  await writeFile(join(unit, 'paper.json'), JSON.stringify({
    version: 1, slug: 'swe-explore', title: PAPER_TITLE, authors: ['Shaoqiu Zhang', 'Yuhang Wang'],
    year: '2026', arxivId: '2609.01481', pdfFile: 'paper.pdf', importedAt: '2026-10-09T00:00:00.000Z',
    preprocess: { textStatus: 'ok', figuresStatus: 'none' }
  }, null, 2))
}

async function chatState(page) {
  return page.evaluate(async () => {
    const { useChatStore } = await import('/src/store/chat-store.ts')
    const state = useChatStore.getState()
    const thread = state.threads.find((candidate) => candidate.id === state.activeThreadId)
    const users = state.blocks.filter((block) => block.kind === 'user')
    return {
      activeThreadId: state.activeThreadId,
      busy: state.busy,
      latestTurnStatus: thread?.latestTurnStatus ?? null,
      threadWorkspace: thread?.workspace ?? null,
      users: users.map((block) => ({
        text: block.text,
        contexts: (block.meta?.composerContexts ?? []).map((context) => context.reference)
      }))
    }
  })
}

async function exerciseWorkAssistantAgent({ page, poll, capture, recordDiagnostic, resize, workspaceRoot, fixture }) {
  const steps = {}
  await resize(1440, 900)
  await switchToWork(page)
  await poll(async () => Boolean((await workSnapshot(page)).workspaceRoot), 30_000, 'Work workspace root')
  const space = join(workspaceRoot, '论文空间')
  await seedPaperSpace(space)
  await page.evaluate(async (root) => {
    const { useWriteWorkspaceStore } = await import('/src/write/write-workspace-store.ts')
    await useWriteWorkspaceStore.getState().addWriteWorkspace(root)
  }, space)
  await poll(async () => (await workSnapshot(page)).workspaceRoot === space, 30_000, 'mounted space')
  await poll(async () => page.evaluate(async () => {
    const { useChatStore } = await import('/src/store/chat-store.ts')
    return useChatStore.getState().runtimeConnection === 'ready'
  }), 60_000, 'runtime ready')

  // Open the paper in the reader with the assistant docked beside it.
  await page.evaluate(async ({ root, dir }) => {
    const { useWriteWorkspaceStore } = await import('/src/write/write-workspace-store.ts')
    await useWriteWorkspaceStore.getState().openFile(root, `${root}/${dir}/paper.pdf`)
    useWriteWorkspaceStore.getState().setAssistantOpen(true)
  }, { root: space, dir: PAPER_DIR })
  const panel = page.locator('[data-work-assistant="panel"]').first()
  await panel.waitFor({ timeout: 30_000 })
  await page.locator('[data-work-context="paper"]').waitFor({ timeout: 30_000 })
  await page.locator('[data-paper-reading-purpose-trigger]').first().waitFor({ timeout: 30_000 })

  // The composer is Code's: the Agent menu offers "Kun · Work" and other Agents.
  const trigger = panel.locator('[data-agent-mode-trigger]').first()
  await trigger.waitFor({ timeout: 30_000 })
  steps.trigger = { label: await trigger.innerText(), surface: await trigger.getAttribute('data-task-surface') }
  assert.match(steps.trigger.label, /Kun · Work/)
  assert.equal(steps.trigger.surface, 'write')
  await page.waitForTimeout(800)
  await capture('work-agent-01-paper-panel')
  await trigger.click()
  await page.locator('[data-agent-mode-menu]').waitFor({ timeout: 10_000 })
  assert.equal(await page.locator('[data-agent-mode-option="kun-write"]').getAttribute('aria-checked'), 'true')
  assert.equal(await page.locator('[data-agent-mode-option="kun-code"]').count(), 0)
  await page.waitForTimeout(300)
  await capture('work-agent-02-agent-menu')
  await page.keyboard.press('Escape')
  await page.locator('[data-agent-mode-menu]').waitFor({ state: 'detached', timeout: 10_000 })

  // Sending from the composer with a paper open is an ordinary turn: no
  // dialog, the session lives in the space, the paper is the context.
  const composer = panel.locator('textarea').first()
  const composerModel = () => page.evaluate(async () => {
    const { useChatStore } = await import('/src/store/chat-store.ts')
    const state = useChatStore.getState()
    return { model: state.composerModel, providerId: state.composerProviderId, effort: state.composerReasoningEffort }
  })
  await poll(async () => page.evaluate(async () => {
    const { useChatStore } = await import('/src/store/chat-store.ts')
    const state = useChatStore.getState()
    return state.composerModelCatalogStatus === 'ready' && Boolean(state.composerModel)
  }), 60_000, 'model catalog ready')
  steps.draftModel = await composerModel()
  await composer.fill('基于 paper.md 总结这篇论文的贡献、方法与结果。')
  const send = panel.locator('.ds-composer-primary-action').first()
  await poll(async () => send.isEnabled(), 30_000, 'composer ready to send')
  await send.click()
  await page.waitForTimeout(500)
  assert.equal(await page.locator('[data-testid="paper-reading-dialog"], [role="dialog"][aria-modal="true"]').count(), 0,
    'sending with a paper open opens no dialog')
  try {
    await poll(async () => {
      const state = await chatState(page)
      return Boolean(state.activeThreadId) && !state.busy && state.latestTurnStatus === 'completed' &&
        state.users.some((user) => user.contexts.length > 0)
    }, 90_000, 'paper turn answered with its context')
  } catch (error) {
    await recordDiagnostic('work-agent-send-failure', { snapshot: await workSnapshot(page), chat: await chatState(page) })
    throw error
  }
  steps.paperTurn = await chatState(page)
  assert.equal(steps.paperTurn.threadWorkspace, space, 'the session works in the space')
  // Starting the session keeps the composer's model, and the turn used it.
  steps.sessionModel = await composerModel()
  steps.sessionDiagnostics = await page.evaluate(async () => {
    const { useChatStore } = await import('/src/store/chat-store.ts')
    const helpers = await import('/src/store/chat-store-helpers.ts')
    const state = useChatStore.getState()
    const thread = state.threads.find((candidate) => candidate.id === state.activeThreadId)
    return { stored: helpers.readThreadComposerSelection(state.activeThreadId ?? ''), threadModel: thread?.model,
      threadProvider: thread?.providerId, threadHarness: thread?.harnessId, harness: state.composerHarnessId,
      pickList: state.composerPickList.slice(0, 12), catalog: state.composerModelCatalogStatus,
      groups: state.composerModelGroups.map((group) => ({ id: group.providerId, models: group.modelIds.slice(0, 8) })) }
  })
  await recordDiagnostic('work-agent-session-model', steps.sessionDiagnostics)
  assert.deepEqual(steps.sessionModel, steps.draftModel,
    `the new session keeps the draft model: ${JSON.stringify({ draft: steps.draftModel, session: steps.sessionModel })}`)
  steps.fixtureModels = fixture.snapshot().models
  assert.ok(steps.fixtureModels[steps.draftModel.model], `turn ran on ${steps.draftModel.model}: ${JSON.stringify(steps.fixtureModels)}`)
  const paperContext = steps.paperTurn.users[0].contexts.find((reference) => reference.kind === 'work-reference-paper')
  assert.ok(paperContext, `paper context attached: ${JSON.stringify(steps.paperTurn.users[0].contexts)}`)
  assert.equal(paperContext.unitLocator, PAPER_DIR)
  assert.equal(paperContext.textLocator, `${PAPER_DIR}/paper.md`)
  assert.equal(paperContext.pdfLocator, `${PAPER_DIR}/paper.pdf`)
  await page.waitForTimeout(800)
  await capture('work-agent-03-paper-reply')

  // A reading purpose is one click that asks the same assistant.
  const purposeTrigger = page.locator('[data-paper-reading-purpose-trigger]').first()
  await purposeTrigger.click()
  const purposeMenu = page.locator('[data-paper-reading-purpose-menu]')
  await purposeMenu.waitFor({ timeout: 10_000 })
  // Placement accounts for the shell's UI scale: right below the trigger.
  const triggerBox = await purposeTrigger.boundingBox()
  const menuBox = await purposeMenu.boundingBox()
  steps.purposeMenuPlacement = { trigger: triggerBox, menu: menuBox }
  assert.ok(menuBox.y >= triggerBox.y + triggerBox.height - 1 && menuBox.y <= triggerBox.y + triggerBox.height + 12,
    `purpose menu opens right below its trigger: ${JSON.stringify(steps.purposeMenuPlacement)}`)
  assert.ok(Math.abs(menuBox.x - triggerBox.x) <= 2, `purpose menu aligns with its trigger: ${JSON.stringify(steps.purposeMenuPlacement)}`)
  await page.waitForTimeout(300)
  await capture('work-agent-04-purpose-menu')
  await page.locator('[data-paper-reading-purpose="quick-screen"]').click()
  await poll(async () => {
    const state = await chatState(page)
    return state.users.length >= 2 && !state.busy && state.latestTurnStatus === 'completed'
  }, 90_000, 'purpose turn answered')
  steps.purposeTurn = await chatState(page)
  assert.equal(steps.purposeTurn.activeThreadId, steps.paperTurn.activeThreadId, 'the purpose asks the same session')
  assert.ok(steps.purposeTurn.users.at(-1).text.includes(PAPER_TITLE), 'the purpose prompt names the paper')
  await page.waitForTimeout(800)
  await capture('work-agent-05-purpose-reply')
  await recordDiagnostic('work-assistant-agent', { steps })
  return { steps }
}

module.exports = { exerciseWorkAssistantAgent }
