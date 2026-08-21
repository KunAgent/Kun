import { createInterface } from 'node:readline/promises'
import { stdin as processStdin, stdout as processStdout } from 'node:process'
import { LocalToolHost, buildDefaultLocalTools } from '../adapters/tool/local-tool-host.js'
import { isPublicTurnItem, type TurnItem } from '../contracts/items.js'
import { isPublicRuntimeEvent } from '../contracts/events.js'
import {
  modelCapabilitiesForModel,
  modelContextProfilesFromConfig
} from '../loop/model-context-profile.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import { createKunServeRuntime } from '../server/runtime-factory.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import {
  parseServeOptionsSafe,
  ServeExitCode
} from './serve.js'
import type { ServeOptions } from './cli-options.js'
import { runTuiCommand } from '../tui/index.js'
import { hasFlag, positionals, stringFlag } from './agent-cli-args.js'
import { resolveRunInvocation } from './agent-cli-run-options.js'

export { MAX_RUN_PROMPT_BYTES } from './agent-cli-run-options.js'

type WritableLike = {
  write(chunk: string): unknown
}

export type CliIo = {
  stdin?: NodeJS.ReadableStream
  stdout: WritableLike
  stderr: WritableLike
  env?: Record<string, string | undefined>
  cwd?: () => string
  createRuntime?: (options: ServeOptions) => Promise<ServerRuntime>
}

export const KUN_CLI_USAGE = `kun <command> [options]

Run \`kun\` without a command to open the inline terminal UI.

Commands:
  serve [options]            Start the local HTTP/SSE runtime
  run [options] <prompt>     Run one agent turn without the GUI
  chat [options]             Start a line-oriented terminal chat
  tui [options]              Open the inline terminal UI (same as bare kun)
  runtime <command>          Inspect, stop, or restart the shared runtime
  update [--check|--yes]     Check or update a stable standalone TUI archive
  exec [options] <tool>      List or invoke tools directly
  extension <command>        Create, validate, pack, install, and manage extensions

Common options:
  --config <path>            JSON config file
  --data-dir <path>          Root directory for Kun data
  --workspace <path>         Workspace root for run/chat/exec
  --model <model>            Model id
  --provider-id <id>         Route through a configured or extension model provider
  --account-id <id>          Bind an opaque core-managed provider account
  --approval-policy <p>      on-request | untrusted | never | auto | suggest
  --approval-reviewer <r>    user | agent
  --prompt-file <path|->     Read the run prompt from a UTF-8 file or stdin
  --reasoning-effort <e>     auto | off | low | medium | high | max
  --service-tier <tier>      priority
  --max-steps <n>            Maximum model steps for this run
  --max-wall-time-ms <n>     Maximum wall time for this run
  --max-tool-calls-per-step <n>
                             Maximum tool calls in one model step
  --json                     Emit machine-readable JSON where supported
  --jsonl                    Stream one machine-readable event per line for kun run

Exec options:
  --list-tools               Print available tools
  --args <json>              JSON object passed to the selected tool
`

export type KunCliCommand = 'serve' | 'run' | 'chat' | 'tui' | 'exec' | 'runtime' | 'update' | 'version' | 'help'

export function splitKunCliCommand(argv: readonly string[]): {
  command: KunCliCommand
  args: string[]
  error?: string
} {
  const first = argv[0]
  if (!first) return { command: 'tui', args: [] }
  if (first === '--help' || first === '-h' || first === 'help') {
    return { command: 'help', args: [] }
  }
  if (first === '--version' || first === '-V' || first === 'version') {
    return { command: 'version', args: [] }
  }
  if (
    first === 'serve' ||
    first === 'run' ||
    first === 'chat' ||
    first === 'tui' ||
    first === 'exec' ||
    first === 'runtime' ||
    first === 'update'
  ) {
    return { command: first, args: [...argv.slice(1)] }
  }
  if (first.startsWith('-')) {
    return { command: 'tui', args: [...argv] }
  }
  return { command: 'help', args: [], error: `unknown command: ${first}` }
}

