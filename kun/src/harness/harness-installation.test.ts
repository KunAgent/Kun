import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { describeHarnessInstallation } from './harness-installation.js'
import { harnessExecutableIdentity } from './harness-executable-identity.js'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
it('distinguishes managed, application-bundled and custom binaries instead of updating the PATH copy', async () => {
  const home = await mkdtemp(join(tmpdir(), 'kun-install-source-')); roots.push(home)
  const classify = async (path: string) => {
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, 'binary')
    return describeHarnessInstallation('codex', { harnessId: 'codex', installed: 'yes', login: 'unknown', version: '1.0.0', checkedAt: '', resolvedCommand: path }, home)
  }
  expect(await classify(join(home, '.kun/agents/codex/versions/1.0.0/codex'))).toMatchObject({ source: 'managed' })
  expect(await classify(join(home, 'ChatGPT.app/Contents/Resources/codex'))).toMatchObject({ source: 'application', owner: 'ChatGPT' })
  expect(await classify(join(home, 'custom/codex'))).toMatchObject({ source: 'custom' })
})
it('detects an in-place upgrade and treats launcher aliases for the same binary as one identity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kun-cli-identity-')); roots.push(dir)
  const path = join(dir, 'agent'), alias = join(dir, 'alias')
  await writeFile(path, 'first'); await symlink(path, alias)
  const old = harnessExecutableIdentity(path)
  expect(harnessExecutableIdentity(alias)).toBe(old)
  await writeFile(path, 'new binary contents')
  expect(harnessExecutableIdentity(path)).not.toBe(old)
})
