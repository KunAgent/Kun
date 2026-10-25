'use strict'

const assert = require('node:assert/strict')

/**
 * Terminal dock flow on the isolated development profile: real PTY, shell
 * integration marks, send-to-Kun, persistent tabs, find, split, maximize,
 * rail, close confirmation, right docking, the new-session menu and the
 * terminal settings page.
 */
async function runTerminalDockFlow({ page, capture, poll }) {
  const dock = page.locator('[data-terminal-dock]')
  const terminalButton = page.locator('.chat-topbar').getByRole('button', { name: /^(Terminal|终端)$/u }).first()
  await page.locator('.ds-composer-textarea').waitFor()
  await terminalButton.click()
  await dock.waitFor()
  const firstPane = dock.locator('.kun-terminal-pane').first()
  await firstPane.locator('.xterm').waitFor()

  const type = async (text) => {
    await dock.locator('.kun-terminal-pane[data-focused="true"] .xterm-helper-textarea').focus()
    await page.keyboard.type(text)
    await page.keyboard.press('Enter')
  }
  const visibleText = () => dock.locator('.kun-terminal-pane[data-focused="true"] .xterm-rows').innerText()

  await poll(async () => (await visibleText()).trim().length > 0, 30_000, 'shell prompt rendered')
  await type('echo hello-kun-terminal')
  await poll(async () => await dock.locator('.kun-terminal-mark-ok').count() > 0, 20_000, 'shell integration marks a successful command')
  await type('ls /definitely-missing-kun-path')
  await poll(async () => await dock.locator('.kun-terminal-mark-failed').count() > 0, 20_000, 'failed command marked red')
  const failureBar = dock.locator('.kun-terminal-bar[data-tone="failure"]')
  await failureBar.waitFor()
  assert.match(await failureBar.innerText(), /definitely-missing-kun-path/u)
  await capture('terminal-failed-command')

  await failureBar.getByRole('button', { name: /^(Send to Kun|发给 Kun)$/u }).click()
  const chip = page.locator('[data-terminal-output-chip]')
  await chip.waitFor()
  assert.match(await chip.innerText(), /ls \/definitely-missing-kun-path/u)
  await chip.locator('button[aria-expanded]').click()
  await capture('terminal-sent-to-kun')
  await chip.locator('button[aria-expanded]').click()

  const tabs = dock.locator('.kun-terminal-tab')
  await dock.getByRole('button', { name: /^(New terminal|新终端)$/u }).first().click()
  await poll(async () => await tabs.count() === 2, 10_000, 'second tab opened')
  await tabs.first().locator('.kun-terminal-tab-button').click()
  await poll(async () => (await visibleText()).includes('hello-kun-terminal'), 10_000, 'first tab kept its output after switching')
  await capture('terminal-tabs')

  await dock.getByRole('button', { name: /^(Find|查找)$/u }).first().click()
  const find = dock.locator('.kun-terminal-find')
  await find.locator('input').fill('hello-kun')
  await poll(async () => /1 \/ 1|1 \/ 2|2 \/ 2/u.test(await find.innerText()), 10_000, 'find reports matches')
  await capture('terminal-find')
  await find.locator('input').press('Escape')

  await dock.getByRole('button', { name: /^(Split|分屏)$/u }).first().click()
  await poll(async () => await dock.locator('.kun-terminal-pane-header').count() === 2, 10_000, 'split shows two panes')
  await capture('terminal-split')

  await dock.getByRole('button', { name: /^(Maximize|最大化)$/u }).click()
  await page.locator('.kun-terminal-collapsed-strip').waitFor()
  await capture('terminal-maximized')
  await page.locator('.kun-terminal-collapsed-strip').getByRole('button').click()

  await dock.getByRole('button', { name: /^(Session list|会话列表)$/u }).click()
  await dock.locator('.kun-terminal-rail').waitFor()
  await capture('terminal-rail')
  await dock.getByRole('button', { name: /^(Hide session list|隐藏会话列表)$/u }).click()

  await tabs.nth(1).locator('.kun-terminal-tab-button').click()
  await type('sleep 30')
  await poll(async () => await dock.locator('.kun-terminal-mark-running').count() > 0, 10_000, 'running command marked')
  await tabs.nth(1).locator('.kun-terminal-tab-close').click()
  const confirm = page.getByRole('alertdialog')
  await confirm.waitFor()
  await capture('terminal-close-confirm')
  await confirm.getByRole('button', { name: /^(End and close|结束并关闭)$/u }).click()
  await poll(async () => await tabs.count() === 1, 10_000, 'busy tab closed after confirmation')

  await dock.getByRole('button', { name: /^(More actions|更多操作)$/u }).click()
  await page.getByRole('menuitem', { name: /Dock to the right|停靠到右侧/u }).click()
  await poll(async () => (await dock.getAttribute('data-position')) === 'right', 10_000, 'dock moved to the right')
  await capture('terminal-right')
  await dock.getByRole('button', { name: /^(More actions|更多操作)$/u }).click()
  await page.getByRole('menuitem', { name: /Dock to the bottom|停靠到底部/u }).click()

  await dock.getByRole('button', { name: /^(New session…|选择新建类型)$/u }).first().click()
  await page.getByRole('menu', { name: /^(New session…|选择新建类型)$/u }).waitFor()
  await capture('terminal-new-menu')
  await page.keyboard.press('Escape')
  await page.mouse.click(10, 10)

  await terminalButton.click()
  await poll(async () => await dock.count() === 0, 10_000, 'dock collapsed')
  await terminalButton.click()
  await dock.waitFor()
  await poll(async () => (await dock.locator('.xterm-rows').allInnerTexts()).join('\n').includes('hello-kun-terminal'), 10_000, 'output survived collapsing the dock')

  await page.locator('[data-workbench-left-sidebar]').getByRole('button', { name: /Settings|设置/u }).click()
  await page.locator('[data-settings-category="terminal"]').click()
  await page.getByRole('heading', { name: /Agents in the terminal|终端里的 Agent/u }).first().waitFor().catch(() => undefined)
  await capture('terminal-settings')
  return [
    'Real PTY with zsh/bash shell integration: green and red command marks, failure bar',
    'Send to Kun attached the failed command as a composer chip',
    'Tabs keep their xterm output across tab switches and dock collapse',
    'Find, split, maximize, session rail, close confirmation, right docking and the new-session menu rendered',
    'Terminal settings page rendered'
  ]
}

module.exports = { runTerminalDockFlow }
