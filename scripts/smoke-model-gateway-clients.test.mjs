import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from 'yaml'
import { clientArgs, clientVersionEvidence, isolatedClientEnv, parseOptions, routeChangeEvidence, sanitizedClientOutput, toolShape } from './smoke-model-gateway-clients.mjs'
import { CLIENT_VERSIONS } from './lib/gateway-client-smoke-profiles.mjs'

test('second invocation failure evidence is bounded and redacted', () => {
  const result = routeChangeEvidence('opencode', { code: 1, timedOut: true,
    stdout: 'error secret-token /Users/private/file https://example.com/key ' + 'failure '.repeat(3000),
    stderr: 'request Bearer abcdef' }, [{ providerId: 'offline' }], 2, 1)
  assert.equal(result.passed, false)
  assert.equal(result.secondInvocation.exitCode, 1)
  assert.equal(result.secondInvocation.timedOut, true)
  assert.equal(result.secondInvocation.requestCountAtStart, 2)
  assert.equal(result.secondInvocation.upstreamCallCountAtStart, 1)
  assert.ok(result.secondInvocation.stdout.length <= 8000)
  assert.doesNotMatch(result.secondInvocation.stderr, /abcdef|Bearer/)
  assert.doesNotMatch(sanitizedClientOutput('secret-token /Users/private/file https://example.com/key'), /secret-token|Users|example/)
  assert.equal(sanitizedClientOutput(undefined), '')
  assert.equal(routeChangeEvidence('opencode', { code: null }, [], 0, 0).secondInvocation.stdout, '')
})

test('route change still requires successful output and both providers', () => {
  const stdout = JSON.stringify({ type: 'text', part: { text: 'KUN_GATEWAY_OFFLINE_OK' } })
  const repeated = { code: 0, stdout }
  const both = [{ providerId: 'offline' }, { providerId: 'offline-next' }]
  assert.equal(routeChangeEvidence('opencode', repeated, both, 1, 1).passed, true)
  assert.equal(routeChangeEvidence('opencode', repeated, both.slice(0, 1), 1, 1).passed, false)
  assert.equal(routeChangeEvidence('opencode', { ...repeated, stdout: '' }, both, 1, 1).passed, false)
  assert.equal(routeChangeEvidence('opencode', { ...repeated, code: 1 }, both, 1, 1).passed, false)
  assert.equal(routeChangeEvidence('opencode', repeated, both, 1, 1).secondInvocation, undefined)
})

test('CI installs pinned clients and exercises every client and scenario using explicit binaries', () => {
  const workflow = parse(readFileSync(new URL('../.github/workflows/model-gateway-clients.yml', import.meta.url), 'utf8'))
  assert.ok(workflow.on.pull_request.paths.includes('scripts/lib/gateway-client-smoke-profiles.mjs'))
  const job = workflow.jobs['official-clients']
  assert.equal(job['runs-on'], 'ubuntu-22.04')
  assert.equal(job['continue-on-error'], undefined)
  assert.ok(job.steps.every((step) => step['continue-on-error'] === undefined))
  const install = job.steps.find((step) => step.run?.includes('npm install --prefix'))
  assert.ok(install.run.includes('--prefix "$RUNNER_TEMP/gateway-clients"'))
  for (const [client, name] of Object.entries({ codex: '@openai/codex', opencode: 'opencode-ai', pi: '@mariozechner/pi-coding-agent' })) {
    assert.ok(install.run.split(/\s+/).includes(`${name}@${CLIENT_VERSIONS[client]}`), `${client} must be installed at the expected version`)
  }
  const smoke = job.steps.find((step) => step.run?.includes('node scripts/smoke-model-gateway-clients.mjs'))
  assert.ok(job.steps.indexOf(smoke) > job.steps.indexOf(install))
  assert.equal(smoke.if, undefined)
  assert.ok(smoke.run.includes('node --test scripts/smoke-model-gateway-clients.test.mjs'))
  assert.match(smoke.run, /--client all --scenario all/)
  assert.ok(smoke.run.includes('CLIENT_BIN_DIR="$RUNNER_TEMP/gateway-clients/node_modules/.bin"'))
  for (const client of ['opencode', 'pi']) {
    assert.ok(smoke.run.includes(`--${client} "$CLIENT_BIN_DIR/${client}"`))
  }
  assert.ok(smoke.run.includes('--codex "$CODEX_BINARY"'))
  assert.ok(smoke.run.includes('find "$RUNNER_TEMP/gateway-clients/node_modules/@openai" -type f -path \'*/bin/codex\''))
  assert.ok(smoke.run.includes('CLAUDE_BINARY="$GITHUB_WORKSPACE/kun/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude"'))
  assert.ok(smoke.run.includes('--claude "$CLAUDE_BINARY"'))
  assert.doesNotMatch(smoke.run, /--allow-version-mismatch/)
})

