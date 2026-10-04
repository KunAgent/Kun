import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clientArgs, clientVersionEvidence, isolatedClientEnv, parseOptions, toolShape } from './smoke-model-gateway-clients.mjs'

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
