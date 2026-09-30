'use strict'
const assert = require('node:assert/strict')
const { chmod, writeFile } = require('node:fs/promises')
const { join } = require('node:path')

async function writeInstallerFixture(root, devinSource) {
  const target = join(root, 'installed-devin')
  const path = join(root, 'brew')
  await writeFile(path, `#!${process.execPath}
const fs = require('node:fs')
if (process.argv.slice(2).join(' ') !== 'install --cask devin-cli') process.exit(9)
console.log('Downloading the offline Agent fixture...')
const marker = ${JSON.stringify(join(root, 'install-attempt'))}
const count = fs.existsSync(marker) ? Number(fs.readFileSync(marker, 'utf8')) + 1 : 1
fs.writeFileSync(marker, String(count))
if (count === 1) { console.error('Fixture network failure; retry is supported.'); process.exit(2) }
setTimeout(() => {
  fs.copyFileSync(${JSON.stringify(devinSource)}, ${JSON.stringify(target)})
  fs.chmodSync(${JSON.stringify(target)}, 0o755)
  console.log('Offline fixture installed.')
}, count === 2 ? 30000 : 2000)
`)
  await chmod(path, 0o755)
  return target
}

async function runAgentInstallFlow({ page, poll, capture, runtimeRequest }) {
  await page.locator('[data-agent-mode-trigger]').click()
  await page.locator('[data-agent-mode-repair="devin"]').click()
  const card = page.locator('[data-agent-card="devin"]')
  await card.waitFor()
  const install = card.locator('[data-agent-install="devin"]')
  const start = install.locator('[data-agent-install-start]')
  await poll(() => start.isEnabled(), 30_000, 'Host installer plan available')
  await capture('install-1-ready')
  await start.click()
  await poll(async () => (await runtimeRequest(page, '/v1/harnesses/devin/install')).job?.status === 'failed', 30_000, 'Failed installer surfaced')
  await poll(async () => (await install.innerText()).includes('安装失败'), 30_000, 'Failed installation shown in Chinese')
  await capture('install-2-failure')
  await start.click()
  await install.getByRole('button', { name: '取消安装', exact: true }).click()
  await poll(async () => (await runtimeRequest(page, '/v1/harnesses/devin/install')).job?.status === 'cancelled', 30_000, 'Cancelled installer stopped')
  await poll(() => start.isEnabled(), 30_000, 'Cancelled job can be retried')
  await start.click()
  await poll(async () => (await runtimeRequest(page, '/v1/harnesses/devin/install')).job?.status === 'completed', 60_000, 'Installation and command verification completed')
  await poll(async () => (await card.innerText()).includes('已安装'), 30_000, 'Installed state appears without leaving settings')
  const row = await runtimeRequest(page, '/v1/harnesses/devin/probe', 'POST')
  assert.equal(row.status.installed, 'yes')
  assert.equal(row.status.ready, 'yes')
  await poll(async () => await card.locator('[data-agent-connection-summary]').count() > 0, 30_000, 'Final verified command shown in settings')
  const primary = card.locator('[data-agent-action="test"]')
  await primary.waitFor()
  assert.notEqual(await primary.evaluate((button) => getComputedStyle(button).backgroundColor), 'rgba(0, 0, 0, 0)',
    'The primary action must have a visible theme background behind its white text')
  await capture('install-3-completed')
  return ['A missing Agent exposes a one-click host-selected installer in its existing settings card',
    'Installer failure displays a retry action without a system dialog or terminal handoff',
    'Cancel stops an actual owned installer process and allows a later retry',
    'Retry installs a local fixture, verifies its real command and ACP handshake, and refreshes the card']
}
module.exports = { writeInstallerFixture, runAgentInstallFlow }
