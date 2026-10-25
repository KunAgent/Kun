'use strict'
const assert = require('node:assert/strict')
const { mkdir, writeFile, readFile } = require('node:fs/promises')
const { join } = require('node:path')

const PASSAGE = '这次更新之后，写作模式里的文档可以直接调用助手。你在正文里选中一段文字，就能让它帮你润色、解释或者重新整理格式，修改的结果会先以修订的方式展示出来，等你确认以后才会真正写进文件。'
const ORIGINAL = '# 选区改写\n\n' + PASSAGE + '\n\n保留 **加粗** 和 [链接](https://example.com)。\n'

async function selectPassage(page, text = PASSAGE) {
  await page.evaluate((text) => {
    const editor = document.querySelector('.tiptap.write-rich-editor')?.editor
    if (!editor) throw new Error('Missing rich editor')
    let range
    editor.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent.includes(text)) {
        const from = pos + 1 + node.textContent.indexOf(text)
        range = { from, to: from + text.length }
        return false
      }
    })
    if (!range) throw new Error('Missing passage')
    editor.commands.setTextSelection(range)
    editor.commands.focus()
  }, text)
  await page.locator('.write-selection-menu').waitFor({ state: 'visible' })
}
async function content(page) {
  return page.evaluate(async () => (await import('/src/write/write-workspace-store.ts')).useWriteWorkspaceStore.getState().fileContent)
}
async function exerciseWorkSelectionMenu({ page, poll, capture, recordDiagnostic, resize, workspaceRoot, fixture }) {
  await resize(1440, 1050)
  await page.locator('[data-workspace-mode-trigger]').first().click()
  await page.locator('[role="menuitemradio"][data-workspace-mode="write"]').click()
  await page.locator('[data-work-home]').waitFor({ timeout: 60000 })
  const space = join(workspaceRoot, 'selection-menu'), file = join(space, 'review.md')
  await mkdir(space, { recursive: true }); await writeFile(file, ORIGINAL)
  await page.evaluate(async ({ space, file }) => {
    const { useWriteWorkspaceStore } = await import('/src/write/write-workspace-store.ts')
    const store = useWriteWorkspaceStore.getState()
    await store.addWriteWorkspace(space)
    useWriteWorkspaceStore.setState({ autoSaveEnabled: false, documentEditorV2: true })
    useWriteWorkspaceStore.getState().setPreviewMode('rich')
  }, { space, file })
  await page.locator('[data-work-directory]').getByText('review.md', { exact: true }).click()
  await page.locator('.tiptap.write-rich-editor').waitFor({ timeout: 60000 })
  await page.evaluate(async () => { const { default: i18n } = await import('/src/i18n.ts'); await i18n.changeLanguage('zh') })
  await selectPassage(page)
  const menu = page.locator('.write-selection-menu')
  const zoom = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.body).zoom) || 1)
  await poll(async () => Math.abs((await menu.boundingBox()).width / zoom - 280) < 1, 5000, 'menu animation and width')
  assert.equal(await menu.locator('.write-selection-menu-format').count(), 6)
  assert.equal(await menu.locator('.write-selection-menu-row.is-skill').count(), 3)
  await capture('selection-menu-light')
  await menu.locator('[aria-haspopup="menu"]').first().click()
  await page.locator('.write-selection-menu-flyout').waitFor()
  assert.equal(await page.locator('.write-selection-menu-flyout [role="menuitemradio"]').count(), 8)
  await capture('selection-block-types'); await page.keyboard.press('Escape')
  await menu.locator('.write-selection-menu-row.is-skill').first().click()
  await page.locator('.write-selection-edit.is-review').waitFor({ timeout: 30_000 })
  assert.equal(await content(page), ORIGINAL)
  assert.equal(await readFile(file, 'utf8'), ORIGINAL)
  assert(await page.locator('.write-diff-word-removed').count() > 0)
  assert(await page.locator('.write-diff-word-added').count() > 0)
  assert.equal(await page.locator('.write-diff-actions').count(), 0)
  await capture('selection-review-light')
  await page.locator('.tiptap.write-rich-editor').focus()
  await page.keyboard.press('Enter')
  await poll(async () => (await content(page)) !== ORIGINAL, 5000, 'accepted selection')
  await recordDiagnostic('selection-before-undo', await page.evaluate(() => ({ focus: document.activeElement?.className, undo: document.querySelector('.tiptap.write-rich-editor')?.editor?.can().undo() })))
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await poll(async () => (await content(page)) === ORIGINAL, 5000, 'single-step undo')
  await selectPassage(page)
  const ask = menu.locator('input')
  await ask.fill('润色这段')
  await capture('selection-menu-typing')
  await ask.press('Enter')
  await page.locator('.write-selection-edit.is-review').waitFor()
  await page.locator('.write-selection-edit-follow-up input').fill('再短一点')
  await page.locator('.write-selection-edit-follow-up input').press('Enter')
  await page.locator('.write-selection-edit.is-review').waitFor()
  assert.equal(await content(page), ORIGINAL)
  await page.locator('.tiptap.write-rich-editor').focus(); await page.keyboard.press('Escape')
  await poll(async () => !(await page.locator('.write-selection-edit').count()), 5000, 'discard')
  assert.equal(await content(page), ORIGINAL)
  await selectPassage(page)
  await menu.locator('input').fill('HOLD_SELECTION 润色')
  await menu.locator('input').press('Enter')
  await poll(async () => fixture.holding(), 10_000, 'held rewrite')
  await capture('selection-generating')
  await page.locator('.write-selection-edit button').click()
  fixture.release()
  await menu.waitFor()
  await page.waitForTimeout(400)
  assert.equal(await content(page), ORIGINAL)
  assert.equal(await page.locator('.write-selection-edit').count(), 0)
  // Theme/palette/zoom are renderer-local during this disposable run.
  for (const [name, theme, palette, ikun, scale] of [
    ['dark', 'dark', 'default', 'off', 1], ['zoom', 'light', 'default', 'off', .82],
    ['parchment', 'light', 'parchment', 'off', 1], ['warm', 'light', 'default', 'on', 1], ['warm-dark', 'dark', 'default', 'on', 1]
  ]) {
    await page.evaluate(({ theme, palette, ikun, scale }) => {
      document.documentElement.dataset.theme = theme; document.documentElement.dataset.colorPalette = palette
      document.documentElement.dataset.ikunMode = ikun; document.body.style.zoom = String(scale)
    }, { theme, palette, ikun, scale })
    await selectPassage(page)
    await capture('selection-menu-' + name)
    if (name === 'warm-dark') await capture('selection-menu-simplified', menu)
  }
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light'; document.documentElement.dataset.ikunMode = 'off'
    document.documentElement.dataset.colorPalette = 'default'; document.body.style.zoom = '1'
  })
  await selectPassage(page)
  await menu.locator('.write-selection-menu-row.is-skill').first().click()
  await page.locator('.write-selection-edit.is-review').waitFor()
  await page.getByRole('button', { name: '对话', exact: true }).click()
  await poll(async () => !(await page.locator('.write-selection-edit').count()), 5000, 'chat handoff')
  assert.equal(await content(page), ORIGINAL)
  assert.equal(await page.evaluate(async () => (await import('/src/write/write-workspace-store.ts')).useWriteWorkspaceStore.getState().assistantOpen), true)
  await capture('selection-chat-handoff')

  // Switching away from a pending review cannot write its baseline into the new file.
  const other = join(space, 'other.md')
  await writeFile(other, '# Other document\n\nUntouched destination.\n')
  await selectPassage(page)
  await menu.locator('.write-selection-menu-row.is-skill').first().click()
  await page.locator('.write-selection-edit.is-review').waitFor()
  await page.evaluate(async ({ space, other }) => (await import('/src/write/write-workspace-store.ts')).useWriteWorkspaceStore.getState().openFile(space, other), { space, other })
  await poll(async () => (await content(page)).includes('Untouched destination.'), 5000, 'switched document')
  assert.equal(await page.locator('.write-selection-edit').count(), 0)
  assert.equal(await page.evaluate(async (file) => (await import('/src/write/write-workspace-store.ts')).useWriteWorkspaceStore.getState().documentsByPath[file]?.reviewActive, file), false)
  await page.evaluate(async ({ space, file }) => {
    const { useWriteWorkspaceStore } = await import('/src/write/write-workspace-store.ts')
    await useWriteWorkspaceStore.getState().openFile(space, file)
    useWriteWorkspaceStore.getState().setPreviewMode('plain')
  }, { space, file })
  await page.locator('.cm-content').waitFor()
  const selectSource = async () => {
    await page.evaluate((text) => {
      const view = document.querySelector('.cm-content')?.cmTile?.root?.view
      if (!view) throw new Error('Missing source editor')
      const from = view.state.doc.toString().indexOf(text)
      view.dispatch({ selection: { anchor: from, head: from + text.length } }); view.focus()
    }, PASSAGE)
    await menu.waitFor()
  }
  await selectSource()
  await menu.locator('.write-selection-menu-row.is-skill').first().click()
  await page.locator('.write-selection-edit.is-review').waitFor()
  assert.equal(await content(page), ORIGINAL)
  assert.equal(await page.locator('.cm-content').getAttribute('contenteditable'), 'false')
  const sourceColors = await page.evaluate(() => {
    const removed = document.querySelector('.cm-deletedChunk'), added = document.querySelector('.cm-changedText')
    return { removedBackground: getComputedStyle(removed).backgroundColor,
      removedImage: getComputedStyle(removed).backgroundImage, addedImage: getComputedStyle(added).backgroundImage }
  })
  assert.equal(sourceColors.removedBackground, 'rgba(0, 0, 0, 0)')
  assert.equal(sourceColors.removedImage, 'none')
  assert.equal(sourceColors.addedImage, 'none')
  await capture('selection-source-review')
  await page.getByRole('button', { name: '接受', exact: true }).click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await poll(async () => (await content(page)) === ORIGINAL, 5000, 'source single-step undo')

  const plain = join(space, 'plain.txt')
  await writeFile(plain, PASSAGE)
  await page.evaluate(async ({ space, plain }) => (await import('/src/write/write-workspace-store.ts')).useWriteWorkspaceStore.getState().openFile(space, plain), { space, plain })
  await page.locator('.cm-content').waitFor()
  await selectSource()
  assert.equal(await menu.locator('.write-selection-menu-format').count(), 0)
  assert.equal(await menu.getByRole('button', { name: '润色', exact: true }).count(), 0)
  assert.equal(await menu.locator('input').getAttribute('placeholder'), '就这段问点什么…')
  await capture('selection-read-only-menu')
  await recordDiagnostic('selection-results', { singleStepUndo: true, rejectionByteExact: true, staleResultDiscarded: true,
    modelCalls: fixture.snapshot().calls, fileUntouchedBeforeAccept: true })
  return { accepted: true, rejected: true, undo: true, stopped: true, followedUp: true, chatHandoff: true, fileSwitch: true, sourceUndo: true, readOnlyMenu: true }
}
module.exports = { exerciseWorkSelectionMenu }
