import { join } from 'node:path'
import { MARKER } from './agent-wiring-smoke-runtime.mjs'

// One entry per agent the wiring smoke can drive. Each seeds a realistic user
// config (comments and unrelated keys), runs the agent's own CLI without any
// model/base-URL flags so only the config Kun wrote can point it at the
// gateway, and recognizes the fixture reply in its output.
const prompt = (scenario) => scenario === 'tools'
  ? `Read the file fixture.txt in the current directory with your file reading tool, then reply with exactly ${MARKER}.`
  : `Reply with exactly ${MARKER}. Do not use tools.`

function jsonRecords(stdout) {
  return stdout.trim().split('\n').flatMap((line) => { try { return [JSON.parse(line)] } catch { return [] } })
}

function wholeJson(stdout) {
  try { return JSON.parse(stdout) } catch { return undefined }
}

export const WIRING_CLIENTS = {
  'claude-code': {
    bin: 'claude', smallModel: 'local-small', effort: 'high', sendsSession: true,
    // Claude Code reads settings.json as strict JSON and silently ignores a file with comments.
    seed: { 'claude/settings.json': '{\n  "theme": "dark",\n  "env": {\n    "DISABLE_TELEMETRY": "1"\n  }\n}\n' },
    userEdit: { file: 'claude/settings.json', from: '"theme": "dark"', to: '"theme": "light"' },
    env: (home) => ({ CLAUDE_CONFIG_DIR: join(home, 'claude'), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1',
      DISABLE_ERROR_REPORTING: '1', CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: '1' }),
    // The prompt goes first: --tools and --allowedTools are variadic and would swallow it.
    args: (scenario) => ['--print', prompt(scenario), '--output-format', 'json', '--setting-sources', 'user', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--no-session-persistence', ...(scenario === 'tools' ? ['--tools', 'Read', '--allowedTools', 'Read'] : ['--tools', ''])],
    succeeded: (stdout) => jsonRecords(stdout).some((item) => item.type === 'result' && !item.is_error && String(item.result ?? '').includes(MARKER))
  },
  codex: {
    bin: 'codex', effort: 'high', sendsSession: true,
    seed: { 'codex/config.toml': '# my codex config\napproval_policy = "never"\nmodel = "gpt-5"\n\n[profiles.fast]\nmodel = "gpt-5-mini"\n' },
    userEdit: { file: 'codex/config.toml', from: '[profiles.fast]\nmodel = "gpt-5-mini"', to: '[profiles.fast]\nmodel = "gpt-5-nano"' },
    env: (home) => ({ CODEX_HOME: join(home, 'codex') }),
    args: (scenario, workspace) => ['exec', '--skip-git-repo-check', '--ephemeral', '--json', '--color', 'never', '--sandbox', 'read-only',
      '-C', workspace, '-c', 'analytics.enabled=false', '-c', 'feedback.enabled=false', '-c', 'web_search="disabled"',
      '-c', 'check_for_update_on_startup=false', prompt(scenario)],
    succeeded: (stdout) => jsonRecords(stdout).some((item) => item.type === 'item.completed' && item.item?.type === 'agent_message' && String(item.item.text ?? '').includes(MARKER))
  },
  opencode: {
    bin: 'opencode', smallModel: 'local-small', sendsSession: true,
    seed: { 'config/opencode/opencode.json': '{\n  // my OpenCode settings\n  "$schema": "https://opencode.ai/config.json",\n  "autoupdate": false,\n  "share": "disabled"\n}\n' },
    userEdit: { file: 'config/opencode/opencode.json', from: '"share": "disabled"', to: '"share": "manual"' },
    env: (home) => ({ XDG_CONFIG_HOME: join(home, 'config'), OPENCODE_DISABLE_DEFAULT_PLUGINS: '1', OPENCODE_DISABLE_AUTOUPDATE: '1',
      OPENCODE_DISABLE_LSP_DOWNLOAD: '1', OPENCODE_DISABLE_MODELS_FETCH: '1' }),
    args: (scenario) => ['run', '--format', 'json', prompt(scenario)],
    succeeded: (stdout) => jsonRecords(stdout).some((item) => item.type === 'text' && String(item.part?.text ?? '').includes(MARKER))
  },
  'gemini-cli': {
    bin: 'gemini',
    // Current key names: Gemini CLI rewrites deprecated ones (disableAutoUpdate) in place.
    seed: { '.gemini/settings.json': '{\n  "ui": {\n    "theme": "GitHub"\n  },\n  "general": {\n    "enableAutoUpdate": false\n  }\n}' },
    userEdit: { file: '.gemini/settings.json', from: '"theme": "GitHub"', to: '"theme": "Dracula"' },
    // Gemini CLI reads ~/.gemini/.env only in trusted folders; this stands in for a folder the user trusted.
    env: () => ({ GEMINI_CLI_NO_RELAUNCH: 'true', GEMINI_CLI_TRUST_WORKSPACE: 'true' }),
    args: (scenario) => ['-p', prompt(scenario), '--output-format', 'json', ...(scenario === 'tools' ? ['--approval-mode', 'plan'] : [])],
    succeeded: (stdout) => String(wholeJson(stdout.slice(stdout.indexOf('{')))?.response ?? '').includes(MARKER)
  },
  droid: {
    bin: 'droid',
    seed: { '.factory/config.json': '{\n  "custom_models": [\n    {\n      "model_display_name": "My local",\n      "model": "llama3",\n      "base_url": "http://localhost:11434/v1",\n      "api_key": "local",\n      "provider": "generic-chat-completion-api",\n      "max_tokens": 8000\n    }\n  ]\n}\n' },
    userEdit: { file: '.factory/config.json', from: '"model_display_name": "My local"', to: '"model_display_name": "My renamed local"' },
    env: () => ({}),
    args: (scenario, workspace) => ['exec', '--model', 'custom:local-model', '--cwd', workspace, '-o', 'json', prompt(scenario)],
    succeeded: (stdout) => stdout.includes(MARKER)
  },
  goose: {
    bin: 'goose',
    seed: { 'config/goose/config.yaml': '# my goose settings\nGOOSE_MODE: auto\nextensions:\n  developer:\n    bundled: true\n    display_name: Developer\n    enabled: true\n    name: developer\n    timeout: 300\n    type: builtin\n' },
    userEdit: { file: 'config/goose/config.yaml', from: 'GOOSE_MODE: auto', to: 'GOOSE_MODE: smart_approve' },
    // File-based secrets: the isolated run must never reach the login keychain.
    env: (home) => ({ XDG_CONFIG_HOME: join(home, 'config'), GOOSE_DISABLE_KEYRING: '1' }),
    args: (scenario) => ['run', '--no-session', '--quiet', '-t', prompt(scenario)], succeeded: (stdout) => stdout.includes(MARKER) },
  aider: {
    bin: 'aider', scenarios: ['text'],
    seed: { '.aider.conf.yml': '# my aider settings\ndark-mode: true\nauto-commits: false\n' },
    userEdit: { file: '.aider.conf.yml', from: 'dark-mode: true', to: 'dark-mode: false' },
    env: () => ({}),
    args: (scenario) => ['--yes-always', '--no-git', '--no-check-update', '--analytics-disable', '--no-show-release-notes', '--no-pretty',
      '--message', prompt(scenario)],
    succeeded: (stdout) => stdout.includes(MARKER) },
  kimi: {
    bin: 'kimi', sendsSession: true,
    seed: { '.kimi-code/config.toml': '# my Kimi Code config\ndefault_model = "kimi-for-coding"\n\n[providers.moonshot]\ntype = "kimi"\nbase_url = "https://api.moonshot.cn/v1"\napi_key = "sk-mine"\n' },
    userEdit: { file: '.kimi-code/config.toml', from: 'base_url = "https://api.moonshot.cn/v1"', to: 'base_url = "https://api.moonshot.ai/v1"' },
    env: () => ({}),
    args: (scenario) => ['-p', prompt(scenario), '--output-format', 'text'],
    succeeded: (stdout) => stdout.includes(MARKER)
  },
  pi: { bin: 'pi',
    seed: { 'pi/settings.json': '{\n  "theme": "dark",\n  "defaultThinkingLevel": "low"\n}\n' },
    userEdit: { file: 'pi/settings.json', from: '"theme": "dark"', to: '"theme": "light"' },
    env: (home) => ({ PI_CODING_AGENT_DIR: join(home, 'pi') }),
    args: (scenario) => ['--print', '--mode', 'json', '--no-session', prompt(scenario)], succeeded: (stdout) => stdout.includes(MARKER) },
  crush: { bin: 'crush',
    seed: { 'config/crush/crush.json': '{\n  "$schema": "https://charm.land/crush.json",\n  "options": {\n    "debug": false\n  }\n}\n' },
    userEdit: { file: 'config/crush/crush.json', from: '"debug": false', to: '"debug": true' },
    env: (home) => ({ XDG_CONFIG_HOME: join(home, 'config') }),
    args: (scenario) => ['run', prompt(scenario)], succeeded: (stdout) => stdout.includes(MARKER) },
  continue: { bin: 'cn',
    seed: { '.continue/config.yaml': 'name: My Assistant\nversion: 1.0.0\nschema: v1\n# my local model\nmodels:\n  - name: Local Llama\n    provider: ollama\n    model: llama3\n' },
    userEdit: { file: '.continue/config.yaml', from: 'name: Local Llama', to: 'name: Local Llama 3' },
    env: () => ({}), args: (scenario) => ['-p', prompt(scenario)], succeeded: (stdout) => stdout.includes(MARKER) }
}
