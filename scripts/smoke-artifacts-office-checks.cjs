'use strict'

// Scroll checks for the Office viewers inside the artifacts library stage.
// Each viewer must scroll its own pane inside the stage card; navigation must
// never scroll a clipped ancestor that the wheel cannot scroll back.

const assert = require('node:assert/strict')

// Layout-pixel geometry of one scroller relative to the artifact stage.
function measureScroller(locator) {
  return locator.evaluate((node) => {
    const stage = node.closest('[data-artifact-stage]').getBoundingClientRect()
    const box = node.getBoundingClientRect()
    let ancestorScroll = 0
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      ancestorScroll += parent.scrollTop + parent.scrollLeft
    }
    return { clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, scrollTop: Math.round(node.scrollTop),
      clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, scrollLeft: Math.round(node.scrollLeft),
      bottom: Math.round(box.bottom), stageBottom: Math.round(stage.bottom), ancestorScroll }
  })
}

function assertBoundedScroller(geometry, label) {
  assert(geometry.bottom <= geometry.stageBottom, `${label} overflows the stage`)
  assert(geometry.scrollHeight > geometry.clientHeight, `${label} is not a bounded scroller`)
}

async function checkSlideRailScrolling({ page, capture, poll, diagnostics, timeoutMs }) {
  const rail = page.getByRole('navigation', { name: 'Slide thumbnails' })
  await rail.waitFor({ timeout: timeoutMs })
  await poll(async () => (await rail.locator('[data-thumbnail-state="ready"]').count()) > 0, timeoutMs, 'slide thumbnails')
  const measure = () => measureScroller(rail)
  diagnostics.slideRailInitial = await measure()
  await capture('artifacts-9-slides-viewer')
  assertBoundedScroller(diagnostics.slideRailInitial, 'Slide rail')
  await rail.hover()
  await page.mouse.wheel(0, 1200)
  await poll(async () => (await measure()).scrollTop > 0, timeoutMs, 'wheel scrolling the slide rail')
  await rail.getByRole('button', { name: 'Go to slide 16' }).click()
  await page.getByText('Slide 16 of 16').waitFor({ timeout: timeoutMs })
  await page.keyboard.press('Home')
  await page.getByText('Slide 1 of 16').waitFor({ timeout: timeoutMs })
  await poll(async () => (await measure()).scrollTop === 0, timeoutMs, 'rail following the first slide')
  await page.keyboard.press('End')
  await page.getByText('Slide 16 of 16').waitFor({ timeout: timeoutMs })
  await poll(async () => (await measure()).scrollTop > 0, timeoutMs, 'rail following the last slide')
  diagnostics.slideRailAfterNavigation = await measure()
  assert.equal(diagnostics.slideRailAfterNavigation.ancestorScroll, 0, 'Slide navigation scrolled a clipped ancestor')
  await capture('artifacts-10-slides-last')
  return 'The deck viewer scrolls its thumbnail rail by wheel and keeps it in step with slide navigation inside the stage'
}

// Blank scroll range past the content's far edges, in the scroller's own pixels
// (rects are scaled by the app's body zoom; scroll offsets are not).
function trailingSlack(scroller, selector) {
  return scroller.evaluate((node, query) => {
    const box = node.getBoundingClientRect()
    const scale = box.height / node.offsetHeight
    const items = Array.from(node.querySelectorAll(query)).map((item) => item.getBoundingClientRect())
    const bottom = Math.max(...items.map((item) => item.bottom))
    const right = Math.max(...items.map((item) => item.right))
    return { bottom: Math.round(node.scrollHeight - ((bottom - box.top) / scale + node.scrollTop)),
      right: Math.round(node.scrollWidth - ((right - box.left) / scale + node.scrollLeft)) }
  }, selector)
}

async function zoomBy(stage, page, label, steps) {
  for (let step = 0; step < steps; step += 1) await stage.getByRole('button', { name: label }).click()
  await page.waitForTimeout(300)
  return stage.getByRole('button', { name: 'Reset zoom' }).innerText()
}