export async function runAgentCommand(
  command: Exclude<KunCliCommand, 'serve' | 'runtime' | 'update' | 'version' | 'help'>,
  argv: readonly string[],
  io: CliIo
): Promise<number> {
  switch (command) {
    case 'run':
      return runOneShot(argv, io)
    case 'chat':
      return runChat(argv, io)
    case 'tui':
      return runTuiCommand(argv, io)
    case 'exec':
      return runExec(argv, io)
  }
}

async function runOneShot(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseSharedOptions(argv, io)
  if (!parsed.ok) return writeParseError(parsed, io, 'kun run')
  const jsonl = hasFlag(argv, 'jsonl')
  if (parsed.json && jsonl) {
    io.stderr.write('kun run: --json and --jsonl are mutually exclusive\n')
    return ServeExitCode.usage
  }
  const invocation = await resolveRunInvocation(argv, parsed.options, io.stdin)
  if (!invocation.ok) {
    return writeRunUsageError(invocation.message, io, invocation.exitCode)
  }
  const prompt = invocation.prompt
  let runtime: ServerRuntime | undefined
  try {
    runtime = await createRuntime(invocation.options, io)
    const thread = await runtime.threadService.create({
      title: stringFlag(argv, ['title']) ?? prompt.slice(0, 80),
      workspace: parsed.workspace,
      model: parsed.options.model,
      ...(parsed.providerId ? { providerId: parsed.providerId } : {}),
      ...(parsed.accountId ? { accountId: parsed.accountId } : {}),
      mode: 'agent',
      approvalPolicy: parsed.options.approvalPolicy,
      sandboxMode: parsed.options.sandboxMode,
      approvalReviewer: parsed.options.approvalReviewer
    })
    if (jsonl) writeJsonLine(io.stdout, { type: 'run_started', threadId: thread.id })
    const turn = await runtime.turnService.startTurn({
      threadId: thread.id,
      request: {
        prompt,
        model: parsed.options.model,
        ...(invocation.reasoningEffort ? { reasoningEffort: invocation.reasoningEffort } : {}),
        ...(invocation.serviceTier ? { serviceTier: invocation.serviceTier } : {}),
        mode: 'agent',
        clientSurface: 'cli',
        disableUserInput: true
      }
    })
    let streamed = false
    const unsubscribe = runtime.eventBus.subscribe(thread.id, (event) => {
      if (jsonl && isPublicRuntimeEvent(event)) {
        writeJsonLine(io.stdout, { type: 'runtime_event', event })
      } else if (!parsed.json && event.kind === 'assistant_text_delta' && event.item.kind === 'assistant_text') {
        streamed = true
        io.stdout.write(event.item.text)
      }
    })
    const status = await runtime.runTurn(thread.id, turn.turnId)
    unsubscribe?.()
    const items = await runtime.sessionStore.loadItems(thread.id)
    if (jsonl) {
      writeJsonLine(io.stdout, { type: 'run_finished', threadId: thread.id, turnId: turn.turnId, status })
    } else if (parsed.json) {
      io.stdout.write(JSON.stringify({
        threadId: thread.id,
        turnId: turn.turnId,
        status,
        items: items.filter(isPublicTurnItem)
      }) + '\n')
    } else {
      if (!streamed) {
        const text = assistantText(items)
        if (text) io.stdout.write(text)
      }
      io.stdout.write('\n')
    }
    return status === 'completed' ? ServeExitCode.ok : ServeExitCode.runtime
  } catch (error) {
    io.stderr.write(`kun run: ${errorMessage(error)}\n`)
    return ServeExitCode.runtime
  } finally {
    await shutdownRuntime(runtime, io, 'kun run')
  }
}

function writeRunUsageError(
  message: string,
  io: CliIo,
  exitCode: number = ServeExitCode.usage
): number {
  io.stderr.write(`kun run: ${message}\n`)
  return exitCode
}

function writeJsonLine(output: WritableLike, value: unknown): void {
  output.write(`${JSON.stringify(value)}\n`)
}

