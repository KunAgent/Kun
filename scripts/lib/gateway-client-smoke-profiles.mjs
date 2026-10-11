import assert from 'node:assert/strict'
import { join } from 'node:path'
import { writeFile, mkdir } from 'node:fs/promises'

export const CLIENT_VERSIONS = Object.freeze({ codex: '0.160.0', claude: '2.1.220', opencode: '1.1.47', pi: '0.73.1' })
export const SUCCESS_MARKER = 'KUN_GATEWAY_OFFLINE_OK'

export function officialVersion(client, text) {
  const pattern = client === 'codex' ? /^codex-cli (\d+\.\d+\.\d+)$/
    : client === 'claude' ? /^(\d+\.\d+\.\d+) \(Claude Code\)$/ : /^(\d+\.\d+\.\d+)$/
  return pattern.exec(text)?.[1]
}

export function scenarioArgs(client, workspace, scenario = 'text', role = 'main') {
  const model = role === 'small' ? 'local-small' : 'local-model'
  const prompt = scenario === 'tools' ? `Read fixture.txt using your read tool, then return exactly ${SUCCESS_MARKER}.`
    : `Return exactly ${SUCCESS_MARKER}. Do not use tools.`
  if (client === 'codex') return ['exec', '--skip-git-repo-check', '--ephemeral', '--ignore-rules',
    '--sandbox', 'read-only', '--json', '--color', 'never', '-C', workspace,
    '-c', 'analytics.enabled=false', '-c', 'feedback.enabled=false', '-c', 'web_search="disabled"',
    '-c', 'check_for_update_on_startup=false', '-m', model, prompt]
  if (client === 'claude') return ['--bare', '--print', '--output-format', 'json',
    '--tools', scenario === 'tools' ? 'Read' : '', ...(scenario === 'tools' ? ['--allowedTools', 'Read'] : []),
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '',
    '--no-session-persistence', '--no-chrome', '--system-prompt', 'Offline protocol conformance test.', '--model', model, prompt]
  if (client === 'opencode') return ['run', '--format', 'json', '--model', `kun/${model}`, prompt]
  return ['--print', '--mode', 'json', '--provider', 'kun', '--model', model,
    '--no-session', '--no-extensions', '--no-skills', '--no-prompt-templates',
    ...(scenario === 'tools' ? ['--tools', 'read'] : ['--no-tools']), prompt]
}

export async function configureExtraClients(client, home, endpoint, env, templates) {
  env.PATH = `${process.execPath.slice(0, process.execPath.lastIndexOf('/'))}:${env.PATH}`
  if (client === 'opencode') {
    env.OPENCODE_CONFIG = join(home, 'opencode.json')
    env.OPENCODE_DISABLE_DEFAULT_PLUGINS = '1'
    env.OPENCODE_DISABLE_AUTOUPDATE = '1'
    env.OPENCODE_DISABLE_LSP_DOWNLOAD = '1'
    const configuration = JSON.parse(templates.opencodeConfig(`${endpoint}/v1`, 'local-model', 'KUN_GATEWAY_SMOKE_TOKEN'))
    await writeFile(env.OPENCODE_CONFIG, JSON.stringify({ ...configuration, small_model: 'kun/local-model',
      permission: { '*': 'deny', read: 'allow' }, share: 'disabled', autoupdate: false
    }), { mode: 0o600 })
  } else if (client === 'pi') {
    env.PI_CODING_AGENT_DIR = join(home, 'pi')
    await mkdir(env.PI_CODING_AGENT_DIR, { recursive: true, mode: 0o700 })
    await writeFile(join(env.PI_CODING_AGENT_DIR, 'models.json'),
      templates.piModelsConfig(`${endpoint}/v1`, 'local-model', 'KUN_GATEWAY_SMOKE_TOKEN'), { mode: 0o600 })
  }
  env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'local-model'
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'local-small'
  env.ANTHROPIC_SMALL_FAST_MODEL = 'local-small'
  if (client === 'claude') {
    env.ANTHROPIC_AUTH_TOKEN = env.KUN_GATEWAY_SMOKE_TOKEN
    delete env.ANTHROPIC_API_KEY
  }
}

export function fixtureTool(request, workspace) {
  const tools = request.tools.map((tool) => tool.name)
  const path = join(workspace, 'fixture.txt')
  for (const name of ['Read', 'read', 'read_file', 'exec_command', 'shell_command', 'shell']) {
    const match = tools.find((tool) => tool === name || tool.endsWith(`.${name}`))
    if (!match) continue
    const args = name === 'Read' ? { file_path: path } : name === 'read' ? { path: 'fixture.txt', filePath: 'fixture.txt' }
      : name === 'read_file' ? { path } : name === 'exec_command' ? { cmd: 'cat fixture.txt', workdir: workspace }
      : { command: 'cat fixture.txt', workdir: workspace }
    return { name: match, args }
  }
  assert.fail(`No supported read-only fixture tool advertised: ${tools.join(', ')}`)
}

export function succeededOutput(client, stdout) {
  const records = stdout.trim().split('\n').flatMap((line) => { try { return [JSON.parse(line)] } catch { return [] } })
  if (client === 'codex') return records.some((item) => item.type === 'item.completed' && item.item?.type === 'agent_message' && item.item.text === SUCCESS_MARKER)
    && records.some((item) => item.type === 'turn.completed')
  if (client === 'claude') return records.some((item) => item.type === 'result' && !item.is_error && item.result === SUCCESS_MARKER)
  if (client === 'opencode') return records.some((item) => item.type === 'text' && item.part?.text === SUCCESS_MARKER)
  return records.some((item) => item.type === 'message_end' && item.message?.content?.some((part) => part.type === 'text' && part.text === SUCCESS_MARKER))
}
