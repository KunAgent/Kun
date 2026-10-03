import { mkdtemp, chmod, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { BUILTIN_HARNESSES } from './builtin-harnesses.js'
import { PiModelProbe } from './pi-model-probe.js'
import type { probePiHandshake } from './pi-handshake-probe.js'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'kun-pi-models-')); dirs.push(dir)
  const command = join(dir, 'pi'); await writeFile(command, '#!/bin/sh\nexit 0\n'); await chmod(command, 0o755)
  const definition = { ...BUILTIN_HARNESSES.find((entry) => entry.id === 'pi')!,
    launch: { command, args: [], env: { PI_CODING_AGENT_DIR: dir } } }
  const probe = vi.fn<typeof probePiHandshake>(async () => ({ ok: true, supported: true, models: ['anthropic/claude-test'] }))
  return { definition, probe, value: new PiModelProbe({ probe }) }
}
it('discovers native models with only prompt-free RPC metadata and caches them by profile', async () => {
  const f = await setup()
  expect(await f.value.probe(f.definition)).toEqual(['anthropic/claude-test'])
  expect(f.probe).toHaveBeenCalledWith(f.definition, f.definition.launch.command, expect.objectContaining({ includeModels: true }))
  expect(f.value.peek(f.definition)).toEqual(['anthropic/claude-test'])
  await writeFile(join(f.definition.launch.env.PI_CODING_AGENT_DIR, 'auth.json'), '{"anthropic":{"type":"api_key","key":"rotated"}}')
  expect(f.value.peek(f.definition)).toBeUndefined()
})
it('does not expose a model list from failed protocol checks', async () => {
  const f = await setup()
  f.probe.mockResolvedValue({ ok: false, supported: true, models: ['untrusted'] })
  expect(await f.value.probe(f.definition)).toEqual([])
  expect(f.value.peek(f.definition)).toBeUndefined()
})