async function scrollToEnd(scroller, page) {
  await scroller.evaluate((node) => { node.scrollTop = node.scrollHeight; node.scrollLeft = node.scrollWidth })
  await page.waitForTimeout(300)
}

// The artifact chat shows what is selected in the viewer as a chip above its composer.
async function expectSelectionChip(page, poll, timeoutMs, text) {
  const panel = page.locator('[data-artifact-chat-panel="chat"]')
  await poll(async () => (await panel.innerText()).includes(text), timeoutMs, `the chat chip "${text}"`)
}

async function checkDocScrolling({ page, capture, poll, diagnostics, timeoutMs }) {
  const stage = page.locator('[data-artifact-stage="office"]')
  await poll(async () => (await stage.locator('[data-docx-page-wrapper]').count()) >= 1, timeoutMs, 'rendered DOCX pages')
  const scroller = stage.locator('.kun-docx .kun-office-scroll')
  const zoomSelect = stage.locator('.kun-office-toolbar select')
  const summary = () => stage.locator('[aria-label^="Page "]').first().getAttribute('aria-label')
  await poll(async () => (await summary()) === 'Page 1 of 6', timeoutMs, 'the page count')
  diagnostics.docInitial = await measureScroller(scroller)
  await capture('artifacts-11-doc-viewer')
  assertBoundedScroller(diagnostics.docInitial, 'Document pane')
  await scroller.hover()
  await page.mouse.wheel(0, 900)
  await poll(async () => (await summary()) === 'Page 2 of 6', timeoutMs, 'page indicator following the wheel')
  const next = stage.getByRole('button', { name: 'Next page' })
  while (await next.isEnabled()) {
    await next.click()
    await page.waitForTimeout(150)
  }
  await poll(async () => (await summary()) === 'Page 6 of 6', timeoutMs, 'the last page')
  assert.equal((await measureScroller(scroller)).ancestorScroll, 0, 'Page navigation scrolled a clipped ancestor')

  await zoomSelect.selectOption('50')
  await page.waitForTimeout(500)
  await scrollToEnd(scroller, page)
  diagnostics.docZoomedOut = { ...(await measureScroller(scroller)), slack: await trailingSlack(scroller, '[data-docx-page-wrapper]') }
  await capture('artifacts-12-doc-zoomed-out')
  assert(diagnostics.docZoomedOut.scrollHeight < diagnostics.docInitial.scrollHeight * 6, 'Zoomed-out document keeps its full-size scroll range')
  assert(diagnostics.docZoomedOut.slack.bottom < 64, 'Zoomed-out document leaves a blank scroll range below the last page')
  assert.equal(diagnostics.docZoomedOut.scrollWidth, diagnostics.docZoomedOut.clientWidth, 'Zoomed-out document scrolls sideways')

  await zoomSelect.selectOption('200')
  await page.waitForTimeout(500)
  await scroller.evaluate((node) => { node.scrollTop = 0; node.scrollLeft = 0 })
  await page.waitForTimeout(300)
  const pageEdges = () => scroller.evaluate((node) => {
    const box = node.getBoundingClientRect()
    const wrappers = Array.from(node.querySelectorAll('[data-docx-page-wrapper]'))
    const first = wrappers[0].getBoundingClientRect()
    const last = wrappers[wrappers.length - 1].getBoundingClientRect()
    return { left: Math.round(first.left - box.left), right: Math.round(box.right - last.right) }
  })
  diagnostics.docZoomedInStart = { ...(await measureScroller(scroller)), edges: await pageEdges() }
  await scrollToEnd(scroller, page)
  diagnostics.docZoomedInEnd = { ...(await measureScroller(scroller)), edges: await pageEdges() }
  await capture('artifacts-12b-doc-zoomed-in')
  assert(diagnostics.docZoomedInStart.scrollWidth > diagnostics.docZoomedInStart.clientWidth, 'Zoomed-in page cannot scroll sideways')
  assert(diagnostics.docZoomedInStart.edges.left >= 0, 'Zoomed-in page is cut off on the left')
  assert(diagnostics.docZoomedInEnd.edges.right >= 0, 'Zoomed-in page is cut off on the right')
  await zoomSelect.selectOption('automatic')
  await page.waitForTimeout(500)
  await scroller.evaluate((node) => { node.scrollTop = 0; node.scrollLeft = 0 })
  await page.waitForTimeout(300)

  // Dragging over text quotes it into the chat, with the page it came from.
  const paragraph = await stage.locator('[data-docx-source-id]').first().boundingBox()
  assert(paragraph, 'The first paragraph is not on screen')
  await page.mouse.move(paragraph.x + 2, paragraph.y + paragraph.height / 2)
  await page.mouse.down()
  await page.mouse.move(paragraph.x + Math.min(paragraph.width - 4, 220), paragraph.y + paragraph.height / 2, { steps: 6 })
  await page.mouse.up()
  await expectSelectionChip(page, poll, timeoutMs, 'Selected: “Handbook page 1')
  await capture('artifacts-12c-doc-selected')
  return 'The document pane scrolls inside the stage, tracks pages, follows zoom out and in, and quotes selected text into the chat'
}

