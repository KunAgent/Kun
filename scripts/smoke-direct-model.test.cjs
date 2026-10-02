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
