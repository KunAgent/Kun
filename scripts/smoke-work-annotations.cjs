'use strict'

const assert = require('node:assert/strict')
const { join } = require('node:path')
const { mkdir, writeFile, readFile } = require('node:fs/promises')
const { buildSmokeDocx } = require('./smoke-artifacts-office-fixtures.cjs')
const { minimalPdf, switchToWork } = require('./smoke-work-layout.cjs')

async function selectRichText(page, text) {
  await page.locator('.tiptap.write-rich-editor').evaluate((node, text) => {
    const editor = node.editor
    let selection
    editor.state.doc.descendants((child, pos) => {
      if (child.isText && child.text.includes(text)) {
        const from = pos + child.text.indexOf(text)
        selection = { from, to: from + text.length }
      }
    })
    if (!selection) throw new Error('Missing annotation fixture passage')
    editor.chain().focus().setTextSelection(selection).run()
  }, text)
}

async function selectViewerText(page, selector, text) {
  await page.locator(selector).filter({ hasText: text }).first().waitFor()
  await page.evaluate(({ selector, text }) => {
    for (const el of document.querySelectorAll(selector)) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode
        const start = node.textContent.indexOf(text)
        if (start < 0) continue
        const range = new Range()
        range.setStart(node, start)
        range.setEnd(node, start + text.length)
        const selection = getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        return
      }
    }
    throw new Error('Missing viewer text')
  }, { selector, text })
}

/** Exercises real editors, local persistence, Kun HTTP/SSE and an offline model. */
async function exerciseWorkAnnotations({ page, workspaceRoot, fixture, resize, capture, poll }) {
  await resize(1480, 960)
  const root = join(workspaceRoot, 'annotations')
  await mkdir(root, { recursive: true })
  const source = '# 残差连接\n\n这一层会把原始输入加回到函数的输出上。\n\n$$\ny = f(x) + x\n$$\n'
  const md = join(root, 'writing.md'), word = join(root, 'reading.docx'), pdf = join(root, 'paper.pdf')
  await writeFile(md, source)
  const wordBytes = await buildSmokeDocx(['Word excerpt', 'Second page'])
  const pdfBytes = minimalPdf('PDF excerpt', ['This is a local fixture.'])
  await writeFile(word, wordBytes)
  await writeFile(pdf, pdfBytes)
  await switchToWork(page)
  await page.evaluate(async (root) => {
    const { useWriteWorkspaceStore: store } = await import('/src/write/write-workspace-store.ts')
    await store.getState().addWriteWorkspace(root)
    store.setState({ documentEditorV2: true, autoSaveEnabled: false })
  }, root)
  const openFile = async (name) => {
    await page.locator('[data-work-directory]').getByText(name, { exact: true }).first().click()
    await page.locator('.work-annotation-layer').waitFor()
  }
  await openFile('writing.md')
  await selectRichText(page, '原始输入')
  const card = page.locator('.work-annotation-card')
  const addNote = async (text) => {
    await page.locator('[data-selection-action="annotate"]').click()
    await card.locator('textarea').fill(text)
    await card.locator('[type="submit"]').click()
    await card.locator('li').filter({ hasText: text }).waitFor()
  }
  const initialCalls = fixture.snapshot().calls
  await addNote('这一步值得给初学者补一句。')
  await card.locator('header button').last().click()
  await page.locator('.work-annotation-marker').first().click()
  await card.locator('li').filter({ hasText: '这一步值得给初学者补一句。' }).waitFor()
  assert.equal(fixture.snapshot().calls, initialCalls)
  await card.locator('textarea').fill('@Kun 请在这段后面补一句，解释公式中最后一个 x 从哪里来。')
  await card.locator('[type="submit"]').click()
  const preview = card.locator('.work-annotation-action').filter({ hasText: /Preview change|预览修改/ })
  await preview.waitFor({ timeout: 45000 })
  await capture('work-annotation-markdown')
  const current = () => page.evaluate(async () => (await import('/src/write/write-workspace-store.ts')).useWriteWorkspaceStore.getState().fileContent)
  await preview.click()
  assert.equal(await current(), source)
  assert.equal(await readFile(md, 'utf8'), source)
  const review = page.locator('[data-annotation-review]')
  await review.locator('button').first().click()
  assert.equal(await current(), source)
  await preview.click()
  await review.locator('button').last().click()
  await poll(async () => (await current()).includes('公式中最后一个 x 就是这一层的原始输入。'), 5000, 'accepted annotation proposal')
  await page.locator('.tiptap.write-rich-editor').focus()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await poll(async () => (await current()) === source, 5000, 'undo accepted change')

  await openFile('reading.docx')
  await selectViewerText(page, '[data-docx-text-start]', 'Word excerpt')
  await addNote('Word note')
  assert.deepEqual(await readFile(word), wordBytes)
  await capture('work-annotation-word')
  await openFile('paper.pdf')
  await selectViewerText(page, '[data-write-pdf-page] span', 'PDF excerpt')
  await addNote('PDF note')
  assert.deepEqual(await readFile(pdf), Buffer.from(pdfBytes))
  await resize(960, 800)
  await poll(async () => card.evaluate((el) => {
    const pane = el.closest('.work-annotation-pane').getBoundingClientRect()
    const box = el.getBoundingClientRect()
    return box.width > pane.width * 0.9 && pane.bottom - box.bottom < 12 && box.height < pane.height * 0.6
  }), 5000, 'document bottom drawer')
  await capture('work-annotation-narrow')
  await openFile('writing.md')
  await page.locator('.work-annotation-marker').first().click()
  await card.locator('li').filter({ hasText: '这一步值得给初学者补一句。' }).waitFor()
  // Start a new renderer realm and read the same durable records before the
  // shell finishes restoring its unrelated startup services.
  await page.reload({ waitUntil: 'domcontentloaded' })
  const restored = await page.evaluate(async (scope) =>
    (await import('/src/write/work-annotation-storage.ts')).listAnnotations(scope),
  { workspaceRoot: root, filePath: md })
  assert.equal(restored.length, 1)
  assert(restored[0].messages.some((message) => message.suggestion?.kind === 'insertAfter'))
  assert(restored[0].messages.some((message) => message.text === '这一步值得给初学者补一句。'))
  return { markdown: true, word: true, pdf: true, personalNoteModelCalls: 0, review: true, undo: true, reload: true }
}

module.exports = { exerciseWorkAnnotations }
