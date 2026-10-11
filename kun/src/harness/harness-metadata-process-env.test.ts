import { afterEach, expect, it, vi } from 'vitest'
import { spawnCaptured } from './harness-detector.js'

afterEach(() => vi.unstubAllEnvs())

it('keeps host credentials out of metadata subprocesses while retaining explicit native bindings', async () => {
  vi.stubEnv('KUN_RUNTIME_TOKEN', 'runtime-secret')
  vi.stubEnv('OPENAI_API_KEY', 'unrelated-provider-secret')
  vi.stubEnv('WINDSURF_API_KEY', 'inherited-native-secret')
  const result = await spawnCaptured(process.execPath, ['-e',
    'console.log(JSON.stringify({runtime:!!process.env.KUN_RUNTIME_TOKEN,other:!!process.env.OPENAI_API_KEY,native:process.env.WINDSURF_API_KEY=== "selected-native",home:!!process.env.HOME||!!process.env.USERPROFILE}))'
  ], { timeoutMs: 5_000, env: { WINDSURF_API_KEY: 'selected-native' } })
  expect(result.exitCode).toBe(0)
  expect(JSON.parse(result.stdout.trim())).toEqual({ runtime: false, other: false, native: true, home: true })
  expect(result.stdout + result.stderr).not.toContain('secret')
})
