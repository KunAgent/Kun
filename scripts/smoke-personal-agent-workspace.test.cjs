'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const { startWorkspaceBrowserPage } = require('./smoke-personal-agent-workspace.cjs')

test('browser fixture serves one isolated loopback document without remote dependencies', async (t) => {
  const fixture = await startWorkspaceBrowserPage()
  t.after(() => fixture.close())
  const url = new URL(fixture.url)
  assert.equal(url.hostname, '127.0.0.1')
  assert.equal(url.pathname, '/workspace-browser')
  assert.deepEqual(fixture.snapshot(), { pageRequests: 0 })
  const response = await fetch(fixture.url)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; style-src 'unsafe-inline'")
  const body = await response.text()
  assert.match(body, /Personal workspace browser evidence/)
  assert.doesNotMatch(body, /<script|<iframe|<form|https?:\/\/|src=/i)
  assert.equal((await fetch(new URL('/outside', fixture.url))).status, 404)
  assert.equal((await fetch(fixture.url, { method: 'POST' })).status, 404)
  assert.deepEqual(fixture.snapshot(), { pageRequests: 1 })
})

const { collectWorkspaceFailureDiagnostics, redactWorkspaceDiagnostics } = require('./smoke-personal-workspace-diagnostics.cjs')

test('failure diagnostics retain actual browser state and matching run tool failures without unrelated reasoning or secrets', async () => {
  const paths = [], browserReads = []
  const execution = { roomId: 'room-test', runId: 'run-test', threadId: 'thread-test', turnId: 'turn-test' }
  const page = {
    locator: () => ({ evaluateAll: async () => [{ state: 'live', ...execution }] }),
    evaluate: async (_operation, identity) => { browserReads.push(identity); return {
      actual: { lifecycle: 'mount-required', threadId: identity.threadId, turnId: identity.turnId,
        pendingActionConsent: { previewDataUrl: 'data:image/png;base64,AAAA' } },
      expectedTurn: { lifecycle: 'closed' }
    } }
  }
  const request = async (_page, path) => {
    paths.push(path)
    if (path.endsWith('/direct')) return { execution, requests: [{ ...execution }], apiKey: 'never-keep-this' }
    if (path.includes('/items?')) return { items: [
      { kind: 'tool_call', toolName: 'browser_use', arguments: { action: 'open', url: 'http://127.0.0.1:1234/workspace-browser' } },
      { kind: 'tool_result', toolName: 'browser_use', isError: true, output: { code: 'mount_required', error: 'supervision missing', accessToken: 'secret-token' } },
      { kind: 'reasoning', text: 'Do not include model reasoning' }
    ] }
    return { run: execution }
  }
  const result = await collectWorkspaceFailureDiagnostics({ page, request, roomId: 'room-test', execution,
    fixture: { snapshot: () => ({ real: false, mainCalls: 3 }) }, website: { snapshot: () => ({ pageRequests: 0 }) } })
  assert.equal(paths.length, 3, 'Read the exact Room and one deduplicated run only')
  assert(paths.every((path) => path.startsWith('/v1/rooms/room-test/')))
  assert.deepEqual(browserReads, [{ threadId: 'thread-test', turnId: 'turn-test' }])
  assert.equal(result.runs[0].browser.value.actual.lifecycle, 'mount-required')
  assert.equal(result.runs[0].toolItems.value.items[1].output.code, 'mount_required')
  assert.equal(result.runs[0].toolItems.value.items.length, 2)
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, /never-keep-this|secret-token|Do not include model reasoning|base64,AAAA/)
  assert.match(serialized, /\[redacted\]/)
})

test('diagnostic redaction remains bounded and removes credentials nested in errors and results', () => {
  const result = redactWorkspaceDiagnostics({ managerToken: 'hidden', output: { credentials: ['a'],
    error: 'Authorization: Bearer abc.def-ghi', text: '{"apiKey":"hidden-value","ok":true}',
    long: 'a'.repeat(17000) }, image: 'data:image/png;base64,secret' })
  assert.equal(result.managerToken, '[redacted]')
  assert.equal(result.output.credentials, '[redacted]')
  assert.doesNotMatch(JSON.stringify(result), /hidden-value|abc.def-ghi|base64,secret/)
  assert(result.output.long.length < 17000)
})