async function checkSheetScrolling({ page, capture, poll, diagnostics, timeoutMs }) {
  const stage = page.locator('[data-artifact-stage="office"]')
  const grid = stage.locator('[role="grid"]')
  await grid.waitFor({ timeout: timeoutMs })
  await poll(async () => Number(await grid.getAttribute('aria-rowcount')) >= 260, timeoutMs, 'the worksheet rows')
  assert.match((await grid.getAttribute('aria-label')) ?? '', /Compare/, 'The grid is not the Compare worksheet')
  diagnostics.sheetInitial = await measureScroller(grid)
  assertBoundedScroller(diagnostics.sheetInitial, 'Sheet pane')
  await grid.hover()
  await page.mouse.wheel(0, 900)
  await page.mouse.wheel(600, 0)
  await poll(async () => {
    const geometry = await measureScroller(grid)
    return geometry.scrollTop > 0 && geometry.scrollLeft > 0
  }, timeoutMs, 'wheel scrolling the sheet both ways')
  diagnostics.sheetScrolled = await measureScroller(grid)
  await capture('artifacts-13-sheet-scrolled')
  assert.equal(diagnostics.sheetScrolled.ancestorScroll, 0)

  diagnostics.sheetZoomOut = await zoomBy(stage, page, 'Zoom out', 3)
  await scrollToEnd(grid, page)
  diagnostics.sheetZoomedOut = await measureScroller(grid)
  await capture('artifacts-14-sheet-zoomed-out')
  assert(diagnostics.sheetZoomedOut.scrollHeight < diagnostics.sheetInitial.scrollHeight, 'Zoomed-out sheet keeps its full-size scroll range')
  assert(diagnostics.sheetZoomedOut.scrollTop + diagnostics.sheetZoomedOut.clientHeight >= diagnostics.sheetZoomedOut.scrollHeight - 2, 'Zoomed-out sheet cannot reach its last row')
  await stage.getByRole('button', { name: 'Reset zoom' }).click()
  await grid.evaluate((node) => { node.scrollTop = 0; node.scrollLeft = 0 })
  await page.waitForTimeout(300)

  // Clicking a cell quotes its address into the chat; the cells are painted on a canvas.
  const box = await grid.boundingBox()
  assert(box, 'The grid has no box')
  await page.mouse.click(box.x + 140, box.y + 70)
  await expectSelectionChip(page, poll, timeoutMs, 'Selected: Compare!')
  await capture('artifacts-14b-sheet-selected')
  return 'The sheet pane scrolls both ways at any zoom, reaches its last row zoomed out, and quotes a clicked cell into the chat'
}

module.exports = { checkDocScrolling, checkSheetScrolling, checkSlideRailScrolling }
