'use strict'
const assert = require('node:assert/strict')
const { mkdir, writeFile } = require('node:fs/promises')
const { join } = require('node:path')

// Runs inside smoke-development-direct-chat's disposable profile (--work-tab-menu-only):
// the right-click menu of the Work tab strip closes, moves and reorders tabs.
async function documentTabs(page) {
  return page.locator('.work-tab[data-kind="document"] .work-tab-label').allInnerTexts()
}

async function openMenu(page, label) {
  const tab = page.locator('.work-tab[data-kind="document"]', { hasText: label })
  await tab.click({ button: 'right' })
  await page.locator('.work-tab-menu').waitFor({ state: 'visible' })
  return tab
}

async function pick(page, action) {
  await page.locator(`.work-tab-menu [data-action="${action}"]`).click()
  await page.locator('.work-tab-menu').waitFor({ state: 'detached' })
}

async function exerciseWorkTabMenu({ page, poll, capture, resize, workspaceRoot }) {
  await resize(1440, 900)
  await page.locator('[role="tab"][data-workspace-mode="write"]').click()
  await page.locator('[data-work-home]').waitFor({ timeout: 60_000 })
  const space = join(workspaceRoot, 'tab-menu')
  await mkdir(space, { recursive: true })
  const names = ['alpha.md', 'beta.md', 'gamma.md']
  for (const name of names) await writeFile(join(space, name), `# ${name}\n\nTab menu smoke.\n`)
  await page.evaluate(async ({ space, files }) => {
    const { useWriteWorkspaceStore } = await import('/src/write/write-workspace-store.ts')
    await useWriteWorkspaceStore.getState().addWriteWorkspace(space)
    for (const file of files) await useWriteWorkspaceStore.getState().openFile(space, file)
  }, { space, files: names.map((name) => join(space, name)) })
  await poll(async () => (await documentTabs(page)).length === 3, 30_000, 'three document tabs')

  // The menu opens at the pointer, marks its tab, and lists the counts it would close.
  const tab = await openMenu(page, 'beta.md')
  assert.equal(await tab.getAttribute('data-menu-target'), 'true')
  const tabBox = await tab.boundingBox()
  const menuBox = await page.locator('.work-tab-menu').boundingBox()
  assert(menuBox && tabBox && Math.abs(menuBox.x - (tabBox.x + tabBox.width / 2)) < 24, 'menu opens at the pointer')
  assert(menuBox.y >= tabBox.y + tabBox.height / 2, 'menu opens below the pointer')
  assert.equal(await page.locator('.work-tab-menu [data-action="closeRight"] .work-tab-menu-count').innerText(), '1')
  assert.equal(await page.locator('.work-tab-menu [data-action="copyPath"]').count(), 1)
  await page.waitForTimeout(250)
  await capture('work-tab-menu-01-open')
  await page.keyboard.press('Escape')
  await page.locator('.work-tab-menu').waitFor({ state: 'detached' })

  await openMenu(page, 'beta.md')
  await pick(page, 'closeRight')
  assert.deepEqual(await documentTabs(page), ['alpha.md', 'beta.md'])

  await openMenu(page, 'alpha.md')
  assert.equal(await page.locator('.work-tab-menu [data-action="moveLeft"]').isDisabled(), true)
  await pick(page, 'moveRight')
  assert.deepEqual(await documentTabs(page), ['beta.md', 'alpha.md'])

  await openMenu(page, 'alpha.md')
  await pick(page, 'closeOthers')
  await poll(async () => JSON.stringify(await documentTabs(page)) === JSON.stringify(['alpha.md']), 10_000, 'others closed')

  await openMenu(page, 'alpha.md')
  await pick(page, 'closeAll')
  await poll(async () => (await documentTabs(page)).length === 0, 10_000, 'all tabs closed')
  await capture('work-tab-menu-02-closed')
  return { ok: true }
}

module.exports = { exerciseWorkTabMenu }
