import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ColabCliRuntime } from './colab-cli-runtime'

const execute = vi.hoisted(() => vi.fn<(cmd: string, args: string[]) => Promise<{ stdout: string }>>())
vi.mock('node:child_process', async (importOriginal) => {
  const childProcess = await importOriginal<typeof import('node:child_process')>()
  const { promisify } = await import('node:util')
  return { ...childProcess, execFile: Object.assign(vi.fn(), { [promisify.custom]: execute }) }
})

describe('Colab CLI preparation', () => {
  let root: string
  let cli: ColabCliRuntime
  let nextInstall: string | Error

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kun-colab-install-'))
    cli = new ColabCliRuntime(root)
    nextInstall = '3.12.9|0.8.0\n'
    let installedVersions: string | Error = new Error('Package not installed')
    execute.mockReset().mockImplementation(async (cmd, args) => {
      if (cmd === 'uv') {
        if (args[0] === 'venv') {
          await mkdir(dirname(cli.venvPythonPath), { recursive: true })
          await writeFile(cli.venvPythonPath, '')
        }
        if (args[0] === 'pip') installedVersions = nextInstall
        return { stdout: '' }
      }
      expect(cmd).toBe(cli.venvPythonPath)
      if (installedVersions instanceof Error) throw installedVersions
      return { stdout: installedVersions }
    })
  })
  afterEach(() => rm(root, { recursive: true, force: true }))

  it('installs once and reports the verified versions to concurrent callers on the first attempt', async () => {
    const phases: string[] = []
    const [first, second] = await Promise.all([
      cli.ensureInstalled({ onStatusChange: (status) => phases.push(status.state) }),
      cli.ensureInstalled()
    ])
    expect(phases).toEqual(['installing', 'ready'])
    expect(first).toMatchObject({ state: 'ready', pythonVersion: '3.12.9', version: '0.8.0' })
    expect(second).toEqual(first)
    expect(await cli.ensureInstalled()).toEqual(first)
    expect(execute.mock.calls.filter(([, args]) => args[0] === 'pip')).toHaveLength(1)
  })

  it('rechecks the installed version after an upgrade, including during a concurrent availability check', async () => {
    await cli.ensureInstalled()
    nextInstall = '3.12.9|0.8.1'
    const [, result] = await Promise.all([
      cli.ensureInstalled(),
      cli.ensureInstalled({ upgrade: true })
    ])
    expect(execute).toHaveBeenCalledWith('uv', ['pip', 'install', '--python', cli.venvPythonPath, '-U', 'google-colab-cli'], expect.anything())
    expect(result).toMatchObject({ state: 'ready', version: '0.8.1' })
  })

  it('shows the Python verification failure and allows a fresh install attempt', async () => {
    const reason = 'PackageNotFoundError: google-colab-cli'
    nextInstall = Object.assign(new Error('Python exited with code 1'), { stderr: reason })
    expect(await cli.ensureInstalled()).toMatchObject({ state: 'error', message: reason })
    nextInstall = '3.13.1|0.8.0'
    const result = await cli.ensureInstalled()
    expect(result).toMatchObject({ state: 'ready', pythonVersion: '3.13.1' })
    expect(execute.mock.calls.filter(([, args]) => args[0] === 'pip')).toHaveLength(2)
  })
})
