import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WIRING_CLIENTS } from './lib/agent-wiring-smoke-clients.mjs'
import { parseWiringOptions } from './smoke-agent-wiring-clients.mjs'

test('wiring smoke options are bounded', () => {
  assert.deepEqual(parseWiringOptions([]), { client: 'all', timeout: 90_000, json: false })
  assert.deepEqual(parseWiringOptions(['--client', 'codex', '--json']), { client: 'codex', timeout: 90_000, json: true })
  assert.throws(() => parseWiringOptions(['--client', 'unknown']))
  assert.throws(() => parseWiringOptions(['--timeout', '10']))
})

test('clients never point at the gateway through flags, only through the config Kun writes', () => {
  for (const [id, client] of Object.entries(WIRING_CLIENTS)) {
    const args = [...client.args('text', '/tmp/ws'), ...client.args('tools', '/tmp/ws')].join(' ')
    assert.doesNotMatch(args, /127\.0\.0\.1|base[-_]?url|api[-_]?key/i, id)
    assert.ok(!('ANTHROPIC_BASE_URL' in client.env('/tmp/home')), id)
  }
  // Claude Code's --tools is variadic: the prompt must come before it.
  const claude = WIRING_CLIENTS['claude-code'].args('tools', '/tmp/ws')
  assert.ok(claude.indexOf('--print') + 1 < claude.indexOf('--tools'))
  assert.match(claude[claude.indexOf('--print') + 1], /fixture\.txt/)
})

test('seeded configs Kun must restore are valid for their agents', () => {
  // Claude Code ignores a settings.json it cannot parse as strict JSON.
  JSON.parse(WIRING_CLIENTS['claude-code'].seed['claude/settings.json'])
  JSON.parse(WIRING_CLIENTS.droid.seed['.factory/config.json'])
  for (const client of Object.values(WIRING_CLIENTS)) {
    if (client.userEdit) assert.ok(client.seed[client.userEdit.file].includes(client.userEdit.from))
  }
})
