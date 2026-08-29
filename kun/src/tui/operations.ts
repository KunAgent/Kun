import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, resolve } from 'node:path'
import { ChartSpecV1Schema, chartColumns, chartSpecTextSummary } from '@kun/extension-api'
import { redactSecrets, redactSecretText } from '../config/secret-redaction.js'
import type { TurnItem } from '../contracts/items.js'
import type { ThreadDetail } from './client.js'
import { sanitizeTerminalText } from './layout.js'
import type { OfficialProviderCliCommand } from '../services/official-provider-cli.js'

export function lastAssistantText(thread: ThreadDetail): string | null {
  const item = [...thread.turns]
    .reverse()
    .flatMap((turn) => [...turn.items].reverse())
    .find((candidate): candidate is Extract<TurnItem, { kind: 'assistant_text' }> =>
      candidate.kind === 'assistant_text' && candidate.text.trim().length > 0)
  return item?.text ?? null
}

export function renderThreadMarkdown(thread: ThreadDetail): string {
  const lines = [
    `# ${markdownText(thread.title || 'Kun conversation')}`,
    '',
    `- Thread: \`${markdownCode(thread.id)}\``,
    `- Workspace: \`${markdownCode(thread.workspace)}\``,
    `- Model: \`${markdownCode(thread.model)}\``,
    `- Updated: ${markdownText(thread.updatedAt)}`,
    ''
  ]
  for (const turn of thread.turns) {
    lines.push(`## Turn ${markdownText(turn.id)}`, '')
    for (const item of turn.items) appendItem(lines, item)
  }
  return `${lines.join('\n').trimEnd()}\n`
}

export function resolveThreadExportPath(thread: ThreadDetail, requested?: string): string {
  const explicit = requested?.trim()
  if (explicit) return resolve(explicit)
  const title = slug(thread.title) || 'kun-thread'
  return resolve(`${title}-${thread.id.slice(0, 8)}.md`)
}

export async function writeThreadExport(thread: ThreadDetail, requested?: string): Promise<string> {
  const path = resolveThreadExportPath(thread, requested)
  await writeFile(path, renderThreadMarkdown(thread), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  return path
}

export type ClipboardMethod = 'pbcopy' | 'wl-copy' | 'xclip' | 'xsel' | 'clip.exe'

export async function copyWithSystemClipboard(text: string): Promise<ClipboardMethod | null> {
  const candidates: Array<{ method: ClipboardMethod; command: string; args: string[] }> = process.platform === 'darwin'
    ? [{ method: 'pbcopy', command: 'pbcopy', args: [] }]
    : process.platform === 'win32'
      ? [{ method: 'clip.exe', command: 'clip.exe', args: [] }]
      : [
          { method: 'wl-copy', command: 'wl-copy', args: [] },
          { method: 'xclip', command: 'xclip', args: ['-selection', 'clipboard'] },
          { method: 'xsel', command: 'xsel', args: ['--clipboard', '--input'] }
        ]
  for (const candidate of candidates) {
    if (!await commandAvailable(candidate.command)) continue
    if (await pipeToCommand(candidate.command, candidate.args, text)) return candidate.method
  }
  return null
}

/**
 * OSC52 clipboard request, capped to avoid terminal/transport abuse.
 *
 * tmux consumes bare OSC sequences, so wrap the request in its DCS passthrough
 * and double embedded ESC bytes when the TUI is running inside tmux.
 */
export function osc52ClipboardSequence(
  text: string,
  insideTmux = Boolean(process.env.TMUX)
): string {
  const safe = Buffer.from(text, 'utf8').subarray(0, 100_000)
  const sequence = `\x1b]52;c;${safe.toString('base64')}\x07`
  if (!insideTmux) return sequence
  return `\x1bPtmux;${sequence.replaceAll('\x1b', '\x1b\x1b')}\x1b\\`
}

export async function editTextInExternalEditor(
  initial: string,
  editorSpec = process.env.VISUAL?.trim() || process.env.EDITOR?.trim() || defaultEditor()
): Promise<string> {
  const words = splitEditorCommandLine(editorSpec)
  if (words.length === 0) throw new Error('VISUAL or EDITOR does not contain a command')
  const directory = await mkdtemp(resolve(tmpdir(), 'kun-editor-'))
  const path = resolve(directory, 'prompt.md')
  try {
    await writeFile(path, initial, { encoding: 'utf8', mode: 0o600 })
    const exitCode = await spawnEditor(words[0]!, [...words.slice(1), path])
    if (exitCode !== 0) throw new Error(`${basename(words[0]!)} exited with code ${exitCode}`)
    return await readFile(path, 'utf8')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export async function runInteractiveProviderCli(
  spec: OfficialProviderCliCommand,
  options: {
    cwd?: string
    spawnFn?: typeof spawn
  } = {}
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const spawnFn = options.spawnFn ?? spawn
    let child
    try {
      child = spawnFn(spec.command, spec.args, {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        stdio: 'inherit',
        windowsHide: false,
        env: process.env,
        shell: process.platform === 'win32' && /\.(?:cmd|bat)$/iu.test(spec.command)
      })
    } catch (error) {
      reject(error)
      return
    }
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(
        `${spec.displayName} exited with ${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}`
      ))
    })
  })
}

