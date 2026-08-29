import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseServeOptions } from './serve.js'

const tempDirs: string[] = []

async function writeConfig(config: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kun-serve-options-'))
  tempDirs.push(dir)
  const path = join(dir, 'config.json')
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`)
  return path
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('parseServeOptions Fast Context config', () => {
  it('preserves a fixed Fast Context route across cold startup parsing', async () => {
    const configPath = await writeConfig({
      serve: {
        dataDir: '/tmp/kun-serve-fast-context',
        model: 'gpt-5.6-sol'
      },
      fastContext: {
        enabled: true,
        model: 'deepseek-v4-flash',
        providerId: 'opencode-go-2',
        reasoningEffort: 'max',
        fast: false
      }
    })

    const options = parseServeOptions(['--config', configPath])

    expect(options.model).toBe('gpt-5.6-sol')
    expect(options.fastContext).toEqual({
      enabled: true,
      model: 'deepseek-v4-flash',
      providerId: 'opencode-go-2',
      reasoningEffort: 'max',
      fast: false
    })
  })

  it('keeps Fast Context unset when the config follows the main session model', async () => {
    const configPath = await writeConfig({
      serve: {
        dataDir: '/tmp/kun-serve-fast-context-inherit',
        model: 'gpt-5.6-sol'
      }
    })

    const options = parseServeOptions(['--config', configPath])

    expect(options.model).toBe('gpt-5.6-sol')
    expect(options.fastContext).toBeUndefined()
  })
})
