import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { format } from 'node:util'

const METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const

/**
 * While the inline renderer owns the terminal, stray console output would be
 * printed into the transcript or tear the composer region. Route it to
 * `<data-dir>/logs/tui.log` instead and restore the console on exit.
 */
export function redirectConsole(dataDir: string): () => void {
  const directory = join(dataDir, 'logs')
  const path = join(directory, 'tui.log')
  try { mkdirSync(directory, { recursive: true, mode: 0o700 }) } catch { /* logging is best effort */ }
  const originals = Object.fromEntries(METHODS.map((method) => [method, console[method]])) as Record<(typeof METHODS)[number], (...args: unknown[]) => void>
  for (const method of METHODS) {
    console[method] = (...args: unknown[]) => {
      try {
        appendFileSync(path, `${new Date().toISOString()} ${method.toUpperCase()} ${format(...args)}\n`, { mode: 0o600 })
      } catch {
        // Never let diagnostics break the terminal UI.
      }
    }
  }
  return () => {
    for (const method of METHODS) console[method] = originals[method]
  }
}
