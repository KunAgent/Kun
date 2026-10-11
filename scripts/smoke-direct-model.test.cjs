'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const { startDirectModel } = require('./smoke-direct-model.cjs')

test('connection Skip gets its own final response before the next provider request', async (t) => {
  const fixture = await startDirectModel()
  t.after(() => fixture.close())
  const messages = [{ role: 'user', content: 'User message:\nIM_CONNECTION_SMOKE_feishu: show the official connection proposal' }]
  const step = async () => {
    const response = await fetch(fixture.baseUrl + '/chat/completions', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'fixture', stream: false, messages }) })
    assert.equal(response.status, 200)
    return (await response.json()).choices[0].message
  }
  const settle = (message) => {
    messages.push(message)
    for (const call of message.tool_calls ?? []) messages.push({ role: 'tool', tool_call_id: call.id, content: '{"ok":true}' })
  }
  const feishu = await step()
  assert.equal(feishu.tool_calls[0].function.name, 'request_app_connection')
  assert.equal(JSON.parse(feishu.tool_calls[0].function.arguments).serverId, 'im.feishu')
  settle(feishu)
  assert.equal((await step()).tool_calls, undefined, 'The proposal itself completes its initial turn')
  messages.push({ role: 'user', content: 'The user skipped connecting app im.feishu. Continue the original task without that app. Do not claim access; explain any limitation.' })
  const skipped = await step()
  assert.equal(skipped.tool_calls[0].function.name, 'send_im_message')
  assert.equal(JSON.parse(skipped.tool_calls[0].function.arguments).phase, 'final')
  settle(skipped)
  assert.equal((await step()).tool_calls, undefined, 'The continuation can finish without looping')
  messages.push({ role: 'user', content: 'User message:\nIM_CONNECTION_SMOKE_weixin: show the official connection proposal' })
  const weixin = await step()
  assert.equal(weixin.tool_calls[0].function.name, 'request_app_connection')
  assert.equal(JSON.parse(weixin.tool_calls[0].function.arguments).serverId, 'im.weixin')
})

test('workspace browser fixture uses one exact loopback page and holds only after the browser tool result', async (t) => {
  const fixture = await startDirectModel()
  t.after(() => fixture.close())
  const url = 'http://127.0.0.1:4173/workspace-browser'
  const messages = [{ role: 'user', content: 'User message:\nWORKSPACE_BROWSER_OPEN ' + url + ' inspect the isolated fixture.' }]
  const step = () => modelStep(fixture, messages)
  const start = await step()
  assert.equal(start.tool_calls[0].function.name, 'send_im_message')
  assert.equal(JSON.parse(start.tool_calls[0].function.arguments).phase, 'start')
  settleTool(messages, start)
  const open = await step()
  assert.deepEqual(JSON.parse(open.tool_calls[0].function.arguments), { action: 'open', url })
  assert.equal(open.tool_calls[0].function.name, 'browser_use')
  assert.equal(fixture.holding(), false)
  settleTool(messages, open)
  const next = step()
  for (let tries = 0; !fixture.holding() && tries < 100; tries++) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(fixture.holding(), true)
  fixture.release()
  const final = await next
  assert.equal(JSON.parse(final.tool_calls[0].function.arguments).phase, 'final')
  settleTool(messages, final)
  assert.equal((await step()).tool_calls, undefined, 'One browser result cannot hold the completed turn again')
  assert.equal(fixture.snapshot().real, false)
})

test('workspace artifact is published through the real attachment tool contract after a file write', async (t) => {
  const fixture = await startDirectModel()
  t.after(() => fixture.close())
  const messages = [{ role: 'user', content: 'User message:\nWORKSPACE_ARTIFACT Create and attach the evidence file.' }]
  const start = await modelStep(fixture, messages)
  settleTool(messages, start)
  const write = await modelStep(fixture, messages)
  assert.equal(write.tool_calls[0].function.name, 'write')
  assert.deepEqual(JSON.parse(write.tool_calls[0].function.arguments), {
    path: 'workspace-evidence.txt', content: 'Saved personal workspace artifact v1\n'
  })
  settleTool(messages, write)
  const final = await modelStep(fixture, messages)
  assert.equal(final.tool_calls[0].function.name, 'send_im_message')
  assert.deepEqual(JSON.parse(final.tool_calls[0].function.arguments).attachments, [{ path: 'workspace-evidence.txt' }])
  settleTool(messages, final)
  assert.equal((await modelStep(fixture, messages)).tool_calls, undefined)
})

test('workspace browser fixture never turns an arbitrary public URL into a browser call', async (t) => {
  const fixture = await startDirectModel()
  t.after(() => fixture.close())
  const messages = [{ role: 'user', content: 'User message:\nWORKSPACE_BROWSER_OPEN https://example.com/workspace-browser' }]
  const result = await modelStep(fixture, messages)
  assert.equal(result.tool_calls[0].function.name, 'send_im_message')
  settleTool(messages, result)
  assert.equal((await modelStep(fixture, messages)).tool_calls, undefined)
})

async function modelStep(fixture, messages) {
  const response = await fetch(fixture.baseUrl + '/chat/completions', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'fixture', stream: false, messages }) })
  assert.equal(response.status, 200)
  return (await response.json()).choices[0].message
}
function settleTool(messages, message) {
  messages.push(message)
  for (const call of message.tool_calls ?? []) messages.push({ role: 'tool', tool_call_id: call.id, content: '{"ok":true}' })
}
