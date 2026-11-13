import { afterAll, expect, it } from 'vitest'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shutdownOwnedProcesses } from '../../../../kun/src/process/owned-process'
import { LatexToolchainInstaller } from './toolchain-install'
import { LatexBuildService } from './build'
import { createLatexProject } from './project'

afterAll(async () => { await shutdownOwnedProcesses({ graceMs: 0, timeoutMs: 3000 }) })

it.skipIf(process.env.KUN_TEST_REAL_TINYTEX !== '1')('installs verified TinyTeX and compiles English and Chinese papers without changing system PATH', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'kun-tex-real-install-')))
  let last = ''
  const installer = new LatexToolchainInstaller(join(root, 'Tools with spaces'), { fetch,
    onState: (state) => {
      const progress = `${state.phase} ${Math.floor(state.downloadedBytes / Math.max(1, state.totalBytes) * 10) * 10}%`
      if (progress !== last) { console.info(`TinyTeX: ${progress}`); last = progress }
    } })
  const service = new LatexBuildService(join(root, 'cache'), installer.root)
  try {
    const result = await installer.install()
    expect(result.phase, `${result.error}\n${result.log.slice(-6000)}`).toBe('ready')
    for (const template of ['english', 'chinese'] as const) {
      const project = await createLatexProject({ workspaceRoot: root, name: template, template, autoBuild: false })
      const build = await service.build({ workspaceRoot: root, path: project.mainPath, buildId: template, sourceRevision: 1 })
      expect(build.status, build.log).toBe('succeeded')
      expect(Buffer.from(build.pdf!.dataBase64, 'base64').subarray(0, 5).toString()).toBe('%PDF-')
    }
  } finally {
    installer.stop(); service.stop()
    await rm(root, { recursive: true, force: true })
  }
}, 15 * 60_000)
