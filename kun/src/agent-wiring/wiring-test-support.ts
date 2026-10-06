import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { AgentWiringService, createWiringContext } from './service.js'
import type { WiringTarget } from './types.js'

/** Isolated home + service for adapter tests. Never touches the real home directory. */
export const ORIGIN = 'http://127.0.0.1:18899'
export const KEY = 'kun-agent.kun_local_secret'

export function wiringTarget(model: string, extra: Partial<WiringTarget> = {}): WiringTarget {
  return {
    origin: ORIGIN, key: KEY, model,
    models: [{ id: 'coding', displayName: 'Daily coding', contextWindow: 200_000, maxOutputTokens: 32_000, reasoning: true, images: true,
      reasoningLevels: ['low', 'high'] }, { id: 'glm-4.6', contextWindow: 128_000 }],
    ...extra
  }
}

export type WiringHarness = {
  home: string
  service: AgentWiringService
  write(path: string, content: string): string
  read(file: string): string
  exists(file: string): boolean
  dispose(): void
}

export function wiringHarness(env: Record<string, string> = {}, platform: NodeJS.Platform = 'darwin'): WiringHarness {
  const home = mkdtempSync(join(tmpdir(), 'kun-adapter-'))
  const service = new AgentWiringService(createWiringContext({ home, env: { PATH: '', ...env }, platform,
    stateFile: join(home, '.kun', 'agent-wiring.json'), which: () => undefined }))
  return {
    home, service,
    write(path, content) {
      const file = join(home, path)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, content)
      return file
    },
    read: (file) => readFileSync(file, 'utf8'),
    exists: (file) => existsSync(file),
    dispose: () => rmSync(home, { recursive: true, force: true })
  }
}
