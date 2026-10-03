'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const { roomsHarnessModelResponse, assertRoomsHarnessDiscoveryOrder } = require('./smoke-rooms-harness-fixture.cjs')
const { startModelFixture } = require('./smoke-development-ade-model.cjs')
const { configureRoomsHarnessFixture, ROOMS_HARNESS_PROFILE, ROOMS_HARNESS_MODEL } = require('./smoke-rooms-harness-fixture.cjs')

const publicationTools = ['add_board_card', 'create_code_task', 'request_app_connection', 'send_im_message', 'user_input']
const fullTools = [...publicationTools, 'list_code_harnesses']
const route = { harnessId: 'devin', credentialMode: 'native-login', model: 'devin-fixture-model' }
const catalog = { authority: 'reference_only', agents: [{ harnessId: 'devin', available: true, models: [route] }] }
const user = () => [{ role: 'user', content: 'Inspect the task card [rooms-harness-smoke]' }]
const call = (id, name, args) => ({ role: 'assistant', content: null,
  tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
function step(messages, tools = fullTools) {
  return roomsHarnessModelResponse({ text: '[rooms-harness-smoke]', messages,
    supports: (name) => tools.includes(name), completed: (id) => messages.some((entry) => entry.tool_call_id === id),
    call, workspaceRoot: '/offline-fixture' })
}
function settle(messages, message, output = { accepted: true, phase: 'start' }) {
  messages.push(message)
  for (const tool of message.tool_calls ?? []) messages.push({ role: 'tool', tool_call_id: tool.id,
    content: typeof output === 'string' ? output : JSON.stringify(output) })
}
const toolName = (message) => message.tool_calls?.[0]?.function.name
const args = (message) => JSON.parse(message.tool_calls[0].function.arguments)

test('Rooms fixture seeds only explicit Devin consent, its exact model and an offline-only key', () => {
  const harnesses = { binaryPaths: { devin: '/offline/stub' }, defaults: { other: { model: 'unchanged' } } }
  const settings = { agents: { kun: { harnesses } } }
  const environment = { HOME: '/offline/home', WINDSURF_API_KEY: 'do-not-inherit-real-credentials' }
  configureRoomsHarnessFixture(settings, environment)
  assert.deepEqual(harnesses.enabledProfiles, [ROOMS_HARNESS_PROFILE])
  assert.deepEqual(harnesses.defaults.devin, { credentialMode: 'native-login', model: ROOMS_HARNESS_MODEL })
  assert.deepEqual(harnesses.defaults.other, { model: 'unchanged' })
  assert.equal(environment.WINDSURF_API_KEY, 'rooms-offline-fixture-no-service-access')
  assert.equal(environment.HOME, '/offline/home')
  assert.equal(harnesses.readyProfiles, undefined, 'Persisted settings must not invent readiness')
})

test('publication-only first step sends one start, then discovers before proposing', () => {
  const messages = user()
  const start = step(messages, publicationTools)
  assert.equal(toolName(start), 'send_im_message')
  assert.equal(args(start).phase, 'start')
  settle(messages, start)
  assert.equal(toolName(step(messages, publicationTools)), undefined, 'Do not create or repeat the start if the gate remains closed')
  const discovery = step(messages)
  assert.equal(toolName(discovery), 'list_code_harnesses')
  settle(messages, discovery, catalog)
  const proposal = step(messages)
  assert.equal(toolName(proposal), 'create_code_task')
  assert.deepEqual(args(proposal).execution.model, route)
  settle(messages, proposal, { requested: true, status: 'awaiting_confirmation' })
  assert.equal(args(step(messages)).phase, 'final')
})

test('an already open work phase discovers without an unnecessary start message', () => {
  assert.equal(toolName(step(user())), 'list_code_harnesses')
})

for (const [label, output] of [
  ['tool error', { error: 'Code Agent discovery unavailable' }],
  ['explicit error', { ...catalog, isError: true }],
  ['malformed response', 'not JSON'],
  ['empty catalog', { authority: 'reference_only', agents: [] }],
  ['unavailable Agent', { ...catalog, agents: [{ ...catalog.agents[0], available: false }] }],
  ['wrong model', { ...catalog, agents: [{ ...catalog.agents[0], models: [{ ...route, model: 'different-model' }] }] }]
]) test(`${label} cannot produce a task proposal`, () => {
  const messages = user()
  settle(messages, step(messages), output)
  assert.notEqual(toolName(step(messages)), 'create_code_task')
})

test('a tool result without its matching discovery call is not successful discovery', () => {
  const messages = user()
  messages.push({ role: 'tool', tool_call_id: 'rooms-harness-discover', content: JSON.stringify(catalog) })
  assert.notEqual(toolName(step(messages)), 'create_code_task')
})

test('ordering assertion rejects advertised-only, missing, failed and post-proposal discovery', () => {
  const discover = { responseTools: ['list_code_harnesses'], roomsHarnessDiscoverySucceeded: false }
  const propose = { responseTools: ['create_code_task'], roomsHarnessDiscoverySucceeded: true }
  assert.doesNotThrow(() => assertRoomsHarnessDiscoveryOrder([discover, propose]))
  for (const observations of [[], [{ tools: fullTools }], [propose, discover],
    [discover, { ...propose, roomsHarnessDiscoverySucceeded: false }],
    [{ ...propose, roomsHarnessDiscoverySucceeded: false }, discover, propose]]) {
    assert.throws(() => assertRoomsHarnessDiscoveryOrder(observations), /Successful Code Agent discovery must precede/)
  }
})

test('HTTP fixture records successful discovery at proposal time without waiting for a later request', async (t) => {
  const fixture = await startModelFixture('offline-fixture', { workspaceRoot: '/offline-fixture' })
  t.after(() => fixture.close())
  const messages = user()
  const request = async (tools) => {
    const response = await fetch(fixture.baseUrl + '/chat/completions', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'offline-fixture', messages,
        tools: tools.map((name) => ({ type: 'function', function: { name } })) }) })
    assert.equal(response.status, 200)
    return (await response.json()).choices[0].message
  }
  const start = await request(publicationTools)
  assert.equal(toolName(start), 'send_im_message')
  settle(messages, start)
  const discovery = await request(fullTools)
  assert.equal(toolName(discovery), 'list_code_harnesses')
  settle(messages, discovery, catalog)
  const proposal = await request(fullTools)
  assert.equal(toolName(proposal), 'create_code_task')
  const observations = fixture.snapshot().observations
  assert.deepEqual(observations.map((entry) => entry.responseTools), [['send_im_message'], ['list_code_harnesses'], ['create_code_task']])
  assert.deepEqual(observations.map((entry) => entry.roomsHarnessDiscoverySucceeded), [false, false, true])
  assertRoomsHarnessDiscoveryOrder(observations)
})

test('task outcome continuation still publishes its result without rediscovery', () => {
  const messages = user()
  messages.push({ role: 'user', content: 'workbench_task_outcome: completed' })
  const final = step(messages, publicationTools)
  assert.equal(toolName(final), 'send_im_message')
  assert.equal(args(final).phase, 'final')
})
