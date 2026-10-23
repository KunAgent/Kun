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

async function checkDocScrolling({ page, capture, poll, diagnostics, timeoutMs }) {
  const stage = page.locator('[data-artifact-stage="office"]')
  await poll(async () => (await stage.locator('section.docx').count()) >= 6, timeoutMs, 'rendered DOCX pages')
  const scroller = stage.locator('.workspace-docx-preview').locator('xpath=../..')
  const summary = () => stage.locator('[aria-label^="Page "]').first().getAttribute('aria-label')
  const fitZoom = await stage.getByRole('button', { name: 'Reset zoom' }).innerText()
  diagnostics.docInitial = await measureScroller(scroller)
  await capture('artifacts-11-doc-viewer')
  assertBoundedScroller(diagnostics.docInitial, 'Document pane')
  await scroller.hover()
  await page.mouse.wheel(0, 900)
  await poll(async () => (await summary()) === 'Page 2 of 6', timeoutMs, 'page indicator following the wheel')
  const next = stage.getByRole('button', { name: 'Next page' })
  while (await next.isEnabled()) await next.click()
  assert.equal(await summary(), 'Page 6 of 6')
  assert.equal((await measureScroller(scroller)).ancestorScroll, 0, 'Page navigation scrolled a clipped ancestor')

  diagnostics.docZoomOut = await zoomBy(stage, page, 'Zoom out', 3)
  await scrollToEnd(scroller, page)
  diagnostics.docZoomedOut = { ...(await measureScroller(scroller)), slack: await trailingSlack(scroller, 'section.docx') }
  await capture('artifacts-12-doc-zoomed-out')
  assert(diagnostics.docZoomedOut.slack.bottom < 64, 'Zoomed-out document leaves a blank scroll range below the last page')
  assert.equal(diagnostics.docZoomedOut.scrollWidth, diagnostics.docZoomedOut.clientWidth, 'Zoomed-out document scrolls sideways')

  diagnostics.docZoomIn = await zoomBy(stage, page, 'Zoom in', 9)
  await scroller.evaluate((node) => { node.scrollLeft = 0 })
  await page.waitForTimeout(200)
  const pageEdges = () => scroller.evaluate((node) => {
    const box = node.getBoundingClientRect()
    const first = node.querySelector('section.docx').getBoundingClientRect()
    return { left: Math.round(first.left - box.left), right: Math.round(box.right - first.right) }
  })
  diagnostics.docZoomedInStart = { ...(await measureScroller(scroller)), edges: await pageEdges() }
  await scrollToEnd(scroller, page)
  diagnostics.docZoomedInEnd = { ...(await measureScroller(scroller)), edges: await pageEdges() }
  await capture('artifacts-12b-doc-zoomed-in')
  assert(diagnostics.docZoomedInStart.scrollWidth > diagnostics.docZoomedInStart.clientWidth, 'Zoomed-in page cannot scroll sideways')
  assert(diagnostics.docZoomedInStart.edges.left >= 0, 'Zoomed-in page is cut off on the left')
  assert(diagnostics.docZoomedInEnd.edges.right >= 0, 'Zoomed-in page is cut off on the right')
  await stage.getByRole('button', { name: 'Reset zoom' }).click()
  await poll(async () => (await stage.getByRole('button', { name: 'Reset zoom' }).innerText()) === fitZoom, timeoutMs, 'fit zoom restored')
  return 'The document pane scrolls inside the stage, tracks pages, and its scroll range follows zoom out and in'
}

async function checkSheetScrolling({ page, capture, poll, diagnostics, timeoutMs }) {
  const stage = page.locator('[data-artifact-stage="office"]')
  const table = stage.locator('table')
  await table.waitFor({ timeout: timeoutMs })
  const scroller = table.locator('xpath=../..')
  // Gaps between the scroller edge and the frozen header row / row-number column.
  const pinned = () => scroller.evaluate((node) => {
    const box = node.getBoundingClientRect()
    const header = node.querySelector('thead th:nth-child(2)').getBoundingClientRect()
    const rowHeader = node.querySelector('tbody th').getBoundingClientRect()
    return { top: Math.round(header.top - box.top), left: Math.round(rowHeader.left - box.left) }
  })
  diagnostics.sheetInitial = await measureScroller(scroller)
  assertBoundedScroller(diagnostics.sheetInitial, 'Sheet pane')
  await scroller.hover()
  await page.mouse.wheel(0, 900)
  await page.mouse.wheel(600, 0)
  await poll(async () => {
    const geometry = await measureScroller(scroller)
    return geometry.scrollTop > 0 && geometry.scrollLeft > 0
  }, timeoutMs, 'wheel scrolling the sheet both ways')
  diagnostics.sheetScrolled = { ...(await measureScroller(scroller)), pinned: await pinned() }
  await capture('artifacts-13-sheet-scrolled')
  assert.deepEqual(diagnostics.sheetScrolled.pinned, { top: 0, left: 0 }, 'Frozen sheet headers leave a gap at the pane edge')
  assert.equal(diagnostics.sheetScrolled.ancestorScroll, 0)

  diagnostics.sheetZoomOut = await zoomBy(stage, page, 'Zoom out', 3)
  await scrollToEnd(scroller, page)
  diagnostics.sheetZoomedOut = { ...(await measureScroller(scroller)), pinned: await pinned(),
    slack: await trailingSlack(scroller, 'table') }
  await capture('artifacts-14-sheet-zoomed-out')
  const zoomedOut = diagnostics.sheetZoomedOut
  const scrollsSideways = zoomedOut.scrollWidth > zoomedOut.clientWidth
  assert(zoomedOut.slack.bottom <= 20 && (!scrollsSideways || zoomedOut.slack.right <= 20),
    'Zoomed-out sheet leaves a blank scroll range past the table')
  assert.equal(zoomedOut.pinned.top, 0, 'Zoomed-out sheet loses its frozen header row')
  if (scrollsSideways) assert.equal(zoomedOut.pinned.left, 0, 'Zoomed-out sheet loses its frozen row numbers')
  await stage.getByRole('button', { name: 'Reset zoom' }).click()
  return 'The sheet pane scrolls both ways with its header row and row numbers pinned, at any zoom, with no blank range'
}

module.exports = { checkDocScrolling, checkSheetScrolling, checkSlideRailScrolling }