async function runChat(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseSharedOptions(argv, io)
  if (!parsed.ok) return writeParseError(parsed, io, 'kun chat')
  let runtime: ServerRuntime | undefined
  try {
    runtime = await createRuntime(parsed.options, io)
    const thread = await runtime.threadService.create({
      title: stringFlag(argv, ['title']) ?? 'CLI chat',
      workspace: parsed.workspace,
      model: parsed.options.model,
      ...(parsed.providerId ? { providerId: parsed.providerId } : {}),
      ...(parsed.accountId ? { accountId: parsed.accountId } : {}),
      mode: 'agent',
      approvalPolicy: parsed.options.approvalPolicy,
      sandboxMode: parsed.options.sandboxMode,
      approvalReviewer: parsed.options.approvalReviewer
    })
    const input = io.stdin ?? processStdin
    const terminal = isTtyInput(input)
    const rl = createInterface({
      input,
      ...(terminal ? { output: processStdout } : {}),
      terminal
    })
    try {
      if (terminal) {
        for (;;) {
          let prompt: string
          try {
            prompt = await rl.question('> ')
          } catch (error) {
            if (isReadlineClosedError(error)) break
            throw error
          }
          if (!await runChatTurn({ runtime, threadId: thread.id, prompt, model: parsed.options.model, io })) {
            break
          }
        }
      } else {
        for await (const prompt of rl) {
          if (!await runChatTurn({ runtime, threadId: thread.id, prompt, model: parsed.options.model, io })) {
            break
          }
        }
      }
    } finally {
      rl.close()
    }
    return ServeExitCode.ok
  } catch (error) {
    io.stderr.write(`kun chat: ${errorMessage(error)}\n`)
    return ServeExitCode.runtime
  } finally {
    await shutdownRuntime(runtime, io, 'kun chat')
  }
}

async function runChatTurn(input: {
  runtime: ServerRuntime
  threadId: string
  prompt: string
  model: string
  io: CliIo
}): Promise<boolean> {
  const prompt = input.prompt.trim()
  if (!prompt || prompt === '/exit' || prompt === '/quit') return false
  const turn = await input.runtime.turnService.startTurn({
    threadId: input.threadId,
    request: {
      prompt,
      model: input.model,
      mode: 'agent',
      clientSurface: 'cli',
      disableUserInput: true
    }
  })
  let streamed = false
  const unsubscribe = input.runtime.eventBus.subscribe(input.threadId, (event) => {
    if (event.turnId !== turn.turnId) return
    if (event.kind === 'assistant_text_delta' && event.item.kind === 'assistant_text') {
      streamed = true
      input.io.stdout.write(event.item.text)
    }
  })
  await input.runtime.runTurn(input.threadId, turn.turnId)
  unsubscribe()
  if (!streamed) {
    input.io.stdout.write(assistantText(await input.runtime.sessionStore.loadItems(input.threadId)))
  }
  input.io.stdout.write('\n')
  return true
}

async function runExec(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseSharedOptions(argv, io)
  if (!parsed.ok) return writeParseError(parsed, io, 'kun exec')
  let runtime: ServerRuntime | undefined
  try {
    runtime = await createRuntime(parsed.options, io)
  } catch (error) {
    io.stderr.write(`kun exec: ${errorMessage(error)}\n`)
    return ServeExitCode.runtime
  }
  const host = runtime.toolHost ?? new LocalToolHost({ tools: buildDefaultLocalTools() })
  const context = buildExecContext(parsed.options, parsed.workspace)
  const json = parsed.json
  try {
    if (hasFlag(argv, 'list-tools')) {
      const tools = await host.listTools(context)
      io.stdout.write(json ? `${JSON.stringify({ tools })}\n` : `${tools.map((tool) => tool.name).join('\n')}\n`)
      return ServeExitCode.ok
    }
    const [toolName] = positionals(argv)
    if (!toolName) {
      io.stderr.write('kun exec: missing tool name (use --list-tools to inspect tools)\n')
      return ServeExitCode.usage
    }
    const argsText = stringFlag(argv, ['args']) ?? '{}'
    const args = parseJsonObject(argsText)
    if (!args.ok) {
      io.stderr.write(`kun exec: ${args.message}\n`)
      return ServeExitCode.config
    }
    const result = await host.execute({
      callId: `cli_${Date.now().toString(36)}`,
      toolName,
      arguments: args.value
    }, context)
    if (json) {
      io.stdout.write(JSON.stringify(result.item) + '\n')
    } else if (result.item.kind === 'tool_result') {
      io.stdout.write(`${formatToolOutput(result.item.output)}\n`)
    } else {
      io.stdout.write(`${JSON.stringify(result.item, null, 2)}\n`)
    }
    return result.item.kind === 'tool_result' && result.item.isError ? ServeExitCode.runtime : ServeExitCode.ok
  } catch (error) {
    io.stderr.write(`kun exec: ${errorMessage(error)}\n`)
    return ServeExitCode.runtime
  } finally {
    await shutdownRuntime(runtime, io, 'kun exec')
  }
}

