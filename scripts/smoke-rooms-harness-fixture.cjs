'use strict'
const { chmod, mkdir, writeFile } = require('node:fs/promises')
const { join } = require('node:path')

/** Real ACP subprocess, deterministic offline output; no provider account or model request. */
async function writeRoomsHarnessStub(root, releaseFile) {
  await mkdir(root, { recursive: true })
  const path = join(root, 'rooms-devin-fixture')
  await writeFile(path, `#!${process.execPath}
if (process.argv.includes('--version')) { console.log('Devin CLI 3000.11.3'); process.exit(0) }
const fs = require('node:fs')
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n')
const rl = require('node:readline').createInterface({ input: process.stdin })
let modelId = 'devin-fixture-model'
rl.on('line', (line) => {
  let msg; try { msg = JSON.parse(line) } catch { return }
  if (msg.id === undefined) return
  const reply = (result) => send({ jsonrpc: '2.0', id: msg.id, result })
  let result = {}
  if (msg.method === 'initialize') result = { protocolVersion: 1,
    agentInfo: { name: 'Devin offline fixture', version: '3000.11.3' },
    agentCapabilities: { loadSession: true }, authMethods: [] }
  if (msg.method === 'session/new' || msg.method === 'session/load') result = {
    sessionId: msg.params?.sessionId ?? 'rooms-devin-session',
    modes: { currentModeId: 'normal', availableModes: [{ id: 'normal', name: 'Normal' }] },
    models: { currentModelId: modelId, availableModels: [
      { modelId: 'devin-fixture-model', name: 'Devin fixture model' },
      { modelId: 'devin-fixture-alternative', name: 'Devin alternate model' }
    ] }
  }
  if (msg.method === 'session/set_model') modelId = msg.params.modelId
  if (msg.method === 'session/prompt') {
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: msg.params.sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '正在检查任务卡片布局。' } } } })
    const timer = setInterval(() => {
      if (!fs.existsSync(${JSON.stringify(releaseFile)})) return
      clearInterval(timer)
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: msg.params.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '\\n离线验收完成：执行 Agent 与模型保持一致，任务结果已返回对话。Model: ' + modelId } } } })
      reply({ stopReason: 'end_turn' })
    }, 100)
    return
  }
  reply(result)
})
`)
  await chmod(path, 0o755)
  return path
}

function roomsHarnessModelResponse({ text, messages, supports, completed, call, workspaceRoot }) {
  if (!text.includes('[rooms-harness-smoke]')) return null
  const last = messages.filter((entry) => entry.role === 'user').at(-1)
  if (JSON.stringify(last?.content).includes('workbench_task_outcome')) {
    return supports('send_im_message') && !completed('rooms-harness-final')
      ? call('rooms-harness-final', 'send_im_message', { phase: 'final', text: 'Devin 已完成任务，结果与执行记录见上方任务卡片。' })
      : { role: 'assistant', content: '已汇报任务结果。' }
  }
  if (supports('list_code_harnesses') && !completed('rooms-harness-discover')) {
    return call('rooms-harness-discover', 'list_code_harnesses', {})
  }
  if (supports('create_code_task') && !completed('rooms-harness-create')) {
    return call('rooms-harness-create', 'create_code_task', { title: '检查对话任务卡片布局',
      goal: '检查执行 Agent、模型与任务结果的展示。使用离线验收数据，不修改项目文件。',
      acceptance: '执行身份清晰；窄屏无横向溢出；结果回到原对话。', projectRoot: workspaceRoot,
      execution: { mode: 'direct', model: { harnessId: 'devin', credentialMode: 'native-login', model: 'devin-fixture-model' } },
      isolation: 'inherit', report: 'silent' })
  }
  return supports('send_im_message') && !completed('rooms-harness-proposed')
    ? call('rooms-harness-proposed', 'send_im_message', { phase: 'final', text: '已找到 Code 中可用的 Devin。确认任务卡片后即可开始，也可以修改执行 Agent。' })
    : { role: 'assistant', content: '任务已准备好。' }
}
module.exports = { writeRoomsHarnessStub, roomsHarnessModelResponse }