test('official-client smoke requires a bounded selected client invocation', () => {
  assert.deepEqual(parseOptions([]), { client: 'all', timeout: 45_000 })
  assert.throws(() => parseOptions(['--client', 'other']))
  assert.throws(() => parseOptions(['--timeout', 'NaN']))
  assert.throws(() => parseOptions(['--client']))
})

test('client environment is an allowlist without host credentials or endpoints', () => {
  const previous = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'must-not-leak'
  try {
    const env = isolatedClientEnv('/tmp/isolated-client', 'http://127.0.0.1:10001', 'http://127.0.0.1:10002')
    assert.equal(env.OPENAI_API_KEY, undefined)
    assert.equal(env.GH_TOKEN, undefined)
    assert.equal(env.HOME, '/tmp/isolated-client')
    assert.equal(env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:10001')
    assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:10002')
    assert.equal(env.NO_PROXY, '127.0.0.1,localhost,::1')
    assert.equal(env.MAX_THINKING_TOKENS, '0')
    assert.equal(env.CLAUDE_CODE_EFFORT_LEVEL, 'unset')
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previous
  }
})

test('smoke keeps client tools and filesystem constrained', () => {
  const codex = clientArgs('codex', '/tmp/work')
  assert.equal(codex[codex.indexOf('--sandbox') + 1], 'read-only')
  assert.ok(codex.includes('--ephemeral'))
  assert.ok(!codex.some((arg) => arg.includes('bypass')))
  const claude = clientArgs('claude', '/tmp/work')
  assert.equal(claude[claude.indexOf('--tools') + 1], '')
  assert.ok(claude.includes('--strict-mcp-config'))
  assert.ok(claude.includes('--no-session-persistence'))
})

test('smoke validates pinned versions and reports local overrides explicitly', () => {
  assert.deepEqual(clientVersionEvidence('codex', 'codex-cli 0.160.0'), { expectedVersion: '0.160.0', versionMatched: true, allowedVersionMismatch: false })
  assert.equal(clientVersionEvidence('codex', 'codex-cli 0.159.2').versionMatched, false)
  assert.equal(clientVersionEvidence('claude', '2.1.220 (Claude Code)').versionMatched, true)
  assert.equal(clientVersionEvidence('claude', '2.1.999 (Claude Code)', true).allowedVersionMismatch, true)
  assert.equal(parseOptions(['--allow-version-mismatch', 'true'])['allow-version-mismatch'], true)
  assert.throws(() => parseOptions(['--allow-version-mismatch', 'yes']))
})

test('namespace evidence captures types and controls without prompts or grammar bodies', () => {
  const summary = toolShape({ type: 'namespace', name: 'functions', description: 'omitted description', tools: [
    { type: 'function', name: 'read', strict: false, defer_loading: false, parameters: { secret: 'omitted schema' } },
    { type: 'custom', name: 'patch', format: { type: 'grammar', syntax: 'lark', definition: 'omitted grammar' } }
  ] })
  assert.equal(summary.tools[0].name, 'read')
  assert.equal(summary.tools[0].strict, false)
  assert.equal(summary.tools[1].format.syntax, 'lark')
  assert.ok(!JSON.stringify(summary).includes('omitted'))
})
