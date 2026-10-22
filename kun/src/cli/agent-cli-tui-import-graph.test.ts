import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { runAgentCommand } from './agent-cli.js'

// The terminal UI runs on its own Node interpreter because its renderer needs
// node:ffi, so serve, manager, and the non-TUI commands must not pull it into
// the static import graph. A packaged runtime that lost one of the terminal UI
// packages then fails only for `kun tui` instead of every command.
// This mirrors kun/scripts/check-tui-import-graph.mjs against the source tree.
const CLI_ROOT = fileURLToPath(new URL('.', import.meta.url))
const KUN_SOURCE_ROOT = fileURLToPath(new URL('../', import.meta.url))
const TUI_ROOT_PREFIX = join(KUN_SOURCE_ROOT, 'tui') + sep
const STATIC_IMPORT =
  /(?:^|[\n;}])\s*(?:import|export)\s+(?!type\s)(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/gu
const ENTRY_POINTS = [
  { file: 'agent-cli.ts', mustReach: 'server/runtime-factory.ts' },
  { file: 'serve-entry.ts', mustReach: 'server/runtime-factory.ts' }
] as const

function resolveRelativeTarget(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined
  const base = resolve(dirname(fromFile), specifier)
  const candidates = [
    base,
    base.replace(/\.js$/u, '.ts'),
    join(base, 'index.ts')
  ]
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile())
}

function staticImportClosure(entry: string): Set<string> {
  const visited = new Set<string>()
  const pending = [entry]
  while (pending.length > 0) {
    const file = pending.pop()
    if (!file || visited.has(file)) continue
    visited.add(file)
    for (const match of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      const target = resolveRelativeTarget(file, match[1])
      if (target && !visited.has(target)) pending.push(target)
    }
  }
  return visited
}

function capture(): { write(chunk: string): void; text(): string } {
  const chunks: string[] = []
  return {
    write: (chunk) => {
      chunks.push(chunk)
    },
    text: () => chunks.join('')
  }
}

describe('agent CLI terminal UI import graph', () => {
  it('keeps the terminal UI out of the static closure of non-TUI entry points', () => {
    const leaks = ENTRY_POINTS.flatMap(({ file, mustReach }) => {
      const closure = staticImportClosure(join(CLI_ROOT, file))
      // Guard against a resolver that silently walks nothing.
      expect(closure.size).toBeGreaterThan(1)
      expect(closure.has(join(KUN_SOURCE_ROOT, mustReach))).toBe(true)
      return [...closure]
        .filter((reached) => reached.startsWith(TUI_ROOT_PREFIX))
        .map((reached) => `${file} -> ${relative(KUN_SOURCE_ROOT, reached).split(sep).join('/')}`)
    })

    expect(leaks).toEqual([])
  })

  it('dispatches the TUI branch and returns its exit code', async () => {
    const stdout = capture()

    const code = await runAgentCommand('tui', ['--help'], {
      stdout,
      stderr: capture(),
      createRuntime: vi.fn()
    })

    expect(code).toBe(0)
    expect(stdout.text()).toContain('kun [tui options]')
  })

  it('propagates terminal UI option errors unchanged', async () => {
    const stderr = capture()

    const code = await runAgentCommand('tui', ['--not-a-tui-option'], {
      stdout: capture(),
      stderr,
      createRuntime: vi.fn()
    })

    expect(code).toBe(64)
    expect(stderr.text()).toContain('kun tui: unknown option: --not-a-tui-option')
  })
})
