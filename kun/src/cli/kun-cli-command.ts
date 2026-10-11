// Command routing for the `kun` binary. Kept free of the TUI, agent, and
// extension CLIs so `kun serve` (the desktop Runtime) does not load them.

export const KUN_CLI_USAGE = `kun <command> [options]

Run \`kun\` without a command to open the inline terminal UI.

Commands:
  serve [options]            Start the local HTTP/SSE runtime
  host <start|stop|status>    Manage an opt-in independent persistent host
  run [options] <prompt>     Run one agent turn without the GUI
  chat [options]             Start a line-oriented terminal chat
  tui [options]              Open the inline terminal UI (same as bare kun)
  runtime <command>          Inspect, stop, or restart the shared runtime
  update [--check|--yes]     Check or update a stable standalone TUI archive
  exec [options] <tool>      List or invoke tools directly
  mcp-bridge --token-env <V> Forward stdio JSON-RPC to a Kun server's /mcp/kun
  worker <subcommand>        Worker callbacks (progress/ask/result/context/hook)
  extension <command>        Create, validate, pack, install, and manage extensions
  gateway <command>          Local model gateway: status, models, client keys, middleware
  agents <command>           Point coding agents (Claude Code, Codex, ...) at the gateway
  quota [wait <provider>]    Balances and allowance windows; wait for one to renew
  provider list|models|test  Connected providers, their models, and a one-request check

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

export type KunCliCommand = 'serve' | 'run' | 'chat' | 'tui' | 'exec' | 'runtime' | 'update' | 'mcp-bridge' | 'version' | 'help'

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
    first === 'update' ||
    first === 'mcp-bridge'
  ) {
    return { command: first, args: [...argv.slice(1)] }
  }
  if (first.startsWith('-')) {
    return { command: 'tui', args: [...argv] }
  }
  return { command: 'help', args: [], error: `unknown command: ${first}` }
}
