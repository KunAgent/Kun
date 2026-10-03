import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HarnessDefinitionSchema } from '../contracts/harness.js'
import { DEEPSEEK_HARNESS_DEFINITION } from './deepseek-harness-definition.js'
import { DEEPSEEK_HARNESS_PRIVACY_PATCH, prepareDeepSeekHarnessLaunch } from './deepseek-harness-launch.js'

const dirs: string[] = []
afterEach(async () => { for (const path of dirs.splice(0)) await rm(path, { recursive: true, force: true }) })
async function home() {
  const path = await mkdtemp(join(tmpdir(), 'kun-dsh-test-'))
  dirs.push(path)
  return path
}
const stockManifest = { name: 'dsh-profile-acp', private: true, dependencies: {},
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app'] } } }
async function profile(path: string, manifest: unknown = stockManifest) {
  const directory = join(path, 'profiles', 'acp')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify(manifest))
  await writeFile(join(directory, 'cordis.patch.yml'), '# Default empty user patch\n[]\n')
  return directory
}
function launch(path: string, args = ['--profile', 'acp']) {
  return { harnessId: 'deepseek-harness', command: '/opt/agents/dsh', args, env: { DSH_HOME: path } }
}

describe('DeepSeek Harness Preview', () => {
  it('pins the official agent and honestly declares unsupported ACP features', () => {
    const def = HarnessDefinitionSchema.parse(DEEPSEEK_HARNESS_DEFINITION)
    expect(def.detect?.exactVersion).toBe('0.2.0-rc.2')
    expect(def.availability).toBe('preview')
    expect(def.setup?.install?.[0]?.command).toBe('npm install -g @deepseek-ai/dsh@0.2.0-rc.2')
    expect(def.setup?.login).toBeUndefined()
    expect(def.credentialModes).toEqual(['native-login'])
    expect(def.staticModels).toEqual([])
    for (const key of ['nativeResume', 'fork', 'rewind', 'fsMediated', 'terminalMediated', 'modes', 'nativeCommands', 'userInput'] as const) {
      expect(def.capabilities.statuses[key].supported, key).toBe(false)
    }
    expect(def.capabilities.facts.sandbox).toBe('none')
  })

  it('applies independent upload opt-outs and the final privacy patch', async () => {
    const path = await home()
    await profile(path)
    const prepared = await prepareDeepSeekHarnessLaunch(launch(path), { baseEnv: {} })
    expect(prepared.env).toMatchObject({ DSH_TELEMETRY_DISABLED: '1', DSH_TELEMETRY_MODE: 'DISABLED', DSH_HOME: path })
    expect(prepared.args.slice(0, -2)).toEqual(['--profile', 'acp'])
    expect(prepared.args.at(-2)).toBe('--patch')
    expect(await readFile(prepared.args.at(-1)!, 'utf8')).toBe(DEEPSEEK_HARNESS_PRIVACY_PATCH)
    for (const id of ['session-log-deepseek', 'session-telemetry-otel', 'otel', 'hmr']) {
      expect(DEEPSEEK_HARNESS_PRIVACY_PATCH).toContain(`- id: ${id}\n  disabled: true`)
    }
  })

  it('hardens version detection before it could initialize a profile', async () => {
    const prepared = await prepareDeepSeekHarnessLaunch(launch(await home(), ['--version']), { baseEnv: {} })
    expect(prepared.args[0]).toBe('--version')
    expect(prepared.args.at(-2)).toBe('--patch')
    expect(prepared.env).toHaveProperty('DSH_TELEMETRY_DISABLED', '1')
  })

  it('prevents secret, credential, and alternate-case env from undoing opt-outs', async () => {
    const path = await home()
    const prepared = await prepareDeepSeekHarnessLaunch({ ...launch(path),
      secretEnv: { DSH_TELEMETRY_DISABLED: '', dsh_telemetry_mode: 'FULL' },
      credentialEnv: { DSH_HOME: path, DSH_TELEMETRY_DISABLED: '', DSH_TELEMETRY_MODE: 'FULL' }
    }, { baseEnv: {} })
    for (const env of [prepared.env, prepared.secretEnv, prepared.credentialEnv]) {
      expect(env).toMatchObject({ DSH_HOME: path, DSH_TELEMETRY_DISABLED: '1', DSH_TELEMETRY_MODE: 'DISABLED' })
      expect(env).not.toHaveProperty('dsh_telemetry_mode')
    }
  })

  it('is stable and idempotent for pooled launch identities', async () => {
    const input = launch(await home())
    const first = await prepareDeepSeekHarnessLaunch(input, { baseEnv: {} })
    expect(await prepareDeepSeekHarnessLaunch(first, { baseEnv: {} })).toEqual(first)
    expect(await prepareDeepSeekHarnessLaunch(input, { baseEnv: {} })).toEqual(first)
  })

  it('recognizes Windows/custom dsh paths and leaves other agents unchanged', async () => {
    const other = { command: 'opencode', args: ['acp'], env: {} }
    expect(await prepareDeepSeekHarnessLaunch(other)).toBe(other)
    const result = await prepareDeepSeekHarnessLaunch({ command: 'C:\\agents\\dsh.cmd', args: ['acp'], env: { DSH_HOME: await home() } }, { baseEnv: {} })
    expect(result.args.at(-2)).toBe('--patch')
  })

  it.each([
    { args: ['--profile', 'custom'] }, { args: ['acp', '--patch', 'custom.yml'] },
    { args: ['--profile=acp'] }, { args: ['acp', '--', '--patch', 'hidden.yml'] }
  ])('rejects unreviewed arguments $args', async ({ args }) => {
    await expect(prepareDeepSeekHarnessLaunch(launch(await home(), args), { baseEnv: {} })).rejects.toThrow('stock ACP profile')
  })

  it.each(['profile', 'home'])('rejects a nonempty %s patch before spawn', async (layer) => {
    const path = await home()
    const directory = await profile(path)
    await writeFile(join(layer === 'home' ? path : directory, 'cordis.patch.yml'), '- insert:\n    - id: extra-exporter\n      name: private-plugin\n')
    await expect(prepareDeepSeekHarnessLaunch(launch(path), { baseEnv: {} })).rejects.toThrow('stock ACP profile')
  })

  it('rejects custom bundles, dependencies, and unreviewed manifest configuration', async () => {
    for (const manifest of [
      { ...stockManifest, dependencies: { 'custom-plugin': '1.0.0' } },
      { ...stockManifest, dsh: { profile: { bundles: [...stockManifest.dsh.profile.bundles, 'extra'] } } },
      { ...stockManifest, dsh: { ...stockManifest.dsh, plugins: [] } }
    ]) {
      const path = await home()
      await profile(path, manifest)
      await expect(prepareDeepSeekHarnessLaunch(launch(path), { baseEnv: {} })).rejects.toThrow('stock ACP profile')
    }
  })

  it('rejects malformed, oversized and symlinked config without leaking contents', async () => {
    const path = await home()
    const directory = await profile(path)
    const manifest = join(directory, 'package.json')
    for (const content of ['SECRET-invalid-json', ' '.repeat(65_537)]) {
      await writeFile(manifest, content)
      await expect(prepareDeepSeekHarnessLaunch(launch(path), { baseEnv: {} })).rejects.toThrow('stock ACP profile')
    }
    await rm(manifest)
    const target = join(path, 'other.json')
    await writeFile(target, JSON.stringify(stockManifest))
    await symlink(target, manifest)
    await expect(prepareDeepSeekHarnessLaunch(launch(path), { baseEnv: {} })).rejects.toThrow('stock ACP profile')
  })

  it('rejects profile-local modules and process preloads', async () => {
    const path = await home()
    const directory = await profile(path)
    await mkdir(join(directory, 'node_modules'))
    await expect(prepareDeepSeekHarnessLaunch(launch(path), { baseEnv: {} })).rejects.toThrow('stock ACP profile')
    await rm(join(directory, 'node_modules'), { recursive: true })
    await expect(prepareDeepSeekHarnessLaunch(launch(path), { baseEnv: { NODE_OPTIONS: '--require ./leak.cjs' } })).rejects.toThrow('stock ACP profile')
  })
})