type SharedOptionsResult =
  | {
      ok: true
      options: ServeOptions
      workspace: string
      providerId?: string
      accountId?: string
      json: boolean
    }
  | { ok: false; exitCode: number; message: string; issues?: unknown }

function parseSharedOptions(argv: readonly string[], io: CliIo): SharedOptionsResult {
  const parsed = parseServeOptionsSafe(argv, io.env ?? {})
  if (!parsed.ok) return parsed
  return {
    ok: true,
    options: parsed.options,
    workspace: stringFlag(argv, ['workspace']) ?? io.env?.KUN_WORKSPACE ?? io.cwd?.() ?? process.cwd(),
    ...(stringFlag(argv, ['provider-id'])?.trim()
      ? { providerId: stringFlag(argv, ['provider-id'])!.trim() }
      : {}),
    ...(stringFlag(argv, ['account-id'])?.trim()
      ? { accountId: stringFlag(argv, ['account-id'])!.trim() }
      : {}),
    json: hasFlag(argv, 'json')
  }
}

function createRuntime(options: ServeOptions, io: CliIo): Promise<ServerRuntime> {
  return io.createRuntime ? io.createRuntime(options) : createKunServeRuntime(options)
}

async function shutdownRuntime(
  runtime: ServerRuntime | undefined,
  io: CliIo,
  label: string
): Promise<void> {
  if (!runtime?.shutdown) return
  try {
    await runtime.shutdown()
  } catch (error) {
    io.stderr.write(`${label}: shutdown failed: ${errorMessage(error)}\n`)
  }
}

function buildExecContext(options: ServeOptions, workspace: string): ToolHostContext {
  const modelProfiles = modelContextProfilesFromConfig({
    contextCompaction: options.contextCompaction,
    models: options.models
  })
  return {
    threadId: 'cli_exec',
    turnId: 'cli_exec',
    workspace,
    clientSurface: 'cli',
    threadMode: 'agent',
    model: modelCapabilitiesForModel(options.model, modelProfiles),
    memoryPolicy: { enabled: false },
    delegationPolicy: { enabled: false },
    approvalPolicy: options.approvalPolicy,
    sandboxMode: options.sandboxMode,
    approvalReviewer: options.approvalReviewer,
    abortSignal: new AbortController().signal,
    awaitApproval: async () => (options.approvalPolicy === 'auto' ? 'allow' : 'deny')
  }
}

function writeParseError(
  parsed: Extract<SharedOptionsResult, { ok: false }>,
  io: CliIo,
  label: string
): number {
  io.stderr.write(`${label}: ${parsed.message}\n`)
  if (parsed.issues) {
    io.stderr.write(`${JSON.stringify(parsed.issues, null, 2)}\n`)
  }
  return parsed.exitCode
}

function assistantText(items: readonly TurnItem[]): string {
  return items
    .filter((item): item is Extract<TurnItem, { kind: 'assistant_text' }> => item.kind === 'assistant_text')
    .map((item) => item.text)
    .join('\n')
}

function parseJsonObject(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, message: '--args must be a JSON object' }
    }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch (error) {
    return { ok: false, message: `invalid --args JSON: ${errorMessage(error)}` }
  }
}

function formatToolOutput(output: unknown): string {
  return typeof output === 'string' ? output : JSON.stringify(output, null, 2)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isTtyInput(input: NodeJS.ReadableStream): boolean {
  return Boolean((input as NodeJS.ReadStream).isTTY)
}

function isReadlineClosedError(error: unknown): boolean {
  return error instanceof Error && error.message === 'readline was closed'
}