function appendItem(lines: string[], item: TurnItem): void {
  switch (item.kind) {
    case 'goal_context':
    case 'model_context':
    case 'runtime_context_source':
    case 'interruption_note':
      // Internal model context is intentionally absent from exports.
      break
    case 'user_message':
      lines.push('### You', '', markdownText(item.displayText ?? item.text), '')
      break
    case 'assistant_text':
      lines.push('### Kun', '', markdownText(item.text), '')
      break
    case 'assistant_reasoning':
      lines.push('<details><summary>Reasoning</summary>', '', markdownText(item.text), '', '</details>', '')
      break
    case 'tool_call':
      lines.push(`> Tool call \`${markdownCode(item.toolName)}\` (${item.status}): ${markdownText(item.summary ?? compactJson(item.arguments))}`, '')
      break
    case 'tool_result': {
      const chart = chartFromToolResult(item.toolName, item.output)
      if (chart) {
        lines.push(`> Chart \`${markdownCode(chart.type)}\`: ${markdownText(chartSpecTextSummary(chart))}`, '')
        const fields = chart.columns?.length ? chart.columns.map((column) => column.field) : chartColumns(chart)
        lines.push('| ' + fields.map(markdownTableCell).join(' | ') + ' |')
        lines.push('| ' + fields.map(() => '---').join(' | ') + ' |')
        for (const row of chart.data.slice(0, 50)) {
          lines.push('| ' + fields.map((field) => markdownTableCell(row[field])).join(' | ') + ' |')
        }
        if (chart.data.length > 50) lines.push('', `_${chart.data.length - 50} more rows omitted._`)
        lines.push('')
      } else {
        lines.push(`> Tool result \`${markdownCode(item.toolName)}\`${item.isError ? ' (error)' : ''}`, '', '```text', safeFence(outputText(item.output)), '```', '')
      }
      break
    }
    case 'approval':
      lines.push(`> Approval ${item.status}: ${markdownText(item.summary)}`, '')
      break
    case 'user_input':
      lines.push(`> User input ${item.status}: ${markdownText(item.prompt)}`, '')
      break
    case 'compaction':
      lines.push(`> Compacted ${item.replacedTokens} tokens.`, '')
      break
    case 'review':
      lines.push('### Review', '', markdownText(item.reviewText ?? item.title), '')
      break
    case 'error':
      lines.push('### Error', '', markdownText(item.message), '')
      break
  }
}

function chartFromToolResult(toolName: string, output: unknown) {
  if (toolName.replace(/^mcp__[^_]+__/, '') !== 'render_chart') return null
  let value = output
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return null }
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && 'chart' in value) {
    value = (value as { chart?: unknown }).chart
  }
  const parsed = ChartSpecV1Schema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function markdownTableCell(value: unknown): string {
  return markdownText(value === null || value === undefined ? '' : String(value))
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ')
}

function markdownText(value: string): string {
  return sanitizeTerminalText(redactSecretText(value)).replaceAll('\r', '')
}

function markdownCode(value: string): string {
  return markdownText(value).replaceAll('`', '\\`')
}

function safeFence(value: string): string {
  return markdownText(value).replaceAll('```', '``\u200b`')
}

function outputText(value: unknown): string {
  if (typeof value === 'string') return value
  return compactJson(value)
}

function compactJson(value: unknown): string {
  try { return JSON.stringify(redactSecrets(value), null, 2) } catch { return String(value) }
}

function slug(value: string): string {
  return sanitizeTerminalText(redactSecretText(value)).toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 64)
}

async function commandAvailable(command: string): Promise<boolean> {
  if (command.includes('/') || command.includes('\\')) {
    return access(command, constants.X_OK).then(() => true, () => false)
  }
  const paths = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':').filter(Boolean)
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')
    : ['']
  const suffixes = process.platform === 'win32' && extensions.some((extension) => command.toUpperCase().endsWith(extension.toUpperCase()))
    ? ['']
    : extensions
  for (const root of paths) {
    for (const extension of suffixes) {
      if (await access(resolve(root, `${command}${extension}`), constants.X_OK).then(() => true, () => false)) return true
    }
  }
  return false
}

function pipeToCommand(command: string, args: string[], text: string): Promise<boolean> {
  return new Promise((resolveResult) => {
    let settled = false
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true })
    const timeout = setTimeout(() => {
      child.kill()
      finish(false)
    }, 2_000)
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolveResult(ok)
    }
    child.once('error', () => finish(false))
    child.once('close', (code) => finish(code === 0))
    child.stdin.once('error', () => finish(false))
    child.stdin.end(text)
  })
}

function spawnEditor(command: string, args: string[]): Promise<number> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: false })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (signal) reject(new Error(`editor terminated by ${signal}`))
      else resolveResult(code ?? 1)
    })
  })
}

export function splitEditorCommandLine(
  value: string,
  platform: NodeJS.Platform = process.platform
): string[] {
  const words: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  for (const char of value.trim()) {
    if (escaped) { current += char; escaped = false; continue }
    if (char === '\\' && quote !== "'" && platform !== 'win32') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") { quote = char; continue }
    if (/\s/u.test(char)) {
      if (current) { words.push(current); current = '' }
    } else current += char
  }
  if (escaped) current += '\\'
  if (quote) throw new Error('VISUAL or EDITOR contains an unclosed quote')
  if (current) words.push(current)
  return words
}

function defaultEditor(): string {
  return process.platform === 'win32' ? 'notepad.exe' : 'vi'
}
